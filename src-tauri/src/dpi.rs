//! DPI 感知（架构文档 附录 B Windows 段）
//!
//! ## 为什么既写清单又调 API
//!
//! 本项目的 Windows 应用清单（`src-tauri/windows-app.manifest`）里声明了
//! `permonitorv2`，但 GNU 工具链下 **MinGW 的 `default-manifest.o` 会被 ld 一起链进来**，
//! 于是 exe 里出现两份 `RT_MANIFEST`（资源 id 都是 1）：
//!
//! ```text
//! #0  nameId=1  2090B  ← 我们的（dpiAware + permonitorv2 + Common-Controls）
//! #1  nameId=1   599B  ← MinGW 的（只有 requestedExecutionLevel + longPathAware）
//! ```
//!
//! 两份同名同语言的资源，Windows 取哪一份取决于资源目录的排列顺序——**规范上不保证**。
//! ld 2.47 没有 `--disable-manifest` 之类的开关可以关掉注入，唯一能确定的是：
//! 只要以 **运行时 API** 显式设置一次 DPI 感知，就不必再赌清单被谁选中。
//!
//! 于是这里在进程启动的第一时间调用 `SetProcessDpiAwarenessContext(PER_MONITOR_AWARE_V2)`；
//! 若清单已经生效，该调用会安全地失败（`ERROR_ACCESS_DENIED`），不影响任何东西。
//!
//! 注意顺序：**必须在创建任何窗口之前调用**，否则设置会被忽略。

/// 进程 DPI 感知状态（`GetProcessDpiAwareness` 的返回值）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DpiAwareness {
    /// 不感知（系统位图拉伸，字发虚）
    Unaware,
    /// 系统级感知
    System,
    /// 每显示器感知（v1 或 v2）
    PerMonitor,
    /// 查询失败
    Unknown,
}

impl DpiAwareness {
    /// 便于展示/日志的短标签
    pub fn label(self) -> &'static str {
        match self {
            Self::Unaware => "unaware",
            Self::System => "system",
            Self::PerMonitor => "per-monitor",
            Self::Unknown => "unknown",
        }
    }

    /// 是否已经达到「每显示器感知」这一档（v2 在 `GetProcessDpiAwareness` 里也报这一档）
    pub fn is_per_monitor(self) -> bool {
        matches!(self, Self::PerMonitor)
    }
}

#[cfg(windows)]
mod imp {
    use core::ffi::c_void;

    /// `DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2`：值就是 `(HANDLE)-4`
    pub const PER_MONITOR_AWARE_V2: isize = -4;
    /// `PROCESS_PER_MONITOR_DPI_AWARE`
    pub const PROCESS_PER_MONITOR_DPI_AWARE: i32 = 2;

    #[link(name = "user32")]
    extern "system" {
        /// Win10 1703+
        pub fn SetProcessDpiAwarenessContext(value: isize) -> i32;
    }

    #[link(name = "shcore")]
    extern "system" {
        /// Win8.1+，作为 V2 API 不可用时的退路
        pub fn SetProcessDpiAwareness(value: i32) -> i32;
        pub fn GetProcessDpiAwareness(handle: *mut c_void, value: *mut i32) -> i32;
    }
}

/// 尽力把当前进程设成 per-monitor v2（在创建窗口前调用）。
///
/// 返回设置后**实际**的感知状态；即使设置失败也会返回查询结果，便于日志记录。
/// 非 Windows 平台直接返回 [`DpiAwareness::Unknown`]。
pub fn enable_per_monitor_v2() -> DpiAwareness {
    #[cfg(windows)]
    {
        // 1. 首选 V2（Win10 1703+）。清单已生效时这里会失败，属正常。
        let v2_ok = unsafe { imp::SetProcessDpiAwarenessContext(imp::PER_MONITOR_AWARE_V2) };
        if v2_ok == 0 {
            // 2. 退路：Win8.1 的 shcore 接口
            let _ = unsafe { imp::SetProcessDpiAwareness(imp::PROCESS_PER_MONITOR_DPI_AWARE) };
        }
        return current_awareness();
    }

    #[cfg(not(windows))]
    {
        DpiAwareness::Unknown
    }
}

/// 查询当前进程的 DPI 感知状态。
pub fn current_awareness() -> DpiAwareness {
    #[cfg(windows)]
    {
        let mut value: i32 = -1;
        let result =
            unsafe { imp::GetProcessDpiAwareness(core::ptr::null_mut(), &mut value) };
        if result != 0 {
            return DpiAwareness::Unknown;
        }
        return match value {
            0 => DpiAwareness::Unaware,
            1 => DpiAwareness::System,
            2 => DpiAwareness::PerMonitor,
            _ => DpiAwareness::Unknown,
        };
    }

    #[cfg(not(windows))]
    {
        DpiAwareness::Unknown
    }
}
