//! 内置数据包（`.hsrpack`）的首次展开与「当前生效数据包」指针管理。
//!
//! 为什么不是把 5460 个文件直接塞进安装包（架构文档 附录 B / §1.2 ④）：
//!  - Windows 上 5k 个小文件的安装与首启 IO 极差（杀毒软件逐个扫）；
//!  - 单个 63MB 的 zip 打包快、校验快、可整体替换。
//!
//! 因此 `.hsrpack` 作为 Tauri `bundle.resources` 随安装包分发，**首次启动**时
//! 流式解包到 `$APPDATA/packs/{packId}/`，然后写 `$APPDATA/active.json` 指针。
//! 之后每次启动只读指针 + `stat` 一次 `meta.json`，耗时可忽略。
//!
//! 目录约定（与 [`crate::paths`] 一致）：
//!  - `$RESOURCE/hsr-local-4.7.51.hsrpack`  只读的压缩包
//!  - `$APPDATA/packs/{packId}.tmp/`        解包中的临时目录
//!  - `$APPDATA/packs/{packId}/`            解包完成的成品目录
//!  - `$APPDATA/active.json`                当前生效数据包指针
//!
//! 解包是**目录级原子**的：先写 `.tmp`，校验 `meta.json` 通过后再整体 `rename`，
//! 中途被杀只会留下 `.tmp`（下次启动先清掉），不会出现「解了一半的成品目录」。

use std::fs;
use std::io::{BufReader, Read};
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime};

use crate::atomic::{read_json_or_default, write_json_atomic};
use crate::dpi::DpiAwareness;
use crate::error::AppError;
use crate::paths;

/// 内置数据包的稳定 id（与 `data/datapack/meta.json` 的 `packId` 一致）
pub const BUILTIN_PACK_ID: &str = env!("HSR_BUILTIN_PACK_ID");

/// 内置数据包文件名（与 `src-tauri/tauri.conf.json` 的 `bundle.resources` 一致）
pub const BUILTIN_PACK_FILE: &str = "hsr-local-builtin.hsrpack";

/// 应用能读的 `meta.schemaVersion`
///
/// 数据结构变了就 +1，老数据包会被拒绝并要求升级（而不是崩在某个字段上）。
pub const SUPPORTED_SCHEMA_VERSION: u32 = 1;

/// 物品索引的分片数（`db/item/{0..15}.json`，按 `Number(id) % 16` 分片）
pub const ITEM_SHARD_COUNT: usize = 16;

/// `$APPDATA/active.json` 的内容
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PackPointer {
    /// 数据包 id，如 `hsr-4.7.51-local`
    #[serde(rename = "packId")]
    pub pack_id: String,
    /// 数据包目录的绝对路径
    pub root: String,
    /// 游戏数据版本，如 `4.7.51`
    #[serde(rename = "gameVersion")]
    pub game_version: String,
    /// 数据结构版本
    #[serde(rename = "schemaVersion")]
    pub schema_version: u32,
    /// 安装时间（Unix 秒）
    #[serde(rename = "installedAt")]
    pub installed_at: u64,
    /// 展开时那份 `.hsrpack` 的字节数（内容指纹的一半，见 [`pointer_matches_archive`]）
    ///
    /// 老版本写的指针没有这个字段（反序列化成 0），会被判为「指纹未知」并重新展开一次 ——
    /// 这正是升级路径需要的行为：新安装包换了数据包内容，但 `packId` 与游戏版本没变。
    #[serde(rename = "archiveBytes", default)]
    pub archive_bytes: u64,
    /// 展开时那份 `.hsrpack` 的条目数（内容指纹的另一半）
    #[serde(rename = "entryCount", default)]
    pub entry_count: u64,
    /// 来源：`builtin`（安装包自带展开）/ `update`（客户端下载或手动导入）
    ///
    /// 老指针没有这个字段（空串）。启动时据此决定要不要用内置压缩包重新展开：
    /// `update` 的包不能因为内置包是旧版就被覆盖。
    #[serde(default, rename = "source")]
    pub source: String,
}

impl Default for PackPointer {
    fn default() -> Self {
        Self {
            pack_id: String::new(),
            root: String::new(),
            game_version: String::new(),
            schema_version: 0,
            installed_at: 0,
            archive_bytes: 0,
            entry_count: 0,
            source: String::new(),
        }
    }
}

/// `meta.json` 里我们关心的字段（其余字段前端自己读）
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
///
/// 字段对 `selftest` 可见（`pub(crate)`）：断言要检查 `packId`/`gameVersion`/`schemaVersion`
/// 是否被正确解析，但它们不该成为对外 API —— 前端直接读 `db/` 下的 JSON，不经过这里。
pub(crate) struct PackMeta {
    #[serde(rename = "packId")]
    pub(crate) pack_id: String,
    #[serde(rename = "gameVersion")]
    pub(crate) game_version: String,
    #[serde(rename = "schemaVersion")]
    pub(crate) schema_version: u32,
    /// 各实体计数：用来确认"解出来的东西是完整的那一版"，而不是只有形状对的残包
    pub(crate) counts: PackCounts,
}

