//! 客户端数据包更新（v4.8）
//!
//! 流程：拿 `update.json` → 下载 `.hsrpack` 到 `$APPDATA/update/` → 校验字节数 +
//! sha256 → 解包到 `packs/.staging-*` → 读 `meta.json` 校验 → 改名成成品目录 →
//! 备份当前 `active.json` 到 `previous.json` → 原子写新指针 → 刷新内存状态与索引缓存。
//!
//! 安全边界：
//!  - 只允许 HTTPS，且主机名必须在白名单（GitHub / GitHub 的 release CDN）；
//!  - 必须提供 sha256 与字节数，缺一不下载；
//!  - 解包路径仍走 `pack::sanitize_entry_path`（防 zip-slip）；
//!  - 只替换数据，不执行任何远程代码。
//!
//! 失败处理：任何一步失败都**不碰** `active.json`，继续用旧包；下载临时文件会清掉。
//!
//! 回滚：`datapack_rollback` 把 `previous.json` 写回 `active.json`，并清掉 previous。

use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager};

use crate::atomic::write_json_atomic;
use crate::datapack::IndexCache;
use crate::error::{AppError, ErrorCode};
use crate::pack::{self, PackPointer, PackState, SUPPORTED_SCHEMA_VERSION};
use crate::paths;

/// 允许下载的主机（含 reqwest 跟随重定向后的最终主机）
const ALLOWED_HOSTS: &[&str] = &[
    "github.com",
    "objects.githubusercontent.com",
    "release-assets.githubusercontent.com",
    "github-releases.githubusercontent.com",
];

/// manifest 体积上限（update.json 只有 1KB 级）
const MAX_MANIFEST_BYTES: u64 = 256 * 1024;

/// 下载进度事件名（前端 `listen` 同一个字符串）
const PROGRESS_EVENT: &str = "hsr://update-progress";

/// 单次安装的结果（前端据此提示游戏版本）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallResult {
    /// 数据包 id
    pub pack_id: String,
    /// 游戏数据版本
    pub game_version: String,
    /// 结构版本
    pub schema_version: u32,
    /// 成品目录
    pub root: String,
    /// 来源：`update` / `manual`
    pub source: String,
    /// 安装时间（Unix 秒）
    pub installed_at: u64,
}

/// 进度事件载荷
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateProgress {
    /// `download` / `extract`
    phase: &'static str,
    /// 已完成
    downloaded: u64,
    /// 总量（未知时为 0）
    total: u64,
}

/// 当前 Unix 秒
fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

/// 把 reqwest 的错误链拼进 detail（顶层 `error sending request` 太笼统）
fn http_error_detail(error: &reqwest::Error) -> String {
    let mut detail = error.to_string();
    let mut source = std::error::Error::source(error);
    while let Some(cause) = source {
        detail.push_str(" / ");
        detail.push_str(&cause.to_string());
        source = cause.source();
    }
    detail
}

/// 构造 HTTP 客户端（带超时与有限重定向）
fn http_client(timeout: Duration) -> Result<reqwest::blocking::Client, AppError> {
    reqwest::blocking::Client::builder()
        .timeout(timeout)
        .connect_timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::limited(6))
        .user_agent("HSRLocal/4.8 (+datapack update)")
        .build()
        .map_err(|error| AppError::new(ErrorCode::IoFailed, "初始化 HTTP 客户端失败").with_detail(error.to_string()))
}

/// URL 是否允许访问
fn ensure_allowed_url(url: &reqwest::Url) -> Result<(), AppError> {
    if url.scheme() != "https" {
        return Err(AppError::new(ErrorCode::UpdateCheckFailed, "更新地址必须是 HTTPS").with_detail(url.to_string()));
    }
    let host = url.host_str().unwrap_or("");
    let allowed = ALLOWED_HOSTS
        .iter()
        .any(|candidate| host == *candidate || host.ends_with(&format!(".{candidate}")));
    if !allowed {
        return Err(AppError::new(ErrorCode::UpdateCheckFailed, "更新地址不在允许的域名内").with_detail(host.to_string()));
    }
    Ok(())
}

