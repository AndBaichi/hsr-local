/** 遗器列表页（PRD §4.2 页面 6）：只做到套装级，不做到单件 */

import { useCallback, useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { EntityCard } from '@/components/common/EntityGrid';
import { FilterBar, PagedGrid, type FilterDef } from '@/components/common/ListControls';
import { PageHeader } from '@/components/layout/PageHeader';
import { useListState, matchesQuery } from '@/hooks/useListState';
import { dal } from '@/lib/data/dal';
import type { RelicSetBrief } from '@/lib/data/types';
import { localizedName } from '@/lib/format';
import { useSettingsStore } from '@/stores/settings';

export default function RelicListPage(): ReactNode {
  const { t } = useTranslation();
  const lang = useSettingsStore((state) => state.prefs.lang);
  const { query, setQuery, filters, setFilter, resetKey } = useListState('relics');
  const all = dal.getIndex('relicset');

  const filterDefs = useMemo<readonly FilterDef[]>(
    () => [
      {
        key: 'kind',
        label: t('list.filterKind'),
        options: [
          { value: 'cavern', label: t('list.kindCavern') },
          { value: 'planar', label: t('list.kindPlanar') },
        ],
      },
    ],
    [t],
  );

  const items = useMemo(
    () =>
      all.filter((entry) => {
        if (filters.kind && filters.kind !== 'all' && entry.kind !== filters.kind) return false;
        return matchesQuery(query.trim(), entry.names, entry.id);
      }),
    [all, filters, query],
  );

  // 稳定引用：PagedGrid 用它排序，每次渲染换新函数会重排整张表
  const titleOf = useCallback(
    (entry: RelicSetBrief) => localizedName(entry.names, lang, entry.id),
    [lang],
  );

  return (
    <div className="flex flex-col gap-4 pt-2">
      <PageHeader
        title={t('nav.relics')}
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
        keyOf={(entry) => entry.id}
        titleOf={titleOf}
        emptyLabel={t('list.empty') as string}
        renderItem={(entry) => (
          <EntityCard
            to={`/relics/${encodeURIComponent(entry.id)}`}
            title={localizedName(entry.names, lang, entry.id)}
            icon={entry.icon}
            squareIcon
            badges={entry.effectPieces.map((pieces) => `${pieces} ${t('detail.pieces')}`)}
            contextEntity={{ module: 'relicset', id: entry.id, names: entry.names }}
          />
        )}
      />
    </div>
  );
}
