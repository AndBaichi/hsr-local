//! 统一错误类型（架构文档 §11.5）
//!
//! 所有 Tauri command 返回 `Result<T, AppError>`；`AppError` 序列化为
//! `{ code, message, detail }` 三个字段：
//!  - `code` 是**稳定**的枚举字符串，前端据此选择 i18n 文案，不解析 message
//!  - `message` 是给人看的中文短句（可作为技术详情展示）
//!  - `detail` 是可选的技术细节（路径、底层错误），UI 折叠展示

use std::fmt;
use std::io;

use serde::Serialize;

/// 稳定错误码（前端 `DataAccessError.code` 与此一一对应）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorCode {
    /// 数据包目录 / 文件不存在
    PackNotFound,
    /// 数据包内的某个文件不存在（T03 `read_json` 用：指针有效但文件缺失）
    PackFileMissing,
    /// 请求的路径不合法（越界、绝对路径、盘符）——正常前端不会触发
    PackInvalidPath,
    /// 数据包内容损坏（manifest 校验失败、JSON 解析失败）
    PackCorrupt,
    /// `meta.schemaVersion` 与应用不兼容
    PackIncompatibleSchema,
    /// 解包失败（zip-slip、磁盘写失败、空间不足）
    PackExtractFailed,
    /// 用户数据（收藏 / 笔记 / 偏好）写入失败
    UserdataWriteFailed,
    /// 请求的用户数据文件名不在白名单内（`prefs|favorites|notes|recent`）
    UserdataInvalidName,
    /// 待写入的用户数据不是合法 JSON，或顶层形状不对（对象 vs 数组）
    UserdataInvalidContent,
    /// 网络被禁用或请求被拒绝
    NetworkDisabled,
    /// 检查更新失败
    UpdateCheckFailed,
    /// 通用 IO 失败
    IoFailed,
    /// 未归类的内部错误
    Internal,
}

impl ErrorCode {
    /// 稳定字符串，与 `Serialize` 的 `SCREAMING_SNAKE_CASE` 完全一致。
    ///
    /// 手写 `match` 而不是序列化取值，是为了让「漏加分支」在编译期暴露
    /// （新增枚举变体时这里会报 `non-exhaustive`）。
    pub fn as_str(self) -> &'static str {
        match self {
            Self::PackNotFound => "PACK_NOT_FOUND",
            Self::PackFileMissing => "PACK_FILE_MISSING",
            Self::PackInvalidPath => "PACK_INVALID_PATH",
            Self::PackCorrupt => "PACK_CORRUPT",
            Self::PackIncompatibleSchema => "PACK_INCOMPATIBLE_SCHEMA",
            Self::PackExtractFailed => "PACK_EXTRACT_FAILED",
            Self::UserdataWriteFailed => "USERDATA_WRITE_FAILED",
            Self::UserdataInvalidName => "USERDATA_INVALID_NAME",
            Self::UserdataInvalidContent => "USERDATA_INVALID_CONTENT",
            Self::NetworkDisabled => "NETWORK_DISABLED",
            Self::UpdateCheckFailed => "UPDATE_CHECK_FAILED",
            Self::IoFailed => "IO_FAILED",
            Self::Internal => "INTERNAL",
        }
    }
}

/// 应用统一错误
#[derive(Debug, Clone, Serialize)]
pub struct AppError {
    /// 稳定错误码
    pub code: ErrorCode,
    /// 人可读的短描述
    pub message: String,
    /// 技术细节（可选）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

impl AppError {
    /// 构造一个带错误码与消息的错误。
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            detail: None,
        }
    }

    /// 追加技术细节（链式调用）。
    pub fn with_detail(mut self, detail: impl Into<String>) -> Self {
        self.detail = Some(detail.into());
        self
    }

    /// 数据包缺失
    pub fn pack_not_found(path: impl fmt::Display) -> Self {
        Self::new(ErrorCode::PackNotFound, "未找到数据包").with_detail(format!("path={path}"))
    }

    /// 解包失败（zip-slip、磁盘写失败、空间不足）
    pub fn pack_extract_failed(path: impl fmt::Display, error: &impl fmt::Display) -> Self {
        Self::new(ErrorCode::PackExtractFailed, "数据包解压失败")
            .with_detail(format!("{path}: {error}"))
    }

    /// 数据包损坏
    pub fn pack_corrupt(reason: impl Into<String>) -> Self {
        Self::new(ErrorCode::PackCorrupt, "数据包已损坏").with_detail(reason.into())
    }

    /// 数据包内的文件不存在。
    ///
    /// 单独一个码而不是复用 `PackNotFound`：前者意味着"包在、文件缺"（数据不完整，
    /// 通常要重装/重导），后者意味着"根本没有可用的包"（走 BootErrorPage 的导入入口）。
    /// 前端据此给的引导完全不同，不能合并。
    pub fn pack_file_missing(rel: impl fmt::Display) -> Self {
        Self::new(ErrorCode::PackFileMissing, "数据包文件缺失").with_detail(format!("rel={rel}"))
    }

    /// 请求的数据包内路径不合法（`..`、绝对路径、盘符）。
    pub fn pack_invalid_path(rel: impl fmt::Display) -> Self {
        Self::new(ErrorCode::PackInvalidPath, "非法的数据包路径")
            .with_detail(format!("rel={rel}"))
    }

    /// schema 版本不兼容
    pub fn pack_incompatible_schema(found: impl fmt::Display, expected: impl fmt::Display) -> Self {
        Self::new(ErrorCode::PackIncompatibleSchema, "数据包版本不兼容")
            .with_detail(format!("schemaVersion={found}, expected={expected}"))
    }

    /// 用户数据写入失败
    pub fn userdata_write_failed(detail: impl fmt::Display) -> Self {
        Self::new(ErrorCode::UserdataWriteFailed, "用户数据写入失败")
            .with_detail(detail.to_string())
    }

    /// 用户数据文件名不合法。
    ///
    /// 单独一个码而不是复用 `USERDATA_WRITE_FAILED`：这条错的成因是**调用方传错了名字**
    /// （或有人在手动调 IPC），而不是磁盘写不进去。用户看到的引导完全不同
    /// （"写入失败"会让人去查磁盘空间），排障方向也完全不同。
    pub fn userdata_invalid_name(name: impl fmt::Display) -> Self {
        Self::new(ErrorCode::UserdataInvalidName, "用户数据文件名不合法").with_detail(format!(
            "name={name}，允许 prefs / favorites / notes / recent"
        ))
    }

    /// 用户数据内容不合法（不是 JSON，或顶层形状不对）。
    pub fn userdata_invalid_content(name: impl fmt::Display, reason: impl fmt::Display) -> Self {
        Self::new(
            ErrorCode::UserdataInvalidContent,
            "用户数据内容不合法，已拒绝写入",
        )
        .with_detail(format!("name={name}: {reason}"))
    }

    /// 内部错误
    pub fn internal(detail: impl Into<String>) -> Self {
        Self::new(ErrorCode::Internal, "内部错误").with_detail(detail.into())
    }
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match &self.detail {
            Some(detail) => write!(f, "{} [{:?}] ({detail})", self.message, self.code),
            None => write!(f, "{} [{:?}]", self.message, self.code),
        }
    }
}

impl std::error::Error for AppError {}

impl From<io::Error> for AppError {
    fn from(error: io::Error) -> Self {
        Self::new(ErrorCode::IoFailed, "文件读写失败").with_detail(error.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(error: serde_json::Error) -> Self {
        Self::new(ErrorCode::PackCorrupt, "JSON 解析失败").with_detail(error.to_string())
    }
}
