/**
 * 三个新栏目的数据访问（T04b）
 *
 * 与既有六模块的区别：这些 JSON **不进 `datapack_index`**，按包内路径直接读。
 * 全部路径来自 `docs/03-module-expansion.md` 的实测，由 `scripts/build-extra-modules.mjs` 落地。
 *
 * 特别注意两组「名字不一致」，别按直觉拼：
 *  - 汇总文件 `maze_extra.json` → 详情目录 `story/`；`maze_boss.json` → `boss/`；`maze_peak.json` → `peak/`
 *  - 源站元素图标 `thunder` 在包内已重命名成 `lightning`（既有六模块的约定）
 */

import type { TFunction } from 'i18next';

import type { Lang } from '@/i18n';
import { dal } from '@/lib/data/dal';
import { macroTextToPlain } from '@/lib/text/macrotext';

/* ------------------------------------------------------------------ */
/* 终局内容                                                            */
/* ------------------------------------------------------------------ */

/** 四个终局模式 */
export type EndgameMode = 'maze' | 'story' | 'boss' | 'peak';

/** 终局模式定义（顺序与原站子导航一致） */
export const ENDGAME_MODES: readonly {
  readonly key: EndgameMode;
  readonly summary: string;
  readonly navKey: 'endgameMoc' | 'endgamePf' | 'endgameAs' | 'endgamePeak';
}[] = [
  { key: 'maze', summary: 'maze.json', navKey: 'endgameMoc' },
  { key: 'story', summary: 'maze_extra.json', navKey: 'endgamePf' },
  { key: 'boss', summary: 'maze_boss.json', navKey: 'endgameAs' },
  { key: 'peak', summary: 'maze_peak.json', navKey: 'endgamePeak' },
];

/** 终局赛季汇总条目（四语言名 + 时间窗） */
export interface EndgameSeason {
  readonly id: string | number;
  readonly zh?: string | null;
  readonly en?: string | null;
  readonly ja?: string | null;
  readonly ko?: string | null;
  readonly param?: readonly number[];
  readonly begin?: string;
  readonly end?: string;
  readonly live_begin?: string;
  readonly live_end?: string;
}

/** 版本映射：`{ "4.7": [1037], "static": [100, 900] }` */
export type VersionMap = Readonly<Record<string, readonly number[]>>;

/** 读某个模式的赛季汇总（语言无关，含四语言名） */
export async function getEndgameSeasons(mode: EndgameMode): Promise<readonly EndgameSeason[]> {
  const summary = ENDGAME_MODES.find((entry) => entry.key === mode)?.summary ?? 'maze.json';
  const raw = await dal.readJson<Record<string, EndgameSeason>>(`db/${summary}`);
  // 值里多半自带 `id`（maze_extra/maze_boss 是数字、maze.json 是字符串），
  // 但 maze_peak 的值没有 `id` 字段——此时回退到对象键，避免 id 变成 undefined。
  // 展开必须放在前面：先放 `...value`，再用解析后的 id 覆盖，否则会被反向覆盖（TS2783）。
  return Object.entries(raw).map(([id, value]) => ({ ...value, id: value.id ?? id }));
}

/** 读版本映射（只有 maze / peak 有，实测 story / boss 的 404） */
export async function getEndgameVersions(mode: EndgameMode, lang: Lang): Promise<VersionMap> {
  if (mode !== 'maze' && mode !== 'peak') return {};
  return dal.readJson<VersionMap>(`db/${lang}/${mode}/version.json`);
}

/** 读某个赛季详情（结构四模式各异，由页面按模式分派解析） */
export async function getEndgameDetail<T>(mode: EndgameMode, id: string, lang: Lang): Promise<T> {
  return dal.readJson<T>(`db/${lang}/${mode}/${id}.json`);
}

/** 赛季名：`3024` 这类未实装条目的四语言名全为 null，必须回退到「赛季 {id}」 */
export function seasonName(season: EndgameSeason, lang: Lang, fallbackPrefix: string): string {
  const names: Partial<Record<Lang, string | null>> = {
    zh: season.zh,
    en: season.en,
    ja: season.ja,
    ko: season.ko,
  };
  const ordered = [lang, 'zh', 'en'] as const;
  for (const key of ordered) {
    const value = names[key];
    if (typeof value === 'string' && value.trim() !== '') return value;
  }
  return `${fallbackPrefix} ${String(season.id)}`;
}

