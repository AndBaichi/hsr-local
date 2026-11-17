/**
 * 字段规范化（架构文档 §8.9 `scripts/lib/normalize.ts`、附录 A）
 *
 * 源站字段混用 `baseType` / `base_type` / `ParamList`，枚举是长字符串。
 * 这里把它规范化成**应用自有 schema v1**：
 *  - 稀有度 → 1–5 整数
 *  - `Thunder` → `Lightning`（应用侧统一用 Lightning）
 *  - `ParamList` → `paramList`
 *  - 富文本 → 结构化节点树（`{blocks:[{nodes:[...]}]}`）
 *  - 图片路径 → 本地 `img/{kind}/{name}.webp`
 *
 * 唯一的"猜字段含义"的地方，必须逐条可查（对齐附录 A）。
 */

import { cleanBlocks, cleanPlainText } from './richtext.mjs';
import { toLocalImagePath } from './images.mjs';

/** 属性枚举：源站用 Thunder 表示雷 */
const ELEMENT_ALIAS = {
  Physical: 'Physical',
  Fire: 'Fire',
  Ice: 'Ice',
  Thunder: 'Lightning',
  Lightning: 'Lightning',
  Wind: 'Wind',
  Quantum: 'Quantum',
  Imaginary: 'Imaginary',
};

/** 物品稀有度枚举 → 1–5 */
const ITEM_RARITY = {
  SuperRare: 5,
  VeryRare: 4,
  Rare: 3,
  NotNormal: 2,
  Normal: 1,
};

/** 成就稀有度（保持字符串，仅用于徽标色） */
const ACHIEVEMENT_RARITY = new Set(['High', 'Mid', 'Low']);

/** 成就可见性映射 */
const ACHIEVEMENT_VISIBILITY = {
  VISIBLE: 'visible',
  ShowAfterFinish: 'hidden',
  HiddenDesc: 'hiddenDesc',
};

/**
 * 从 `CombatPowerAvatarRarityType5` 这类字符串取末位数字。
 *
 * @param {string} value 源站稀有度串
 * @returns {number} 1–5；无法解析时返回 1
 */
export function parseRarity(value) {
  if (typeof value === 'number' && Number.isInteger(value)) return Math.min(5, Math.max(1, value));
  if (typeof value !== 'string') return 1;
  const match = /(\d+)\s*$/.exec(value);
  if (!match) return 1;
  const numeric = Number(match[1]);
  return Number.isFinite(numeric) ? Math.min(5, Math.max(1, numeric)) : 1;
}

/**
 * 属性枚举规范化。
 *
 * @param {string} value 源站属性
 * @returns {string} 应用侧属性
 */
export function normalizeElement(value) {
  return ELEMENT_ALIAS[value] ?? 'Physical';
}

/**
 * 物品稀有度规范化。
 *
 * @param {string} value 源站枚举
 */
export function normalizeItemRarity(value) {
  return ITEM_RARITY[value] ?? 1;
}

/**
 * 富文本 → 块级节点树。
 *
 * @param {string} text 源文本
 * @param {{lang: string, warnings: object}} ctx 上下文
 * @param {'template'|'resolve'} [mode] 参数处理模式
 * @param {number[]|null} [paramList] `resolve` 模式的参数表
 * @param {'body'|'comefrom'} [context] 上下文
 */
function blocks(text, ctx, mode = 'template', paramList = null, context = 'body') {
  return cleanBlocks(text, {
    lang: ctx.lang,
    mode,
    paramList,
    context,
    warnings: ctx.warnings,
  });
}

/**
 * 有参数表就在 resolve 模式下解析成数值，没有则降级为占位模式。
 *
 * 用于**源站本身就不提供 param_list** 的字段（敌人描述、召唤物描述等）：
 * 这些占位无法解析，输出 `{p,f,s}` 节点留给运行时兜底，但不产生 paramMissing 假告警。
 *
 * @param {string} text 源文本
 * @param {{lang: string, warnings: object}} ctx 上下文
 * @param {number[]|null} paramList 参数表
 * @returns {Array<object>|null} 块数组
 */
function autoBlocks(text, ctx, paramList) {
  const table = Array.isArray(paramList) && paramList.length > 0 ? paramList : null;
  return blocks(text, ctx, table ? 'resolve' : 'template', table);
}

