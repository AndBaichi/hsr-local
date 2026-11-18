/**
 * 偏好设置 store（架构文档 §2.3、§8.5）
 *
 * 持久化策略（**双写，各司其职**）：
 *  - `localStorage`：**同步**镜像。启动时 `main.tsx` 必须同步拿到主题/语言才能避免首帧闪白，
 *    而 IPC 是异步的。所以 localStorage 是"首帧不闪"的保证。
 *  - `userdata/prefs.json`：**权威副本**（PRD §7.3 要求用户数据可迁移、可备份）。
 *    经 Rust `atomic.rs`（tmp → fsync → rename）写入，300ms 防抖。
 *
 * 两者冲突时以 localStorage 为准（它才是用户在本机最后一次操作的结果）；
 * 只有 localStorage 空着（新机器、清了站点数据、从别人那拷贝了 userdata 目录）时，
 * 才用 `hydratePrefsFromUserdata()` 从 `prefs.json` 水合——这条路径同时也是
 * 「用户数据可迁移」得以成立的唯一实现。
 *
 * 任何读取都必须容错：prefs 损坏时回落到 `DEFAULT_PREFS`，绝不能让启动失败。
 */

import { create } from 'zustand';

import { readUserData, scheduleWriteUserData } from '@/lib/ipc/userdata';
import { applyCursorTheme, DEFAULT_CURSOR_THEME, type CursorTheme } from '@/lib/cursorTheme';
import { MODULE_KEYS } from '@/lib/userdata/types';
import { DEFAULT_LANGUAGE, normalizeLang, setI18nLanguage, type Lang } from '@/i18n';
import { DEFAULT_THEME_MODE, type ThemeMode } from '@/theme/tokens';

/** 持久化 key。必须与 index.html 的内联防闪烁脚本一致 */
export const PREFS_STORAGE_KEY = 'hsr.prefs.v1';

/** 偏好 schema 版本；结构不兼容时据此重建 */
export const PREFS_SCHEMA_VERSION = 1;

/**
 * 点击标题栏关闭按钮时的行为。
 *
 * - `ask`：还没问过——关窗时弹一次窗，用户选完记住（首次启动的默认值）
 * - `tray`：收纳至托盘（窗口隐藏，进程与托盘图标继续存在）
 * - `quit`：直接退出应用
 */
export type CloseAction = 'ask' | 'tray' | 'quit';

/** 偏好数据（整体写入，<1KB） */
export interface Prefs {
  /** 结构版本 */
  schemaVersion: number;
  /** 主题模式：深色 / 浅色 / 跟随系统 */
  themeMode: ThemeMode;
  /** 界面与实体数据语言 */
  lang: Lang;
  /** 左侧导航是否折叠为图标态 */
  sidebarCollapsed: boolean;
  /** 列表每页/每批渲染条数 */
  listPageSize: number;
  /** 是否启用全局快捷键（P1-05） */
  shortcutsEnabled: boolean;
  /**
   * 对比页已选实体键（上限 10，v2.9 起）。
   *
   * 元素是 `{module}:{id}` 复合键（与收藏/笔记的 `EntityKey` 同构），
   * 支持资料库六模块任意混合。v2.9 之前存的是纯角色 id（无冒号），
   * 读取时由 `coercePrefs` 自动迁移为 `character:{id}`。
   */
  compareIds: string[];
  /** 关窗行为（首次为 `ask`，问过一次后固定为用户的选择） */
  closeAction: CloseAction;
  /** 鼠标指针主题（v2.16：内置银狼指针，可切回系统） */
  cursorTheme: CursorTheme;
  /** 发现新数据包时是否自动下载（v4.8；默认只提示，不偷跑流量） */
  autoUpdate: boolean;
}

/** 默认偏好 */
export const DEFAULT_PREFS: Readonly<Prefs> = {
  schemaVersion: PREFS_SCHEMA_VERSION,
  themeMode: DEFAULT_THEME_MODE,
  lang: DEFAULT_LANGUAGE,
  sidebarCollapsed: false,
  listPageSize: 60,
  shortcutsEnabled: true,
  compareIds: [],
  closeAction: 'ask',
  cursorTheme: DEFAULT_CURSOR_THEME,
  autoUpdate: false,
};

/** 列表每页条数的合法范围 */
const LIST_PAGE_SIZE_MIN = 20;
const LIST_PAGE_SIZE_MAX = 200;

/** 对比上限（v2.9：4 → 10，支持六模块混合） */
export const COMPARE_LIMIT = 10;

/**
 * 迁移并校验对比键列表。
 *
 * - 无冒号的旧格式（v2.8 及更早）按「角色 id」升级为 `character:{id}`
 * - 模块前缀不在白名单内的脏数据直接丢弃（不整份推翻 prefs）
 * - 去重后截断到上限
 *
 * @param raw 未校验的原始数组
 */
