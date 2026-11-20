/**
 * 当前跃迁（UP 卡池）数据。
 *
 * 官方没有开放的卡池 API；这里用社区维护的 Project HLITH 数据：
 * 它每天从官方公告/米游社/ wiki 汇总卡池开始结束时间与 featured id。
 * 只取**当前正在 UP** 的卡池，不展示未来排期，避免爆料争议。
 *
 * 请求失败时回落到上次成功的 localStorage 缓存；都没有就整块隐藏。
 */

/** 数据源（raw GitHub，自动更新） */
export const BANNERS_SOURCE_URL =
  'https://raw.githubusercontent.com/HymnToHimeros/PROJECT-HLITH/main/src/games/hsr/data/banners.json';

/** 数据源项目页（用于署名） */
export const BANNERS_SOURCE_PAGE = 'https://github.com/HymnToHimeros/PROJECT-HLITH';

/** 缓存 key */
const CACHE_KEY = 'hsr.banners.cache.v1';

/** 缓存时长：6 小时 */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/** 远端的单条卡池 */
export interface RemoteBanner {
  readonly id: string;
  readonly type: string;
  readonly title: string;
  readonly featured: readonly string[];
  readonly start: string;
  readonly end: string;
  readonly permanent?: boolean;
}

/** 归一化后的当前卡池 */
export interface ActiveBanner {
  readonly id: string;
  readonly kind: 'character' | 'lightcone';
  readonly title: string;
  readonly featured: readonly string[];
  readonly start: number;
  readonly end: number;
}

/** 缓存形状 */
interface BannerCache {
  readonly fetchedAt: number;
  readonly rows: readonly RemoteBanner[];
}

/** 读取缓存 */
function readCache(): BannerCache | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (raw === null) return undefined;
    const parsed = JSON.parse(raw) as Partial<BannerCache>;
    if (typeof parsed.fetchedAt !== 'number' || !Array.isArray(parsed.rows)) return undefined;
    return { fetchedAt: parsed.fetchedAt, rows: parsed.rows as RemoteBanner[] };
  } catch {
    return undefined;
  }
}

/** 写入缓存 */
function writeCache(rows: readonly RemoteBanner[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), rows }));
  } catch {
    // 忽略存储失败
  }
}

/** 校验一行远端数据 */
function parseRow(value: unknown): RemoteBanner | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string' || typeof row.type !== 'string') return undefined;
  if (typeof row.title !== 'string' || typeof row.start !== 'string' || typeof row.end !== 'string') {
    return undefined;
  }
  if (!Array.isArray(row.featured)) return undefined;
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    featured: row.featured.map(String),
    start: row.start,
    end: row.end,
    permanent: row.permanent === true,
  };
}

/** 把远端行转成当前卡池 */
function toActive(row: RemoteBanner, now: number): ActiveBanner | undefined {
  if (row.permanent === true) return undefined;
  const start = Date.parse(row.start);
  const end = Date.parse(row.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= now || start > now) return undefined;
  const kind =
    row.type === 'character' || row.type === 'collab-character'
      ? 'character'
      : row.type === 'light-cone' || row.type === 'collab-light-cone'
        ? 'lightcone'
        : undefined;
  if (kind === undefined || row.featured.length === 0) return undefined;
  return { id: row.id, kind, title: row.title, featured: row.featured, start, end };
}

/**
 * 读取当前卡池。
 *
 * @param now 当前时间戳（便于测试）
 */
export async function loadActiveBanners(now: number = Date.now()): Promise<readonly ActiveBanner[]> {
  const cached = readCache();
  let rows = cached?.rows;

  const fresh = cached !== undefined && now - cached.fetchedAt < CACHE_TTL_MS;
  if (!fresh) {
    try {
      const response = await fetch(BANNERS_SOURCE_URL, { cache: 'no-store' });
      if (response.ok) {
        const json: unknown = await response.json();
        if (Array.isArray(json)) {
          const parsed = json.map(parseRow).filter((row): row is RemoteBanner => row !== undefined);
          if (parsed.length > 0) {
            rows = parsed;
            writeCache(parsed);
          }
        }
      }
    } catch {
      // 离线：用缓存
    }
  }

  if (rows === undefined) return [];
  return rows
    .map((row) => toActive(row, now))
    .filter((row): row is ActiveBanner => row !== undefined)
    .sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === 'character' ? -1 : 1;
      return left.start - right.start;
    });
}