/// 拉取 update.json（只读、限长；域名白名单与下载共用）
///
/// # Errors
/// URL 非法/不允许、网络失败、HTTP 非 2xx、响应超长
fn fetch_manifest_blocking(url: String) -> Result<String, AppError> {
    let parsed = reqwest::Url::parse(&url)
        .map_err(|error| AppError::new(ErrorCode::UpdateCheckFailed, "更新地址格式不合法").with_detail(error.to_string()))?;
    ensure_allowed_url(&parsed)?;

    let client = http_client(Duration::from_secs(30))?;
    let mut response = client
        .get(parsed)
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .map_err(|error| AppError::new(ErrorCode::UpdateCheckFailed, "检查更新失败（网络）").with_detail(http_error_detail(&error)))?;

    ensure_allowed_url(response.url())?;
    if !response.status().is_success() {
        return Err(AppError::new(
            ErrorCode::UpdateCheckFailed,
            format!("检查更新失败：HTTP {}", response.status()),
        ));
    }
    if response.content_length().unwrap_or(0) > MAX_MANIFEST_BYTES {
        return Err(AppError::new(ErrorCode::UpdateCheckFailed, "update.json 体积异常"));
    }

    let mut text = String::new();
    response
        .by_ref()
        .take(MAX_MANIFEST_BYTES + 1)
        .read_to_string(&mut text)
        .map_err(|error| AppError::new(ErrorCode::UpdateCheckFailed, "读取 update.json 失败").with_detail(error.to_string()))?;
    if text.len() as u64 > MAX_MANIFEST_BYTES {
        return Err(AppError::new(ErrorCode::UpdateCheckFailed, "update.json 体积异常"));
    }
    Ok(text)
}

/// 下载 `.hsrpack` 并校验字节数与 sha256。
fn download_archive(
    app: &AppHandle,
    url: &str,
    dest: &Path,
    expected_bytes: u64,
    expected_sha256: &str,
) -> Result<(), AppError> {
    let parsed = reqwest::Url::parse(url)
        .map_err(|error| AppError::new(ErrorCode::UpdateCheckFailed, "下载地址格式不合法").with_detail(error.to_string()))?;
    ensure_allowed_url(&parsed)?;

    let client = http_client(Duration::from_secs(30 * 60))?;
    let mut response = client
        .get(parsed)
        .send()
        .map_err(|error| AppError::new(ErrorCode::IoFailed, "下载数据包失败（网络）").with_detail(http_error_detail(&error)))?;
    ensure_allowed_url(response.url())?;
    if !response.status().is_success() {
        return Err(AppError::new(ErrorCode::IoFailed, format!("下载数据包失败：HTTP {}", response.status())));
    }

    let total = response.content_length().unwrap_or(expected_bytes);
    let mut file = fs::File::create(dest)
        .map_err(|error| AppError::new(ErrorCode::IoFailed, "创建下载临时文件失败").with_detail(error.to_string()))?;
    let mut hasher = Sha256::new();
    let mut downloaded = 0u64;
    let mut last_emit = 0u64;
    let mut buffer = [0u8; 256 * 1024];

    loop {
        let read = response
            .read(&mut buffer)
            .map_err(|error| AppError::new(ErrorCode::IoFailed, "读取下载数据失败").with_detail(error.to_string()))?;
        if read == 0 {
            break;
        }
        file.write_all(&buffer[..read])
            .map_err(|error| AppError::new(ErrorCode::IoFailed, "写入下载文件失败").with_detail(error.to_string()))?;
        hasher.update(&buffer[..read]);
        downloaded += read as u64;
        if downloaded - last_emit >= 1024 * 1024 {
            last_emit = downloaded;
            let _ = app.emit(
                PROGRESS_EVENT,
                UpdateProgress {
                    phase: "download",
                    downloaded,
                    total,
                },
            );
        }
    }
    file.flush()
        .map_err(|error| AppError::new(ErrorCode::IoFailed, "刷新下载文件失败").with_detail(error.to_string()))?;
    drop(file);

    let _ = app.emit(
        PROGRESS_EVENT,
        UpdateProgress {
            phase: "download",
            downloaded,
            total,
        },
    );

    if expected_bytes > 0 && downloaded != expected_bytes {
        return Err(AppError::new(
            ErrorCode::IoFailed,
            format!("下载大小不符：期望 {expected_bytes}，实际 {downloaded}"),
        ));
    }
    let digest = format!("{:x}", hasher.finalize());
    if digest != expected_sha256.trim().to_ascii_lowercase() {
        return Err(AppError::new(ErrorCode::IoFailed, "数据包 sha256 校验失败").with_detail(format!(
            "期望 {}，实际 {digest}",
            expected_sha256.trim()
        )));
    }
    Ok(())
}

