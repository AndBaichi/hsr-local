/**
 * 列表页的搜索与筛选状态（T04）
 *
 * 六个列表页共用。`resetKey` 给 `PagedGrid` 用来在条件变化时回到第 1 页——
 * 不这么做的话，在「第 5 页」输入搜索词会停在一个空白页上。
 *
 * ## 为什么状态放在模块级 store 而不是 `useState`
 *
 * 用户要求「切换页面不重置筛选，只有重启软件才重置」。
 * 路由切换会让列表页组件卸载，`useState` 随之销毁——于是每次从角色详情返回列表，
 * 筛选项都被清空。改成模块级的 `zustand` store，以「页面 key」分槽：
 *
 *  - 组件卸载 / 重新挂载 → 状态还在（切页面不丢）
 *  - 进程退出 → 模块连同状态一起消失（重启即重置）
 *
 * 刻意**不写 localStorage**：用户要的是「本次使用期间保持」，跨重启的记忆反而是噪音。
 */

import { useCallback, useMemo } from 'react';
import { create } from 'zustand';

/** 单页的搜索与筛选状态 */
interface ListSlice {
  /** 搜索词 */
  readonly query: string;
  /** 各筛选组当前值 */
  readonly filters: Readonly<Record<string, string>>;
}

/** 空筛选（常量复用，避免每次渲染都新建对象） */
const EMPTY_FILTERS: Readonly<Record<string, string>> = Object.freeze({});

/** 列表状态 store */
interface ListStateStore {
  /** 页面 key → 该页状态（没有条目代表该页从未被筛过） */
  readonly pages: ReadonlyMap<string, ListSlice>;
  /** 写入某页的搜索词 */
  readonly writeQuery: (pageKey: string, value: string) => void;
  /** 写入某页的某一组筛选值 */
  readonly writeFilter: (pageKey: string, key: string, value: string) => void;
  /** 整组替换某页的筛选值（切模块时用来丢弃上一个模块的筛选键） */
  readonly writeFilters: (pageKey: string, value: Readonly<Record<string, string>>) => void;
}

const useListStore = create<ListStateStore>()((set) => ({
  pages: new Map(),

  writeQuery: (pageKey, value) => {
    set((state) => {
      const current = state.pages.get(pageKey);
      if (current !== undefined && current.query === value) return state;
      const pages = new Map(state.pages);
      pages.set(pageKey, { query: value, filters: current?.filters ?? EMPTY_FILTERS });
      return { pages };
    });
  },

  writeFilter: (pageKey, key, value) => {
    set((state) => {
      const current = state.pages.get(pageKey);
      if (current !== undefined && current.filters[key] === value) return state;
      const pages = new Map(state.pages);
      pages.set(pageKey, {
        query: current?.query ?? '',
        // 值为 `all` 时也照样存：各页自己判断 `!== 'all'`，这里不替它们做语义决策
        filters: { ...(current?.filters ?? {}), [key]: value },
      });
      return { pages };
    });
  },

  writeFilters: (pageKey, value) => {
    set((state) => {
      const current = state.pages.get(pageKey);
      const pages = new Map(state.pages);
      pages.set(pageKey, { query: current?.query ?? '', filters: { ...value } });
      return { pages };
    });
  },
}));

/** 列表状态 */
export interface ListState {
  /** 搜索词 */
  readonly query: string;
  /** 设置搜索词 */
  readonly setQuery: (value: string) => void;
  /** 各筛选组当前值 */
  readonly filters: Readonly<Record<string, string>>;
  /** 设置某个筛选组 */
  readonly setFilter: (key: string, value: string) => void;
  /** 整组替换筛选值（切换资料库时丢弃上一个资料库的筛选键） */
  readonly replaceFilters: (value: Readonly<Record<string, string>>) => void;
  /** 条件指纹，作为分页重置键 */
  readonly resetKey: string;
}

/**
 * 列表页状态。
 *
 * @param pageKey 页面标识（同一页必须始终传同一个值，否则各存一份）
 */
export function useListState(pageKey: string): ListState {
  const slice = useListStore((state) => state.pages.get(pageKey));
  const query = slice?.query ?? '';
  const filters = slice?.filters ?? EMPTY_FILTERS;

  const setQuery = useCallback(
    (value: string): void => {
      useListStore.getState().writeQuery(pageKey, value);
    },
    [pageKey],
  );

  const setFilter = useCallback(
    (key: string, value: string): void => {
      useListStore.getState().writeFilter(pageKey, key, value);
    },
    [pageKey],
  );

  const replaceFilters = useCallback(
    (value: Readonly<Record<string, string>>): void => {
      useListStore.getState().writeFilters(pageKey, value);
    },
    [pageKey],
  );

  const resetKey = useMemo(
    () => `${query}::${Object.entries(filters).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('&')}`,
    [query, filters],
  );

  return { query, setQuery, filters, setFilter, replaceFilters, resetKey };
}

/**
 * 名称 + ID 的模糊匹配。
 *
 * 同时匹配四语言名称（用户把界面切到英文时，输入中文名也应该能搜到）。
 *
 * @param query 搜索词（已 trim）
 * @param names 四语言名称
 * @param id 实体 id
 */
export function matchesQuery(
  query: string,
  names: Record<string, string | undefined> | undefined,
  id: string,
): boolean {
  if (query === '') return true;
  const needle = query.toLocaleLowerCase();
  if (id.toLocaleLowerCase().includes(needle)) return true;
  if (!names) return false;
  return Object.values(names).some(
    (value) => typeof value === 'string' && value.toLocaleLowerCase().includes(needle),
  );
}
