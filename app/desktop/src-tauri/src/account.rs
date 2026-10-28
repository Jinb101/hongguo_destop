use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::Mutex;
use tauri::Manager;

/// 手机号登录宿主。
///
/// 账号接口要带 X-Gorgon / X-Helios / X-Ladon / Medusa 签名，
/// 这套算法在 `app/backend/phone-account-protocol` 里以 Python 实现。
/// 这里只做进程桥：拉起宿主，按行收发 JSON，不解析业务字段。
pub struct AccountHost {
    python: PathBuf,
    script: PathBuf,
    device: PathBuf,
    session: Mutex<Option<Session>>,
}

struct Session {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

impl Drop for Session {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn first_file(candidates: Vec<PathBuf>) -> Option<PathBuf> {
    candidates.into_iter().find(|path| path.is_file())
}

fn resolve_script() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(path) = std::env::var_os("HONGGUO_ACCOUNT_HOST") {
        candidates.push(PathBuf::from(path));
    }
    if let Some(path) = option_env!("HONGGUO_ACCOUNT_HOST_DEV") {
        candidates.push(PathBuf::from(path));
    }
    first_file(candidates)
}

fn resolve_python() -> PathBuf {
    let mut candidates = Vec::new();
    if let Some(path) = std::env::var_os("HONGGUO_PYTHON") {
        candidates.push(PathBuf::from(path));
    }
    if let Some(path) = option_env!("HONGGUO_PYTHON_DEV") {
        candidates.push(PathBuf::from(path));
    }
    first_file(candidates).unwrap_or_else(|| PathBuf::from("python3"))
}

impl AccountHost {
    pub fn new(app: &tauri::AppHandle) -> Self {
        let data_dir = app
            .path()
            .app_data_dir()
            .unwrap_or_else(|_| std::env::temp_dir());
        Self {
            python: resolve_python(),
            script: resolve_script().unwrap_or_else(|| PathBuf::from("phone_account_host.py")),
            device: data_dir.join("account-device.bin"),
            session: Mutex::new(None),
        }
    }

    fn spawn(&self) -> Result<Session, String> {
        if !self.script.is_file() {
            return Err("账号组件缺失：找不到 phone_account_host.py".to_string());
        }
        if let Some(parent) = self.device.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("账号目录创建失败: {e}"))?;
        }
        let mut child = Command::new(&self.python)
            .arg(&self.script)
            .current_dir(self.script.parent().unwrap_or(Path::new(".")))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("账号组件启动失败（{}）: {e}", self.python.display()))?;
        let mut stdin = child.stdin.take().ok_or("账号组件缺少输入管道")?;
        let stdout = child.stdout.take().ok_or("账号组件缺少输出管道")?;
        let init = json!({ "devicePath": self.device.to_string_lossy() });
        let line = serde_json::to_vec(&init).map_err(|e| e.to_string())?;
        stdin
            .write_all(&line)
            .and_then(|_| stdin.write_all(b"\n"))
            .and_then(|_| stdin.flush())
            .map_err(|e| format!("账号组件初始化失败: {e}"))?;
        Ok(Session {
            child,
            stdin,
            stdout: BufReader::new(stdout),
        })
    }

    /// 一次「写一行、读一行」往返。
    ///
    /// 业务错误（ok:false）必须保留会话：验证码、待验证挑战都活在宿主进程内存里，
    /// 丢一次会话就等于把用户刚走完的登录流程清空。只有管道本身坏了才重建。
    pub fn call(&self, request: Value) -> Result<Value, String> {
        let mut guard = self.session.lock().map_err(|_| "账号组件被占用".to_string())?;
        if guard.is_none() {
            *guard = Some(self.spawn()?);
        }
        let session = guard.as_mut().expect("session initialized");
        let payload = serde_json::to_vec(&request).map_err(|e| e.to_string())?;
        let result = (|| -> Result<Value, (String, bool)> {
            session
                .stdin
                .write_all(&payload)
                .and_then(|_| session.stdin.write_all(b"\n"))
                .and_then(|_| session.stdin.flush())
                .map_err(|e| (format!("账号请求发送失败: {e}"), true))?;
            let mut reply = String::new();
            let read = session
                .stdout
                .read_line(&mut reply)
                .map_err(|e| (format!("账号响应读取失败: {e}"), true))?;
            if read == 0 {
                return Err(("账号组件已退出".to_string(), true));
            }
            let value: Value = serde_json::from_str(&reply)
                .map_err(|e| (format!("账号响应无法解析: {e}"), true))?;
            if value.get("ok").and_then(Value::as_bool) == Some(true) {
                Ok(value.get("value").cloned().unwrap_or(Value::Null))
            } else {
                Err((
                    value
                        .get("error")
                        .and_then(Value::as_str)
                        .unwrap_or("账号操作未完成")
                        .to_string(),
                    false,
                ))
            }
        })();
        match result {
            Ok(value) => Ok(value),
            Err((message, broken)) => {
                if broken {
                    *guard = None;
                }
                Err(message)
            }
        }
    }
}

const ACTIONS: [&str; 5] = ["status", "send", "login", "continue", "logout"];

#[tauri::command]
pub async fn phone_account_call(
    state: tauri::State<'_, crate::api::AppState>,
    action: String,
    phone: Option<String>,
    code: Option<String>,
) -> Result<Value, String> {
    if !ACTIONS.contains(&action.as_str()) {
        return Err("不支持的账号操作".to_string());
    }
    let host = state.account.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut request = json!({ "action": action });
        if let Some(phone) = phone {
            request["phone"] = json!(phone);
        }
        if let Some(code) = code {
            request["code"] = json!(code);
        }
        host.call(request)
    })
    .await
    .map_err(|e| format!("账号调用失败: {e}"))?
}
