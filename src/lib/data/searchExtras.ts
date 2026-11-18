/**
 * 全局搜索的「非索引」数据源（更新日志 / 高难内容 / 货币战争）
 *
 * 六个基础资料库都在 `dal` 的启动索引里（同步可取）；这三类数据散在
 * `diff.json` / `maze*.json` / `currency/*.json`，只能异步读，所以在这一层聚合：
 *
 *  - **按语言缓存**：`dal.readJson` 自己有 LRU，但跨页面重进时再跑一遍 Promise 编排没必要；
 *  - **并发去重**：同一语言同一时刻只发一轮请求（快速切语言时不会打两遍）；
 *  - **失败不抛**：调用方拿不到就退回 `EMPTY_EXTRAS`，基础六库的搜索不受影响。
 *
 * 刻意不放进 `dal`：dal 的职责是「启动索引 + 详情读取」，这里是搜索页专用的派生视图。
 */

import type { Lang } from '@/i18n';
import {
  CURRENCY_KINDS,
  ENDGAME_MODES,
  currencyIconCandidates,
  getCurrencyEntries,
  getDiffBundle,
  getEndgameSeasons,
  visibleDiffItems,
  type CurrencyEntry,
  type CurrencyKind,
  type DiffItem,
  type EndgameMode,
  type EndgameSeason,
} from '@/lib/data/extra';

/** 聚合结果 */
export interface SearchExtras {
  /** 当前版本相对上一版的实体差异（已过滤 contextOnly） */
  readonly changelog: readonly DiffItem[];
  /** 四个终局子栏目今年的赛季列表 */
  readonly endgame: readonly {
    readonly mode: EndgameMode;
    readonly seasons: readonly EndgameSeason[];
  }[];
  /** 六个图鉴的全部条目（含解析后的 id） */
  readonly currency: readonly {
    readonly kind: CurrencyKind;
    readonly entries: readonly CurrencyEntry[];
  }[];
}

/** 空结果（加载中 / 失败时使用，调用方无需判空） */
export const EMPTY_EXTRAS: SearchExtras = { changelog: [], endgame: [], currency: [] };

/** 语言 → 结果 缓存 */
const cache = new Map<Lang, SearchExtras>();

/** 语言 → 进行中的请求（并发去重） */
const pending = new Map<Lang, Promise<SearchExtras>>();

/**
 * 加载（或取缓存）某个语言的搜索附加数据。
 *
 * @param lang 当前语言
 */
export function loadSearchExtras(lang: Lang): Promise<SearchExtras> {
  const cached = cache.get(lang);
  if (cached !== undefined) return Promise.resolve(cached);

  const running = pending.get(lang);
  if (running !== undefined) return running;

  const task = (async (): Promise<SearchExtras> => {
    const [bundle, endgameLists, currencyLists] = await Promise.all([
      getDiffBundle(lang),
      Promise.all(ENDGAME_MODES.map((mode) => getEndgameSeasons(mode.key))),
      Promise.all(CURRENCY_KINDS.map((kind) => getCurrencyEntries(kind.key, lang))),
    ]);

    return {
      changelog: visibleDiffItems(bundle),
      endgame: ENDGAME_MODES.map((mode, index) => ({
        mode: mode.key,
        seasons: endgameLists[index] ?? [],
      })),
      currency: CURRENCY_KINDS.map((kind, index) => ({
        kind: kind.key,
        entries: currencyLists[index] ?? [],
      })),
    };
  })();

  pending.set(lang, task);
  void task
    .then((value) => {
      cache.set(lang, value);
    })
    .catch(() => undefined)
    .finally(() => {
      pending.delete(lang);
    });

  return task;
}

/**
 * 图鉴条目在列表里的首图（候选路径取第一个，缺图时交给 SafeImage 兜底）。
 *
 * @param entry 图鉴条目
 * @param kind 图鉴种类
 */
export function currencyEntryIcon(entry: CurrencyEntry, kind: CurrencyKind): string | null {
  const [first] = currencyIconCandidates(entry, kind);
  return first ?? null;
}
