/**
 * 货币战争（原站 `/currency` 入口 + `/currency/:kind` 六个图鉴）
 *
 * 一个默认导出组件处理两条路由：
 *  - `kind` 缺省：入口页，六张卡片按 `CURRENCY_KINDS` 链接到各自图鉴，
 *    图标直接用原站 `img/nav/...` webp（SafeImage）。
 *  - `kind` 存在：图鉴页，按当前语言读 `db/{lang}/currency/{kind}.json`。
 *
 * 六个图鉴字段差异极大（role 无 icon_path/desc、item 无 rarity、spotlight 的
 * tag 是对象数组、trait 的 layer 是嵌套对象且 desc 可能为 null、remark 可能是对象……），
 * 因此详情一律走「索引签名 + 安全 stringify + 宏字符串 MacroText」，
 * 不假设任何字段的形状，也绝不让 Object 直接进 React 子节点。
 *
 * 数据读取放在 `CodexView` 里：语言切换会触发重取，并用 `cancelled` 丢弃过期响应。
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { EntityGrid, RarityStars } from '@/components/common/EntityGrid';
import { currencyBadges } from '@/components/currency/badges';
import { RatingBadge } from '@/components/currency/RatingBadge';
import { RoleCard } from '@/components/currency/RoleCard';
import { AugmentCard } from '@/components/currency/AugmentCard';
import { expandGridFightInfo } from '@/lib/text/gridfight';
import { SpotlightCard } from '@/components/currency/SpotlightCard';
import { CurrencyDetail } from '@/components/currency/CurrencyDetail';
import { TraitCard } from '@/components/currency/TraitCard';
import { ErrorState } from '@/components/common/ErrorState';
import { FilterBar, PagedGrid, type FilterDef } from '@/components/common/ListControls';
import { MacroText } from '@/components/common/MacroText';
import { openEntityContextMenu } from '@/components/common/ContextMenu';
import { SafeImage } from '@/components/common/SafeImage';
import { SkeletonCardGrid } from '@/components/common/SkeletonBlock';
import { PageHeader } from '@/components/layout/PageHeader';
import { DataAccessError } from '@/lib/data/errors';
import {
  CURRENCY_KINDS,
  currencyDisplayName,
  currencyIconCandidates,
  currencyParams,
  currencySearchNames,
  currencyTags,
  getCurrencyEntries,
  roleSeasonOf,
  type CurrencyEntry,
  type CurrencyKind,
} from '@/lib/data/extra';
import { matchesQuery, useListState } from '@/hooks/useListState';
import { currencyFieldName } from '@/lib/labels';
import type { LocalizedNames, ModuleKey } from '@/lib/data/types';
import { alphabetIndexFor, sortByIndex } from '@/lib/text/indexLetter';
import { useRatingsStore } from '@/stores/ratings';
import { useSettingsStore } from '@/stores/settings';

/* ------------------------------------------------------------------ */
/* 通用工具                                                            */
/* ------------------------------------------------------------------ */

const KIND_VALUES: ReadonlySet<string> = new Set(CURRENCY_KINDS.map((entry) => entry.key));

function isCurrencyKind(value: string | undefined): value is CurrencyKind {
  return typeof value === 'string' && KIND_VALUES.has(value);
}

/** 图鉴种类 → 实体模块名（`role` → `currencyRole`，与 `CURRENCY_KINDS[].navKey` 一致） */
const KIND_MODULE: Readonly<Record<CurrencyKind, ModuleKey>> = {
  role: 'currencyRole',
  item: 'currencyItem',
  buff: 'currencyBuff',
  augment: 'currencyAugment',
  spotlight: 'currencySpotlight',
  trait: 'currencyTrait',
};

/**
 * 图鉴条目的右键上下文上报。
 *
 * 名称快照用当前语言的显示名（四语言同值，与 achievementSeries 一致）：货币图鉴
 * 数据不在启动索引里，跨包存活时靠快照显示名；换语言后快照仍是旧语言，但换包后
 * 重新右键会自然刷新——与成就系列的行为一致，可接受。
 */
function currencyContextTarget(entry: CurrencyEntry, kind: CurrencyKind, t: TFunction) {
  const display = currencyDisplayName(entry, kind, t);
  return {
    module: KIND_MODULE[kind],
    id: String(entry.id),
    names: { zh: display, en: display, ja: display, ko: display } as LocalizedNames,
  };
}