/// `meta.json` 的 `counts`
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct PackCounts {
    /// 角色数
    pub character: u64,
    /// 光锥数
    pub lightcone: u64,
    /// 遗器套装数
    pub relicset: u64,
    /// 敌人数
    pub monster: u64,
    /// 敌人分组数
    #[serde(rename = "monsterGroups")]
    pub monster_groups: u64,
    /// 物品数
    pub item: u64,
    /// 成就数
    pub achievement: u64,
    /// 成就系列数
    #[serde(rename = "achievementSeries")]
    pub achievement_series: u64,
}

/// 编译期期望的实体计数（对应 4.7.51，与 T02 的 `datapack-report.json` 一致）。
///
/// 不一致说明数据包不是这一版或已损坏 —— 直接拒绝启用，让应用回落到内置包，
/// 而不是带着半套数据跑起来、在某个详情页才崩。
pub(crate) const EXPECTED_COUNTS: PackCounts = PackCounts {
    character: 101,
    lightcone: 174,
    relicset: 64,
    monster: 666,
    monster_groups: 382,
    item: 1606,
    achievement: 2022,
    achievement_series: 9,
};

/// 解包前要求的最小剩余空间。
///
/// 解开是 94 MiB、但写文件时会有一份临时拷贝与文件系统开销，留足余量。
const MIN_FREE_BYTES: u64 = 250 * 1024 * 1024;

/// 检查 `counts` 是否与编译期常量一致，返回第一处不一致的描述。
pub(crate) fn counts_mismatch(actual: &PackCounts) -> Option<String> {
    let pairs: [(&str, u64, u64); 8] = [
        ("character", actual.character, EXPECTED_COUNTS.character),
        ("lightcone", actual.lightcone, EXPECTED_COUNTS.lightcone),
        ("relicset", actual.relicset, EXPECTED_COUNTS.relicset),
        ("monster", actual.monster, EXPECTED_COUNTS.monster),
        (
            "monsterGroups",
            actual.monster_groups,
            EXPECTED_COUNTS.monster_groups,
        ),
        ("item", actual.item, EXPECTED_COUNTS.item),
        ("achievement", actual.achievement, EXPECTED_COUNTS.achievement),
        (
            "achievementSeries",
            actual.achievement_series,
            EXPECTED_COUNTS.achievement_series,
        ),
    ];
    pairs
        .iter()
        .find(|(_, got, want)| got != want)
        .map(|(name, got, want)| format!("counts.{name}={got}，期望 {want}"))
}

/// 数据包准备状态（前端 `BootGuard` 用它决定显示「正在展开数据包」还是进首页）
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum PackStatus {
    /// 已就绪
    Ready {
        /// 数据包 id
        #[serde(rename = "packId")]
        pack_id: String,
        /// 数据包目录
        root: String,
        /// 游戏数据版本
        #[serde(rename = "gameVersion")]
        game_version: String,
        /// 数据结构版本
        #[serde(rename = "schemaVersion")]
        schema_version: u32,
    },
    /// 首次启动，正在展开
    Extracting {
        /// 数据包 id
        #[serde(rename = "packId")]
        pack_id: String,
        /// 已写入的文件数
        files: usize,
        /// 总文件数
        total: usize,
    },
    /// 失败
    Failed {
        /// 稳定错误码
        code: String,
        /// 人可读短句
        message: String,
        /// 技术细节
        #[serde(skip_serializing_if = "Option::is_none")]
        detail: Option<String>,
    },
}

impl Default for PackStatus {
    fn default() -> Self {
        Self::Failed {
            code: "PACK_NOT_FOUND".to_string(),
            message: "数据包尚未就绪".to_string(),
            detail: None,
        }
    }
}

/// 受管状态：包准备进度的唯一真源
#[derive(Default)]
pub struct PackState {
    status: Mutex<PackStatus>,
}

impl PackState {
    /// 读取当前状态快照
    pub fn snapshot(&self) -> PackStatus {
        match self.status.lock() {
            Ok(guard) => guard.clone(),
            // 锁中毒（某线程 panic）时不能连累前端启动：退化成"未就绪"
            Err(_) => PackStatus::default(),
        }
    }

    /// 写入状态
    fn set(&self, status: PackStatus) {
        if let Ok(mut guard) = self.status.lock() {
            *guard = status;
        }
    }

    /// 客户端更新 / 回滚切换指针后，把内存状态同步成新的 `Ready`。
    ///
    /// 前端会紧接着 `location.reload()`；重载后 `pack_status` 读到的就是新包。
    pub fn activate(&self, pointer: &PackPointer) {
        self.set(pointer_to_status(pointer));
    }
}

/// 把指针内容转成 `Ready`
fn pointer_to_status(pointer: &PackPointer) -> PackStatus {
    PackStatus::Ready {
        pack_id: pointer.pack_id.clone(),
        root: pointer.root.clone(),
        game_version: pointer.game_version.clone(),
        schema_version: pointer.schema_version,
    }
}

