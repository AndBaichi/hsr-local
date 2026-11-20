/**
 * 首页（对齐原站 https://hsr.nanoka.cc/ 首页布局）
 *
 * 结构（自上而下）：
 *  1. 版本卡片区：最新数据版本（diff.toVersion）+ 正式版本（diff.fromVersion），粉紫渐变大数字
 *  2. 公告 / 资讯：米游社实时拉取，点击用系统浏览器打开原文（**仅中文界面**）
 *  3. 新增角色：diff.json 里 status=added 的角色，竖版立绘卡（属性图标 + 命途图标 + 星级）
 *  4. 新增光锥：diff.json 里 status=added 的光锥卡
 *  5. 收藏速览（用户增强功能，原站无，保留）
 *
 * 原来的「快速访问 角色 / 光锥」两个长条卡已按用户要求换成公告 / 资讯——
 * 角色与光锥在左侧导航里都有入口，首页不再重复。
 *
 * 数据来源分两条：
 *  - **离线**：版本号与新增列表来自 `db/{lang}/diff.json`，立绘 / 属性 / 命途 / 星级
 *    从 `dal.getIndex('character'|'lightcone')` 用 id 匹配补齐（diff 条目本身只带
 *    源站 icon 路径与 rarity，不带 path/element，也不带包内路径）。
 *  - **在线**：公告 / 资讯走米游社公开接口（`lib/news/miyoushe.ts`），
 *    结果缓存在 localStorage，断网时回退到上次内容并标注「缓存 · 时间」。
 *    米游社只有简体中文内容，所以这个区块在 en / ja / ko 界面下整体不渲染。
 *
 * 数据未就绪时如实显示骨架 / 空态，绝不填假数据。
 */

import ArticleOutlined from '@mui/icons-material/ArticleOutlined';
import CampaignOutlined from '@mui/icons-material/CampaignOutlined';
import ChevronRightOutlined from '@mui/icons-material/ChevronRightOutlined';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { SafeImage } from '@/components/common/SafeImage';
import { SkeletonBlock } from '@/components/common/SkeletonBlock';
import { RarityStars } from '@/components/common/EntityGrid';
import { NewsCard } from '@/components/home/NewsCard';
import { PageHeader } from '@/components/layout/PageHeader';
import { dal } from '@/lib/data/dal';
import { compareVersions } from '@/lib/update/manifest';
import { getDiffBundle, type DiffItem } from '@/lib/data/extra';
import type { CharacterBrief, LightconeBrief } from '@/lib/data/types';
import { elementIconPath, pathIconPath } from '@/lib/format';
import { elementName, pathName } from '@/lib/labels';
import { useNewsFeeds } from '@/lib/news/useNewsFeeds';
import { pickName } from '@/lib/userdata/types';
import { sortedFavorites, useFavoritesStore } from '@/stores/favorites';
import { isExcludedFromLive } from '@/lib/data/liveView';
import { useDataVersionLabel, useDataViewStore } from '@/stores/dataView';
import { useSettingsStore } from '@/stores/settings';
import { useUpdaterStore } from '@/stores/updater';

/** 新增条目状态：未加载 / 加载中 / 已加载 */
interface NewItems {
  /** 是否仍在加载 */
  readonly loading: boolean;
  /** 新增角色（id 匹配索引后的完整 brief） */
  readonly characters: readonly CharacterBrief[];
  /** 新增光锥 */
  readonly lightcones: readonly LightconeBrief[];
  /** 正式版本（diff.fromVersion） */
  readonly fromVersion?: string;
  /** 最新数据版本（diff.toVersion） */
  readonly toVersion?: string;
}

const EMPTY_NEW_ITEMS: NewItems = { loading: true, characters: [], lightcones: [] };

/**
 * 从 diff.json 里筛出 status=added 的实体，再用索引补齐字段。
 *
 * 用 id 匹配索引，而不是直接信任 diff 的 icon（diff 的 icon 是源站路径，非包内路径）。
 */
