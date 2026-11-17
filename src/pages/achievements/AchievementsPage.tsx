/**
 * 成就浏览页（PRD §4.2 页面 12）
 *
 * 无独立详情路由（见 router.tsx），条目在系列内展开。
 * 9 个系列、约 2022 条，默认只渲染当前展开系列的条目，避免首屏铺两千个 DOM。
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { ErrorState } from '@/components/common/ErrorState';
import { openEntityContextMenu } from '@/components/common/ContextMenu';
import { RichTextView } from '@/components/common/RichTextView';
import { SkeletonCardGrid } from '@/components/common/SkeletonBlock';
import { PageHeader } from '@/components/layout/PageHeader';
import { DataAccessError } from '@/lib/data/errors';
import { dal } from '@/lib/data/dal';
import type { AchievementSeriesDetail } from '@/lib/data/types';
import { useSettingsStore } from '@/stores/settings';

export default function AchievementsPage(): ReactNode {
  const { t } = useTranslation();
  const lang = useSettingsStore((state) => state.prefs.lang);
  const [series, setSeries] = useState<readonly AchievementSeriesDetail[] | undefined>(undefined);
  const [error, setError] = useState<DataAccessError | undefined>(undefined);
  const [openId, setOpenId] = useState<string | undefined>(undefined);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    setSeries(undefined);
    setError(undefined);
    void dal
      .getAchievements()
      .then((result) => {
        if (cancelled) return;
        setSeries(result);
        setOpenId((previous) => previous ?? result[0]?.id);
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setError(
          reason instanceof DataAccessError
            ? reason
            : new DataAccessError('UNKNOWN', '成就读取失败', String(reason)),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [lang]);

  const needle = query.trim().toLocaleLowerCase();
  const matches = useMemo(() => {
    if (!series) return [];
    return series.map((group) => ({
      group,
      entries: needle
        ? (group.items ?? []).filter(
            (item) =>
              item.name.toLocaleLowerCase().includes(needle) ||
              item.id.toLocaleLowerCase().includes(needle),
          )
        : (group.items ?? []),
    }));
  }, [series, needle]);

  const total = series?.reduce((sum, group) => sum + (group.items?.length ?? 0), 0) ?? 0;

  return (
    <div className="flex flex-col gap-4 pt-2">
      <PageHeader
        title={t('nav.achievements')}
        description={t('detail.achievements') as string}
        count={total}
        countLabel={t('common.count', { count: total }) as string}
        badge={dal.meta?.gameVersion}
      />

      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t('list.searchPlaceholder') as string}
        aria-label={t('list.search') as string}
        className="h-9 rounded-btn border border-line bg-elev px-3 text-sm text-ink outline-none placeholder:text-dim focus:border-accent"
      />

      {error ? (
        <ErrorState title={t(error.userMessageKey)} detail={`${error.code}\n${error.detail ?? error.message}`} />
      ) : null}

      {!series && !error ? <SkeletonCardGrid columns={3} rows={2} /> : null}

      <div className="flex flex-col gap-3">
        {matches.map(({ group, entries }) => {
          const expanded = openId === group.id || needle !== '';
          return (
            <section key={group.id} className="hsr-panel rounded-card border border-line">
              <button
                type="button"
                onClick={() => setOpenId(expanded && needle === '' ? undefined : group.id)}
                onContextMenu={(event) =>
                  openEntityContextMenu(
                    {
                      module: 'achievementSeries',
                      id: group.id,
                      // 成就索引只有当前语言单名：四语言位填同一个值，
                      // 与 lib/entities.ts 的 entityNamesOf 口径一致
                      names: { zh: group.name, en: group.name, ja: group.name, ko: group.name },
                    },
                    event,
                  )
                }
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                aria-expanded={expanded}
              >
                <span className="text-sm font-semibold text-ink">{group.name}</span>
                <span className="text-xs tabular-nums text-dim">
                  {needle ? `${entries.length}/${group.items?.length ?? 0}` : (group.itemCount ?? entries.length)}
                </span>
              </button>
              {expanded ? (
                <div className="flex flex-col gap-2 border-t border-line px-4 py-3">
                  {entries.length === 0 ? (
                    <p className="text-xs text-dim">{t('list.empty')}</p>
                  ) : (
                    entries.map((item) => (
                      <div key={item.id} className="rounded-btn border border-line bg-elev p-3">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <span className="text-sm font-medium text-ink">{item.name}</span>
                          <span className="font-mono text-[11px] text-dim">
                            {item.id}
                            {item.visibility === 'hidden' ? ` · ${t('detail.hidden')}` : ''}
                          </span>
                        </div>
                        <RichTextView value={item.desc} paramList={item.paramList} className="mt-1" />
                      </div>
                    ))
                  )}
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}
