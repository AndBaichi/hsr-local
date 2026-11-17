/**
 * 全局搜索页（PRD §4.2 页面 13 / T05）
 *
 * 覆盖 **9 个资料库**：角色 / 光锥 / 遗器 / 敌人 / 物品 / 成就系列（来自启动索引，同步）
 * + 更新日志 / 高难内容 / 货币战争（来自 `searchExtras` 的异步聚合）。
 *
 * ## 三级筛选
 *
 * 1. **资料库按钮**（一级）：全部模块 + 九个库，单选。
 * 2. **图鉴按钮**（二级，仅「货币战争」）：全部图鉴 + 六个图鉴，单选。
 * 3. **普通筛选器**（三级）：选中具体资料库后出现，字段随资料库变化；
 *    货币战争下还要再选到具体图鉴，因为六个图鉴的字段差异极大。
 *
 * ## 筛选值互相独立
 *
 * 每个资料库的普通筛选器各存各的键（`character.rarity`、`lightcone.path`、
 * `currency.role.quality` …），**切换资料库不会清空别人的筛选**，切回去还是原样；
 * 只有重启应用才重置（整页状态都在进程内 store 里）。
 *
 * ## 结果按分类折叠
 *
 * 结果按分类分组，每组一个可折叠区块（默认展开），组与组之间各占一行。
 * 单组最多渲染 `MAX_PER_GROUP` 条，超出时在组尾如实说明「共 N 条」。
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';

import { EntityCard, EntityGrid } from '@/components/common/EntityGrid';
import { PagePlaceholder } from '@/components/common/PagePlaceholder';
import { SkeletonCardGrid } from '@/components/common/SkeletonBlock';
import { PageHeader } from '@/components/layout/PageHeader';
import { useListState } from '@/hooks/useListState';
import type { Lang } from '@/i18n';
import { ELEMENT_TYPES, PATH_TYPES } from '@/i18n/enums';
import { dal } from '@/lib/data/dal';
import {
  CURRENCY_KINDS,
  currencyDisplayName,
  currencyNameAliases,
  seasonName,
  type CurrencyKind,
  type DiffItem,
  type EndgameMode,
} from '@/lib/data/extra';
import { EMPTY_EXTRAS, currencyEntryIcon, loadSearchExtras, type SearchExtras } from '@/lib/data/searchExtras';
import type { LocalizedNames, IndexModuleKey } from '@/lib/data/types';
import {
  currencyFieldName,
  elementName,
  itemTypeName,
  monsterRankName,
  pathName,
  rarityName,
} from '@/lib/labels';
import { pickName } from '@/lib/userdata/types';
import { useSettingsStore } from '@/stores/settings';

/**
 * ATTIC：T01 骨架占位组件本页已不再渲染，但按「先不删、把不用的放一边」的要求
 * 保留 import 引用，待全局搜索功能验收通过后再决定去留。parked, not deleted.
 */
export const ATTIC_SearchPagePlaceholder = PagePlaceholder;

/** 六个索引类资料库（顺序与 getIndex 键一致） */
const MODULES: readonly IndexModuleKey[] = [
  'character',
  'lightcone',
  'relicset',
  'monster',
  'item',
  'achievementSeries',
];

/** 九个资料库的完整顺序（前六个来自索引，后三个来自 searchExtras） */
const LIBRARIES: readonly LibraryKey[] = [...MODULES, 'changelog', 'endgame', 'currency'];

/** 资料库标识 */
type LibraryKey = IndexModuleKey | 'changelog' | 'endgame' | 'currency';

/** 一级筛选值 */
type LibraryFilter = LibraryKey | 'all';

/** 资料库 → 按钮/分组标题的 i18n key */
const LIBRARY_LABEL_KEY = {
  character: 'search.groupCharacter',
  lightcone: 'search.groupLightcone',
  relicset: 'search.groupRelicset',
  monster: 'search.groupMonster',
  item: 'search.groupItem',
  achievementSeries: 'search.groupAchievementSeries',
  changelog: 'nav.changelog',
  endgame: 'nav.endgame',
  currency: 'nav.currency',
} as const satisfies Record<LibraryKey, string>;