function resolveNewItems(
  added: readonly DiffItem[],
  characters: readonly CharacterBrief[],
  lightcones: readonly LightconeBrief[],
): Pick<NewItems, 'characters' | 'lightcones'> {
  const charById = new Map(characters.map((c) => [c.id, c]));
  const lcById = new Map(lightcones.map((l) => [l.id, l]));

  const newChars: CharacterBrief[] = [];
  const newLcs: LightconeBrief[] = [];
  for (const item of added) {
    if (item.entity === 'character') {
      const brief = charById.get(item.id);
      if (brief) newChars.push(brief);
    } else if (item.entity === 'lightcone') {
      const brief = lcById.get(item.id);
      if (brief) newLcs.push(brief);
    }
  }
  return { characters: newChars, lightcones: newLcs };
}

/** 版本号卡片（粉紫渐变大数字） */
function VersionCard({ label, value, accent }: { label: string; value: string; accent: boolean }): ReactNode {
  return (
    <div
      className={`hsr-panel flex flex-col gap-2 rounded-card border border-line p-5 ${
        accent ? 'bg-elev' : ''
      }`}
    >
      <span className="text-xs text-dim">{label}</span>
      <span
        className="text-3xl font-bold tracking-tight"
        style={{
          background: 'linear-gradient(135deg, #F2C14E, #A78BFA)',
          WebkitBackgroundClip: 'text',
          backgroundClip: 'text',
          color: 'transparent',
        }}
      >
        {value}
      </span>
    </div>
  );
}

/** 新增角色竖版卡片 */
function NewCharacterCard({ character }: { character: CharacterBrief }): ReactNode {
  const { t } = useTranslation();
  const lang = useSettingsStore((state) => state.prefs.lang);
  const name = pickName(character.names, lang, character.id);
  return (
    <Link
      to={`/characters/${character.id}`}
      className="hsr-panel group flex flex-col overflow-hidden rounded-card border border-line no-underline transition-colors duration-fast hover:border-accent"
    >
      {/* 立绘（竖版，右上角属性图标 / 右下角命途图标叠加） */}
      <div className="relative aspect-[3/4] w-full overflow-hidden bg-elev">
        <SafeImage
          src={character.icon}
          alt={name}
          className="h-full w-full"
          imgClassName="object-cover"
        />
        <SafeImage
          src={elementIconPath(character.element)}
          alt={elementName(t, character.element)}
          className="absolute right-2 top-2 h-6 w-6"
          imgClassName="object-contain"
        />
        <SafeImage
          src={pathIconPath(character.path)}
          alt={pathName(t, character.path)}
          className="absolute bottom-2 right-2 h-6 w-6"
          imgClassName="object-contain"
        />
      </div>
      {/* 名字 + 星级 */}
      <div className="flex flex-col gap-1 p-3">
        <span className="truncate text-sm font-semibold text-ink group-hover:text-accent" title={name}>
          {name}
        </span>
        <RarityStars rarity={character.rarity} />
      </div>
    </Link>
  );
}

/** 新增光锥卡 */
function NewLightconeCard({ lightcone }: { lightcone: LightconeBrief }): ReactNode {
  const lang = useSettingsStore((state) => state.prefs.lang);
  const name = pickName(lightcone.names, lang, lightcone.id);
  return (
    <Link
      to={`/lightcones/${lightcone.id}`}
      className="hsr-panel group flex flex-col overflow-hidden rounded-card border border-line no-underline transition-colors duration-fast hover:border-accent"
    >
      <div className="relative aspect-[3/4] w-full overflow-hidden bg-elev">
        <SafeImage
          src={lightcone.icon}
          alt={name}
          className="h-full w-full"
          imgClassName="object-cover"
        />
      </div>
      <div className="flex flex-col gap-1 p-3">
        <span className="truncate text-sm font-semibold text-ink group-hover:text-accent" title={name}>
          {name}
        </span>
        <RarityStars rarity={lightcone.rarity} />
      </div>
    </Link>
  );
}

