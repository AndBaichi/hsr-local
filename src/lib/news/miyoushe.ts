/**
 * 米游社公告 / 资讯拉取（首页「公告」「资讯」两张卡的数据源）
 *
 * ## 为什么直接在前端 fetch
 *
 * 实测 `bbs-api-static.miyoushe.com` 返回 `Access-Control-Allow-Origin: *`，
 * 因此 WebView 里的 `fetch` 不会被 CORS 拦，**不需要**走 Rust 侧代理，
 * 也就不需要新增 `tauri-plugin-http`、不需要改 capabilities 的网络权限。
 * 这是本项目唯一的运行期联网点（游戏数据仍然全量离线），
 * 详见 README「离线承诺」一节。
 *
 * ## 端点（2026-11 实测）
 *
 * ```
 * GET https://bbs-api-static.miyoushe.com/painter/wapi/getNewsList
 *     ?gids=6&page_size=5&type=1&page=1     公告
 *     ?gids=6&page_size=5&type=3&page=1     资讯
 * ```
 *
 * `gids=6` 是「崩坏：星穹铁道」在米游社的板块 id。
 * 注意 **`painter/wapi/getNewsList` 而不是 `post/wapi/getNewsList`**——
 * 后者早已下线并返回 `404 page not found`，网上大量旧教程仍在用它。
 *
 * ## 返回结构（只列用到的字段）
 *
 * ```json
 * { "retcode": 0, "message": "OK",
 *   "data": { "list": [ { "post": { "post_id": "79609173",
 *                                   "subject": "【2026年11月16日】账号封禁公示",
 *                                   "created_at": 1794823213 } } ],
 *             "last_id": "...", "is_last": false } }
 * ```
 *
 * - `post_id` 是**字符串**（不是数字）
 * - `created_at` 是**秒级** Unix 时间戳（不是毫秒）
 *
 * 原文跳转：`https://www.miyoushe.com/sr/article/{post_id}`（已实测 HTTP 200）
 */

/** 两类内容：公告 / 资讯 */
export type NewsKind = 'notice' | 'news';

/** 归一化后的一条新闻 */
export interface NewsItem {
  /** 米游社 post_id，用于拼原文链接 */
  readonly id: string;
  /** 标题（米游社只提供简体中文） */
  readonly title: string;
  /** 发布时间，**秒级** Unix 时间戳（米游社原始单位） */
  readonly createdAt: number;
}

/** 「崩坏：星穹铁道」板块 id */
const GIDS = '6';

/**
 * `type` 参数取值。
 *
 * 实测对照：`1` 公告（版本更新说明 / 优化说明 / 封禁公示）、
 * `2` 活动征集、`3` 资讯（绒绒号 / 周边展示 / 星穹美学速递）、`4` 空。
 * 本项目只用 1 与 3。
 */
export const NEWS_TYPE: Record<NewsKind, 1 | 3> = { notice: 1, news: 3 };

/** 接口地址（`-static` 域是米游社的免登录只读域） */
const ENDPOINT = 'https://bbs-api-static.miyoushe.com/painter/wapi/getNewsList';

/** 单次请求超时：超过就让卡片走缓存兜底，绝不长转圈 */
const TIMEOUT_MS = 8_000;

/** 每张卡默认条数（用户确认 5 条，与「新增角色」区块等高） */
export const NEWS_LIMIT = 5;

/**
 * 拼原文链接。
 *
 * 白名单校验在 `openExternal` 里做（只放行 `https://www.miyoushe.com/sr/`），
 * 这里只负责拼串。
 */
export function articleUrl(id: string): string {
  return `https://www.miyoushe.com/sr/article/${encodeURIComponent(id)}`;
}

/** 从任意值里安全取非空字符串 */
function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** 从「列表项」里取出 `post_id` / `subject` / `created_at` 三元组 */
function readPost(entry: unknown): NewsItem | undefined {
  if (typeof entry !== 'object' || entry === null) return undefined;
  const post = (entry as { post?: unknown }).post;
  if (typeof post !== 'object' || post === null) return undefined;

  const record = post as { post_id?: unknown; subject?: unknown; created_at?: unknown };
  const id = asNonEmptyString(record.post_id);
  const title = asNonEmptyString(record.subject);
  const createdAt = record.created_at;

  // 单条数据不完整就跳过这一条，不让整次拉取失败
  if (id === undefined || title === undefined) return undefined;
  if (typeof createdAt !== 'number' || !Number.isFinite(createdAt)) return undefined;

  return { id, title, createdAt };
}

/**
 * 把接口原始 JSON 归一化成 `NewsItem[]`。
 *
 * 导出是为了单元测试能直接喂构造数据，避免依赖真实网络。
 *
 * 守卫策略分两层：
 *  - **整体性错误**（`retcode !== 0`、`data.list` 不是数组）→ 抛错，让调用方走缓存兜底
 *  - **单条脏数据**（标题空、缺 `post_id`、时间不是数字）→ 跳过该条，其余照常显示
 *
 * @throws 响应不是对象 / `retcode` 非 0 / `data.list` 不是数组
 */
export function normalizeNewsPayload(payload: unknown, limit: number): NewsItem[] {
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('米游社响应不是 JSON 对象');
  }

  const root = payload as { retcode?: unknown; message?: unknown; data?: unknown };
  if (root.retcode !== 0) {
    const message = typeof root.message === 'string' ? root.message : '未知错误';
    throw new Error(`米游社返回错误：retcode=${String(root.retcode)}，${message}`);
  }

  const data = root.data;
  if (typeof data !== 'object' || data === null) {
    throw new Error('米游社响应缺少 data 字段');
  }

  const list = (data as { list?: unknown }).list;
  if (!Array.isArray(list)) {
    throw new Error('米游社响应缺少 data.list 数组');
  }

  const items: NewsItem[] = [];
  for (const entry of list) {
    const item = readPost(entry);
    if (item !== undefined) items.push(item);
  }

  // 接口本身按时间倒序，但这里再排一次：将来加翻页合并时顺序仍然正确
  items.sort((left, right) => right.createdAt - left.createdAt);

  return items.slice(0, Math.max(0, limit));
}

/**
 * 拉取一类新闻。
 *
 * 任何失败（网络断、超时、HTTP 非 2xx、JSON 解析失败、`retcode` 非 0）都统一抛
 * `Error`，调用方只判断成功/失败，不需要分辨错误类型。
 *
 * @throws 见上
 */
export async function fetchNewsItems(kind: NewsKind, limit: number = NEWS_LIMIT): Promise<NewsItem[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, TIMEOUT_MS);

  try {
    const url = `${ENDPOINT}?gids=${GIDS}&page_size=${limit}&type=${NEWS_TYPE[kind]}&page=1`;
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`米游社接口返回 HTTP ${response.status}`);
    }
    const payload: unknown = await response.json();
    return normalizeNewsPayload(payload, limit);
  } finally {
    clearTimeout(timer);
  }
}