/** 终局四子栏目 → i18n key */
const ENDGAME_LABEL_KEY = {
  maze: 'endgame.endgameMoc',
  story: 'endgame.endgamePf',
  boss: 'endgame.endgameAs',
  peak: 'endgame.endgamePeak',
} as const satisfies Record<string, string>;

/** 图鉴三级筛选可用的字段（与图鉴页一致：只取「确实有值」的字段） */
const CURRENCY_FILTER_FIELDS = ['quality', 'category', 'rarity'] as const;

/** 单个分类最多渲染多少条（超出部分只报总数，避免上千张卡片同时挂载） */
const MAX_PER_GROUP = 60;

/** 普通筛选器定义 */
interface SearchFilterDef {
  /** 筛选键（去掉资料库前缀后的字段名） */
  readonly key: string;
  /** 已翻译的组名 */
  readonly label: string;
  /** 可选项（不含「全部」，渲染层补） */
  readonly options: readonly { readonly value: string; readonly label: string }[];
}

/** 一条搜索结果 */
interface SearchResult {
  /** 所属资料库 */
  readonly library: LibraryKey;
  /** 分组键（货币战争按图鉴再分） */
  readonly groupKey: string;
  /** 分组显示名 */
  readonly groupLabel: string;
  /** 实体 id / groupKey / 赛季 id */
  readonly id: string;
  /** 显示名 */
  readonly name: string;
  /** 图标（可缺） */
  readonly icon?: string | null;
  /** 稀有度（星级） */
  readonly rarity?: number;
  /** 副标题（类型 / 阶级 / 状态…） */
  readonly subtitle?: string;
  /** 点击跳转 */
  readonly to: string;
}

/** 一个可折叠的结果分类 */
interface ResultGroup {
  readonly key: string;
  readonly label: string;
  /** 该类真实命中总数（可能大于 items.length） */
  readonly total: number;
  readonly items: readonly SearchResult[];
}

/** 取资料库的显示名 */
function libraryLabel(t: TFunction, library: LibraryKey): string {
  return t(LIBRARY_LABEL_KEY[library] as 'search.groupCharacter');
}

/** 取图鉴的显示名 */
function currencyKindLabel(t: TFunction, kind: CurrencyKind): string {
  const navKey = CURRENCY_KINDS.find((entry) => entry.key === kind)?.navKey ?? 'currencyRole';
  return t(`currency.${navKey}` as 'currency.currencyRole');
}

/** 取终局子栏目的显示名 */
function endgameModeLabel(t: TFunction, mode: EndgameMode): string {
  return t(ENDGAME_LABEL_KEY[mode]);
}

/**
 * 普通筛选器在 store 里的键名。
 *
 * 键必须带资料库前缀，否则「切到光锥再切回角色」会把稀有度筛选带过去。
 * 货币战争还要再带一层图鉴名：六个图鉴的取值域完全不同（角色有稀有度、
 * 投资环境有品质、策略有分类），共用一个键会互相污染。
 *
 * @param library 当前资料库
 * @param currencyKind 当前图鉴（非货币战争时可忽略）
 * @param key 筛选字段名
 */
function filterKey(
  library: LibraryKey,
  currencyKind: CurrencyKind | 'all',
  key: string,
): string {
  if (library !== 'currency') return `${library}.${key}`;
  return `currency.${currencyKind}.${key}`;
}

/** 更新日志状态 → 显示名 */
function diffStatusLabel(t: TFunction, status: DiffItem['status']): string {
  if (status === 'added') return t('changelog.statusAdded');
  if (status === 'removed') return t('changelog.statusRemoved');
  return t('changelog.statusChanged');
}

/** 命中规则：任一候选串包含 needle（忽略大小写，null/undefined 跳过） */
function anyMatches(needle: string, candidates: readonly (string | null | undefined)[]): boolean {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.toLocaleLowerCase().includes(needle)) return true;
  }
  return false;
}

/** 命中规则（四语言名） */
function namesMatch(needle: string, names: LocalizedNames | undefined): boolean {
  if (names === undefined) return false;
  for (const value of Object.values(names)) {
    if (typeof value === 'string' && value.toLocaleLowerCase().includes(needle)) return true;
  }
  return false;
}

