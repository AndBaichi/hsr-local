/**
 * 枚举显示名映射（架构文档 §8.3、§11.4）
 *
 * 约定：枚举的**显示名**统一走 i18n，key 形如 `enum.element.Fire`。
 * 组件里禁止出现硬编码的中文/英文属性名。
 *
 * 范围说明（T01）：本批次先落「属性 / 命途 / 稀有度」三组——
 * 它们的取值集合已由数据源实测确定（附录 A：`baseType`/`damageType` 同名枚举，7+9 值）。
 * 物品分类（17 种 `item_sub_type`）与敌人阶级的取值需等 T02 的 `normalize.ts`
 * 规范化后才能确定，届时在此文件按同样的结构追加，不影响既有调用方。
 */

import type { TFunction } from 'i18next';

/* ------------------------------------------------------------------ */
/* 战斗属性（7 种，附录 A：`damageType` → element）                      */
/* ------------------------------------------------------------------ */

/** 7 种战斗属性，顺序与游戏内一致 */
export const ELEMENT_TYPES = [
  'Physical',
  'Fire',
  'Ice',
  'Lightning',
  'Wind',
  'Quantum',
  'Imaginary',
] as const;

/** 战斗属性 */
export type ElementType = (typeof ELEMENT_TYPES)[number];

/** 属性 → i18n key */
export const ELEMENT_I18N_KEY = {
  Physical: 'enum.element.Physical',
  Fire: 'enum.element.Fire',
  Ice: 'enum.element.Ice',
  Lightning: 'enum.element.Lightning',
  Wind: 'enum.element.Wind',
  Quantum: 'enum.element.Quantum',
  Imaginary: 'enum.element.Imaginary',
} as const satisfies Record<ElementType, string>;

/**
 * 取属性的本地化显示名。
 *
 * @param t i18next 的翻译函数
 * @param element 属性枚举值
 */
export function elementLabel(t: TFunction, element: ElementType): string {
  return t(ELEMENT_I18N_KEY[element]);
}

/* ------------------------------------------------------------------ */
/* 命途（9 种，附录 A：`baseType` / `base_type` → path）                */
/* ------------------------------------------------------------------ */

/**
 * 9 种命途。
 * 注意：`Memory`（记忆）是 3.x 之后新增的命途，源站 `pathicon/memory.webp` 实测存在。
 */
export const PATH_TYPES = [
  'Warrior',
  'Rogue',
  'Mage',
  'Shaman',
  'Knight',
  'Warlock',
  'Priest',
  'Elation',
  'Memory',
] as const;

/** 命途 */
export type PathType = (typeof PATH_TYPES)[number];

/** 命途 → i18n key */
export const PATH_I18N_KEY = {
  Warrior: 'enum.path.Warrior',
  Rogue: 'enum.path.Rogue',
  Mage: 'enum.path.Mage',
  Shaman: 'enum.path.Shaman',
  Knight: 'enum.path.Knight',
  Warlock: 'enum.path.Warlock',
  Priest: 'enum.path.Priest',
  Elation: 'enum.path.Elation',
  Memory: 'enum.path.Memory',
} as const satisfies Record<PathType, string>;

/**
 * 取命途的本地化显示名。
 *
 * @param t i18next 的翻译函数
 * @param path 命途枚举值
 */
export function pathLabel(t: TFunction, path: PathType): string {
  return t(PATH_I18N_KEY[path]);
}

/* ------------------------------------------------------------------ */
/* 稀有度（1–5）                                                       */
/* ------------------------------------------------------------------ */

/** 稀有度可选值（升序） */
export const RARITY_VALUES = [1, 2, 3, 4, 5] as const;

/** 稀有度 */
export type Rarity = (typeof RARITY_VALUES)[number];

/** 稀有度 → i18n key（值为星形串，同时供 `RarityStars` 计算宽度） */
export const RARITY_I18N_KEY = {
  1: 'enum.rarity.1',
  2: 'enum.rarity.2',
  3: 'enum.rarity.3',
  4: 'enum.rarity.4',
  5: 'enum.rarity.5',
} as const satisfies Record<Rarity, string>;

