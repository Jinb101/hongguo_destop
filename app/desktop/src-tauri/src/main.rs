// 必须是 crate 级内部属性（#!）：写成 main() 的外部属性不生效，release 启动会闪出控制台窗口。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod api;

use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let state = api::AppState::new(&app.handle().clone());
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            api::upstream_get,
            api::upstream_post,
            api::store_read,
            api::store_write,
            api::app_info
        ])
        .run(tauri::generate_context!())
        .expect("红果桌面端启动失败");
}
