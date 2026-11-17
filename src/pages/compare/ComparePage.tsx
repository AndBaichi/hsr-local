/**
 * 全资料库对比页（PRD §4.2 页面 14，v2.9 重写）
 *
 * v2.9 起对比不再局限于角色：选中列表是 `prefs.compareIds` 里的 `{module}:{id}`
 * 复合键（唯一真相源，一切变更走 `setCompareIds`），六模块任意混合、上限 10 个。
 * 混合对比的行是「通用行为主」：类型/稀有度/ID 各模块都有，命途/属性/实装时间
 * 只在拥有的模块显示，其余落 `compare.noStats`。
 *
 * 布局（v2.9 用户确认）：对比表在上（打开页面先看结果），添加选择器在下。
 * 索引里查不到的键（实体随数据包升级被移除）不自动改写 prefs，
 * 只以占位列呈现，避免白屏或数据丢失。
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Link } from 'react-router-dom';

import { RarityStars } from '@/components/common/EntityGrid';
import { MacroText } from '@/components/common/MacroText';
import { RichTextView } from '@/components/common/RichTextView';
import { SafeImage } from '@/components/common/SafeImage';
import { currencyBadges } from '@/components/currency/badges';
import { PageHeader } from '@/components/layout/PageHeader';
import { matchesQuery } from '@/hooks/useListState';
import { dal } from '@/lib/data/dal';
import {
  CURRENCY_KINDS,
  currencyDisplayName,
  currencyIconCandidates,
  currencyLayers,
  currencyParams,
  currencyTags,
  getCurrencyEntries,
  recommendIds,
  roleSeasonOf,
  type CurrencyEntry,
  type CurrencyKind,
} from '@/lib/data/extra';
import { getRoleDetail, type RoleDetailData } from '@/lib/data/roleDetail';
import type {
  AchievementSeriesDetail,
  CharacterDetail,
  ItemDetail,
  LightconeDetail,
  LocalizedNames,
  ModuleKey,
  RelicSetDetail,
} from '@/lib/data/types';
import { detailRouteOf, MODULE_LABEL_KEYS } from '@/lib/entities';
import { skillTagLabel } from '@/i18n/enums';
import { elementIconPath, formatDate, pathIconPath } from '@/lib/format';
import { elementName, itemTypeName, monsterRankName, pathName } from '@/lib/labels';
import { paramListAtLevel } from '@/lib/text/richtext';
import { parseEntityKey, pickName, CURRENCY_MODULE_KIND } from '@/lib/userdata/types';
import { MODULE_KEYS } from '@/lib/userdata/types';
import type { Lang } from '@/i18n';
import { COMPARE_LIMIT, useSettingsStore } from '@/stores/settings';

/**
 * 对比列的展示就绪数据。
 *
 * `found=false` 表示索引里查不到（实体随数据包移除或脏键），
 * 此时只有 key/id 可用于占位展示。
 */
interface CompareColumn {
  readonly key: string;
  readonly module: ModuleKey | null;
  readonly id: string;
  readonly found: boolean;
  readonly name: string;
  readonly icon: string | null;
  readonly rarity: number | null;
  readonly detailPath: string | null;
  /** 命途（角色/光锥） */
  readonly path: string | null;
  /** 属性（角色）/ 弱点（敌人），图标+文案逐个渲染 */
  readonly elements: readonly string[];
  /** 实装时间（角色，Unix 秒） */
  readonly release: number | null;
  /** 秘技点/终结技能量（角色，详情加载后可得） */
  readonly spNeed: number | null;
  /** 主类别（物品） */
  readonly mainType: string | null;
  /** 子类别（物品） */
  readonly subType: string | null;
  /** 堆叠上限（物品，详情加载后可得） */
  readonly pileLimit: number | null;
  /** 种类（遗器 cavern/planar） */
  readonly kind: string | null;
  /** 部件数（遗器） */
  readonly partCount: number | null;
  /** 强度档位（敌人） */
  readonly rank: string | null;
  /** 阵营（敌人） */
  readonly camp: string | null;
  /** 货币战争条目完整对象（`currency*` 模块才有，供字段渲染） */
  readonly currencyEntry?: CurrencyEntry;
  /** 货币战争图鉴种类（`currency*` 模块才有） */
  readonly currencyKind?: CurrencyKind;
}

/** 详情对象的判别联合（`kind` 用于收窄类型，缓存里混存各模块详情） */
type EntityDetail =
  | (CharacterDetail & { readonly kind: 'character' })
  | (LightconeDetail & { readonly kind: 'lightcone' })
  | (RelicSetDetail & { readonly kind: 'relicset' })
  | (ItemDetail & { readonly kind: 'item' })
  | (AchievementSeriesDetail & { readonly kind: 'achievementSeries' })
  | (RoleDetailData & { readonly kind: 'currencyRole' })
  | (CurrencyEntry & { readonly kind: 'currency' });

/** 给详情对象打上 kind 标记，方便缓存里判别 */
function tagDetail(kind: EntityDetail['kind'], detail: unknown): EntityDetail {
  return { ...(detail as object), kind } as EntityDetail;
}

/** 货币战争图鉴条目缓存（module → 条目数组，异步填充） */
type CurrencyCache = Readonly<Record<string, readonly CurrencyEntry[]>>;

/** 空货币缓存（加载中/失败时使用） */
const EMPTY_CURRENCY: CurrencyCache = {};

/** 从货币缓存里按 module + id 找条目 */
function findCurrencyEntry(
  currency: CurrencyCache,
  module: ModuleKey,
  id: string,
): CurrencyEntry | undefined {
  const list = currency[module];
  if (list === undefined) return undefined;
  return list.find((entry) => String(entry.id) === id);
}

/** 一个「字段」键值对项：标签 + 已渲染的值节点 */
interface FieldRow {
  readonly label: string;
  readonly value: ReactNode;
}

/** 字段值是否「存在且非空」（空串 / 空数组 / 空对象 / null 都不展示） */
function isNonEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as object).length > 0;
  return true;
}

