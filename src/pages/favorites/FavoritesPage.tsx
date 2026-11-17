/**
 * 收藏页（PRD §4.2 页面 15 / T05）
 *
 * 数据源是 `useFavoritesStore`（`userdata/favorites.json`），它跨数据包版本存活：
 * 条目里存的 `nameSnapshot` 让实体被删/改名后仍能显示。因此本页除了展示，
 * 还要对「换包后原 id 已不在索引里」的条目标注 `favorites.removed`。
 *
 * 判断「已移除」刻意保守：索引未就绪、同一个 packId、未知模块都不判定，
 * 宁可少标也不误标，更不能因为一条脏数据让整页崩溃。
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { PagePlaceholder } from '@/components/common/PagePlaceholder';
import { SkeletonCardGrid } from '@/components/common/SkeletonBlock';
import { PageHeader } from '@/components/layout/PageHeader';
import { dal } from '@/lib/data/dal';
import type { ModuleKey } from '@/lib/data/types';
import { detailRouteOf, MODULE_LABEL_KEYS } from '@/lib/entities';
import type { Lang } from '@/i18n';
import { entityKeyOf, pickName, type FavoriteEntry } from '@/lib/userdata/types';
import { sortedFavorites, useFavoritesStore } from '@/stores/favorites';
import { useSettingsStore } from '@/stores/settings';

/**
 * 原 T01 占位实现：页面已接入真实内容，此处不再渲染，
 * 但按「先不删东西」的要求保留引用，未删除（parked, not deleted）。
 */
export const ATTIC_T01_PLACEHOLDER = PagePlaceholder;

/** 模块 + id → 详情页路由（与 `entities.detailRouteOf` 一致，成就系列/部分图鉴无独立路由） */
function detailRoute(module: ModuleKey, id: string): string {
  return detailRouteOf(module, id) ?? '/';
}

/** 索引里是否仍存在该实体（敌人按 groupKey / 主变体 / 任一变体 id 命中） */
function entityExistsInIndex(module: ModuleKey, id: string): boolean {
  switch (module) {
    case 'character':
      return dal.getIndex('character').some((brief) => brief.id === id);
    case 'lightcone':
      return dal.getIndex('lightcone').some((brief) => brief.id === id);
    case 'relicset':
      return dal.getIndex('relicset').some((brief) => brief.id === id);
    case 'item':
      return dal.getIndex('item').some((brief) => brief.id === id);
    case 'achievementSeries':
      return dal.getIndex('achievementSeries').some((brief) => brief.id === id);
    case 'monster':
      return dal.getIndex('monster').some(
        (brief) => brief.groupKey === id || brief.primaryId === id || brief.variantIds.includes(id),
      );
    default:
      return false;
  }
}

/** 「可能已随数据包更新移除」：换了包，且原 id 已不在新索引里 */
function isPossiblyRemoved(entry: FavoriteEntry): boolean {
  const bundle = dal.meta;
  if (bundle === undefined) return false; // 索引未就绪：不判定，避免把全部收藏误标
  const currentPackId = dal.bootInfo?.packId ?? bundle.packId;
  if (entry.packId === currentPackId) return false; // 同一个包，谈不上「随版本移除」
  try {
    return !entityExistsInIndex(entry.module, entry.id);
  } catch {
    // 未知模块 / 索引不可用：不崩、不误判
    return false;
  }
}

/** ISO8601 → 本地化短日期；非法值原样返回，永不打印 undefined */
function shortDate(iso: string, lang: Lang): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString(lang);
}