/**
 * 富文本 → 单行纯文本（名称等）。
 *
 * @param {string} text 源文本
 * @param {{lang: string, warnings: object}} ctx 上下文
 */
function plain(text, ctx, paramList = null) {
  return cleanPlainText(text, {
    lang: ctx.lang,
    warnings: ctx.warnings,
    paramList,
  });
}

/**
 * `stats` 的 7 个升阶档 → 满级（80 级）属性。
 *
 * @param {Record<string, any>} stats 源站 stats
 * @returns {{hp: number, attack: number, defence: number, speed: number, critRate: number, critDamage: number, aggro: number}|null}
 */
export function maxLevelStatsFromCharacter(stats) {
  const final = stats?.['6'];
  if (!final) return null;
  const level = 80;
  return {
    hp: round1(final.hp_base + final.hp_add * (level - 1)),
    attack: round1(final.attack_base + final.attack_add * (level - 1)),
    defence: round1(final.defence_base + final.defence_add * (level - 1)),
    speed: round1(final.speed_base),
    critRate: round1(final.critical_chance * 100) / 100,
    critDamage: round1(final.critical_damage),
    aggro: final.base_aggro,
  };
}

/**
 * 保留 1 位小数。
 *
 * @param {number} value 数值
 */
function round1(value) {
  return Math.round(Number(value) * 10) / 10;
}

/* ------------------------------------------------------------------ */
/* 列表（索引）规范化                                                   */
/* ------------------------------------------------------------------ */

/**
 * 角色索引条目。
 *
 * @param {string} id 角色 id
 * @param {any} raw 源站条目
 * @param {{lang: string, warnings: object}} ctx 上下文（zh 视角）
 */
export function normalizeCharacterBrief(id, raw, ctx) {
  return {
    id,
    name: plain(raw.zh, ctx),
    names: {
      zh: plain(raw.zh, { ...ctx, lang: 'zh' }),
      en: plain(raw.en, { ...ctx, lang: 'en' }),
      ja: plain(raw.ja, { ...ctx, lang: 'ja' }),
      ko: plain(raw.ko, { ...ctx, lang: 'ko' }),
    },
    rarity: parseRarity(raw.rank),
    path: raw.baseType ?? raw.base_type ?? 'Warrior',
    element: normalizeElement(raw.damageType ?? raw.damage_type),
    icon: toLocalImagePath('character', id),
    release: raw.release ?? null,
  };
}

/**
 * 光锥索引条目。
 *
 * @param {string} id 光锥 id
 * @param {any} raw 源站条目
 * @param {{lang: string, warnings: object}} ctx 上下文
 */
export function normalizeLightconeBrief(id, raw, ctx) {
  return {
    id,
    name: plain(raw.zh, ctx),
    names: {
      zh: plain(raw.zh, { ...ctx, lang: 'zh' }),
      en: plain(raw.en, { ...ctx, lang: 'en' }),
      ja: plain(raw.ja, { ...ctx, lang: 'ja' }),
      ko: plain(raw.ko, { ...ctx, lang: 'ko' }),
    },
    rarity: parseRarity(raw.rank),
    path: raw.baseType ?? raw.base_type ?? 'Warrior',
    icon: toLocalImagePath('lightcone', id),
    atk: raw.atk ?? null,
  };
}

/**
 * 遗器套装索引条目。
 *
 * @param {string} id 套装 id
 * @param {any} raw 源站条目
 * @param {any} detail 套装详情（用于判定部位数与 kind）
 * @param {{lang: string, warnings: object}} ctx 上下文
 */
export function normalizeRelicsetBrief(id, raw, detail, ctx) {
  const partCount = detail?.parts ? Object.keys(detail.parts).length : 0;
  const effectKeys = detail?.require_num ? Object.keys(detail.require_num) : [];
  return {
    id,
    name: plain(raw.zh, ctx),
    names: {
      zh: plain(raw.zh, { ...ctx, lang: 'zh' }),
      en: plain(raw.en, { ...ctx, lang: 'en' }),
      ja: plain(raw.ja, { ...ctx, lang: 'ja' }),
      ko: plain(raw.ko, { ...ctx, lang: 'ko' }),
    },
    kind: partCount === 2 ? 'planar' : 'cavern',
    partCount,
    effectPieces: effectKeys.map(Number).sort((a, b) => a - b),
    icon: toLocalImagePath('item', raw.icon),
  };
}