/** 是否是「按 key 展开的对象」（数组与 null 都不算） */
function isRecordValue(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** 结构化字段项里取富文本：越具体越优先（与图鉴详情面板的口径一致） */
const STRUCTURED_TEXT_KEYS = ['buff_desc', 'desc', 'simple_desc', 'buff_simple_desc'] as const;

function structuredTextOf(source: Readonly<Record<string, unknown>>): string {
  for (const key of STRUCTURED_TEXT_KEYS) {
    const value = source[key];
    if (typeof value === 'string' && value.trim() !== '') return value;
  }
  return '';
}

/** 结构化字段项里取参数表：`buff_param_list` 优先，其次 `param_list`，最后回退条目参数 */
function structuredParamsOf(
  source: Readonly<Record<string, unknown>>,
  fallback: readonly number[],
): readonly number[] {
  for (const key of ['buff_param_list', 'param_list'] as const) {
    const value = source[key];
    if (Array.isArray(value) && value.every((item) => typeof item === 'number')) {
      return value as readonly number[];
    }
  }
  return fallback;
}

/**
 * 渲染货币战争的「结构化字段」（`remark` / `effect_list` / `sub_trait` 这类对象或数组）。
 *
 * 图鉴数据里这些字段是「一档一层对象」：remark 的键是条件序号、sub_trait 的键是子羁绊 id、
 * 每档自带 `desc` 与**自己的** `param_list`。对比页的列很窄，直接 `JSON.stringify`
 * 会糊成一坨技术详情；这里按「标题 + 宏字符串」逐档铺开，参数各用各的。
 *
 * 认不出的形状返回 `null`（调用方据此不渲染该字段），绝不把对象塞进 React 子节点。
 */
function renderStructuredValue(value: unknown, fallbackParams: readonly number[]): ReactNode {
  if (typeof value === 'string') {
    return <MacroText value={value} paramList={fallbackParams} className="text-sm" />;
  }
  if (typeof value === 'number') return <span className="text-ink">{String(value)}</span>;
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    if (value.every((item) => typeof item === 'string')) {
      return <span className="text-ink">{(value as readonly string[]).join('、')}</span>;
    }
    return (
      <div className="flex flex-col gap-1.5">
        {value.map((item, index) => {
          const rendered = renderStructuredValue(item, fallbackParams);
          return rendered === null ? null : <div key={index}>{rendered}</div>;
        })}
      </div>
    );
  }
  if (!isRecordValue(value)) return null;

  // 顶层对象**自己**就是一条结构化字段（主角光环的 remark 就是 `{desc, param_list}`，
  // 不是「一档一条」的映射）——直接按一项渲染，别再拿它的键当条目摊开。
  const ownText = structuredTextOf(value);
  if (ownText !== '') {
    const ownParams = structuredParamsOf(value, fallbackParams);
    const ownName = typeof value.name === 'string' ? value.name : '';
    return (
      <div className="rounded-btn border border-line bg-elev p-2 text-left">
        {ownName !== '' ? <div className="mb-1 text-[11px] font-semibold text-accent">{ownName}</div> : null}
        <MacroText value={ownText} paramList={ownParams} className="text-xs text-dim" />
      </div>
    );
  }

  const blocks = Object.entries(value).map(([key, item]) => {
    const source = isRecordValue(item) ? item : undefined;
    const text = source !== undefined ? structuredTextOf(source) : '';
    if (text === '') {
      // 简单键值只有标量才展示，复合值一律跳过
      if (typeof item === 'string' && item.trim() !== '') {
        return (
          <div key={key} className="text-xs text-ink">
            <MacroText value={item} paramList={fallbackParams} className="text-xs" />
          </div>
        );
      }
      if (typeof item === 'number') {
        return (
          <div key={key} className="text-xs text-ink">
            {item}
          </div>
        );
      }
      return null;
    }
    const params = source !== undefined ? structuredParamsOf(source, fallbackParams) : fallbackParams;
    const name = source !== undefined && typeof source.name === 'string' ? source.name : '';
    return (
      <div key={key} className="rounded-btn border border-line bg-elev p-2 text-left">
        {name !== '' ? <div className="mb-1 text-[11px] font-semibold text-accent">{name}</div> : null}
        <MacroText value={text} paramList={params} className="text-xs text-dim" />
      </div>
    );
  });
  const visible = blocks.filter((node) => node !== null);
  if (visible.length === 0) return null;
  return <div className="flex flex-col gap-1.5">{visible}</div>;
}

/** 一个「未找到」占位列的通用字段集（`found` 由各分支显式给出，避免 spread 覆盖告警） */
const NOT_FOUND_FIELDS = {
  rarity: null,
  path: null,
  elements: [],
  release: null,
  spNeed: null,
  mainType: null,
  subType: null,
  pileLimit: null,
  kind: null,
  partCount: null,
  rank: null,
  camp: null,
} as const;

/** 解析一个复合键为展示就绪的对比列（brief 能拿到的字段同步填，详情字段后续异步补全） */
function resolveColumn(
  key: string,
  lang: Lang,
  t: TFunction,
  currency: CurrencyCache,
): CompareColumn {
  const parsed = parseEntityKey(key);
  if (parsed === undefined) {
    return {
      key,
      module: null,
      id: key,
      found: false,
      name: `#${key}`,
      icon: null,
      ...NOT_FOUND_FIELDS,
      detailPath: null,
    };
  }
  const { module, id } = parsed;
  const base = {
    key,
    module,
    id,
    detailPath: detailRouteOf(module, id),
  };
  const notFound = (): CompareColumn => ({ ...base, found: false, name: `#${id}`, icon: null, ...NOT_FOUND_FIELDS });

  switch (module) {
    case 'character': {
      const brief = dal.getIndex('character').find((entry) => entry.id === id);
      if (!brief) return notFound();
      return {
        ...base,
        ...NOT_FOUND_FIELDS,
        found: true,
        name: pickName(brief.names, lang, id),
        icon: brief.icon,
        rarity: brief.rarity,
        path: brief.path || null,
        elements: brief.element ? [brief.element] : [],
        release: brief.release ?? null,
      };
    }
    case 'lightcone': {
      const brief = dal.getIndex('lightcone').find((entry) => entry.id === id);
      if (!brief) return notFound();
      return {
        ...base,
        ...NOT_FOUND_FIELDS,
        found: true,
        name: pickName(brief.names, lang, id),
        icon: brief.icon,
        rarity: brief.rarity,
        path: brief.path || null,
      };
    }
    case 'relicset': {
      const brief = dal.getIndex('relicset').find((entry) => entry.id === id);
      if (!brief) return notFound();
      return {
        ...base,
        ...NOT_FOUND_FIELDS,
        found: true,
        name: pickName(brief.names, lang, id),
        icon: brief.icon,
        kind: brief.kind,
        partCount: brief.partCount,
      };
    }
    case 'monster': {
      const brief = dal.getIndex('monster').find((entry) => entry.groupKey === id);
      if (!brief) return notFound();
      return {
        ...base,
        ...NOT_FOUND_FIELDS,
        found: true,
        name: pickName(brief.names, lang, id),
        icon: brief.icon,
        elements: brief.weak,
        rank: brief.rank,
        camp: brief.camp,
      };
    }
    case 'item': {
      const brief = dal.getIndex('item').find((entry) => entry.id === id);
      if (!brief) return notFound();
      return {
        ...base,
        ...NOT_FOUND_FIELDS,
        found: true,
        name: pickName(brief.names, lang, id),
        icon: brief.icon,
        rarity: brief.rarity,
        mainType: brief.mainType,
        subType: brief.subType !== brief.mainType ? brief.subType : null,
      };
    }
    case 'achievementSeries': {
      const brief = dal.getIndex('achievementSeries').find((entry) => entry.id === id);
      if (!brief) return notFound();
      return {
        ...base,
        ...NOT_FOUND_FIELDS,
        found: true,
        name: brief.name,
        icon: null,
      };
    }
    case 'currencyRole':
    case 'currencyItem':
    case 'currencyBuff':
    case 'currencyAugment':
    case 'currencySpotlight':
    case 'currencyTrait': {
      const kind = CURRENCY_MODULE_KIND[module];
      const entry = findCurrencyEntry(currency, module, id);
      // 缓存未加载完：found=false，占位列呈现（加载完成后 useMemo 重算自动补全）
      if (entry === undefined || kind === undefined) return notFound();
      const candidates = currencyIconCandidates(entry, kind as CurrencyKind);
      return {
        ...base,
        ...NOT_FOUND_FIELDS,
        found: true,
        name: currencyDisplayName(entry, kind as CurrencyKind, t),
        icon: candidates[0] ?? null,
        rarity: typeof entry.rarity === 'number' ? entry.rarity : null,
        currencyEntry: entry,
        currencyKind: kind as CurrencyKind,
      };
    }
  }
}

