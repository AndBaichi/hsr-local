/**
 * 本地便签板（v2.15）
 *
 * 「一面便签墙」：每张便签可以写标题/正文、换配色、上传图片或附件。
 * 数据在 `stores/localNotes.ts`，本组件只负责草稿与交互：
 *
 *  - 标题/正文用**本地草稿**（与实体笔记同一套理由：store 每敲一个字都更新
 *    `updatedAt`，若 textarea 直接受控于 store，光标会被重渲染打断）。
 *  - 附件上传：系统对话框选文件 → Rust 复制进 `$APPDATA/notes/media/` → 只把
 *    元数据写进便签。图片用 asset 协议内联预览，其它文件交给系统默认程序打开。
 *  - 删除便签/附件是两步确认（第一次点变成「确认删除」），避免误删。
 */

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { openNotesMedia, notesMediaUrl } from '@/lib/ipc/notesMedia';
import {
  LOCAL_NOTE_COLORS,
  LOCAL_NOTE_MAX_ATTACHMENTS,
  LOCAL_NOTE_MAX_LENGTH,
  LOCAL_NOTE_TITLE_MAX,
  type LocalNote,
  type LocalNoteAttachment,
  type LocalNoteColor,
} from '@/lib/userdata/types';
import { pickAndImportMedia, sortedLocalNotes, useLocalNotesStore } from '@/stores/localNotes';
import { useSettingsStore } from '@/stores/settings';

