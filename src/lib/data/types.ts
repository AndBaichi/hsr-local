/**
 * 数据包 JSON 的类型定义（T03）
 *
 * ## 这些类型是从真实数据里读出来的，不是从文档抄的
 *
 * 每个字段都用 `data/datapack/db/**` 的实际样本核过（4.7.51）。
 * 教训来自 `read_stats`：它把 `db/character.json` 当对象、把 `name` 当对象，
 * 两层都错却从不报错（只影响一个日志字段）。所以这里的形状必须照着真实 JSON 写。
 *
 * ## 为什么详情类型只写「已验证的字段」
 *
 * 详情 JSON 还有大量字段（`avatarVoTag`、`variants`、`returnItemIds` …），
 * 我没有逐个消费过就不写进类型——没写进去的字段在 TS 里依然存在于运行时对象上，
 * 只是需要时得显式声明，这比猜一个类型然后到处 `as any` 诚实。
 */

import type { Lang } from '@/i18n';

/** 多语言名称。数据包里 4.7.51 恒有 zh/en/ja/ko，但按「可能缺失」处理 */
export type LocalizedNames = Partial<Record<Lang, string>>;

/**
 * 富文本节点（架构文档 §7 的清洗结果）
 *
 * 宏已经被 T02 降级成这些字段的组合：
 *  - `v` 文本
 *  - `p` 参数占位下标（配合 `paramList`）
 *  - `f` 数字格式（`i` = 整数）
 *  - `s` 后缀（如 `%`）
 *  - `c` 颜色（如 `#f29e38`）
 *
 * 末尾的索引签名是**故意留的口子**：T02 对未知宏采取「降级不丢弃」，
 * 将来新增宏时渲染器要先能透传，而不是让类型先炸掉整个构建。
 */
export interface RichTextNode {
  /** 文本 */
  readonly v?: string;
  /** 参数占位下标（1-based，配合 `RenderOptions.paramList`） */
  readonly p?: number;
  /** 数字格式：`i` 整数 / `f1` 一位小数 / `f2` 两位小数（已实测穷举） */
  readonly f?: string;
  /** 后缀，实测只有 `"%"` */
  readonly s?: string;
  /** 覆盖色（hex，如 `#f29e38`） */
  readonly c?: string;
  /** 下划线（术语 / 技能名，如「追加施放」） */
  readonly u?: boolean;
  /** 斜体（风味文本 / 引号台词） */
  readonly i?: boolean;
  /** 未识别的宏字段，原样透传 */
  readonly [extra: string]: unknown;
}

/** 富文本段落 */
export interface RichTextParagraph {
  /** 节点序列 */
  readonly nodes: readonly RichTextNode[];
  /** 对齐方式（实测只有 2 处 `right`，物品署名行） */
  readonly align?: 'left' | 'center' | 'right';
}

/** 富文本（段落数组；空数组表示「无文案」，不是缺失） */
export type RichText = readonly RichTextParagraph[];

/** 角色索引 brief（`db/character.json`，数组，101 条） */
export interface CharacterBrief {
  readonly id: string;
  /** 当前语言名（数据包内 `name` 与 `names.zh` 一致，取 `names` 更可靠） */
  readonly name: string;
  readonly names: LocalizedNames;
  readonly rarity: number;
  /** 命途，如 `Knight`（英文枚举，展示层再本地化） */
  readonly path: string;
  /** 属性，如 `Ice` */
  readonly element: string;
  /** 图标相对路径，如 `img/character/1001.webp` */
  readonly icon: string;
  /** 实装时间（Unix 秒） */
  readonly release?: number;
}

/** 光锥索引 brief（174 条） */
export interface LightconeBrief {
  readonly id: string;
  readonly name: string;
  readonly names: LocalizedNames;
  readonly rarity: number;
  readonly path: string;
  readonly icon: string;
  /** 80 级基础攻击（T02 预计算） */
  readonly atk?: number;
}

/** 遗器套装索引 brief（64 条） */
export interface RelicSetBrief {
  readonly id: string;
  readonly name: string;
  readonly names: LocalizedNames;
  /** `cavern`（隧洞） / `planar`（位面） */
  readonly kind: string;
  readonly partCount: number;
  /** 生效件数，如 `[2, 4]` */
  readonly effectPieces: readonly number[];
  readonly icon: string;
}