/** 选择器条目的统一形状（六模块索引 → 名称/图标/稀有度） */
interface PickerEntry {
  readonly id: string;
  readonly names: LocalizedNames;
  readonly icon: string | null;
  readonly rarity: number | null;
}

/** 取某个模块的选择器候选列表（currency 模块从缓存取，未加载完返回空） */
function pickerEntries(
  module: ModuleKey,
  t: TFunction,
  currency: CurrencyCache,
): readonly PickerEntry[] {
  switch (module) {
    case 'character':
      return dal.getIndex('character').map((brief) => ({
        id: brief.id,
        names: brief.names,
        icon: brief.icon,
        rarity: brief.rarity,
      }));
    case 'lightcone':
      return dal.getIndex('lightcone').map((brief) => ({
        id: brief.id,
        names: brief.names,
        icon: brief.icon,
        rarity: brief.rarity,
      }));
    case 'relicset':
      return dal.getIndex('relicset').map((brief) => ({
        id: brief.id,
        names: brief.names,
        icon: brief.icon,
        rarity: null,
      }));
    case 'monster':
      return dal.getIndex('monster').map((brief) => ({
        id: brief.groupKey,
        names: brief.names,
        icon: brief.icon,
        rarity: null,
      }));
    case 'item':
      return dal.getIndex('item').map((brief) => ({
        id: brief.id,
        names: brief.names,
        icon: brief.icon,
        rarity: brief.rarity,
      }));
    case 'achievementSeries':
      return dal.getIndex('achievementSeries').map((brief) => ({
        id: brief.id,
        names: { zh: brief.name, en: brief.name, ja: brief.name, ko: brief.name },
        icon: null,
        rarity: null,
      }));
    case 'currencyRole':
    case 'currencyItem':
    case 'currencyBuff':
    case 'currencyAugment':
    case 'currencySpotlight':
    case 'currencyTrait': {
      const kind = CURRENCY_MODULE_KIND[module];
      const list = currency[module] ?? [];
      if (kind === undefined) return [];
      return list.map((entry) => {
        const id = String(entry.id);
        const display = currencyDisplayName(entry, kind as CurrencyKind, t);
        const candidates = currencyIconCandidates(entry, kind as CurrencyKind);
        // 名称快照用当前语言单名填四语言位（与 achievementSeries 一致）
        return {
          id,
          names: { zh: display, en: display, ja: display, ko: display },
          icon: candidates[0] ?? null,
          rarity: typeof entry.rarity === 'number' ? entry.rarity : null,
        };
      });
    }
  }
}

/** 选择器结果列表的上限（避免一次铺出整个物品索引） */
const PICKER_RESULT_LIMIT = 40;