/** 字节数 → 人读大小 */
function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size < 0) return '—';
  if (size < 1024) return `${Math.round(size)} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

/** ISO 时间 → 本地化日期时间 */
function formatStamp(iso: string, lang: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString(lang);
}

/** 便签卡的配色样式（颜色只在 tokens.css 定义） */
function cardStyle(color: LocalNoteColor): CSSProperties {
  return {
    backgroundColor: `var(--hsr-note-${color})`,
    borderColor: `var(--hsr-note-${color}-line)`,
  };
}

/** 单张便签 */
function LocalNoteCard({ note }: { readonly note: LocalNote }): ReactNode {
  const { t } = useTranslation();
  const lang = useSettingsStore((state) => state.prefs.lang);
  const mediaDir = useLocalNotesStore((state) => state.mediaDir);
  const updateNote = useLocalNotesStore((state) => state.updateNote);
  const removeNote = useLocalNotesStore((state) => state.removeNote);
  const addAttachments = useLocalNotesStore((state) => state.addAttachments);
  const removeAttachment = useLocalNotesStore((state) => state.removeAttachment);

  const [titleDraft, setTitleDraft] = useState(note.title);
  const [contentDraft, setContentDraft] = useState(note.content);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  // 只有切换到「另一张便签」时才用 store 内容重置草稿（组件按 id 作 key，一般不会复用）
  useEffect(() => {
    setTitleDraft(note.title);
    setContentDraft(note.content);
  }, [note.id]);

  const handleTitle = (value: string): void => {
    setTitleDraft(value);
    updateNote(note.id, { title: value });
  };
  const handleContent = (value: string): void => {
    setContentDraft(value);
    updateNote(note.id, { content: value });
  };

  const handleAdd = async (imageOnly: boolean): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const media = await pickAndImportMedia({
        multiple: true,
        imageOnly,
        title: imageOnly ? (t('notes.addImage') as string) : (t('notes.addFile') as string),
        filterLabel: imageOnly ? (t('notes.addImage') as string) : undefined,
      });
      if (media.length === 0) return;
      addAttachments(note.id, media);
    } catch {
      setError(t('notes.uploadFailed') as string);
    } finally {
      setBusy(false);
    }
  };

  const handleOpen = (attachment: LocalNoteAttachment): void => {
    void openNotesMedia(attachment.storedName).catch(() => setError(t('notes.uploadFailed') as string));
  };

  const images = note.attachments.filter((attachment) => attachment.kind === 'image');
  const files = note.attachments.filter((attachment) => attachment.kind !== 'image');
  const atLimit = note.attachments.length >= LOCAL_NOTE_MAX_ATTACHMENTS;

  return (
    <div
      className="relative flex min-w-0 flex-col gap-2 overflow-hidden rounded-card border p-3"
      style={cardStyle(note.color)}
    >
      {/* 顶部色条：深色主题下 16% 透明度的底色不够显眼，用一条实色告诉用户这是哪张便签 */}
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 h-1"
        style={{ backgroundColor: `var(--hsr-note-${note.color}-line)` }}
      />
      <div className="flex items-start gap-2">
        <input
          value={titleDraft}
          onChange={(event) => handleTitle(event.target.value)}
          maxLength={LOCAL_NOTE_TITLE_MAX}
          placeholder={t('notes.titlePlaceholder') as string}
          aria-label={t('notes.titlePlaceholder') as string}
          className="min-w-0 flex-1 border-0 bg-transparent text-sm font-semibold text-ink outline-none placeholder:font-normal placeholder:text-dim"
        />
        <button
          type="button"
          onClick={() => {
            if (!confirmDelete) {
              setConfirmDelete(true);
              return;
            }
            removeNote(note.id);
          }}
          onBlur={() => setConfirmDelete(false)}
          className={`shrink-0 rounded-btn border border-line bg-panel px-2 py-1 text-[11px] ${
            confirmDelete ? 'text-danger' : 'text-dim hover:text-danger'
          }`}
        >
          {confirmDelete ? (t('notes.deleteNoteConfirm') as string) : (t('notes.deleteNote') as string)}
        </button>
      </div>

      <textarea
        value={contentDraft}
        onChange={(event) => handleContent(event.target.value)}
        maxLength={LOCAL_NOTE_MAX_LENGTH}
        placeholder={t('notes.bodyPlaceholder') as string}
        aria-label={t('notes.bodyPlaceholder') as string}
        className="min-h-28 w-full resize-y border-0 bg-transparent text-sm leading-relaxed text-ink outline-none placeholder:text-dim"
      />

      {images.length > 0 ? (
        <div className="grid grid-cols-2 gap-1.5">
          {images.map((attachment) => (
            <div key={attachment.id} className="group relative overflow-hidden rounded-btn border border-line bg-panel">
              <button
                type="button"
                onClick={() => handleOpen(attachment)}
                title={attachment.fileName}
                className="block h-28 w-full"
              >
                <img
                  src={notesMediaUrl(mediaDir, attachment.storedName)}
                  alt={attachment.fileName}
                  loading="lazy"
                  className="h-28 w-full object-contain"
                />
              </button>
              <button
                type="button"
                onClick={() => removeAttachment(note.id, attachment.id)}
                title={t('notes.removeAttachment') as string}
                aria-label={t('notes.removeAttachment') as string}
                className="absolute right-1 top-1 rounded-full border border-line bg-panel px-1.5 text-[11px] leading-5 text-dim opacity-0 transition-opacity group-hover:opacity-100 hover:text-danger"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {files.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {files.map((attachment) => (
            <li
              key={attachment.id}
              className="flex items-center gap-2 rounded-btn border border-line bg-panel px-2 py-1"
            >
              <button
                type="button"
                onClick={() => handleOpen(attachment)}
                title={t('notes.openAttachment') as string}
                className="min-w-0 flex-1 truncate text-left text-xs text-ink hover:text-accent"
              >
                {attachment.fileName}
              </button>
              <span className="shrink-0 tabular-nums text-[11px] text-dim">
                {formatBytes(attachment.size)}
              </span>
              <button
                type="button"
                onClick={() => removeAttachment(note.id, attachment.id)}
                title={t('notes.removeAttachment') as string}
                aria-label={t('notes.removeAttachment') as string}
                className="shrink-0 text-[11px] text-dim hover:text-danger"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {error !== '' ? <p className="text-[11px] text-danger">{error}</p> : null}

      <div className="flex flex-wrap items-center gap-1.5 border-t border-line pt-2">
        <button
          type="button"
          disabled={busy || atLimit}
          onClick={() => void handleAdd(true)}
          className="rounded-btn border border-line bg-elev px-2 py-1 text-[11px] text-ink hover:border-accent disabled:opacity-40"
        >
          {t('notes.addImage') as string}
        </button>
        <button
          type="button"
          disabled={busy || atLimit}
          onClick={() => void handleAdd(false)}
          className="rounded-btn border border-line bg-elev px-2 py-1 text-[11px] text-ink hover:border-accent disabled:opacity-40"
        >
          {t('notes.addFile') as string}
        </button>

        <div className="ml-auto flex items-center gap-1" role="group" aria-label={t('notes.color') as string}>
          {LOCAL_NOTE_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              onClick={() => updateNote(note.id, { color })}
              title={t('notes.color') as string}
              aria-label={`${t('notes.color') as string} ${color}`}
              aria-pressed={note.color === color}
              className={`h-3.5 w-3.5 rounded-full border transition-transform hover:scale-110 ${
                note.color === color ? 'border-ink' : 'border-line'
              }`}
              style={{ backgroundColor: `var(--hsr-note-${color}-line)` }}
            />
          ))}
        </div>
      </div>

      <span className="text-[11px] text-dim">
        {t('notes.editedAt', { date: formatStamp(note.updatedAt, lang) }) as string}
      </span>
    </div>
  );
}

/** 便签板容器 */
export function LocalNotesBoard(): ReactNode {
  const { t } = useTranslation();
  const notes = useLocalNotesStore((state) => state.notes);
  const loaded = useLocalNotesStore((state) => state.loaded);

  const sorted = sortedLocalNotes(notes);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-dim">{t('notes.localHint') as string}</p>

      {!loaded ? <p className="text-xs text-dim">{t('common.loading') as string}</p> : null}

      {loaded && sorted.length === 0 ? (
        <div className="hsr-panel flex flex-col items-center gap-2 rounded-card border border-line p-8 text-center">
          <p className="text-sm font-semibold text-ink">{t('notes.localEmptyTitle') as string}</p>
          <p className="text-xs leading-relaxed text-dim">{t('notes.localEmptyDesc') as string}</p>
        </div>
      ) : null}

      {loaded && sorted.length > 0 ? (
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}
        >
          {sorted.map((note) => (
            <LocalNoteCard key={note.id} note={note} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