/// 当前 Unix 秒（失败时返回 0，只用于展示"安装于"）
fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

/// 查询某个路径所在卷的剩余可用字节数（非 Windows 平台返回 `None`，跳过检查）。
#[cfg(windows)]
fn free_bytes_on(path: &Path) -> Option<u64> {
    use std::os::windows::ffi::OsStrExt;

    #[link(name = "kernel32")]
    extern "system" {
        fn GetDiskFreeSpaceExW(
            directory: *const u16,
            free_bytes_available: *mut u64,
            total_bytes: *mut u64,
            total_free_bytes: *mut u64,
        ) -> i32;
    }

    let mut wide: Vec<u16> = path.as_os_str().encode_wide().collect();
    wide.push(0);
    let mut available: u64 = 0;
    let ok = unsafe {
        GetDiskFreeSpaceExW(
            wide.as_ptr(),
            &mut available,
            core::ptr::null_mut(),
            core::ptr::null_mut(),
        )
    };
    if ok == 0 {
        None
    } else {
        Some(available)
    }
}

#[cfg(not(windows))]
fn free_bytes_on(_path: &Path) -> Option<u64> {
    None
}

/// 解包前确认磁盘空间充足。
///
/// 拿不到空间信息时**放行**（宁可让写入自然失败，也不要因为查询失败而拒绝启动）。
fn ensure_free_space(dir: &Path) -> Result<(), AppError> {
    let Some(available) = free_bytes_on(dir) else {
        return Ok(());
    };
    if available < MIN_FREE_BYTES {
        return Err(AppError::new(
            crate::error::ErrorCode::PackExtractFailed,
            "磁盘空间不足，无法展开数据包",
        )
        .with_detail(format!(
            "剩余 {:.0} MB，至少需要 {} MB（目录 {}）",
            available as f64 / 1_048_576.0,
            MIN_FREE_BYTES / 1_048_576,
            dir.display()
        )));
    }
    Ok(())
}

/// 读 `meta.json` 并做 schema / packId 校验
pub(crate) fn read_meta(root: &Path) -> Result<PackMeta, AppError> {
    let meta_path = root.join("meta.json");
    if !meta_path.exists() {
        return Err(AppError::pack_not_found(meta_path.display()));
    }
    let bytes = fs::read(&meta_path)
        .map_err(|error| AppError::pack_corrupt(format!("读取 meta.json 失败: {error}")))?;
    let meta: PackMeta = serde_json::from_slice(&bytes)
        .map_err(|error| AppError::pack_corrupt(format!("meta.json 解析失败: {error}")))?;
    if meta.schema_version != SUPPORTED_SCHEMA_VERSION {
        return Err(AppError::pack_incompatible_schema(
            meta.schema_version,
            SUPPORTED_SCHEMA_VERSION,
        ));
    }
    // 计数校验只对「安装包自带」的 4.7.51 内置包做：外部更新的包计数一定随版本变化，
    // 由 manifest 的 sha256 保证完整性，不能再用编译期常量卡它（否则 4.7.52 装不上）。
    Ok(meta)
}

/// 快速路径：`active.json` 指向的目录仍然有效时直接返回。
fn try_existing_pointer<R: Runtime>(app: &AppHandle<R>) -> Result<PackPointer, AppError> {
    let pointer_path = paths::active_pointer_path(app)?;
    let pointer: PackPointer = read_json_or_default(&pointer_path)?;
    if pointer.pack_id.is_empty() || pointer.root.is_empty() {
        return Err(AppError::pack_not_found(pointer_path.display()));
    }
    let root = PathBuf::from(&pointer.root);
    let meta = read_meta(&root)?;
    if meta.pack_id != pointer.pack_id {
        return Err(AppError::pack_corrupt(format!(
            "指针 packId={} 与 meta.packId={} 不一致",
            pointer.pack_id, meta.pack_id
        )));
    }
    Ok(pointer)
}

/// 取 `.hsrpack` 的内容指纹：`(字节数, zip 条目数)`。
///
/// 只读中央目录（文件尾部几 KB），不解压任何条目 —— 冷启动代价可忽略。
/// 拿不到时返回 `None`，调用方据此**放行**而不是判为失效。
fn archive_shape(archive: &Path) -> Option<(u64, u64)> {
    let bytes = fs::metadata(archive).ok()?.len();
    let file = fs::File::open(archive).ok()?;
    let zip = zip::ZipArchive::new(BufReader::new(file)).ok()?;
    Some((bytes, u64::try_from(zip.len()).ok()?))
}