/** 单张收藏卡 */
function FavoriteCard({ entry }: { readonly entry: FavoriteEntry }): ReactNode {
  const { t } = useTranslation();
  const lang = useSettingsStore((state) => state.prefs.lang);
  const remove = useFavoritesStore((state) => state.remove);
  const name = pickName(entry.nameSnapshot, lang, entry.id);
  const to = detailRoute(entry.module, entry.id);
  const removed = isPossiblyRemoved(entry);

  return (
    <div className="hsr-panel flex flex-col gap-2 rounded-card border border-line p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <Link to={to} title={name} className="truncate text-sm font-semibold text-ink hover:text-accent">
            {name}
          </Link>
          <span className="text-xs text-dim">
            {t(MODULE_LABEL_KEYS[entry.module] as 'nav.characters') as string}
          </span>
        </div>
        {removed ? (
          <span className="shrink-0 rounded-tag border border-line bg-elev px-1.5 py-[1px] text-[11px] text-danger">
            {t('favorites.removed') as string}
          </span>
        ) : null}
      </div>

      <span className="tabular-nums text-[11px] text-dim">{shortDate(entry.addedAt, lang)}</span>

      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1">
        <Link to={to} className="text-xs text-accent hover:underline">
          {t('favorites.open') as string}
        </Link>
        <button
          type="button"
          onClick={() => remove(entry.module, entry.id)}
          className="rounded-btn border border-line bg-elev px-2.5 py-1 text-xs text-dim hover:text-danger"
        >
          {t('favorites.remove') as string}
        </button>
      </div>
    </div>
  );
}

/** 收藏页 */
export default function FavoritesPage(): ReactNode {
  const { t } = useTranslation();
  const items = useFavoritesStore((state) => state.items);
  const loaded = useFavoritesStore((state) => state.loaded);
  const clear = useFavoritesStore((state) => state.clear);
  const [confirmClear, setConfirmClear] = useState(false);

  // hydrate 幂等；未读完磁盘前显示骨架，绝不显示「暂无收藏」
  useEffect(() => {
    void useFavoritesStore.getState().hydrate();
  }, []);

  const sorted = useMemo(() => sortedFavorites(items), [items]);

  return (
    <div className="flex flex-col gap-4 pt-2">
      <PageHeader
        title={t('favorites.title') as string}
        description={t('favorites.sub') as string}
        count={loaded ? sorted.length : undefined}
        countLabel={loaded ? (t('favorites.count', { count: sorted.length }) as string) : undefined}
        actions={
          <button
            type="button"
            disabled={!loaded || sorted.length === 0}
            onClick={() => setConfirmClear(true)}
            className="rounded-btn border border-line bg-elev px-3 py-1.5 text-xs text-ink hover:border-accent disabled:opacity-40"
          >
            {t('favorites.clear') as string}
          </button>
        }
      />

      {confirmClear ? (
        <div className="flex flex-wrap items-center gap-2 rounded-btn border border-line bg-elev px-3 py-2">
          <span className="min-w-0 flex-1 text-xs text-ink">{t('favorites.clearConfirm') as string}</span>
          <button
            type="button"
            onClick={() => {
              clear();
              setConfirmClear(false);
            }}
            className="rounded-btn border border-line bg-elev px-3 py-1 text-xs text-danger hover:text-ink"
          >
            {t('common.yes') as string}
          </button>
          <button
            type="button"
            onClick={() => setConfirmClear(false)}
            className="rounded-btn border border-line bg-elev px-3 py-1 text-xs text-dim hover:text-ink"
          >
            {t('common.no') as string}
          </button>
        </div>
      ) : null}

      {!loaded ? <SkeletonCardGrid columns={3} rows={2} /> : null}

      {loaded && sorted.length === 0 ? (
        <div className="hsr-panel flex flex-col items-center gap-2 rounded-card border border-line p-8 text-center">
          <p className="text-sm font-semibold text-ink">{t('favorites.emptyTitle') as string}</p>
          <p className="text-xs leading-relaxed text-dim">{t('favorites.emptyDesc') as string}</p>
          <Link
            to="/characters"
            className="mt-1 rounded-btn border border-line bg-elev px-3 py-1.5 text-xs text-accent hover:border-accent"
          >
            {t('nav.characters') as string}
          </Link>
        </div>
      ) : null}

      {loaded && sorted.length > 0 ? (
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
          {sorted.map((entry) => (
            <FavoriteCard key={entityKeyOf(entry.module, entry.id)} entry={entry} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