/**
 * 敌人索引（按 zh 名归组）。
 *
 * @param {Record<string, any>} monsterList 源站 monster.json（id → 条目）
 * @param {{lang: string, warnings: object}} ctx 上下文
 * @returns {{groups: Array<object>, groupCount: number, ungroupedDuplicates: number}}
 */
export function normalizeMonsterIndex(monsterList, ctx) {
  /** @type {Map<string, {names: any, ids: string[], primaryId: string, rank: string, camp: any, weak: string[], icon: string}>} */
  const groups = new Map();

  const ids = Object.keys(monsterList).sort((a, b) => a.localeCompare(b));
  for (const id of ids) {
    const raw = monsterList[id];
    const key = plain(raw.zh, ctx) || id;
    const existing = groups.get(key);
    if (existing) {
      existing.ids.push(id);
      continue;
    }
    groups.set(key, {
      key,
      names: {
        zh: plain(raw.zh, { ...ctx, lang: 'zh' }),
        en: plain(raw.en, { ...ctx, lang: 'en' }),
        ja: plain(raw.ja, { ...ctx, lang: 'ja' }),
        ko: plain(raw.ko, { ...ctx, lang: 'ko' }),
      },
      ids: [id],
      primaryId: id,
      rank: raw.rank ?? 'Minion',
      camp: raw.camp ?? null,
      weak: (raw.weak ?? []).map(normalizeElement),
      icon: toLocalImagePath('monster', raw.icon || id),
    });
  }

  const result = [...groups.values()].map((group, index) => ({
    groupKey: group.key,
    names: group.names,
    rank: group.rank,
    camp: group.camp,
    weak: group.weak,
    icon: group.icon,
    primaryId: group.primaryId,
    variantIds: group.ids,
    variantCount: group.ids.length,
    order: index,
  }));

  return {
    groups: result,
    groupCount: result.length,
    totalMonsters: ids.length,
  };
}

/**
 * 物品索引条目（语言中立，含四语言名）。
 *
 * @param {string} id 物品 id
 * @param {Record<string, any>} byLang 该物品在四语言下的原始记录
 * @param {{lang: string, warnings: object}} ctx 上下文
 */
export function normalizeItemBrief(id, byLang, ctx) {
  const zh = byLang.zh ?? Object.values(byLang)[0];
  return {
    id,
    names: {
      zh: plain((byLang.zh ?? zh).item_name, { ...ctx, lang: 'zh' }),
      en: plain((byLang.en ?? zh).item_name, { ...ctx, lang: 'en' }),
      ja: plain((byLang.ja ?? zh).item_name, { ...ctx, lang: 'ja' }),
      ko: plain((byLang.ko ?? zh).item_name, { ...ctx, lang: 'ko' }),
    },
    mainType: zh.item_main_type ?? null,
    subType: zh.item_sub_type ?? null,
    rarity: normalizeItemRarity(zh.rarity),
    purposeType: typeof zh.purpose_type === 'number' ? zh.purpose_type : null,
    displayTag: zh.inventory_display_tag ?? null,
    icon: toLocalImagePath('item', zh.item_figure_icon_path || zh.item_icon_path),
    group: zh.item_group ?? null,
  };
}

/**
 * 物品详情（按语言，含清洗后的描述与获取途径）。
 *
 * @param {string} id 物品 id
 * @param {any} raw 该语言的原始记录
 * @param {{lang: string, warnings: object}} ctx 上下文
 * @returns {{detail: object, droppedComefrom: number}}
 */
