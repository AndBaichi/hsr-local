/**
 * 枚举 → 本地化显示名（T04）
 *
 * `i18n/types.d.ts` 用 zh.json 推导了 i18next 的 key 类型，所以
 * `t(\`enum.element.${value}\`)` 这种拼字符串写法过不了 tsc。
 * 这里用 `ELEMENT_I18N_KEY` 的**值联合类型**做一次受控查表：
 *  - 枚举在集合内 → 传给 `t()` 的仍是编译期已知的 literal key
 *  - 枚举不在集合内（将来新版本加了属性）→ 原样回显，而不是显示 `undefined`
 *
 * 这比在各页面里写 `as ElementType` 断言更诚实：数据包里的值是 `string`，
 * 断言成枚举只是把运行期风险藏起来。
 */

import type { TFunction } from 'i18next';

import {
  CURRENCY_CATEGORY_I18N_KEY,
  CURRENCY_QUALITY_I18N_KEY,
  CURRENCY_TYPE_I18N_KEY,
  ELEMENT_I18N_KEY,
  ITEM_TYPE_I18N_KEY,
  MONSTER_RANK_I18N_KEY,
  PATH_I18N_KEY,
} from '@/i18n/enums';

type ElementKey = (typeof ELEMENT_I18N_KEY)[keyof typeof ELEMENT_I18N_KEY];
type PathKey = (typeof PATH_I18N_KEY)[keyof typeof PATH_I18N_KEY];
type MonsterRankKey = (typeof MONSTER_RANK_I18N_KEY)[keyof typeof MONSTER_RANK_I18N_KEY];
type ItemTypeKey = (typeof ITEM_TYPE_I18N_KEY)[keyof typeof ITEM_TYPE_I18N_KEY];
type CurrencyQualityKey =
  (typeof CURRENCY_QUALITY_I18N_KEY)[keyof typeof CURRENCY_QUALITY_I18N_KEY];
type CurrencyCategoryKey =
  (typeof CURRENCY_CATEGORY_I18N_KEY)[keyof typeof CURRENCY_CATEGORY_I18N_KEY];
type CurrencyTypeKey = (typeof CURRENCY_TYPE_I18N_KEY)[keyof typeof CURRENCY_TYPE_I18N_KEY];

const ELEMENT_MAP: Readonly<Record<string, ElementKey | undefined>> = ELEMENT_I18N_KEY;
const PATH_MAP: Readonly<Record<string, PathKey | undefined>> = PATH_I18N_KEY;
const MONSTER_RANK_MAP: Readonly<Record<string, MonsterRankKey | undefined>> =
  MONSTER_RANK_I18N_KEY;
const ITEM_TYPE_MAP: Readonly<Record<string, ItemTypeKey | undefined>> = ITEM_TYPE_I18N_KEY;
const CURRENCY_QUALITY_MAP: Readonly<Record<string, CurrencyQualityKey | undefined>> =
  CURRENCY_QUALITY_I18N_KEY;
const CURRENCY_CATEGORY_MAP: Readonly<Record<string, CurrencyCategoryKey | undefined>> =
  CURRENCY_CATEGORY_I18N_KEY;
const CURRENCY_TYPE_MAP: Readonly<Record<string, CurrencyTypeKey | undefined>> =
  CURRENCY_TYPE_I18N_KEY;

/** 属性显示名 */
export function elementName(t: TFunction, value: string | null | undefined): string {
  if (!value) return '';
  const key = ELEMENT_MAP[value];
  return key ? t(key) : value;
}

/** 命途显示名 */
export function pathName(t: TFunction, value: string | null | undefined): string {
  if (!value) return '';
  const key = PATH_MAP[value];
  return key ? t(key) : value;
}

/**
 * 敌人等级显示名（数据包是英文枚举，如 `MinionLv2`）。
 * 未收录的新等级原样回显，不显示 `undefined`。
 */
export function monsterRankName(t: TFunction, value: string | null | undefined): string {
  if (!value) return '';
  const key = MONSTER_RANK_MAP[value];
  return key ? t(key) : value;
}

/**
 * 物品分类显示名（mainType 与 subType 共用）。
 * 未收录的新分类原样回显。
 */
export function itemTypeName(t: TFunction, value: string | null | undefined): string {
  if (!value) return '';
  const key = ITEM_TYPE_MAP[value];
  return key ? t(key) : value;
}

/**
 * 货币战争品质显示名（Silver / Gold / Prismatic）。
 * 未收录的新品质原样回显。
 */
export function currencyQualityName(t: TFunction, value: string | null | undefined): string {
  if (!value) return '';
  const key = CURRENCY_QUALITY_MAP[value];
  return key ? t(key) : value;
}

/**
 * 货币战争分类显示名。
 * 未收录的新分类原样回显。
 */
export function currencyCategoryName(t: TFunction, value: string | null | undefined): string {
  if (!value) return '';
  const key = CURRENCY_CATEGORY_MAP[value];
  return key ? t(key) : value;
}

/**
 * 货币战争类型显示名（Consumable / Equipment / Forge）。
 * 未收录的新类型原样回显。
 */
export function currencyTypeName(t: TFunction, value: string | null | undefined): string {
  if (!value) return '';
  const key = CURRENCY_TYPE_MAP[value];
  return key ? t(key) : value;
}

/**
 * 按货币战争的筛选字段名（quality / category / type）取对应的本地化显示名。
 * 其他字段（如 rarity 数字）原样返回，交给调用方格式化。
 */
export function currencyFieldName(
  t: TFunction,
  field: string,
  value: string | null | undefined,
): string {
  if (!value) return '';
  if (field === 'quality') return currencyQualityName(t, value);
  if (field === 'category') return currencyCategoryName(t, value);
  if (field === 'type') return currencyTypeName(t, value);
  return value;
}

/** 稀有度星形串（1–5 之外回显数字） */
export function rarityName(t: TFunction, value: number): string {
  switch (value) {
    case 1:
    case 2:
    case 3:
    case 4:
    case 5:
      return t(`enum.rarity.${value}` as 'enum.rarity.1');
    default:
      return String(value);
  }
}
