/**
 * 本地便签 store（v2.15，`userdata/localnotes.json`）
 *
 * 与实体笔记（`stores/notes.ts`，键是 `module:id`）**完全分开**：本地便签不绑定
 * 任何资料库条目，是自由文本 + 图片/附件的便签板。
 *
 * ## 数据形状
 *
 * 磁盘上：`{ notes: LocalNote[] }`，600ms 防抖后整体写入（与实体笔记同档）。
 * 附件本体在 `$APPDATA/notes/media/`，JSON 里只有元数据。
 *
 * ## 为什么编辑时不做重排
 *
 * 实体笔记按 `updatedAt` 倒序，每敲一个字都可能把卡片挪到最前；便签是"一面墙"，
 * 编辑时位置跳动会让人抓不到自己在写哪张。这里固定按 `createdAt` 倒序（新建的在
 * 最前），`updatedAt` 只展示、不参与排序。
 */

import { create } from 'zustand';

import {
  deleteNotesMedia,
  importNotesMedia,
  notesMediaDir,
  type ImportedMedium,
} from '@/lib/ipc/notesMedia';
import { readUserData, scheduleWriteUserData } from '@/lib/ipc/userdata';
import {
  coerceLocalNotes,
  LOCAL_NOTE_COLORS,
  LOCAL_NOTE_MAX_ATTACHMENTS,
  LOCAL_NOTE_MAX_LENGTH,
  LOCAL_NOTE_TITLE_MAX,
  type LocalNote,
  type LocalNoteAttachment,
  type LocalNoteColor,
} from '@/lib/userdata/types';

/** 可编辑字段 */
export interface LocalNotePatch {
  /** 标题 */
  readonly title?: string;
  /** 正文 */
  readonly content?: string;
  /** 配色 */
  readonly color?: LocalNoteColor;
}

/** store 状态与动作 */
export interface LocalNotesState {
  /** 全部便签（新建在前） */
  readonly notes: readonly LocalNote[];
  /** 媒体目录绝对路径（hydrate 后才有；拼 asset URL 用） */
  readonly mediaDir: string;
  /** 是否已从磁盘读完 */
  readonly loaded: boolean;
  /** 从 `userdata/localnotes.json` 载入（幂等） */
  hydrate: () => Promise<void>;
  /** 新建一张便签，返回 id */
  createNote: () => string;
  /** 更新标题/正文/配色 */
  updateNote: (id: string, patch: LocalNotePatch) => void;
  /** 删除便签（连同它的媒体文件） */
  removeNote: (id: string) => void;
  /** 追加附件（由调用方先 `importNotesMedia`） */
  addAttachments: (id: string, media: readonly ImportedMedium[]) => void;
  /** 移除单个附件（连同媒体文件） */
  removeAttachment: (id: string, attachmentId: string) => void;
}

/** 落盘（整体写入 `{ notes }`） */
function persist(notes: readonly LocalNote[]): void {
  scheduleWriteUserData('localnotes', { notes });
}

/** 当前时间 ISO */
function nowIso(): string {
  return new Date().toISOString();
}

/** 生成一个便签 id（WebView2 支持 crypto.randomUUID） */
function newNoteId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 附件元数据 → LocalNoteAttachment */
function toAttachment(medium: ImportedMedium): LocalNoteAttachment {
  return {
    id: medium.id,
    fileName: medium.fileName,
    storedName: medium.storedName,
    kind: medium.kind,
    size: medium.size,
    addedAt: new Date().toISOString(),
  };
}