export function normalizeItemDetail(id, raw, ctx) {
  const comefrom = [];
  let dropped = 0;
  for (const entry of Array.isArray(raw.item_comefrom) ? raw.item_comefrom : []) {
    const cleaned = blocks(entry.desc, ctx, 'resolve', null, 'comefrom');
    if (cleaned === null) {
      dropped += 1;
      continue;
    }
    comefrom.push({ id: entry.id ?? null, desc: cleaned });
  }

  return {
    detail: {
      id,
      name: plain(raw.item_name, ctx),
      desc: blocks(raw.item_desc, ctx, 'resolve'),
      bgDesc: blocks(raw.item_bg_desc, ctx, 'resolve'),
      comefrom,
      mainType: raw.item_main_type ?? null,
      subType: raw.item_sub_type ?? null,
      rarity: normalizeItemRarity(raw.rarity),
      purposeType: typeof raw.purpose_type === 'number' ? raw.purpose_type : null,
      icon: toLocalImagePath('item', raw.item_figure_icon_path || raw.item_icon_path),
      pileLimit: raw.pile_limit ?? null,
      returnItemIds: Array.isArray(raw.return_item_id_list) ? raw.return_item_id_list : [],
      customData: Array.isArray(raw.custom_data_list) ? raw.custom_data_list : [],
    },
    droppedComefrom: dropped,
  };
}

/**
 * 成就索引（系列 + 条目，按语言）。
 *
 * @param {Record<string, any>} achievementRaw 源站 achievement.json（系列 id → 系列）
 * @param {{lang: string, warnings: object}} ctx 上下文
 * @returns {{series: Array<object>, itemCount: number, droppedTextId: number}}
 */
export function normalizeAchievement(achievementRaw, ctx) {
  const seriesList = Object.values(achievementRaw)
    .slice()
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || (a.id ?? 0) - (b.id ?? 0));

  let itemCount = 0;
  let droppedTextId = 0;
  const series = [];

  for (const rawSeries of seriesList) {
    const items = [];
    for (const rawItem of rawSeries.list ?? []) {
      const descBlocks = blocks(rawItem.desc, ctx, 'resolve', rawItem.param_list ?? []);
      if (descBlocks === null) {
        droppedTextId += 1;
        continue;
      }
      items.push({
        id: String(rawItem.id),
        name: plain(rawItem.name, ctx),
        desc: descBlocks,
        rarity: ACHIEVEMENT_RARITY.has(rawItem.rarity) ? rawItem.rarity : 'Low',
        visibility: ACHIEVEMENT_VISIBILITY[rawItem.show_type] ?? 'visible',
        paramList: Array.isArray(rawItem.param_list) ? rawItem.param_list : [],
      });
      itemCount += 1;
    }

    series.push({
      id: String(rawSeries.id),
      name: plain(rawSeries.name, ctx),
      priority: rawSeries.priority ?? 0,
      itemCount: items.length,
      hiddenCount: items.filter((item) => item.visibility === 'hidden').length,
      hiddenDescCount: items.filter((item) => item.visibility === 'hiddenDesc').length,
      items,
    });
  }

  return { series, itemCount, droppedTextId };
}

/* ------------------------------------------------------------------ */
/* 详情规范化                                                          */
/* ------------------------------------------------------------------ */

/** enhanced（强化形态）子树里，值需要清洗为块级节点树的 key */
const BLOCK_TEXT_KEYS = new Set(['desc', 'descs', 'point_desc', 'simple_desc', 'story', 'stories']);

/** enhanced 子树里，值需要清洗为单行纯文本的 key */
const PLAIN_TEXT_KEYS = new Set(['name', 'point_name', 'title', 'voice_title', 'unlock_desc', 'skill_name', 'skill_desc']);

/**
 * 取一个对象可用的参数表。
 *
 * 优先用自身 `param_list`；技能对象（`{desc, level:{1:{param_list}}}`）没有顶层参数表，
 * 取**最高等级**那张 —— 强化技能在游戏内固定按满级展示，因此可以直接解析成数值。
 * 都没有则回退到上层传入的表（没有就返回 null，由调用方降级为占位模式）。
 *
 * @param {Record<string, any>} value 当前对象
 * @param {number[]|null} fallback 上层传入的参数表
 * @returns {number[]|null} 参数表
 */
function resolveParamsFor(value, fallback) {
  if (Array.isArray(value.param_list) && value.param_list.length > 0) return value.param_list;
  const levels = value.level;
  if (levels && typeof levels === 'object') {
    const rows = Object.values(levels).filter((row) => Array.isArray(row?.param_list));
    const maxRow = rows.length > 0 ? rows[rows.length - 1] : null;
    if (maxRow && maxRow.param_list.length > 0) return maxRow.param_list;
  }
  return fallback;
}

