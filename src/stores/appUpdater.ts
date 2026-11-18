/**
 * 应用自身更新（Tauri Updater，v2.21）
 *
 * 数据包更新走 `updaters.ts`（自己下载 .hsrpack）；这里管的是**程序安装包**更新，
 * 由 `@tauri-apps/plugin-updater` 负责签名校验、下载与安装。
 *
 * 端点固定为 `.../releases/download/app-latest/latest.json`，不跟数据包抢 `latest`
 * Release（数据包仍用 `releases/latest/download/update.json`）。
 *
 * 默认只提示、不自动下载；Windows 上 `downloadAndInstall` 会启动安装器并退出应用。
 */

import { getVersion } from '@tauri-apps/api/app';
import { relaunch } from '@tauri-apps/plugin-process';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { create } from 'zustand';

/** 应用更新检查的节流键 */
const LAST_CHECK_KEY = 'hsr.appUpdate.lastCheckAt';

/** 24 小时 */
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** 应用更新阶段 */
export type AppUpdatePhase =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'installing'
  | 'ready'
  | 'error';

/** store 状态 */
interface AppUpdateState {
  readonly phase: AppUpdatePhase;
  /** 当前程序版本（`app.getVersion()`） */
  readonly currentVersion: string;
  /** 服务端宣布的新版本 */
  readonly latestVersion?: string;
  /** 更新说明 */
  readonly notes?: string;
  /** 已下载字节 */
  readonly downloaded: number;
  /** 总字节（Started 之前为 0） */
  readonly total: number;
  readonly error?: string;
  readonly lastCheckedAt?: number;
  /** 检查更新（manual=false 时 24h 节流、静默失败） */
  readonly check: (manual?: boolean) => Promise<void>;
  /** 下载并安装；Windows 上安装器启动后应用会退出 */
  readonly install: () => Promise<void>;
  /** 安装完成后重启（macOS/Linux 或安装器未自动重启时） */
  readonly restart: () => Promise<void>;
}

/** 当前挂起的 Update 资源（必须在忽略/安装后 close） */
let pending: Update | null = null;

/** 读取上次检查时间 */
function readLastCheck(): number | undefined {
  if (typeof window === 'undefined') return undefined;
  const raw = window.localStorage.getItem(LAST_CHECK_KEY);
  const value = raw === null ? NaN : Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

/** 写入上次检查时间 */
function writeLastCheck(value: number): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LAST_CHECK_KEY, String(value));
  } catch {
    // 忽略存储失败
  }
}

/** 错误转短句 */
function errorMessage(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

/** 应用更新 store */
export const useAppUpdaterStore = create<AppUpdateState>((set, get) => ({
  phase: 'idle',
  currentVersion: '',
  downloaded: 0,
  total: 0,
  lastCheckedAt: readLastCheck(),

  check: async (manual = false) => {
    const state = get();
    if (state.phase === 'checking' || state.phase === 'downloading' || state.phase === 'installing') {
      return;
    }
    if (!manual && state.lastCheckedAt !== undefined) {
      if (Date.now() - state.lastCheckedAt < CHECK_INTERVAL_MS) return;
    }

    set({ phase: 'checking', error: undefined });
    try {
      const currentVersion = await getVersion().catch(() => '');
      const update = await check({ timeout: 20_000 });
      const checkedAt = Date.now();
      writeLastCheck(checkedAt);

      if (update === null) {
        set({ phase: 'up-to-date', currentVersion, lastCheckedAt: checkedAt });
        return;
      }
      if (pending !== null) {
        await pending.close().catch(() => undefined);
      }
      pending = update;
      set({
        phase: 'available',
        currentVersion,
        latestVersion: update.version,
        notes: update.body,
        lastCheckedAt: checkedAt,
      });
    } catch (error) {
      // 启动静默检查失败不打扰用户；手动检查才显示错误
      if (manual) set({ phase: 'error', error: errorMessage(error) });
      else set({ phase: 'idle' });
    }
  },

  install: async () => {
    if (get().phase === 'downloading' || get().phase === 'installing') return;
    let update = pending;
    if (update === null) {
      try {
        update = await check({ timeout: 20_000 });
      } catch (error) {
        set({ phase: 'error', error: errorMessage(error) });
        return;
      }
      if (update === null) {
        set({ phase: 'up-to-date' });
        return;
      }
      pending = update;
    }

    set({ phase: 'downloading', downloaded: 0, total: 0, error: undefined });
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          set({ total: event.data.contentLength ?? 0 });
        } else if (event.event === 'Progress') {
          set((state) => ({ downloaded: state.downloaded + event.data.chunkLength }));
        } else if (event.event === 'Finished') {
          set({ phase: 'installing' });
        }
      });
      // Windows 下通常已经被安装器接管并退出；走到这里说明没自动重启
      set({ phase: 'ready' });
    } catch (error) {
      set({ phase: 'error', error: errorMessage(error) });
    }
  },

  restart: async () => {
    await relaunch();
  },
}));