/** 本地便签 store */
export const useLocalNotesStore = create<LocalNotesState>()((set, get) => ({
  notes: [],
  mediaDir: '',
  loaded: false,

  hydrate: async () => {
    if (get().loaded) return;
    // 两件事互不依赖：一边读 JSON，一边问媒体目录（问不到也能正常看/写文字）
    const [raw, dir] = await Promise.all([
      readUserData('localnotes').catch(() => undefined),
      notesMediaDir().catch(() => ''),
    ]);
    set({ notes: coerceLocalNotes(raw), mediaDir: dir, loaded: true });
  },

  createNote: () => {
    const notes = get().notes;
    const id = newNoteId();
    const timestamp = nowIso();
    const color = LOCAL_NOTE_COLORS[notes.length % LOCAL_NOTE_COLORS.length] ?? 'amber';
    const note: LocalNote = {
      id,
      title: '',
      content: '',
      color,
      attachments: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const next = [note, ...notes];
    set({ notes: next });
    persist(next);
    return id;
  },

  updateNote: (id, patch) => {
    const notes = get().notes;
    const index = notes.findIndex((note) => note.id === id);
    if (index < 0) return;
    const current = notes[index];
    if (current === undefined) return;
    const next = [...notes];
    next[index] = {
      ...current,
      title:
        patch.title === undefined ? current.title : patch.title.slice(0, LOCAL_NOTE_TITLE_MAX),
      content:
        patch.content === undefined
          ? current.content
          : patch.content.slice(0, LOCAL_NOTE_MAX_LENGTH),
      color: patch.color === undefined ? current.color : patch.color,
      updatedAt: nowIso(),
    };
    set({ notes: next });
    persist(next);
  },

  removeNote: (id) => {
    const notes = get().notes;
    const target = notes.find((note) => note.id === id);
    if (target === undefined) return;
    const next = notes.filter((note) => note.id !== id);
    set({ notes: next });
    persist(next);
    // 媒体清理是尽力而为：失败只是留几个孤儿文件，不该让删除动作卡住
    void deleteNotesMedia(target.attachments.map((attachment) => attachment.storedName)).catch(
      () => undefined,
    );
  },

  addAttachments: (id, media) => {
    const notes = get().notes;
    const index = notes.findIndex((note) => note.id === id);
    if (index < 0) return;
    const current = notes[index];
    if (current === undefined) return;
    const room = LOCAL_NOTE_MAX_ATTACHMENTS - current.attachments.length;
    if (room <= 0) return;
    const added = media.slice(0, room).map(toAttachment);
    if (added.length === 0) return;
    const next = [...notes];
    next[index] = {
      ...current,
      attachments: [...current.attachments, ...added],
      updatedAt: nowIso(),
    };
    set({ notes: next });
    persist(next);
  },

  removeAttachment: (id, attachmentId) => {
    const notes = get().notes;
    const index = notes.findIndex((note) => note.id === id);
    if (index < 0) return;
    const current = notes[index];
    if (current === undefined) return;
    const target = current.attachments.find((attachment) => attachment.id === attachmentId);
    if (target === undefined) return;
    const next = [...notes];
    next[index] = {
      ...current,
      attachments: current.attachments.filter((attachment) => attachment.id !== attachmentId),
      updatedAt: nowIso(),
    };
    set({ notes: next });
    persist(next);
    void deleteNotesMedia([target.storedName]).catch(() => undefined);
  },
}));

/** 按创建时间倒序（新建在最前；编辑不重排） */
export function sortedLocalNotes(notes: readonly LocalNote[]): readonly LocalNote[] {
  return [...notes].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

/**
 * 供 UI 复用的一体化导入：弹系统对话框 → 复制文件 → 返回元数据。
 *
 * 放在 store 文件里而不是组件里，是为了让"上传"只有一条路径（将来加拖拽上传
 * 也是调这个函数）。
 */
export async function pickAndImportMedia(options: {
  readonly multiple: boolean;
  readonly imageOnly: boolean;
  readonly title: string;
  readonly filterLabel?: string;
}): Promise<readonly ImportedMedium[]> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const selection = await open({
    multiple: options.multiple,
    directory: false,
    title: options.title,
    filters: options.imageOnly
      ? [
          {
            name: options.filterLabel ?? 'Images',
            extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif', 'svg', 'ico'],
          },
        ]
      : undefined,
  });
  if (selection === null || selection === undefined) return [];
  const paths = Array.isArray(selection) ? selection : [selection];
  return importNotesMedia(paths);
}
