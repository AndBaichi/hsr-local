/** 光锥列表页（PRD §4.2 页面 4） */

import { useCallback, useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { EntityCard } from '@/components/common/EntityGrid';
import { FilterBar, PagedGrid, type FilterDef } from '@/components/common/ListControls';
import { PageHeader } from '@/components/layout/PageHeader';
import { useListState, matchesQuery } from '@/hooks/useListState';
import { PATH_TYPES } from '@/i18n/enums';
import { dal } from '@/lib/data/dal';
import type { LightconeBrief } from '@/lib/data/types';
import { localizedName } from '@/lib/format';
import { pathName } from '@/lib/labels';
import { useDataVersionLabel } from '@/stores/dataView';
import { useSettingsStore } from '@/stores/settings';

export default function LightconeListPage(): ReactNode {
  const { t } = useTranslation();
  const lang = useSettingsStore((state) => state.prefs.lang);
  const dataVersionLabel = useDataVersionLabel();
  const { query, setQuery, filters, setFilter, resetKey } = useListState('lightcones');
  const all = dal.getIndex('lightcone');

  const filterDefs = useMemo<readonly FilterDef[]>(
    () => [
      {
        key: 'rarity',
        label: t('list.filterRarity'),
        // 光锥只有 3★ / 4★ / 5★，一星二星无数据，按用户要求移除
        options: [5, 4, 3].map((value) => ({ value: String(value), label: '★'.repeat(value) })),
      },
      {
        key: 'path',
        label: t('list.filterPath'),
        options: PATH_TYPES.map((value) => ({ value, label: pathName(t, value) })),
      },
    ],
    [t],
  );

  const items = useMemo(
    () =>
      all.filter((entry) => {
        if (filters.rarity && filters.rarity !== 'all' && String(entry.rarity) !== filters.rarity) return false;
        if (filters.path && filters.path !== 'all' && entry.path !== filters.path) return false;
        return matchesQuery(query.trim(), entry.names, entry.id);
      }),
    [all, filters, query],
  );

  // 稳定引用：PagedGrid 用它排序，每次渲染换新函数会重排整张表
  const titleOf = useCallback(
    (entry: LightconeBrief) => localizedName(entry.names, lang, entry.id),
    [lang],
  );

  return (
    <div className="flex flex-col gap-4 pt-2">
      <PageHeader
        title={t('nav.lightcones')}
        count={all.length}
        countLabel={t('common.count', { count: all.length })}
        badge={dataVersionLabel}
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
            to={`/lightcones/${encodeURIComponent(entry.id)}`}
            title={localizedName(entry.names, lang, entry.id)}
            icon={entry.icon}
            rarity={entry.rarity}
            badges={[pathName(t, entry.path)]}
            contextEntity={{ module: 'lightcone', id: entry.id, names: entry.names }}
          />
        )}
      />
    </div>
  );
}