/* ------------------------------------------------------------------ */
/* 货币战争                                                            */
/* ------------------------------------------------------------------ */

/** 六个图鉴 */
export type CurrencyKind = 'role' | 'item' | 'buff' | 'augment' | 'spotlight' | 'trait';

export const CURRENCY_KINDS: readonly {
  readonly key: CurrencyKind;
  readonly navKey: 'currencyRole' | 'currencyItem' | 'currencyBuff' | 'currencyAugment' | 'currencySpotlight' | 'currencyTrait';
  readonly icon: string;
}[] = [
  { key: 'role', navKey: 'currencyRole', icon: 'img/nav/avatarroundicon/1001.webp' },
  { key: 'item', navKey: 'currencyItem', icon: 'img/nav/gridfight/equipment/350101.webp' },
  { key: 'buff', navKey: 'currencyBuff', icon: 'img/nav/gridfight/portal/101.webp' },
  { key: 'augment', navKey: 'currencyAugment', icon: 'img/nav/gridfight/augmentbig/100101.webp' },
  { key: 'spotlight', navKey: 'currencySpotlight', icon: 'img/nav/gridfight/maincharacterbuff/100000.webp' },
  { key: 'trait', navKey: 'currencyTrait', icon: 'img/nav/gridfight/icon/1001.webp' },
];

/** 货币战争条目（六个图鉴字段差异很大，只声明共性 + 索引签名） */
export interface CurrencyEntry {
  readonly id: string | number;
  readonly name?: string;
  readonly desc?: string;
  readonly simple_desc?: string;
  /** 详情面板的备注：trait 是「条件 → 文案」的对象，其余图鉴没有这个字段 */
  readonly remark?: string | Readonly<Record<string, Record<string, unknown>>>;
  readonly icon_path?: string;
  readonly rarity?: number;
  readonly category?: string;
  readonly category_id?: number;
  readonly quality?: string;
  /** 主角光环是 `[{id,name,color}]` 数组，物品是 `[{id}]` 数组，别当字符串用 */
  readonly tag?: string | readonly CurrencyTag[];
  readonly tag_list?: readonly (string | number)[];
  readonly param_list?: readonly number[];
  readonly param?: readonly number[];
  readonly trait_list?: readonly number[];
  readonly front_back_type?: string;
  readonly is_expert?: boolean;
  /** 主角光环：敌方难度提升档（实测 0 / 3 / 5 / 8） */
  readonly enemy_diff_lv_add?: number;
  readonly is_oc_effective?: boolean;
  readonly is_carry?: boolean;
  readonly trait_id?: number;
  /** 羁绊：激活人数 → 该档的 buff 文案 */
  readonly layer?: Readonly<Record<string, Record<string, unknown>>>;
  readonly sub_trait?: Readonly<Record<string, Record<string, unknown>>>;
  readonly activation_type?: string;
  readonly [extra: string]: unknown;
}

/** 主角光环的标签 */
export interface CurrencyTag {
  readonly id: number;
  readonly name?: string;
  readonly color?: string;
}

/** 读某个图鉴（按当前语言） */
export async function getCurrencyEntries(kind: CurrencyKind, lang: Lang): Promise<readonly CurrencyEntry[]> {
  const raw = await dal.readJson<unknown>(`db/${lang}/currency/${kind}.json`);
  if (Array.isArray(raw)) return raw as CurrencyEntry[];
  if (raw === null || typeof raw !== 'object') return [];
  // 六个文件实测都是「按 id 做键的对象」，其中 item.json 的值**没有** `id` 字段。
  // 直接 Object.values 会让所有 item 条目的 id 变成 undefined（列表没有稳定 key、
  // 图标路径也拿不到）。这里先展开值、再用 `value.id ?? key` 注入解析后的 id。
  return Object.entries(raw as Record<string, Record<string, unknown>>).map(
    ([key, value]) => ({ ...value, id: value.id ?? key }) as CurrencyEntry,
  );
}

/** 条目参数表：不同图鉴字段名不统一，统一在这里兜 */
export function currencyParams(entry: CurrencyEntry): readonly number[] {
  return entry.param_list ?? entry.param ?? [];
}

/**
 * 源站图标族 → 包内目录（全部实测 200）
 */
const ICON_FAMILY: Readonly<Record<string, string>> = {
  GridItem: 'equipment',
  Equipment: 'equipment',
  AugmentBig: 'augmentbig',
  Portal: 'portal',
  MainCharacterBuff: 'maincharacterbuff',
  TraitIcon: 'icon',
};

