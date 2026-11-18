//! 自检套件（`cargo run --bin selftest`）
//!
//! ## 为什么不用 `cargo test`
//!
//! 在 `x86_64-pc-windows-gnu` 下，`libtest` 生成的 harness 二进制起不来，
//! 退出码 `0xC0000139`（`STATUS_ENTRYPOINT_NOT_FOUND`）—— 而**主 exe 与普通 bin
//! 目标的链接与运行都完全正常**。也就是说挂的是 harness 本身，不是我们的代码。
//!
//! 定位这个问题的价值远低于绕开它：把断言搬进一个普通 bin 目标即可。
//! 于是本模块承载全部断言，`src/bin/selftest.rs` 只是十几行 `main`。
//!
//! ## 断言放在 lib 内而不是 bin 里
//!
//! 断言需要触达 crate 私有项（`sanitize_entry_path`、`read_meta`、`bak_path_for` …）。
//! 如果把它们写进 `bin/selftest.rs`，就得把这些内部实现全改成 `pub` 暴露出去，
//! 等于为了测试扩大公共 API 面。放在 lib 内部反而可以只用 `pub(crate)`，
//! 公共 API 一个字节都不变。
//!
//! ## 与 `cargo test` 的行为差异
//!
//! - 用 `catch_unwind` 逐条隔离：一条 panic 不会终止整个套件，能一次看到全部失败项
//! - 关闭默认 panic hook，失败信息由本模块自行格式化（输出整洁，无 backtrace 噪音）
//! - `[profile.release] panic = "abort"`，所以 **请用 debug 跑**：
//!   `cargo run --bin selftest`（不要加 `--release`，否则 `catch_unwind` 失效）

use std::cell::RefCell;
use std::fs;
use std::io;
use std::panic;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use serde::{Deserialize, Serialize};

use crate::atomic::{bak_path_for, read_json_or_default, write_json_atomic};
use crate::datapack::{self, IndexCache};
use crate::dpi::DpiAwareness;
use crate::error::{AppError, ErrorCode};
use crate::userdata::{self, UserDataName};
use crate::pack::{
    counts_mismatch, read_meta, read_stats, sanitize_entry_path, PackPointer, PackState, PackStatus,
    BUILTIN_PACK_ID, EXPECTED_COUNTS, ITEM_SHARD_COUNT, SUPPORTED_SCHEMA_VERSION,
};

/// 与 [`EXPECTED_COUNTS`] 等价的 JSON 片段，供自检拼 `meta.json`
const EXPECTED_COUNTS_JSON: &str = r#"{"character":101,"lightcone":174,"relicset":64,"monster":666,"monsterGroups":382,"item":1606,"achievement":2022,"achievementSeries":9}"#;

/// 单条自检的结果
pub struct CaseResult {
    /// 断言名称（失败时原样打印）
    pub name: &'static str,
    /// `Ok(())` 表示通过；`Err` 是 panic 消息
    pub result: Result<(), String>,
}

/// 套件汇总
#[derive(Debug, Default)]
pub struct Report {
    /// 通过的条数
    pub passed: usize,
    /// 失败的条数
    pub failed: usize,
    /// 跳过的条数（依赖外部真实数据、本机没有时跳过，不算通过也不算失败）
    pub skipped: usize,
    /// 失败明细：`名称 → 原因`
    pub failures: Vec<(&'static str, String)>,
}

impl Report {
    /// 总条数（含跳过）
    pub fn total(&self) -> usize {
        self.passed + self.failed + self.skipped
    }