/**
 * 递归清洗「结构未知但含富文本」的子树（当前只用于 enhanced）。
 *
 * 只对**已知文本 key** 做清洗，其它值（id / 枚举 / 图标名 / 数值）原样保留，
 * 避免把 "Normal" 这类枚举值误转成节点树。
 *
 * @param {unknown} value 子树
 * @param {{lang: string, warnings: object}} ctx 上下文
 * @param {string} key 当前 key
 * @param {number[]|null} paramList 最近的 param_list
 * @returns {unknown} 清洗后的子树
 */
function cleanTextSubtree(value, ctx, key, paramList) {
  if (typeof value === 'string') {
    if (BLOCK_TEXT_KEYS.has(key)) {
      // 没有参数表时降级为占位模式：输出同样的 `{p,f,s}` 节点，但不刷假告警
      return paramList && paramList.length > 0
        ? blocks(value, ctx, 'resolve', paramList)
        : blocks(value, ctx, 'template', null);
    }
    if (PLAIN_TEXT_KEYS.has(key)) return plain(value, ctx, paramList);
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => cleanTextSubtree(item, ctx, key, paramList));
  }
  if (value && typeof value === 'object') {
    const localParams = resolveParamsFor(value, paramList);
    const out = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      out[childKey] = cleanTextSubtree(childValue, ctx, childKey, localParams);
    }
    return out;
  }
  return value;
}

/**
 * 角色详情。
 *
 * @param {string} id 角色 id
 * @param {any} raw 源站详情
 * @param {{lang: string, warnings: object}} ctx 上下文
 */
