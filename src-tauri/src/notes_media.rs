//! 本地便签的媒体文件（图片 / 附件）导入、删除与打开（v2.15）
//!
//! ## 为什么单独一个模块
//!
//! 便签正文走 `userdata/localnotes.json`（4 MiB 写入闸门、原子写），但图片和附件
//! 可能是几十 MB 的二进制。把它们塞进 JSON 等于把用户数据文件撑成数据库，
//! 还会让每次输入都重写一遍几 MB 的文本。所以：
//!
//!  - JSON 只存元数据：`storedName` / 原始文件名 / 大小 / 类型
//!  - 文件本体落在 `$APPDATA/notes/media/{id}{ext}`
//!  - 图片由前端通过 asset 协议直读（`tauri.conf.json` 已放行 `$APPDATA/notes/**`）
//!
//! ## 安全边界
//!
//! `stored_name` 会拼进路径，所以删除 / 打开前必须过 [`is_safe_stored_name`]：
//! 只允许 `[A-Za-z0-9_-]` 与一个点，长度受限，拒绝 `..`、分隔符、隐藏文件。
//! 导入方向只接受用户在系统文件对话框里选出来的绝对路径，只读源文件、写入应用目录。

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

use crate::error::{AppError, ErrorCode};
use crate::paths;

/// 单次导入的文件数上限（超过说明用户选了整个文件夹，拒绝比卡死好）
const MAX_FILES_PER_IMPORT: usize = 20;

/// 单个文件大小上限（64 MiB）
const MAX_FILE_BYTES: u64 = 64 * 1024 * 1024;

/// 单次导入总大小上限（256 MiB）
const MAX_TOTAL_BYTES: u64 = 256 * 1024 * 1024;

/// 可内联预览的图片扩展名（其余一律按「附件」处理，交给系统默认程序打开）
const IMAGE_EXTS: &[&str] = &["png", "jpg", "jpeg", "webp", "gif", "bmp", "avif", "svg", "ico"];

/// 同一纳秒内多次导入时用来避免撞名
static SEQUENCE: AtomicU64 = AtomicU64::new(0);

/// 一次导入返回给前端的一条媒体元数据（camelCase 与 TS 侧一致）
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedMedium {
    /// 媒体 id（前端 React key / 附件 id）
    pub id: String,
    /// 用户原始文件名（展示用）
    pub file_name: String,
    /// 落盘文件名（`{id}{ext}`，删除/打开时用它）
    pub stored_name: String,
    /// `image` 或 `file`
    pub kind: String,
    /// 字节数
    pub size: u64,
}

/// 媒体目录（`$APPDATA/notes/media`），不存在则创建。
fn media_dir(app: &AppHandle) -> Result<PathBuf, AppError> {
    let dir = paths::appdata_root(app)?.join("notes").join("media");
    paths::ensure_dir(&dir)?;
    Ok(dir)
}

/// 取扩展名：小写、只留字母数字、最长 10 位；没有则返回空串。
fn extension_of(path: &Path) -> String {
    let raw = path
        .extension()
        .map(|value| value.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    let cleaned: String = raw
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .take(10)
        .collect();
    cleaned
}

/// 生成一个不会撞名的媒体 id（纳秒时间戳 + 进程内自增序号，十六进制）。
fn unique_id() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    let sequence = SEQUENCE.fetch_add(1, Ordering::Relaxed);
    format!("{nanos:x}{sequence:x}")
}

/// `stored_name` 是否安全：只允许字母数字、`-`、`_`、一个点，且不能以点开头。
fn is_safe_stored_name(name: &str) -> bool {
    if name.is_empty() || name.len() > 80 || name.starts_with('.') {
        return false;
    }
    if name.contains("..") || name.contains('/') || name.contains('\\') {
        return false;
    }
    name.chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' || ch == '.')
}

/// 把路径转成给人看的错误细节
fn describe(path: &Path, error: &std::io::Error) -> String {
    format!("{}: {error}", path.display())
}

/// 媒体目录的绝对路径（前端拼 asset URL 用）。
///
/// # Errors
/// 应用数据目录无法解析 / 目录无法创建
#[tauri::command]
pub fn notes_media_dir(app: AppHandle) -> Result<String, AppError> {
    Ok(media_dir(&app)?.to_string_lossy().to_string())
}