/**
 * 帕姆王的角色图鉴 id。
 *
 * 这一条在原站本身就是残的：`name` 是 `null`、头像 `avatarshopicon/6042.webp` 404，
 * 卡片上只剩一个空名字的灰框。用户要求用敌人页「合金机铠•帕姆王」的图像顶上，
 * 名字也按敌方数据的本地名补全（见 {@link currencyDisplayName}）。
 */
export const CURRENCY_PAM_KING_ID = '604202';

/**
 * 帕姆王的头像：敌人页「合金机铠•帕姆王」的立绘。
 *
 * 取的是 `monster.json` 里这组的 `icon`（`primaryId 5014020`，包内 90242 字节实测存在）。
 * 运行期同样走数据包 reader，与其它图标共用 `SafeImage` 的候选链，不额外联网。
 */
const PAM_KING_ICON = 'img/monster/5014020.webp';

/** 名字字段是宏占位符而不是真名的取值（原站用 i18n 的 `character.trailblazer` 替换） */
const NICKNAME_PLACEHOLDER = '{NICKNAME}';

/**
 * 特殊显示名表：数据里**没有真名**的条目 → i18n key。
 *
 * 只有这两类，别往里加普通条目（普通条目的名字就在数据里，改这里会让搜索/详情不一致）：
 *  - `604202`：`name` 为 null 的帕姆王
 *  - `8007` / `8009` / `800902`：`name` 字面是 `{NICKNAME}` 的开拓者三个变体
 */
const SPECIAL_NAME_KEYS: Readonly<Record<string, 'currency.pamKingName' | 'currency.trailblazerName'>> = {
  [CURRENCY_PAM_KING_ID]: 'currency.pamKingName',
  '8007': 'currency.trailblazerName',
  '8009': 'currency.trailblazerName',
  '800902': 'currency.trailblazerName',
};

/**
 * 特殊条目的**跨语言**别名（搜索用）。
 *
 * 数据包是「一次只装一种语言」，所以界面切成英文时，条目名只有英文，输入中文
 * 「帕姆王」搜不到。这几条的名字本来就来自 i18n，索性把四语言写法都列进来，
 * 让中文 / 英文 / 日文 / 韩文都能命中（原站名字从敌方数据派生，一并收进来）。
 */
const SPECIAL_NAME_ALIASES: Readonly<Record<string, readonly string[]>> = {
  [CURRENCY_PAM_KING_ID]: [
    '帕姆王',
    'King Pom-Pom',
    'パムキング',
    '폼폼킹',
    '合金机铠•帕姆王',
    'Alloy Mechatron: King Pom-Pom',
    '合金メカヨロイ・パムキング',
    '합금 메카아머•폼폼킹',
  ],
  [NICKNAME_PLACEHOLDER]: ['开拓者', 'Trailblazer', '開拓者', '개척자'],
};

/**
 * 角色图鉴的头像 id（原站 `avatarshopicon/{avatarId}.webp` 的取法）。
 *
 * 原站是 `id.slice(0, 4)`：`11011 → 1101`、`15061 → 1506`、`100402 → 1004`
 * （变体 / NPC 共用本体头像）。本包 138 条角色只有 84 个唯一 id，直接拿完整 id
 * 拼路径会让 68 条全部 404 —— 这就是「角色图片大量缺失」的真因。
 *
 * @param id 条目 id
 */
export function roleAvatarId(id: string): string {
  return String(id).slice(0, 4);
}

/**
 * 角色所属赛季（原站 `z()`）。
 *
 * 规则：id 长度 ≥6 时取第 6 位起转数字（`100402 → 2`），否则为第 1 赛季。
 * 实测本包只有 1 / 2 两季（75 / 63 条）。非数字尾段一律回落第 1 季，
 * 与"宁可多显示也不要让条目消失"的取向一致。
 *
 * @param id 条目 id
 */
export function roleSeasonOf(id: string): number {
  const text = String(id);
  if (text.length < 6) return 1;
  const value = Number(text.slice(5));
  return Number.isFinite(value) ? value : 1;
}

