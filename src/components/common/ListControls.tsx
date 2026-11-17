/**
 * 列表页的筛选、排序与全量渲染（T04 / PRD §4.9、§4.10）
 *
 * 六个列表页共用，避免每个页面各写一遍受控输入与渲染逻辑。
 * 筛选只做**纯前端内存过滤**：索引在 boot 时已一次读入（合计 639 KiB），
 * 再走 IPC 反而更慢。
 *
 * ## 排序与字母条
 *
 * 传了 `titleOf` 就启用「按标题首字母排序 + 右侧字母条」（分组与排序规则见
 * `lib/text/indexLetter.ts`）。不传则保持数据包原始顺序，行为与旧版完全一致——
 * 搜索结果这类「按相关度排」的列表就不该被强行改成字典序。
 *
 * ## v2.8：不再分页
 *
 * 组件名叫 `PagedGrid` 是历史名称，**现在一次性渲染全部条目**，没有页的概念。
 * 去掉分页的理由与「不分页还能不能丝滑」的量测依据见
 * `docs/01-PRD.md` §4.10 与 `docs/02-architecture.md` §20，简述：
 *
 * - 分页把列表切成互不相连的块，翻页 / 跨页跳转会「换一屏内容」，这是用户
 *   说的「不够丝滑」的来源；
 * - 全量渲染后字母条点击只需一次 `scrollBy`（不再需要「先翻到目标页、等渲染、
 *   再滚到段头」的两段式），`Ctrl+F` 也能搜到全部条目；
 * - 1606 条（物品）全量铺开约 1.4 万个 DOM 节点，WebView2 实测布局 ~80–130ms
 *   （一次性），滚动本身没有 per-item JS，实测可接受；
 * - **刻意不用 `content-visibility`**：它对跳过渲染的元素用 `contain-intrinsic-size`
 *   估算高度，会让段头的 `getBoundingClientRect()` 返回「估算位置」（实测偏差最大
 *   可达整表长度的 30%+），字母条跳转会落到错误的位置。细节见 §4.10。
 *
 * 为了让「搜索框逐字输入」不被 1606 张卡的重渲染卡住，条目走 `useDeferredValue`
 * 降为可中断的低优先级更新：输入框即时响应，列表在浏览器空闲时追上来。
 */

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useLocation } from 'react-router-dom';

import { EntityGrid } from '@/components/common/EntityGrid';
import { IndexBar } from '@/components/common/IndexBar';
import { alphabetIndexFor, sortByIndex } from '@/lib/text/indexLetter';
import { useSettingsStore } from '@/stores/settings';

/**
 * 各列表的滚动位置（会话内记忆，不落盘）。
 *
 * key = `路由路径::条件指纹`。带上条件指纹是因为「搜过某某之后停在第 800px」
 * 不该套用到「没搜的时候」——两者是两种不同的浏览状态。
 *
 * 用模块级 Map 而不是 sessionStorage：这是纯粹的会话内体验优化，
 * 重启应用后从顶部开始反而符合直觉，也不必处理存储读写失败。
 */
const scrollPositions = new Map<string, number>();

/** 下拉筛选项 */
export interface FilterOption {
  /** 值（`all` 保留给「全部」） */
  readonly value: string;
  /** 已翻译的显示名 */
  readonly label: string;
}

/** 一组筛选 */
export interface FilterDef {
  /** 唯一键 */
  readonly key: string;
  /** 已翻译的组名 */
  readonly label: string;
  /** 可选项（调用方无需自己加「全部」，本组件会补） */
  readonly options: readonly FilterOption[];
}

/** 筛选栏属性 */
export interface FilterBarProps {
  /** 搜索词 */
  readonly query: string;
  /** 搜索词变化回调 */
  readonly onQueryChange: (value: string) => void;
  /** 筛选项定义 */
  readonly filters: readonly FilterDef[];
  /** 当前各筛选值 */
  readonly values: Readonly<Record<string, string>>;
  /** 筛选变化回调 */
  readonly onFilterChange: (key: string, value: string) => void;
  /** 结果总数 */
  readonly total: number;
  /** 全部条目数（用于显示「12 / 101」） */
  readonly allCount: number;
  /** 搜索框占位文案 */
  readonly searchPlaceholder?: string;
  /** 「全部」文案 */
  readonly allLabel: string;
  /** 计数模板，形如 `共 {{count}} 项` */
  readonly countLabel: string;
}

