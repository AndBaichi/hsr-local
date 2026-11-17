/**
 * 用户数据 IPC 封装（架构文档 §2.3、§8.5 `src/lib/ipc/userdata.ts`）
 *
 * ## 职责边界
 *
 * 这一层**只知道"名字 → JSON 文本"**，不认识收藏/笔记/偏好的字段结构。
 * 结构校验在 `src/lib/userdata/types.ts`，业务动作在各自的 store。
 * 好处：将来加第五个用户数据文件（比如 `tags.json`）只需要在这里加一行防抖间隔。
 *
 * ## 为什么读返回的是 raw 文本
 *
 * Rust 侧只保证"我交给你的是合法 JSON 且顶层形状对"。解析成 TS 类型由 `coerce*`
 * 负责——因为**版本演进发生在 TS 侧**：旧版本写出的文件少了新字段时，
 * Rust 不该因此报错，该由 `coerce` 补默认值。
 *
 * ## 防抖间隔从哪来
 *
 * 架构文档 §2.3 的写入策略表：
 *  - prefs 300ms（<1KB，改动不频繁）
 *  - favorites 200ms（点收藏应该"立刻"有反应）
 *  - notes 600ms（PRD P0-16 要求「1 秒内落盘」，600ms 防抖 + 40% 余量）
 *  - recent 1000ms（浏览记录，丢失一条无感）
 *  - ratings 200ms（同一个"点一下就该记住"的语气，与收藏一致）
 *  - localnotes 600ms（便签正文同样是边写边存，与实体笔记同档）
 *
 * 另外在 `visibilitychange`（页签隐藏）与 `pagehide` 强制 flush：笔记输入后
 * 用户直接关窗口时，remaining 的时间窗口不能被浪费掉。
 */

import { invoke } from '@tauri-apps/api/core';

/** 6 个用户数据文件名 */
export type UserDataName =
  | 'prefs'
  | 'favorites'
  | 'notes'
  | 'recent'
  | 'ratings'
  | 'localnotes';

/** 各文件的写入防抖间隔（ms），见模块文档 */
const DEBOUNCE_MS: Readonly<Record<UserDataName, number>> = {
  prefs: 300,
  favorites: 200,
  notes: 600,
  recent: 1000,
  ratings: 200,
  // 便签正文也是"边写边存"，与实体笔记同档；附件元数据只有增删，跟着走即可
  localnotes: 600,
};

/** 待写入的值与定时器 */
interface PendingWrite {
  /** 定时器句柄 */
  timer: ReturnType<typeof setTimeout>;
  /** 待写入的 JSON 文本 */
  payload: string;
}

/** 挂起中的写入（每个文件最多一个） */
const pending = new Map<UserDataName, PendingWrite>();

/** 钩子是否已安装（重复调用 `installUserDataFlushHooks` 只生效一次） */
let hooksInstalled = false;

/**
 * 把值序列化成紧凑 JSON。
 *
 * 用户数据不做美化：体积更小，且 diff 时"整文件一行"更容易看出是应用写的。
 *
 * @param value 任意可序列化值
 */
function stringify(value: unknown): string {
  return JSON.stringify(value);
}

/**
 * 读取用户数据原文。
 *
 * @param name 文件名（不含扩展名）
 * @returns 合法 JSON 的原文；文件不存在或已损坏重建时返回 `undefined`
 */
export async function readUserDataRaw(name: UserDataName): Promise<string | undefined> {
  const raw = await invoke<string | null>('userdata_read', { name });
  return raw ?? undefined;
}

/**
 * 读取并解析用户数据。
 *
 * 解析失败返回 `undefined`（Rust 已保证是合法 JSON，走到这里说明 IPC 层异常，
 * 不该让整个应用挂掉）。调用方应把它当"没有数据"处理。
 *
 * @param name 文件名（不含扩展名）
 * @returns 解析后的任意值
 */
