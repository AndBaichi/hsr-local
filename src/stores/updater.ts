/**
 * 数据包更新状态机（v4.8）
 *
 * 阶段：
 *  `idle` → `checking` → `up-to-date` / `available` / `app-outdated` / `error`
 *  `available` → `downloading` → `installing` → `ready`
 *
 * 设计取舍：
 *  - **默认只提示、不自动下载**：78 MB 对流量/弱网不友好，必须在设置里显式开启
 *    `autoUpdate` 才会在检查到新版本后自动下载；
 *  - 检查做 24 小时节流（启动时静默检查一次），手动检查不受限制；
 *  - 下载/安装全部在 Rust 侧完成，前端只收进度事件，不在 WebView 里缓存 78 MB；
 *  - 安装成功后 Rust 已经把 `active.json` 指向新包并刷新了内存状态，前端只需
 *    `location.reload()` 让 BootGuard 重新读索引。
 */

import { invoke } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { create } from 'zustand';

import {
  compareVersions,
  fetchUpdateManifest,
  type UpdateManifest,
} from '@/lib/update/manifest';
import { dal } from '@/lib/data/dal';
import { useSettingsStore } from '@/stores/settings';

/** 最近一次检查时间（localStorage，避免每次启动都打网络） */
const LAST_CHECK_KEY = 'hsr.update.lastCheckAt';

/** 最近一次从远端看到的游戏数据版本（跨重启保留，供首页展示） */
const LATEST_VERSION_KEY = 'hsr.update.latestVersion';

/** 自动检查间隔：24 小时 */
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** 更新阶段 */
export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'app-outdated'
  | 'downloading'
  | 'installing'
  | 'ready'
  | 'error';

/** Rust `InstallResult` 的前端映射 */
export interface InstallResult {
  readonly packId: string;
  readonly gameVersion: string;
  readonly schemaVersion: number;
  readonly root: string;
  readonly source: string;
  readonly installedAt: number;
}

/** 下载/解包进度事件 */
interface UpdateProgressEvent {
  readonly phase: 'download' | 'extract';
  readonly downloaded: number;
  readonly total: number;
}

/** store 状态 */
interface UpdateState {
  /** 当前阶段 */
  phase: UpdatePhase;
  /** 最近一次成功拉到的 manifest */
  manifest?: UpdateManifest;
  /** 安装成功后的结果 */
  installed?: InstallResult;
  /** 错误文案（Rust 抛出的稳定中文/英文短句） */
  error?: string;
  /** 已下载字节 */
  downloaded: number;
  /** 总字节（未知时 0） */
  total: number;
  /** 最近一次检查完成时间（毫秒） */
  lastCheckedAt?: number;
  /** 最近一次从远端 manifest 看到的游戏数据版本 */
  latestVersion?: string;
  /** 用户忽略过的版本（banner 不再提示） */
  dismissedVersion?: string;
  /** 是否存在可回滚的上一版 */
  hasPrevious: boolean;
  /** 检查更新；`manual=false` 时走 24h 节流且静默失败 */
  check: (manual?: boolean) => Promise<void>;
  /** 下载并安装当前 manifest */
  download: () => Promise<void>;
  /** 从本地 `.hsrpack` 安装 */
  installFile: (path: string) => Promise<void>;
  /** 回滚到上一版 */
  rollback: () => Promise<void>;
  /** 刷新「是否有上一版」 */
  refreshPrevious: () => Promise<void>;
  /** 忽略当前版本的 banner */
  dismiss: () => void;
}

/** 读取上次检查时间 */
function readLastCheck(): number | undefined {
  if (typeof window === 'undefined') return undefined;
  const raw = window.localStorage.getItem(LAST_CHECK_KEY);
  const value = raw === null ? NaN : Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

/** 读取最近一次远端数据版本 */
function readLatestVersion(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  const value = window.localStorage.getItem(LATEST_VERSION_KEY);
  return value === null || value.trim() === '' ? undefined : value;
}

/** 写入最近一次远端数据版本 */
function writeLatestVersion(value: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LATEST_VERSION_KEY, value);
  } catch {
    // 忽略存储失败
  }
}

/** 写入上次检查时间 */
function writeLastCheck(value: number): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LAST_CHECK_KEY, String(value));
  } catch {
    // localStorage 不可用不影响更新流程
  }
}

