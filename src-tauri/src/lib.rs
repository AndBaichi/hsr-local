//! 应用装配（架构文档 §8.10 lib.rs）
//!
//! 拆出 `run()` 而把 `main.rs` 保持为一行，是为了：
//!  - 断言可以直接引用 crate（`src/bin/selftest.rs` 就是这么用的）；
//!  - 将来若扩展移动端，`#[cfg_attr(mobile, tauri::mobile_entry_point)]` 只加在这里。

pub mod atomic;
pub mod datapack;
pub mod dpi;
pub mod error;
pub mod notes_media;
pub mod pack;
pub mod paths;
pub mod selftest;
pub mod tray;
pub mod userdata;

use tauri::{Manager, State};

use crate::pack::{DatapackStats, PackState, PackStatus};

/// 查询数据包准备状态（前端 `BootGuard` 在启动时轮询它）
///
/// 返回 `{ state: "ready" | "extracting" | "failed", ... }`，
/// 前端按 `state` 分支，不解析 message 文案。
#[tauri::command]
fn pack_status(state: State<'_, PackState>) -> PackStatus {
    state.snapshot()
}

/// 读取数据包的真实统计（角色数 / 物品数 / 样例角色名）。
///
/// 这是「数据真的读得到」的自检入口，同时也给 T04 的「关于」页复用。
///
/// # Errors
/// 数据包未就绪或索引文件损坏时返回 `AppError`
#[tauri::command]
fn datapack_stats(app: tauri::AppHandle) -> Result<DatapackStats, crate::error::AppError> {
    pack::stats(&app)
}

/// 装配并运行 Tauri 应用。
///
/// 插件注册顺序有要求：`single-instance` **必须第一个**注册，
/// 否则第二个实例的其它插件会先执行初始化，产生重复资源占用。
pub fn run() {
    // 记录进程启动时刻（数据包就绪时把它换算成"启动后 N ms"写进日志/标题）
    let _ = pack::BOOT_INSTANT.set(std::time::Instant::now());

    // DPI 必须在创建任何窗口之前确定（清单在 GNU 工具链下不保证被选中，见 dpi.rs）
    let awareness = dpi::enable_per_monitor_v2();

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            // 第二个实例启动时：把已有窗口拉回前台
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        // 窗口尺寸/位置/最大化状态：关闭时保存，启动时恢复（PRD P0-01）
        //
        // v2.17 起窗口是无边框的（`decorations: false`），但 window-state 默认会把
        // 上次的「有边框」状态一起恢复——老用户的 `decorated: true` 会把配置改回去，
        // 于是又长出系统标题栏。这里显式不保存/不恢复 DECORATIONS，让配置说了算。
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::all()
                        & !tauri_plugin_window_state::StateFlags::DECORATIONS,
                )
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(PackState::default())
        // 索引缓存：一次读入 6 个索引常驻内存，按 root 做键（换包即失效）
        .manage(datapack::IndexCache::default())
        .invoke_handler(tauri::generate_handler![
            pack_status,
            datapack_stats,
            datapack::read_json,
            datapack::datapack_index,
            datapack::datapack_index_invalidate,
            userdata::userdata_read,
            userdata::userdata_write,
            userdata::userdata_open_folder,
            notes_media::notes_media_dir,
            notes_media::notes_media_import,
            notes_media::notes_media_delete,
            notes_media::notes_media_open,
            tray::hide_main_window,
            tray::quit_app,
            tray::tray_set_labels,
        ])
        .setup(move |app| {
            let handle = app.handle().clone();
            if let Err(error) = paths::ensure_app_dirs(&handle) {
                // 目录创建失败不阻断启动：只影响「导入数据包 / 保存用户数据」，
                // 内置数据包仍可只读使用。错误会在实际写入时再次上报给前端。
                eprintln!("[hsr] 初始化应用目录失败: {error}");
            }

            // 托盘常驻（收纳至托盘 + 右键菜单关闭）。失败只打日志：
            // 没有托盘时应用仍能正常使用，只是「收纳至托盘」会变成隐藏窗口后叫不回来。
            if let Err(error) = tray::setup(&handle) {
                eprintln!("[hsr] 创建托盘图标失败: {error}");
            }

            // 数据包展开放到后台线程：首次启动要解 5461 个文件（~94MB），
            // 同步做会让窗口白屏十几秒。前端用 `pack_status` 轮询进度。
            let prepare_handle = handle.clone();
            std::thread::spawn(move || {
                pack::prepare_in_background(prepare_handle, awareness);
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("运行 Tauri 应用时发生致命错误");
}

// 断言不写在这里：`cargo test` 的 libtest harness 在本工具链下起不来
// （`0xC0000139 STATUS_ENTRYPOINT_NOT_FOUND`），全部断言集中在 `selftest.rs`，
// 由 `cargo run --bin selftest` 驱动。
