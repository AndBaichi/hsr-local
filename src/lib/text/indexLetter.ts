/**
 * 资料库列表的「首字母索引」——排序 + 分组（PRD §4.9）
 *
 * 列表页原本按数据包原始顺序排列（角色按 id、物品按分片序号），找东西只能靠搜索。
 * 这里给六个图鉴加一层 A–Z 索引：**按标题首字的拼音首字母**分组，右侧同步出现字母条。
 *
 * ## 四语言各用各的字母表
 *
 * | 语言 | 分组依据 | 索引条 |
 * |---|---|---|
 * | zh | 汉字查 `pinyin-initials.generated.ts`，拉丁字母直接取大写 | A–Z + `#` |
 * | en | 标题首字母大写 | A–Z + `#` |
 * | ko | 谚文按 Unicode 初声（`(code - 0xAC00) / 588`） | 14 个基本辅音 + `#` |
 * | ja | **不分组**（见下） | 无 |
 *
 * 日文不做索引是刻意的：数据包里没有假名读音字段，637 个汉字首字无从取「五十音行」，
 * 硬做只会把 86% 的条目塞进「他」组，反而不如保持 collator 序。日文界面下依然
 * **按 `Intl.Collator('ja')` 排序**，只是不显示字母条、不插分组标题。
 *
 * ## 为什么「首字」不是标题的第一个字符
 *
 * 大量名称以《「【· 这类标点开头（如「「醉于盛会的此刻」」），取第一个字符会全落到 `#`。
 * 所以先跳过前导标点/符号/空白，取第一个**字母或数字**；数字开头（如「2 型…」）按约定
 * 归 `#`，而不是继续往后找。
 */

import type { Lang } from '@/i18n';

import { PINYIN_INITIAL_GROUPS } from './pinyin-initials.generated';

/** 无法归入字母表的标题落到该组（数字 / 符号开头、未收录汉字） */
export const FALLBACK_SYMBOL = '#';

/** 拉丁字母表 */
const LATIN_SYMBOLS: readonly string[] = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'];

/**
 * 韩文初声（19 个字母里的 14 个**基本**辅音）。
 *
 * 双辅音（ㄲ ㄸ ㅃ ㅆ ㅉ）并入对应的基本音——韩国 App 的索引条也是这么做的，
 * 否则字母条会多出 5 个几乎没人点的位置。
 */
