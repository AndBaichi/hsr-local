//! 构建脚本（架构文档 附录 B.2）
//!
//! 两件事：
//! 1. 生成 Tauri 的权限/命令元数据（`tauri_build::try_build`）
//! 2. 显式提供 Windows 应用清单，拿到 per-monitor v2 的 DPI 感知
//!    （默认清单没有 DPI 声明，高缩放下字体发虚；顺带消掉
//!    `ld.exe: .rsrc merge failure: multiple non-default manifests` —— 见 src-tauri/windows-app.manifest）

fn main() {
    #[cfg(windows)]
    {
        let attributes = tauri_build::Attributes::new().windows_attributes(
            tauri_build::WindowsAttributes::new()
                .app_manifest(include_str!("windows-app.manifest")),
        );
        tauri_build::try_build(attributes).expect("tauri-build 失败");
    }

    #[cfg(not(windows))]
    {
        tauri_build::build();
    }
}