export async function readUserData(name: UserDataName): Promise<unknown> {
  const raw = await readUserDataRaw(name);
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn(`[userdata] ${name}.json 解析失败（Rust 已校验过，属于异常）`, error);
    }
    return undefined;
  }
}

/**
 * 立即写入（不防抖）。
 *
 * @param name 文件名
 * @param value 待写入值
 */
async function writeNow(name: UserDataName, payload: string): Promise<void> {
  await invoke('userdata_write', { name, content: payload });
}

/**
 * 防抖写入用户数据。
 *
 * 同一文件的连续调用只保留最后一次的值。写入失败时 **保留 payload**，
 * 下一次 flush 会重试——收藏这种"用户以为已经存下了"的数据不能静默丢失。
 *
 * @param name 文件名
 * @param value 待写入值
 */
export function scheduleWriteUserData(name: UserDataName, value: unknown): void {
  const payload = stringify(value);
  const existing = pending.get(name);
  if (existing !== undefined) {
    clearTimeout(existing.timer);
  }

  const timer = setTimeout(() => {
    // 先从表里摘掉再写：写完失败时按下面的逻辑重新挂回去
    const current = pending.get(name);
    if (current === undefined) return;
    pending.delete(name);
    void writeNow(name, current.payload).catch((error: unknown) => {
      if (import.meta.env.DEV) {
        console.warn(`[userdata] 写入 ${name}.json 失败，等待下次 flush 重试`, error);
      }
      // 只有"没有更新的 payload 在排队"时才挂回去，避免覆盖用户刚改的新值
      if (!pending.has(name)) {
        const retry = setTimeout(() => {
          const queued = pending.get(name);
          if (queued === undefined) return;
          pending.delete(name);
          void writeNow(name, queued.payload).catch(() => undefined);
        }, 2_000);
        pending.set(name, { timer: retry, payload });
      }
    });
  }, DEBOUNCE_MS[name]);

  pending.set(name, { timer, payload });
}

/**
 * 冲刷挂起的写入。
 *
 * @param name 只冲刷某个文件；不传则冲刷全部
 */
export async function flushUserData(name?: UserDataName): Promise<void> {
  const names: UserDataName[] =
    name === undefined ? (Object.keys(DEBOUNCE_MS) as UserDataName[]) : [name];
  const writes: Promise<void>[] = [];

  for (const item of names) {
    const queued = pending.get(item);
    if (queued === undefined) continue;
    clearTimeout(queued.timer);
    pending.delete(item);
    writes.push(writeNow(item, queued.payload));
  }

  await Promise.all(writes);
}

/**
 * 安装"页签隐藏 / 卸载前"的尽力而为冲刷钩子（只装一次）。
 *
 * `pagehide` 覆盖"刷新"，`visibilitychange` 覆盖"切到后台/最小化"。
 *
 * ⚠️ **真正的关窗拦截不在这里**：因为要插入「询问 / 收纳至托盘 / 退出」三个分支，
 * 它需要读偏好、弹窗、调托盘命令，已移到 `src/lib/windowBehavior.ts`。
 * 本函数只保留与业务无关的那部分，`windowBehavior` 在关窗前会调用 `flushUserData()`。
 */
export function installUserDataFlushHooks(): void {
  if (hooksInstalled || typeof window === 'undefined') return;
  hooksInstalled = true;

  const flush = (): void => {
    void flushUserData();
  };

  window.addEventListener('pagehide', flush);
  window.addEventListener('beforeunload', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
}

/** 判断是否运行在 Tauri 里（浏览器直开 vite 时没有 IPC / 窗口 API） */
function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * 在文件管理器里打开用户数据目录（设置页排障用）。
 */
export async function openUserDataFolder(): Promise<void> {
  if (!isTauri()) return;
  await invoke('userdata_open_folder');
}

/**
 * 清空所有挂起写入（仅测试/诊断用）。
 */
export function resetUserDataQueue(): void {
  for (const queued of pending.values()) {
    clearTimeout(queued.timer);
  }
  pending.clear();
}
