// 必须是 crate 级内部属性（#!）：写成 main() 的外部属性不生效，release 启动会闪出控制台窗口。
// 仅 Windows 生效：macOS 走的是 .app bundle，本来就没有控制台窗口。
#![cfg_attr(all(not(debug_assertions), target_os = "windows"), windows_subsystem = "windows")]

mod account;
mod api;

use tauri::Manager;

/// macOS 应用菜单。
///
/// 无边框 / Overlay 标题栏的窗口不会自带系统菜单栏，
/// Cmd+Q / Cmd+C / 撤销这些快捷键也就没有承载，这里补一套标准菜单。
#[cfg(target_os = "macos")]
fn install_menu(app: &tauri::AppHandle) -> tauri::Result<()> {
    use tauri::menu::{AboutMetadata, MenuBuilder, MenuItemBuilder, SubmenuBuilder};

    let package = app.package_info();
    let name = package.name.clone();

    let quit = MenuItemBuilder::with_id("quit", "退出红果免费短剧")
        .accelerator("CmdOrCtrl+Q")
        .build(app)?;

    let app_menu = SubmenuBuilder::new(app, name.clone())
        .about(Some(AboutMetadata {
            name: Some(name),
            version: Some(package.version.to_string()),
            ..Default::default()
        }))
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .item(&quit)
        .build()?;

    let edit_menu = SubmenuBuilder::new(app, "编辑")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let window_menu = SubmenuBuilder::new(app, "窗口")
        .minimize()
        .maximize()
        .separator()
        .close_window()
        .build()?;

    let menu = MenuBuilder::new(app)
        .item(&app_menu)
        .item(&edit_menu)
        .item(&window_menu)
        .build()?;
    app.set_menu(menu)?;
    Ok(())
}

fn main() {
    let builder = tauri::Builder::default()
        .setup(|app| {
            let handle = app.handle().clone();
            let state = api::AppState::new(&handle);
            app.manage(state);
            #[cfg(target_os = "macos")]
            install_menu(&handle)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            api::upstream_get,
            api::upstream_post,
            api::store_read,
            api::store_write,
            api::app_info,
            account::phone_account_call
        ]);

    #[cfg(target_os = "macos")]
    let builder = builder.on_menu_event(|app, event| {
        if event.id().as_ref() == "quit" {
            app.exit(0);
        }
    });

    builder
        .run(tauri::generate_context!())
        .expect("红果桌面端启动失败");
}
