// release 构建下不弹控制台窗口（Windows）
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
// `.rsrc merge failure: multiple non-default manifests` 是 GNU 工具链的结构性后果：
// ld 会把 MinGW 自带的 default-manifest.o 一起链进来，而 tauri-build 又嵌入了我们的清单。
// 两份 RT_MANIFEST 谁被 Windows 选中由资源目录顺序决定（规范上无保证），
// 所以 DPI 感知改由 `dpi::enable_per_monitor_v2()` 在运行时确定性地设置，
// 该告警因此不再代表任何实际风险，这里显式静音（详见 src/dpi.rs 的模块文档）。
#![allow(linker_messages)]

fn main() {
    hsr_local_lib::run()
}