/// 把已下载/用户选择的 `.hsrpack` 安装为当前数据包。
///
/// 这是更新与手动导入共用的核心：解包 staging → 校验 meta → 改名成品 →
/// 备份旧指针 → 原子写新指针 → 刷新状态。
fn install_archive(app: &AppHandle, archive: &Path, source: &str) -> Result<InstallResult, AppError> {
    let meta = pack::read_archive_meta(archive)?;
    if meta.schema_version != SUPPORTED_SCHEMA_VERSION {
        return Err(AppError::new(
            ErrorCode::PackIncompatibleSchema,
            format!(
                "数据包结构版本不兼容：{}（应用支持 {SUPPORTED_SCHEMA_VERSION}）",
                meta.schema_version
            ),
        ));
    }
    if meta.pack_id.is_empty()
        || meta.pack_id.len() > 80
        || !meta
            .pack_id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' || ch == '.')
        || meta.pack_id.starts_with('.')
    {
        return Err(AppError::new(ErrorCode::PackCorrupt, "数据包 id 不合法").with_detail(meta.pack_id));
    }

    let packs_dir = paths::packs_dir(app)?;
    paths::ensure_dir(&packs_dir)?;
    let stamp = now_secs();
    let staging = packs_dir.join(format!(".staging-{stamp}"));
    if staging.exists() {
        fs::remove_dir_all(&staging)
            .map_err(|error| AppError::pack_extract_failed(staging.display(), &error))?;
    }

    let result = (|| -> Result<InstallResult, AppError> {
        let _ = app.emit(
            PROGRESS_EVENT,
            UpdateProgress {
                phase: "extract",
                downloaded: 0,
                total: 0,
            },
        );
        let written = pack::extract_archive(archive, &staging, |done, total| {
            let _ = app.emit(
                PROGRESS_EVENT,
                UpdateProgress {
                    phase: "extract",
                    downloaded: done as u64,
                    total: total as u64,
                },
            );
        })?;

        let staged_meta = pack::read_meta(&staging)?;
        if staged_meta.pack_id != meta.pack_id || staged_meta.schema_version != meta.schema_version {
            return Err(AppError::new(ErrorCode::PackCorrupt, "解包后的 meta.json 与压缩包不一致"));
        }

        let dir_name = format!("{}-{}", meta.pack_id, stamp);
        let final_dir = packs_dir.join(&dir_name);
        if final_dir.exists() {
            fs::remove_dir_all(&final_dir)
                .map_err(|error| AppError::pack_extract_failed(final_dir.display(), &error))?;
        }
        fs::rename(&staging, &final_dir)
            .map_err(|error| AppError::pack_extract_failed(final_dir.display(), &error))?;

        // 只有「当前指针有效」时才备份，避免把坏指针当成回滚目标
        if let Ok(current) = pack::active_pointer(app) {
            let _ = write_json_atomic(&paths::previous_pointer_path(app)?, &current);
        }

        let archive_bytes = fs::metadata(archive)
            .map(|metadata| metadata.len())
            .unwrap_or(0);
        let pointer = PackPointer {
            pack_id: staged_meta.pack_id,
            root: final_dir.display().to_string(),
            game_version: staged_meta.game_version,
            schema_version: staged_meta.schema_version,
            installed_at: now_secs(),
            archive_bytes,
            entry_count: written as u64,
            source: source.to_string(),
        };
        write_json_atomic(&paths::active_pointer_path(app)?, &pointer)?;

        app.state::<PackState>().activate(&pointer);
        app.state::<IndexCache>().clear();

        Ok(InstallResult {
            pack_id: pointer.pack_id,
            game_version: pointer.game_version,
            schema_version: pointer.schema_version,
            root: pointer.root,
            source: pointer.source,
            installed_at: pointer.installed_at,
        })
    })();

    if result.is_err() && staging.exists() {
        let _ = fs::remove_dir_all(&staging);
    }
    result
}

/// 从 URL 下载并安装（客户端自动更新的主路径）。
///
/// # Errors
/// 下载/校验/解包/切换任一步失败
#[allow(clippy::too_many_arguments)]
fn install_from_url_blocking(
    app: AppHandle,
    url: String,
    sha256: String,
    bytes: u64,
) -> Result<InstallResult, AppError> {
    if sha256.trim().len() != 64 {
        return Err(AppError::new(ErrorCode::IoFailed, "sha256 格式不合法"));
    }
    let dir = paths::update_dir(&app)?;
    paths::ensure_dir(&dir)?;
    let temp = dir.join(format!("download-{}.hsrpack", now_secs()));

    let downloaded = download_archive(&app, &url, &temp, bytes, &sha256);
    if let Err(error) = downloaded {
        let _ = fs::remove_file(&temp);
        return Err(error);
    }

    let result = install_archive(&app, &temp, "update");
    let _ = fs::remove_file(&temp);
    result
}