const HANGUL_SYMBOLS: readonly string[] = ['ㄱ', 'ㄴ', 'ㄷ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅅ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];

/** 初声在 19 字母表中的下标 → 索引条上的符号 */
const HANGUL_CHO_TO_SYMBOL: readonly string[] = [
  'ㄱ', 'ㄱ', 'ㄴ', 'ㄷ', 'ㄷ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅂ', 'ㅅ', 'ㅅ', 'ㅇ', 'ㅈ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ',
];

/** 谚文音节范围 */
const HANGUL_RE = /[\uac00-\ud7af]/;

/** 拉丁字母 */
const LATIN_RE = /[A-Za-z]/;

/** 字母或数字（用来跳过前导标点） */
const WORD_RE = /[\p{L}\p{N}]/u;

/** 汉字 → 拼音首字母（大写），模块级只建一次 */
let pinyinMap: Map<string, string> | null = null;

/** 惰性构建汉字查找表 */
function getPinyinMap(): Map<string, string> {
  if (pinyinMap !== null) return pinyinMap;
  const map = new Map<string, string>();
  for (const [letter, chars] of Object.entries(PINYIN_INITIAL_GROUPS)) {
    for (const ch of chars) map.set(ch, letter);
  }
  pinyinMap = map;
  return map;
}

/**
 * 取标题里第一个有意义的字符。
 *
 * @param title 已本地化的标题
 * @returns 首个字母/数字；全是标点符号时返回 `null`
 */
export function firstMeaningfulChar(title: string): string | null {
  for (const ch of title) {
    if (WORD_RE.test(ch)) return ch;
  }
  return null;
}

/** 各语言的分组方式 */
type GroupScript = 'pinyin' | 'latin' | 'hangul' | 'none';

/** 语言 → 分组方式 */
const SCRIPT_OF: Readonly<Record<Lang, GroupScript>> = {
  zh: 'pinyin',
  en: 'latin',
  ja: 'none',
  ko: 'hangul',
};

/** 语言 → `Intl.Collator` 用的 locale（zh 显式指定拼音排序） */
const COLLATOR_LOCALE: Readonly<Record<Lang, string>> = {
  zh: 'zh-Hans-CN-u-co-pinyin',
  en: 'en',
  ja: 'ja',
  ko: 'ko',
};

/** 一套索引方案 */
export interface AlphabetIndex {
  /** 是否可用（`false` 时不显示字母条、不插分组标题，只按 collator 排序） */
  readonly enabled: boolean;
  /** 字母条上的符号（按显示顺序，`#` 在末尾） */
  readonly symbols: readonly string[];
  /** 标题 → 所属符号 */
  readonly groupOf: (title: string) => string;
}

/** 把一个字符映射为分组符号 */
function symbolOfChar(ch: string, script: GroupScript): string {
  if (script === 'pinyin') {
    const letter = getPinyinMap().get(ch);
    if (letter !== undefined) return letter;
    return LATIN_RE.test(ch) ? ch.toUpperCase() : FALLBACK_SYMBOL;
  }
  if (script === 'latin') {
    return LATIN_RE.test(ch) ? ch.toUpperCase() : FALLBACK_SYMBOL;
  }
  if (script === 'hangul') {
    const code = ch.codePointAt(0);
    if (!HANGUL_RE.test(ch) || code === undefined) return FALLBACK_SYMBOL;
    const cho = Math.floor((code - 0xac00) / 588);
    return HANGUL_CHO_TO_SYMBOL[cho] ?? FALLBACK_SYMBOL;
  }
  return FALLBACK_SYMBOL;
}

/** 索引方案缓存（按语言，四份常量） */
const INDEX_CACHE = new Map<Lang, AlphabetIndex>();

/** 取某语言的索引方案（同步、无副作用） */
export function alphabetIndexFor(lang: Lang): AlphabetIndex {
  const cached = INDEX_CACHE.get(lang);
  if (cached !== undefined) return cached;

  const script = SCRIPT_OF[lang];
  const enabled = script !== 'none';
  const symbols = enabled
    ? [...(script === 'hangul' ? HANGUL_SYMBOLS : LATIN_SYMBOLS), FALLBACK_SYMBOL]
    : [];

  const index: AlphabetIndex = {
    enabled,
    symbols,
    groupOf: (title: string): string => {
      if (!enabled) return FALLBACK_SYMBOL;
      const ch = firstMeaningfulChar(title);
      return ch === null ? FALLBACK_SYMBOL : symbolOfChar(ch, script);
    },
  };
  INDEX_CACHE.set(lang, index);
  return index;
}

/** `Intl.Collator` 缓存（构造一次约 1–3ms，列表每次重排都要用） */
const COLLATOR_CACHE = new Map<Lang, Intl.Collator>();

/** 取某语言的标题比较器 */
function collatorFor(lang: Lang): Intl.Collator {
  const cached = COLLATOR_CACHE.get(lang);
  if (cached !== undefined) return cached;
  const collator = new Intl.Collator(COLLATOR_LOCALE[lang], { numeric: true, sensitivity: 'variant' });
  COLLATOR_CACHE.set(lang, collator);
  return collator;
}

/** 带分组符号的排序项 */
interface Decorated<T> {
  /** 原条目 */
  readonly item: T;
  /** 分组符号 */
  readonly symbol: string;
  /** 标题（已本地化，比较用） */
  readonly title: string;
}

/** 带分组符号的排序结果 */
export interface SortedByIndex<T> {
  /** 已排序条目 */
  readonly sorted: readonly T[];
  /** 与 `sorted` 一一对应的分组符号（免去调用方再取一遍标题） */
  readonly symbols: readonly string[];
}

/**
 * 按「首字母 + 组内 collator」排序。
 *
 * 返回新数组，不改入参。相同符号内保持 collator 序；collator 判等时保留原顺序
 * （`Array.prototype.sort` 在 V8 上是稳定排序）。
 *
 * @param items 待排序条目
 * @param titleOf 取已本地化标题
 * @param index 索引方案（决定分组符号）
 * @param lang 语言（决定 collator）
 */
export function sortByIndex<T>(
  items: readonly T[],
  titleOf: (item: T) => string,
  index: AlphabetIndex,
  lang: Lang,
): SortedByIndex<T> {
  const collator = collatorFor(lang);
  const rank = new Map(index.symbols.map((symbol, position) => [symbol, position]));
  // 先算一次符号与标题（排序比较器会被调用 O(n log n) 次，不能每次都去解析标题）
  const decorated: Decorated<T>[] = items.map((item) => {
    const title = titleOf(item);
    return { item, title, symbol: index.groupOf(title) };
  });

  decorated.sort((a, b) => {
    const ra = rank.get(a.symbol) ?? index.symbols.length;
    const rb = rank.get(b.symbol) ?? index.symbols.length;
    if (ra !== rb) return ra - rb;
    return collator.compare(a.title, b.title);
  });

  return {
    sorted: decorated.map((entry) => entry.item),
    symbols: decorated.map((entry) => entry.symbol),
  };
}