/**
 * 判断某个字符串是否是合法资料库筛选值。
 *
 * @param value 待判定值（来自 store，可能为空/脏值）
 */
function isLibraryFilter(value: string | undefined): value is LibraryFilter {
  return value === 'all' || (value !== undefined && (LIBRARIES as readonly string[]).includes(value));
}

/**
 * 判断某个字符串是否是合法图鉴筛选值。
 *
 * @param value 待判定值
 */
function isCurrencyKindFilter(value: string | undefined): value is CurrencyKind | 'all' {
  return (
    value === 'all' ||
    (value !== undefined && CURRENCY_KINDS.some((entry) => entry.key === value))
  );
}

/**
 * 普通筛选器（三级）定义，随资料库（及图鉴）变化。
 *
 * @param library 当前资料库
 * @param currencyKind 货币战争下选中的图鉴（`all` 表示全部）
 * @param extras 附加数据（货币图鉴的字段值要从条目里现取）
 * @param t 翻译函数
 */
function buildFilterDefs(
  library: LibraryFilter,
  currencyKind: CurrencyKind | 'all',
  extras: SearchExtras,
  t: TFunction,
): readonly SearchFilterDef[] {
  switch (library) {
    case 'character':
      return [
        {
          key: 'rarity',
          label: t('list.filterRarity'),
          options: [5, 4].map((value) => ({ value: String(value), label: '★'.repeat(value) })),
        },
        {
          key: 'path',
          label: t('list.filterPath'),
          options: PATH_TYPES.map((value) => ({ value, label: pathName(t, value) })),
        },
        {
          key: 'element',
          label: t('list.filterElement'),
          options: ELEMENT_TYPES.map((value) => ({ value, label: elementName(t, value) })),
        },
      ];

    case 'lightcone':
      return [
        {
          key: 'rarity',
          label: t('list.filterRarity'),
          options: [5, 4, 3].map((value) => ({ value: String(value), label: '★'.repeat(value) })),
        },
        {
          key: 'path',
          label: t('list.filterPath'),
          options: PATH_TYPES.map((value) => ({ value, label: pathName(t, value) })),
        },
      ];

    case 'relicset':
      return [
        {
          key: 'kind',
          label: t('list.filterKind'),
          options: [
            { value: 'cavern', label: t('list.kindCavern') },
            { value: 'planar', label: t('list.kindPlanar') },
          ],
        },
      ];

    case 'monster': {
      const ranks = [...new Set(dal.getIndex('monster').map((entry) => entry.rank).filter(Boolean))].sort();
      return [
        {
          key: 'rank',
          label: t('list.filterRank'),
          options: ranks.map((value) => ({ value, label: monsterRankName(t, value) })),
        },
        {
          key: 'weak',
          label: t('list.filterWeak'),
          options: ELEMENT_TYPES.map((value) => ({ value, label: elementName(t, value) })),
        },
      ];
    }

    case 'item': {
      const mainTypes = [...new Set(dal.getIndex('item').map((entry) => entry.mainType).filter(Boolean))].sort();
      return [
        {
          key: 'rarity',
          label: t('list.filterRarity'),
          options: [5, 4, 3, 2, 1].map((value) => ({ value: String(value), label: '★'.repeat(value) })),
        },
        {
          key: 'mainType',
          label: t('list.filterMainType'),
          options: mainTypes.map((value) => ({ value, label: itemTypeName(t, value) })),
        },
      ];
    }

    case 'changelog':
      return [
        {
          key: 'entity',
          label: t('list.filterKind'),
          options: [
            { value: 'character', label: t('changelog.entityCharacter') },
            { value: 'lightcone', label: t('changelog.entityLightcone') },
            { value: 'relic', label: t('changelog.entityRelic') },
          ],
        },
        {
          key: 'status',
          label: t('changelog.status'),
          options: [
            { value: 'added', label: t('changelog.statusAdded') },
            { value: 'removed', label: t('changelog.statusRemoved') },
            { value: 'changed', label: t('changelog.statusChanged') },
          ],
        },
      ];

    case 'currency': {
      // 只有选到具体图鉴才有筛选可言：六个图鉴的字段差异极大，混在一起筛没有意义
      if (currencyKind === 'all') return [];
      const entries = extras.currency.find((group) => group.kind === currencyKind)?.entries ?? [];
      const defs: SearchFilterDef[] = [];
      for (const field of CURRENCY_FILTER_FIELDS) {
        const values = [
          ...new Set(
            entries
              .map((entry) => {
                const raw = entry[field];
                return typeof raw === 'string' && raw !== ''
                  ? raw
                  : typeof raw === 'number'
                    ? String(raw)
                    : '';
              })
              .filter((value) => value !== ''),
          ),
        ].sort();
        if (values.length === 0) continue;
        defs.push({
          key: field,
          label: t(`currency.${field}` as 'currency.quality'),
          options: values.map((value) => ({
            value,
            // 稀有度在图鉴里是 1–5 的数字，下拉里显示成星比显示成「5」更容易扫读；
            // 其他字段（品质 / 分类）是英文枚举，交给 currencyFieldName 映射
            label:
              field === 'rarity' && Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 5
                ? '★'.repeat(Number(value))
                : currencyFieldName(t, field, value),
          })),
        });
      }
      return defs;
    }

    default:
      // achievementSeries / endgame：索引与赛季数据里没有值得单独筛的字段
      return [];
  }
}