/// 判断「已展开的目录」是否就是当前安装包里那份数据。
///
/// ## 为什么需要这一步
///
/// 指针校验原本只看 `packId` 与 `meta.json` 是否存在，而 `packId` 是**常量**
/// （`hsr-4.7.51-local`）、`meta.counts` 只统计 6 个模块的条目数。于是出现这样的坑：
/// 新安装包多打了 552 个角色详情文件（模块条目数没变），版本号也没变，
/// 指针校验全过 → 继续复用**旧解包目录** → 前端 `read_json` 拿不到详情文件，
/// 角色详情页一律显示「未找到该角色」。
///
/// 现在用「压缩包字节数 + 条目数」做内容指纹：任何一个变了就重新展开。
///
/// ## 三种返回
///
/// - 拿不到压缩包（绿色版被删、开发态没产物）→ `true`，保持原有行为，不折腾用户；
/// - 指针里指纹为 0（老版本写的指针，字段是 `serde(default)` 补的）→ `false`，重解一次；
/// - 指纹一致 → `true`；不一致 → `false`。
fn pointer_matches_archive<R: Runtime>(app: &AppHandle<R>, pointer: &PackPointer) -> bool {
    let Ok(archive) = locate_archive(app) else {
        return true;
    };
    let Some((bytes, entries)) = archive_shape(&archive) else {
        return true;
    };
    if pointer.archive_bytes == 0 || pointer.entry_count == 0 {
        // 升级路径：老指针没有指纹，无法确认 → 展开一次拿准确值。
        // 展开后指针会写上新指纹，之后不再重复。
        return false;
    }
    pointer.archive_bytes == bytes && pointer.entry_count == entries
}

/// 直接读压缩包里的 `meta.json`（不解包任何数据文件）。
///
/// 客户端更新时用它在下载/安装前做一次「这个包是给哪个版本/schema 的」预检；
/// 启动时也用它比较「内置包」与「当前生效包」谁的版本更新。
pub(crate) fn read_archive_meta(archive: &Path) -> Result<PackMeta, AppError> {
    let file = fs::File::open(archive)
        .map_err(|error| AppError::pack_not_found(archive.display()).with_detail(error.to_string()))?;
    let mut zip = zip::ZipArchive::new(BufReader::new(file))
        .map_err(|error| AppError::pack_corrupt(format!("打开 zip 失败: {error}")))?;
    let mut entry = zip
        .by_name("meta.json")
        .map_err(|error| AppError::pack_corrupt(format!("包内缺少 meta.json: {error}")))?;
    let mut text = String::new();
    entry
        .read_to_string(&mut text)
        .map_err(|error| AppError::pack_corrupt(format!("读取 meta.json 失败: {error}")))?;
    serde_json::from_str(&text).map_err(|error| AppError::pack_corrupt(format!("meta.json 解析失败: {error}")))
}

/// 比较 `a.b.c` 形式的版本号：`left` 是否严格高于 `right`。
///
/// 只做数字段比较；非数字段按 0 处理。游戏版本永远是纯数字段，够用。
fn version_gt(left: &str, right: &str) -> bool {
    let split = |value: &str| -> Vec<u64> {
        value
            .split('.')
            .map(|segment| segment.parse::<u64>().unwrap_or(0))
            .collect()
    };
    let left_parts = split(left);
    let right_parts = split(right);
    let length = left_parts.len().max(right_parts.len());
    for index in 0..length {
        let a = left_parts.get(index).copied().unwrap_or(0);
        let b = right_parts.get(index).copied().unwrap_or(0);
        if a != b {
            return a > b;
        }
    }
    false
}

/// 启动时判断「当前指针还能不能继续用」。
///
/// - `builtin` / 老指针：沿用原逻辑，内置压缩包字节数/条目数变了就重解；
/// - `update`：不能被**旧版**内置包覆盖；只有安装包里的内置数据版本更高
///   （用户重装/升级了程序）时才重新展开内置包。
fn should_keep_pointer<R: Runtime>(app: &AppHandle<R>, pointer: &PackPointer) -> bool {
    if matches!(pointer.source.as_str(), "update" | "manual") {
        let Ok(archive) = locate_archive(app) else {
            return true;
        };
        let Ok(meta) = read_archive_meta(&archive) else {
            return true;
        };
        if meta.schema_version != SUPPORTED_SCHEMA_VERSION {
            return true;
        }
        return !version_gt(&meta.game_version, &pointer.game_version);
    }
    pointer_matches_archive(app, pointer)
}

/// 依次尝试可能存放 `.hsrpack` 的位置，返回第一个存在的。
///
/// 需要三个候选是因为三种运行形态的目录布局不同：
/// 1. `tauri build` 产物：`$RESOURCE/hsr-local-4.7.51.hsrpack`
/// 2. `cargo build` / `cargo run`：`tauri-cli` 没有参与，resources 不会被复制，
///    此时包在项目根（`src-tauri/..`），用编译期 `CARGO_MANIFEST_DIR` 兜底
/// 3. 用户把包放在 exe 同目录（绿色版分发）
fn locate_archive<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, AppError> {
    let mut tried: Vec<String> = Vec::new();

    if let Ok(resource) = app.path().resource_dir() {
        let candidate = resource.join(BUILTIN_PACK_FILE);
        if candidate.is_file() {
            return Ok(candidate);
        }
        tried.push(candidate.display().to_string());
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let candidate = dir.join(BUILTIN_PACK_FILE);
            if candidate.is_file() {
                return Ok(candidate);
            }
            tried.push(candidate.display().to_string());
        }
    }

    if cfg!(debug_assertions) {
        if let Some(manifest_dir) = option_env!("CARGO_MANIFEST_DIR") {
            if let Some(root) = Path::new(manifest_dir).parent() {
                let candidate = root.join(BUILTIN_PACK_FILE);
                if candidate.is_file() {
                    return Ok(candidate);
                }
                tried.push(candidate.display().to_string());
            }
        }
    }

    Err(AppError::pack_not_found(tried.join(" | ")))
}

