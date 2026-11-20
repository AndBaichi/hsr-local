/**
 * 更新日志（原站 `/diff`）
 *
 * 不是运营公告，而是**两个数据版本之间角色/光锥/遗器的实体差异**。
 * 首版只展示当前版本相对上一版的预算差异包（`db/{lang}/diff.json`）。
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { ErrorState } from '@/components/common/ErrorState';
import { SkeletonCardGrid } from '@/components/common/SkeletonBlock';
import { PageHeader } from '@/components/layout/PageHeader';
import { useListState } from '@/hooks/useListState';
import { DataAccessError } from '@/lib/data/errors';
import { getDiffBundle, visibleDiffItems, type DiffBundle, type DiffItem } from '@/lib/data/extra';
import { isExcludedFromLive } from '@/lib/data/liveView';
import { useDataViewStore } from '@/stores/dataView';
import { useSettingsStore } from '@/stores/settings';

type EntityFilter = 'all' | DiffItem['entity'];

export default function ChangelogPage(): ReactNode {
  const { t } = useTranslation();
  const lang = useSettingsStore((state) => state.prefs.lang);
  const [bundle, setBundle] = useState<DiffBundle | undefined>(undefined);
  const [error, setError] = useState<DataAccessError | undefined>(undefined);
  // 实体标签与搜索词也走进程内 store：进详情/切页面回来不再清空（与六个列表页同一机制）
  const { query, setQuery, filters, setFilter } = useListState('changelog');
  const entity = (filters.entity ?? 'all') as EntityFilter;

  useEffect(() => {
    let cancelled = false;
    setBundle(undefined);
    setError(undefined);
    void getDiffBundle(lang)
      .then((result) => {
        if (!cancelled) setBundle(result);
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setError(
          reason instanceof DataAccessError
            ? reason
            : new DataAccessError('UNKNOWN', '更新日志读取失败', String(reason)),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [lang]);

  const dataVersion = useDataViewStore((state) => state.version);
  const items = useMemo(() => {
    if (!bundle) return [];
    const all = visibleDiffItems(bundle);
    if (dataVersion !== 'live') return all;
    return all.filter((item) => {
      if (item.entity === 'character') return !isExcludedFromLive('character', item.id);
      if (item.entity === 'lightcone') return !isExcludedFromLive('lightcone', item.id);
      return true;
    });
  }, [bundle, dataVersion]);
  const shown = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return items.filter((item) => {
      if (entity !== 'all' && item.entity !== entity) return false;
      return needle === '' || item.name.toLocaleLowerCase().includes(needle) || item.id.includes(needle);
    });
  }, [items, entity, query]);

  const entityTabs: readonly { key: EntityFilter; label: string; count: number }[] = [
    { key: 'all', label: t('changelog.all'), count: items.length },
    { key: 'character', label: t('changelog.entityCharacter'), count: items.filter((i) => i.entity === 'character').length },
    { key: 'lightcone', label: t('changelog.entityLightcone'), count: items.filter((i) => i.entity === 'lightcone').length },
    { key: 'relic', label: t('changelog.entityRelic'), count: items.filter((i) => i.entity === 'relic').length },
  ];

  const statusLabel = (status: DiffItem['status']): string =>
    status === 'added'
      ? t('changelog.statusAdded')
      : status === 'removed'
        ? t('changelog.statusRemoved')
        : t('changelog.statusChanged');

  return (
    <div className="flex flex-col gap-4 pt-2">
      <PageHeader
        title={t('nav.changelog')}
        description={t('changelog.sub')}
        badge={bundle ? `${bundle.fromVersion || t('changelog.from')} → ${bundle.toVersion || t('changelog.to')}` : undefined}
        count={shown.length}
        countLabel={t('common.count', { count: shown.length })}
      />

      <div className="flex flex-wrap items-center gap-2">
        {entityTabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setFilter('entity', tab.key)}
            className={`rounded-btn border px-3 py-1.5 text-xs ${
              entity === tab.key ? 'border-accent bg-elev text-accent' : 'border-line bg-elev text-dim hover:text-ink'
            }`}
          >
            {tab.label} · {tab.count}
          </button>
        ))}
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('list.searchPlaceholder') as string}
          className="h-9 min-w-[180px] flex-1 rounded-btn border border-line bg-elev px-3 text-sm text-ink outline-none placeholder:text-dim focus:border-accent"
        />
      </div>

      {error ? (
        <ErrorState title={t(error.userMessageKey)} detail={`${error.code}\n${error.detail ?? error.message}`} />
      ) : null}
      {!bundle && !error ? <SkeletonCardGrid columns={3} rows={2} /> : null}

      {bundle && shown.length === 0 ? (
        <p className="text-sm text-dim">{t('changelog.noChanges')}</p>
      ) : null}

      <div className="flex flex-col gap-3">
        {shown.map((item) => (
          <details key={`${item.entity}-${item.id}`} className="hsr-panel rounded-card border border-line">
            <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-4 py-3">
              <span className="text-sm font-semibold text-ink">{item.name}</span>
              <span className="rounded-tag border border-line bg-elev px-1.5 py-[1px] text-[11px] text-accent">
                {statusLabel(item.status)}
              </span>
              <span className="font-mono text-[11px] text-dim">{item.id}</span>
              <span className="ml-auto text-xs text-dim">{item.changes.length} {t('changelog.fields')}</span>
            </summary>
            <div className="flex flex-col gap-1.5 border-t border-line px-4 py-3">
              {item.changes.map((change) => (
                <div key={change.key} className="grid gap-1 rounded-btn bg-elev p-2 text-xs sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                  <div className="sm:col-span-2 font-mono text-[11px] text-dim">{change.key}</div>
                  <div className="break-words text-dim">
                    <span className="mr-1 text-[11px] uppercase">{t('changelog.before')}</span>
                    {change.before ?? '—'}
                  </div>
                  <div className="break-words text-ink">
                    <span className="mr-1 text-[11px] uppercase">{t('changelog.after')}</span>
                    {change.after ?? '—'}
                  </div>
                </div>
              ))}
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}