/** 从任意异常里提取可展示短句 */
function errorMessage(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

/** 正在执行不可打断操作的阶段 */
function isBusy(phase: UpdatePhase): boolean {
  return phase === 'checking' || phase === 'downloading' || phase === 'installing';
}

/** 数据包更新 store */
export const useUpdaterStore = create<UpdateState>((set, get) => ({
  phase: 'idle',
  downloaded: 0,
  total: 0,
  lastCheckedAt: readLastCheck(),
  latestVersion: readLatestVersion(),
  hasPrevious: false,

  check: async (manual = false) => {
    const state = get();
    if (isBusy(state.phase)) return;
    // 有 lastCheckedAt 但没有 latestVersion：说明是旧版本升级上来的，
    // 本地还没存过“远端最新版本”；即使 24h 内检查过也补查一次，首页才能对上。
    if (!manual && state.lastCheckedAt !== undefined && state.latestVersion !== undefined) {
      if (Date.now() - state.lastCheckedAt < CHECK_INTERVAL_MS) return;
    }

    set({ phase: 'checking', error: undefined });
    try {
      const manifest = await fetchUpdateManifest();
      const currentVersion = dal.bootInfo?.gameVersion ?? '';
      if (currentVersion === '') {
        // 启动门禁还没就绪时不把「未知」当成「有更新」
        set({ phase: 'idle' });
        return;
      }
      const appVersion = await getVersion().catch(() => '');
      const checkedAt = Date.now();
      writeLastCheck(checkedAt);
      writeLatestVersion(manifest.gameVersion);
      set({ latestVersion: manifest.gameVersion });

      if (appVersion !== '' && compareVersions(manifest.minAppVersion, appVersion) > 0) {
        set({ phase: 'app-outdated', manifest, lastCheckedAt: checkedAt });
        return;
      }

      if (compareVersions(manifest.gameVersion, currentVersion) > 0) {
        set({ phase: 'available', manifest, lastCheckedAt: checkedAt });
        if (useSettingsStore.getState().prefs.autoUpdate) {
          void get().download();
        }
        return;
      }

      set({ phase: 'up-to-date', manifest, lastCheckedAt: checkedAt });
    } catch (error) {
      // 启动时的静默检查失败不打扰用户；手动检查才显示错误
      if (manual) {
        set({ phase: 'error', error: errorMessage(error) });
      } else {
        set({ phase: 'idle' });
      }
    }
  },

  download: async () => {
    const { manifest, phase } = get();
    if (manifest === undefined || isBusy(phase)) return;
    set({
      phase: 'downloading',
      downloaded: 0,
      total: manifest.archiveBytes,
      error: undefined,
    });

    let unlisten: UnlistenFn | undefined;
    try {
      unlisten = await listen<UpdateProgressEvent>('hsr://update-progress', (event) => {
        const progress = event.payload;
        set({
          phase: progress.phase === 'extract' ? 'installing' : 'downloading',
          downloaded: progress.downloaded,
          total: progress.total > 0 ? progress.total : manifest.archiveBytes,
        });
      });

      const installed = await invoke<InstallResult>('datapack_install_from_url', {
        url: manifest.url,
        sha256: manifest.sha256,
        bytes: manifest.archiveBytes,
      });
      const hasPrevious = await invoke<boolean>('datapack_has_previous');
      set({ phase: 'ready', installed, hasPrevious });
    } catch (error) {
      set({ phase: 'error', error: errorMessage(error) });
    } finally {
      unlisten?.();
    }
  },

  installFile: async (path) => {
    if (isBusy(get().phase)) return;
    set({ phase: 'installing', downloaded: 0, total: 0, error: undefined });
    let unlisten: UnlistenFn | undefined;
    try {
      unlisten = await listen<UpdateProgressEvent>('hsr://update-progress', (event) => {
        const progress = event.payload;
        if (progress.phase === 'extract') {
          set({ phase: 'installing', downloaded: progress.downloaded, total: progress.total });
        }
      });
      const installed = await invoke<InstallResult>('datapack_install_file', { path });
      const hasPrevious = await invoke<boolean>('datapack_has_previous');
      set({ phase: 'ready', installed, hasPrevious });
    } catch (error) {
      set({ phase: 'error', error: errorMessage(error) });
    } finally {
      unlisten?.();
    }
  },

  rollback: async () => {
    if (isBusy(get().phase)) return;
    set({ phase: 'installing', downloaded: 0, total: 0, error: undefined });
    try {
      const installed = await invoke<InstallResult>('datapack_rollback');
      set({ phase: 'ready', installed, hasPrevious: false });
    } catch (error) {
      set({ phase: 'error', error: errorMessage(error) });
    }
  },

  refreshPrevious: async () => {
    try {
      const hasPrevious = await invoke<boolean>('datapack_has_previous');
      set({ hasPrevious });
    } catch {
      set({ hasPrevious: false });
    }
  },

  dismiss: () => {
    const manifest = get().manifest;
    if (manifest !== undefined) set({ dismissedVersion: manifest.gameVersion });
  },
}));
