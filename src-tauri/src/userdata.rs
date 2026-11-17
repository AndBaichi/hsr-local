//! 用户数据读写（架构文档 §2.3、§5.4 `userdata.rs`）
//!
//! 五个文件，全部在 `$APPDATA/userdata/` 下，与数据包目录**物理隔离**——
//! 导入/回滚/删包永不触碰这里（架构文档 §1.2 ④）。
//!
//! | 文件 | 顶层形状 | 写入方 |
//! |---|---|---|
//! | `prefs.json` | 对象 | 偏好（主题/语言/侧栏/每页条数/对比列表） |
//! | `favorites.json` | 对象 | 收藏，`Record<entityKey, FavoriteEntry>` |
//! | `notes.json` | 对象 | 笔记，`Record<entityKey, NoteEntry>` |
//! | `recent.json` | 数组 | 最近浏览（上限 40） |
//! | `ratings.json` | 对象 | 货币战争条目评级与备注，`Record<"currency:{kind}:{id}", { grade?, tier?, remark? }>`（v2.1 为裸档位字符串，v2.2 起升级为对象，前端 `coerceRatings` 兼容旧值） |
//! | `localnotes.json` | 对象 | 本地便签，`{ notes: LocalNote[] }`；图片/附件本体在 `$APPDATA/notes/media/`，这里只存元数据 |
//!
//! ## 为什么内容用 String 直传
//!
//! 字段结构由前端 `src/lib/userdata/types.ts` 定义。Rust 只做两件事：
//! ① 原子写（`atomic::write_atomic`：tmp → fsync → rename）；
//! ② 挡住"会毁数据"的写入（非法 JSON、顶层形状不对）。
//!
//! 如果在这里定义结构体，加一个字段就要两侧同步改，而且旧版本应用读到新版本
//! 写出的文件时会因为 `deny_unknown_fields` 之外的字段被静默丢弃——用户数据
//! 不该有这种"被应用理解不了就丢掉"的风险。
//!
//! ## 损坏恢复
//!
//! 读：`atomic::read_json_text` 三态（Missing / Corrupt / Valid）。
//!  - Missing → 返回 `None`，前端用自己的默认值，**不落盘**（避免首启就写一堆空文件）
//!  - Corrupt → 备份 `.bak` + 立刻用默认内容重建（这样下次启动不会再走一遍恢复路径）
//!  - Valid   → 原样返回文本

use std::path::PathBuf;
use std::sync::Mutex;

use tauri::{AppHandle, Runtime};
use tauri_plugin_opener::OpenerExt;

use crate::atomic::{self, JsonTextRead};
use crate::error::AppError;
use crate::paths;

/// 单个用户数据文件的内容上限（4 MiB）。
///
/// notes.json 预估 <200KB，4MiB 是给"某个用户疯狂写笔记"留的余量；
/// 超过它说明调错了接口（比如把整包数据写进来了），直接拒绝比写进磁盘更好。
const MAX_CONTENT_BYTES: usize = 4 * 1024 * 1024;

/// 串行化所有用户数据写入。
///
/// 为什么需要：`atomic::write_atomic` 的临时文件名是 `.{file}.tmp`，
/// 两个并发写同一个文件会互相覆盖临时文件，rename 时可能搬走对方的半成品。
/// 写入本身都很小（<200KB），串行化没有性能问题。
static WRITE_LOCK: Mutex<()> = Mutex::new(());

/// 允许访问的用户数据文件（白名单）。
///
/// **白名单而不是路径拼接**：`name` 来自前端，把它拼进路径就多了一个
/// "将来有人传 `../../active.json`"的攻击面。这里枚举固定，拼不出别的路径。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UserDataName {
    /// 偏好
    Prefs,
    /// 收藏
    Favorites,
    /// 笔记
    Notes,
    /// 最近浏览
    Recent,
    /// 货币战争评级
    Ratings,
    /// 本地便签（带图片/附件元数据）
    LocalNotes,
}

