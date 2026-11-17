/**
 * 收藏 store（架构文档 §2.3 `favorites.json`、PRD §4.2 收藏）
 *
 * 数据形状：`Record<EntityKey, FavoriteEntry>`，整体写入（200ms 防抖）。
 *
 * ## 为什么快照名称
 *
 * 收藏要跨数据包版本存活。升级到 4.8 后某个角色被删了（或改了名），
 * 收藏列表仍然要显示出来并标注「已随版本移除」——所以条目里存 `nameSnapshot`。
 * 这解释了为什么收藏表不能"只存 id 数组"：id 数组在实体消失后是一堆无法显示的字符串。
 *
 * ## 为什么 `hydrate` 是显式调用而不是模块级自动执行
 *
 * 模块级副作用会让 import 顺序决定启动行为（也难测）。由 `useBoot` 在数据层
 * 就绪后统一触发，与 `dal.boot()` 一样是"编排"的一部分。
 */

import { create } from 'zustand';

import { readUserData, scheduleWriteUserData } from '@/lib/ipc/userdata';
import {
  coerceFavorites,
  entityKeyOf,
  type EntityKey,
  type FavoriteEntry,
  type LocalizedNames,
} from '@/lib/userdata/types';
import type { ModuleKey } from '@/lib/data/types';

/** 收藏变更的入参 */
export interface FavoriteInput {
  /** 模块 */
  readonly module: ModuleKey;
  /** 实体 id */
  readonly id: string;
  /** 名称快照 */
  readonly nameSnapshot: LocalizedNames;
  /** 当前数据包 id */
  readonly packId: string;
}

/** store 状态与动作 */
export interface FavoritesState {
  /** 实体键 → 条目 */
  readonly items: Readonly<Record<string, FavoriteEntry>>;
  /** 是否已从磁盘读完（UI 未就绪时不要显示"暂无收藏"） */
  readonly loaded: boolean;
  /** 从 `userdata/favorites.json` 载入（幂等） */
  hydrate: () => Promise<void>;
  /** 是否已收藏 */
  isFavorite: (module: ModuleKey, id: string) => boolean;
  /** 切换收藏，返回切换后的状态（true = 已收藏） */
  toggle: (input: FavoriteInput) => boolean;
  /** 移除收藏 */
  remove: (module: ModuleKey, id: string) => void;
  /** 清空收藏（设置页「重置用户数据」用） */
  clear: () => void;
}

/**
 * 按 `order` 升序 + `addedAt` 升序排列的条目列表。
 *
 * @param items 收藏表
 */
export function sortedFavorites(
  items: Readonly<Record<string, FavoriteEntry>>,
): readonly FavoriteEntry[] {
  return Object.values(items).sort((left, right) => {
    if (left.order !== right.order) return left.order - right.order;
    return left.addedAt.localeCompare(right.addedAt);
  });
}

/** 当前表中的最大排序位（新条目排在末尾） */
function nextOrder(items: Readonly<Record<string, FavoriteEntry>>): number {
  let max = -1;
  for (const entry of Object.values(items)) {
    if (entry.order > max) max = entry.order;
  }
  return max + 1;
}

/** 收藏 store */
export const useFavoritesStore = create<FavoritesState>()((set, get) => ({
  items: {},
  loaded: false,

  hydrate: async () => {
    // 幂等：已经读过就不再从磁盘覆盖内存（否则会把刚点的收藏吃掉）
    if (get().loaded) return;
    try {
      const raw = await readUserData('favorites');
      set({ items: coerceFavorites(raw), loaded: true });
    } catch (error) {
      // 读失败不能挡住启动：收藏不可用比应用打不开好得多
      if (import.meta.env.DEV) {
        console.warn('[favorites] 读取失败，按空收藏继续', error);
      }
      set({ items: {}, loaded: true });
    }
  },

  isFavorite: (module, id) => {
    const key: EntityKey = entityKeyOf(module, id);
    return get().items[key] !== undefined;
  },

  toggle: (input) => {
    const key: EntityKey = entityKeyOf(input.module, input.id);
    const current = get().items;
    const exists = current[key] !== undefined;

    let next: Record<string, FavoriteEntry>;
    if (exists) {
      next = { ...current };
      delete next[key];
    } else {
      next = {
        ...current,
        [key]: {
          module: input.module,
          id: input.id,
          nameSnapshot: input.nameSnapshot,
          packId: input.packId,
          addedAt: new Date().toISOString(),
          group: null,
          order: nextOrder(current),
        },
      };
    }

    set({ items: next });
    // 收藏体积小（数百条 ≈ 60KB），整体重写比增量补丁简单得多，且不会出现
    // "内存里有、磁盘上缺一条"的状态
    scheduleWriteUserData('favorites', next);
    return !exists;
  },

  remove: (module, id) => {
    const key: EntityKey = entityKeyOf(module, id);
    if (get().items[key] === undefined) return;
    const next = { ...get().items };
    delete next[key];
    set({ items: next });
    scheduleWriteUserData('favorites', next);
  },

  clear: () => {
    set({ items: {} });
    scheduleWriteUserData('favorites', {});
  },
}));
