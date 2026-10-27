use md5::{Digest, Md5};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;

const DEFAULT_UPSTREAM_HOST: &str = "api5-normal-sinfonlinea.fqnovel.com";

/// 游客态设备参数，与 apk/hongguo-7.4.1.32.apk 对齐。
///
/// 实测（tools/upstream_probe.mjs）：这套参数免签即可拿到榜单接口 code=0；
/// 换成旧的 7.2.2.32 或补上 device_id/iid 都不改变结果 —— 决定能不能拿到数据的是
/// "该接口是否校验签名"，不是版本号。
///
/// device_id / iid 由本机首次启动生成并持久化（见 AppState::new），
/// 这样每次启动上游看到的都是同一个设备身份。
fn guest_query(device_id: &str, iid: &str) -> Vec<(&'static str, String)> {
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    vec![
        ("aid", "8662".to_string()),
        ("app_name", "novelread".to_string()),
        ("version_code", "74132".to_string()),
        ("version_name", "7.4.1.32".to_string()),
        ("channel", "audit".to_string()),
        ("device_platform", "android".to_string()),
        ("device_type", "audit-windows".to_string()),
        ("os_version", "12".to_string()),
        ("update_version_code", "74132".to_string()),
        ("device_id", device_id.to_string()),
        ("iid", iid.to_string()),
        ("install_id", iid.to_string()),
        ("_rticket", now_ms.to_string()),
    ]
}

pub struct AppState {
    pub client: reqwest::Client,
    pub upstream_host: String,
    pub data_dir: PathBuf,
    pub version: String,
    pub store: Mutex<Value>,
    /// 本机设备身份：首次启动生成，之后一直复用（游客态也能"登录状态"稳定）。
    pub device_id: String,
    pub iid: String,
}

impl AppState {
    pub fn new(app: &tauri::AppHandle) -> Self {
        let data_dir = app
            .path()
            .app_data_dir()
            .unwrap_or_else(|_| std::env::temp_dir());
        let _ = std::fs::create_dir_all(&data_dir);

        // upstream_host.json 让打包后的程序能切上游节点，无需重新编译。
        let override_cfg: Value = data_dir
            .join("upstream_host.json")
            .pipe_read_json()
            .unwrap_or(Value::Null);

        let upstream_host = std::env::var("HONGGUO_UPSTREAM_HOST")
            .ok()
            .or_else(|| {
                override_cfg
                    .get("upstream_host")
                    .and_then(Value::as_str)
                    .map(str::to_owned)
            })
            .unwrap_or_else(|| DEFAULT_UPSTREAM_HOST.to_string());

        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(20))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());

        let mut store = data_dir.join("state.json").pipe_read_json().unwrap_or(json!({}));
        if !store.is_object() {
            store = json!({});
        }
        // 身份只在缺失时生成，已有的一律沿用 —— 这是「持久登录」的落点。
        let mut changed = false;
        let device_id = pick_id(&mut store, "hongguo:device_id", &mut changed);
        let iid = pick_id(&mut store, "hongguo:iid", &mut changed);
        if changed {
            let _ = write_state_file(&data_dir, &store);
        }

        Self {
            client,
            upstream_host,
            version: app.package_info().version.to_string(),
            data_dir,
            store: Mutex::new(store),
            device_id,
            iid,
        }
    }

    /// 上游地址：游客参数打底，调用方的 query 覆盖同名键。
    fn upstream_url(&self, path: &str, query: Option<&Value>) -> Result<reqwest::Url, String> {
        let mut url = reqwest::Url::parse(&format!(
            "https://{}{}",
            self.upstream_host,
            normalize_path(path)
        ))
        .map_err(|e| format!("非法上游地址: {e}"))?;
        {
            let mut pairs = url.query_pairs_mut();
            for (k, v) in guest_query(&self.device_id, &self.iid) {
                pairs.append_pair(k, &v);
            }
        }
        if let Some(Value::Object(map)) = query {
            let mut pairs = url.query_pairs_mut();
            for (k, v) in map {
                let value = match v {
                    Value::String(s) => s.clone(),
                    other => other.to_string(),
                };
                if !value.is_empty() {
                    pairs.append_pair(k, &value);
                }
            }
        }
        Ok(url)
    }
}

trait PipeReadJson {
    fn pipe_read_json(&self) -> Option<Value>;
}

impl PipeReadJson for PathBuf {
    fn pipe_read_json(&self) -> Option<Value> {
        let raw = std::fs::read_to_string(self).ok()?;
        serde_json::from_str(&raw).ok()
    }
}

fn normalize_path(path: &str) -> String {
    if path.starts_with('/') {
        path.to_string()
    } else {
        format!("/{path}")
    }
}

