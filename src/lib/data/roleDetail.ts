/**
 * 角色详情（原站 `/currency/role/:id`）的数据读取与解析
 *
 * ## 为什么要单独一层
 *
 * 汇总文件 `db/{lang}/currency/role.json` 每条只有 8 个字段（id / 名称 / 星级 /
 * 前后排 / 治疗或护盾 / 充能类型 / `trait_list`），**没有**任何可展开的内容。
 * 原站详情页的星魂、前后排技能、三档属性、推荐光锥全在单条文件里：
 *
 *   `db/{lang}/currency/role/{id}.json`（实测 1006 为 60 KB）
 *
 * 这份数据由 `scripts/build-extra-modules.mjs` 的「3b」步下载（138 条 × 4 语言），
 * 不进 `datapack_index`，按路径直读。
 *
 * ## 字段名的两套写法
 *
 * 源站原始数据是 PascalCase（`FrontShowSkill`），本包已经规范化成 snake_case
 * （`front_show_skill`）。原站自己的渲染代码是两种都兜的 —— 因为它要同时吃
 * 版本对比里的旧数据。本包只有一种，但**取字段仍走 {@link pick}**：将来换包
 * 格式变了不至于整页空白，这层兜底比省几行代码值。
 *
 * ## 参数表：技能描述里的 `#1[i]`
 *
 * 前排技能的数值在 `level` 对象里按技能等级（1–15）分档，**没有**顶层
 * `param_list`；后排技能反过来。{@link skillParams} 统一成「优先顶层，其次最高档」，
 * 于是两类技能都能用同一套 `MacroText` 渲染。
 */

import type { Lang } from '@/i18n';
import { dal } from '@/lib/data/dal';

/* ------------------------------------------------------------------ */
/* 类型                                                                */
/* ------------------------------------------------------------------ */

/** 技能附带的词条说明（原站显示在技能描述下方的小字，例如「基础概率」） */
export interface RoleSkillExtra {
  readonly name: string;
  readonly desc: string;
}

/** 详情页里展示的一条技能 */
export interface RoleDetailSkill {
  readonly id: string;
  readonly name: string;
  readonly desc: string;
  readonly simpleDesc: string;
  /** 原始枚举，例如 `AoEAttack`；页面负责映射成译文，映射不到就显示原值 */
  readonly tag: string;
  /** 战技点消耗（`sp_base`），缺省不显示 */
  readonly spBase?: number;
  /** 描述里 `#1` 对应的参数表 */
  readonly paramList: readonly number[];
  readonly extras: readonly RoleSkillExtra[];
}

/** 一个星级档（原站 1 / 2 / 3 三档，用滑块切换） */
export interface RoleStar {
  readonly star: number;
  readonly frontSkills: readonly RoleDetailSkill[];
  readonly backSkills: readonly RoleDetailSkill[];
  readonly supportSkills: readonly RoleDetailSkill[];
  /** 前排特质的一句话文案（原站 `FrontOneWordDesc`） */
  readonly frontTrait: string;
  /** 后排特质的一句话文案 */
  readonly backTrait: string;
  /** 生命值提高（`HPAddedRatio`，已转成百分比数值，如 45 表示 45%） */
  readonly hpRatio: number;
  /** 速度提高（`SpeedAddedRatio`） */
  readonly spdRatio: number;
  readonly frontPower?: number;
  readonly backPower?: number;
  readonly healBase?: number;
  readonly shieldBase?: number;
}

/** 星魂（原站 Eidolons，1–6） */
export interface RoleEidolon {
  readonly rank: number;
  readonly name: string;
  readonly desc: string;
  readonly paramList: readonly number[];
}

/** 角色详情页的全部可用数据 */
export interface RoleDetailData {
  readonly id: string;
  readonly name: string;
  readonly rarity: number;
  /** `Front` / `Back` / `Both` */
  readonly frontBackType: string;
  /** `Healer` / `Shielder` 之类，原站显示为职业徽标 */
  readonly healOrShield: string;
  /** 三个星级档，按 star 升序 */
  readonly stars: readonly RoleStar[];
  readonly eidolons: readonly RoleEidolon[];
  /** 推荐光锥 id（原站跳 `/lightcone/:id`） */
  readonly lightcones: readonly string[];
  /** 归属羁绊 id（`trait_list`），页面去羁绊图鉴里反查名称与描述 */
  readonly traitIds: readonly string[];
}