/** 区块标题（右对齐的「查看全部」链接） */
function SectionTitle({ title, viewAllTo }: { title: string; viewAllTo?: string }): ReactNode {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between gap-2">
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      {viewAllTo ? (
        <Link to={viewAllTo} className="shrink-0 text-xs text-accent hover:underline">
          {t('home.viewAll')}
        </Link>
      ) : null}
    </div>
  );
}

/** 空态区块（最近浏览 / 收藏速览共用） */
function EmptyHint({ title, description }: { title: string; description: string }): ReactNode {
  return (
    <div className="flex flex-col items-start gap-1 rounded-btn border border-dashed border-line px-4 py-6">
      <span className="text-sm text-ink">{title}</span>
      <span className="text-xs leading-relaxed text-dim">{description}</span>
    </div>
  );
}

/** 收藏速览（store 接线 + 加载态 + 最多 6 行） */
function FavoritesPreview(): ReactNode {
  const { t } = useTranslation();
  const lang = useSettingsStore((state) => state.prefs.lang);
  const items = useFavoritesStore((state) => state.items);
  const loaded = useFavoritesStore((state) => state.loaded);
  const hydrate = useFavoritesStore((state) => state.hydrate);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  if (!loaded) {
    return <SkeletonBlock lines={3} titleHeight={14} lineHeight={14} />;
  }

  const favorites = sortedFavorites(items).slice(0, 6);
  if (favorites.length === 0) {
    return (
      <EmptyHint
        title={t('home.favoritesEmpty.title')}
        description={t('home.favoritesEmpty.desc')}
      />
    );
  }

  const moduleLabel: Record<string, string> = {
    character: t('nav.characters'),
    lightcone: t('nav.lightcones'),
    relicset: t('nav.relics'),
    monster: t('nav.monsters'),
    item: t('nav.items'),
    achievementSeries: t('nav.achievements'),
  };
  const detailRoute: Record<string, (id: string) => string> = {
    character: (id) => `/characters/${id}`,
    lightcone: (id) => `/lightcones/${id}`,
    relicset: (id) => `/relics/${id}`,
    monster: (id) => `/monsters/${encodeURIComponent(id)}`,
    item: (id) => `/items/${id}`,
    achievementSeries: () => '/achievements',
  };

  return (
    <ul className="flex flex-col gap-1">
      {favorites.map((entry) => (
        <li key={`${entry.module}:${entry.id}`}>
          <Link
            to={(detailRoute[entry.module] ?? (() => '/'))(entry.id)}
            className="flex items-center gap-2 rounded-btn border border-line bg-elev px-3 py-2 no-underline transition-colors duration-fast hover:border-accent"
          >
            <span className="min-w-0 flex-1 truncate text-sm text-ink">
              {pickName(entry.nameSnapshot, lang, entry.id)}
            </span>
            <span className="shrink-0 text-xs text-dim">{moduleLabel[entry.module] ?? ''}</span>
            <ChevronRightOutlined style={{ fontSize: 16 }} className="shrink-0 text-dim" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** 首页 */
export default function HomePage(): ReactNode {
  const { t } = useTranslation();
  const lang = useSettingsStore((state) => state.prefs.lang);

  // 米游社只有简体中文内容：非中文界面整个公告/资讯区块不渲染，也不发请求
  const showNews = lang === 'zh';
  const news = useNewsFeeds(showNews);

  const [newItems, setNewItems] = useState<NewItems>(EMPTY_NEW_ITEMS);

  // 加载 diff.json 得到版本号与新增列表；用 id 匹配索引补齐立绘/属性/命途/星级
  useEffect(() => {
    let cancelled = false;
    setNewItems(EMPTY_NEW_ITEMS);
    void (async () => {
      try {
        const bundle = await getDiffBundle(lang);
        if (cancelled) return;
        const added = bundle.items.filter((item) => item.status === 'added');
        const characters = dal.getIndex('character');
        const lightcones = dal.getIndex('lightcone');
        if (cancelled) return;
        const resolved = resolveNewItems(added, characters, lightcones);
        setNewItems({
          loading: false,
          characters: resolved.characters,
          lightcones: resolved.lightcones,
          fromVersion: bundle.fromVersion,
          toVersion: bundle.toVersion,
        });
      } catch {
        if (cancelled) return;
        setNewItems({ loading: false, characters: [], lightcones: [] });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [lang]);

  const bootInfo = dal.bootInfo;
  const dataVersionLabel = useDataVersionLabel();
  const versionBadge = `${t('common.version')} ${dataVersionLabel}`;

  // 首页「最新数据版本」优先用远端 manifest 看到的版本：
  // 数据包还没更新时，diff.toVersion 仍是旧版本，不能代表“最新”。
  const dataVersion = useDataViewStore((state) => state.version);
  const live = dataVersion === 'live';
  const visibleCharacters = live
    ? newItems.characters.filter((entry) => !isExcludedFromLive('character', entry.id))
    : newItems.characters;
  const visibleLightcones = live
    ? newItems.lightcones.filter((entry) => !isExcludedFromLive('lightcone', entry.id))
    : newItems.lightcones;
  const latestKnownVersion = useUpdaterStore((state) => state.latestVersion);
  const latestCandidates = [newItems.toVersion, latestKnownVersion, bootInfo?.gameVersion].filter(
    (value): value is string => typeof value === 'string' && value !== '',
  );
  const latestDataVersion = latestCandidates.reduce<string | undefined>(
    (best, value) => (best === undefined || compareVersions(value, best) > 0 ? value : best),
    undefined,
  );

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={t('home.title')} badge={versionBadge} />

      {/* 版本卡片区：最新数据版本 / 正式版本（来自 diff.json） */}
      {newItems.loading ? (
        <SkeletonBlock lines={2} titleHeight={48} lineHeight={48} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <VersionCard
            label={t('home.latestVersion')}
            value={latestDataVersion ?? '—'}
            accent
          />
          <VersionCard
            label={t('home.releaseVersion')}
            value={newItems.fromVersion ?? '—'}
            accent={false}
          />
        </div>
      )}

      {/* 公告 / 资讯（米游社实时拉取；米游社只有简中内容，非中文界面不渲染） */}
      {showNews ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <NewsCard
            title={t('home.notice')}
            icon={<CampaignOutlined style={{ fontSize: 18 }} />}
            state={news.notice}
            refreshing={news.refreshing}
            onRefresh={news.refresh}
          />
          <NewsCard
            title={t('home.news')}
            icon={<ArticleOutlined style={{ fontSize: 18 }} />}
            state={news.news}
            refreshing={news.refreshing}
            onRefresh={news.refresh}
          />
        </div>
      ) : null}

      {/* 新增角色 / 新增光锥（双栏） */}
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="flex flex-col gap-3">
          <SectionTitle title={t('home.newCharacters')} viewAllTo="/characters" />
          {newItems.loading ? (
            <SkeletonBlock lines={2} titleHeight={160} lineHeight={160} />
          ) : visibleCharacters.length > 0 ? (
            <div className="grid grid-cols-2 gap-3">
              {visibleCharacters.map((character) => (
                <NewCharacterCard key={character.id} character={character} />
              ))}
            </div>
          ) : (
            <EmptyHint title={t('home.newCharacters')} description={t('home.dataReady')} />
          )}
        </section>

        <section className="flex flex-col gap-3">
          <SectionTitle title={t('home.newLightcones')} viewAllTo="/lightcones" />
          {newItems.loading ? (
            <SkeletonBlock lines={2} titleHeight={160} lineHeight={160} />
          ) : visibleLightcones.length > 0 ? (
            <div className="grid grid-cols-2 gap-3">
              {visibleLightcones.map((lightcone) => (
                <NewLightconeCard key={lightcone.id} lightcone={lightcone} />
              ))}
            </div>
          ) : (
            <EmptyHint title={t('home.newLightcones')} description={t('home.dataReady')} />
          )}
        </section>
      </div>

      {/* 收藏速览 */}
      <section className="hsr-panel flex flex-col gap-3 p-5">
        <SectionTitle title={t('home.favorites')} viewAllTo="/favorites" />
        <FavoritesPreview />
      </section>
    </div>
  );
}
