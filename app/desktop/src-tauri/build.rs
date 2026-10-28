use std::path::Path;

fn main() {
    // generate_context! 在编译期嵌入前端产物，但 tauri-build 不会跟踪 dist 目录，
    // 重新 npm build 后若不声明这条，cargo 会认为无需重编、打进 exe 的还是旧页面。
    println!("cargo:rerun-if-changed=../../frontend-src/dist");

    // 账号宿主是 Python 实现（签名算法在 app/backend）。安装包不携带 Python 运行时，
    // 这里把本机的开发环境路径编译进去；运行期可用环境变量覆盖。
    let backend = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../backend");
    for (variable, relative) in [
        ("HONGGUO_ACCOUNT_HOST_DEV", "phone-account-protocol/phone_account_host.py"),
        ("HONGGUO_PYTHON_DEV", ".venv/bin/python3"),
    ] {
        let path = backend.join(relative);
        if path.is_file() {
            // 不做 canonicalize：venv 的 python3 是符号链接，
            // 解析成真实解释器后就丢了 venv 的 site-packages。
            println!("cargo:rustc-env={variable}={}", path.display());
        }
    }

    tauri_build::build()
}
