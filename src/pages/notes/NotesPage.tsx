/**
 * 我的笔记页（PRD §4.2 页面 16 / T05）
 *
 * 数据源是 `useNotesStore`（`userdata/notes.json`）。每次输入都调用 `setNote`，
 * 由 store 负责 600ms 逐实体防抖与落盘，本页面不自建第二份持久化状态。
 *
 * 但 textarea 需要一份「每条笔记独立的本地草稿」：setNote 会更新 updatedAt，
 * 让 sortedNotes 重排；若 textarea 直接受控于 store 内容，重排会重置光标、
 * 打断连续输入。草稿只在「切换到另一条笔记」时同步，编辑期间以草稿为准。
 * 清空草稿（空串）会触发 store 的「清空即删除」，该卡片自然从列表消失。
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { PagePlaceholder } from '@/components/common/PagePlaceholder';
import { SkeletonCardGrid } from '@/components/common/SkeletonBlock';
import { PageHeader } from '@/components/layout/PageHeader';
import { LocalNotesBoard } from '@/pages/notes/LocalNotesBoard';
import type { ModuleKey } from '@/lib/data/types';
import { detailRouteOf, MODULE_LABEL_KEYS } from '@/lib/entities';
import type { Lang } from '@/i18n';
import { NOTE_MAX_LENGTH, entityKeyOf, pickName, type NoteEntry } from '@/lib/userdata/types';
import { useLocalNotesStore } from '@/stores/localNotes';
import { sortedNotes, useNotesStore } from '@/stores/notes';
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

/** ISO8601 → 本地化日期时间；非法值原样返回，永不打印 undefined */
function shortDateTime(iso: string, lang: Lang): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString(lang);
}

/** 单条笔记卡：本地草稿 + 每次改动写 store */
function NoteCard({ entry }: { readonly entry: NoteEntry }): ReactNode {
  const { t } = useTranslation();
  const lang = useSettingsStore((state) => state.prefs.lang);
  const [draft, setDraft] = useState(entry.content);

  // 仅当切换到「另一条笔记」时用 store 内容重置草稿；
  // 同一次编辑引发的重渲染（updatedAt 变化、列表重排）不覆盖草稿，光标不跳。
  useEffect(() => {
    setDraft(entry.content);
  }, [entry.module, entry.id]);

  const handleChange = (value: string): void => {
    setDraft(value);
    useNotesStore.getState().setNote(
      { module: entry.module, id: entry.id, nameSnapshot: entry.nameSnapshot },
      value,
    );
  };

  const name = pickName(entry.nameSnapshot, lang, entry.id);
  const to = detailRoute(entry.module, entry.id);

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
        <button
          type="button"
          onClick={() => useNotesStore.getState().removeNote(entry.module, entry.id)}
          className="shrink-0 rounded-btn border border-line bg-elev px-2.5 py-1 text-xs text-dim hover:text-danger"
        >
          {t('notes.remove') as string}
        </button>
      </div>

      <textarea
        value={draft}
        onChange={(event) => handleChange(event.target.value)}
        maxLength={NOTE_MAX_LENGTH}
        placeholder={t('notes.placeholder') as string}
        aria-label={name}
        className="h-28 w-full resize-y rounded-btn border border-line bg-elev p-2 text-sm leading-relaxed text-ink outline-none placeholder:text-dim focus:border-accent"
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="tabular-nums text-[11px] text-dim">
          {t('notes.chars', { count: draft.length, max: NOTE_MAX_LENGTH }) as string}
        </span>
        <span className="text-[11px] text-dim">{t('notes.saved') as string}</span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] text-dim">
          {t('notes.editedAt', { date: shortDateTime(entry.updatedAt, lang) }) as string}
        </span>
        <Link to={to} className="text-xs text-accent hover:underline">
          {t('notes.open') as string}
        </Link>
      </div>
    </div>
  );
}

/** 我的笔记页 */
export default function NotesPage(): ReactNode {
  const { t } = useTranslation();
  const items = useNotesStore((state) => state.items);
  const loaded = useNotesStore((state) => state.loaded);
  const clear = useNotesStore((state) => state.clear);
  const localNotes = useLocalNotesStore((state) => state.notes);
  const localLoaded = useLocalNotesStore((state) => state.loaded);
  const [confirmClear, setConfirmClear] = useState(false);
  // 两种笔记的存储、写盘节奏、empty state 都不同，分页签而不是混排在一格里
  const [tab, setTab] = useState<'entity' | 'local'>('entity');

  // hydrate 幂等；未读完磁盘前显示骨架，绝不显示「还没有笔记」
  useEffect(() => {
    void useNotesStore.getState().hydrate();
    void useLocalNotesStore.getState().hydrate();
  }, []);

  const sorted = useMemo(() => sortedNotes(items), [items]);
  const activeCount = tab === 'entity' ? sorted.length : localNotes.length;
  const activeLoaded = tab === 'entity' ? loaded : localLoaded;

  return (
    <div className="flex flex-col gap-4 pt-2">
      <PageHeader
        title={t('notes.title') as string}
        description={t('notes.sub') as string}
        count={activeLoaded ? activeCount : undefined}
        countLabel={activeLoaded ? (t('common.count', { count: activeCount }) as string) : undefined}
        actions={
          tab === 'entity' ? (
            <button
              type="button"
              disabled={!loaded || sorted.length === 0}
              onClick={() => setConfirmClear(true)}
              className="rounded-btn border border-line bg-elev px-3 py-1.5 text-xs text-ink hover:border-accent disabled:opacity-40"
            >
              {t('notes.clear') as string}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => useLocalNotesStore.getState().createNote()}
              className="rounded-btn border border-accent bg-elev px-3 py-1.5 text-xs text-accent hover:border-accent"
            >
              ＋ {t('notes.newNote') as string}
            </button>
          )
        }
      />

      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label={t('notes.title') as string}>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'entity'}
          onClick={() => {
            setTab('entity');
            setConfirmClear(false);
          }}
          className={`rounded-btn border px-3 py-1.5 text-xs transition-colors duration-fast ${
            tab === 'entity'
              ? 'border-accent bg-elev text-accent'
              : 'border-line bg-elev text-dim hover:text-ink'
          }`}
        >
          {t('notes.tabEntity') as string}
          {loaded ? ` · ${sorted.length}` : ''}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'local'}
          onClick={() => {
            setTab('local');
            setConfirmClear(false);
          }}
          className={`rounded-btn border px-3 py-1.5 text-xs transition-colors duration-fast ${
            tab === 'local'
              ? 'border-accent bg-elev text-accent'
              : 'border-line bg-elev text-dim hover:text-ink'
          }`}
        >
          {t('notes.tabLocal') as string}
          {localLoaded ? ` · ${localNotes.length}` : ''}
        </button>
      </div>

      {tab === 'local' ? <LocalNotesBoard /> : null}

      {tab === 'entity' ? (
        <>
          {confirmClear ? (
            <div className="flex flex-wrap items-center gap-2 rounded-btn border border-line bg-elev px-3 py-2">
              <span className="min-w-0 flex-1 text-xs text-ink">{t('notes.clearConfirm') as string}</span>
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
              <p className="text-sm font-semibold text-ink">{t('notes.emptyTitle') as string}</p>
              <p className="text-xs leading-relaxed text-dim">{t('notes.emptyDesc') as string}</p>
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
                <NoteCard key={entityKeyOf(entry.module, entry.id)} entry={entry} />
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
