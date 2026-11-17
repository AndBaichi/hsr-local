//! 数据访问层（架构文档 §5.2 的 Rust 侧，T03）
//!
//! ## 边界：Rust 只做「读文件 + 校验 + 一次性打包」，不做业务语义
//!
//! 前端 `DataAccessLayer`（`src/lib/data/dal.ts`）需要的能力只有三种：
//!
//! | 能力 | 走哪条路 | 为什么 |
//! |---|---|---|
//! | 6 个模块索引 | `datapack_index()` 一次返回 | 合计 ~700KB，一次 IPC + 一次 `JSON.parse`，比 6 次往返快得多，且错误处理只写一遍 |
//! | 详情 / 成就条目 | `read_json(rel)` | **不走 asset 协议**：asset 协议把 `ENOENT` 变成 HTTP 404，前端只能拿到 `Failed to fetch`，拿不到我们的 `PACK_FILE_MISSING` |
//! | 图片 | asset 协议（前端 `convertFileSrc`） | 二进制、要流式与浏览器缓存，asset 协议正合适 |
//!
//! ## 路径安全
//!
//! `read_json` 的 `rel` **必须**复用 `pack::sanitize_entry_path`（zip-slip 那套校验），
//! 不能在 JSON 通道上另开一个口子。这里额外把错误码从 `PACK_EXTRACT_FAILED`
//! 改写成 `PACK_INVALID_PATH`：解包阶段这个词是准的，读取阶段不是。
//!
//! ## 缓存
//!
//! 索引按 `root` 缓存一份。换了数据包（T05 的导入）`root` 会变，缓存自然失效，
//! 不需要额外的失效通知——缓存键就是「哪个包」。

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, State};

use crate::error::AppError;
use crate::pack::{self, PackCounts};

/// 物品索引的分片数（必须与 `pack::ITEM_SHARD_COUNT` 一致）
const ITEM_SHARDS: usize = pack::ITEM_SHARD_COUNT;

/// 除物品外，索引里每个模块对应的文件（物品要合并 16 个分片，单独处理）
const MODULE_INDEX_FILES: [&str; 5] = [
    "db/character.json",
    "db/lightcone.json",
    "db/relicset.json",
    "db/monster.json",
    "db/achievement.json",
];

/// 6 个模块索引的打包结果（一次 IPC 传给前端）
///
/// 字段直接给「数组」，前端拿到即可建 MiniSearch 索引，不需要再拆包。
#[derive(Debug, Clone, Serialize)]
pub struct IndexBundle {
    /// 数据包 id
    #[serde(rename = "packId")]
    pub pack_id: String,
    /// 游戏数据版本
    #[serde(rename = "gameVersion")]
    pub game_version: String,
    /// 数据结构版本
    #[serde(rename = "schemaVersion")]
    pub schema_version: u32,
    /// `meta.json` 声明的计数（前端可据此核对是否少读）
    pub counts: PackCounts,
    /// 角色 brief（`db/character.json`，数组，101 条）
    pub characters: Vec<Value>,
    /// 光锥 brief（174 条）
    pub lightcones: Vec<Value>,
    /// 遗器套装 brief（64 条）
    pub relicsets: Vec<Value>,
    /// 敌人 brief（666 条）
    pub monsters: Vec<Value>,
    /// 物品 brief（16 个分片合并，1606 条）
    pub items: Vec<Value>,
    /// 成就系列 brief（9 条；成就**条目**按语言单独读，见 `read_json`）
    #[serde(rename = "achievementSeries")]
    pub achievement_series: Vec<Value>,
}

impl IndexBundle {
    /// 各模块条数，供日志与断言使用。
    pub fn counts_of_modules(&self) -> [(&'static str, usize); 6] {
        [
            ("character", self.characters.len()),
            ("lightcone", self.lightcones.len()),
            ("relicset", self.relicsets.len()),
            ("monster", self.monsters.len()),
            ("item", self.items.len()),
            ("achievementSeries", self.achievement_series.len()),
        ]
    }
}

/// 索引缓存：`(root, 包)`。`root` 变了就重读，等于以「哪个包」作为缓存键。
#[derive(Default)]
pub struct IndexCache(Mutex<Option<(String, IndexBundle)>>);

impl std::fmt::Debug for IndexCache {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let hit = self
            .0
            .lock()
            .map(|slot| slot.as_ref().map(|(root, _)| root.clone()))
            .unwrap_or(None);
        f.debug_struct("IndexCache").field("cached_root", &hit).finish()
    }
}

impl IndexCache {
    /// 取缓存（root 匹配才算命中）。
    ///
    /// `pub(crate)` 是给 `selftest` 用的：它要断言「换 root 即失效」这个机制本身，
    /// 而不是绕过缓存去测 `read_index_at`。对外仍只有三个 command。
    pub(crate) fn get(&self, root: &str) -> Option<IndexBundle> {
        let guard = self.0.lock().ok()?;
        match guard.as_ref() {
            Some((cached_root, bundle)) if cached_root == root => Some(bundle.clone()),
            _ => None,
        }
    }

    /// 写入缓存；锁中毒时静默跳过（缓存不是正确性的一部分）
    pub(crate) fn put(&self, root: &str, bundle: &IndexBundle) {
        if let Ok(mut guard) = self.0.lock() {
            *guard = Some((root.to_string(), bundle.clone()));
        }
    }

    /// 清空缓存（换包 / 排障用）
    pub fn clear(&self) {
        if let Ok(mut guard) = self.0.lock() {
            *guard = None;
        }
    }
}

// ---------------------------------------------------------------------------
// 纯函数层（不依赖 Tauri，可被 `selftest` 直接调用）
// ---------------------------------------------------------------------------

