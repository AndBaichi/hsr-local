/**
 * 公告 / 资讯数据层单测（`npm test`）
 *
 * ## 为什么这些用例必须存在
 *
 * 这条链路是全项目**唯一**的运行期联网点，且它的失败模式全都是「不崩溃、
 * 只是显示错」——接口改字段名会让卡片静默变空，`retcode` 变化会让页面
 * 显示一条来自错误响应的假标题。所以这里的向量都按「真实返回结构」构造
 * （`post_id` 是字符串、`created_at` 是秒），而不是随手写的假数据。
 *
 * ## 为什么不测 React hook
 *
 * 项目没有 jsdom，`useNewsFeeds` 依赖 `window.localStorage` 与 React 渲染。
 * 这里把纯逻辑（归一化 + 缓存读写）覆盖到位，hook 留给实机验证。
 */

import { describe, expect, it, vi } from 'vitest';

import { CACHE_KEY, readCache, writeCache, type CacheStorage } from './cache';
import { articleUrl, fetchNewsItems, normalizeNewsPayload, type NewsItem } from './miyoushe';

/** 构造一条真实结构的列表项 */
function entry(id: string, subject: string, createdAt: number): unknown {
  return { post: { post_id: id, subject, created_at: createdAt }, forum: {}, topics: [] };
}

/** 构造一份真实结构的响应 */
function payload(list: readonly unknown[], retcode = 0): unknown {
  return { retcode, message: retcode === 0 ? 'OK' : 'Invalid params', data: { list, is_last: false } };
}

/** 内存版存储（替代 localStorage） */
function memoryStorage(): CacheStorage & { readonly dump: Map<string, string> } {
  const dump = new Map<string, string>();
  return {
    dump,
    getItem: (key) => dump.get(key) ?? null,
    setItem: (key, value) => {
      dump.set(key, value);
    },
  };
}

describe('normalizeNewsPayload', () => {
  it('抽出 id / 标题 / 时间，并按时间倒序截断', () => {
    const result = normalizeNewsPayload(
      payload([
        entry('79504324', '4.7版本游戏优化及已知问题说明', 1794000000),
        entry('79609173', '【2026年11月16日】账号封禁公示', 1794823213),
        entry('79482327', '4.7版本版本更新说明', 1793000000),
      ]),
      2,
    );

    expect(result).toEqual([
      { id: '79609173', title: '【2026年11月16日】账号封禁公示', createdAt: 1794823213 },
      { id: '79504324', title: '4.7版本游戏优化及已知问题说明', createdAt: 1794000000 },
    ]);
  });

  it('retcode 非 0 时抛错（不能把错误响应当数据）', () => {
    expect(() => normalizeNewsPayload(payload([], 10001), 5)).toThrow(/retcode=10001/);
  });

  it('data.list 不是数组时抛错', () => {
    expect(() => normalizeNewsPayload({ retcode: 0, data: { list: null } }, 5)).toThrow(/data\.list/);
    expect(() => normalizeNewsPayload({ retcode: 0, data: {} }, 5)).toThrow(/data\.list/);
    expect(() => normalizeNewsPayload(null, 5)).toThrow(/JSON 对象/);
  });

  it('单条脏数据只跳过该条，其余照常返回', () => {
    const result = normalizeNewsPayload(
      payload([
        entry('79609173', '正常条目', 1794823213),
        { post: { post_id: '79', subject: '   ', created_at: 1794823213 } }, // 空标题
        { post: { subject: '缺 id', created_at: 1794823213 } }, // 缺 post_id
        { post: { post_id: '79504324', subject: '时间不是数字', created_at: '1794823213' } },
        { notPost: true },
        'garbage',
        entry('79500000', '另一条正常条目', 1794000000),
      ]),
      5,
    );

    expect(result.map((item) => item.id)).toEqual(['79609173', '79500000']);
  });

  it('limit 为 0 时返回空数组（不返回全部）', () => {
    expect(normalizeNewsPayload(payload([entry('1', 'a', 1)]), 0)).toEqual([]);
  });
});

describe('articleUrl', () => {
  it('拼出米游社星穹铁道文章页', () => {
    expect(articleUrl('79609173')).toBe('https://www.miyoushe.com/sr/article/79609173');
  });
});

describe('fetchNewsItems', () => {
  it('HTTP 非 2xx 时抛错', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('boom', { status: 502 })),
    );
    await expect(fetchNewsItems('notice')).rejects.toThrow(/HTTP 502/);
    vi.unstubAllGlobals();
  });

  it('成功时返回归一化结果，并向公告端点带 type=1', async () => {
    const spy = vi.fn(async (_input: RequestInfo | URL) => new Response(JSON.stringify(payload([entry('1', '公告标题', 100)]))));
    vi.stubGlobal('fetch', spy);

    await expect(fetchNewsItems('notice')).resolves.toEqual([
      { id: '1', title: '公告标题', createdAt: 100 },
    ]);

    const requested = spy.mock.calls[0]?.[0];
    expect(String(requested)).toContain('type=1');
    expect(String(requested)).toContain('gids=6');
    vi.unstubAllGlobals();
  });

  it('资讯走 type=3', async () => {
    const spy = vi.fn(async (_input: RequestInfo | URL) => new Response(JSON.stringify(payload([entry('2', '资讯标题', 100)]))));
    vi.stubGlobal('fetch', spy);

    await fetchNewsItems('news');
    expect(String(spy.mock.calls[0]?.[0])).toContain('type=3');
    vi.unstubAllGlobals();
  });
});

describe('缓存', () => {
  const feed = { fetchedAt: 1_764_000_000_000, items: [{ id: '1', title: '标题', createdAt: 100 }] };

  it('写入后能读回，且两类互不覆盖', () => {
    const storage = memoryStorage();
    writeCache('notice', feed, storage);
    writeCache('news', { fetchedAt: 2, items: [{ id: '2', title: '资讯', createdAt: 200 }] }, storage);

    const cache = readCache(storage);
    expect(cache.notice).toEqual(feed);
    expect(cache.news?.items).toHaveLength(1);
    expect(storage.dump.has(CACHE_KEY)).toBe(true);
  });

  it('坏 JSON / 结构不符时当没有缓存，不抛错', () => {
    const storage = memoryStorage();
    storage.dump.set(CACHE_KEY, '{ not json');
    expect(readCache(storage)).toEqual({});

    storage.dump.set(CACHE_KEY, JSON.stringify({ notice: { fetchedAt: 'x', items: [] } }));
    expect(readCache(storage)).toEqual({});

    // 条目字段坏掉时只丢该条
    storage.dump.set(
      CACHE_KEY,
      JSON.stringify({
        notice: { fetchedAt: 1, items: [{ id: '1', title: 'a', createdAt: 1 }, { id: '', title: 'b', createdAt: 1 }] },
      }),
    );
    expect(readCache(storage).notice?.items).toHaveLength(1);
  });

  it('setItem 抛错时不向外抛（隐私模式 / 配额满）', () => {
    const storage: CacheStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(() => writeCache('notice', feed, storage)).not.toThrow();
  });

  it('没有存储时读写都安全', () => {
    expect(readCache(undefined)).toEqual({});
    expect(() => writeCache('notice', feed, undefined)).not.toThrow();
  });
});

/** 类型断言：NewsItem 结构不被意外放宽 */
const _typeCheck: NewsItem = { id: '1', title: 't', createdAt: 0 };
void _typeCheck;