/// 校验 zip 条目路径，拒绝绝对路径、盘符与 `..`（zip-slip）。
///
/// 返回的路径一定是相对、且只含 `Normal` 与 `CurDir` 成分。
pub(crate) fn sanitize_entry_path(name: &str) -> Result<PathBuf, AppError> {
    // zip 规范要求 `/`，但个别实现会写 `\`；统一后再判定
    let normalized = name.replace('\\', "/");
    if normalized.is_empty() {
        return Err(AppError::new(
            crate::error::ErrorCode::PackExtractFailed,
            "数据包内含空文件名",
        ));
    }
    let candidate = Path::new(&normalized);
    let mut safe = PathBuf::new();
    for component in candidate.components() {
        match component {
            Component::Normal(part) => safe.push(part),
            Component::CurDir => {}
            // RootDir / Prefix（`C:`）/ ParentDir 全部拒绝
            _ => {
                return Err(AppError::new(
                    crate::error::ErrorCode::PackExtractFailed,
                    "数据包内含越界路径",
                )
                .with_detail(name.to_string()))
            }
        }
    }
    if safe.as_os_str().is_empty() {
        return Err(AppError::new(
            crate::error::ErrorCode::PackExtractFailed,
            "数据包内含非法路径",
        )
        .with_detail(name.to_string()));
    }
    Ok(safe)
}

/// 把 `.hsrpack` 解到 `staging` 目录，返回写入的文件数。
///
/// 只支持 store / deflate（T02 的 `pack.mjs` 就是这么写的），不支持加密与 zip64。
pub(crate) fn extract_archive<F>(archive: &Path, staging: &Path, mut on_progress: F) -> Result<usize, AppError>
where
    F: FnMut(usize, usize),
{
    let file = fs::File::open(archive).map_err(|error| {
        AppError::pack_not_found(archive.display()).with_detail(error.to_string())
    })?;
    let mut zip = zip::ZipArchive::new(BufReader::new(file))
        .map_err(|error| AppError::pack_corrupt(format!("打开 zip 失败: {error}")))?;

    let total = zip.len();
    let mut written = 0usize;

    for index in 0..total {
        let mut entry = zip
            .by_index(index)
            .map_err(|error| AppError::pack_corrupt(format!("读取第 {index} 个条目失败: {error}")))?;

        let raw_name = entry.name().to_string();
        let relative = sanitize_entry_path(&raw_name)?;
        let target = staging.join(&relative);

        if raw_name.ends_with('/') {
            fs::create_dir_all(&target)
                .map_err(|error| AppError::pack_extract_failed(target.display(), &error))?;
            continue;
        }

        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| AppError::pack_extract_failed(parent.display(), &error))?;
        }

        let mut buffer = Vec::with_capacity(entry.size() as usize);
        entry
            .read_to_end(&mut buffer)
            .map_err(|error| AppError::pack_corrupt(format!("{raw_name} 解压失败: {error}")))?;

        fs::write(&target, &buffer)
            .map_err(|error| AppError::pack_extract_failed(target.display(), &error))?;

        written += 1;
        on_progress(written, total);
    }

    Ok(written)
}

/// 启动时清理不再被「当前 / 上一版 / 内置」引用的旧数据包目录。
///
/// 每次客户端更新都会产生一个 `packs/{packId}-{时间戳}` 的完整副本（约 160 MB）；
/// 只保留三份（active、previous、builtin）就够回滚与兜底，其余在下次启动时删掉。
/// 失败只忽略：清理是优化，不能阻断启动。
fn cleanup_old_packs<R: Runtime>(app: &AppHandle<R>, active: &PackPointer) {
    let Ok(packs_dir) = paths::packs_dir(app) else {
        return;
    };
    let Ok(entries) = fs::read_dir(&packs_dir) else {
        return;
    };

    let mut keep: Vec<PathBuf> = vec![PathBuf::from(&active.root)];
    if let Ok(builtin_dir) = paths::pack_dir(app, BUILTIN_PACK_ID) {
        keep.push(builtin_dir);
    }
    if let Ok(previous_path) = paths::previous_pointer_path(app) {
        if let Ok(previous) = read_json_or_default::<PackPointer>(&previous_path) {
            if !previous.root.is_empty() {
                keep.push(PathBuf::from(&previous.root));
            }
        }
    }

    // 上次下载被打断留下的临时包：启动时不可能还有下载在跑，直接清掉
    if let Ok(update_dir) = paths::update_dir(app) {
        if let Ok(files) = fs::read_dir(&update_dir) {
            for file in files.flatten() {
                if file.path().is_file() {
                    let _ = fs::remove_file(file.path());
                }
            }
        }
    }

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with(".staging-") {
            let _ = fs::remove_dir_all(&path);
            continue;
        }
        if !name.starts_with("hsr-") {
            continue;
        }
        if keep.iter().any(|kept| kept == &path) {
            continue;
        }
        let _ = fs::remove_dir_all(&path);
    }
}