/// 取已持久化的身份，没有就生成一个。
fn pick_id(store: &mut Value, key: &str, changed: &mut bool) -> String {
    if let Some(existing) = store.get(key).and_then(Value::as_str) {
        if existing.len() >= 10 {
            return existing.to_string();
        }
    }
    let id = numeric_id();
    if let Some(map) = store.as_object_mut() {
        map.insert(key.to_string(), json!(id));
        *changed = true;
    }
    id
}

/// 19 位数字 ID，形态与安卓端 device_id / iid 一致。
fn numeric_id() -> String {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};
    let mut hasher = RandomState::new().build_hasher();
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    hasher.write_u128(nanos);
    format!("{:019}", hasher.finish())
}

/// 原子落盘：先写临时文件再 rename，崩溃也不会留下半截 JSON。
fn write_state_file(data_dir: &PathBuf, value: &Value) -> Result<(), String> {
    let tmp = data_dir.join("state.json.tmp");
    let final_path = data_dir.join("state.json");
    std::fs::write(&tmp, serde_json::to_vec(value).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &final_path).map_err(|e| e.to_string())
}

/// 上游游客态请求头。真机 app 用 okhttp，UA 参与风控判定，不能换成浏览器 UA。
fn guest_headers(req: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
    req.header("user-agent", "okhttp/4.10.0")
        .header("x-tt-store-region", "cn-sh")
        .header("x-tt-store-region-src", "uid")
        .header("passport-sdk-version", "5051452")
        .header("sdk-version", "2")
}

#[tauri::command]
pub async fn upstream_get(
    state: tauri::State<'_, AppState>,
    path: String,
    query: Option<Value>,
) -> Result<Value, String> {
    let url = state.upstream_url(&path, query.as_ref())?;
    let resp = guest_headers(state.client.get(url))
        .send()
        .await
        .map_err(|e| format!("上游请求失败: {e}"))?;
    read_upstream(resp).await
}

#[tauri::command]
pub async fn upstream_post(
    state: tauri::State<'_, AppState>,
    path: String,
    query: Option<Value>,
    body: Value,
) -> Result<Value, String> {
    let url = state.upstream_url(&path, query.as_ref())?;
    let data = serde_json::to_vec(&body).map_err(|e| e.to_string())?;
    // x-ss-stub 是请求体的 MD5 大写十六进制，上游用它校验 POST 完整性。
    let stub = {
        let mut h = Md5::new();
        h.update(&data);
        h.finalize()
            .iter()
            .map(|b| format!("{b:02X}"))
            .collect::<String>()
    };
    let req = guest_headers(state.client.post(url))
        .header("content-type", "application/json; charset=utf-8")
        .header("x-ss-stub", stub);
    let resp = req
        .body(data)
        .send()
        .await
        .map_err(|e| format!("上游请求失败: {e}"))?;
    read_upstream(resp).await
}

/// 上游对"需要签名却没带签名"的请求回 HTTP 200 + 空 body，
/// 这里把它翻成可读的原因，而不是让前端显示成网络故障。
async fn read_upstream(resp: reqwest::Response) -> Result<Value, String> {
    let status = resp.status();
    let text = resp.text().await.map_err(|e| format!("读取失败: {e}"))?;
    if !status.is_success() {
        return Err(format!("HTTP {status}: {text}"));
    }
    if text.trim().is_empty() {
        return Err("上游返回空响应：该接口需要 X-Argus 签名".to_string());
    }
    serde_json::from_str(&text).map_err(|e| format!("JSON 解析失败: {e}"))
}

#[tauri::command]
pub fn store_read(state: tauri::State<'_, AppState>, key: String) -> Result<Value, String> {
    let guard = state.store.lock().map_err(|_| "存储被占用".to_string())?;
    Ok(guard.get(&key).cloned().unwrap_or(Value::Null))
}

#[tauri::command]
pub fn store_write(state: tauri::State<'_, AppState>, key: String, value: Value) -> Result<Value, String> {
    let snapshot = {
        let mut guard = state.store.lock().map_err(|_| "存储被占用".to_string())?;
        guard
            .as_object_mut()
            .ok_or_else(|| "状态文件不是对象".to_string())?
            .insert(key, value.clone());
        guard.clone()
    };
    write_state_file(&state.data_dir, &snapshot)?;
    Ok(value)
}

#[tauri::command]
pub fn app_info(state: tauri::State<'_, AppState>) -> Value {
    json!({
        "version": state.version,
        "upstreamHost": state.upstream_host,
        "dataDir": state.data_dir.to_string_lossy(),
        "deviceId": state.device_id,
    })
}