    /// 是否全绿
    pub fn is_ok(&self) -> bool {
        self.failed == 0
    }
}

// ---------------------------------------------------------------------------
// 临时目录
// ---------------------------------------------------------------------------

/// 自检专用的临时目录：进程退出时删除。
///
/// 不引入 `tempfile` 依赖 —— 只需要「建一个唯一目录 + Drop 删掉」两件事，
/// 为它把 `tempfile` 从 dev-dependency 提到正式依赖不划算。
struct TempDir {
    path: PathBuf,
}

impl TempDir {
    fn new(label: &str) -> Self {
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let seq = COUNTER.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!(
            "hsr-selftest-{}-{}-{seq}-{label}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        fs::create_dir_all(&path).expect("创建临时目录失败");
        Self { path }
    }

    fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        // 尽力而为：删不掉也没关系，系统临时目录本来就会被清理
        let _ = fs::remove_dir_all(&self.path);
    }
}

// ---------------------------------------------------------------------------
// 断言收集
// ---------------------------------------------------------------------------

thread_local! {
    /// 最近一次 panic 的消息（由临时 hook 写入）
    static LAST_PANIC: RefCell<Option<String>> = const { RefCell::new(None) };
}

/// 跑一条断言：panic 即失败，返回 `Err(消息)`。
fn case(name: &'static str, body: fn()) -> CaseResult {
    LAST_PANIC.with(|slot| *slot.borrow_mut() = None);

    let outcome = panic::catch_unwind(body);

    let result = match outcome {
        Ok(()) => Ok(()),
        Err(payload) => {
            let from_hook = LAST_PANIC.with(|slot| slot.borrow_mut().take());
            let message = from_hook.unwrap_or_else(|| panic_payload_message(&payload));
            Err(message)
        }
    };

    CaseResult { name, result }
}

/// 从 `catch_unwind` 的 payload 里抠出一句人可读的消息。
fn panic_payload_message(payload: &Box<dyn std::any::Any + Send>) -> String {
    if let Some(text) = payload.downcast_ref::<&str>() {
        (*text).to_string()
    } else if let Some(text) = payload.downcast_ref::<String>() {
        text.clone()
    } else {
        "（panicked，无消息）".to_string()
    }
}

/// 安装一个只记录、不打印的 panic hook，避免每条失败都在 stderr 刷 backtrace。
fn install_quiet_hook() {
    panic::set_hook(Box::new(|info| {
        let location = info
            .location()
            .map(|loc| format!("{}:{}", loc.file(), loc.line()))
            .unwrap_or_else(|| "?".to_string());
        let message = if let Some(text) = info.payload().downcast_ref::<&str>() {
            (*text).to_string()
        } else if let Some(text) = info.payload().downcast_ref::<String>() {
            text.clone()
        } else {
            "（panicked，无消息）".to_string()
        };
        LAST_PANIC.with(|slot| {
            *slot.borrow_mut() = Some(format!("{message}  @ {location}"));
        });
    }));
}

// ---------------------------------------------------------------------------
// 全部断言
// ---------------------------------------------------------------------------

/// 跑完整套件（29 条）。
pub fn run_all() -> Report {
    install_quiet_hook();

    let cases = all_cases();
    let mut report = Report::default();

    for CaseResult { name, result } in cases {
        match result {
            Ok(()) => {
                report.passed += 1;
                println!("  ok   {name}");
            }
            Err(message) => {
                report.failed += 1;
                println!("  FAIL {name}\n         {message}");
                report.failures.push((name, message));
            }
        }
    }

    // 集成检查：只有本机存在真实数据包时才跑（CI 上自然跳过）
    match integration_real_pack() {
        IntegrationOutcome::Passed => {
            report.passed += 1;
            println!("  ok   集成: 真实数据包（6 索引条数对照 datapack-report.json + 详情正反三条）");
        }
        IntegrationOutcome::Skipped(reason) => {
            report.skipped += 1;
            println!("  skip 集成: 真实数据包 ({reason})");
        }
        IntegrationOutcome::Failed(message) => {
            report.failed += 1;
            println!("  FAIL 集成: 真实数据包索引\n         {message}");
            report.failures.push(("集成: 真实数据包索引", message));
        }
    }

    report
}

/// 集成检查的结果
enum IntegrationOutcome {
    Passed,
    Skipped(&'static str),
    Failed(String),
}

/// 对**真实**解包后的数据包跑一遍索引读取。
///
/// 路径来自环境变量 `HSR_SELFTEST_PACK`，没设就跳过——这样 CI/别人的机器不会因为
/// 没有 `%APPDATA%` 数据而失败，而我本地能拿到「真数据 101/174/64/382/1606/9」的证据。
///
/// 为什么值得单独有这一条：单测用的是 2 角色 / 30 物品的迷你夹具，
/// 它能证明「逻辑对」，但证明不了「真实数据包读得出来」。两者缺一不可。
fn integration_real_pack() -> IntegrationOutcome {
    let Ok(root) = std::env::var("HSR_SELFTEST_PACK") else {
        return IntegrationOutcome::Skipped("未设置 HSR_SELFTEST_PACK");
    };
    let root = PathBuf::from(root);
    if !root.join("meta.json").exists() {
        return IntegrationOutcome::Skipped("路径下没有 meta.json");
    }

    // 期望值来自**构建脚本自己的报告**，不在这里写常量。
    // 手写 101/174/64/382/1606/9 的风险是：数据包换了版本、这些数字没人改，
    // 断言会一直"通过"到某天真实数据变了才炸——那时已经没人记得它们从哪来。
    let expected = match read_expected_counts() {
        Ok(map) => map,
        Err(reason) => return IntegrationOutcome::Skipped(&reason),
    };

    // 冷读耗时：`datapack_index` 第一次调用就是这段开销（读盘 + serde_json 解析）。
    // 报数字而不是"感觉很快"——目标是 ≤150ms。
    let started = std::time::Instant::now();
    let index = match crate::datapack::read_index_at(&root) {
        Ok(index) => index,
        Err(error) => return IntegrationOutcome::Failed(format!("读索引失败: {error}")),
    };
    let cold_ms = started.elapsed().as_millis();

    // 索引 JSON 合计字节数：前端 `JSON.parse` 后常驻内存的下限（对象开销通常是字面量的 2-3 倍）
    let mut index_bytes = 0u64;
    for rel in [
        "db/character.json",
        "db/lightcone.json",
        "db/relicset.json",
        "db/monster.json",
        "db/achievement.json",
    ] {
        if let Ok(meta) = fs::metadata(root.join(rel)) {
            index_bytes += meta.len();
        }
    }
    for shard in 0..16 {
        if let Ok(meta) = fs::metadata(root.join(format!("db/item/{shard}.json"))) {
            index_bytes += meta.len();
        }
    }

    // 索引字段名 → 报告里的 expected 键（分组用 monsterGroups，不是 monster）
    let pairs: [(&str, usize, &str); 6] = [
        ("character", index.characters.len(), "character"),
        ("lightcone", index.lightcones.len(), "lightcone"),
        ("relicset", index.relicsets.len(), "relicset"),
        ("monsterGroups", index.monsters.len(), "monsterGroups"),
        ("item", index.items.len(), "item"),
        ("achievementSeries", index.achievement_series.len(), "achievementSeries"),
    ];
    for (field, got, key) in pairs {
        let Some(want) = expected.get(key).copied() else {
            return IntegrationOutcome::Failed(format!("datapack-report.json 缺少 expected.{key}"));
        };
        if got != want {
            return IntegrationOutcome::Failed(format!(
                "{field}: 读到 {got}，报告 expected.{key}={want}"
            ));
        }
    }

    // 再确认 brief 里真有中文名（不是空对象凑数）
    let first_name = index
        .characters
        .first()
        .and_then(|value| value.get("names"))
        .and_then(|names| names.get("zh"))
        .and_then(|zh| zh.as_str())
        .unwrap_or_default()
        .to_string();
    if first_name.is_empty() {
        return IntegrationOutcome::Failed("characters[0].names.zh 为空".to_string());
    }

    // 详情正路：真实文件读出来必须是对象，且 name 是字符串「三月七」
    match crate::datapack::read_json_at(&root, "db/zh/character/1001.json") {
        Ok(value) => {
            if !value.is_object() {
                return IntegrationOutcome::Failed("db/zh/character/1001.json 不是对象".to_string());
            }
            match value.get("name").and_then(|name| name.as_str()) {
                Some("三月七") => {}
                other => {
                    return IntegrationOutcome::Failed(format!(
                        "1001 的 name 应为字符串「三月七」，实际 {other:?}"
                    ))
                }
            }
        }
        Err(error) => return IntegrationOutcome::Failed(format!("读角色详情失败: {error}")),
    }

    // 详情反路一：不存在的 id 必须是 PACK_FILE_MISSING（不是 panic、不是 null）
    match crate::datapack::read_json_at(&root, "db/zh/character/999999.json") {
        Ok(_) => return IntegrationOutcome::Failed("999999 不该读得到".to_string()),
        Err(error) if error.code == ErrorCode::PackFileMissing => {}
        Err(error) => {
            return IntegrationOutcome::Failed(format!(
                "999999 应为 PACK_FILE_MISSING，实际 {:?}",
                error.code
            ))
        }
    }

    // 详情反路二：越界路径必须在 sanitize 阶段被拒
    match crate::datapack::read_json_at(&root, "../../etc/passwd") {
        Ok(_) => return IntegrationOutcome::Failed("../../etc/passwd 不该读得到".to_string()),
        Err(error) if error.code == ErrorCode::PackInvalidPath => {}
        Err(error) => {
            return IntegrationOutcome::Failed(format!(
                "../../etc/passwd 应为 PACK_INVALID_PATH，实际 {:?}",
                error.code
            ))
        }
    }

    // 物品分片详情也读一片（16 分片规则不同，单测覆盖不到真实数据）
    if let Err(error) = crate::datapack::read_json_at(&root, "db/zh/item/3.json") {
        return IntegrationOutcome::Failed(format!("读物品分片详情失败: {error}"));
    }

    println!(
        "         样例角色={first_name}，gameVersion={}，期望值来源=datapack-report.json",
        index.game_version
    );
    println!(
        "         冷读一次 6 个索引：{cold_ms} ms（含 serde_json 解析，目标 ≤150ms）；索引 JSON 合计 {:.1} KiB",
        index_bytes as f64 / 1024.0
    );
    IntegrationOutcome::Passed
}

/// 从 `datapack-report.json` 读 `expected` 计数。
///
/// 查找顺序：`HSR_SELFTEST_REPORT` → 仓库根（`CARGO_MANIFEST_DIR/..`）。
///
/// # Errors
/// 报告文件不存在或结构不对时返回原因字符串（调用方据此 Skip 而不是 Fail——
/// 别人机器上没有构建报告是正常状态，不该报红）
fn read_expected_counts() -> Result<std::collections::BTreeMap<String, usize>, &'static str> {
    let explicit = std::env::var("HSR_SELFTEST_REPORT").ok().map(PathBuf::from);
    let candidate = explicit.unwrap_or_else(|| {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .map(|root| root.join("datapack-report.json"))
            .unwrap_or_else(|| PathBuf::from("datapack-report.json"))
    });
    if !candidate.exists() {
        return Err("找不到 datapack-report.json");
    }
    let text = fs::read_to_string(&candidate).map_err(|_| "datapack-report.json 读取失败")?;
    let value: serde_json::Value =
        serde_json::from_str(&text).map_err(|_| "datapack-report.json 不是合法 JSON")?;
    let Some(expected) = value.get("expected").and_then(|item| item.as_object()) else {
        return Err("datapack-report.json 缺少 expected 对象");
    };

