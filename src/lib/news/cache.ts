/**
 * 公告 / 资讯的本地缓存（断网兜底）
 *
 * ## 为什么用 localStorage 而不是 Rust 侧 userdata
 *
 * 项目里收藏 / 笔记 / 偏好走 `userdata_read` / `userdata_write`（Rust 侧
 * `UserDataName` 枚举 + `%APPDATA%` 落盘），因为**丢不起**。
 * 这份缓存不同：它是纯展示增强，丢了下次进首页重新拉一次就回来了，
 * 对任何离线功能零影响。为它去扩 `UserDataName` 枚举、改 Rust 命令、
 * 重编整个后端，收益与成本完全不成比例。
 *
 * localStorage 在 Tauri（WebView2）里同样落在应用数据目录，**跨重启保留**，
 * 已经满足「断网时还能看到上次内容」的需求。
 *
 * ## 失败一律静默
 *
 * 隐私模式、配额写满、数据被外部改坏——这些都不该让首页报错，
 * 最差退化成「每次都重新拉」。所以读写全部 try/catch 吞掉。
 */

import type { NewsItem, NewsKind } from './miyoushe';

/** 一份缓存：拉取时间 + 条目 */
export interface CachedFeed {
  /** 拉取成功的本机时间（毫秒，`Date.now()`） */
  readonly fetchedAt: number;
  readonly items: readonly NewsItem[];
}

/** 两类内容的缓存 */
export interface NewsCache {
  readonly notice?: CachedFeed;
  readonly news?: CachedFeed;
}

/**
 * 最小存储接口。
 *
 * 抽成接口是为了单测能注入 `Map` 假实现——项目没有 jsdom，
 * 直接写 `window.localStorage` 在 node 环境会崩。
 */
export interface CacheStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** 缓存键（带版本号，结构变了就换键，旧数据自然失效） */
export const CACHE_KEY = 'hsr.news.cache.v1';

/** 取默认存储；无 `window`（单测）或访问被拒时返回 undefined */
function defaultStorage(): CacheStorage | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/** 校验一份缓存的结构 */
function readFeed(value: unknown): CachedFeed | undefined {
  if (typeof value !== 'object' || value === null) return undefined;

  const record = value as { fetchedAt?: unknown; items?: unknown };
  if (typeof record.fetchedAt !== 'number' || !Number.isFinite(record.fetchedAt)) return undefined;
  if (!Array.isArray(record.items)) return undefined;

  const items: NewsItem[] = [];
  for (const entry of record.items) {
    if (typeof entry !== 'object' || entry === null) continue;
    const item = entry as { id?: unknown; title?: unknown; createdAt?: unknown };
    if (typeof item.id !== 'string' || item.id.length === 0) continue;
    if (typeof item.title !== 'string' || item.title.length === 0) continue;
    if (typeof item.createdAt !== 'number' || !Number.isFinite(item.createdAt)) continue;
    items.push({ id: item.id, title: item.title, createdAt: item.createdAt });
  }

  return { fetchedAt: record.fetchedAt, items };
}

/**
 * 读取缓存。
 *
 * 坏数据（非 JSON、结构不符）一律当「没有缓存」，绝不抛。
 */
export function readCache(storage: CacheStorage | undefined = defaultStorage()): NewsCache {
  if (storage === undefined) return {};

  let raw: string | null;
  try {
    raw = storage.getItem(CACHE_KEY);
  } catch {
    return {};
  }
  if (raw === null || raw.length === 0) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null) return {};

  const record = parsed as { notice?: unknown; news?: unknown };
  const notice = readFeed(record.notice);
  const news = readFeed(record.news);

  const result: { notice?: CachedFeed; news?: CachedFeed } = {};
  if (notice !== undefined) result.notice = notice;
  if (news !== undefined) result.news = news;
  return result;
}

/**
 * 写入一类缓存（读-改-写，保留另一类）。
 *
 * 写失败静默：隐私模式 / 配额满时最差是「下次重新拉」，
 * 不该让用户看到报错。
 */
export function writeCache(
  kind: NewsKind,
  feed: CachedFeed,
  storage: CacheStorage | undefined = defaultStorage(),
): void {
  if (storage === undefined) return;

  const merged = { ...readCache(storage), [kind]: feed };
  try {
    storage.setItem(CACHE_KEY, JSON.stringify(merged));
  } catch {
    // 故意吞掉：缓存写不进去不影响任何功能
  }
}