/**
 * 角色头像的候选路径（按 id 计算）。
 *
 * 单独抽出来是因为有些调用方**只有 id**：主角光环的「推荐角色」给的是 id 数组
 * （`recommend: [140502, 121002, …]`），没有完整的角色条目对象。
 *
 * 顺序：`604202` 先走帕姆王的敌人立绘；其余（以及帕姆王的退路）都是
 * `img/character/{avatarId}.webp` → `img/avatarroundicon/{avatarId}.webp`。
 *
 * @param id 角色条目 id
 */
export function currencyRoleIconCandidates(id: string | number): readonly string[] {
  const key = String(id);
  const avatar = roleAvatarId(key);
  const standard = [`img/character/${avatar}.webp`, `img/avatarroundicon/${avatar}.webp`];
  // 帕姆王：原站这条的头像本来就 404（包内也没有 avatarshopicon/6042.webp），
  // 用户指定换成敌人页的立绘；立绘万一缺失再退回常规两只候选，最后才是 SafeImage 占位。
  if (key === CURRENCY_PAM_KING_ID) return [PAM_KING_ICON, ...standard];
  return standard;
}

/**
 * 条目的候选图标路径（按优先级）。
 *
 * 角色图鉴没有 `icon_path`：原站 `/currency/role` 用
 * `assets/hsr/avatarshopicon/{avatarId}.webp`，其中 avatarId 是 **id 前 4 位**
 * （见 {@link roleAvatarId}），对应包内 `img/character/{avatarId}.webp`；
 * 退路是 `img/avatarroundicon/{avatarId}.webp`，再不行由 SafeImage 显示占位。
 * 帕姆王的特例见 {@link currencyRoleIconCandidates}。
 */
export function currencyIconCandidates(entry: CurrencyEntry, kind: CurrencyKind): readonly string[] {
  if (kind === 'role') return currencyRoleIconCandidates(entry.id);
  const source = entry.icon_path;
  if (typeof source !== 'string' || source === '') return [];
  const segments = source.split('/');
  const family = ICON_FAMILY[segments[2]] ?? ICON_FAMILY[segments[3]];
  const base = (segments[segments.length - 1] ?? '').replace(/\.png$/i, '');
  return family && base ? [`img/gridfight/${family}/${base}.webp`] : [];
}

/**
 * 主角光环的标签对象（`tag` 是 `[{ id, name, color }]` 数组）。
 *
 * **不能**用 `tag_list` 那套：物品图鉴的 `tag` 是字符串 / `[{ id }]`，形状不同。
 * 这里逐项验形状，形状不对的条目一律当「没有标签」，而不是抛错。
 *
 * @param entry 条目
 */
export function currencyTags(entry: CurrencyEntry): readonly CurrencyTag[] {
  const raw = entry.tag;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (item: unknown): item is CurrencyTag =>
      typeof item === 'object' && item !== null && typeof (item as CurrencyTag).id === 'number',
  );
}

/**
 * 特殊条目的本地名（按 id 查 {@link SPECIAL_NAME_KEYS}）。
 *
 * @param id 条目 id
 * @param t 翻译函数
 * @returns 命中时返回本地名，普通条目返回 `undefined`
 */
export function currencySpecialName(id: string | number, t: TFunction): string | undefined {
  const key = SPECIAL_NAME_KEYS[String(id)];
  return key === undefined ? undefined : t(key);
}

/**
 * 条目在界面上的**统一显示名**。
 *
 * 这是全项目唯一的入口：卡片、详情标题、图鉴内搜索、羁绊成员、光环推荐角色、
 * 全局搜索都走它，避免出现「卡片显示帕姆王、详情显示 604202」这类不一致。
 *
 * 三条规则（按顺序）：
 *  1. `name` 字面是 `{NICKNAME}` → `currency.trailblazerName`（原站替换成开拓者）
 *  2. id 在 {@link SPECIAL_NAME_KEYS} 里 → 对应的 i18n 名（帕姆王 / 开拓者）
 *  3. 其余：`name` 有值就用它，为空 / null 时回退 id（绝不留空标题）
 *
 * @param entry 条目
 * @param kind 图鉴种类（保留给按图鉴区分的特例，目前只有角色带特例）
 * @param t 翻译函数
 */
