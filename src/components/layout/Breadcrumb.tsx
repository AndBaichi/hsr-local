/**
 * 面包屑（架构文档 §8.7 Breadcrumb、PRD §4.3「模块 › 实体名」）
 *
 * 由路由自动推导，无状态。
 * 实体名（`:id` 段）在 T03 接入 DAL 后替换为实体真实名称并补上模块内链；
 * 当前直接展示 id —— 这是**如实展示**，不是占位符。
 */

import KeyboardArrowRightOutlined from '@mui/icons-material/KeyboardArrowRightOutlined';
import HomeOutlined from '@mui/icons-material/HomeOutlined';
import type { TFunction } from 'i18next';
import { Fragment, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router-dom';

import { CURRENCY_KINDS, ENDGAME_MODES } from '@/lib/data/extra';

/** 允许出现在面包屑里的固定段 → i18n key 映射 */
type CrumbLabelKey =
  | 'nav.library'
  | 'nav.characters'
  | 'nav.lightcones'
  | 'nav.relics'
  | 'nav.monsters'
  | 'nav.items'
  | 'nav.achievements'
  | 'nav.compare'
  | 'nav.map'
  | 'nav.favorites'
  | 'nav.notes'
  | 'nav.settings'
  | 'nav.home'
  | 'nav.changelog'
  | 'nav.endgame'
  | 'nav.currency'
  | 'topbar.search';

/** 一级路径 → 显示名 */
const SEGMENT_LABELS: Readonly<Record<string, CrumbLabelKey>> = {
  characters: 'nav.characters',
  lightcones: 'nav.lightcones',
  relics: 'nav.relics',
  monsters: 'nav.monsters',
  items: 'nav.items',
  achievements: 'nav.achievements',
  map: 'nav.map',
  compare: 'nav.compare',
  favorites: 'nav.favorites',
  notes: 'nav.notes',
  settings: 'nav.settings',
  search: 'topbar.search',
  changelog: 'nav.changelog',
  endgame: 'nav.endgame',
  currency: 'nav.currency',
};

/**
 * 二级路径段的显示名。
 *
 * `:kind`（role / item / buff …）与 `:mode`（maze / story / boss / peak）在路由里是英文 key，
 * 直接拼进面包屑会露出英文；这里换成与页面标题一致的译文，取不到时原样返回。
 *
 * @param first 一级段（currency / endgame …）
 * @param segment 二级段原文
 * @param t 翻译函数
 */
function subSegmentLabel(first: string, segment: string, t: TFunction): string {
  if (first === 'currency') {
    const kind = CURRENCY_KINDS.find((entry) => entry.key === segment);
    if (kind) return t(`currency.${kind.navKey}` as 'currency.currencyRole');
  }
  if (first === 'endgame') {
    const mode = ENDGAME_MODES.find((entry) => entry.key === segment);
    if (mode) return t(`endgame.${mode.navKey}` as 'endgame.endgameMoc');
  }
  return segment;
}

/** 归属「资料库」分组的模块（用于在面包屑前面补一个分组标签） */
const LIBRARY_SEGMENTS: ReadonlySet<string> = new Set([
  'characters',
  'lightcones',
  'relics',
  'monsters',
  'items',
  'achievements',
]);

/** 单个面包屑节点 */
interface Crumb {
  /** 显示文本 */
  readonly label: string;
  /** 目标路径；`undefined` 表示纯文本（分组名 / 当前页） */
  readonly to?: string;
}

/** 面包屑 */
export function Breadcrumb(): ReactNode {
  const { t } = useTranslation();
  const location = useLocation();

  const segments = location.pathname.split('/').filter((segment) => segment.length > 0);
  const crumbs: Crumb[] = [];

  if (segments.length === 0) {
    crumbs.push({ label: t('breadcrumb.home') });
  } else {
    const [first, ...rest] = segments;
    if (first && LIBRARY_SEGMENTS.has(first)) {
      crumbs.push({ label: t('nav.library') });
    }

    let accumulated = '';
    if (first) {
      accumulated = `/${first}`;
      const labelKey = SEGMENT_LABELS[first];
      crumbs.push({
        label: labelKey ? t(labelKey) : first,
        to: rest.length > 0 ? accumulated : undefined,
      });
    }

    // 详情页的 id 段：T01 直接展示 id（真实数据接入后替换为实体名）
    for (const segment of rest) {
      accumulated = `${accumulated}/${segment}`;
      crumbs.push({ label: subSegmentLabel(first ?? '', segment, t), to: undefined });
    }
  }

  return (
    <nav aria-label="面包屑导航" className="flex min-w-0 items-center gap-1 text-sm">
      <Link
        to="/"
        className="flex items-center gap-1 rounded-btn px-1 py-[2px] text-dim no-underline hover:bg-elev hover:text-ink"
        aria-label={t('breadcrumb.home')}
      >
        <HomeOutlined style={{ fontSize: 15 }} />
      </Link>

      {crumbs.map((crumb, index) => (
        <Fragment key={`crumb-${index}-${crumb.label}`}>
          <KeyboardArrowRightOutlined style={{ fontSize: 14 }} className="shrink-0 text-dim" />
          {crumb.to ? (
            <Link
              to={crumb.to}
              className="truncate rounded-btn px-1 py-[2px] text-dim no-underline hover:bg-elev hover:text-ink"
            >
              {crumb.label}
            </Link>
          ) : (
            <span className="truncate px-1 py-[2px] text-ink">{crumb.label}</span>
          )}
        </Fragment>
      ))}
    </nav>
  );
}