export function normalizeCharacterDetail(id, raw, ctx) {
  const skills = Object.values(raw.skills ?? {}).map((skill) => ({
    id: String(skill.id),
    name: plain(skill.name, ctx),
    desc: blocks(skill.desc, ctx, 'template'),
    // 技能「简要说明」里也可能带 `#1[i]%`（如黑塔天赋），用满级参数表解析成数值
    simpleDesc: plain(skill.simple_desc, ctx, resolveParamsFor(skill, null)),
    type: skill.type ?? null,
    typeName: skill.type_name ?? null,
    tag: skill.tag ?? null,
    spBase: skill.sp_base ?? null,
    levels: Object.values(skill.level ?? {})
      .map((level) => ({
        level: level.level ?? null,
        paramList: Array.isArray(level.param_list) ? level.param_list : [],
      }))
      .sort((a, b) => (a.level ?? 0) - (b.level ?? 0)),
    icon: skill.icon ?? null,
  }));

  const ranks = Object.values(raw.ranks ?? {}).map((rank) => ({
    id: String(rank.id),
    name: plain(rank.name, ctx),
    desc: blocks(rank.desc, ctx, 'resolve', Array.isArray(rank.param_list) ? rank.param_list : []),
    icon: rank.icon ?? null,
    paramList: Array.isArray(rank.param_list) ? rank.param_list : [],
  }));

  const exRanks = Object.values(raw.ex_ranks ?? {}).map((rank) => ({
    id: String(rank.id ?? ''),
    name: plain(rank.name, ctx),
    desc: blocks(rank.desc, ctx, 'resolve', Array.isArray(rank.param_list) ? rank.param_list : []),
    icon: rank.icon ?? null,
  }));

  const skillTrees = { main: [], extra: [], stats: [] };
  for (const [pointKey, levels] of Object.entries(raw.skill_trees ?? {})) {
    const rows = Object.values(levels ?? {}).filter(Boolean);
    const first = rows[0];
    if (!first) continue;
    const pointParams = resolveParamsFor(first, null);
    const entry = {
      point: pointKey,
      pointId: first.point_id ?? null,
      pointType: first.point_type ?? null,
      name: first.point_name ? plain(first.point_name, ctx) : null,
      // 天赋点描述里的 `#1[i]%` 要按该点的 `param_list` 解析（源站每行都带）；
      // 个别点没有参数表（如「战技等级+2」）则降级为占位模式，不刷假告警
      desc: first.point_desc
        ? blocks(
            first.point_desc,
            ctx,
            pointParams ? 'resolve' : 'template',
            pointParams,
          )
        : [],
      icon: first.icon ?? null,
      maxLevel: first.max_level ?? null,
      anchor: first.anchor ?? null,
      levels: rows.map((row) => ({
        level: row.point_level ?? null,
        promotionLimit: row.avatar_promotion_limit ?? null,
        levelLimit: row.avatar_level_limit ?? null,
        defaultUnlock: Boolean(row.default_unlock),
        materials: (row.material_list ?? []).map((material) => ({
          itemId: material.item_id,
          count: material.item_num,
          rarity: normalizeItemRarity(material.rarity),
        })),
        statusAddList: (row.status_add_list ?? []).map((status) => ({
          propertyType: status.property_type ?? null,
          value: status.value ?? null,
        })),
      })),
    };
    if (first.point_type === 2) skillTrees.main.push(entry);
    else if (first.point_type === 3) skillTrees.extra.push(entry);
    else skillTrees.stats.push(entry);
  }

  const charaInfo = raw.chara_info ?? {};
  const stories = {};
  for (const [key, value] of Object.entries(charaInfo.stories ?? {})) {
    const cleaned = blocks(value, ctx, 'resolve');
    if (cleaned && cleaned.length > 0) stories[key] = cleaned;
  }

  const voicelines = (charaInfo.voicelines ?? []).map((line) => ({
    id: line.voice_id ?? null,
    title: plain(line.voice_title, ctx),
    audio: line.voice_m ?? null,
    unlockDesc: line.unlock_desc ? plain(line.unlock_desc, ctx) : '',
    isBattleVoice: Boolean(line.is_battle_voice),
  }));

  return {
    id,
    name: plain(raw.name, ctx),
    desc: blocks(raw.desc, ctx, 'resolve'),
    rarity: parseRarity(raw.rarity),
    path: raw.base_type ?? raw.baseType ?? 'Warrior',
    element: normalizeElement(raw.damage_type ?? raw.damageType),
    spNeed: raw.sp_need ?? null,
    avatarVoTag: raw.avatar_vo_tag ?? null,
    stats: raw.stats ?? {},
    maxLevelStats: maxLevelStatsFromCharacter(raw.stats),
    skills,
    ranks,
    exRanks,
    skillTrees,
    memosprite: raw.memosprite
      ? {
          id: String(raw.memosprite.id ?? ''),
          name: plain(raw.memosprite.name, ctx),
          desc: autoBlocks(raw.memosprite.desc ?? '', ctx, null),
          skills: Object.values(raw.memosprite.skills ?? {}).map((skill) => ({
            id: String(skill.id),
            name: plain(skill.name, ctx),
            desc: blocks(skill.desc, ctx, 'template'),
            levels: Object.values(skill.level ?? {}).map((level) => ({
              level: level.level ?? null,
              paramList: Array.isArray(level.param_list) ? level.param_list : [],
            })),
          })),
        }
      : null,
    charaInfo: {
      camp: charaInfo.camp ?? null,
      va: charaInfo.va ?? {},
      stories,
      voicelines,
    },
    relics: raw.relics ?? null,
    lightcones: Array.isArray(raw.lightcones) ? raw.lightcones.map(String) : [],
    enhanced: raw.enhanced ? cleanTextSubtree(raw.enhanced, ctx, 'enhanced', null) : null,
  };
}

/**
 * 光锥详情。
 *
 * @param {string} id 光锥 id
 * @param {any} raw 源站详情
 * @param {{lang: string, warnings: object}} ctx 上下文
 */
export function normalizeLightconeDetail(id, raw, ctx) {
  const refine = raw.refinements ?? {};
  const levels = Object.values(refine.level ?? {}).map((level, index) => ({
    level: index + 1,
    paramList: Array.isArray(level.param_list) ? level.param_list : [],
  }));

  const statsBlocks = Array.isArray(raw.stats) ? raw.stats : [];
  const final = statsBlocks[statsBlocks.length - 1] ?? null;

  return {
    id,
    name: plain(raw.name, ctx),
    desc: blocks(raw.desc, ctx, 'resolve'),
    rarity: parseRarity(raw.rarity),
    path: raw.base_type ?? raw.baseType ?? 'Warrior',
    refinement: {
      name: plain(refine.name, ctx),
      desc: blocks(refine.desc, ctx, 'template'),
      levels,
    },
    maxLevelStats: final
      ? {
          maxLevel: final.max_level ?? null,
          hp: round1(final.base_hp + (final.base_hp_add ?? 0) * ((final.max_level ?? 80) - 1)),
          attack: round1(
            final.base_attack + (final.base_attack_add ?? 0) * ((final.max_level ?? 80) - 1),
          ),
          defence: round1(
            final.base_defence + (final.base_defence_add ?? 0) * ((final.max_level ?? 80) - 1),
          ),
        }
      : null,
  };
}