/**
 * 取稀有度的本地化星形文案（★ / ★★ / …）。
 *
 * @param t i18next 的翻译函数
 * @param rarity 稀有度 1–5
 */
export function rarityLabel(t: TFunction, rarity: Rarity): string {
  return t(RARITY_I18N_KEY[rarity]);
}

/**
 * 判断任意数字是否是合法稀有度。
 *
 * @param value 待判定值
 */
export function isRarity(value: number): value is Rarity {
  return Number.isInteger(value) && value >= 1 && value <= 5;
}

/* ------------------------------------------------------------------ */
/* 敌人等级（数据包里是英文枚举，直接显示会露英文）                       */
/* ------------------------------------------------------------------ */

/**
 * 敌人等级 → i18n key。
 * 数据包 `rank` 字段实测取值：Minion / MinionLv2 / Elite / LittleBoss / BigBoss。
 */
export const MONSTER_RANK_I18N_KEY = {
  Minion: 'enum.monsterRank.Minion',
  MinionLv2: 'enum.monsterRank.MinionLv2',
  Elite: 'enum.monsterRank.Elite',
  LittleBoss: 'enum.monsterRank.LittleBoss',
  BigBoss: 'enum.monsterRank.BigBoss',
} as const;

/* ------------------------------------------------------------------ */
/* 物品分类（mainType + subType 共用一套映射）                            */
/* ------------------------------------------------------------------ */

/**
 * 物品分类 → i18n key。
 * 数据包实测：mainType 4 种（Material/Mission/Usable/Virtual），
 * subType 17 种，两者有交集，合并为一套映射。
 */
export const ITEM_TYPE_I18N_KEY = {
  Material: 'enum.itemType.Material',
  Mission: 'enum.itemType.Mission',
  Usable: 'enum.itemType.Usable',
  Virtual: 'enum.itemType.Virtual',
  AvatarExp: 'enum.itemType.AvatarExp',
  AvatarRank: 'enum.itemType.AvatarRank',
  Book: 'enum.itemType.Book',
  CommonMonsterDrop: 'enum.itemType.CommonMonsterDrop',
  ComposeMaterial: 'enum.itemType.ComposeMaterial',
  EquipmentExp: 'enum.itemType.EquipmentExp',
  Fiat: 'enum.itemType.Fiat',
  FindChest: 'enum.itemType.FindChest',
  Food: 'enum.itemType.Food',
  Formula: 'enum.itemType.Formula',
  Gift: 'enum.itemType.Gift',
  RelicExp: 'enum.itemType.RelicExp',
  TracePath: 'enum.itemType.TracePath',
  WeeklyMonsterDrop: 'enum.itemType.WeeklyMonsterDrop',
} as const;

/* ------------------------------------------------------------------ */
/* 货币战争：品质 / 分类（数据包里是英文枚举）                          */
/* ------------------------------------------------------------------ */

/** 货币战争品质 → i18n key（实测：Silver / Gold / Prismatic） */
export const CURRENCY_QUALITY_I18N_KEY = {
  Silver: 'enum.currencyQuality.Silver',
  Gold: 'enum.currencyQuality.Gold',
  Prismatic: 'enum.currencyQuality.Prismatic',
} as const;

/** 货币战争分类 → i18n key（实测 16 种；后 6 种是 v2.3 补的，之前原样回显英文） */
export const CURRENCY_CATEGORY_I18N_KEY = {
  Basic: 'enum.currencyCategory.Basic',
  Material: 'enum.currencyCategory.Material',
  Crown: 'enum.currencyCategory.Crown',
  Trash: 'enum.currencyCategory.Trash',
  GoldTrash: 'enum.currencyCategory.GoldTrash',
  Hack: 'enum.currencyCategory.Hack',
  FateEquip: 'enum.currencyCategory.FateEquip',
  Other: 'enum.currencyCategory.Other',
  SpotLightEquip: 'enum.currencyCategory.SpotLightEquip',
  Food: 'enum.currencyCategory.Food',
  Craftable: 'enum.currencyCategory.Craftable',
  Emblem: 'enum.currencyCategory.Emblem',
  Intrinsic: 'enum.currencyCategory.Intrinsic',
  Radiant: 'enum.currencyCategory.Radiant',
  Trailblaze: 'enum.currencyCategory.Trailblaze',
  TraitSpecial: 'enum.currencyCategory.TraitSpecial',
} as const;

