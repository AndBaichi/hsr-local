/**
 * 终局内容（原站 `/maze` `/story` `/boss` `/peak` 四合一）
 *
 * 四个子栏目共用一个页面 + 页内标签，避免注册四套几乎相同的路由与列表。
 * 赛季名可能为 null（未实装条目），一律走 `seasonName()` 回退。
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { ErrorState } from '@/components/common/ErrorState';
import { SkeletonCardGrid } from '@/components/common/SkeletonBlock';
import { PageHeader } from '@/components/layout/PageHeader';
import { useListState } from '@/hooks/useListState';
import { DataAccessError } from '@/lib/data/errors';
import {
  ENDGAME_MODES,
  getEndgameSeasons,
  getEndgameVersions,
  seasonName,
  type EndgameMode,
  type EndgameSeason,
  type VersionMap,
} from '@/lib/data/extra';
import { useSettingsStore } from '@/stores/settings';

export default function EndgamePage(): ReactNode {
  const { t } = useTranslation();
  const lang = useSettingsStore((state) => state.prefs.lang);
  const [seasons, setSeasons] = useState<readonly EndgameSeason[] | undefined>(undefined);
  const [versions, setVersions] = useState<VersionMap>({});
  const [error, setError] = useState<DataAccessError | undefined>(undefined);
  // 四个子栏目的选中项也走进程内 store：从赛季详情返回时仍停在原来那一栏
  const { filters, setFilter } = useListState('endgame');
  const mode: EndgameMode = ENDGAME_MODES.some((entry) => entry.key === filters.mode)
    ? (filters.mode as EndgameMode)
    : 'maze';

  useEffect(() => {
    let cancelled = false;
    setSeasons(undefined);
    setError(undefined);
    void Promise.all([getEndgameSeasons(mode), getEndgameVersions(mode, lang)])
      .then(([list, map]) => {
        if (cancelled) return;
        setSeasons(list);
        setVersions(map);
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setError(
          reason instanceof DataAccessError
            ? reason
            : new DataAccessError('UNKNOWN', '终局内容读取失败', String(reason)),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [mode, lang]);

  const versionLabel = useMemo(() => {
    const map = new Map<string, string>();
    for (const [version, ids] of Object.entries(versions)) {
      for (const [index, id] of ids.entries()) map.set(String(id), version === 'static' ? t('endgame.permanent') : `${version} v${index + 1}`);
    }
    return map;
  }, [versions, t]);

  const sorted = useMemo(() => {
    if (!seasons) return [];
    return [...seasons].sort((a, b) => Number(b.id) - Number(a.id));
  }, [seasons]);

  return (
    <div className="flex flex-col gap-4 pt-2">
      <PageHeader
        title={t('nav.endgame')}
        description={t('endgame.sub')}
        count={seasons?.length}
        countLabel={t('common.count', { count: seasons?.length ?? 0 })}
        badge={seasons ? t(`endgame.${ENDGAME_MODES.find((m) => m.key === mode)?.navKey}` as 'endgame.endgameMoc') : undefined}
      />

      <div className="flex flex-wrap gap-2">
        {ENDGAME_MODES.map((entry) => (
          <button
            key={entry.key}
            type="button"
            onClick={() => setFilter('mode', entry.key)}
            className={`rounded-btn border px-3 py-1.5 text-xs ${
              mode === entry.key ? 'border-accent bg-elev text-accent' : 'border-line bg-elev text-dim hover:text-ink'
            }`}
          >
            {t(`endgame.${entry.navKey}` as 'endgame.endgameMoc')}
          </button>
        ))}
      </div>

      {error ? (
        <ErrorState title={t(error.userMessageKey)} detail={`${error.code}\n${error.detail ?? error.message}`} />
      ) : null}
      {!seasons && !error ? <SkeletonCardGrid columns={3} rows={2} /> : null}

      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
        {sorted.map((season) => (
          <Link
            key={String(season.id)}
            to={`/endgame/${mode}/${encodeURIComponent(String(season.id))}`}
            className="hsr-panel flex flex-col gap-1.5 rounded-card border border-line p-4 transition-colors duration-fast hover:border-accent"
          >
            <span className="text-sm font-semibold text-ink">
              {seasonName(season, lang, t('endgame.season'))}
            </span>
            {versionLabel.get(String(season.id)) ? (
              <span className="w-fit rounded-tag border border-line bg-elev px-1.5 py-[1px] text-[11px] text-accent">
                {versionLabel.get(String(season.id))}
              </span>
            ) : null}
            <span className="font-mono text-[11px] text-dim">#{season.id}</span>
            {season.begin ? (
              <span className="text-[11px] text-dim">
                {season.begin.slice(0, 10)} → {season.end?.slice(0, 10) ?? '—'}
              </span>
            ) : null}
          </Link>
        ))}
      </div>
    </div>
  );
}
