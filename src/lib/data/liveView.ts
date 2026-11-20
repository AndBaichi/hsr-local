/**
 * 4.7「现场版本」视图的排除表。
 *
 * 4.7 快照与 4.7.52 数据包相比，只多了 4.7 之后才加入的少量实体：
 *  - 角色 1514 / 1515
 *  - 光锥 23066 / 23067
 *  - 敌人 5034014
 *  - 物品 140635 / 140636 / 140638 / 140639
 *
 * 数据包仍保留 4.7.52 全量；「4.7（现场）」视图把这些条目藏起来，
 * 避免默认展示尚未在正式服上线的内容。用户切到 4.7.51 / 4.7.52 时显示全量。
 */

/** 支持按 live 视图过滤的索引类型 */
export type LiveFilterKind = 'character' | 'lightcone' | 'monster' | 'item';

/** 4.7 现场版本不包含的实体 id */
export const LIVE_EXCLUDED_IDS: Readonly<Record<LiveFilterKind, ReadonlySet<string>>> = {
  character: new Set(['1514', '1515']),
  lightcone: new Set(['23066', '23067']),
  monster: new Set(['5034014']),
  item: new Set(['140635', '140636', '140638', '140639']),
};

/** 某个实体是否应在 4.7 现场视图中隐藏 */
export function isExcludedFromLive(kind: LiveFilterKind, id: string): boolean {
  return LIVE_EXCLUDED_IDS[kind].has(String(id));
}

/** 过滤一组带 id 的索引条目 */
export function filterLiveEntries<T extends { readonly id: string }>(
  kind: LiveFilterKind,
  entries: readonly T[],
): readonly T[] {
  return entries.filter((entry) => !isExcludedFromLive(kind, entry.id));
}
