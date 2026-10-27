fn main() {
    // generate_context! 在编译期嵌入前端产物，但 tauri-build 不会跟踪 dist 目录，
    // 重新 npm build 后若不声明这条，cargo 会认为无需重编、打进 exe 的还是旧页面。
    println!("cargo:rerun-if-changed=../../frontend-src/dist");
    tauri_build::build()
}
