/**
 * 物品列表页（PRD §4.2 页面 10）
 *
 * 物品索引**没有 `name` 字段**，只有 `names{}`，所以一律走 `localizedName()`。
 * 1606 条按 16 分片读入内存，这里只做纯前端过滤 + 全量渲染（v2.8 起不分页）。
 */

import { useCallback, useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { EntityCard } from '@/components/common/EntityGrid';
import { FilterBar, PagedGrid, type FilterDef } from '@/components/common/ListControls';
import { PageHeader } from '@/components/layout/PageHeader';
import { useListState, matchesQuery } from '@/hooks/useListState';
import { dal } from '@/lib/data/dal';
import type { ItemBrief } from '@/lib/data/types';
import { localizedName } from '@/lib/format';
import { itemTypeName } from '@/lib/labels';
import { useSettingsStore } from '@/stores/settings';

export default function ItemListPage(): ReactNode {
  const { t } = useTranslation();
  const lang = useSettingsStore((state) => state.prefs.lang);
  const { query, setQuery, filters, setFilter, resetKey } = useListState('items');
  const all = dal.getIndex('item');

  const mainTypes = useMemo(
    () => [...new Set(all.map((entry) => entry.mainType).filter(Boolean))].sort(),
    [all],
  );

  const filterDefs = useMemo<readonly FilterDef[]>(
    () => [
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
    ],
    [t, mainTypes],
  );

  const items = useMemo(
    () =>
      all.filter((entry) => {
        if (filters.rarity && filters.rarity !== 'all' && String(entry.rarity) !== filters.rarity) return false;
        if (filters.mainType && filters.mainType !== 'all' && entry.mainType !== filters.mainType) return false;
        return matchesQuery(query.trim(), entry.names, entry.id);
      }),
    [all, filters, query],
  );

  // 稳定引用：PagedGrid 用它排序，每次渲染换新函数会重排整张表（物品 1606 条）
  const titleOf = useCallback(
    (entry: ItemBrief) => localizedName(entry.names, lang, entry.id),
    [lang],
  );

  return (
    <div className="flex flex-col gap-4 pt-2">
      <PageHeader
        title={t('nav.items')}
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
            to={`/items/${encodeURIComponent(entry.id)}`}
            title={localizedName(entry.names, lang, entry.id)}
            icon={entry.icon}
            rarity={entry.rarity}
            squareIcon
            badges={[
              itemTypeName(t, entry.mainType),
              entry.subType !== entry.mainType ? itemTypeName(t, entry.subType) : undefined,
            ]}
            contextEntity={{ module: 'item', id: entry.id, names: entry.names }}
          />
        )}
      />
    </div>
  );
}