/// 清掉可能残留的 staging 目录（上次解包被杀）
fn reset_staging(staging: &Path) -> Result<(), AppError> {
    if staging.exists() {
        fs::remove_dir_all(staging)
            .map_err(|error| AppError::pack_extract_failed(staging.display(), &error))?;
    }
    Ok(())
}

/// 展开内置数据包并写指针；已展开过则只做快速路径校验。
///
/// 任何一步失败都会尝试回落到 `$RESOURCE/datapack`（如果安装包里带了散装目录），
/// 只有连它也没有才把错误抛给上层 —— 应用不应该因为数据包问题白屏。
///
/// # Errors
/// 找不到压缩包、解包失败、`meta.json` 不兼容，且没有可回落的散装目录时返回对应 `AppError`
pub fn ensure_builtin_pack<R: Runtime>(app: &AppHandle<R>) -> Result<PackPointer, AppError> {
    ensure_builtin_pack_with_progress(app, |_done, _total| {})
}

/// 读取当前生效指针（客户端更新/回滚用，要求指针有效）。
///
/// # Errors
/// 指针缺失、指向的目录/`meta.json` 无效时返回 `AppError`
pub fn active_pointer<R: Runtime>(app: &AppHandle<R>) -> Result<PackPointer, AppError> {
    try_existing_pointer(app)
}

/// 同 [`ensure_builtin_pack`]，但解包过程中回报进度（`on_progress(已写, 总数)`）。
///
/// # Errors
/// 同 [`ensure_builtin_pack`]
pub fn ensure_builtin_pack_with_progress<R: Runtime, F>(
    app: &AppHandle<R>,
    mut on_progress: F,
) -> Result<PackPointer, AppError>
where
    F: FnMut(usize, usize),
{
    // 1. 快速路径：指针有效、且与当前安装包内容一致就直接返回。
    //    只比 `packId` 不够 —— 数据包内容变了但 id 与游戏版本没变时，
    //    会继续复用旧解包目录（详见 `pointer_matches_archive` 的注释）。
    if let Ok(pointer) = try_existing_pointer(app) {
        if should_keep_pointer(app, &pointer) {
            return Ok(pointer);
        }
        eprintln!("[hsr] 内置数据包比当前生效包更新，重新展开");
    }

    // 2. 解包；失败则回落到散装目录
    match extract_builtin_pack(app, &mut on_progress) {
        Ok(pointer) => Ok(pointer),
        Err(error) => match resource_datapack_fallback(app) {
            Some(pointer) => {
                eprintln!(
                    "[hsr] 数据包展开失败（{error}），已回落到内置散装目录 {}",
                    pointer.root
                );
                Ok(pointer)
            }
            None => Err(error),
        },
    }
}

/// `$RESOURCE/datapack` 存在且元数据合法时，直接把它当作生效数据包（只读）。
///
/// 这是「解包失败也不白屏」的兜底：老版本安装包里可能就是散装目录。
fn resource_datapack_fallback<R: Runtime>(app: &AppHandle<R>) -> Option<PackPointer> {
    let root = paths::resource_datapack_dir(app).ok()?;
    let meta = read_meta(&root).ok()?;
    let pointer = PackPointer {
        pack_id: meta.pack_id,
        root: root.display().to_string(),
        game_version: meta.game_version,
        schema_version: meta.schema_version,
        installed_at: now_secs(),
        // 散装目录不是压缩包展开的产物，没有指纹可言；留 0 表示「未知」，
        // 下次启动若发现压缩包存在会再次尝试展开（这条兜底路径本来就意味着上次解包失败了）
        archive_bytes: 0,
        entry_count: 0,
        source: "builtin".to_string(),
    };
    // 指针写失败不影响本次使用（下次启动会再走一遍解包尝试）
    let _ = write_json_atomic(&paths::active_pointer_path(app).ok()?, &pointer);
    Some(pointer)
}

