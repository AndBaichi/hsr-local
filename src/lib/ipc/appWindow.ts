/**
 * 窗口相关的 IPC 封装（关窗行为 / 托盘）
 *
 * 全部是**自定义命令**（`src-tauri/src/tray.rs`），不是插件命令——
 * Tauri 2 里应用自身的命令不受 ACL 管，所以不需要往 capabilities 里加权限。
 *
 * 为什么不在前端直接用 `getCurrentWindow().hide()` / `@tauri-apps/api/app` 的 `exit()`：
 * 那两个要额外开 `core:window:allow-hide` / `core:app:allow-exit`，
 * 而本项目的权限表刻意维持最小集（架构文档 §2.4）。多两条自定义命令，
 * 反而比放宽 core 权限更收敛。
 */

import { invoke } from '@tauri-apps/api/core';

/** 隐藏主窗口（收纳至托盘） */
export function hideMainWindow(): Promise<void> {
  return invoke('hide_main_window');
}

/** 退出应用（Rust 侧 `app.exit(0)`） */
export function quitApp(): Promise<void> {
  return invoke('quit_app');
}

/**
 * 更新托盘右键菜单的文案（跟随界面语言）。
 *
 * @param show 「显示主窗口」的文案
 * @param quit 「关闭」的文案
 */
export function setTrayLabels(show: string, quit: string): Promise<void> {
  return invoke('tray_set_labels', { show, quit });
}