impl UserDataName {
    /// 把 IPC 传来的字符串解析成枚举。
    ///
    /// # Errors
    /// 名字不在白名单内返回 `USERDATA_INVALID_NAME`
    pub fn parse(raw: &str) -> Result<Self, AppError> {
        match raw {
            "prefs" => Ok(Self::Prefs),
            "favorites" => Ok(Self::Favorites),
            "notes" => Ok(Self::Notes),
            "recent" => Ok(Self::Recent),
            "ratings" => Ok(Self::Ratings),
            "localnotes" => Ok(Self::LocalNotes),
            other => Err(AppError::userdata_invalid_name(other)),
        }
    }

    /// 文件名里的主干名（`prefs` → `prefs`）。
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Prefs => "prefs",
            Self::Favorites => "favorites",
            Self::Notes => "notes",
            Self::Recent => "recent",
            Self::Ratings => "ratings",
            Self::LocalNotes => "localnotes",
        }
    }

    /// 磁盘文件名（`prefs.json`）。
    pub fn file_name(self) -> String {
        format!("{}.json", self.as_str())
    }

    /// 顶层形状是否符合预期。
    ///
    /// 只校验"对象 vs 数组"这一层，**不校验字段**——字段演进归前端管，
    /// 这一层校验的目的是挡住"把 Record 写成数组"这种会立刻炸掉前端的错误。
    ///
    /// # Errors
    /// 形状不符返回 `USERDATA_INVALID_CONTENT`
    pub fn check_shape(self, value: &serde_json::Value) -> Result<(), AppError> {
        let ok = match self {
            Self::Prefs
            | Self::Favorites
            | Self::Notes
            | Self::Ratings
            | Self::LocalNotes => value.is_object(),
            Self::Recent => value.is_array(),
        };
        if ok {
            Ok(())
        } else {
            let expected = if matches!(self, Self::Recent) {
                "数组"
            } else {
                "对象"
            };
            Err(AppError::userdata_invalid_content(
                self.as_str(),
                format!("顶层应为{expected}"),
            ))
        }
    }

    /// 损坏后重建用的默认内容。
    pub fn default_content(self) -> &'static str {
        match self {
            Self::Prefs | Self::Favorites | Self::Notes | Self::Ratings | Self::LocalNotes => "{}",
            Self::Recent => "[]",
        }
    }
}

/// 单个用户数据文件的绝对路径。
///
/// # Errors
/// 应用数据目录无法解析
pub fn path_for<R: Runtime>(app: &AppHandle<R>, name: UserDataName) -> Result<PathBuf, AppError> {
    Ok(paths::userdata_dir(app)?.join(name.file_name()))
}

/// 读取用户数据原文（按路径）。
///
/// 返回 `None` 表示"没有可用数据"——文件不存在，或内容损坏且已重建。
/// 两种情况下前端都应该用自己的默认值，**所以不区分**（区别只写进日志）。
///
/// 单独拆出 `_at` 版本是为了让 `selftest` 能在临时目录里跑真实读写：
/// 断言的是同一段代码，不是另一套"测试专用实现"。
///
/// # Errors
/// 目录不可读、备份/重建失败等 IO 层错误
pub fn read_at(path: &std::path::Path, name: UserDataName) -> Result<Option<String>, AppError> {
    match atomic::read_json_text(path)? {
        JsonTextRead::Valid(text) => {
            // 文件在、JSON 合法，但顶层形状可能被手改坏了（比如把 {} 改成 []）。
            // 这种也算"没有可用数据"，走同一条重建路径。
            match serde_json::from_str::<serde_json::Value>(&text) {
                Ok(value) => match name.check_shape(&value) {
                    Ok(()) => Ok(Some(text)),
                    Err(error) => {
                        backup_and_rebuild(path, name, &format!("顶层形状不符: {error}"))?;
                        Ok(None)
                    }
                },
                Err(_) => {
                    // `read_json_text` 已经判过合法性，这里理论上到不了；
                    // 到不了也要有确定行为，不能 panic。
                    backup_and_rebuild(path, name, "二次解析失败")?;
                    Ok(None)
                }
            }
        }
        JsonTextRead::Missing => Ok(None),
        JsonTextRead::Corrupt { backup } => {
            eprintln!(
                "[hsr] userdata/{} 损坏，已备份={:?}，将重建为默认内容",
                name.file_name(),
                backup
            );
            atomic::write_atomic(path, name.default_content().as_bytes())?;
            Ok(None)
        }
    }
}