/** 敌人索引 brief（666 条；按「组」聚合，不是按变体） */
export interface MonsterBrief {
  /** 分组键（中文组名，用于详情路由） */
  readonly groupKey: string;
  readonly names: LocalizedNames;
  /** 强度档位，如 `MinionLv2` */
  readonly rank: string;
  readonly camp: string | null;
  /** 弱点属性 */
  readonly weak: readonly string[];
  readonly icon: string;
  /** 主变体 id */
  readonly primaryId: string;
  readonly variantIds: readonly string[];
  readonly variantCount: number;
  readonly order: number;
}

/** 物品索引 brief（16 分片合并，1606 条；遗器套装图也走 `img/item/`） */
export interface ItemBrief {
  readonly id: string;
  readonly names: LocalizedNames;
  readonly mainType: string;
  readonly subType: string;
  readonly rarity: number;
  readonly purposeType: number;
  readonly displayTag: number;
  readonly icon: string;
  readonly group: string | null;
}

/** 成就系列 brief（9 条；成就**条目**嵌在详情里） */
export interface AchievementSeriesBrief {
  readonly id: string;
  readonly name: string;
  readonly priority: number;
  readonly itemCount: number;
  readonly hiddenCount: number;
  readonly hiddenDescCount: number;
}

/** 成就条目（`db/{lang}/achievement.json` 里 series.items 的元素） */
export interface AchievementEntry {
  readonly id: string;
  readonly name: string;
  readonly desc: RichText;
  /** `Low` / `Mid` / `High` */
  readonly rarity: string;
  /** `visible` / `hidden` */
  readonly visibility: string;
  readonly paramList: readonly number[];
}

// ---------------------------------------------------------------------------
// 详情（`db/{lang}/**`，按语言各存一份）
// ---------------------------------------------------------------------------

/** 角色行迹/属性成长的一档（`stats["0"]`） */
export interface CharacterStatTier {
  readonly attack_base: number;
  readonly attack_add: number;
  readonly defence_base: number;
  readonly defence_add: number;
  readonly hp_base: number;
  readonly hp_add: number;
  readonly speed_base: number;
  readonly critical_chance: number;
  readonly critical_damage: number;
  readonly base_aggro: number;
  readonly cost?: readonly { item_id: number; item_num: number; rarity: string }[];
}

/**
 * 角色技能（`db/{lang}/character/{id}.json` 的 `skills[]` 元素）
 *
 * T04 详情页要按等级渲染 `desc` 里的参数占位，所以把 `levels` 一并声明。
 * 实测：普攻 10 级、部分技能 15 级，`level` 是 1-based 且不一定连续，
 * 取参数表要用 `paramListAtLevel()` 按 `level` 查找，不能用数组下标。
 */
export interface CharacterSkill {
  readonly id: string;
  readonly name: string;
  readonly desc: RichText;
  readonly simpleDesc?: string;
  readonly type: string;
  readonly typeName?: string;
  readonly tag?: string;
  readonly spBase?: number;
  readonly levels: readonly { readonly level: number; readonly paramList: readonly number[] }[];
  readonly icon?: string | null;
}

/** 星魂（`ranks[]` 元素） */
export interface CharacterRank {
  readonly id: string;
  readonly name: string;
  readonly desc: RichText;
  readonly icon?: string | null;
}

/** 角色详情（`db/{lang}/character/{id}.json`） */
export interface CharacterDetail {
  readonly id: string;
  readonly name: string;
  readonly desc: RichText;
  readonly rarity: number;
  readonly path: string;
  readonly element: string;
  /** 秘技点/终结技所需能量等 */
  readonly spNeed?: number;
  /** 升阶档位 → 属性曲线；键是 `"0"`..`"6"` */
  readonly stats?: Readonly<Record<string, CharacterStatTier>>;
  /** T02 预计算的满级值（架构文档 §5.3） */
  readonly maxLevelStats?: unknown;
  /** 技能列表（真实数据里有，T04 详情页消费） */
  readonly skills?: readonly CharacterSkill[];
  /** 星魂列表 */
  readonly ranks?: readonly CharacterRank[];
}

/** 光锥叠影技能 */
export interface LightconeRefinement {
  readonly name: string;
  readonly desc: RichText;
  readonly levels: readonly { level: number; paramList: readonly number[] }[];
}

/** 光锥详情（174 条） */
export interface LightconeDetail {
  readonly id: string;
  readonly name: string;
  readonly desc: RichText;
  readonly rarity: number;
  readonly path: string;
  readonly refinement?: LightconeRefinement;
  readonly maxLevelStats?: unknown;
}

/** 遗器套装的单件 */
export interface RelicPiece {
  readonly id: string;
  readonly name: string;
  readonly desc: RichText | null;
  readonly story: RichText | null;
}