/** 筛选栏 */
export function FilterBar({
  query,
  onQueryChange,
  filters,
  values,
  onFilterChange,
  total,
  allCount,
  searchPlaceholder,
  allLabel,
  countLabel,
}: FilterBarProps): ReactNode {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={searchPlaceholder ?? ''}
          aria-label={searchPlaceholder ?? 'search'}
          className="h-9 min-w-[200px] flex-1 rounded-btn border border-line bg-elev px-3 text-sm text-ink outline-none placeholder:text-dim focus:border-accent"
        />
        {filters.map((filter) => (
          <label key={filter.key} className="flex items-center gap-1.5 text-xs text-dim">
            <span>{filter.label}</span>
            <select
              value={values[filter.key] ?? 'all'}
              onChange={(event) => onFilterChange(filter.key, event.target.value)}
              className="h-9 rounded-btn border border-line bg-elev px-2 text-sm text-ink outline-none focus:border-accent"
            >
              <option value="all">{allLabel}</option>
              {filter.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <div className="text-xs tabular-nums text-dim">
        {total === allCount ? countLabel : `${countLabel} · ${total}/${allCount}`}
      </div>
    </div>
  );
}

/**
 * 列表网格属性。
 *
 * ⚠️ 组件名与类型名沿用 `PagedGrid` / `PagedGridProps`（历史名称）：v2.8 起
 * **已不分页**，是为了让六个调用点保持零 diff 而保留命名，不代表还有「页」的概念。
 */
export interface PagedGridProps<T> {
  /** 已过滤的全部条目（会一次性全部渲染） */
  readonly items: readonly T[];
  /**
   * 条件指纹（搜索词 + 筛选值的拼接）。
   *
   * 只在**指纹变化**时把列表滚回顶部：从详情页返回时组件会重挂载，但指纹没变，
   * 此时不能滚顶，否则用户丢失原来的浏览位置。
   */
  readonly resetKey: string;
  /** 取唯一键 */
  readonly keyOf: (item: T) => string;
  /** 渲染单条 */
  readonly renderItem: (item: T) => ReactNode;
  /** 空结果文案 */
  readonly emptyLabel: string;
  /**
   * 取已本地化标题。提供则启用「按标题首字母排序 + 右侧字母指示条」。
   *
   * ⚠️ 必须用 `useCallback` 稳定引用，否则每次渲染都会重排整张表。
   */
  readonly titleOf?: (item: T) => string;
}

/** 一段（同一首字母） */
interface GroupSlice<T> {
  /** 分组符号；未启用索引时为空串 */
  readonly symbol: string;
  /** 该段条目（构建期可变，构建完成后只读） */
  readonly items: T[];
}

/** 滚动高亮的判定容差（px）：段头顶到容器顶部再往下 8px 内算「已进入该段」 */
const HEADER_HIT_OFFSET = 8;

/** 全量列表网格（历史名称 `PagedGrid`，v2.8 起不分页） */
export function PagedGrid<T>({
  items,
  resetKey,
  keyOf,
  renderItem,
  emptyLabel,
  titleOf,
}: PagedGridProps<T>): ReactNode {
  const lang = useSettingsStore((state) => state.prefs.lang);
  const index = useMemo(() => alphabetIndexFor(lang), [lang]);

  /*
   * 全量渲染后，搜索框每敲一个字都要重排 + 重铺最多 1606 张卡（约 1.4 万节点）。
   * 用 deferred 值把这次更新降为**可中断的低优先级更新**：输入框永远即时响应，
   * 列表在浏览器空闲时追上来；用户连续输入时中间态会被丢弃，只提交最后那一次。
   * 空态判断仍用即时的 `items`，避免「明明搜不到却还显示旧列表」。
   */
  const deferredItems = useDeferredValue(items);

  // 未传 titleOf 时不做任何排序（搜索结果的「相关度序」不能被字典序顶掉）
  const ordered = useMemo(() => {
    if (titleOf === undefined) {
      return { sorted: deferredItems, symbols: deferredItems.map(() => '') };
    }
    return sortByIndex(deferredItems, titleOf, index, lang);
  }, [deferredItems, titleOf, index, lang]);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const [activeSymbol, setActiveSymbol] = useState<string | null>(null);

  const location = useLocation();
  const positionKey = `${location.pathname}::${resetKey}`;
  const positionKeyRef = useRef(positionKey);
  positionKeyRef.current = positionKey;

  /** 把全量有序条目按符号切段（相邻同符号合并成一段，段数 = 实际出现的字母数） */
  const groups = useMemo<readonly GroupSlice<T>[]>(() => {
    if (!index.enabled) return [{ symbol: '', items: [...ordered.sorted] }];
    const result: GroupSlice<T>[] = [];
    for (let offset = 0; offset < ordered.sorted.length; offset += 1) {
      const symbol = ordered.symbols[offset] ?? '';
      const last = result[result.length - 1];
      if (last !== undefined && last.symbol === symbol) {
        last.items.push(ordered.sorted[offset]);
      } else {
        result.push({ symbol, items: [ordered.sorted[offset]] });
      }
    }
    return result;
  }, [ordered, index]);

  /** 有条目的符号，用于字母条的可用态 */
  const available = useMemo(() => new Set(groups.map((group) => group.symbol)), [groups]);

  /** 列表滚动容器（AppShell 的 `<main>`） */
  const scrollerOf = useCallback((): HTMLElement | null => {
    const scroller = rootRef.current?.closest('main');
    return scroller instanceof HTMLElement ? scroller : null;
  }, []);

  /** 把列表顶部对齐到容器顶部（条件变化后调用） */
  const scrollToEdge = useCallback((): void => {
    const scroller = scrollerOf();
    const root = rootRef.current;
    if (scroller === null || root === null) return;
    const delta = root.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    scroller.scrollBy({ top: delta - 4, behavior: 'smooth' });
  }, [scrollerOf]);

  /**
   * 从详情页返回时恢复滚动位置；离开列表时记下来。
   *
   * 两个实现细节都是坑：
   * 1. 必须用 `useLayoutEffect` 而不是 `useEffect` —— passive effect 的清理函数
   *    在 DOM 移除**之后**才跑，那时 `<main>` 的内容已经被掏空，浏览器会把
   *    `scrollTop` 钳成 0，存下来的永远是 0。layout effect 的清理在 DOM 移除前
   *    同步执行，读到的是真实位置。
   * 2. 恢复用直接赋值 `scrollTop`，不用 `scrollBy({behavior:'smooth'})`：
   *    返回列表不该有一段「从顶部滑回去」的动画，那是倒退而不是恢复。
   *
   * 只在挂载时恢复一次；搜索 / 改筛选不走这里，由下面的 `resetKey` 逻辑滚回顶部。
   */
  useLayoutEffect(() => {
    const scroller = scrollerOf();
    if (scroller === null) return undefined;
    const saved = scrollPositions.get(positionKeyRef.current);
    // 存过就恢复，包括 0：离开时在顶部、详情页里滚过，回来也应该回到顶部。
    // 只有「这个列表从没存过位置」才不动，让 `<main>` 保持既有行为。
    if (saved !== undefined) scroller.scrollTop = saved;
    return () => {
      scrollPositions.set(positionKeyRef.current, scroller.scrollTop);
    };
  }, [scrollerOf]);

  /**
   * 上一次的条件指纹。
   *
   * 用来区分「**条件变了**」与「组件重新挂载」：从详情页返回列表时组件会重挂载，
   * 但条件没变——此时**不能**滚回顶部，否则用户丢失原来的浏览位置（这是 v1.9
   * 「切页面不重置筛选」体验的一部分）。
   */
  const prevResetKeyRef = useRef(resetKey);

  useEffect(() => {
    if (prevResetKeyRef.current === resetKey) return;
    prevResetKeyRef.current = resetKey;
    // 换了搜索词 / 筛选条件后条数可能骤减，不回到顶部会停在空白处
    scrollToEdge();
  }, [resetKey, scrollToEdge]);

  /**
   * 滚动位置高亮当前分组标题。
   *
   * 字母条只做展示，不需要点击/拖动跳转，所以这里只保留「算 activeSymbol」这一半。
   */
  // 跟随滚动高亮当前分组标题
  useEffect(() => {
    if (!index.enabled) return undefined;
    const scroller = scrollerOf();
    if (scroller === null) return undefined;
    let frame = 0;
    const compute = (): void => {
      frame = 0;
      const headers = rootRef.current?.querySelectorAll<HTMLElement>('[data-symbol]');
      if (headers === undefined || headers.length === 0) {
        setActiveSymbol(null);
        return;
      }
      const threshold = scroller.getBoundingClientRect().top + HEADER_HIT_OFFSET;
      let current: string | null = null;
      for (const header of headers) {
        if (header.getBoundingClientRect().top <= threshold) current = header.dataset.symbol ?? current;
        else break;
      }
      // 还没滚过第一个标题时，高亮第一个
      setActiveSymbol(current ?? headers[0].dataset.symbol ?? null);
    };
    const schedule = (): void => {
      if (frame !== 0) return;
      frame = requestAnimationFrame(compute);
    };
    // 首次挂载时布局可能还在补齐（图片解码、字体替换），补一帧再算一次
    const settle = requestAnimationFrame(() => requestAnimationFrame(compute));
    compute();
    scroller.addEventListener('scroll', schedule, { passive: true });
    // 窗口尺寸变化会改变折行数量，段头位置整体位移，但不会触发 scroll
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(settle);
      scroller.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [index, scrollerOf, ordered]);

  if (items.length === 0) {
    return <div className="hsr-panel rounded-card border border-line p-8 text-center text-sm text-dim">{emptyLabel}</div>;
  }

  return (
    <div ref={rootRef} className="flex flex-col gap-4">
      {groups.map((group) => (
        <section key={group.symbol === '' ? '__all__' : group.symbol} className="flex flex-col gap-3">
          {group.symbol === '' ? null : (
            <h3
              data-symbol={group.symbol}
              className="sticky top-0 z-10 -mx-1 flex items-center gap-2 bg-base/90 px-1 py-1 text-sm font-semibold text-accent backdrop-blur-sm"
            >
              <span>{group.symbol}</span>
              <span className="text-[11px] font-normal tabular-nums text-dim">{group.items.length}</span>
              <span className="h-px flex-1 bg-line" />
            </h3>
          )}
          <EntityGrid>
            {group.items.map((item) => (
              <div key={keyOf(item)}>{renderItem(item)}</div>
            ))}
          </EntityGrid>
        </section>
      ))}

      {index.enabled ? (
        <IndexBar symbols={index.symbols} available={available} active={activeSymbol} />
      ) : null}
    </div>
  );
}