export default function ComparePage(): ReactNode {
  const { t } = useTranslation();
  const lang = useSettingsStore((state) => state.prefs.lang);
  const keys = useSettingsStore((state) => state.prefs.compareIds);
  const setCompareIds = useSettingsStore((state) => state.setCompareIds);
  const [query, setQuery] = useState('');
  const [pickerModule, setPickerModule] = useState<ModuleKey>('character');
  // 货币战争图鉴条目缓存：异步加载，module → 条目数组
  const [currency, setCurrency] = useState<CurrencyCache>(EMPTY_CURRENCY);

  // 按语言加载六个货币图鉴（与 SearchPage 的 loadSearchExtras 同源，但这里只取货币部分）。
  // 加载失败退回空缓存：货币列显示为占位，不阻塞其它模块对比。
  useEffect(() => {
    let cancelled = false;
    setCurrency(EMPTY_CURRENCY);
    void Promise.all(
      CURRENCY_KINDS.map((kind) =>
        getCurrencyEntries(kind.key, lang).catch(() => [] as readonly CurrencyEntry[]),
      ),
    ).then((lists) => {
      if (cancelled) return;
      const next: Record<string, readonly CurrencyEntry[]> = {};
      CURRENCY_KINDS.forEach((kind, index) => {
        next[kind.navKey] = lists[index] ?? [];
      });
      setCurrency(next);
    });
    return () => {
      cancelled = true;
    };
  }, [lang]);

  // dal 索引在语言切换后整体换引用，columns 随 lang 重算即可拿到新名称
  const skeleton = useMemo<readonly CompareColumn[]>(
    () => keys.map((key) => resolveColumn(key, lang, t, currency)),
    [keys, lang, t, currency],
  );

  // 详情缓存：完整加载每个被对比实体的详情对象，既供基本信息字段（SP / 堆叠上限）
  // 补全，也供「详情内容」区块（技能 / 叠影 / 套装效果 / 成就条目）渲染。
  // 加载失败静默（对应列只缺详情字段，不阻塞其它模块对比）。
  const [detailCache, setDetailCache] = useState<Readonly<Record<string, EntityDetail>>>({});

  useEffect(() => {
    let cancelled = false;
    // 不清空旧缓存：详情内容与语言无关地可复用，清空反而在语言切换时闪一下。
    const jobs: Promise<void>[] = [];
    for (const col of skeleton) {
      if (!col.found) continue;
      const key = col.key;
      if (col.module === 'character') {
        jobs.push(
          dal.getCharacter(col.id).then((d) => { if (!cancelled) setDetailCache((p) => ({ ...p, [key]: tagDetail('character', d) })); }).catch(() => undefined),
        );
      } else if (col.module === 'lightcone') {
        jobs.push(
          dal.getLightcone(col.id).then((d) => { if (!cancelled) setDetailCache((p) => ({ ...p, [key]: tagDetail('lightcone', d) })); }).catch(() => undefined),
        );
      } else if (col.module === 'relicset') {
        jobs.push(
          dal.getRelicSet(col.id).then((d) => { if (!cancelled) setDetailCache((p) => ({ ...p, [key]: tagDetail('relicset', d) })); }).catch(() => undefined),
        );
      } else if (col.module === 'item') {
        jobs.push(
          dal.getItem(col.id).then((d) => { if (!cancelled) setDetailCache((p) => ({ ...p, [key]: tagDetail('item', d) })); }).catch(() => undefined),
        );
      } else if (col.module === 'achievementSeries') {
        jobs.push(
          dal.getAchievements().then((series) => {
            if (cancelled) return;
            const found = series.find((s) => s.id === col.id);
            if (found) setDetailCache((p) => ({ ...p, [key]: tagDetail('achievementSeries', found) }));
          }).catch(() => undefined),
        );
      } else if (col.module === 'currencyRole') {
        // 角色图鉴有独立的二级界面详情（技能 / 星魂 / 属性三档），
        // 这是它「原来就有的内容」，必须异步加载，否则对比卡会一直停在「加载详情」。
        // 详情文件缺失（数据包旧）时塞一个空哨兵，让渲染层落「暂无数据」而非永久加载。
        jobs.push(
          getRoleDetail(col.id, lang)
            .then((d) => {
              if (cancelled) return;
              const detail: RoleDetailData =
                d ??
                { id: col.id, name: '', rarity: 0, frontBackType: '', healOrShield: '', stars: [], eidolons: [], lightcones: [], traitIds: [] };
              setDetailCache((p) => ({ ...p, [key]: tagDetail('currencyRole', detail) }));
            })
            .catch(() => {
              if (cancelled) return;
              const detail: RoleDetailData = { id: col.id, name: '', rarity: 0, frontBackType: '', healOrShield: '', stars: [], eidolons: [], lightcones: [], traitIds: [] };
              setDetailCache((p) => ({ ...p, [key]: tagDetail('currencyRole', detail) }));
            }),
        );
      } else if (col.currencyEntry !== undefined && col.currencyKind !== undefined) {
        // 其它五个货币图鉴没有独立详情文件，条目本身就是全部内容（图鉴卡片显示啥就是啥）。
        // 直接复用已加载的 currency 缓存条目，无需再发一次异步请求。
        setDetailCache((p) => ({ ...p, [key]: tagDetail('currency', col.currencyEntry as CurrencyEntry) }));
      }
    }
    void Promise.all(jobs);
    return () => {
      cancelled = true;
    };
  }, [skeleton, lang]);

  const columns = useMemo<readonly CompareColumn[]>(
    () =>
      skeleton.map((col) => {
        const detail = detailCache[col.key];
        if (detail === undefined) return col;
        const spNeed = detail.kind === 'character' && typeof detail.spNeed === 'number' ? detail.spNeed : col.spNeed;
        const pileLimit = detail.kind === 'item' && typeof detail.pileLimit === 'number' ? detail.pileLimit : col.pileLimit;
        return { ...col, spNeed, pileLimit };
      }),
    [skeleton, detailCache],
  );

  const results = useMemo(() => {
    const needle = query.trim();
    const selected = new Set(keys);
    return pickerEntries(pickerModule, t, currency)
      .filter((entry) => !selected.has(`${pickerModule}:${entry.id}`) && matchesQuery(needle, entry.names, entry.id))
      .slice(0, PICKER_RESULT_LIMIT);
  }, [pickerModule, query, keys, t, currency]);

  const atLimit = keys.length >= COMPARE_LIMIT;

  // 对比卡片区：卡片多时列宽有下限，超出就在这个容器里左右滚。
  // 容器自己限高，横向滚动条始终停在可视区底部 —— 不用先滚到页面最下面才够得着。
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const syncScrollState = useCallback((): void => {
    const el = scrollRef.current;
    if (el === null) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    syncScrollState();
    const el = scrollRef.current;
    if (el === null) return;
    const observer = new ResizeObserver(syncScrollState);
    observer.observe(el);
    return () => observer.disconnect();
  }, [syncScrollState, columns.length]);

  /** 左右翻一屏（约 80% 可视宽度，至少一张卡的宽度） */
  const scrollCards = (direction: -1 | 1): void => {
    const el = scrollRef.current;
    if (el === null) return;
    el.scrollBy({
      left: direction * Math.max(320, Math.round(el.clientWidth * 0.8)),
      behavior: 'smooth',
    });
  };

  // 只有横向真的放不下时才把卡片区限高：这时横向滚动条必须在可视区内，
  // 否则用户得先滚到页面底部才够得着它；卡片少时保持整页自然滚动。
  const horizontalScrollable = canScrollLeft || canScrollRight;

  // 用 getState() 读当前值，避免快速连点时闭包里的 keys 过期；单一真相源仍是 store。
  const addEntity = useCallback(
    (module: ModuleKey, id: string): void => {
      const current = useSettingsStore.getState().prefs.compareIds;
      const key = `${module}:${id}`;
      if (current.includes(key) || current.length >= COMPARE_LIMIT) return;
      setCompareIds([...current, key]);
      setQuery('');
    },
    [setCompareIds],
  );

  const removeEntity = useCallback(
    (key: string): void => {
      const current = useSettingsStore.getState().prefs.compareIds;
      setCompareIds(current.filter((entry) => entry !== key));
    },
    [setCompareIds],
  );

  const clearAll = useCallback((): void => setCompareIds([]), [setCompareIds]);

  const removeButton = (key: string): ReactNode => (
    <button
      type="button"
      onClick={() => removeEntity(key)}
      className="rounded-btn border border-line bg-elev px-2 py-1 text-[11px] text-dim transition-colors duration-fast hover:border-accent hover:text-accent"
    >
      {t('compare.remove')}
    </button>
  );

  const renderHeader = (column: CompareColumn): ReactNode => {
    if (!column.found || column.module === null) {
      // 已移除实体/脏键：虚线占位列，保留键供用户自行清理，不自动改写 prefs。
      return (
        <div className="flex flex-col items-center gap-2 rounded-btn border border-dashed border-line bg-elev p-3 text-center">
          <span className="w-full truncate font-mono text-xs text-dim" title={column.key}>
            {column.name}
          </span>
          <span className="text-[11px] text-dim">{t('compare.noStats')}</span>
          {removeButton(column.key)}
        </div>
      );
    }
    const moduleLabel = t(MODULE_LABEL_KEYS[column.module] as 'nav.characters') as string;
    // 货币战争卡片的徽标（品质/类型/分类/前后排/专家/敌方难度/标签），与图鉴列表同一口径
    const badges = column.currencyEntry !== undefined ? currencyBadges(column.currencyEntry, t) : [];
    return (
      <div className="flex flex-col items-center gap-2">
        {column.icon !== null ? (
          <SafeImage
            src={column.icon}
            alt={column.name}
            eager
            className="h-16 w-16 rounded-btn"
            imgClassName="object-contain"
          />
        ) : (
          <span className="flex h-16 w-16 items-center justify-center rounded-btn bg-elev text-xs text-dim">
            {moduleLabel}
          </span>
        )}
        {column.detailPath !== null ? (
          <Link
            to={column.detailPath}
            title={column.name}
            className="max-w-full truncate text-sm font-semibold text-ink hover:text-accent"
          >
            {column.name}
          </Link>
        ) : (
          <span className="max-w-full truncate text-sm font-semibold text-ink" title={column.name}>
            {column.name}
          </span>
        )}
        <span className="rounded-tag border border-line bg-elev px-1.5 py-[1px] text-[11px] text-dim">
          {moduleLabel}
        </span>
        {badges.length > 0 ? (
          <div className="flex flex-wrap justify-center gap-1">
            {badges.map((badge) => (
              <span
                key={badge}
                className="rounded-tag border border-line bg-elev px-1.5 py-[1px] text-[11px] text-dim"
              >
                {badge}
              </span>
            ))}
          </div>
        ) : null}
        {removeButton(column.key)}
      </div>
    );
  };

  /**
   * 列出「6 主模块」实体自己拥有的字段（有值才列，无值不列）。
   *
   * 这是用户要的「卡片原来有什么就显示什么」：不再用固定的
   * 「稀有度/命途/属性/实装时间/SP/ID」横表硬套所有模块，而是每个实体只展示
   * 它详情页里实际存在的字段，避免下一张卡片没这个字段时铺出一堆空行。
   */
  const renderBasicFields = (column: CompareColumn): readonly FieldRow[] => {
    if (!column.found || column.module === null) return [];
    const rows: FieldRow[] = [];
    // 类型（模块名）与 ID 是所有实体都有的，放最前
    rows.push({
      label: t('compare.colType'),
      value: t(MODULE_LABEL_KEYS[column.module] as 'nav.characters') as string,
    });
    if (column.rarity !== null) {
      // 只画星：`rarityName` 本身就是星形串，两个都渲染会变成「★★★★★ ★★★★★」
      rows.push({ label: t('compare.colRarity'), value: <RarityStars rarity={column.rarity} /> });
    }
    if (column.path !== null) {
      rows.push({
        label: t('compare.colPath'),
        value: (
          <span className="flex items-center gap-2">
            <SafeImage src={pathIconPath(column.path)} alt="" className="h-6 w-6 shrink-0" imgClassName="object-contain" />
            <span className="text-ink">{pathName(t, column.path) || t('compare.noStats')}</span>
          </span>
        ),
      });
    }
    if (column.elements.length > 0) {
      rows.push({
        label: t('compare.colElement'),
        value: (
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {column.elements.map((element) => (
              <span key={element} className="flex items-center gap-1.5">
                <SafeImage src={elementIconPath(element)} alt="" className="h-5 w-5 shrink-0" imgClassName="object-contain" />
                <span className="text-ink">{elementName(t, element) || element}</span>
              </span>
            ))}
          </span>
        ),
      });
    }
    if (column.release !== null) {
      rows.push({
        label: t('compare.colRelease'),
        value: <span className="text-ink">{formatDate(column.release, lang) || t('compare.noStats')}</span>,
      });
    }
    if (column.spNeed !== null) {
      rows.push({ label: t('compare.colSp'), value: <span className="text-ink">{column.spNeed}</span> });
    }
    if (column.mainType !== null) {
      rows.push({
        label: t('detail.mainType'),
        value: <span className="text-ink">{itemTypeName(t, column.mainType) || column.mainType}</span>,
      });
    }
    if (column.subType !== null) {
      rows.push({
        label: t('detail.subType'),
        value: <span className="text-ink">{itemTypeName(t, column.subType) || column.subType}</span>,
      });
    }
    if (column.pileLimit !== null) {
      rows.push({ label: t('detail.pileLimit'), value: <span className="text-ink">{column.pileLimit.toLocaleString()}</span> });
    }
    if (column.kind !== null) {
      rows.push({
        label: t('detail.kind'),
        value: (
          <span className="text-ink">
            {column.kind === 'cavern'
              ? (t('list.kindCavern') as string)
              : column.kind === 'planar'
                ? (t('list.kindPlanar') as string)
                : column.kind}
          </span>
        ),
      });
    }
    if (column.partCount !== null) {
      rows.push({ label: t('detail.parts'), value: <span className="text-ink">{column.partCount}</span> });
    }
    if (column.rank !== null) {
      rows.push({
        label: t('list.filterRank'),
        value: <span className="text-ink">{monsterRankName(t, column.rank) || column.rank}</span>,
      });
    }
    if (column.camp !== null) {
      rows.push({ label: t('compare.colCamp'), value: <span className="text-ink">{column.camp}</span> });
    }
    rows.push({
      label: t('compare.colId'),
      value: <code className="rounded-btn bg-elev px-1.5 py-0.5 font-mono text-xs text-ink">{column.id}</code>,
    });
    return rows;
  };

  /**
   * 列出货币战争条目「卡片上真正展示的字段」（有值才列）。
   *
   * 图鉴卡片上就是：图标 + 名称 + `#id` + 星级 + 徽标（品质/类型/分类/前后排/专家/
   * 敌方难度/标签）+ 描述；羁绊/主角光环另有羁绊与推荐角色。这里按同一口径铺开，
   * 不把 `max_sp_icon`、`category_id`、`param_list` 这类**技术字段**倒出来 ——
   * 对比列很窄，技术字段只会糊成噪音（完整字段仍在图鉴详情面板里）。
   */
  const renderCurrencyFields = (column: CompareColumn): readonly FieldRow[] => {
    if (!column.found || column.currencyEntry === undefined || column.currencyKind === undefined) return [];
    const entry = column.currencyEntry;
    const kind = column.currencyKind;
    const params = currencyParams(entry);
    const rows: FieldRow[] = [];

    if (typeof entry.rarity === 'number') {
      rows.push({ label: t('currency.rarity'), value: <RarityStars rarity={entry.rarity} /> });
    }

    // 角色图鉴的赛季（从 id 派生），原站卡片上不写，但详情页第一屏就有
    if (kind === 'role') {
      rows.push({
        label: t('currency.season'),
        value: (
          <span className="text-ink">
            {t('currency.seasonValue', { season: String(roleSeasonOf(column.id)) }) as string}
          </span>
        ),
      });
    }

    // 羁绊：角色图鉴是 `trait_list`，主角光环是单值 `trait_id`（0 表示没有）
    const traitIds: string[] = Array.isArray(entry.trait_list)
      ? entry.trait_list.map((id) => String(id))
      : [];
    if (kind === 'spotlight' && typeof entry.trait_id === 'number' && entry.trait_id > 0) {
      traitIds.push(String(entry.trait_id));
    }
    if (traitIds.length > 0) {
      const names = traitIds.map((id) => {
        const trait = findCurrencyEntry(currency, 'currencyTrait', id);
        return trait !== undefined ? currencyDisplayName(trait, 'trait', t) : `#${id}`;
      });
      rows.push({
        label: t('currencyDetail.traits'),
        value: <span className="text-ink">{[...new Set(names)].join('、')}</span>,
      });
    }

    if (typeof entry.desc === 'string' && entry.desc.trim() !== '') {
      rows.push({
        label: t('detail.desc'),
        value: <MacroText value={entry.desc} paramList={params} className="text-sm" />,
      });
    }
    if (typeof entry.simple_desc === 'string' && entry.simple_desc.trim() !== '') {
      rows.push({
        label: t('currency.simpleDesc'),
        value: <MacroText value={entry.simple_desc} paramList={params} className="text-sm" />,
      });
    }

    if (isNonEmptyValue(entry.remark)) {
      const rendered = renderStructuredValue(entry.remark, params);
      if (rendered !== null) rows.push({ label: t('currency.remark'), value: rendered });
    }
    if (isNonEmptyValue(entry.effect_list)) {
      const rendered = renderStructuredValue(entry.effect_list, params);
      if (rendered !== null) rows.push({ label: t('currency.effect'), value: rendered });
    }

    // 层级：每档自带 `buff_param_list`，不能拿条目参数顶（数值会错）
    const layers = currencyLayers(entry);
    if (layers.length > 0) {
      rows.push({
        label: t('currency.layer'),
        value: (
          <div className="flex flex-col gap-1.5">
            {layers.map((layer) => (
              <div key={layer.level} className="rounded-btn border border-line bg-elev p-2 text-left">
                <div className="mb-1 text-[11px] font-semibold text-accent">
                  {t('currency.layer')} {layer.level}
                </div>
                <MacroText value={layer.desc} paramList={layer.params} className="text-xs text-dim" />
              </div>
            ))}
          </div>
        ),
      });
    }

    if (isNonEmptyValue(entry.sub_trait)) {
      const rendered = renderStructuredValue(entry.sub_trait, params);
      if (rendered !== null) rows.push({ label: t('currency.subTraits'), value: rendered });
    }

    // 主角光环：推荐角色 id → 角色图鉴名称
    if (kind === 'spotlight') {
      const ids = recommendIds(entry);
      if (ids.length > 0) {
        const names = ids.map((id) => {
          const role = findCurrencyEntry(currency, 'currencyRole', id);
          return role !== undefined ? currencyDisplayName(role, 'role', t) : `#${id}`;
        });
        rows.push({
          label: t('currency.recommendRoles'),
          value: <span className="text-ink">{[...new Set(names)].join('、')}</span>,
        });
      }
    }

    // 完整标签（卡片上只放前 3 个）；`tag_list` 已在 currencyTags 里归一
    const tags = currencyTags(entry)
      .map((tag) => (typeof tag.name === 'string' ? tag.name : ''))
      .filter((name) => name !== '');
    if (tags.length > 0) {
      rows.push({ label: t('currency.tags'), value: <span className="text-ink">{tags.join('、')}</span> });
    }

    rows.push({
      label: t('currency.id'),
      value: <code className="rounded-btn bg-elev px-1.5 py-0.5 font-mono text-xs text-ink">{column.id}</code>,
    });
    return rows;
  };

  /**
   * 渲染某列的「二级界面」内容（技能 / 叠影 / 套装效果 / 成就条目）。
   *
   * 这是用户要的「详情页二级界面」：与基本信息字段表分开，独立成区，每个实体一列
   * 纵向列出它的技能/叠影/效果条目（名称 + 满级描述富文本）。详情未加载完时显示占位。
   */
  const renderDetailBlock = (column: CompareColumn): ReactNode => {
    if (!column.found || column.module === null) return null;
    const detail = detailCache[column.key];
    // 货币战争「非角色」图鉴：条目本身就是全部内容，已在字段区展示，这里无二级界面。
    if (column.module !== 'currencyRole' && CURRENCY_MODULE_KIND[column.module] !== undefined) return null;
    if (detail === undefined) {
      return <span className="text-xs text-dim">{t('detail.loading')}</span>;
    }

    switch (detail.kind) {
      case 'character': {
        const skills = detail.skills ?? [];
        if (skills.length === 0) return <span className="text-xs text-dim">{t('compare.noStats')}</span>;
        return (
          <div className="flex flex-col gap-2">
            {skills.map((skill) => {
              const maxLevel = skill.levels.length > 0 ? Math.max(...skill.levels.map((l) => l.level)) : 1;
              const params = paramListAtLevel(skill.levels, maxLevel);
              return (
                <div key={skill.id} className="rounded-btn border border-line bg-elev p-2 text-left">
                  <div className="mb-1 flex items-center gap-1.5">
                    {skill.icon ? (
                      <SafeImage src={skill.icon} alt="" className="h-5 w-5 shrink-0 rounded-tag" imgClassName="object-contain" />
                    ) : null}
                    <span className="text-xs font-semibold text-ink">{skill.name}</span>
                    <span className="rounded-tag border border-line px-1 py-[1px] text-[10px] text-dim">
                      {skill.typeName ?? skill.type}
                    </span>
                  </div>
                  <RichTextView value={skill.desc} paramList={params} className="text-xs text-dim" />
                </div>
              );
            })}
          </div>
        );
      }
      case 'lightcone': {
        const refinement = detail.refinement;
        if (refinement === undefined) return <span className="text-xs text-dim">{t('compare.noStats')}</span>;
        const maxLevel = refinement.levels.length > 0 ? Math.max(...refinement.levels.map((l) => l.level)) : 1;
        const params = paramListAtLevel(refinement.levels, maxLevel);
        return (
          <div className="rounded-btn border border-line bg-elev p-2 text-left">
            <div className="mb-1 text-xs font-semibold text-accent">{refinement.name}</div>
            <RichTextView value={refinement.desc} paramList={params} className="text-xs text-dim" />
          </div>
        );
      }
      case 'relicset': {
        if (detail.effects.length === 0) return <span className="text-xs text-dim">{t('compare.noStats')}</span>;
        return (
          <div className="flex flex-col gap-2">
            {detail.effects.map((effect) => (
              <div key={effect.pieces} className="rounded-btn border border-line bg-elev p-2 text-left">
                <div className="mb-1 text-xs font-semibold text-accent">
                  {effect.pieces} {t('detail.pieces')}
                </div>
                <RichTextView value={effect.desc} paramList={effect.paramList} className="text-xs text-dim" />
              </div>
            ))}
          </div>
        );
      }
      case 'achievementSeries': {
        if (detail.items.length === 0) return <span className="text-xs text-dim">{t('compare.noStats')}</span>;
        return (
          <div className="flex flex-col gap-2">
            {detail.items.map((item) => (
              <div key={item.id} className="rounded-btn border border-line bg-elev p-2 text-left">
                <div className="mb-1 text-xs font-semibold text-ink">{item.name}</div>
                <RichTextView value={item.desc} paramList={item.paramList} className="text-xs text-dim" />
              </div>
            ))}
          </div>
        );
      }
      case 'currencyRole': {
        // 货币战争角色的二级界面：原站是 1★–3★ 滑档，对比页固定取**最高档**并标注星级，
        // 展示该档的属性加成与特质，再列前排/后排/支援技能与星魂。
        const stars = detail.stars;
        const top = stars.length > 0 ? stars[stars.length - 1] : undefined;
        const blocks: ReactNode[] = [];
        if (top !== undefined) {
          const stats: string[] = [];
          if (top.hpRatio > 0) stats.push(`${t('currencyDetail.statHp') as string} +${top.hpRatio}%`);
          if (top.spdRatio > 0) stats.push(`${t('currencyDetail.statSpd') as string} +${top.spdRatio}%`);
          if (typeof top.frontPower === 'number' && top.frontPower > 0) {
            stats.push(`${t('currencyDetail.statFront') as string} ${top.frontPower}`);
          }
          if (typeof top.backPower === 'number' && top.backPower > 0) {
            stats.push(`${t('currencyDetail.statBack') as string} ${top.backPower}`);
          }
          if (typeof top.healBase === 'number' && top.healBase > 0) {
            stats.push(`${t('currencyDetail.statHeal') as string} ${top.healBase}`);
          }
          if (typeof top.shieldBase === 'number' && top.shieldBase > 0) {
            stats.push(`${t('currencyDetail.statShield') as string} ${top.shieldBase}`);
          }
          blocks.push(
            <div
              key="currency-role-stats"
              className="flex flex-col gap-1.5 rounded-btn border border-line bg-elev p-2 text-left"
            >
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="rounded-tag border border-accent/40 px-1.5 py-[1px] text-[11px] font-semibold text-accent">
                  ★{top.star}
                </span>
                <span className="text-[11px] text-dim">{t('currencyDetail.starLevel') as string}</span>
              </div>
              {stats.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {stats.map((stat) => (
                    <span
                      key={stat}
                      className="rounded-tag border border-line bg-panel px-1.5 py-[1px] text-[11px] text-ink"
                    >
                      {stat}
                    </span>
                  ))}
                </div>
              ) : null}
              {top.frontTrait !== '' ? (
                <p className="text-xs leading-relaxed text-dim">
                  <span className="text-accent">{t('currencyDetail.frontlineTrait') as string}</span> {top.frontTrait}
                </p>
              ) : null}
              {top.backTrait !== '' ? (
                <p className="text-xs leading-relaxed text-dim">
                  <span className="text-accent">{t('currencyDetail.backlineTrait') as string}</span> {top.backTrait}
                </p>
              ) : null}
            </div>,
          );
          const sections: readonly { title: string; skills: typeof top.frontSkills }[] = [
            { title: t('currencyDetail.frontlineSkills'), skills: top.frontSkills },
            { title: t('currencyDetail.backlineSkills'), skills: top.backSkills },
            { title: t('currencyDetail.supportSkills'), skills: top.supportSkills },
          ];
          for (const section of sections) {
            if (section.skills.length === 0) continue;
            blocks.push(
              <div key={section.title} className="flex flex-col gap-1.5">
                <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-accent">{section.title}</div>
                {section.skills.map((skill) => (
                  <div key={`${skill.id}-${skill.name}`} className="rounded-btn border border-line bg-elev p-2 text-left">
                    <div className="mb-1 flex flex-wrap items-center gap-1.5">
                      <span className="text-xs font-semibold text-ink">{skill.name}</span>
                      {skill.tag !== '' ? (
                        <span className="rounded-tag border border-line px-1 py-[1px] text-[10px] text-dim">
                          {skillTagLabel(t, skill.tag)}
                        </span>
                      ) : null}
                    </div>
                    <MacroText value={skill.desc} paramList={skill.paramList} className="text-xs" />
                  </div>
                ))}
              </div>,
            );
          }
        }
        if (detail.eidolons.length > 0) {
          blocks.push(
            <div key="currency-role-eidolons-title" className="text-[11px] font-semibold uppercase tracking-[0.12em] text-accent">
              {t('currencyDetail.eidolons') as string}
            </div>,
          );
          for (const eidolon of detail.eidolons) {
            blocks.push(
              <div key={`eidolon-${eidolon.rank}`} className="rounded-btn border border-line bg-elev p-2 text-left">
                <div className="mb-1 flex items-center gap-1.5">
                  <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-elev text-[11px] font-semibold text-accent">
                    {eidolon.rank}
                  </span>
                  <span className="text-xs font-semibold text-ink">{eidolon.name}</span>
                </div>
                <MacroText value={eidolon.desc} paramList={eidolon.paramList} className="text-xs" />
              </div>,
            );
          }
        }
        if (blocks.length === 0) return <span className="text-xs text-dim">{t('compare.noStats')}</span>;
        return <div className="flex flex-col gap-2">{blocks}</div>;
      }
      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col gap-4 pt-2">
      <PageHeader
        title={t('compare.title')}
        description={t('compare.sub', { count: COMPARE_LIMIT })}
        badge={t('compare.selected', { count: keys.length, max: COMPARE_LIMIT })}
        actions={
          <button
            type="button"
            onClick={clearAll}
            disabled={keys.length === 0}
            className="rounded-btn border border-line bg-elev px-3 py-1.5 text-xs text-dim transition-colors duration-fast hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t('compare.clear')}
          </button>
        }
      />

      {/* 对比卡片（v2.13）：每个实体一张卡，纵向列出它自己的字段 + 二级界面内容。
          不再用「稀有度/命途/属性/实装时间/SP/ID」固定横表 —— 下一张卡不一定有这些字段，
          硬套横表只会铺出一堆空行。这里「卡片原来有什么就显示什么」。 */}
      {columns.length === 0 ? (
        <div className="hsr-panel flex flex-col items-center gap-2 rounded-card border border-line p-10 text-center">
          <p className="text-sm font-semibold text-ink">{t('compare.empty')}</p>
          <p className="text-xs text-dim">{t('compare.addHint')}</p>
        </div>
      ) : (
        <section className="flex flex-col gap-2">
          {/* 滚动提示 + 左右翻页按钮：卡片多到超出可视宽度时才出现提示 */}
          <div className="flex min-h-7 flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-dim">
              {horizontalScrollable ? (t('compare.scrollHint') as string) : null}
            </p>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => scrollCards(-1)}
                disabled={!canScrollLeft}
                aria-label={t('compare.scrollPrev') as string}
                title={t('compare.scrollPrev') as string}
                className="flex h-7 w-7 items-center justify-center rounded-btn border border-line bg-elev text-sm text-dim transition-colors duration-fast hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-30"
              >
                ←
              </button>
              <button
                type="button"
                onClick={() => scrollCards(1)}
                disabled={!canScrollRight}
                aria-label={t('compare.scrollNext') as string}
                title={t('compare.scrollNext') as string}
                className="flex h-7 w-7 items-center justify-center rounded-btn border border-line bg-elev text-sm text-dim transition-colors duration-fast hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-30"
              >
                →
              </button>
            </div>
          </div>
          <div
            ref={scrollRef}
            onScroll={syncScrollState}
            className="hsr-compare-scroll hsr-panel overflow-auto rounded-card border border-line"
            style={{ maxHeight: horizontalScrollable ? 'calc(100vh - 13rem)' : undefined }}
          >
            <div
              className="grid gap-3 p-3"
              style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(260px, 1fr))` }}
            >
              {columns.map((column) => {
                const fields =
                  column.currencyEntry !== undefined
                    ? renderCurrencyFields(column)
                    : renderBasicFields(column);
                return (
                  <div
                    key={column.key}
                    className="flex min-w-0 flex-col gap-3 rounded-card border border-line bg-panel p-4"
                  >
                    {renderHeader(column)}
                    {/* 基本信息：该实体自己拥有的字段，有值才列 */}
                    {fields.length > 0 ? (
                      <dl className="flex flex-col gap-2 border-t border-line pt-3">
                        {fields.map((field, index) => (
                          <div key={`${field.label}-${index}`} className="flex flex-col gap-0.5">
                            <dt className="text-[11px] font-medium uppercase tracking-wide text-dim">{field.label}</dt>
                            <dd className="text-sm text-ink">{field.value}</dd>
                          </div>
                        ))}
                      </dl>
                    ) : null}
                    {/* 二级界面：技能 / 叠影 / 套装效果 / 成就条目 / 货币战争角色技能星魂 */}
                    {renderDetailBlock(column)}
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* 添加实体选择器：六模块任意混合，选完即清空输入、无需刷新页面 */}
      <section className="hsr-panel flex flex-col gap-3 rounded-card border border-line p-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="compare-picker" className="text-sm font-semibold text-ink">
            {t('compare.add')}
          </label>
          <p className="text-xs text-dim">{t('compare.addHint')}</p>
        </div>

        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label={t('compare.colType') as string}>
          {MODULE_KEYS.map((module) => {
            const active = module === pickerModule;
            return (
              <button
                key={module}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => {
                  setPickerModule(module);
                  setQuery('');
                }}
                className={`rounded-btn border px-2.5 py-1 text-xs transition-colors duration-fast ${
                  active
                    ? 'border-accent bg-elev text-accent'
                    : 'border-line bg-elev text-dim hover:text-ink'
                }`}
              >
                {t(MODULE_LABEL_KEYS[module] as 'nav.characters') as string}
              </button>
            );
          })}
        </div>

        <input
          id="compare-picker"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setQuery('');
          }}
          placeholder={t('compare.selectPlaceholder')}
          aria-label={t('compare.add')}
          className="h-9 w-full rounded-btn border border-line bg-elev px-3 text-sm text-ink outline-none placeholder:text-dim focus:border-accent"
        />

        {atLimit ? (
          <p className="text-xs text-accent">{t('compare.limit', { count: COMPARE_LIMIT })}</p>
        ) : null}

        {results.length > 0 ? (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {results.map((entry) => {
              const name = pickName(entry.names, lang, entry.id);
              return (
                <li key={entry.id}>
                  <button
                    type="button"
                    disabled={atLimit}
                    onClick={() => addEntity(pickerModule, entry.id)}
                    title={name}
                    className="flex w-full items-center gap-2 rounded-btn border border-line bg-elev px-2 py-2 text-left transition-colors duration-fast hover:border-accent disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {entry.icon !== null ? (
                      <SafeImage
                        src={entry.icon}
                        alt={name}
                        className="h-10 w-10 shrink-0 rounded-btn"
                        imgClassName="object-contain"
                      />
                    ) : (
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-btn bg-panel text-[11px] text-dim">
                        {t(MODULE_LABEL_KEYS[pickerModule] as 'nav.characters') as string}
                      </span>
                    )}
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="truncate text-sm text-ink">{name}</span>
                      {entry.rarity !== null ? <RarityStars rarity={entry.rarity} /> : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : query.trim() !== '' ? (
          <p className="text-xs text-dim">{t('list.empty')}</p>
        ) : null}
      </section>
    </div>
  );
}