/** 在卡片上统一挂右键：preventDefault 后打开实体右键菜单 */
function openCurrencyMenu(
  entry: CurrencyEntry,
  kind: CurrencyKind,
  t: TFunction,
  event: React.MouseEvent,
): void {
  openEntityContextMenu(currencyContextTarget(entry, kind, t), event);
}

/** 字段是否「存在且非空」（空串 / 空数组 / 空对象 / null 都不展示） */
function isNonEmpty(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as object).length > 0;
  return true;
}

/** 只在字段确实存在取值时才出现的筛选项 */
const FILTER_FIELDS = ['quality', 'category', 'rarity'] as const;

/**
 * 一个筛选维度。
 *
 * 用 `valuesOf` 而不是"字段名"：角色赛季是从 id 派生的虚拟字段（数据里根本没有
 * `season`），主角光环的标签一个条目有多个值 —— 这两种都用不了「读字段再比较」
 * 的通用逻辑。命中判断统一成 `valuesOf(entry).includes(选中值)`。
 */
interface FilterSpec {
  /** 存进 `useListState` 的键 */
  readonly key: string;
  /** 已翻译的组名 */
  readonly label: string;
  /** 条目在该维度上的取值（空数组 = 不参与该维度） */
  readonly valuesOf: (entry: CurrencyEntry) => readonly string[];
  /** 取值 → 显示名 */
  readonly labelOf: (value: string) => string;
  /** 候选值排序（缺省按字典序） */
  readonly compare?: (left: string, right: string) => number;
}

/**
 * 排序候选值。
 *
 * @param values 去重后的取值
 * @param compare 自定义比较（缺省字典序）
 */
function sortValues(
  values: readonly string[],
  compare?: (left: string, right: string) => number,
): string[] {
  return [...values].sort(compare ?? ((left, right) => left.localeCompare(right)));
}

/* ------------------------------------------------------------------ */
/* 值渲染                                                              */
/* ------------------------------------------------------------------ */

/** 卡片徽标：与对比页共用同一份口径（见 `components/currency/badges.ts`） */
function useCardBadges(entry: CurrencyEntry): readonly string[] {
  const { t } = useTranslation();
  return useMemo(() => currencyBadges(entry, t), [entry, t]);
}

/** 单个字段值：字符串一律走 MacroText，其余安全 stringify */
/* 卡片与详情                                                          */
/* ------------------------------------------------------------------ */

/**
 * 图鉴卡片：点击打开页内详情面板，图标走候选链（首候选 + 其余作 fallbacks）。
 *
 * 卡片形态按图鉴分派：
 *  - `role` → {@link RoleCard}（原站式立绘卡：3:4 竖版图 + 名称 + 星级）
 *  - 其余五个图鉴 → 本函数里的通用卡片（图标 + 名称 + `#id` + 两行描述 + 徽标）
 *
 * 主角光环**不走这里**：它要五块内容，由 `CodexView` 的 spotlight 分支直接渲染
 * {@link SpotlightCard}。
 */