/**
 * 遍历九个资料库，按关键词 + 两级筛选过滤并分组。
 *
 * @param query 搜索词
 * @param library 一级筛选（资料库）
 * @param filters 全部筛选值（普通筛选器的键带资料库前缀）
 * @param extras 附加数据
 * @param lang 当前语言
 * @param t 翻译函数
 * @param ready 基础索引是否就绪
 * @param extrasReady 附加数据是否已加载
 */
function buildGroups(
  query: string,
  library: LibraryFilter,
  filters: Readonly<Record<string, string>>,
  extras: SearchExtras,
  lang: Lang,
  t: TFunction,
  ready: boolean,
  extrasReady: boolean,
): readonly ResultGroup[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!ready || needle === '') return [];

  const groups = new Map<string, { label: string; total: number; items: SearchResult[] }>();

  const push = (result: SearchResult): void => {
    const group = groups.get(result.groupKey) ?? { label: result.groupLabel, total: 0, items: [] };
    group.total += 1;
    if (group.items.length < MAX_PER_GROUP) group.items.push(result);
    groups.set(result.groupKey, group);
  };

  /** 取某个筛选键的有效值（空 / all 视为未筛选） */
  const pick = (key: string): string | undefined => {
    const value = filters[key];
    return value === undefined || value === '' || value === 'all' ? undefined : value;
  };

  /** 该资料库是否在本次搜索范围内 */
  const wanted = (key: LibraryKey): boolean => library === 'all' || library === key;

  for (const module of MODULES) {
    if (!wanted(module)) continue;
    const groupKey = module;
    const groupLabel = libraryLabel(t, module);

    switch (module) {
      case 'character': {
        const rarity = pick('character.rarity');
        const path = pick('character.path');
        const element = pick('character.element');
        for (const row of dal.getIndex('character')) {
          const id = row.id ?? '';
          if (!anyMatches(needle, [id, row.name]) && !namesMatch(needle, row.names)) continue;
          if (rarity !== undefined && String(row.rarity) !== rarity) continue;
          if (path !== undefined && row.path !== path) continue;
          if (element !== undefined && row.element !== element) continue;
          push({
            library: 'character',
            groupKey,
            groupLabel,
            id,
            name: pickName(row.names ?? {}, lang, row.name || id),
            icon: row.icon,
            rarity: row.rarity,
            subtitle: [pathName(t, row.path), elementName(t, row.element)]
              .filter((part) => part !== '')
              .join(' · '),
            to: `/characters/${encodeURIComponent(id)}`,
          });
        }
        break;
      }

      case 'lightcone': {
        const rarity = pick('lightcone.rarity');
        const path = pick('lightcone.path');
        for (const row of dal.getIndex('lightcone')) {
          const id = row.id ?? '';
          if (!anyMatches(needle, [id, row.name]) && !namesMatch(needle, row.names)) continue;
          if (rarity !== undefined && String(row.rarity) !== rarity) continue;
          if (path !== undefined && row.path !== path) continue;
          push({
            library: 'lightcone',
            groupKey,
            groupLabel,
            id,
            name: pickName(row.names ?? {}, lang, row.name || id),
            icon: row.icon,
            rarity: row.rarity,
            subtitle: rarityName(t, row.rarity),
            to: `/lightcones/${encodeURIComponent(id)}`,
          });
        }
        break;
      }

      case 'relicset': {
        const kind = pick('relicset.kind');
        for (const row of dal.getIndex('relicset')) {
          const id = row.id ?? '';
          if (!anyMatches(needle, [id, row.name]) && !namesMatch(needle, row.names)) continue;
          if (kind !== undefined && row.kind !== kind) continue;
          push({
            library: 'relicset',
            groupKey,
            groupLabel,
            id,
            name: pickName(row.names ?? {}, lang, row.name || id),
            icon: row.icon,
            subtitle:
              row.kind === 'cavern'
                ? t('list.kindCavern')
                : row.kind === 'planar'
                  ? t('list.kindPlanar')
                  : row.kind,
            to: `/relics/${encodeURIComponent(id)}`,
          });
        }
        break;
      }

      case 'monster': {
        const rank = pick('monster.rank');
        const weak = pick('monster.weak');
        for (const row of dal.getIndex('monster')) {
          // 敌人索引没有 id/name：groupKey 既是匹配键也是详情路由键
          const id = row.groupKey ?? '';
          if (!anyMatches(needle, [id]) && !namesMatch(needle, row.names)) continue;
          if (rank !== undefined && row.rank !== rank) continue;
          if (weak !== undefined && !row.weak.includes(weak)) continue;
          push({
            library: 'monster',
            groupKey,
            groupLabel,
            id,
            name: pickName(row.names ?? {}, lang, id),
            icon: row.icon,
            subtitle: monsterRankName(t, row.rank),
            to: `/monsters/${encodeURIComponent(id)}`,
          });
        }
        break;
      }

      case 'item': {
        const rarity = pick('item.rarity');
        const mainType = pick('item.mainType');
        for (const row of dal.getIndex('item')) {
          const id = row.id ?? '';
          if (!anyMatches(needle, [id]) && !namesMatch(needle, row.names)) continue;
          if (rarity !== undefined && String(row.rarity) !== rarity) continue;
          if (mainType !== undefined && row.mainType !== mainType) continue;
          push({
            library: 'item',
            groupKey,
            groupLabel,
            id,
            name: pickName(row.names ?? {}, lang, id),
            icon: row.icon,
            rarity: row.rarity,
            subtitle: itemTypeName(t, row.subType),
            to: `/items/${encodeURIComponent(id)}`,
          });
        }
        break;
      }

      case 'achievementSeries':
        for (const row of dal.getIndex('achievementSeries')) {
          const id = row.id ?? '';
          if (!anyMatches(needle, [id, row.name])) continue;
          push({
            library: 'achievementSeries',
            groupKey,
            groupLabel,
            id,
            name: row.name ?? id,
            subtitle: t('common.count', { count: row.itemCount }),
            to: '/achievements',
          });
        }
        break;
    }
  }

  // ---- 更新日志 ----
  if (extrasReady && wanted('changelog')) {
    const entity = pick('changelog.entity');
    const status = pick('changelog.status');
    const groupLabel = libraryLabel(t, 'changelog');
    // `diff.json` 里的 `icon` 是**源站路径**（如 `avatarshopicon/1015.webp`），
    // 包内根本没有这个目录；必须回索引按 id 取 `img/...`。已下架的实体（status=removed）
    // 查不到就留空，让 SafeImage 走占位，而不是给每一行都报一次缺图。
    const iconMaps = {
      character: new Map(dal.getIndex('character').map((row) => [row.id, row.icon])),
      lightcone: new Map(dal.getIndex('lightcone').map((row) => [row.id, row.icon])),
      relic: new Map(dal.getIndex('relicset').map((row) => [row.id, row.icon])),
    };
    for (const item of extras.changelog) {
      if (!anyMatches(needle, [item.id, item.name, item.beforeName, item.afterName])) continue;
      if (entity !== undefined && item.entity !== entity) continue;
      if (status !== undefined && item.status !== status) continue;
      const to =
        item.entity === 'character'
          ? `/characters/${encodeURIComponent(item.id)}`
          : item.entity === 'lightcone'
            ? `/lightcones/${encodeURIComponent(item.id)}`
            : `/relics/${encodeURIComponent(item.id)}`;
      push({
        library: 'changelog',
        groupKey: 'changelog',
        groupLabel,
        id: item.id,
        name: item.name,
        icon: iconMaps[item.entity].get(item.id) ?? null,
        rarity: item.rarity,
        subtitle: diffStatusLabel(t, item.status),
        to,
      });
    }
  }

  // ---- 高难内容（按四个子栏目分组）----
  if (extrasReady && wanted('endgame')) {
    for (const { mode, seasons } of extras.endgame) {
      const groupLabel = endgameModeLabel(t, mode);
      for (const season of seasons) {
        const id = String(season.id);
        const name = seasonName(season, lang, t('endgame.season'));
        if (!anyMatches(needle, [id, name, season.zh, season.en, season.ja, season.ko])) continue;
        push({
          library: 'endgame',
          groupKey: `endgame:${mode}`,
          groupLabel,
          id,
          name,
          subtitle: season.begin ? season.begin.slice(0, 10) : undefined,
          to: `/endgame/${mode}/${encodeURIComponent(id)}`,
        });
      }
    }
  }

  // ---- 货币战争（二级：图鉴；按图鉴分组）----
  if (extrasReady && wanted('currency')) {
    const kindFilter = pick('currency.kind');
    for (const { kind, entries } of extras.currency) {
      if (kindFilter !== undefined && kind !== kindFilter) continue;
      const kindLabel = currencyKindLabel(t, kind);
      const groupLabel = `${libraryLabel(t, 'currency')} · ${kindLabel}`;
      const groupKey = `currency:${kind}`;
      const rarity = pick(filterKey('currency', kind, 'rarity'));
      const quality = pick(filterKey('currency', kind, 'quality'));
      const category = pick(filterKey('currency', kind, 'category'));

      for (const entry of entries) {
        const id = String(entry.id);
        // 显示名走统一入口：`{NICKNAME}` → 开拓者、`604202`（name 为 null）→ 帕姆王
        const name = currencyDisplayName(entry, kind, t);
        // 别名（四语言写法）一并参与匹配：界面是英文时输入「帕姆王」也要能找到
        if (!anyMatches(needle, [id, name, ...currencyNameAliases(entry, kind)])) continue;
        if (rarity !== undefined && String(entry.rarity ?? '') !== rarity) continue;
        if (quality !== undefined && String(entry.quality ?? '') !== quality) continue;
        if (category !== undefined && String(entry.category ?? '') !== category) continue;
        push({
          library: 'currency',
          groupKey,
          groupLabel,
          id,
          name,
          icon: currencyEntryIcon(entry, kind),
          rarity: typeof entry.rarity === 'number' ? entry.rarity : undefined,
          subtitle: kindLabel,
          // 角色有独立详情页（v2.5）；其余图鉴没有单条路由，跳到图鉴并用 `?entry=` 打开该条
          to:
            kind === 'role'
              ? `/currency/role/${encodeURIComponent(id)}`
              : `/currency/${kind}?entry=${encodeURIComponent(id)}`,
        });
      }
    }
  }

  return [...groups.entries()].map(([key, group]) => ({
    key,
    label: group.label,
    total: group.total,
    items: group.items,
  }));
}

