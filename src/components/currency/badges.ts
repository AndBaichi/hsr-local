/**
 * 货币战争条目的「卡片徽标」生成（图鉴列表与对比页共用）
 *
 * 六个图鉴的卡片上都只放少量元数据：品质 / 类型 / 分类（都是英文枚举，要走
 * {@link currencyFieldName} 本地化）、前后排、专家、主角光环的敌方难度，
 * 外加最多三个标签。详情面板与对比页复用同一份口径，避免两处各写一套后走样。
 */

import type { TFunction } from 'i18next';

import { currencyTags, type CurrencyEntry } from '@/lib/data/extra';
import { currencyFieldName } from '@/lib/labels';

/**
 * 生成一条货币战争条目的徽标文案（已本地化，顺序固定）。
 *
 * @param entry 图鉴条目
 * @param t i18n 函数
 */
export function currencyBadges(entry: CurrencyEntry, t: TFunction): readonly string[] {
  const out: string[] = [];
  for (const field of ['quality', 'type', 'category'] as const) {
    const value = entry[field];
    // 这些字段在数据包里是英文枚举，经映射转成本地化名称
    if (typeof value === 'string' && value.trim() !== '') out.push(currencyFieldName(t, field, value));
  }
  if (entry.front_back_type === 'Front') out.push(t('currency.frontline') as string);
  if (entry.front_back_type === 'Back') out.push(t('currency.backline') as string);
  if (entry.is_expert === true) out.push(t('currency.expert') as string);
  // 主角光环：敌方难度提升是它最该被一眼看到的差异项（原站卡片上写 `+N`）
  if (typeof entry.enemy_diff_lv_add === 'number' && entry.enemy_diff_lv_add > 0) {
    out.push(`+${entry.enemy_diff_lv_add}`);
  }
  // 标签只取前 3 个：卡片位置有限，完整标签在详情面板里看
  for (const tag of currencyTags(entry).slice(0, 3)) {
    if (typeof tag.name === 'string' && tag.name !== '') out.push(tag.name);
  }
  return out;
}