/// 真正执行「解包 → 校验 → 目录级替换 → 写指针」。
fn extract_builtin_pack<R: Runtime, F>(
    app: &AppHandle<R>,
    on_progress: &mut F,
) -> Result<PackPointer, AppError>
where
    F: FnMut(usize, usize),
{
    // 1. 找压缩包
    let archive = locate_archive(app)?;
    let packs_dir = paths::packs_dir(app)?;
    paths::ensure_dir(&packs_dir)?;
    // 2. 空间检查放在建目录之后、解包之前，避免写一半才报磁盘满
    ensure_free_space(&packs_dir)?;

    let staging = paths::pack_staging_dir(app, BUILTIN_PACK_ID)?;
    let final_dir = paths::pack_dir(app, BUILTIN_PACK_ID)?;
    // 上次被打断留下的 .tmp 一律丢弃重来
    reset_staging(&staging)?;

    // 3. 解包到 staging
    let started = Instant::now();
    let written = extract_archive(&archive, &staging, on_progress)?;

    // 4. 校验产物（这一步在 rename 之前，失败只会留下 .tmp）
    let meta = read_meta(&staging)?;
    // 基线 4.7.51 仍做精确计数校验；新版本内置包计数随版本变化，只校验 schema/形状。
    if meta.game_version == "4.7.51" {
        if let Some(mismatch) = counts_mismatch(&meta.counts) {
            return Err(AppError::pack_corrupt(format!(
                "数据包内容不完整：{mismatch}"
            )));
        }
    }
    if meta.pack_id != BUILTIN_PACK_ID {
        return Err(AppError::pack_corrupt(format!(
            "数据包 id 不匹配：{} != {BUILTIN_PACK_ID}",
            meta.pack_id
        )));
    }

    // 5. 目录级原子替换：先删旧的成品目录（若有），再 rename
    if final_dir.exists() {
        fs::remove_dir_all(&final_dir)
            .map_err(|error| AppError::pack_extract_failed(final_dir.display(), &error))?;
    }
    fs::rename(&staging, &final_dir)
        .map_err(|error| AppError::pack_extract_failed(final_dir.display(), &error))?;

    // 6. 写指针（带上这份压缩包的指纹，下次启动据此判断要不要重解）
    let (archive_bytes, entry_count) = archive_shape(&archive).unwrap_or((0, 0));
    let pointer = PackPointer {
        pack_id: meta.pack_id,
        root: final_dir.display().to_string(),
        game_version: meta.game_version,
        schema_version: meta.schema_version,
        installed_at: now_secs(),
        archive_bytes,
        entry_count,
        source: "builtin".to_string(),
    };
    write_json_atomic(&paths::active_pointer_path(app)?, &pointer)?;

    if cfg!(debug_assertions) {
        eprintln!(
            "[hsr] 数据包展开完成：{written} 个文件，耗时 {:?}，目录={}",
            started.elapsed(),
            final_dir.display()
        );
    }

    Ok(pointer)
}

/// 跑一次准备流程并写受管状态（`setup` 在后台线程调用）。
///
/// 失败只记录到状态里，**不阻断启动**：前端 `BootGuard` 会读到 `Failed` 并给出重试入口。
///
/// 成功后会**实际读一遍索引**并把结果打进日志（debug 构建还会写进窗口标题），
/// 这是"数据真的读得到"的自检。
pub fn prepare_in_background<R: Runtime>(app: AppHandle<R>, awareness: DpiAwareness) {
    let state = app.state::<PackState>();
    state.set(PackStatus::Extracting {
        pack_id: BUILTIN_PACK_ID.to_string(),
        files: 0,
        total: 0,
    });

    let result = ensure_builtin_pack_with_progress(&app, |done, total| {
        // 每 200 个文件刷新一次，避免抢锁过于频繁
        if done == 1 || done % 200 == 0 || done == total {
            state.set(PackStatus::Extracting {
                pack_id: BUILTIN_PACK_ID.to_string(),
                files: done,
                total,
            });
        }
    });

    match result {
        Ok(pointer) => {
            cleanup_old_packs(&app, &pointer);
            state.set(pointer_to_status(&pointer));
            announce_ready(&app, &pointer.root, awareness);
        }
        Err(error) => {
            eprintln!("[hsr] 数据包准备失败: {error}");
            state.set(PackStatus::Failed {
                code: error.code.as_str().to_string(),
                message: error.message.clone(),
                detail: error.detail.clone(),
            });
        }
    }
}

/// 进程启动时刻（`run()` 里写入），用于记录"从进程启动到数据包就绪"的耗时。
pub static BOOT_INSTANT: std::sync::OnceLock<Instant> = std::sync::OnceLock::new();

/// 数据包就绪后的自检：读真实索引 → 打日志（debug 下同时改窗口标题）。
fn announce_ready<R: Runtime>(app: &AppHandle<R>, root: &str, awareness: DpiAwareness) {
    let Ok(stats) = read_stats(Path::new(root)) else {
        return;
    };
    let boot_ms = BOOT_INSTANT
        .get()
        .map(|start| start.elapsed().as_millis())
        .unwrap_or(0);

    eprintln!(
        "[hsr] 数据包就绪 v{}：{} 角色 / {} 物品 / {} 光锥，样例角色={:?}，DPI={}，启动后 {}ms，目录={}",
        stats.game_version,
        stats.characters,
        stats.items,
        stats.lightcones,
        stats.sample_character,
        awareness.label(),
        boot_ms,
        root
    );

    // debug 构建把自检结果写上标题栏：肉眼 + 进程查询都能验证"读到了真实数据"
    if cfg!(debug_assertions) {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.set_title(&format!(
                "星穹数据库 · 本地版  [{} 角色 / {} 物品 · DPI {} · {}ms]",
                stats.characters,
                stats.items,
                awareness.label(),
                boot_ms
            ));
        }
    }
}