    let mut map = std::collections::BTreeMap::new();
    for (key, entry) in expected {
        if let Some(count) = entry.as_u64() {
            map.insert(key.clone(), count as usize);
        }
    }
    if map.is_empty() {
        return Err("datapack-report.json 的 expected 里没有数字");
    }
    Ok(map)
}

/// 35 条断言，按模块分组。
fn all_cases() -> Vec<CaseResult> {
    let mut cases = Vec::with_capacity(35);

    // --- atomic.rs：原子写入与损坏恢复 --------------------------------
    cases.push(case("atomic: 写后读回一致且不残留 .tmp", atomic_write_then_read));
    cases.push(case("atomic: 文件不存在返回默认值", atomic_missing_file_default));
    cases.push(case("atomic: 坏文件回退默认并备份 .bak", atomic_corrupt_backs_up));
    cases.push(case("atomic: 覆盖写入替换旧内容", atomic_overwrite_replaces));

    // --- error.rs：序列化契约 ----------------------------------------
    cases.push(case("error: 序列化为 code/message/detail", error_serializes_three_fields));
    cases.push(case("error: 无 detail 时省略字段", error_omits_detail));
    cases.push(case("error: io::Error 映射为 IO_FAILED", error_io_maps_to_io_failed));

    // --- dpi.rs ------------------------------------------------------
    cases.push(case("dpi: 标签与 is_per_monitor 稳定", dpi_labels_stable));
    if cfg!(windows) {
        cases.push(case("dpi: Windows 上运行时可拉到 per-monitor", dpi_enable_works));
    }

    // --- lib.rs：跨模块契约 ------------------------------------------
    cases.push(case("lib: AppError 在 crate 内可达", lib_error_reachable));
    cases.push(case("lib: PackStatus 带 state 标签序列化", lib_pack_status_shape));

    // --- pack.rs：路径校验、meta 校验、统计、指针 --------------------
    cases.push(case("pack: sanitize 拒绝 ..", pack_sanitize_rejects_parent));
    cases.push(case("pack: sanitize 拒绝绝对路径与盘符", pack_sanitize_rejects_absolute));
    cases.push(case("pack: sanitize 接受正常路径", pack_sanitize_accepts_normal));
    cases.push(case("pack: read_meta 拒绝不兼容 schemaVersion", pack_meta_rejects_schema));
    cases.push(case("pack: read_meta 接受 schemaVersion=1", pack_meta_accepts_schema));
    cases.push(case("pack: read_meta 拒绝计数不符", pack_meta_rejects_counts));
    cases.push(case("pack: counts_mismatch 报第一处差异", pack_counts_mismatch_first));
    cases.push(case("pack: read_stats 真读索引文件", pack_read_stats));
    cases.push(case("pack: read_stats 名称回退到 name", pack_read_stats_falls_back_to_name));
    cases.push(case(
        "pack: read_stats 兼容对象容器",
        pack_read_stats_accepts_object_container,
    ));
    cases.push(case("pack: active.json 指针往返", pack_pointer_roundtrip));
    cases.push(case("pack: PackState 初始为 PACK_NOT_FOUND", pack_state_initial));

    // --- datapack.rs：数据访问层 --------------------------------------
    cases.push(case("datapack: read_json 拒绝越界路径", datapack_rejects_traversal));
    cases.push(case("datapack: read_json 缺失文件报 PACK_FILE_MISSING", datapack_missing_file));
    cases.push(case("datapack: read_json 坏 JSON 报 PACK_CORRUPT", datapack_bad_json));
    cases.push(case("datapack: 索引合并 16 个物品分片", datapack_index_merges_shards));
    cases.push(case("datapack: 分片缺失即报错（不静默少一批）", datapack_index_missing_shard));
    cases.push(case("datapack: 索引缓存按 root 失效", datapack_cache_keyed_by_root));

    // --- userdata.rs：收藏 / 笔记 / 偏好落盘 --------------------------
    cases.push(case(
        "userdata: 写后读回原文一致且不残留 .tmp",
        userdata_write_read_roundtrip,
    ));
    cases.push(case("userdata: 文件不存在返回 None 且不建文件", userdata_missing_returns_none));
    cases.push(case(
        "userdata: 坏 JSON 备份 .bak 并重建默认内容",
        userdata_corrupt_backs_up_and_rebuilds,
    ));
    cases.push(case(
        "userdata: 顶层形状不符按损坏处理",
        userdata_wrong_shape_is_corrupt,
    ));
    cases.push(case("userdata: 白名单外名字被拒", userdata_rejects_unknown_name));
    cases.push(case("userdata: 非法内容/形状拒绝写入", userdata_rejects_bad_content));

    cases
}

// --- atomic.rs -------------------------------------------------------------

/// 供 atomic 系列复用的最小结构体
#[derive(Debug, Default, PartialEq, Serialize, Deserialize)]
struct Sample {
    name: String,
    count: u32,
}

fn atomic_write_then_read() {
    let dir = TempDir::new("atomic-roundtrip");
    let path = dir.path().join("userdata").join("prefs.json");
    let sample = Sample {
        name: "希儿".to_string(),
        count: 7,
    };

    write_json_atomic(&path, &sample).expect("写入失败");
    assert!(path.exists(), "目标文件应存在");

    let loaded: Sample = read_json_or_default(&path).expect("读取失败");
    assert_eq!(loaded, sample);

    // 临时文件不应残留
    let leftovers: Vec<_> = fs::read_dir(path.parent().unwrap())
        .expect("读取目录失败")
        .filter_map(Result::ok)
        .filter(|entry| entry.file_name().to_string_lossy().ends_with(".tmp"))
        .collect();
    assert!(leftovers.is_empty(), "不应残留 .tmp 文件");
}

fn atomic_missing_file_default() {
    let dir = TempDir::new("atomic-missing");
    let path = dir.path().join("nope.json");
    let loaded: Sample = read_json_or_default(&path).expect("读取失败");
    assert_eq!(loaded, Sample::default());
}

fn atomic_corrupt_backs_up() {
    let dir = TempDir::new("atomic-corrupt");
    let path = dir.path().join("notes.json");
    fs::write(&path, b"{ this is not json").expect("写入坏文件失败");

    let loaded: Sample = read_json_or_default(&path).expect("读取失败");
    assert_eq!(loaded, Sample::default());

    let bak = bak_path_for(&path);
    assert!(bak.exists(), "损坏文件应被备份为 .bak");
    let backup_content = fs::read_to_string(&bak).expect("读取备份失败");
    assert!(backup_content.contains("this is not json"));
}

fn atomic_overwrite_replaces() {
    let dir = TempDir::new("atomic-overwrite");
    let path = dir.path().join("active.json");

    write_json_atomic(
        &path,
        &Sample {
            name: "old".to_string(),
            count: 1,
        },
    )
    .expect("首次写入失败");
    write_json_atomic(
        &path,
        &Sample {
            name: "new".to_string(),
            count: 2,
        },
    )
    .expect("覆盖写入失败");

    let loaded: Sample = read_json_or_default(&path).expect("读取失败");
    assert_eq!(loaded.name, "new");
    assert_eq!(loaded.count, 2);
}

// --- error.rs --------------------------------------------------------------

fn error_serializes_three_fields() {
    let error = AppError::pack_not_found("C:/x/datapack").with_detail("extra");
    let json = serde_json::to_value(&error).expect("序列化失败");
    assert_eq!(json["code"], "PACK_NOT_FOUND");
    assert_eq!(json["message"], "未找到数据包");
    assert_eq!(json["detail"], "extra");
}

fn error_omits_detail() {
    // 注意：不能用 `AppError::internal("boom")` —— 它把参数写进 `detail`（见 error.rs），
    // 那条断言曾经只检查了 `code`，等于没测到「省略」这件事。这里构造一个真正无 detail 的错误。
    let error = AppError::new(ErrorCode::Internal, "内部错误");
    assert!(error.detail.is_none(), "前提：构造出的错误不应带 detail");

    let json = serde_json::to_value(&error).expect("序列化失败");
    assert_eq!(json["code"], "INTERNAL");
    assert!(
        json.get("detail").is_none(),
        "detail 为 None 时不应出现该字段，实际 {json}"
    );
    // 反向确认：带 detail 时字段必须出现（避免 skip_serializing_if 写反了也能过）
    let with_detail = AppError::internal("boom");
    let json = serde_json::to_value(&with_detail).expect("序列化失败");
    assert_eq!(json["detail"], "boom");
}

fn error_io_maps_to_io_failed() {
    let error: AppError = io::Error::new(io::ErrorKind::Other, "disk full").into();
    assert_eq!(error.code, ErrorCode::IoFailed);
    assert!(error.detail.unwrap_or_default().contains("disk full"));
}

// --- dpi.rs ----------------------------------------------------------------

fn dpi_labels_stable() {
    assert_eq!(DpiAwareness::PerMonitor.label(), "per-monitor");
    assert_eq!(DpiAwareness::Unaware.label(), "unaware");
    assert!(DpiAwareness::PerMonitor.is_per_monitor());
    assert!(!DpiAwareness::System.is_per_monitor());
}

fn dpi_enable_works() {
    // 自检进程没有清单，运行时 API 应当能把感知拉到 per-monitor
    let awareness = crate::dpi::enable_per_monitor_v2();
    assert!(
        awareness.is_per_monitor(),
        "预期 per-monitor，实际 {}",
        awareness.label()
    );
}

// --- lib.rs ----------------------------------------------------------------

fn lib_error_reachable() {
    let error = AppError::pack_corrupt("manifest sha256 mismatch");
    assert_eq!(format!("{:?}", error.code), "PackCorrupt");
}

fn lib_pack_status_shape() {
    // 前端只按 `state` 分支：锁住序列化形状，避免改字段名悄悄破坏契约
    let status = PackStatus::Extracting {
        pack_id: "hsr-4.7.51-local".to_string(),
        files: 12,
        total: 5461,
    };
    let json = serde_json::to_value(&status).expect("序列化失败");
    assert_eq!(json["state"], "extracting");
    assert_eq!(json["packId"], "hsr-4.7.51-local");
    assert_eq!(json["files"], 12);
    assert_eq!(json["total"], 5461);
}

// --- pack.rs ---------------------------------------------------------------

fn pack_sanitize_rejects_parent() {
    let error = sanitize_entry_path("../evil.txt").expect_err("应拒绝 .. 路径");
    assert_eq!(format!("{:?}", error.code), "PackExtractFailed");
}

fn pack_sanitize_rejects_absolute() {
    assert!(sanitize_entry_path("C:/Windows/System32/x.dll").is_err());
    assert!(sanitize_entry_path("/etc/passwd").is_err());
    assert!(sanitize_entry_path("\\\\server\\share\\x").is_err());
}

fn pack_sanitize_accepts_normal() {
    assert_eq!(
        sanitize_entry_path("db/zh/character/1001.json").unwrap(),
        PathBuf::from("db").join("zh").join("character").join("1001.json")
    );
    // 反斜杠统一成正斜杠后仍然合法
    assert_eq!(
        sanitize_entry_path("img\\item\\71000.webp").unwrap(),
        PathBuf::from("img").join("item").join("71000.webp")
    );
    // `./` 被忽略
    assert_eq!(
        sanitize_entry_path("./meta.json").unwrap(),
        PathBuf::from("meta.json")
    );
}

fn pack_meta_rejects_schema() {
    let dir = TempDir::new("meta-schema-bad");
    fs::write(
        dir.path().join("meta.json"),
        format!(
            r#"{{"packId":"hsr-4.7.51-local","gameVersion":"4.7.51","schemaVersion":99,"counts":{}}}"#,
            EXPECTED_COUNTS_JSON
        ),
    )
    .expect("写入失败");
    let error = read_meta(dir.path()).expect_err("schemaVersion 应被拒绝");
    assert_eq!(format!("{:?}", error.code), "PackIncompatibleSchema");
}

fn pack_meta_accepts_schema() {
    let dir = TempDir::new("meta-schema-ok");
    fs::write(
        dir.path().join("meta.json"),
        format!(
            r#"{{"packId":"hsr-4.7.51-local","gameVersion":"4.7.51","schemaVersion":1,"counts":{}}}"#,
            EXPECTED_COUNTS_JSON
        ),
    )
    .expect("写入失败");
    let meta = read_meta(dir.path()).expect("应通过校验");
    assert_eq!(meta.pack_id, BUILTIN_PACK_ID);
    assert_eq!(meta.game_version, "4.7.51");
    assert_eq!(meta.schema_version, SUPPORTED_SCHEMA_VERSION);
}

fn pack_meta_rejects_counts() {
    let dir = TempDir::new("meta-counts-bad");
    fs::write(
        dir.path().join("meta.json"),
        br#"{"packId":"hsr-4.7.51-local","gameVersion":"4.7.51","schemaVersion":1,
             "counts":{"character":100,"lightcone":174,"relicset":64,"monster":666,
                       "monsterGroups":382,"item":1606,"achievement":2022,"achievementSeries":9}}"#,
    )
    .expect("写入失败");
    let error = read_meta(dir.path()).expect_err("计数不符应被拒绝");
    assert_eq!(format!("{:?}", error.code), "PackCorrupt");
    assert!(error
        .detail
        .unwrap_or_default()
        .contains("character=100"));
}

