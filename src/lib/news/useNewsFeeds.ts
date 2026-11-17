/**
 * 公告 / 资讯的加载状态机（首页用）
 *
 * ## 状态语义
 *
 * | 状态       | 含义                                   | 卡片底部       |
 * | ---------- | -------------------------------------- | -------------- |
 * | `loading`  | 首次进入且没有缓存，正在拉             | 骨架屏         |
 * | `ready`    | 本次拉取成功                           | 更新于 …       |
 * | `fallback` | 展示的是上次缓存（本次拉取失败或还没回） | 缓存 · …       |
 * | `error`    | 拉取失败且没有缓存可用                 | 失败提示 + 重试 |
 *
 * ## 为什么先进缓存再发请求
 *
 * 首屏不该为网络让路：缓存命中时立刻把内容铺上（`fallback`），
 * 网络回来后再切成 `ready`。这样断网、弱网、接口抽风都不会出现空卡。
 *
 * ## 不轮询
 *
 * 用户要的是「能联网实时更新」，进页面拉一次 + 手动刷新按钮已经满足。
 * 定时轮询会在用户挂机时持续发请求，没有必要。
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { readCache, writeCache } from './cache';
import { fetchNewsItems, NEWS_LIMIT, type NewsItem, type NewsKind } from './miyoushe';

/** 一类内容的状态 */
export type FeedStatus = 'loading' | 'ready' | 'fallback' | 'error';

/** 一类内容的完整状态 */
export interface FeedState {
  readonly status: FeedStatus;
  readonly items: readonly NewsItem[];
  /** 当前展示内容的拉取时间（毫秒）。`error` 时无值 */
  readonly fetchedAt?: number;
}

/** hook 返回值 */
export interface NewsFeeds {
  readonly notice: FeedState;
  readonly news: FeedState;
  /** 已有内容的情况下正在重新拉取（用于禁用刷新按钮 + 转圈） */
  readonly refreshing: boolean;
  /** 手动刷新 */
  refresh(): void;
}

/** 两类内容的固定顺序（并发拉取 + 状态回填都用它） */
const KINDS: readonly NewsKind[] = ['notice', 'news'];

const LOADING: FeedState = { status: 'loading', items: [] };

/**
 * 拉取首页公告与资讯。
 *
 * @param enabled 为 `false` 时完全不发请求（非中文界面不显示这个区块）
 */
export function useNewsFeeds(enabled: boolean): NewsFeeds {
  const [feeds, setFeeds] = useState<Record<NewsKind, FeedState>>({
    notice: LOADING,
    news: LOADING,
  });
  const [refreshing, setRefreshing] = useState(false);

  /**
   * 加载代次。
   *
   * 每次 `load` 自增；响应回来时代次不匹配就丢弃。
   * 这样「刷新两次，前一次后回来」或「语言切换后旧请求才回」都不会写脏状态。
   * 不用 `cancelled` 布尔量，因为它无法区分「第几次」。
   */
  const generation = useRef(0);

  const load = useCallback(async (isRefresh: boolean) => {
    const current = generation.current + 1;
    generation.current = current;
    if (isRefresh) setRefreshing(true);

    // ① 先把缓存铺上，首屏不等网络
    const cached = readCache();
    setFeeds((previous) => {
      const next = { ...previous };
      for (const kind of KINDS) {
        const hit = cached[kind];
        if (hit !== undefined && previous[kind].status !== 'ready') {
          next[kind] = { status: 'fallback', items: hit.items, fetchedAt: hit.fetchedAt };
        }
      }
      return next;
    });

    // ② 两类并发拉，互不阻塞
    await Promise.all(
      KINDS.map(async (kind) => {
        try {
          const items = await fetchNewsItems(kind, NEWS_LIMIT);
          if (generation.current !== current) return;
          const fetchedAt = Date.now();
          writeCache(kind, { fetchedAt, items });
          setFeeds((previous) => ({ ...previous, [kind]: { status: 'ready', items, fetchedAt } }));
        } catch {
          if (generation.current !== current) return;
          setFeeds((previous) => {
            // 已有内容（缓存或上次成功）→ 降级成 fallback，保留旧内容
            if (previous[kind].items.length > 0) {
              return { ...previous, [kind]: { ...previous[kind], status: 'fallback' } };
            }
            const hit = cached[kind];
            if (hit !== undefined) {
              return {
                ...previous,
                [kind]: { status: 'fallback', items: hit.items, fetchedAt: hit.fetchedAt },
              };
            }
            return { ...previous, [kind]: { status: 'error', items: [] } };
          });
        }
      }),
    );

    if (generation.current === current) setRefreshing(false);
  }, []);

  useEffect(() => {
    if (!enabled) return;

    void load(false);

    // 卸载或重新启用时把在途请求作废
    return () => {
      generation.current += 1;
    };
  }, [enabled, load]);

  const refresh = useCallback(() => {
    if (!enabled) return;
    void load(true);
  }, [enabled, load]);

  return { notice: feeds.notice, news: feeds.news, refreshing, refresh };
}