function migrateCompareIds(raw: readonly unknown[]): string[] {
  const result: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string' || entry === '') continue;
    const key = entry.includes(':') ? entry : `character:${entry}`;
    const separator = key.indexOf(':');
    const module = key.slice(0, separator);
    const id = key.slice(separator + 1);
    if (id === '' || !(MODULE_KEYS as readonly string[]).includes(module)) continue;
    if (!result.includes(key)) result.push(key);
    if (result.length >= COMPARE_LIMIT) break;
  }
  return result;
}

/** prefs 写入防抖句柄 */
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * 判断某个值是否是合法主题模式（当前仅 dark；旧的 light/system 会被迁回 dark）。
 *
 * @param value 待判定值
 */
function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'dark';
}

/**
 * 判断某个值是否是合法关窗行为。
 *
 * 只认两个「用户已选定」的值；`ask` 不在此列——它只作为默认值存在，
 * 一旦落盘就说明用户已经选过，不会再回到询问状态（除非重置设置）。
 *
 * @param value 待判定值
 */
function isCloseAction(value: unknown): value is CloseAction {
  return value === 'tray' || value === 'quit';
}

/**
 * 把任意对象收敛为合法 `Prefs`。
 *
 * 逐字段校验而不是整体信任，这样即使将来手改 JSON 里的一个字段也不会整份丢弃。
 *
 * @param raw 解析得到的原始对象
 */
function coercePrefs(raw: unknown): Prefs {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_PREFS };
  const source = raw as Record<string, unknown>;

  const themeMode = isThemeMode(source.themeMode) ? source.themeMode : DEFAULT_PREFS.themeMode;
  const lang = normalizeLang(source.lang);

  const sidebarCollapsed =
    typeof source.sidebarCollapsed === 'boolean'
      ? source.sidebarCollapsed
      : DEFAULT_PREFS.sidebarCollapsed;

  const rawPageSize = typeof source.listPageSize === 'number' ? source.listPageSize : NaN;
  const listPageSize = Number.isFinite(rawPageSize)
    ? Math.min(LIST_PAGE_SIZE_MAX, Math.max(LIST_PAGE_SIZE_MIN, Math.round(rawPageSize)))
    : DEFAULT_PREFS.listPageSize;

  const shortcutsEnabled =
    typeof source.shortcutsEnabled === 'boolean'
      ? source.shortcutsEnabled
      : DEFAULT_PREFS.shortcutsEnabled;

  const compareIds = Array.isArray(source.compareIds)
    ? migrateCompareIds(source.compareIds)
    : [...DEFAULT_PREFS.compareIds];

  const closeAction = isCloseAction(source.closeAction)
    ? source.closeAction
    : DEFAULT_PREFS.closeAction;

  const cursorTheme: CursorTheme =
    source.cursorTheme === 'silverwolf' || source.cursorTheme === 'system'
      ? source.cursorTheme
      : DEFAULT_PREFS.cursorTheme;

  const autoUpdate =
    typeof source.autoUpdate === 'boolean' ? source.autoUpdate : DEFAULT_PREFS.autoUpdate;

  return {
    schemaVersion: PREFS_SCHEMA_VERSION,
    themeMode,
    lang,
    sidebarCollapsed,
    listPageSize,
    shortcutsEnabled,
    compareIds,
    closeAction,
    cursorTheme,
    autoUpdate,
  };
}

/**
 * 读取持久化的偏好。
 *
 * 损坏 / 不可用（隐私模式、存储被清）时静默回落默认值，
 * 这是启动路径上唯一的容错点，不允许抛异常。
 */
export function readPersistedPrefs(): Prefs {
  if (typeof window === 'undefined') return { ...DEFAULT_PREFS };
  try {
    const raw = window.localStorage.getItem(PREFS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    return coercePrefs(JSON.parse(raw) as unknown);
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn('[prefs] 读取失败，使用默认偏好', error);
    }
    return { ...DEFAULT_PREFS };
  }
}

/**
 * 立即写入偏好（调用方通常走 `persistPrefs` 的防抖版本）。
 *
 * 同时写两处：localStorage 是同步镜像（首帧要用），`prefs.json` 是可迁移的权威副本。
 * `prefs.json` 走 fire-and-forget：写盘失败不该让一次"切主题"卡住 UI。
 *
 * @param prefs 待写入的偏好
 */
export function writePersistedPrefs(prefs: Prefs): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn('[prefs] 写入 localStorage 失败', error);
    }
  }
  // 架构文档 §2.3：prefs 300ms 防抖后整体写入（间隔在 lib/ipc/userdata.ts 的策略表里）
  scheduleWriteUserData('prefs', prefs);
}

/**
 * 防抖写入偏好（300ms，架构文档 §2.3）。
 *
 * @param prefs 待写入的偏好
 */
export function persistPrefs(prefs: Prefs): void {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
  }
  flushTimer = setTimeout(() => {
    flushTimer = null;
    writePersistedPrefs(prefs);
  }, 300);
}

/** 立即冲刷挂起的写入（关闭窗口前调用，避免丢最后一次改动） */
export function flushPrefs(prefs?: Prefs): void {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (prefs) writePersistedPrefs(prefs);
}

