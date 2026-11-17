/**
 * 首页「公告 / 资讯」卡片
 *
 * 卡片结构与「新增角色 / 新增光锥」保持同一套视觉语言：
 * `hsr-panel` + `rounded-card` + `border-line` + `p-5`，靠 `h-full` 与同行卡片等高。
 *
 * 每行固定 `min-h-[3.5rem]` 且标题可折两行，5 行下来高度与旁边
 * 「新增角色」区块（竖版立绘卡）基本齐平——这是用户明确要求的效果。
 *
 * 行是 `<button>` 而不是 `<a>`：点击要走系统浏览器（Tauri opener），
 * 不能在 WebView 内导航，否则等于把本地应用变成了浏览器。
 */

import ChevronRightOutlined from '@mui/icons-material/ChevronRightOutlined';
import RefreshOutlined from '@mui/icons-material/RefreshOutlined';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { SkeletonBlock } from '@/components/common/SkeletonBlock';
import { articleUrl } from '@/lib/news/miyoushe';
import type { FeedState } from '@/lib/news/useNewsFeeds';
import { openExternal } from '@/lib/openExternal';

/** 每张卡固定条数（不足补空行，保证卡片高度不抖） */
const ROW_COUNT = 5;

export interface NewsCardProps {
  /** 卡片标题（公告 / 资讯） */
  readonly title: string;
  /** 标题左侧图标 */
  readonly icon: ReactNode;
  /** 该类内容的状态 */
  readonly state: FeedState;
  /** 是否正在重新拉取 */
  readonly refreshing: boolean;
  /** 点刷新按钮 */
  readonly onRefresh: () => void;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * 秒级时间戳 → `MM-DD`（行首日期）
 *
 * 米游社的 `created_at` 是 UTC+8 语义的绝对时间，直接用本机时区渲染即可，
 * 不做时区换算——用户看的是「哪天发的」，不是跨时区会议时间。
 */
function formatDay(seconds: number): string {
  const date = new Date(seconds * 1000);
  return `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** 毫秒级时间戳 → `MM-DD HH:mm`（底部「更新于 / 缓存」） */
function formatStamp(milliseconds: number): string {
  const date = new Date(milliseconds);
  return `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/** 单行：日期 + 标题（两行折行）+ 箭头 */
function NewsRow({ id, title, createdAt }: { id: string; title: string; createdAt: number }): ReactNode {
  return (
    <li>
      <button
        type="button"
        onClick={() => {
          void openExternal(articleUrl(id));
        }}
        className="group flex min-h-[3.5rem] w-full items-center gap-2 rounded-btn px-2 py-2 text-left transition-colors duration-fast hover:bg-elev"
        title={title}
      >
        <span className="shrink-0 text-xs tabular-nums text-dim">{formatDay(createdAt)}</span>
        <span className="line-clamp-2 flex-1 text-sm leading-snug text-ink">{title}</span>
        <ChevronRightOutlined
          style={{ fontSize: 16 }}
          className="shrink-0 text-dim transition-colors duration-fast group-hover:text-accent"
        />
      </button>
    </li>
  );
}

/** 空占位行：条目不足 5 时撑住高度，避免卡片忽高忽低 */
function EmptyRow({ index }: { index: number }): ReactNode {
  return <li key={`empty-${index}`} className="min-h-[3.5rem]" aria-hidden="true" />;
}

/** 公告 / 资讯卡片 */
export function NewsCard({ title, icon, state, refreshing, onRefresh }: NewsCardProps): ReactNode {
  const { t } = useTranslation();

  const rows = state.items.slice(0, ROW_COUNT);
  const placeholders = Math.max(0, ROW_COUNT - rows.length);
  const busy = refreshing || state.status === 'loading';

  /** 底部一行：数据新鲜度 */
  let footer: ReactNode = null;
  if (state.status === 'ready' && state.fetchedAt !== undefined) {
    footer = <span>{t('home.newsUpdated', { time: formatStamp(state.fetchedAt) })}</span>;
  } else if (state.status === 'fallback') {
    footer =
      state.fetchedAt === undefined ? (
        <span>{t('home.newsFailed')}</span>
      ) : (
        <span>{t('home.newsCached', { time: formatStamp(state.fetchedAt) })}</span>
      );
  }

  return (
    <section className="hsr-panel flex h-full flex-col gap-3 rounded-card border border-line p-5">
      <div className="flex items-center gap-2">
        <span className="text-accent">{icon}</span>
        <h2 className="flex-1 text-sm font-semibold text-ink">{title}</h2>
        <Tooltip title={t('home.newsRefresh')} arrow>
          <span>
            <IconButton
              size="small"
              aria-label={t('home.newsRefresh')}
              disabled={busy}
              onClick={onRefresh}
            >
              <RefreshOutlined style={{ fontSize: 16 }} />
            </IconButton>
          </span>
        </Tooltip>
      </div>

      {state.status === 'loading' ? (
        <div className="flex-1">
          <SkeletonBlock lines={ROW_COUNT} titleHeight={44} lineHeight={44} />
        </div>
      ) : state.status === 'error' ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-6">
          <span className="text-xs text-dim">{t('home.newsFailed')}</span>
          <button
            type="button"
            onClick={onRefresh}
            className="rounded-btn border border-line px-3 py-1 text-xs text-accent transition-colors duration-fast hover:border-accent"
          >
            {t('home.newsRefresh')}
          </button>
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-1 items-center justify-center py-6">
          <span className="text-xs text-dim">{t('home.newsEmpty')}</span>
        </div>
      ) : (
        <ul className="flex flex-1 flex-col gap-1">
          {rows.map((item) => (
            <NewsRow key={item.id} id={item.id} title={item.title} createdAt={item.createdAt} />
          ))}
          {Array.from({ length: placeholders }, (_unused, index) => (
            <EmptyRow key={`placeholder-${index}`} index={index} />
          ))}
        </ul>
      )}

      {footer === null ? null : <div className="text-xs text-dim">{footer}</div>}
    </section>
  );
}