/** 遗器套装效果（2 件 / 4 件） */
export interface RelicSetEffect {
  readonly pieces: number;
  readonly desc: RichText;
  readonly paramList?: readonly number[];
}

/** 遗器套装详情（64 条） */
export interface RelicSetDetail {
  readonly id: string;
  readonly name: string;
  readonly icon: string;
  readonly kind: string;
  readonly parts: readonly RelicPiece[];
  readonly effects: readonly RelicSetEffect[];
}

/** 敌人基础属性 */
export interface MonsterBaseStats {
  readonly hp: number;
  readonly attack: number;
  readonly defence: number;
  readonly speed: number;
  readonly stance: number;
  readonly stanceCount: number;
  readonly critDamage: number;
  readonly statusResistance: number;
}

/** 敌人变体 */
export interface MonsterVariant {
  readonly id: string;
  readonly hpModifyRatio: number;
  readonly attackModifyRatio: number;
  readonly defenceModifyRatio: number;
  readonly speedModifyRatio: number;
}

/** 敌人详情（按主变体 id 存一份，666 个文件） */
export interface MonsterDetail {
  readonly id: string;
  readonly name: string;
  readonly desc: RichText;
  readonly rank: string;
  readonly camp: string | null;
  readonly icon: string;
  readonly baseStats?: MonsterBaseStats;
  readonly variants?: readonly MonsterVariant[];
}

/** 物品详情（`db/{lang}/item/{id % 16}.json`，分片内是对象） */
export interface ItemDetail {
  readonly id: string;
  readonly name: string;
  readonly desc: RichText;
  readonly bgDesc?: RichText;
  readonly comefrom?: readonly unknown[];
  readonly mainType: string;
  readonly subType: string;
  readonly rarity: number;
  readonly purposeType: number;
  readonly icon: string;
  readonly pileLimit?: number;
  readonly returnItemIds?: readonly string[];
}

/** 成就系列详情（含条目） */
export interface AchievementSeriesDetail extends AchievementSeriesBrief {
  readonly items: readonly AchievementEntry[];
}

/**
 * 索引集合：`datapack_index` 命令的返回形状。
 *
 * 与 Rust 侧 `IndexBundle` 字段一一对应（`counts` 是 `meta.json` 声明的计数，
 * 前端可据此核对「读到的条数」和「应该有的条数」是否一致）。
 */
export interface DatapackIndexBundle {
  readonly packId: string;
  readonly gameVersion: string;
  readonly schemaVersion: number;
  readonly counts: {
    readonly character: number;
    readonly lightcone: number;
    readonly relicset: number;
    readonly monster: number;
    readonly monsterGroups: number;
    readonly item: number;
    readonly achievement: number;
    readonly achievementSeries: number;
  };
  readonly characters: readonly CharacterBrief[];
  readonly lightcones: readonly LightconeBrief[];
  readonly relicsets: readonly RelicSetBrief[];
  readonly monsters: readonly MonsterBrief[];
  readonly items: readonly ItemBrief[];
  readonly achievementSeries: readonly AchievementSeriesBrief[];
}

/**
 * 模块 key。
 *
 * 前六个与 `getIndex` 的键一致；后六个是「货币战争」的图鉴子模块（v2.10 起），
 * 数据不在启动索引里，走 `getCurrencyEntries(kind, lang)` 异步读，因此
 * `getIndex` / `ModuleIndexMap` 不覆盖它们——只有 `ModuleKey`（实体键类型）
 * 与 `MODULE_KEYS`（收藏/笔记/对比白名单）把它们纳进来。
 */
export type ModuleKey =
  | IndexModuleKey
  | 'currencyRole'
  | 'currencyItem'
  | 'currencyBuff'
  | 'currencyAugment'
  | 'currencySpotlight'
  | 'currencyTrait';

/** 有启动索引的六个模块（`getIndex` / `ModuleIndexMap` 只认它们） */
export type IndexModuleKey =
  | 'character'
  | 'lightcone'
  | 'relicset'
  | 'monster'
  | 'item'
  | 'achievementSeries';

/**
 * 模块 → brief 数组类型。
 *
 * 用映射类型而不用 union，是为了让 `getIndex('character')` 在编译期就精确到
 * `CharacterBrief[]`，调用方不需要断言（架构文档 §5.2 的原话）。
 */
export interface ModuleIndexMap {
  character: readonly CharacterBrief[];
  lightcone: readonly LightconeBrief[];
  relicset: readonly RelicSetBrief[];
  monster: readonly MonsterBrief[];
  item: readonly ItemBrief[];
  achievementSeries: readonly AchievementSeriesBrief[];
}