/// 把用户选中的文件复制进媒体目录。
///
/// 只复制、不移动源文件；同名文件不会互相覆盖（落盘名带唯一 id）。
///
/// # Errors
/// 文件过大、总大小超限、数量超限、读取/复制失败
#[tauri::command]
pub fn notes_media_import(
    app: AppHandle,
    paths: Vec<String>,
) -> Result<Vec<ImportedMedium>, AppError> {
    if paths.is_empty() {
        return Ok(Vec::new());
    }
    if paths.len() > MAX_FILES_PER_IMPORT {
        return Err(AppError::new(
            ErrorCode::IoFailed,
            format!("一次最多导入 {MAX_FILES_PER_IMPORT} 个文件"),
        ));
    }

    let dir = media_dir(&app)?;
    let mut total_bytes = 0_u64;
    let mut imported = Vec::with_capacity(paths.len());

    for raw in paths {
        let source = PathBuf::from(&raw);
        let metadata = std::fs::metadata(&source)
            .map_err(|error| AppError::new(ErrorCode::IoFailed, "读取文件信息失败").with_detail(describe(&source, &error)))?;
        if !metadata.is_file() {
            continue;
        }
        let size = metadata.len();
        if size > MAX_FILE_BYTES {
            return Err(AppError::new(ErrorCode::IoFailed, "单个文件超过 64 MB")
                .with_detail(source.display().to_string()));
        }
        total_bytes += size;
        if total_bytes > MAX_TOTAL_BYTES {
            return Err(AppError::new(ErrorCode::IoFailed, "本次导入总大小超过 256 MB"));
        }

        let extension = extension_of(&source);
        let id = unique_id();
        let stored_name = if extension.is_empty() {
            id.clone()
        } else {
            format!("{id}.{extension}")
        };
        let target = dir.join(&stored_name);
        std::fs::copy(&source, &target)
            .map_err(|error| AppError::new(ErrorCode::IoFailed, "复制文件失败").with_detail(describe(&source, &error)))?;

        let file_name = source
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_else(|| stored_name.clone());
        let kind = if IMAGE_EXTS.contains(&extension.as_str()) {
            "image"
        } else {
            "file"
        };
        imported.push(ImportedMedium {
            id,
            file_name,
            stored_name,
            kind: kind.to_string(),
            size,
        });
    }

    Ok(imported)
}

/// 删除若干个媒体文件（便签或附件被删除时调用）。
///
/// 文件名不合法的一律跳过而不是整批失败：清理是尽力而为，删不掉残留文件
/// 只占磁盘，不该阻塞用户删除便签。
///
/// # Errors
/// 媒体目录无法解析
#[tauri::command]
pub fn notes_media_delete(app: AppHandle, stored_names: Vec<String>) -> Result<(), AppError> {
    let dir = media_dir(&app)?;
    for stored_name in stored_names {
        if !is_safe_stored_name(&stored_name) {
            continue;
        }
        let path = dir.join(&stored_name);
        if path.is_file() {
            let _ = std::fs::remove_file(path);
        }
    }
    Ok(())
}

/// 用系统默认程序打开一个媒体文件（图片也走这条，交给看图软件放大）。
///
/// # Errors
/// 文件名不合法、文件不存在、系统无法打开
#[tauri::command]
pub fn notes_media_open(app: AppHandle, stored_name: String) -> Result<(), AppError> {
    if !is_safe_stored_name(&stored_name) {
        return Err(AppError::new(ErrorCode::IoFailed, "文件名不合法").with_detail(stored_name));
    }
    let path = media_dir(&app)?.join(&stored_name);
    if !path.is_file() {
        return Err(AppError::new(ErrorCode::IoFailed, "附件文件不存在").with_detail(path.display().to_string()));
    }
    app.opener()
        .open_path(path.to_string_lossy().to_string(), None::<&str>)
        .map_err(|error| AppError::new(ErrorCode::IoFailed, "打开附件失败").with_detail(error.to_string()))?;
    Ok(())
}