export function currencyDisplayName(entry: CurrencyEntry, kind: CurrencyKind, t: TFunction): string {
  const id = String(entry.id);
  const raw = typeof entry.name === 'string' ? entry.name.trim() : '';
  if (raw === NICKNAME_PLACEHOLDER) return t('currency.trailblazerName');
  const special = kind === 'role' ? currencySpecialName(id, t) : undefined;
  if (special !== undefined) return special;
  if (raw === '') return id;
  // 源站名字里可能带样式标签（实测 `银狼LV.<unbreak>999</unbreak>`）；
  // 这里统一压成纯文本，避免卡片/详情/搜索/右键快照各自处理漏掉。
  const plain = macroTextToPlain(raw).trim();
  return plain === '' ? id : plain;
}

/**
 * 特殊条目的跨语言别名（见 {@link SPECIAL_NAME_ALIASES}）。
 *
 * @param entry 条目
 * @param kind 图鉴种类
 */
export function currencyNameAliases(entry: CurrencyEntry, kind: CurrencyKind): readonly string[] {
  const out: string[] = [];
  const direct = SPECIAL_NAME_ALIASES[String(entry.id)];
  if (direct !== undefined) out.push(...direct);
  const raw = typeof entry.name === 'string' ? entry.name.trim() : '';
  if (raw === NICKNAME_PLACEHOLDER) out.push(...(SPECIAL_NAME_ALIASES[NICKNAME_PLACEHOLDER] ?? []));
  // 主角光环本身没有这些名字，但它「推荐」的角色有：让光环也能被「帕姆王」「开拓者」搜到。
  if (kind === 'spotlight') {
    for (const id of recommendIds(entry)) {
      const aliases = SPECIAL_NAME_ALIASES[id];
      if (aliases !== undefined) out.push(...aliases);
    }
  }
  return out;
}

/**
 * 条目的搜索匹配文本（显示名 + 原始名 + 跨语言别名）。
 *
 * 返回扁平对象是为了直接喂给 `matchesQuery`：它会把所有值一起做模糊匹配。
 *
 * @param entry 条目
 * @param kind 图鉴种类
 * @param t 翻译函数
 */
export function currencySearchNames(
  entry: CurrencyEntry,
  kind: CurrencyKind,
  t: TFunction,
): Record<string, string | undefined> {
  const names: Record<string, string | undefined> = {
    display: currencyDisplayName(entry, kind, t),
    raw: typeof entry.name === 'string' && entry.name.trim() !== '' ? entry.name : undefined,
  };
  currencyNameAliases(entry, kind).forEach((alias, index) => {
    names[`alias${index}`] = alias;
  });
  return names;
}

/**
 * 主角光环的「推荐角色」id 列表。
 *
 * 数据形状是数字数组；这里逐项验类型而不是直接 `as`，坏数据只会少几个头像。
 *
 * **必须保序去重**：源数据里确实存在重复推荐 id —— 实测四语言 `spotlight.json` 里
 * `100106` 的 `recommend` 把 `132102` 写了两次。不去重的话卡片用
 * `key={roleId}` 渲染 chips 会触发 React 的 duplicate key 告警，且同名角色会重复显示。
 * 只在前端兜，不动数据包（数据包是第三方产物，改了下次打包又会被覆盖）。
 *
 * @param entry 条目
 */
export function recommendIds(entry: CurrencyEntry): readonly string[] {
  const raw: unknown = entry.recommend;
  if (!Array.isArray(raw)) return [];
  const ids: string[] = [];
  for (const item of raw as readonly unknown[]) {
    if (typeof item === 'number' || typeof item === 'string') ids.push(String(item));
  }
  // Set 保留首次出现的顺序，与原站「推荐角色」的排列一致
  return [...new Set(ids)];
}

/* ------------------------------------------------------------------ */
/* 层（layer）                                                         */
/* ------------------------------------------------------------------ */

/**
 * 一档效果（`layer` 对象的键是激活人数 / 层级，值是该档的效果对象）。
 */
export interface CurrencyLayer {
  /** 档位（激活人数），已按数字升序 */
  readonly level: number;
  /** 该档的效果文案（宏字符串，空档已过滤） */
  readonly desc: string;
  /** 该档**自己的**参数表：`#1[i]` 取的是 `buff_param_list`，不是条目的 `param_list` */
  readonly params: readonly number[];
}

/** 任意值 → 普通对象（不是对象 / 是数组时返回 undefined），避免直接用 `as` 踩到 null */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

/**
 * 从一档效果对象里取富文本。
 *
 * 有的档位写 `buff_desc`（羁绊 / 光环都有），有的只写 `desc`（且常是 null），
 * 按「越具体越优先」的顺序取第一个非空值。
 */