function EntryCardButton({
  entry,
  kind,
  onOpen,
  infoLabelOf,
}: {
  readonly entry: CurrencyEntry;
  readonly kind: CurrencyKind;
  readonly onOpen: () => void;
  readonly infoLabelOf?: (type: string, id: string) => string | undefined;
}): ReactNode {
  const { t } = useTranslation();
  // 钩子必须先无条件调用（下面的 kind 分支会提前 return，条件调用会让 hook 顺序变化）
  const badges = useCardBadges(entry);
  // 评级徽标是卡片的兄弟节点（button 里不能再嵌 button），两个分支共用同一份
  const id = String(entry.id);
  const actions = (
    <>
      <RatingBadge kind={kind} id={id} variant="tier" />
      <RatingBadge kind={kind} id={id} />
    </>
  );

  if (kind === 'role') {
    return (
      <RoleCard
        entry={entry}
        onOpen={onOpen}
        actions={actions}
        onContextMenu={(event) => openCurrencyMenu(entry, kind, t, event)}
      />
    );
  }

  if (kind === 'augment') {
    return (
      <AugmentCard
        entry={entry}
        onOpen={onOpen}
        actions={actions}
        infoLabelOf={infoLabelOf}
        onContextMenu={(event) => openCurrencyMenu(entry, kind, t, event)}
      />
    );
  }

  const params = currencyParams(entry);
  const candidates = currencyIconCandidates(entry, kind);
  const alt = currencyDisplayName(entry, kind, t);
  const rawPreview = isNonEmpty(entry.desc)
    ? entry.desc
    : isNonEmpty(entry.simple_desc)
      ? entry.simple_desc
      : undefined;
  const preview =
    typeof rawPreview === 'string' ? expandGridFightInfo(rawPreview, infoLabelOf) : rawPreview;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onOpen}
        onContextMenu={(event) => openCurrencyMenu(entry, kind, t, event)}
        className="hsr-panel group flex w-full flex-col gap-2 rounded-card border border-line p-3 text-left transition-colors duration-fast hover:border-accent"
      >
        <div className="flex gap-3">
          <SafeImage
            src={candidates[0]}
            fallbacks={candidates.slice(1)}
            alt={alt}
            className="h-20 w-16 shrink-0 rounded-btn"
            imgClassName="object-contain"
          />
          {/* pr-24：给右上角两枚评级徽标让位（「千」+ 三字母 SSS 并排最宽约 90px，
              加右侧 8px 边距），长名字提前截断而不是被压住 */}
          <div className="flex min-w-0 flex-1 flex-col gap-1 pr-24">
            <MacroText value={alt} paramList={params} className="break-words font-semibold text-ink" />
            <span className="font-mono text-[11px] text-dim">#{id}</span>
            {typeof entry.rarity === 'number' ? <RarityStars rarity={entry.rarity} /> : null}
            {badges.length > 0 ? (
              <div className="mt-auto flex flex-wrap gap-1 pt-1">
                {badges.map((badge) => (
                  <span key={badge} className="rounded-tag border border-line bg-elev px-1.5 py-[1px] text-[11px] text-dim">
                    {badge}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </div>
        <div className="line-clamp-2 overflow-hidden text-xs text-dim">
          {preview ? (
            <MacroText value={preview} paramList={params} />
          ) : (
            <span>{t('currency.noDesc') as string}</span>
          )}
        </div>
      </button>
      {/* 徽标是卡片的兄弟节点：button 里不能再嵌 button。tier 在左、grade 在右，
          与"第二套评级显示在评级左边"的要求一致 */}
      <div className="absolute right-2 top-2 z-[2] flex items-center gap-1">{actions}</div>
    </div>
  );
}

/** 页内详情面板内容：所有额外字段按存在与否展示 */
/* 三段视图                                                            */
/* ------------------------------------------------------------------ */

/** 入口页：六张图鉴卡片 */
function EntryView(): ReactNode {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-4 pt-2">
      <PageHeader title={t('currency.title') as string} description={t('currency.listSub') as string} />
      <EntityGrid>
        {CURRENCY_KINDS.map((entry) => {
          const label = t(`currency.${entry.navKey}` as 'currency.currencyRole') as string;
          return (
            <Link
              key={entry.key}
              to={`/currency/${entry.key}`}
              className="hsr-panel group flex flex-col items-center gap-3 rounded-card border border-line p-5 transition-colors duration-fast hover:border-accent"
            >
              <SafeImage
                src={entry.icon}
                alt={label}
                eager
                className="h-20 w-20 rounded-full"
                imgClassName="object-contain"
              />
              <span className="text-center text-sm font-semibold text-ink group-hover:text-accent">{label}</span>
              <span className="text-xs text-accent">{t('currency.open') as string}</span>
            </Link>
          );
        })}
      </EntityGrid>
    </div>
  );
}

/** 非法 kind：友好错误 + 返回入口，不崩 */
function InvalidKindView(): ReactNode {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-4 pt-2">
      <PageHeader title={t('currency.title') as string} description={t('currency.listSub') as string} />
      <ErrorState
        title={t('detail.notFound') as string}
        description={t('error.notFound.desc') as string}
        actionTo="/currency"
        actionLabel={t('currency.back') as string}
      />
    </div>
  );
}

/** 图鉴页：加载 / 骨架 / 错误 / 搜索+筛选+分页 / 详情面板 */
function CodexView({ kind }: { readonly kind: CurrencyKind }): ReactNode {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const lang = useSettingsStore((state) => state.prefs.lang);
  const { query, setQuery, filters, setFilter, resetKey } = useListState(`currency:${kind}`);
  const [entries, setEntries] = useState<readonly CurrencyEntry[] | undefined>(undefined);
  const [error, setError] = useState<DataAccessError | undefined>(undefined);
  const [selected, setSelected] = useState<CurrencyEntry | null>(null);
  // 两个图鉴要反查别的图鉴，各自多读一份（读失败只是缺一块内容，不影响主列表）：
  //  - 羁绊页要「哪些角色能激活这条羁绊」，需要角色图鉴
  //  - 主角光环卡片的「推荐角色」只给 id，也要角色图鉴才能拿到名字
  const [roleEntries, setRoleEntries] = useState<readonly CurrencyEntry[]>([]);
  //  - 主角光环的 `trait_id` 指向羁绊图鉴，要渲染羁绊名与各档层级
  const [traitEntries, setTraitEntries] = useState<readonly CurrencyEntry[]>([]);
  //  - 主角光环描述里的 `<gridfightinfo type=item id=…>` 要解析成物品名
  const [itemEntries, setItemEntries] = useState<readonly CurrencyEntry[]>([]);
  const needsRoles = kind === 'trait' || kind === 'spotlight';
  const needsTraits = kind === 'spotlight';
  const needsItems = kind !== 'role';
  // 本图鉴是否已经评过任何一条：评过就不再提示"点徽标可评级"，提示只在首次出现
  const ratedHere = useRatingsStore((state) =>
    Object.keys(state.items).some((key) => key.startsWith(`currency:${kind}:`)),
  );
  // 全局搜索跳过来时带 `?entry=<id>`：命中就自动打开该条详情（图鉴没有单条路由）
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedEntryId = searchParams.get('entry');

  useEffect(() => {
    let cancelled = false;
    setEntries(undefined);
    setError(undefined);
    setSelected(null);
    void getCurrencyEntries(kind, lang)
      .then((list) => {
        if (cancelled) return;
        // item.json 源数据无 id（对象键才是 id）；规范化成稳定字符串 id，防御性兜底 index
        setEntries(list.map((entry, index) => ({ ...entry, id: String(entry.id ?? index) })));
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setError(DataAccessError.from(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [kind, lang]);

  useEffect(() => {
    if (!needsRoles) {
      setRoleEntries([]);
      return;
    }
    let cancelled = false;
    void getCurrencyEntries('role', lang)
      .then((list) => {
        if (cancelled) return;
        setRoleEntries(list.map((entry, index) => ({ ...entry, id: String(entry.id ?? index) })));
      })
      .catch(() => {
        if (!cancelled) setRoleEntries([]);
      });
    return () => {
      cancelled = true;
    };
  }, [needsRoles, lang]);

  // 主角光环 → 羁绊：`trait_id` 是数字（0 表示没有关联），用值建表查
  useEffect(() => {
    if (!needsTraits) {
      setTraitEntries([]);
      return;
    }
    let cancelled = false;
    void getCurrencyEntries('trait', lang)
      .then((list) => {
        if (cancelled) return;
        setTraitEntries(list.map((entry, index) => ({ ...entry, id: String(entry.id ?? index) })));
      })
      .catch(() => {
        if (!cancelled) setTraitEntries([]);
      });
    return () => {
      cancelled = true;
    };
  }, [needsTraits, lang]);

  // 主角光环描述里的物品 id → 物品条目（只用来把 `<gridfightinfo>` 解析成名字）
  useEffect(() => {
    if (!needsItems) {
      setItemEntries([]);
      return;
    }
    let cancelled = false;
    void getCurrencyEntries('item', lang)
      .then((list) => {
        if (cancelled) return;
        setItemEntries(list.map((entry, index) => ({ ...entry, id: String(entry.id ?? index) })));
      })
      .catch(() => {
        if (!cancelled) setItemEntries([]);
      });
    return () => {
      cancelled = true;
    };
  }, [needsItems, lang]);

  // 角色 id → 条目（羁绊成员、光环推荐角色两处都要按 id 反查名字与头像）
  const roleById = useMemo(
    () => new Map(roleEntries.map((entry) => [String(entry.id), entry])),
    [roleEntries],
  );
  // 羁绊 id → 条目
  const traitById = useMemo(
    () => new Map(traitEntries.map((entry) => [String(entry.id), entry])),
    [traitEntries],
  );
  const selectedTrait =
    selected !== null && typeof selected.trait_id === 'number' && selected.trait_id > 0
      ? traitById.get(String(selected.trait_id))
      : undefined;
  /**
   * 推荐角色的显示名：查不到角色条目时回退 id（绝不渲染空标签）。
   * 查到的条目走统一显示名入口，所以 `800902` 会显示成开拓者、`604202` 会显示成帕姆王。
   */
  const roleLabelOf = useCallback(
    (id: string): string => {
      const role = roleById.get(id);
      return role === undefined ? id : currencyDisplayName(role, 'role', t);
    },
    [roleById, t],
  );

  // 物品 id → 显示名（`<gridfightinfo type=item>` 用）
  const itemById = useMemo(
    () => new Map(itemEntries.map((entry) => [String(entry.id), entry])),
    [itemEntries],
  );
  const infoLabelOf = useCallback(
    (type: string, id: string): string | undefined => {
      if (type === 'item') {
        const item = itemById.get(id);
        return item === undefined ? undefined : currencyDisplayName(item, 'item', t);
      }
      if (type === 'role') return roleLabelOf(id);
      return undefined;
    },
    [itemById, roleLabelOf, t],
  );

  // 消费 `?entry=`：数据到位后直接打开该条详情，再把参数从地址栏抹掉。
  // 不抹掉的话，用户关掉详情后刷新/前进后退会再次弹出，像是关不掉。
  // 找不到该 id（换语言后条目消失等）也照样抹掉，不留一个无效参数在地址栏里。
  useEffect(() => {
    if (entries === undefined || requestedEntryId === null) return;
    const match = entries.find((entry) => String(entry.id) === requestedEntryId);
    // 角色已有独立详情页：`?entry=` 只是旧链接/浅层入口，直接转成正路由，
    // 否则同一个角色会有「弹层」与「详情页」两种呈现，评级与备注入口也对不上。
    if (match !== undefined && kind === 'role') {
      navigate(`/currency/role/${requestedEntryId}`, { replace: true });
      return;
    }
    if (match !== undefined) setSelected(match);
    setSearchParams({}, { replace: true });
  }, [entries, requestedEntryId, setSearchParams, kind, navigate]);

  const navKey = CURRENCY_KINDS.find((entry) => entry.key === kind)?.navKey ?? 'currencyRole';
  const title = t(`currency.${navKey}` as 'currency.currencyRole') as string;

  /**
   * 本图鉴的筛选维度。
   *
   * 两个图鉴有原站独有的维度，其余沿用三个通用字段：
   *  - 角色：赛季（从 id 派生，数据里没有这个字段）
   *  - 主角光环：标签（一条多值）、敌方难度提升（数字档）
   */
  const filterSpecs = useMemo<readonly FilterSpec[]>(() => {
    const all = entries ?? [];
    const specs: FilterSpec[] = [];

    if (kind === 'role') {
      specs.push({
        key: 'season',
        label: t('currency.season') as string,
        valuesOf: (entry) => [String(roleSeasonOf(String(entry.id)))],
        labelOf: (value) => t('currency.seasonValue', { season: value }) as string,
        // 新赛季在前：原站默认就落在最高赛季
        compare: (left, right) => Number(right) - Number(left),
      });
    }

    if (kind === 'spotlight') {
      const tagNames = new Map<string, string>();
      for (const entry of all) {
        for (const tag of currencyTags(entry)) {
          tagNames.set(String(tag.id), typeof tag.name === 'string' ? tag.name : String(tag.id));
        }
      }
      specs.push({
        key: 'tag',
        label: t('currency.tags') as string,
        valuesOf: (entry) => currencyTags(entry).map((tag) => String(tag.id)),
        labelOf: (value) => tagNames.get(value) ?? value,
        compare: (left, right) => Number(left) - Number(right),
      });
      specs.push({
        key: 'enemy_diff_lv_add',
        label: t('currency.enemyDifficulty') as string,
        valuesOf: (entry) =>
          typeof entry.enemy_diff_lv_add === 'number' ? [String(entry.enemy_diff_lv_add)] : [],
        labelOf: (value) => `+${value}`,
        compare: (left, right) => Number(left) - Number(right),
      });
    }

    for (const field of FILTER_FIELDS) {
      const valuesOf = (entry: CurrencyEntry): readonly string[] => {
        const raw = entry[field];
        if (typeof raw === 'string' && raw !== '') return [raw];
        return typeof raw === 'number' ? [String(raw)] : [];
      };
      const values = [...new Set(all.flatMap(valuesOf))];
      if (values.length === 0) continue;
      specs.push({
        key: field,
        label: t(`currency.${field}` as 'currency.quality') as string,
        valuesOf,
        labelOf: (value) => currencyFieldName(t, field, value),
      });
    }
    return specs;
  }, [entries, kind, t]);

  const filterDefs = useMemo<readonly FilterDef[]>(
    () =>
      filterSpecs.map((spec) => ({
        key: spec.key,
        label: spec.label,
        options: sortValues(
          [...new Set((entries ?? []).flatMap((entry) => spec.valuesOf(entry)))],
          spec.compare,
        ).map((value) => ({ value, label: spec.labelOf(value) })),
      })),
    [filterSpecs, entries],
  );

  const filtered = useMemo(() => {
    const all = entries ?? [];
    return all.filter((entry) => {
      for (const spec of filterSpecs) {
        const chosen = filters[spec.key];
        if (!chosen || chosen === 'all') continue;
        if (!spec.valuesOf(entry).includes(chosen)) return false;
      }
      // 匹配的是**显示名**而不是数据里的原始名：搜「开拓者」要能命中三条
      // `{NICKNAME}`，搜「帕姆王」要能命中 name 为 null 的 604202。
      // `currencySearchNames` 还带四语言别名，所以切到英文界面也能用中文名搜到。
      const names = currencySearchNames(entry, kind, t);
      return matchesQuery(query.trim(), names, String(entry.id));
    });
  }, [entries, filters, query, filterSpecs, kind, t]);

  // 客户端的字典序排序与字母条都靠它取标题；稳定引用，否则每次渲染都重排（角色 138 / 装备 411）
  const titleOf = useCallback(
    (entry: CurrencyEntry) => currencyDisplayName(entry, kind, t),
    [kind, t],
  );

  // 主角光环是大卡，走不了 PagedGrid（一张卡要装标签/难度/羁绊/推荐角色），
  // 但「按首字拼音排」这条要跟其他图鉴一致，所以这里单独排一遍；它不需要字母条。
  const spotlightSorted = useMemo(
    () => (kind === 'spotlight' ? sortByIndex(filtered, titleOf, alphabetIndexFor(lang), lang).sorted : filtered),
    [filtered, titleOf, kind, lang],
  );

  // 羁绊 id → 能激活它的角色。一次遍历建表，避免每张卡片各自扫一遍角色列表。
  const traitMemberMap = useMemo(() => {
    const map = new Map<string, { members: CurrencyEntry[]; advisors: CurrencyEntry[] }>();
    for (const role of roleEntries) {
      const list = role.trait_list;
      if (!Array.isArray(list)) continue;
      for (const raw of list) {
        const key = String(raw);
        const bucket = map.get(key) ?? { members: [], advisors: [] };
        if (role.is_expert === true) bucket.advisors.push(role);
        else bucket.members.push(role);
        map.set(key, bucket);
      }
    }
    return map;
  }, [roleEntries]);

  return (
    <div className="flex flex-col gap-4 pt-2">
      <PageHeader
        title={title}
        description={t('currency.sub') as string}
        badge={t('nav.currency') as string}
        count={entries?.length}
        countLabel={t('currency.entryCount', { count: entries?.length ?? 0 }) as string}
        actions={
          <Link
            to="/currency"
            className="rounded-btn border border-line bg-elev px-3 py-1.5 text-xs text-dim hover:text-ink"
          >
            {t('currency.back') as string}
          </Link>
        }
      />

      {error ? (
        <ErrorState
          title={t(error.userMessageKey) as string}
          detail={`${error.code}\n${error.detail ?? error.message}`}
        />
      ) : null}
      {!entries && !error ? <SkeletonCardGrid columns={3} rows={2} /> : null}

      {entries ? (
        <div className="flex flex-col gap-4">
          {ratedHere ? null : <p className="text-xs text-dim">{t('currency.ratingHint') as string}</p>}
          <FilterBar
            query={query}
            onQueryChange={setQuery}
            filters={filterDefs}
            values={filters}
            onFilterChange={setFilter}
            total={filtered.length}
            allCount={entries.length}
            searchPlaceholder={t('list.searchPlaceholder') as string}
            allLabel={t('common.all') as string}
            countLabel={t('currency.entryCount', { count: filtered.length }) as string}
          />
          {kind === 'trait' ? (
            filtered.length === 0 ? (
              <div className="hsr-panel rounded-card border border-line p-8 text-center text-sm text-dim">
                {(entries.length === 0 ? t('currency.noEntries') : t('list.empty')) as string}
              </div>
            ) : (
              /* 羁绊不用通用小卡：它要按激活人数分档、列成员与顾问，原站也是两列大卡 */
              <div className="grid gap-3 md:grid-cols-2">
                {filtered.map((entry) => {
                  const bucket = traitMemberMap.get(String(entry.id)) ?? { members: [], advisors: [] };
                  return (
                    <TraitCard
                      key={String(entry.id)}
                      entry={entry}
                      members={bucket.members}
                      advisors={bucket.advisors}
                      actions={
                        <div className="flex items-center gap-1">
                          <RatingBadge kind={kind} id={String(entry.id)} variant="tier" />
                          <RatingBadge kind={kind} id={String(entry.id)} />
                        </div>
                      }
                      onContextMenu={(event) => openCurrencyMenu(entry, kind, t, event)}
                    />
                  );
                })}
              </div>
            )
          ) : kind === 'spotlight' ? (
            filtered.length === 0 ? (
              <div className="hsr-panel rounded-card border border-line p-8 text-center text-sm text-dim">
                {(entries.length === 0 ? t('currency.noEntries') : t('list.empty')) as string}
              </div>
            ) : (
              /* 主角光环同样不用通用小卡：一张卡要装标签 + 难度 + 备注 + 羁绊层级 + 推荐角色，
                 原站用的是 md 两列 / xl 三列的大卡（sm 单列） */
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {spotlightSorted.map((entry) => {
                  const id = String(entry.id);
                  // `trait_id` 为 0 表示这条光环不挂羁绊：只有 > 0 才拿去查表，
                  // 否则会组装出 `'0'` 这种必然查不到的键（实现与注释保持一致）
                  const traitId =
                    typeof entry.trait_id === 'number' && entry.trait_id > 0
                      ? String(entry.trait_id)
                      : '';
                  return (
                    <SpotlightCard
                      key={id}
                      entry={entry}
                      trait={traitById.get(traitId)}
                      roleLabelOf={roleLabelOf}
                      infoLabelOf={infoLabelOf}
                      onOpen={() => setSelected(entry)}
                      actions={
                        <div className="flex items-center gap-1">
                          <RatingBadge kind={kind} id={id} variant="tier" />
                          <RatingBadge kind={kind} id={id} />
                        </div>
                      }
                      onContextMenu={(event) => openCurrencyMenu(entry, kind, t, event)}
                    />
                  );
                })}
              </div>
            )
          ) : (
            <PagedGrid
              items={filtered}
              resetKey={resetKey}
              keyOf={(entry) => String(entry.id)}
              titleOf={titleOf}
              emptyLabel={(entries.length === 0 ? t('currency.noEntries') : t('list.empty')) as string}
              renderItem={(entry) => (
                <EntryCardButton
                  entry={entry}
                  kind={kind}
                  infoLabelOf={infoLabelOf}
                  onOpen={() => {
                    // 角色有独立详情页（原站 `/currency/role/:id`），其余图鉴仍是页内弹层：
                    // 装备 / 增益这类条目字段少，弹层够用，没必要为它们各开一条路由。
                    if (kind === 'role') navigate(`/currency/role/${String(entry.id)}`);
                    else setSelected(entry);
                  }}
                />
              )}
            />
          )}
        </div>
      ) : null}

      {selected ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setSelected(null)}
          role="presentation"
        >
          <div
            className="hsr-panel max-h-[85vh] w-full max-w-3xl overflow-auto rounded-card border border-line p-5"
            onClick={(event) => event.stopPropagation()}
            role="presentation"
          >
            <CurrencyDetail
              entry={selected}
              kind={kind}
              trait={selectedTrait}
              roleLabelOf={roleLabelOf}
              infoLabelOf={infoLabelOf}
              onClose={() => setSelected(null)}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 路由分派                                                            */
/* ------------------------------------------------------------------ */

export default function CurrencyPage(): ReactNode {
  const { kind } = useParams<{ kind?: string }>();
  if (kind === undefined || kind === '') return <EntryView />;
  if (!isCurrencyKind(kind)) return <InvalidKindView />;
  return <CodexView kind={kind} />;
}
