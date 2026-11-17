/**
 * 货币战争评级 store（`userdata/ratings.json`）
 *
 * 数据形状：`Record<"currency:{kind}:{id}", RatingEntry>`，整体写入（200ms 防抖）。
 * `RatingEntry` 里三个字段（`grade` / `tier` / `remark`）**互相独立**：两套评级可以
 * 各打各的，备注跟谁都不冲突；旧版本的裸档位字符串会在读取时升级成 `{ grade }`。
 *
 * ## 为什么单独一个文件，不塞进 prefs
 *
 * 评级条目量级与收藏同档（六个图鉴合计 1087 条，用户实际会评的远少于这个数），
 * 但 `prefs.json` 是"设置"，每次改主题 / 语言 / 每页条数都会整体重写；
 * 把上千条评级塞进去会让这类小改动变成大文件写入。分开存也让"删掉偏好"
 * 与"删掉我打的评级"是两件独立的事。
 *
 * ## 为什么 key 不是 `EntityKey`
 *
 * `EntityKey` 是 `${ModuleKey}:${id}`，只覆盖六个数据包模块；图鉴条目没有实体路由，
 * 用 `currency:{kind}:{id}` 三段式单独一套。写成两段会与 `parseEntityKey` 混淆
 * （`currency` 不是模块名），写成四段以后不好解析。
 *
 * ## 为什么 `hydrate` 由 `useBoot` 显式调用
 *
 * 与收藏 / 笔记一致：模块级副作用会让 import 顺序决定启动行为，也难测。
 */

import { create } from 'zustand';

import { readUserData, scheduleWriteUserData } from '@/lib/ipc/userdata';
import {
  clampRemark,
  coerceRatings,
  isEmptyRatingEntry,
  ratingKeyOf,
  type RatingEntry,
  type RatingGrade,
} from '@/lib/userdata/types';

/**
 * 一次改动的意图。
 *
 * 用 `null` 表示"清除"、用「键不出现」表示"不动"，所以四个字段都是可选的：
 * `{ grade: null }` 只清第一套评级，`{ gradeRemark: 'x' }` 只动字母评级备注。
 */
interface EntryPatch {
  readonly grade?: RatingGrade | null;
  readonly tier?: RatingGrade | null;
  readonly gradeRemark?: string | null;
  readonly tierRemark?: string | null;
}

/**
 * 把一次改动合并到当前条目上，返回新条目（不修改入参）。
 *
 * `'grade' in patch` 而不是 `patch.grade !== undefined`：只有前者能区分
 * 「patch 里没写这个字段」与「patch 里明确写了 null = 清除」。
 *
 * @param current 当前条目（不存在时为 `undefined`）
 * @param patch 改动
 */
function mergeEntry(current: RatingEntry | undefined, patch: EntryPatch): RatingEntry {
  const next: { grade?: RatingGrade; tier?: RatingGrade; gradeRemark?: string; tierRemark?: string } = {};

  const grade = 'grade' in patch ? patch.grade ?? null : current?.grade ?? null;
  if (grade !== null) next.grade = grade;

  const tier = 'tier' in patch ? patch.tier ?? null : current?.tier ?? null;
  if (tier !== null) next.tier = tier;

  const gradeRemark =
    'gradeRemark' in patch ? clampRemark(patch.gradeRemark ?? '') : current?.gradeRemark ?? '';
  if (gradeRemark !== '') next.gradeRemark = gradeRemark;

  const tierRemark =
    'tierRemark' in patch ? clampRemark(patch.tierRemark ?? '') : current?.tierRemark ?? '';
  if (tierRemark !== '') next.tierRemark = tierRemark;

  return next;
}

/**
 * 两个条目是否逐字段相等（缺省一律归一到"空"）。
 *
 * @param left 条目 A
 * @param right 条目 B
 */
function isSameEntry(left: RatingEntry | undefined, right: RatingEntry): boolean {
  return (
    (left?.grade ?? null) === (right.grade ?? null) &&
    (left?.tier ?? null) === (right.tier ?? null) &&
    (left?.gradeRemark ?? '') === (right.gradeRemark ?? '') &&
    (left?.tierRemark ?? '') === (right.tierRemark ?? '')
  );
}

/** store 状态与动作 */
export interface RatingsState {
  /** 评级表：`currency:{kind}:{id}` → 条目 */
  readonly items: Readonly<Record<string, RatingEntry>>;
  /** 是否已从磁盘读完（未就绪时卡片先显示 `-`，不要闪） */
  readonly loaded: boolean;
  /** 从 `userdata/ratings.json` 载入（幂等） */
  hydrate: () => Promise<void>;
  /** 取某条目的评级数据（没评过也没有备注时为 `undefined`） */
  get: (kind: string, id: string) => RatingEntry | undefined;
  /** 设置 / 清除第一套评级（`null` = 清除） */
  setGrade: (kind: string, id: string, grade: RatingGrade | null) => void;
  /** 设置 / 清除第二套评级（`null` = 清除） */
  setTier: (kind: string, id: string, tier: RatingGrade | null) => void;
  /** 设置 / 清除字母评级备注（空串 = 清除） */
  setGradeRemark: (kind: string, id: string, remark: string) => void;
  /** 设置 / 清除千评级备注（空串 = 清除） */
  setTierRemark: (kind: string, id: string, remark: string) => void;
  /** 清空全部评级与备注 */
  clear: () => void;
}

/** 评级 store */
export const useRatingsStore = create<RatingsState>()((set, get) => {
  /**
   * 三个 setter 的共同通道：合并 → 判等 → 落盘。
   *
   * "无变化不写盘"必须留在这里而不是各 setter 里：两套评级 + 备注共用一个文件，
   * 重复点同一档（或点开备注再原样保存）都不该产生一次磁盘写入。
   *
   * @param kind 图鉴种类
   * @param id 条目 id
   * @param patch 改动
   */
  const commit = (kind: string, id: string, patch: EntryPatch): void => {
    const key = ratingKeyOf(kind, id);
    const items = get().items;
    const current = items[key];
    const next = mergeEntry(current, patch);
    if (isSameEntry(current, next)) return;

    const updated: Record<string, RatingEntry> = { ...items };
    // 三字段全空就删键：留着空对象会让 `ratedHere` 之类的"有没有评过"判断误判
    if (isEmptyRatingEntry(next)) delete updated[key];
    else updated[key] = next;

    set({ items: updated });
    scheduleWriteUserData('ratings', updated);
  };

  return {
    items: {},
    loaded: false,

    hydrate: async () => {
      // 幂等：已经读过就不再从磁盘覆盖内存（否则会把刚点的评级吃掉）
      if (get().loaded) return;
      try {
        const raw = await readUserData('ratings');
        set({ items: coerceRatings(raw), loaded: true });
      } catch (error) {
        // 读失败不能挡住启动：评级不可用比应用打不开好得多
        if (import.meta.env.DEV) {
          console.warn('[ratings] 读取失败，按空评级继续', error);
        }
        set({ items: {}, loaded: true });
      }
    },

    get: (kind, id) => get().items[ratingKeyOf(kind, id)],

    setGrade: (kind, id, grade) => {
      commit(kind, id, { grade });
    },

    setTier: (kind, id, tier) => {
      commit(kind, id, { tier });
    },

    setGradeRemark: (kind, id, remark) => {
      commit(kind, id, { gradeRemark: remark });
    },

    setTierRemark: (kind, id, remark) => {
      commit(kind, id, { tierRemark: remark });
    },

    clear: () => {
      set({ items: {} });
      scheduleWriteUserData('ratings', {});
    },
  };
});