/** store 状态与动作 */
export interface SettingsState {
  /** 当前偏好 */
  prefs: Prefs;
  /** 设置主题模式（并落盘） */
  setThemeMode: (mode: ThemeMode) => void;
  /** 设置语言（同时切换 i18n 与落盘） */
  setLang: (lang: Lang) => void;
  /** 折叠 / 展开侧导航 */
  setSidebarCollapsed: (collapsed: boolean) => void;
  /** 切换侧导航折叠态 */
  toggleSidebar: () => void;
  /** 设置列表每批渲染条数 */
  setListPageSize: (size: number) => void;
  /** 开关快捷键 */
  setShortcutsEnabled: (enabled: boolean) => void;
  /** 覆盖对比选中列表（自动截断到上限 10） */
  setCompareIds: (ids: string[]) => void;
  /** 设置关窗行为（询问 / 收纳至托盘 / 直接退出） */
  setCloseAction: (action: CloseAction) => void;
  /** 设置鼠标指针主题（v2.16） */
  setCursorTheme: (theme: CursorTheme) => void;
  /** 开关「自动下载数据包更新」（v4.8） */
  setAutoUpdate: (enabled: boolean) => void;
  /** 恢复默认偏好 */
  resetPrefs: () => void;
}

/**
 * 把偏好变更同步到副作用（i18n）并按防抖落盘。
 *
 * @param next 变更后的完整偏好
 */
function commit(next: Prefs): Prefs {
  persistPrefs(next);
  return next;
}

/** 偏好 store */
export const useSettingsStore = create<SettingsState>()((set, get) => ({
  prefs: readPersistedPrefs(),

  setThemeMode: (mode) => {
    if (!isThemeMode(mode)) return;
    set({ prefs: commit({ ...get().prefs, themeMode: mode }) });
  },

  setLang: (lang) => {
    const next = normalizeLang(lang);
    set({ prefs: commit({ ...get().prefs, lang: next }) });
    // i18n 切换是异步的，但不在 UI 关键路径上：失败只影响文案，不影响数据
    void setI18nLanguage(next);
  },

  setSidebarCollapsed: (collapsed) => {
    set({ prefs: commit({ ...get().prefs, sidebarCollapsed: collapsed }) });
  },

  toggleSidebar: () => {
    set({ prefs: commit({ ...get().prefs, sidebarCollapsed: !get().prefs.sidebarCollapsed }) });
  },

  setListPageSize: (size) => {
    const clamped = Math.min(LIST_PAGE_SIZE_MAX, Math.max(LIST_PAGE_SIZE_MIN, Math.round(size)));
    set({ prefs: commit({ ...get().prefs, listPageSize: clamped }) });
  },

  setShortcutsEnabled: (enabled) => {
    set({ prefs: commit({ ...get().prefs, shortcutsEnabled: enabled }) });
  },

  setCompareIds: (ids) => {
    set({ prefs: commit({ ...get().prefs, compareIds: ids.slice(0, COMPARE_LIMIT) }) });
  },

  setCloseAction: (action) => {
    // `ask` 只能来自默认值 / 重置：不从这里写回去，避免「选完又变回未询问」
    if (action !== 'ask' && !isCloseAction(action)) return;
    set({ prefs: commit({ ...get().prefs, closeAction: action }) });
  },

  setCursorTheme: (theme) => {
    if (theme !== 'silverwolf' && theme !== 'system') return;
    // 先应用再落盘：指针是即时反馈，不该等 300ms 防抖
    applyCursorTheme(theme);
    set({ prefs: commit({ ...get().prefs, cursorTheme: theme }) });
  },

  setAutoUpdate: (enabled) => {
    set({ prefs: commit({ ...get().prefs, autoUpdate: enabled }) });
  },

  resetPrefs: () => {
    const next: Prefs = { ...DEFAULT_PREFS };
    applyCursorTheme(next.cursorTheme);
    set({ prefs: commit(next) });
    void setI18nLanguage(next.lang);
  },
}));

/**
 * 读取当前偏好快照（非 React 环境使用，如启动编排）。
 */
export function getPrefsSnapshot(): Prefs {
  return useSettingsStore.getState().prefs;
}

/**
 * 从 `userdata/prefs.json` 水合偏好（只在 localStorage 为空时执行）。
 *
 * 为什么加这个前置条件：localStorage 才是本机最后一次操作的结果，
 * 无条件用 prefs.json 覆盖会让"刚切的主题"在下次启动被旧副本吃掉。
 *
 * @returns 是否真的从文件水合了
 */
export async function hydratePrefsFromUserdata(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  if (window.localStorage.getItem(PREFS_STORAGE_KEY) !== null) return false;

  try {
    const raw = await readUserData('prefs');
    if (raw === undefined) return false;
    const prefs = coercePrefs(raw);
    // 回写镜像，让下一次启动走同步路径
    window.localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs));
    useSettingsStore.setState({ prefs });
    void setI18nLanguage(prefs.lang);
    return true;
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn('[prefs] 从 prefs.json 水合失败，使用默认偏好', error);
    }
    return false;
  }
}