function layerTextOf(source: Record<string, unknown> | undefined): string {
  if (source === undefined) return '';
  for (const key of ['buff_simple_desc', 'buff_desc', 'simple_desc', 'desc']) {
    const value = source[key];
    if (typeof value === 'string' && value.trim() !== '') return value;
  }
  return '';
}

/** 从一档效果对象里取参数表（`buff_param_list` 优先，其次 `param_list`，最后回退条目参数） */
function layerParamsOf(
  source: Record<string, unknown> | undefined,
  fallback: readonly number[],
): readonly number[] {
  if (source === undefined) return fallback;
  for (const key of ['buff_param_list', 'param_list']) {
    const value = source[key];
    if (Array.isArray(value) && (value as readonly unknown[]).every((item) => typeof item === 'number')) {
      return value as readonly number[];
    }
  }
  return fallback;
}

/**
 * 把条目对象形状的 `layer` 解析成**按档位升序**的数组。
 *
 * `layer` 是对象而不是数组，键是档位数字（`"2"`、`"4"`、`"6"`、`"10"`）。直接
 * `Object.values` 会让 `10` 排在 `2` 前面，所以必须按 `Number(键)` 排序。
 * 空文案的档位直接丢弃（数据里确实存在只有 `buff_name` 的空壳档）。
 *
 * @param entry 条目（羁绊图鉴的条目，或主角光环通过 `trait_id` 指向的羁绊条目）
 */
export function currencyLayers(entry: CurrencyEntry): readonly CurrencyLayer[] {
  const raw = asRecord(entry.layer);
  if (raw === undefined) return [];
  const fallback = currencyParams(entry);
  const layers: CurrencyLayer[] = [];
  for (const [level, value] of Object.entries(raw)) {
    const numeric = Number(level);
    if (!Number.isFinite(numeric)) continue;
    const source = asRecord(value);
    const desc = layerTextOf(source);
    if (desc === '') continue;
    layers.push({ level: numeric, desc, params: layerParamsOf(source, fallback) });
  }
  return layers.sort((left, right) => left.level - right.level);
}

/* ------------------------------------------------------------------ */
/* 更新日志                                                            */
/* ------------------------------------------------------------------ */

/** 更新日志里的一种字段变更 */
export interface DiffChange {
  readonly key: string;
  readonly section: string;
  readonly labelKey: string;
  readonly before?: string | null;
  readonly after?: string | null;
  readonly status: 'added' | 'removed' | 'changed';
  readonly contextOnly?: boolean;
}

/** 更新日志条目 */
export interface DiffItem {
  readonly id: string;
  readonly entity: 'character' | 'lightcone' | 'relic';
  readonly status: 'added' | 'removed' | 'changed';
  readonly name: string;
  readonly beforeName?: string;
  readonly afterName?: string;
  readonly icon?: string;
  readonly rarity?: number;
  readonly changes: readonly DiffChange[];
}

/** 更新日志差异包 */
export interface DiffBundle {
  readonly schemaVersion: number;
  readonly fromVersion: string;
  readonly toVersion: string;
  readonly locale: string;
  readonly generatedAt: string;
  readonly counts: { readonly character: number; readonly lightcone: number; readonly relic: number; readonly total: number };
  readonly items: readonly DiffItem[];
}

/** 读当前版本相对上一版的差异包 */
export async function getDiffBundle(lang: Lang): Promise<DiffBundle> {
  return dal.readJson<DiffBundle>(`db/${lang}/diff.json`);
}

/**
 * 原站的过滤规则：只保留「有非上下文变更」的条目，且 change 本身也过滤 contextOnly。
 * 照抄 `nodes/16.*.js` 里 `Q` 的语义，避免把纯格式刷新的条目列给用户。
 */
export function visibleDiffItems(bundle: DiffBundle): readonly DiffItem[] {
  const result: DiffItem[] = [];
  for (const item of bundle.items) {
    // 显式声明为 readonly DiffChange[]：.filter 返回的是可变数组，直接放进
    // 类型谓词 `item is DiffItem` 会因 changes 的 readonly/可变不兼容而报错（TS2677）。
    // 用普通循环构建，语义不变：丢掉 contextOnly 的变更，过滤后为空的整条丢弃。
    const changes: readonly DiffChange[] = (item.changes ?? []).filter(
      (change) => change.contextOnly !== true,
    );
    if (changes.length === 0) continue;
    result.push({ ...item, changes });
  }
  return result;
}