/// 从用户选择的本地 `.hsrpack` 安装（手动导入）。
///
/// # Errors
/// 文件不存在、不是合法包、解包/切换失败
fn install_file_blocking(app: AppHandle, path: String) -> Result<InstallResult, AppError> {
    let archive = PathBuf::from(&path);
    if !archive.is_file() {
        return Err(AppError::new(ErrorCode::IoFailed, "找不到数据包文件").with_detail(path));
    }
    install_archive(&app, &archive, "manual")
}

/// 回滚到 `previous.json` 指向的上一版。
///
/// # Errors
/// 没有上一版、上一版目录/meta 已损坏
fn rollback_blocking(app: AppHandle) -> Result<InstallResult, AppError> {
    let previous_path = paths::previous_pointer_path(&app)?;
    let raw = fs::read_to_string(&previous_path)
        .map_err(|error| AppError::new(ErrorCode::IoFailed, "没有可回滚的上一版").with_detail(error.to_string()))?;
    let pointer: PackPointer = serde_json::from_str(&raw)
        .map_err(|error| AppError::new(ErrorCode::PackCorrupt, "上一版指针损坏").with_detail(error.to_string()))?;

    let meta = pack::read_meta(Path::new(&pointer.root))?;
    if meta.pack_id != pointer.pack_id || meta.schema_version != SUPPORTED_SCHEMA_VERSION {
        return Err(AppError::new(ErrorCode::PackCorrupt, "上一版数据包已损坏，无法回滚"));
    }

    write_json_atomic(&paths::active_pointer_path(&app)?, &pointer)?;
    let _ = fs::remove_file(&previous_path);

    app.state::<PackState>().activate(&pointer);
    app.state::<IndexCache>().clear();

    Ok(InstallResult {
        pack_id: pointer.pack_id,
        game_version: pointer.game_version,
        schema_version: pointer.schema_version,
        root: pointer.root,
        source: pointer.source,
        installed_at: pointer.installed_at,
    })
}

/// 拉取 update.json（异步命令，网络请求放到阻塞线程池，避免卡 UI）。
#[tauri::command]
pub async fn update_fetch_manifest(url: String) -> Result<String, AppError> {
    tauri::async_runtime::spawn_blocking(move || fetch_manifest_blocking(url))
        .await
        .map_err(|error| AppError::new(ErrorCode::UpdateCheckFailed, "检查更新线程失败").with_detail(error.to_string()))?
}

/// 从 URL 下载并安装（异步命令）。
#[tauri::command]
pub async fn datapack_install_from_url(
    app: AppHandle,
    url: String,
    sha256: String,
    bytes: u64,
) -> Result<InstallResult, AppError> {
    tauri::async_runtime::spawn_blocking(move || install_from_url_blocking(app, url, sha256, bytes))
        .await
        .map_err(|error| AppError::new(ErrorCode::IoFailed, "更新线程失败").with_detail(error.to_string()))?
}

/// 从本地 `.hsrpack` 安装（异步命令）。
#[tauri::command]
pub async fn datapack_install_file(app: AppHandle, path: String) -> Result<InstallResult, AppError> {
    tauri::async_runtime::spawn_blocking(move || install_file_blocking(app, path))
        .await
        .map_err(|error| AppError::new(ErrorCode::IoFailed, "安装线程失败").with_detail(error.to_string()))?
}

/// 回滚上一版（异步命令）。
#[tauri::command]
pub async fn datapack_rollback(app: AppHandle) -> Result<InstallResult, AppError> {
    tauri::async_runtime::spawn_blocking(move || rollback_blocking(app))
        .await
        .map_err(|error| AppError::new(ErrorCode::IoFailed, "回滚线程失败").with_detail(error.to_string()))?
}

/// 是否存在可回滚的上一版（设置页用来决定按钮是否可用）。
#[tauri::command]
pub fn datapack_has_previous(app: AppHandle) -> bool {
    paths::previous_pointer_path(&app)
        .map(|path| path.is_file())
        .unwrap_or(false)
}