export default function SearchPage(): ReactNode {
  const { t } = useTranslation();
  const lang = useSettingsStore((state) => state.prefs.lang);
  const location = useLocation();
  const inputRef = useRef<HTMLInputElement>(null);
  // 搜索词 + 全部筛选值都在进程内 store：切页面不丢，重启重置
  const { query, setQuery, filters, setFilter } = useListState('search');

  const [extras, setExtras] = useState<SearchExtras | undefined>(undefined);
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(new Set());

  const ready = dal.meta !== undefined;
  const hasQuery = query.trim() !== '';
  const library: LibraryFilter = isLibraryFilter(filters.library) ? filters.library : 'all';
  const currencyKind: CurrencyKind | 'all' = isCurrencyKindFilter(filters['currency.kind'])
    ? (filters['currency.kind'] as CurrencyKind | 'all')
    : 'all';
  const extrasReady = extras !== undefined;
  const source = extras ?? EMPTY_EXTRAS;

  // Ctrl+K / `/` 从 TopBar 带着 { focusSearch:true } 跳来时（含重复触发）把焦点交还输入框
  useEffect(() => {
    const state = location.state as { focusSearch?: boolean } | null;
    if (state?.focusSearch) inputRef.current?.focus();
  }, [location.key, location.state]);

  // 附加数据（更新日志 / 高难内容 / 货币战争）：按语言加载一次，失败退回空集
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    setExtras(undefined);
    void loadSearchExtras(lang)
      .then((value) => {
        if (!cancelled) setExtras(value);
      })
      .catch(() => {
        if (!cancelled) setExtras(EMPTY_EXTRAS);
      });
    return () => {
      cancelled = true;
    };
  }, [lang, ready]);

  const filterDefs = useMemo(
    () => buildFilterDefs(library, currencyKind, source, t),
    [library, currencyKind, source, t],
  );

  const groups = useMemo(
    () => buildGroups(query, library, filters, source, lang, t, ready, extrasReady),
    [query, library, filters, source, lang, t, ready, extrasReady],
  );

  const total = groups.reduce((sum, group) => sum + group.total, 0);

  /** 切换某个筛选值（键已带资料库前缀，各库互不干扰） */
  const chooseFilter = (key: string, value: string): void => {
    setFilter(key, value);
  };

  return (
    <div className="flex flex-col gap-4 pt-2">
      <PageHeader
        title={t('search.title')}
        count={hasQuery ? total : undefined}
        countLabel={t('search.resultCount', { count: total })}
      />

      <div className="flex flex-col gap-3">
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setQuery('');
          }}
          placeholder={t('search.placeholder')}
          aria-label={t('search.placeholder')}
          autoFocus
          className="h-9 w-full rounded-btn border border-line bg-elev px-3 text-sm text-ink outline-none placeholder:text-dim focus:border-accent"
        />

        {/* 一级：资料库按钮 */}
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('common.module')}>
          <button
            type="button"
            aria-pressed={library === 'all'}
            onClick={() => chooseFilter('library', 'all')}
            className={`rounded-btn border px-3 py-1.5 text-xs ${
              library === 'all'
                ? 'border-accent bg-elev text-accent'
                : 'border-line bg-elev text-dim hover:text-ink'
            }`}
          >
            {t('search.allModules')}
          </button>
          {LIBRARIES.map((entry) => (
            <button
              key={entry}
              type="button"
              aria-pressed={library === entry}
              onClick={() => chooseFilter('library', entry)}
              className={`rounded-btn border px-3 py-1.5 text-xs ${
                library === entry
                  ? 'border-accent bg-elev text-accent'
                  : 'border-line bg-elev text-dim hover:text-ink'
              }`}
            >
              {libraryLabel(t, entry)}
            </button>
          ))}
        </div>

        {/* 二级：图鉴按钮（仅货币战争） */}
        {library === 'currency' ? (
          <div
            className="flex flex-wrap items-center gap-2 border-l-2 border-line pl-3"
            role="group"
            aria-label={t('nav.currency')}
          >
            <button
              type="button"
              aria-pressed={currencyKind === 'all'}
              onClick={() => chooseFilter('currency.kind', 'all')}
              className={`rounded-btn border px-2.5 py-1 text-[11px] ${
                currencyKind === 'all'
                  ? 'border-accent bg-elev text-accent'
                  : 'border-line bg-elev text-dim hover:text-ink'
              }`}
            >
              {t('search.allKinds')}
            </button>
            {CURRENCY_KINDS.map((entry) => (
              <button
                key={entry.key}
                type="button"
                aria-pressed={currencyKind === entry.key}
                onClick={() => chooseFilter('currency.kind', entry.key)}
                className={`rounded-btn border px-2.5 py-1 text-[11px] ${
                  currencyKind === entry.key
                    ? 'border-accent bg-elev text-accent'
                    : 'border-line bg-elev text-dim hover:text-ink'
                }`}
              >
                {currencyKindLabel(t, entry.key)}
              </button>
            ))}
          </div>
        ) : null}

        {/* 三级：普通筛选器（键带资料库前缀，各库独立记忆） */}
        {library !== 'all' && filterDefs.length > 0 ? (
          <div className="flex flex-wrap items-center gap-3 border-l-2 border-line pl-3">
            {filterDefs.map((def) => (
              <label key={def.key} className="flex items-center gap-1.5 text-xs text-dim">
                <span>{def.label}</span>
                <select
                  value={filters[filterKey(library, currencyKind, def.key)] ?? 'all'}
                  onChange={(event) =>
                    chooseFilter(filterKey(library, currencyKind, def.key), event.target.value)
                  }
                  className="h-9 rounded-btn border border-line bg-elev px-2 text-sm text-ink outline-none focus:border-accent"
                >
                  <option value="all">{t('list.all')}</option>
                  {def.options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        ) : null}
      </div>

      {!ready ? (
        <SkeletonCardGrid columns={3} rows={2} />
      ) : !hasQuery ? (
        <div className="hsr-panel rounded-card border border-line p-8 text-center text-sm text-dim">
          {t('search.noQuery')}
        </div>
      ) : !extrasReady && (library === 'all' || library === 'changelog' || library === 'endgame' || library === 'currency') ? (
        <p className="text-xs text-dim">{t('search.loadingExtra')}</p>
      ) : null}

      {hasQuery && groups.length === 0 && ready && extrasReady ? (
        <div className="hsr-panel rounded-card border border-line p-8 text-center text-sm text-dim">
          {t('search.noResults')}
        </div>
      ) : null}

      {/* 结果：每个分类一行，可折叠 */}
      {hasQuery ? (
        <div className="flex flex-col gap-3">
          {groups.map((group) => {
            const collapsed = collapsedGroups.has(group.key);
            return (
              <section key={group.key} className="hsr-panel rounded-card border border-line">
                <button
                  type="button"
                  onClick={() =>
                    setCollapsedGroups((previous) => {
                      const next = new Set(previous);
                      if (next.has(group.key)) next.delete(group.key);
                      else next.add(group.key);
                      return next;
                    })
                  }
                  aria-expanded={!collapsed}
                  className="flex w-full items-center gap-2 px-4 py-3 text-left"
                >
                  <span className={`text-xs transition-transform duration-fast ${collapsed ? '' : 'rotate-90'}`}>
                    ▸
                  </span>
                  <span className="text-sm font-semibold text-ink">{group.label}</span>
                  <span className="rounded-tag border border-line bg-elev px-1.5 py-[1px] text-[11px] text-dim">
                    {t('search.resultCount', { count: group.total })}
                  </span>
                </button>
                {collapsed ? null : (
                  <div className="border-t border-line p-4">
                    <EntityGrid>
                      {group.items.map((item) => (
                        <EntityCard
                          key={`${item.library}:${item.id}`}
                          to={item.to}
                          title={item.name}
                          subtitle={item.subtitle}
                          icon={item.icon}
                          rarity={item.rarity}
                          squareIcon={
                            item.library === 'relicset' ||
                            item.library === 'monster' ||
                            item.library === 'item' ||
                            item.library === 'changelog'
                          }
                        />
                      ))}
                    </EntityGrid>
                    {group.total > group.items.length ? (
                      <p className="mt-3 text-xs text-dim">
                        {t('search.partialCount', {
                          shown: group.items.length,
                          total: group.total,
                        })}
                      </p>
                    ) : null}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