/**
 * 遗器套装详情。
 *
 * @param {string} id 套装 id
 * @param {any} raw 源站详情
 * @param {{lang: string, warnings: object}} ctx 上下文
 */
export function normalizeRelicsetDetail(id, raw, ctx) {
  const parts = Object.entries(raw.parts ?? {}).map(([partId, part]) => ({
    id: partId,
    name: plain(part.name, ctx),
    desc: part.desc ? blocks(part.desc, ctx, 'resolve') : null,
    story: part.story ? blocks(part.story, ctx, 'resolve') : null,
  }));

  const effects = Object.entries(raw.require_num ?? {})
    .map(([pieces, effect]) => ({
      pieces: Number(pieces),
      desc: blocks(effect.desc, ctx, 'resolve', effect.param_list ?? []),
      paramList: Array.isArray(effect.param_list) ? effect.param_list : [],
    }))
    .sort((a, b) => a.pieces - b.pieces);

  return {
    id,
    name: plain(raw.name, ctx),
    icon: toLocalImagePath('item', raw.icon),
    kind: parts.length === 2 ? 'planar' : 'cavern',
    parts,
    effects,
  };
}

/**
 * 敌人详情（含变体）。
 *
 * @param {string} id 敌人 id
 * @param {any} raw 源站详情
 * @param {{lang: string, warnings: object}} ctx 上下文
 */
export function normalizeMonsterDetail(id, raw, ctx) {
  const variants = (raw.child ?? []).map((child) => ({
    id: String(child.id),
    hpModifyRatio: child.hp_modify_ratio ?? 1,
    attackModifyRatio: child.attack_modify_ratio ?? 1,
    defenceModifyRatio: child.defence_modify_ratio ?? 1,
    speedModifyRatio: child.speed_modify_ratio ?? 1,
    stanceModifyRatio: child.stance_modify_ratio ?? 1,
    eliteGroup: child.elite_group ?? null,
    hardLevelGroup: child.hard_level_group ?? null,
    stanceWeakList: (child.stance_weak_list ?? []).map(normalizeElement),
    resistances: (child.damage_type_resistance ?? []).map((entry) => ({
      element: normalizeElement(entry.damage_type),
      value: entry.value ?? 0,
    })),
    skills: (child.skill_list ?? []).map((skill) => ({
      id: String(skill.id),
      name: plain(skill.skill_name, ctx),
      // 敌人数据不提供 param_list（实测 666 条里 0 条带表），只能占位
      desc: autoBlocks(skill.skill_desc, ctx, null),
      element: skill.damage_type ? normalizeElement(skill.damage_type) : null,
      spHitBase: skill.sp_hit_base ?? null,
    })),
  }));

  const drops = (raw.drop ?? []).map((entry) => ({
    worldLevel: entry.world_level ?? 0,
    avatarExpReward: entry.avatar_exp_reward ?? 0,
    itemIds: (entry.display_item_list ?? []).map((item) => String(item.item_id)),
  }));

  return {
    id,
    name: plain(raw.name, ctx),
    desc: autoBlocks(raw.desc, ctx, null),
    rank: raw.rank ?? null,
    camp: raw.monster_camp_id ?? null,
    icon: toLocalImagePath('monster', raw.image_path || id),
    baseStats: {
      hp: raw.hp_base ?? null,
      attack: raw.attack_base ?? null,
      defence: raw.defence_base ?? null,
      speed: raw.speed_base ?? null,
      stance: raw.stance_base ?? null,
      stanceCount: raw.stance_count ?? null,
      critDamage: raw.critical_damage_base ?? null,
      statusResistance: raw.status_resistance_base ?? null,
    },
    variants,
    drops,
  };
}