/* ------------------------------------------------------------------ */
/* 取值工具                                                            */
/* ------------------------------------------------------------------ */

type Dict = Record<string, unknown>;

function isDict(value: unknown): value is Dict {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 取字段：先按 snake_case，再按 PascalCase。
 *
 * @param source 对象
 * @param snake snake_case 键
 * @param pascal PascalCase 键
 */
function pick(source: unknown, snake: string, pascal: string): unknown {
  if (!isDict(source)) return undefined;
  return source[snake] ?? source[pascal];
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function asNumberList(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => asNumber(item) ?? 0);
}

/**
 * 技能描述用的参数表。
 *
 * 前排技能把数值放在 `level[等级].param_list`（顶层没有 `param_list`），
 * 后排技能直接用顶层 `param_list`。这里优先顶层，缺失时取**等级最高**那一档 ——
 * 与原站 `Kt()` 的选择一致（详情页不提供等级切换，一律按满级显示）。
 *
 * @param skill 原始技能对象
 */
function skillParams(skill: unknown): readonly number[] {
  const direct = asNumberList(pick(skill, 'param_list', 'ParamList'));
  if (direct.length > 0) return direct;
  const levels = pick(skill, 'level', 'Level');
  if (!isDict(levels)) return [];
  const keys = Object.keys(levels)
    .map(Number)
    .filter((key) => Number.isFinite(key))
    .sort((left, right) => left - right);
  const last = keys[keys.length - 1];
  if (last === undefined) return [];
  const level = levels[String(last)];
  return asNumberList(pick(level, 'param_list', 'ParamList'));
}

/** 技能附带的词条说明（`extra` 是 id → {name, desc} 的对象） */
function skillExtras(skill: unknown, keySnake: string, keyPascal: string): readonly RoleSkillExtra[] {
  const raw = pick(skill, keySnake, keyPascal);
  if (!isDict(raw)) return [];
  return Object.values(raw)
    .filter(isDict)
    .map((item) => ({ name: asText(item.name ?? item.Name), desc: asText(item.desc ?? item.Desc) }))
    .filter((item) => item.name !== '' || item.desc !== '');
}

/** 解析一条技能 */
function parseSkill(raw: unknown): RoleDetailSkill | undefined {
  if (!isDict(raw)) return undefined;
  const name = asText(pick(raw, 'name', 'Name'));
  const desc = asText(pick(raw, 'desc', 'Desc'));
  if (name === '' && desc === '') return undefined;
  return {
    id: String(pick(raw, 'id', 'Id') ?? ''),
    name,
    desc,
    simpleDesc: asText(pick(raw, 'simple_desc', 'SimpleDesc')),
    tag: asText(pick(raw, 'tag', 'Tag')),
    spBase: asNumber(pick(raw, 'sp_base', 'SPBase')),
    paramList: skillParams(raw),
    extras: skillExtras(raw, 'extra', 'Extra'),
  };
}

/** 解析一组技能（`{skillId: skill}` 的对象，按 id 升序保证顺序稳定） */
function parseSkillGroup(raw: unknown): readonly RoleDetailSkill[] {
  if (!isDict(raw)) return [];
  return Object.keys(raw)
    .sort()
    .map((key) => parseSkill(raw[key]))
    .filter((item): item is RoleDetailSkill => item !== undefined);
}

/**
 * 从 `general_property_modify_list` 里取某个属性类型的百分比数值。
 *
 * 源数据是 0.45 这种比例，原站 `Math.round(value * 100)` 显示成 `45%`。
 *
 * @param star 星级档对象
 * @param needle 属性类型片段，例如 `HPAddedRatio`
 */
function propertyPercent(star: unknown, needle: string): number {
  const list = pick(star, 'general_property_modify_list', 'GeneralPropertyModifyList');
  if (!Array.isArray(list)) return 0;
  const hit = list.find((item) => {
    const type = pick(item, 'property_type', 'PropertyType');
    return typeof type === 'string' && type.includes(needle);
  });
  const value = asNumber(pick(hit, 'value', 'Value')) ?? 0;
  return Math.round(value * 100);
}

/** 解析一个星级档 */
function parseStar(raw: unknown, star: number): RoleStar {
  return {
    star,
    frontSkills: parseSkillGroup(pick(raw, 'front_show_skill', 'FrontShowSkill')),
    backSkills: parseSkillGroup(pick(raw, 'back_show_skill', 'BackShowSkill')),
    supportSkills: parseSkillGroup(pick(raw, 'servant_show_skill', 'ServantShowSkill')),
    frontTrait: asText(pick(raw, 'front_one_word_desc', 'FrontOneWordDesc')),
    backTrait: asText(pick(raw, 'back_one_word_desc', 'BackOneWordDesc')),
    hpRatio: propertyPercent(raw, 'HPAddedRatio'),
    spdRatio: propertyPercent(raw, 'SpeedAddedRatio'),
    frontPower: asNumber(pick(raw, 'front_power_base', 'FrontPowerBase')),
    backPower: asNumber(pick(raw, 'back_power_base', 'BackPowerBase')),
    healBase: asNumber(pick(raw, 'extra_heal_base', 'ExtraHealBase')),
    shieldBase: asNumber(pick(raw, 'extra_shield_base', 'ExtraShieldBase')),
  };
}

/** 解析星魂（`rank` 是 id → {rank, name, desc} 的对象） */
function parseEidolons(raw: unknown): readonly RoleEidolon[] {
  if (!isDict(raw)) return [];
  return Object.values(raw)
    .filter(isDict)
    .map((item) => ({
      rank: asNumber(pick(item, 'rank', 'Rank')) ?? 0,
      name: asText(pick(item, 'name', 'Name')),
      desc: asText(pick(item, 'desc', 'Desc')),
      paramList: asNumberList(pick(item, 'param_list', 'ParamList')),
    }))
    .filter((item) => item.rank > 0)
    .sort((left, right) => left.rank - right.rank);
}

/* ------------------------------------------------------------------ */
/* 对外读取                                                            */
/* ------------------------------------------------------------------ */

/**
 * 读一个角色的详情。
 *
 * 找不到文件时**不抛错**：页面要区分「数据包缺这条」与「数据层坏了」，
 * 两者显示不同提示。所以这里返回 `undefined`，由调用方决定文案。
 *
 * @param id 角色 id（`db/{lang}/currency/role/{id}.json` 的文件名）
 * @param lang 当前界面语言
 */
export async function getRoleDetail(id: string, lang: Lang): Promise<RoleDetailData | undefined> {
  let raw: unknown;
  try {
    raw = await dal.readJson<unknown>(`db/${lang}/currency/role/${id}.json`);
  } catch {
    return undefined;
  }
  if (!isDict(raw)) return undefined;

  const starsRaw = pick(raw, 'star', 'Star');
  const stars = isDict(starsRaw)
    ? Object.keys(starsRaw)
        .map(Number)
        .filter((star) => Number.isFinite(star))
        .sort((left, right) => left - right)
        .map((star) => parseStar(starsRaw[String(star)], star))
    : [];

  const equipment = pick(raw, 'equipment', 'Equipment');
  const lightcones = isDict(equipment) ? Object.keys(equipment) : [];

  const traitIds = Array.isArray(pick(raw, 'trait_list', 'TraitList'))
    ? (pick(raw, 'trait_list', 'TraitList') as unknown[]).map((item) => String(item))
    : [];

  return {
    id: String(pick(raw, 'id', 'Id') ?? id),
    name: asText(pick(raw, 'name', 'Name')),
    rarity: asNumber(pick(raw, 'rarity', 'Rarity')) ?? 0,
    frontBackType: asText(pick(raw, 'front_back_type', 'FrontBackType')),
    healOrShield: asText(pick(raw, 'heal_or_shield_display', 'HealOrShieldDisplay')),
    stars,
    eidolons: parseEidolons(pick(raw, 'rank', 'Rank')),
    lightcones,
    traitIds,
  };
}
