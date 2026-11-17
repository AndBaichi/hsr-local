/**
 * 敌人列表页（PRD §4.2 页面 8）
 *
 * 索引是**按组聚合**的 382 组（不是 666 个变体）。详情路由带 `groupKey`，
 * 收藏键也用 `groupKey`——用 `primaryId` 会让「从列表收藏」和「从详情收藏」对不上。
 */

import { useCallback, useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { EntityCard } from '@/components/common/EntityGrid';
import { FilterBar, PagedGrid, type FilterDef } from '@/components/common/ListControls';
import { PageHeader } from '@/components/layout/PageHeader';
import { useListState, matchesQuery } from '@/hooks/useListState';
import { ELEMENT_TYPES } from '@/i18n/enums';
import { dal } from '@/lib/data/dal';
import type { MonsterBrief } from '@/lib/data/types';
import { localizedName } from '@/lib/format';
import { elementName, monsterRankName } from '@/lib/labels';
import { useSettingsStore } from '@/stores/settings';

export default function MonsterListPage(): ReactNode {
  const { t } = useTranslation();
  const lang = useSettingsStore((state) => state.prefs.lang);
  const { query, setQuery, filters, setFilter, resetKey } = useListState('monsters');
  const all = dal.getIndex('monster');

  const ranks = useMemo(() => [...new Set(all.map((entry) => entry.rank).filter(Boolean))].sort(), [all]);

  const filterDefs = useMemo<readonly FilterDef[]>(
    () => [
      { key: 'rank', label: t('list.filterRank'), options: ranks.map((value) => ({ value, label: monsterRankName(t, value) })) },
      {
        key: 'weak',
        label: t('list.filterWeak'),
        options: ELEMENT_TYPES.map((value) => ({ value, label: elementName(t, value) })),
      },
    ],
    [t, ranks],
  );

  const items = useMemo(
    () =>
      all.filter((entry) => {
        if (filters.rank && filters.rank !== 'all' && entry.rank !== filters.rank) return false;
        if (filters.weak && filters.weak !== 'all' && !entry.weak.includes(filters.weak)) return false;
        return matchesQuery(query.trim(), entry.names, entry.groupKey);
      }),
    [all, filters, query],
  );

  // 稳定引用：PagedGrid 用它排序，每次渲染换新函数会重排整张表
  const titleOf = useCallback(
    (entry: MonsterBrief) => localizedName(entry.names, lang, entry.groupKey),
    [lang],
  );

  return (
    <div className="flex flex-col gap-4 pt-2">
      <PageHeader
        title={t('nav.monsters')}
        count={all.length}
        countLabel={t('common.count', { count: all.length })}
        badge={dal.meta?.gameVersion}
      />
      <FilterBar
        query={query}
        onQueryChange={setQuery}
        filters={filterDefs}
        values={filters}
        onFilterChange={setFilter}
        total={items.length}
        allCount={all.length}
        searchPlaceholder={t('list.searchPlaceholder') as string}
        allLabel={t('list.all') as string}
        countLabel={t('common.count', { count: items.length }) as string}
      />
      <PagedGrid
        items={items}
        resetKey={resetKey}
        keyOf={(entry) => entry.groupKey}
        titleOf={titleOf}
        emptyLabel={t('list.empty') as string}
        renderItem={(entry) => (
          <EntityCard
            to={`/monsters/${encodeURIComponent(entry.groupKey)}`}
            title={localizedName(entry.names, lang, entry.groupKey)}
            subtitle={`${entry.variantCount} ${t('detail.variants')}`}
            icon={entry.icon}
            squareIcon
            badges={entry.weak.map((weak) => elementName(t, weak))}
            contextEntity={{ module: 'monster', id: entry.groupKey, names: entry.names }}
          />
        )}
      />
    </div>
  );
}