fn pack_counts_mismatch_first() {
    let mut counts = EXPECTED_COUNTS.clone();
    assert_eq!(counts_mismatch(&counts), None);
    counts.item = 1;
    assert_eq!(
        counts_mismatch(&counts).as_deref(),
        Some("counts.item=1，期望 1606")
    );
}

fn pack_read_stats() {
    let dir = TempDir::new("read-stats");
    fs::create_dir_all(dir.path().join("db/item")).expect("建目录失败");
    fs::write(
        dir.path().join("meta.json"),
        format!(
            r#"{{"packId":"hsr-4.7.51-local","gameVersion":"4.7.51","schemaVersion":1,"counts":{}}}"#,
            EXPECTED_COUNTS_JSON
        ),
    )
    .expect("写入失败");
    // 夹具必须照抄真实形状：**数组**，元素里 `name` 是字符串、多语言在 `names`。
    // 曾经这里写成 `{"1001":{"name":{"zh":…}}}`（对象 + name 是对象），两层都错，
    // 于是夹具永远通过、真机 sampleCharacter 永远 None。
    fs::write(
        dir.path().join("db/character.json"),
        r#"[{"id":"1001","name":"三月七","names":{"zh":"三月七","en":"March 7th"}},{"id":"1002","name":"丹恒","names":{"zh":"丹恒","en":"Dan Heng"}}]"#.as_bytes(),
    )
    .expect("写入失败");
    fs::write(dir.path().join("db/lightcone.json"), br#"{"20000":{}}"#).expect("写入失败");
    for shard in 0..ITEM_SHARD_COUNT {
        let body = if shard == 0 { "[]" } else { "[{},{}]" };
        fs::write(dir.path().join(format!("db/item/{shard}.json")), body).expect("写入失败");
    }

    let stats = read_stats(dir.path()).expect("读取统计失败");
    assert_eq!(stats.characters, 2);
    assert_eq!(stats.lightcones, 1);
    assert_eq!(stats.items, 2 * (ITEM_SHARD_COUNT - 1));
    assert_eq!(
        stats.sample_character.as_deref(),
        Some("三月七"),
        "应取 names.zh（首个条目）"
    );
    assert_eq!(stats.declared.character, EXPECTED_COUNTS.character);
}

fn pack_read_stats_falls_back_to_name() {
    // 只给单语言（没有 names）时退回 `name` 字符串
    let dir = TempDir::new("read-stats-fallback");
    fs::create_dir_all(dir.path().join("db/item")).expect("建目录失败");
    fs::write(
        dir.path().join("meta.json"),
        format!(
            r#"{{"packId":"hsr-4.7.51-local","gameVersion":"4.7.51","schemaVersion":1,"counts":{}}}"#,
            EXPECTED_COUNTS_JSON
        ),
    )
    .expect("写入失败");
    fs::write(
        dir.path().join("db/character.json"),
        r#"[{"id":"1001","name":"三月七"}]"#.as_bytes(),
    )
    .expect("写入失败");
    fs::write(dir.path().join("db/lightcone.json"), br#"{}"#).expect("写入失败");
    for shard in 0..ITEM_SHARD_COUNT {
        fs::write(dir.path().join(format!("db/item/{shard}.json")), "[]").expect("写入失败");
    }

    let stats = read_stats(dir.path()).expect("读取统计失败");
    assert_eq!(stats.sample_character.as_deref(), Some("三月七"));
}

fn pack_pointer_roundtrip() {
    let dir = TempDir::new("pointer");
    let path = dir.path().join("active.json");
    let pointer = PackPointer {
        pack_id: BUILTIN_PACK_ID.to_string(),
        root: "C:/x/packs/hsr".to_string(),
        game_version: "4.7.51".to_string(),
        schema_version: SUPPORTED_SCHEMA_VERSION,
        installed_at: 42,
        archive_bytes: 77_000_000,
        entry_count: 7359,
        source: "builtin".to_string(),
    };
    write_json_atomic(&path, &pointer).expect("写入失败");
    let loaded: PackPointer = read_json_or_default(&path).expect("读取失败");
    assert_eq!(loaded, pointer);
}

fn pack_state_initial() {
    let state = PackState::default();
    match state.snapshot() {
        PackStatus::Failed { code, .. } => assert_eq!(code, "PACK_NOT_FOUND"),
        other => panic!("初始状态应为 Failed，实际 {other:?}"),
    }
}

fn pack_read_stats_accepts_object_container() {
    // 容器是对象时也要能取到（将来若改成 id -> brief 的映射形态，这条兜住）
    let dir = TempDir::new("read-stats-object");
    fs::create_dir_all(dir.path().join("db/item")).expect("建目录失败");
    fs::write(
        dir.path().join("meta.json"),
        format!(
            r#"{{"packId":"hsr-4.7.51-local","gameVersion":"4.7.51","schemaVersion":1,"counts":{}}}"#,
            EXPECTED_COUNTS_JSON
        ),
    )
    .expect("写入失败");
    fs::write(
        dir.path().join("db/character.json"),
        r#"{"1001":{"id":"1001","name":"三月七","names":{"zh":"三月七"}}}"#.as_bytes(),
    )
    .expect("写入失败");
    fs::write(dir.path().join("db/lightcone.json"), br#"{}"#).expect("写入失败");
    for shard in 0..ITEM_SHARD_COUNT {
        fs::write(dir.path().join(format!("db/item/{shard}.json")), "[]").expect("写入失败");
    }

    let stats = read_stats(dir.path()).expect("读取统计失败");
    assert_eq!(stats.sample_character.as_deref(), Some("三月七"));
}

// --- datapack.rs -----------------------------------------------------------

/// 造一个「形状对」的最小数据包目录：meta 计数用编译期期望值，
/// 索引文件内容故意很小（2 角色 / 1 光锥 / 30 物品 …），
/// 因为 `read_meta` 只校验 meta 自洽，不比对实际条数。
fn fixture_pack(label: &str) -> TempDir {
    let dir = TempDir::new(label);
    let root = dir.path();
    fs::create_dir_all(root.join("db/item")).expect("建目录失败");
    fs::write(
        root.join("meta.json"),
        format!(
            r#"{{"packId":"hsr-4.7.51-local","gameVersion":"4.7.51","schemaVersion":1,"counts":{}}}"#,
            EXPECTED_COUNTS_JSON
        ),
    )
    .expect("写入 meta 失败");
    fs::write(
        root.join("db/character.json"),
        r#"[{"id":"1001","name":"三月七","names":{"zh":"三月七"}},{"id":"1002","name":"丹恒","names":{"zh":"丹恒"}}]"#,
    )
    .expect("写入 character 失败");
    fs::write(root.join("db/lightcone.json"), r#"[{"id":"20000","name":"锋镝"}]"#)
        .expect("写入 lightcone 失败");
    fs::write(root.join("db/relicset.json"), r#"[{"id":"101","name":"云无留迹的过客"}]"#)
        .expect("写入 relicset 失败");
    fs::write(root.join("db/monster.json"), r#"[{"groupKey":"冰锋"}]"#)
        .expect("写入 monster 失败");
    fs::write(
        root.join("db/achievement.json"),
        r#"[{"id":"1","name":"我，开拓者"}]"#,
    )
    .expect("写入 achievement 失败");
    for shard in 0..ITEM_SHARD_COUNT {
        let body = if shard == 0 { "[]" } else { "[{},{}]" };
        fs::write(root.join(format!("db/item/{shard}.json")), body).expect("写入 item 分片失败");
    }
    dir
}

fn datapack_rejects_traversal() {
    let pack = fixture_pack("dal-traversal");
    for bad in ["../meta.json", "C:/Windows/x.json", "/etc/passwd", ""] {
        let error = datapack::read_json_at(pack.path(), bad).expect_err("应拒绝该路径");
        assert_eq!(
            format!("{:?}", error.code),
            "PackInvalidPath",
            "路径 {bad:?} 应报 PACK_INVALID_PATH，实际 {:?}",
            error.code
        );
    }
    // 合法路径能读到（对照组，避免"全都拒绝"也能过）
    let value = datapack::read_json_at(pack.path(), "meta.json").expect("应能读 meta.json");
    assert_eq!(value["gameVersion"], "4.7.51");
}

fn datapack_missing_file() {
    let pack = fixture_pack("dal-missing");
    let error = datapack::read_json_at(pack.path(), "db/zh/character/9999.json")
        .expect_err("文件不存在应报错");
    assert_eq!(format!("{:?}", error.code), "PackFileMissing");
}

fn datapack_bad_json() {
    let pack = fixture_pack("dal-badjson");
    fs::write(pack.path().join("db/broken.json"), b"{ not json").expect("写入失败");
    let error = datapack::read_json_at(pack.path(), "db/broken.json").expect_err("应报解析错误");
    assert_eq!(format!("{:?}", error.code), "PackCorrupt");
}

fn datapack_index_merges_shards() {
    let pack = fixture_pack("dal-index");
    let index = datapack::read_index_at(pack.path()).expect("读索引失败");

    assert_eq!(index.characters.len(), 2);
    assert_eq!(index.lightcones.len(), 1);
    assert_eq!(index.relicsets.len(), 1);
    assert_eq!(index.monsters.len(), 1);
    assert_eq!(index.achievement_series.len(), 1);
    // 16 个分片，0 号是空数组，其余各 2 条
    assert_eq!(index.items.len(), 2 * (ITEM_SHARD_COUNT - 1));
    assert_eq!(index.counts_of_modules().len(), 6);
    assert_eq!(index.pack_id, BUILTIN_PACK_ID);
    assert_eq!(index.schema_version, SUPPORTED_SCHEMA_VERSION);
}

fn datapack_index_missing_shard() {
    let pack = fixture_pack("dal-shard-missing");
    fs::remove_file(pack.path().join("db/item/7.json")).expect("删除分片失败");
    let error = datapack::read_index_at(pack.path()).expect_err("缺分片应报错");
    assert_eq!(format!("{:?}", error.code), "PackFileMissing");
    assert!(
        error.detail.unwrap_or_default().contains("db/item/7.json"),
        "detail 里应指明是哪一片"
    );
}

fn datapack_cache_keyed_by_root() {
    let a = fixture_pack("dal-cache-a");
    let b = fixture_pack("dal-cache-b");
    // b 只有 1 个角色，用来区分缓存命中的是谁
    fs::write(b.path().join("db/character.json"), r#"[{"id":"8001"}]"#).expect("写入失败");

    let cache = IndexCache::default();
    let key_a = a.path().display().to_string();
    let key_b = b.path().display().to_string();

    assert!(cache.get(&key_a).is_none(), "空缓存不应命中");

    let index_a = datapack::read_index_at(a.path()).expect("读 a 失败");
    cache.put(&key_a, &index_a);
    assert_eq!(cache.get(&key_a).map(|i| i.characters.len()), Some(2));

    // 换 root 必须未命中（这正是"换包自动失效"的机制）
    assert!(cache.get(&key_b).is_none(), "换 root 后不应命中旧缓存");

    let index_b = datapack::read_index_at(b.path()).expect("读 b 失败");
    assert_eq!(index_b.characters.len(), 1);
    cache.put(&key_b, &index_b);
    assert_eq!(cache.get(&key_b).map(|i| i.characters.len()), Some(1));

    cache.clear();
    assert!(cache.get(&key_a).is_none(), "clear 后不应命中");
    assert!(cache.get(&key_b).is_none(), "clear 后不应命中");
}

// --- userdata.rs -----------------------------------------------------------

/// 一份「前端真实会写出的形状」的收藏内容（字段照 `src/lib/userdata/types.ts`）。
const FAVORITES_SAMPLE: &str = r#"{"character:1001":{"module":"character","id":"1001","nameSnapshot":{"zh":"三月七","en":"March 7th"},"packId":"hsr-4.7.51-local","addedAt":"2026-11-15T05:00:00.000Z","group":null,"order":0}}"#;

fn userdata_write_read_roundtrip() {
    let dir = TempDir::new("userdata-roundtrip");
    let path = dir.path().join(UserDataName::Favorites.file_name());

    userdata::write_at(&path, UserDataName::Favorites, FAVORITES_SAMPLE).expect("写入失败");
    let read_back = userdata::read_at(&path, UserDataName::Favorites).expect("读取失败");
    assert_eq!(read_back.as_deref(), Some(FAVORITES_SAMPLE), "原文必须逐字一致");

    // 原子写的临时文件必须已被 rename 掉，否则说明中途失败还留了半成品
    let tmp = dir.path().join(".favorites.json.tmp");
    assert!(!tmp.exists(), "不应残留 .favorites.json.tmp");

    // 覆盖写：旧内容不能有任何残留
    let second = r#"{"character:1001":{"module":"character","id":"1001","nameSnapshot":{"zh":"三月七"},"packId":"hsr-4.7.51-local","addedAt":"2026-11-15T05:00:01.000Z","group":null,"order":0},"character:1002":{"module":"character","id":"1002","nameSnapshot":{"zh":"丹恒"},"packId":"hsr-4.7.51-local","addedAt":"2026-11-15T05:00:02.000Z","group":null,"order":1}}"#;
    userdata::write_at(&path, UserDataName::Favorites, second).expect("覆盖写失败");
    assert_eq!(
        userdata::read_at(&path, UserDataName::Favorites)
            .expect("二次读取失败")
            .as_deref(),
        Some(second)
    );
}

fn userdata_missing_returns_none() {
    let dir = TempDir::new("userdata-missing");
    let path = dir.path().join(UserDataName::Notes.file_name());

    let value = userdata::read_at(&path, UserDataName::Notes).expect("读取失败");
    assert!(value.is_none(), "文件不存在应返回 None");
    // 关键：读不该顺手创建文件（否则首启就会在 userdata 里留一堆空文件）
    assert!(!path.exists(), "读操作不应创建文件");
}

fn userdata_corrupt_backs_up_and_rebuilds() {
    let dir = TempDir::new("userdata-corrupt");
    let path = dir.path().join(UserDataName::Notes.file_name());
    let garbage = r#"{"character:1001":{"content":"写了一半就断电"#;
    fs::write(&path, garbage).expect("写入坏内容失败");

    let value = userdata::read_at(&path, UserDataName::Notes).expect("损坏文件不该让读失败");
    assert!(value.is_none(), "损坏时返回 None，由前端用默认值");

    let bak = bak_path_for(&path);
    assert!(bak.exists(), "坏文件必须被备份为 .bak");
    assert_eq!(
        fs::read_to_string(&bak).expect("读备份失败"),
        garbage,
        "备份必须是坏文件的原文，不能是「修复后」的内容"
    );

    let rebuilt = fs::read_to_string(&path).expect("重建后的文件应存在");
    assert_eq!(rebuilt, "{}", "应重建为默认内容（对象）");

    // 重建后必须能正常读回（下次启动不再走恢复路径）
    assert_eq!(
        userdata::read_at(&path, UserDataName::Notes).expect("重建后读取失败"),
        Some("{}".to_string())
    );
}

fn userdata_wrong_shape_is_corrupt() {
    let dir = TempDir::new("userdata-shape");
    let path = dir.path().join(UserDataName::Prefs.file_name());
    // 合法 JSON，但顶层是数组 —— 手改文件很容易造成这种状态
    fs::write(&path, "[]").expect("写入失败");

    assert_eq!(
        userdata::read_at(&path, UserDataName::Prefs).expect("形状不符不该让读失败"),
        None
    );
    assert!(bak_path_for(&path).exists(), "形状不符也要留 .bak");
    assert_eq!(fs::read_to_string(&path).expect("读取失败"), "{}");

    // recent 反过来必须是数组
    let recent = dir.path().join(UserDataName::Recent.file_name());
    fs::write(&recent, "{}").expect("写入失败");
    assert_eq!(
        userdata::read_at(&recent, UserDataName::Recent).expect("读取失败"),
        None
    );
    assert_eq!(fs::read_to_string(&recent).expect("读取失败"), "[]");
}

fn userdata_rejects_unknown_name() {
    for good in ["prefs", "favorites", "notes", "recent"] {
        assert!(UserDataName::parse(good).is_ok(), "{good} 应被接受");
    }
    for bad in ["", "PREFS", "../prefs", "prefs.json", "active", "packs"] {
        let error = UserDataName::parse(bad).expect_err("应被拒绝");
        assert_eq!(
            error.code,
            ErrorCode::UserdataInvalidName,
            "{bad} 的错误码不对"
        );
    }
}

fn userdata_rejects_bad_content() {
    let dir = TempDir::new("userdata-bad-content");
    let prefs = dir.path().join(UserDataName::Prefs.file_name());

    let not_json = userdata::write_at(&prefs, UserDataName::Prefs, "{oops")
        .expect_err("非法 JSON 应被拒绝");
    assert_eq!(not_json.code, ErrorCode::UserdataInvalidContent);

    let wrong_shape = userdata::write_at(&prefs, UserDataName::Prefs, "[]")
        .expect_err("顶层形状不符应被拒绝");
    assert_eq!(wrong_shape.code, ErrorCode::UserdataInvalidContent);

    let recent = dir.path().join(UserDataName::Recent.file_name());
    let recent_wrong = userdata::write_at(&recent, UserDataName::Recent, "{}")
        .expect_err("recent 应为数组");
    assert_eq!(recent_wrong.code, ErrorCode::UserdataInvalidContent);

    // 被拒绝的写入一个字节都不许落盘：否则下次启动会把"我们自己的错"当损坏恢复
    assert!(!prefs.exists(), "拒绝写入后不应创建文件");
    assert!(!recent.exists(), "拒绝写入后不应创建文件");
}
