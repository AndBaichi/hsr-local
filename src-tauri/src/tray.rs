//! 系统托盘与关窗行为（用户需求：可收纳至托盘，托盘的右键菜单里关闭）
//!
//! ## 分工
//!
//! 托盘只负责「**入口**」：左键唤出窗口、右键菜单给出「显示主窗口 / 关闭」。
//! 真正的关窗决策在前端 `src/lib/windowBehavior.ts`——因为要读偏好、要弹窗询问，
//! 这些都在 TS 侧。
//!
//! ## 为什么托盘「关闭」不直接 `app.exit()`
//!
//! 笔记有 600ms 防抖、偏好有 300ms 防抖。窗口隐藏时 webview 仍然活着，
//! 所以先 `emit("hsr://quit-request")` 让前端冲刷一遍用户数据，冲完由前端调
//! `quit_app` 真正退出。同时起一个 1.5s 的看门狗线程兜底：前端若因任何原因
//! 没响应，也必须能关掉，不能留一个杀不掉的进程。
//!
//! ## 为什么命令是自定义的
//!
//! 用 `getCurrentWindow().hide()` / `app.exit()` 要额外开
//! `core:window:allow-hide`、`core:app:allow-exit`，会放宽 capabilities 的最小权限集。
//! 自定义命令不受 ACL 管，权限面更小。

use std::time::Duration;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};

/// 托盘 id（前端 `tray_set_labels` 用它取回实例）
const TRAY_ID: &str = "main";

/// 菜单项：显示主窗口
const MENU_SHOW: &str = "show";

/// 菜单项：关闭（退出应用）
const MENU_QUIT: &str = "quit";

/// 前端监听的事件名：请前端冲刷数据后自行退出
const QUIT_REQUEST_EVENT: &str = "hsr://quit-request";

/// 看门狗超时（ms）：前端没在此时限内退出就强制退出
const QUIT_WATCHDOG_MS: u64 = 1500;

/// 托盘菜单默认文案（中文）。启动后前端会立刻用当前语言覆盖一次。
const DEFAULT_SHOW_LABEL: &str = "显示主窗口";
/// 托盘菜单默认文案（中文）
const DEFAULT_QUIT_LABEL: &str = "关闭";

/// 构造托盘菜单（每次更新语言时重建一个，菜单项 id 保持不变）
fn build_menu(
    app: &AppHandle,
    show: &str,
    quit: &str,
) -> tauri::Result<Menu<tauri::Wry>> {
    let show_item = MenuItem::with_id(app, MENU_SHOW, show, true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, MENU_QUIT, quit, true, None::<&str>)?;
    Menu::with_items(app, &[&show_item, &quit_item])
}

/// 把主窗口从托盘里唤回前台
fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// 请求退出：先让前端冲刷用户数据，再兜底强杀
fn request_quit(app: &AppHandle) {
    let _ = app.emit(QUIT_REQUEST_EVENT, ());
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(QUIT_WATCHDOG_MS));
        handle.exit(0);
    });
}

/// 创建托盘图标（在 `setup` 里调用一次）。
///
/// # Errors
/// 菜单构造失败或系统拒绝创建托盘图标时返回错误（启动阶段只打日志，不阻断）。
pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let menu = build_menu(app, DEFAULT_SHOW_LABEL, DEFAULT_QUIT_LABEL)?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("星穹铁道数据库")
        .menu(&menu)
        // 左键用来唤出窗口，菜单只在右键弹出（用户明确要求"右键菜单里关闭"）
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            MENU_SHOW => show_main(app),
            MENU_QUIT => request_quit(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            // 左键单击（抬起）唤回窗口；双击在 Windows 上也会先触发一次 Click，无需另处理
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        });

    // 没有默认图标时也照样建（Windows 上会显示成空白方块，但不会崩）
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    builder.build(app)?;
    Ok(())
}

/// 隐藏主窗口（收纳至托盘）
///
/// 用 `async` 是为了跑在 Tauri 的异步运行时上，而不是主线程——窗口 API 内部会往
/// 主线程派发任务，从主线程调用虽然也能工作，但不该在事件循环里做同步阻塞。
///
/// # Errors
/// 托盘不存在时返回错误：那样窗口藏起来就再也叫不回来了，
/// 前端收到错误会回退成"直接退出"。
#[tauri::command]
pub async fn hide_main_window(app: AppHandle) -> Result<(), String> {
    if app.tray_by_id(TRAY_ID).is_none() {
        return Err("托盘图标不可用，无法收纳".to_string());
    }
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "主窗口不存在".to_string())?;
    window.hide().map_err(|error| error.to_string())
}

/// 退出应用（前端冲刷完用户数据后调用）
#[tauri::command]
pub async fn quit_app(app: AppHandle) {
    app.exit(0);
}

/// 更新托盘菜单文案（跟随界面语言）
///
/// # Errors
/// 托盘尚未创建，或菜单重建失败时返回错误字符串（前端只记日志，不阻断）。
#[tauri::command]
pub async fn tray_set_labels(app: AppHandle, show: String, quit: String) -> Result<(), String> {
    // 注意：`tray_by_id` 的签名是 `&'a I`，`TrayIconId: PartialEq<&'a str>`，
    // 所以这里直接传 `TRAY_ID`（`&str`），传 `&TRAY_ID` 会变成 `&&str` 编译不过。
    let tray = app
        .tray_by_id(TRAY_ID)
        .ok_or_else(|| "托盘图标尚未创建".to_string())?;
    let menu = build_menu(&app, &show, &quit).map_err(|error| error.to_string())?;
    tray.set_menu(Some(menu)).map_err(|error| error.to_string())
}
