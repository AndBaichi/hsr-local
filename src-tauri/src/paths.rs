//! 路径解析（架构文档 §8.10 paths.rs）
//!
//! 四类目录，物理隔离（架构文档 §1.2 ④）：
//!  - `$RESOURCE/datapack`    内置数据包（随安装包分发，只读）
//!  - `$APPDATA/packs`        用户导入的数据包（可切换、可回滚）
//!  - `$APPDATA/userdata`     收藏 / 笔记 / 偏好 / 最近浏览（导入与回滚**永不触碰**）
//!  - `$APPDATA/packs/{id}.tmp` 导入过程中的临时目录

use std::fs;
use std::path::PathBuf;

use tauri::{AppHandle, Manager, Runtime};

use crate::error::AppError;

/// 应用数据根目录（`%APPDATA%\com.hsr.local.databank`）
pub fn appdata_root<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, AppError> {
    app.path()
        .app_data_dir()
        .map_err(|error| AppError::internal(format!("无法解析应用数据目录: {error}")))
}

/// 用户数据目录（与数据包目录不同父目录，保证隔离）
pub fn userdata_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, AppError> {
    Ok(appdata_root(app)?.join("userdata"))
}

/// 用户导入的数据包根目录
pub fn packs_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, AppError> {
    Ok(appdata_root(app)?.join("packs"))
}

/// 导入过程中的临时目录（`packs/{packId}.tmp`）
pub fn pack_staging_dir<R: Runtime>(app: &AppHandle<R>, pack_id: &str) -> Result<PathBuf, AppError> {
    Ok(packs_dir(app)?.join(format!("{pack_id}.tmp")))
}

/// 单个已安装数据包目录（`packs/{packId}`）
pub fn pack_dir<R: Runtime>(app: &AppHandle<R>, pack_id: &str) -> Result<PathBuf, AppError> {
    Ok(packs_dir(app)?.join(pack_id))
}

/// 记录当前生效数据包的指针文件（`$APPDATA/active.json`）
pub fn active_pointer_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, AppError> {
    Ok(appdata_root(app)?.join("active.json"))
}

/// 内置数据包目录（`$RESOURCE/datapack`）
///
/// dev 模式下 `resource_dir()` 指向 `target/debug`，读不到数据包（附录 B 坑 #10），
/// 因此前端 `locator.ts` 在 DEV 下走 Vite 的 `/datapack`，不依赖本函数。
pub fn resource_datapack_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, AppError> {
    let resource = app
        .path()
        .resource_dir()
        .map_err(|error| AppError::internal(format!("无法解析资源目录: {error}")))?;
    Ok(resource.join("datapack"))
}

/// 确保一个目录存在（不存在则递归创建）
pub fn ensure_dir(path: &PathBuf) -> Result<(), AppError> {
    if path.exists() {
        if path.is_dir() {
            return Ok(());
        }
        return Err(AppError::internal(format!("路径已存在但不是目录: {}", path.display())));
    }
    fs::create_dir_all(path)
        .map_err(|error| AppError::internal(format!("创建目录失败 {}: {error}", path.display())))
}

/// 启动时确保全部可变目录就绪。
///
/// 只创建 `packs/` 与 `userdata/`；`$RESOURCE/datapack` 是只读资源，不创建。
///
/// # Errors
/// 目录无法创建时返回 `AppError::Internal`
pub fn ensure_app_dirs<R: Runtime>(app: &AppHandle<R>) -> Result<(), AppError> {
    ensure_dir(&packs_dir(app)?)?;
    ensure_dir(&userdata_dir(app)?)?;
    Ok(())
}