/// 把数据包内的相对路径解析成绝对路径，并做安全校验。
///
/// # Errors
/// `rel` 为空 / 含 `..` / 绝对路径 / 带盘符时返回 `PACK_INVALID_PATH`
pub fn resolve_inside(root: &Path, rel: &str) -> Result<PathBuf, AppError> {
    let clean = pack::sanitize_entry_path(rel).map_err(|error| {
        // 保留底层的 detail（哪一段越界了），但错误码换成读取语义
        let mut mapped = AppError::pack_invalid_path(rel);
        mapped.detail = error.detail.or(Some(error.message));
        mapped
    })?;
    Ok(root.join(clean))
}

/// 读一个数据包内的 JSON 文件。
///
/// # Errors
/// 路径非法 → `PACK_INVALID_PATH`；文件不存在 → `PACK_FILE_MISSING`；
/// 其它 IO 错误 → `IO_FAILED`；内容不是合法 JSON → `PACK_CORRUPT`
pub fn read_json_at(root: &Path, rel: &str) -> Result<Value, AppError> {
    let path = resolve_inside(root, rel)?;
    let bytes = match fs::read(&path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Err(AppError::pack_file_missing(rel));
        }
        Err(error) => {
            return Err(AppError::from(error).with_detail(format!("rel={rel}")));
        }
    };

    serde_json::from_slice(&bytes).map_err(|error| {
        AppError::pack_corrupt(format!("{rel} 不是合法 JSON: {error}"))
    })
}

/// 读一个索引文件，要求顶层是数组；对象容器则取其所有 value（兼容两种形态）。
fn read_index_file(root: &Path, rel: &str) -> Result<Vec<Value>, AppError> {
    let value = read_json_at(root, rel)?;
    Ok(match value {
        Value::Array(items) => items,
        // 兼容「id -> brief」的映射形态：索引语义是「一组 brief」，容器形态不该泄漏给前端
        Value::Object(map) => map.into_values().collect(),
        other => {
            return Err(AppError::pack_corrupt(format!(
                "{rel} 顶层应为数组或对象，实际是 {}",
                type_name(&other)
            )));
        }
    })
}

/// 给日志/错误用的 JSON 类型名
fn type_name(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "bool",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}

/// 一次性读出 6 个模块索引。
///
/// # Errors
/// 任一索引文件缺失、非法 JSON、顶层形状不对
pub fn read_index_at(root: &Path) -> Result<IndexBundle, AppError> {
    let meta = pack::read_meta(root)?;

    let characters = read_index_file(root, MODULE_INDEX_FILES[0])?;
    let lightcones = read_index_file(root, MODULE_INDEX_FILES[1])?;
    let relicsets = read_index_file(root, MODULE_INDEX_FILES[2])?;
    let monsters = read_index_file(root, MODULE_INDEX_FILES[3])?;
    let achievement_series = read_index_file(root, MODULE_INDEX_FILES[4])?;

    // 物品按 16 分片存放，合并成一个数组给前端。
    // 分片缺失 = 数据包不完整，直接报错而不是静默少一批物品。
    let mut items: Vec<Value> = Vec::with_capacity(pack::EXPECTED_COUNTS.item as usize);
    for shard in 0..ITEM_SHARDS {
        let rel = format!("db/item/{shard}.json");
        items.extend(read_index_file(root, &rel)?);
    }

    Ok(IndexBundle {
        pack_id: meta.pack_id,
        game_version: meta.game_version,
        schema_version: meta.schema_version,
        counts: meta.counts,
        characters,
        lightcones,
        relicsets,
        monsters,
        items,
        achievement_series,
    })
}

// ---------------------------------------------------------------------------
// Tauri 命令
// ---------------------------------------------------------------------------

/// 读数据包内的一个 JSON 文件（详情页、成就条目走这里）。
///
/// 返回已解析的 JSON 值：前端 `invoke` 直接拿到对象，
/// 不需要再 `JSON.parse` 一次（也避免把 387KB 的字符串转义两遍）。
///
/// # Errors
/// 见 [`read_json_at`]
#[tauri::command]
pub fn read_json(app: AppHandle, rel: String) -> Result<Value, AppError> {
    let root = pack::active_datapack_root(&app)?;
    read_json_at(&root, &rel)
}

/// 一次返回 6 个模块索引（前端启动时只调一次）。
///
/// # Errors
/// 数据包未就绪 → `PACK_NOT_FOUND`；索引缺失/损坏 → 见 [`read_index_at`]
#[tauri::command]
pub fn datapack_index(
    app: AppHandle,
    cache: State<'_, IndexCache>,
) -> Result<IndexBundle, AppError> {
    let root = pack::active_datapack_root(&app)?;
    let root_key = root.display().to_string();

    if let Some(bundle) = cache.get(&root_key) {
        return Ok(bundle);
    }

    let bundle = read_index_at(&root)?;
    cache.put(&root_key, &bundle);

    // 启动日志：这一行是「前端确实拿到索引」的证据。
    // 前端 `dal.boot()` 之后 UI 才有数据，而 WebView 里的日志看不到，
    // 所以把条数打在 Rust 侧——启动时它一定只出现一次。
    let counts = bundle.counts_of_modules();
    eprintln!(
        "[hsr] 索引就绪：{}",
        counts
            .iter()
            .map(|(name, len)| format!("{name}={len}"))
            .collect::<Vec<_>>()
            .join(" / ")
    );

    Ok(bundle)
}

/// 清空索引缓存（T05 导入/回滚数据包后调用）。
///
/// # Errors
/// 不会失败；保留 `Result` 是为了和其它 command 形状一致、便于将来加校验
#[tauri::command]
pub fn datapack_index_invalidate(cache: State<'_, IndexCache>) -> Result<(), AppError> {
    cache.clear();
    Ok(())
}