/** 货币战争类型 → i18n key（实测：Consumable / Equipment / Forge） */
export const CURRENCY_TYPE_I18N_KEY = {
  Consumable: 'enum.currencyType.Consumable',
  Equipment: 'enum.currencyType.Equipment',
  Forge: 'enum.currencyType.Forge',
} as const;

/* ------------------------------------------------------------------ */
/* 货币战争：角色详情页的技能标签                                       */
/* ------------------------------------------------------------------ */

/**
 * 技能标签 → i18n key。
 *
 * 源数据的 `tag` 是**中英混排**：早期条目写 `AoEAttack` / `SingleAttack`，
 * 后期条目直接写成中文「群攻」「单攻」。{@link skillTagLabel} 先把中文别名
 * 归一成英文枚举再查表 —— 只查表的话中文标签在 en / ja / ko 界面会原样漏出。
 */
export const SKILL_TAG_I18N_KEY = {
  AoEAttack: 'currencyDetail.tags.aoEAttack',
  SingleAttack: 'currencyDetail.tags.singleAttack',
  Blast: 'currencyDetail.tags.blast',
  Bounce: 'currencyDetail.tags.bounce',
  Enhance: 'currencyDetail.tags.enhance',
  Support: 'currencyDetail.tags.support',
  Defence: 'currencyDetail.tags.defence',
  Impair: 'currencyDetail.tags.impair',
  Restore: 'currencyDetail.tags.restore',
  Summon: 'currencyDetail.tags.summon',
} as const;

/** 中文标签 → 上方英文枚举（实测取值，别按语义猜别的写法） */
const SKILL_TAG_ALIAS: Readonly<Record<string, keyof typeof SKILL_TAG_I18N_KEY>> = {
  群攻: 'AoEAttack',
  单攻: 'SingleAttack',
  扩散: 'Blast',
  弹射: 'Bounce',
  强化: 'Enhance',
  辅助: 'Support',
  防御: 'Defence',
  妨害: 'Impair',
  回复: 'Restore',
  召唤: 'Summon',
};

/**
 * 技能标签的显示名。
 *
 * 映射不到时**回显原值**而不是留空：数据包换版本会出现新标签，
 * 显示 `Frozen` 也比显示空白好排查。
 *
 * @param t i18n
 * @param tag 原始标签（英文枚举或中文别名）
 */
export function skillTagLabel(t: TFunction, tag: string): string {
  const key =
    SKILL_TAG_ALIAS[tag] ??
    (tag in SKILL_TAG_I18N_KEY ? (tag as keyof typeof SKILL_TAG_I18N_KEY) : undefined);
  if (key === undefined) return tag;
  return t(SKILL_TAG_I18N_KEY[key]) as string;
}

/* ------------------------------------------------------------------ */
/* 语言（与 i18n 的 Lang 对应，供选择器渲染）                            */
/* ------------------------------------------------------------------ */

/**
 * 稀有度对应的 css 变量名（用于 `RarityStars` 的渐变描边）。
 *
 * @param rarity 稀有度 1–5
 */
export function rarityCssVar(rarity: Rarity): string {
  switch (rarity) {
    case 5:
      return 'var(--hsr-rarity-5-from)';
    case 4:
      return 'var(--hsr-rarity-4)';
    case 3:
      return 'var(--hsr-rarity-3)';
    default:
      return 'var(--hsr-text-dim)';
  }
}