/// 当前生效数据包的目录（供 T03 的数据访问层使用）
///
/// # Errors
/// 指针缺失或指向的目录没有 `meta.json`
pub fn active_datapack_root<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, AppError> {
    let pointer = try_existing_pointer(app)?;
    Ok(PathBuf::from(pointer.root))
}

/// 运行期统计：**真实读一遍索引文件**得到，而不是复述 `meta.json`。
///
/// 这是「T01 壳层 + T02 数据包」合龙的自检证据：
/// 如果 `characters`/`items` 与 `meta.counts` 对不上，说明解包或索引有问题。
#[derive(Debug, Clone, Serialize)]
pub struct DatapackStats {
    /// 数据包 id
    #[serde(rename = "packId")]
    pub pack_id: String,
    /// 游戏数据版本
    #[serde(rename = "gameVersion")]
    pub game_version: String,
    /// 数据结构版本
    #[serde(rename = "schemaVersion")]
    pub schema_version: u32,
    /// 数据包目录
    pub root: String,
    /// `meta.json` 里声明的计数
    pub declared: PackCounts,
    /// 实际从 `db/character.json` 数出来的角色数
    pub characters: usize,
    /// 实际从 `db/lightcone.json` 数出来的光锥数
    pub lightcones: usize,
    /// 实际把 16 个物品分片累加出来的物品数
    pub items: usize,
    /// 第一个角色的中文名（用于肉眼确认“读到了真名字”）
    #[serde(rename = "sampleCharacter")]
    pub sample_character: Option<String>,
}

/// 读一个 JSON 文件的条目数（对象取 key 数、数组取长度）。
fn count_entries(root: &Path, relative: &str) -> Result<usize, AppError> {
    let path = root.join(relative);
    let bytes = fs::read(&path)
        .map_err(|error| AppError::pack_corrupt(format!("读取 {relative} 失败: {error}")))?;
    let value: serde_json::Value = serde_json::from_slice(&bytes)
        .map_err(|error| AppError::pack_corrupt(format!("解析 {relative} 失败: {error}")))?;
    Ok(match value {
        serde_json::Value::Array(items) => items.len(),
        serde_json::Value::Object(map) => map.len(),
        _ => 0,
    })
}

/// 从指定目录读出统计（不依赖 Tauri，便于单测）。
///
/// # Errors
/// `meta.json` 缺失/不合法、索引文件读不到或不是合法 JSON
pub fn read_stats(root: &Path) -> Result<DatapackStats, AppError> {
    let meta = read_meta(root)?;
    let characters = count_entries(root, "db/character.json")?;
    let lightcones = count_entries(root, "db/lightcone.json")?;

    let mut items = 0usize;
    for shard in 0..ITEM_SHARD_COUNT {
        items += count_entries(root, &format!("db/item/{shard}.json"))?;
    }

    // 抽第一个角色名。
    //
    // 4.7.51 里 `db/character.json` 的真实形状是 **数组**：
    //   [{"id":"1001","name":"三月七","names":{"zh":"三月七","en":"March 7th",…},…}, …]
    // 两个坑叠在这里，都只影响「自检展示」所以不会报错：
    //   1. 用 `as_object()` 取第一个元素 → 数组返回 None，整条链直接短路成 None
    //   2. `name` 是**字符串**，多语言在 `names` 里；早期写成 `name.zh` 也恒为 None
    // 所以这里同时兼容数组/对象两种容器，并优先 `names.zh`、退回 `name`、最后退回 `id`。
    let sample_character = fs::read(root.join("db/character.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
        .and_then(|value| {
            let first = match &value {
                serde_json::Value::Array(items) => items.first()?.clone(),
                serde_json::Value::Object(map) => map.values().next()?.clone(),
                _ => return None,
            };
            first
                .get("names")
                .and_then(|names| names.get("zh"))
                .and_then(|zh| zh.as_str())
                .or_else(|| first.get("name").and_then(|name| name.as_str()))
                .or_else(|| first.get("id").and_then(|id| id.as_str()))
                .map(str::to_string)
        });

    Ok(DatapackStats {
        pack_id: meta.pack_id,
        game_version: meta.game_version,
        schema_version: meta.schema_version,
        root: root.display().to_string(),
        declared: meta.counts,
        characters,
        lightcones,
        items,
        sample_character,
    })
}

/// 读当前生效数据包的统计（供 `datapack_stats` 命令使用）。
///
/// # Errors
/// 指针缺失或索引读取失败
pub fn stats<R: Runtime>(app: &AppHandle<R>) -> Result<DatapackStats, AppError> {
    let root = active_datapack_root(app)?;
    read_stats(&root)
}
