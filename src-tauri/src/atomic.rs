//! 原子写入与损坏恢复（架构文档 §2.3、§8.10 atomic.rs）
//!
//! 写入流程：`write tmp` → `fsync` → `rename`。
//! 进程在任何一步被杀，目标文件要么是旧内容、要么是新内容，**不存在半个文件**。
//!
//! 读取流程：解析失败 → 把坏文件复制为 `.bak` → 返回默认值。
//! 这样用户数据损坏时应用仍可启动，且坏文件留有余地供排障。

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::de::DeserializeOwned;
use serde::Serialize;

use crate::error::AppError;

/// 生成与目标文件同目录的临时文件路径。
///
/// 必须同目录：跨分区 `rename` 会退化为「复制 + 删除」，失去原子性。
fn tmp_path_for(path: &Path) -> PathBuf {
    let file_name = path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "atomic".to_string());
    let tmp_name = format!(".{file_name}.tmp");
    match path.parent() {
        Some(parent) => parent.join(tmp_name),
        None => PathBuf::from(tmp_name),
    }
}

/// 生成备份路径（`prefs.json` → `prefs.json.bak`）。
///
/// `pub(crate)` 是给 `selftest` 用的：它要断言坏文件确实被备份。
pub(crate) fn bak_path_for(path: &Path) -> PathBuf {
    let file_name = path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "atomic".to_string());
    let bak_name = format!("{file_name}.bak");
    match path.parent() {
        Some(parent) => parent.join(bak_name),
        None => PathBuf::from(bak_name),
    }
}

/// 原子写入字节到文件。
///
/// # Errors
/// 目录无法创建、写入失败或 rename 失败时返回 `AppError::IoFailed`
pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), AppError> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            fs::create_dir_all(parent).map_err(|error| {
                AppError::userdata_write_failed(format!("创建目录失败 {}: {error}", parent.display()))
            })?;
        }
    }

    let tmp = tmp_path_for(path);

    {
        let mut file = fs::File::create(&tmp).map_err(|error| {
            AppError::userdata_write_failed(format!("创建临时文件失败 {}: {error}", tmp.display()))
        })?;
        file.write_all(bytes).map_err(|error| {
            AppError::userdata_write_failed(format!("写入临时文件失败 {}: {error}", tmp.display()))
        })?;
        // fsync：保证 rename 之后磁盘上确有数据，而不是仍在页缓存里
        file.sync_all().map_err(|error| {
            AppError::userdata_write_failed(format!("fsync 失败 {}: {error}", tmp.display()))
        })?;
    }

    fs::rename(&tmp, path).map_err(|error| {
        // 清理残留临时文件，避免下次误读
        let _ = fs::remove_file(&tmp);
        AppError::userdata_write_failed(format!(
            "原子替换失败 {} -> {}: {error}",
            tmp.display(),
            path.display()
        ))
    })?;

    Ok(())
}

/// 原子写入 JSON（紧凑格式，用户数据不做美化以减小体积）。
///
/// # Errors
/// 序列化失败返回 `AppError::Internal`；写入失败见 [`write_atomic`]
pub fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> Result<(), AppError> {
    let bytes = serde_json::to_vec(value)
        .map_err(|error| AppError::internal(format!("序列化失败: {error}")))?;
    write_atomic(path, &bytes)
}

/// 把损坏文件复制为 `.bak`（尽力而为，失败不阻断启动）。
fn backup_corrupt(path: &Path) -> Option<PathBuf> {
    let bak = bak_path_for(path);
    match fs::copy(path, &bak) {
        Ok(_) => Some(bak),
        Err(_) => None,
    }
}

/// 读取 JSON；文件不存在或内容损坏时返回默认值。
///
/// 这是「损坏恢复」的唯一入口：**任何情况下都不向调用方抛解析错误**，
/// 只可能返回 IO 层无法恢复的错误（例如目录无权限）。
///
/// # Errors
/// 读取文件时发生非「不存在」类 IO 错误
pub fn read_json_or_default<T>(path: &Path) -> Result<T, AppError>
where
    T: DeserializeOwned + Default,
{
    match fs::read(path) {
        Ok(bytes) => match serde_json::from_slice::<T>(&bytes) {
            Ok(value) => Ok(value),
            Err(error) => {
                let backup = backup_corrupt(path);
                if cfg!(debug_assertions) {
                    eprintln!(
                        "[atomic] {} 内容损坏（{error}），已回退默认值，备份={:?}",
                        path.display(),
                        backup
                    );
                }
                Ok(T::default())
            }
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(T::default()),
        Err(error) => Err(AppError::userdata_write_failed(format!(
            "读取失败 {}: {error}",
            path.display()
        ))),
    }
}

/// [`read_json_text`] 的三态结果。
///
/// 与 [`read_json_or_default`] 的区别：**区分「文件不存在」与「内容损坏」**。
/// 用户数据要的是「缺失 → 用前端默认值（不落盘）」而「损坏 → 备份 + 重建空文件」，
/// 两件事的副作用不同，不能合并成一个 `default`。
#[derive(Debug)]
pub enum JsonTextRead {
    /// 文件不存在（首次启动，或用户删掉了）
    Missing,
    /// 内容不是合法 JSON（或不是 UTF-8）；已尽力备份为 `.bak`
    Corrupt {
        /// 备份文件路径（复制失败时为 `None`）
        backup: Option<PathBuf>,
    },
    /// 合法 JSON 原文，原样交给前端解析
    Valid(String),
}

/// 读取 JSON 文件并把三态原样返回给调用方。
///
/// 原文直传（而不是在 Rust 侧反序列化成固定结构）是刻意的：
/// 用户数据的字段结构由 TS 侧 `types.ts` 定义，Rust 只当"带原子性的文本仓库"，
/// 这样加字段不需要两侧同步改结构体，也不会因为 Rust 结构体过严而丢掉用户的旧数据。
///
/// # Errors
/// 读取时发生非「不存在」类 IO 错误
pub fn read_json_text(path: &Path) -> Result<JsonTextRead, AppError> {
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(JsonTextRead::Missing)
        }
        Err(error) => {
            return Err(AppError::userdata_write_failed(format!(
                "读取失败 {}: {error}",
                path.display()
            )))
        }
    };

    // 不是 UTF-8 与「不是 JSON」在恢复策略上等价：都当损坏处理
    let text = match String::from_utf8(bytes) {
        Ok(text) => text,
        Err(error) => {
            let backup = backup_corrupt(path);
            eprintln!(
                "[atomic] {} 不是合法 UTF-8（{error}），已备份={:?}",
                path.display(),
                backup
            );
            return Ok(JsonTextRead::Corrupt { backup });
        }
    };

    match serde_json::from_str::<serde_json::Value>(&text) {
        Ok(_) => Ok(JsonTextRead::Valid(text)),
        Err(error) => {
            let backup = backup_corrupt(path);
            eprintln!(
                "[atomic] {} 内容损坏（{error}），已备份={:?}",
                path.display(),
                backup
            );
            Ok(JsonTextRead::Corrupt { backup })
        }
    }
}