/// 读取用户数据原文。
///
/// # Errors
/// 应用数据目录无法解析；其余见 [`read_at`]
pub fn read<R: Runtime>(app: &AppHandle<R>, name: UserDataName) -> Result<Option<String>, AppError> {
    read_at(&path_for(app, name)?, name)
}

/// 备份坏文件并重建为默认内容（形状不符时使用）。
///
/// # Errors
/// 重建写入失败
fn backup_and_rebuild(
    path: &std::path::Path,
    name: UserDataName,
    reason: &str,
) -> Result<(), AppError> {
    let backup = atomic::bak_path_for(path);
    let copied = std::fs::copy(path, &backup).is_ok();
    eprintln!(
        "[hsr] userdata/{} {reason}，备份={}，将重建为默认内容",
        name.file_name(),
        if copied { "成功" } else { "失败" }
    );
    atomic::write_atomic(path, name.default_content().as_bytes())
}

/// 写入用户数据（原子，按路径）。
///
/// 写之前先验证内容，因为**坏内容写进去 = 下次启动丢数据**
/// （读取侧会把坏文件当损坏、备份后重建为空）。
///
/// # Errors
/// 内容不是 JSON / 顶层形状不符 / 超过体积上限 / 磁盘写入失败
pub fn write_at(
    path: &std::path::Path,
    name: UserDataName,
    content: &str,
) -> Result<(), AppError> {
    if content.len() > MAX_CONTENT_BYTES {
        return Err(AppError::userdata_invalid_content(
            name.as_str(),
            format!("内容 {} 字节，超过上限 {}", content.len(), MAX_CONTENT_BYTES),
        ));
    }

    let value: serde_json::Value = serde_json::from_str(content).map_err(|error| {
        AppError::userdata_invalid_content(name.as_str(), format!("不是合法 JSON: {error}"))
    })?;
    name.check_shape(&value)?;

    // 锁中毒（持锁线程 panic）时仍然继续：宁可冒"两个写并发"的极小风险，
    // 也不要因为一次历史 panic 让用户从此存不了收藏。
    let _guard = WRITE_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    atomic::write_atomic(path, content.as_bytes())
}

/// 写入用户数据（原子）。
///
/// # Errors
/// 应用数据目录无法解析；其余见 [`write_at`]
pub fn write<R: Runtime>(
    app: &AppHandle<R>,
    name: UserDataName,
    content: &str,
) -> Result<(), AppError> {
    write_at(&path_for(app, name)?, name, content)
}

/// 在系统文件管理器里打开用户数据目录。
///
/// 「设置 → 打开数据目录」用它排障（架构文档 P1-08）。
///
/// # Errors
/// 目录无法创建，或系统拒绝打开
pub fn open_folder<R: Runtime>(app: &AppHandle<R>) -> Result<(), AppError> {
    let dir = paths::userdata_dir(app)?;
    if !dir.exists() {
        std::fs::create_dir_all(&dir).map_err(|error| {
            AppError::userdata_write_failed(format!("创建目录失败 {}: {error}", dir.display()))
        })?;
    }
    app.opener()
        .open_path(dir.to_string_lossy().to_string(), None::<&str>)
        .map_err(|error| {
            AppError::new(
                crate::error::ErrorCode::IoFailed,
                "无法打开用户数据目录",
            )
            .with_detail(format!("{}: {error}", dir.display()))
        })
}

/// 读取用户数据原文（`None` = 无可用数据，前端用默认值）。
///
/// # Errors
/// 见 [`read`]
#[tauri::command]
pub fn userdata_read(app: AppHandle, name: String) -> Result<Option<String>, AppError> {
    read(&app, UserDataName::parse(&name)?)
}

/// 原子写入用户数据。
///
/// # Errors
/// 见 [`write`]
#[tauri::command]
pub fn userdata_write(app: AppHandle, name: String, content: String) -> Result<(), AppError> {
    write(&app, UserDataName::parse(&name)?, &content)
}

/// 在文件管理器里打开用户数据目录。
///
/// # Errors
/// 见 [`open_folder`]
#[tauri::command]
pub fn userdata_open_folder(app: AppHandle) -> Result<(), AppError> {
    open_folder(&app)
}
