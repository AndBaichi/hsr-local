/**
 * 首页「当前跃迁」卡片。
 *
 * 数据源是社区 Project HLITH 的 banners.json（每天从官方公告/米游社/wiki 汇总）。
 * 只展示当前正在 UP 的卡池，不展示未来排期；离线时用上次缓存，没有就整块隐藏。
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import AutoAwesomeOutlined from '@mui/icons-material/AutoAwesomeOutlined';
import OpenInNewOutlined from '@mui/icons-material/OpenInNewOutlined';

import { SafeImage } from '@/components/common/SafeImage';
import { dal } from '@/lib/data/dal';
import {
  BANNERS_SOURCE_PAGE,
  loadActiveBanners,
  type ActiveBanner,
} from '@/lib/data/banners';
import { localizedName } from '@/lib/format';
import { openExternal } from '@/lib/openExternal';
import { useSettingsStore } from '@/stores/settings';

/** 本地化日期：MM-DD HH:mm */
function formatEnd(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 单个卡池卡片 */
function BannerCard({ banner, now }: { readonly banner: ActiveBanner; readonly now: number }): ReactNode {
  const { t } = useTranslation();
  const lang = useSettingsStore((state) => state.prefs.lang);
  const index = banner.kind === 'character' ? dal.getIndex('character') : dal.getIndex('lightcone');
  const byId = new Map(index.map((entry) => [entry.id, entry]));

  const items = banner.featured.map((id) => byId.get(id)).filter((entry) => entry !== undefined);
  const days = Math.ceil((banner.end - now) / 86_400_000);
  const remaining =
    days <= 0 ? (t('home.bannerEndsToday') as string) : (t('home.bannerDaysLeft', { days }) as string);

  return (
    <div className="hsr-panel flex min-w-0 flex-col gap-3 rounded-card border border-line p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="inline-flex items-center gap-1 rounded-tag border border-[color:var(--hsr-accent-line)] bg-[color:var(--hsr-accent-soft)] px-1.5 py-[1px] text-[10px] font-medium text-accent">
            {banner.kind === 'character'
              ? t('home.bannerCharacter')
              : t('home.bannerLightcone')}
          </span>
          <div className="mt-1 truncate text-xs text-dim" title={banner.title}>
            {banner.title}
          </div>
        </div>
        <span className="shrink-0 rounded-tag border border-line bg-elev px-2 py-[2px] text-[10px] text-dim">
          {remaining}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        {items.map((entry) => {
          const to =
            banner.kind === 'character'
              ? `/characters/${encodeURIComponent(entry.id)}`
              : `/lightcones/${encodeURIComponent(entry.id)}`;
          return (
            <Link
              key={entry.id}
              to={to}
              className="group flex min-w-0 max-w-full items-center gap-2 rounded-btn border border-line bg-elev px-1.5 py-1 pr-2.5 transition-colors duration-fast hover:border-accent"
            >
              <SafeImage
                src={entry.icon}
                alt={localizedName(entry.names, lang, entry.id)}
                className="h-9 w-9 shrink-0 rounded-btn"
                imgClassName="object-contain"
              />
              <span className="min-w-0">
                <span className="block truncate text-xs font-medium text-ink group-hover:text-accent">
                  {localizedName(entry.names, lang, entry.id)}
                </span>
                <span className="block text-[10px] text-dim">{'★'.repeat(entry.rarity)}</span>
              </span>
            </Link>
          );
        })}
      </div>

      <div className="mt-auto text-[10px] text-dim">
        {t('home.bannerEnds')} {formatEnd(banner.end)}
      </div>
    </div>
  );
}

/** 当前跃迁区块 */
export function CurrentBanners(): ReactNode {
  const { t } = useTranslation();
  const [banners, setBanners] = useState<readonly ActiveBanner[] | undefined>(undefined);
  const now = useMemo(() => Date.now(), []);

  useEffect(() => {
    let alive = true;
    void loadActiveBanners(now).then((rows) => {
      if (alive) setBanners(rows);
    });
    return () => {
      alive = false;
    };
  }, [now]);

  if (banners === undefined || banners.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
          <AutoAwesomeOutlined sx={{ fontSize: 16 }} className="text-accent" />
          {t('home.currentBanners')}
        </h2>
        <button
          type="button"
          onClick={() => {
            void openExternal(BANNERS_SOURCE_PAGE);
          }}
          className="inline-flex shrink-0 items-center gap-1 text-[10px] text-dim transition-colors hover:text-accent"
          title={t('home.bannerSource') as string}
        >
          {t('home.bannerSource')}
          <OpenInNewOutlined sx={{ fontSize: 11 }} />
        </button>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {banners.map((banner) => (
          <BannerCard key={banner.id} banner={banner} now={now} />
        ))}
      </div>
    </section>
  );
}
