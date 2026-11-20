/** 角色列表页（PRD §4.2 页面 2） */

import { useCallback, useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { EntityCard } from '@/components/common/EntityGrid';
import { FilterBar, PagedGrid, type FilterDef } from '@/components/common/ListControls';
import { PageHeader } from '@/components/layout/PageHeader';
import { useListState, matchesQuery } from '@/hooks/useListState';
import { ELEMENT_TYPES, PATH_TYPES } from '@/i18n/enums';
import { dal } from '@/lib/data/dal';
import type { CharacterBrief } from '@/lib/data/types';
import { localizedName } from '@/lib/format';
import { elementName, pathName } from '@/lib/labels';
import { useDataVersionLabel } from '@/stores/dataView';
import { useSettingsStore } from '@/stores/settings';

export default function CharacterListPage(): ReactNode {
  const { t } = useTranslation();
  const lang = useSettingsStore((state) => state.prefs.lang);
  const dataVersionLabel = useDataVersionLabel();
  const { query, setQuery, filters, setFilter, resetKey } = useListState('characters');
  const all = dal.getIndex('character');

  const filterDefs = useMemo<readonly FilterDef[]>(
    () => [
      {
        key: 'rarity',
        label: t('list.filterRarity'),
        // 角色只有 4★ / 5★，三星及以下无数据，按用户要求移除
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
    ],
    [t],
  );

  const items = useMemo(
    () =>
      all.filter((entry) => {
        if (filters.rarity && filters.rarity !== 'all' && String(entry.rarity) !== filters.rarity) return false;
        if (filters.path && filters.path !== 'all' && entry.path !== filters.path) return false;
        if (filters.element && filters.element !== 'all' && entry.element !== filters.element) return false;
        return matchesQuery(query.trim(), entry.names, entry.id);
      }),
    [all, filters, query],
  );

  // 稳定引用：PagedGrid 用它排序，每次渲染换新函数会重排整张表
  const titleOf = useCallback(
    (entry: CharacterBrief) => localizedName(entry.names, lang, entry.id),
    [lang],
  );

  return (
    <div className="flex flex-col gap-4 pt-2">
      <PageHeader
        title={t('nav.characters')}
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
            to={`/characters/${encodeURIComponent(entry.id)}`}
            title={localizedName(entry.names, lang, entry.id)}
            icon={entry.icon}
            rarity={entry.rarity}
            badges={[elementName(t, entry.element), pathName(t, entry.path)]}
            contextEntity={{ module: 'character', id: entry.id, names: entry.names }}
          />
        )}
      />
    </div>
  );
}
