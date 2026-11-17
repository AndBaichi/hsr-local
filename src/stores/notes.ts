/**
 * 笔记 store（架构文档 §2.3 `notes.json`、PRD P0-16）
 *
 * 数据形状：`Record<EntityKey, NoteEntry>`，600ms 逐实体防抖后整体写入。
 *
 * ## 「1 秒内落盘」是怎么保证的
 *
 * PRD P0-16 的原始验收是「输入后 1 秒内落盘，强杀不丢」。三重保障：
 *  1. 防抖 600ms（`lib/ipc/userdata.ts` 的策略表）——留 40% 余量
 *  2. `visibilitychange` / `pagehide` 强制 flush（用户直接关窗口的场景）
 *  3. 写入走 Rust `atomic.rs` 的 tmp → fsync → rename：进程被杀时文件要么是旧内容、
 *     要么是新内容，不会出现"写了一半的 JSON"（那种才会真的丢数据）
 *
 * 注意第 3 条是**原子性**而不是**及时性**：强杀发生在防抖窗口内时，最后一次输入
 * 仍然会丢。这是"每次按键都写盘"与"几百毫秒延迟"之间的权衡，PRD 的 1s 口径
 * 选的是后者。
 */

import { create } from 'zustand';

import { readUserData, scheduleWriteUserData } from '@/lib/ipc/userdata';
import {
  coerceNotes,
  entityKeyOf,
  type EntityKey,
  type LocalizedNames,
  type NoteEntry,
  NOTE_MAX_LENGTH,
} from '@/lib/userdata/types';
import type { ModuleKey } from '@/lib/data/types';

/** 写笔记的入参 */
export interface NoteInput {
  /** 模块 */
  readonly module: ModuleKey;
  /** 实体 id */
  readonly id: string;
  /** 名称快照 */
  readonly nameSnapshot: LocalizedNames;
}

/** store 状态与动作 */
export interface NotesState {
  /** 实体键 → 条目 */
  readonly items: Readonly<Record<string, NoteEntry>>;
  /** 是否已从磁盘读完 */
  readonly loaded: boolean;
  /** 从 `userdata/notes.json` 载入（幂等） */
  hydrate: () => Promise<void>;
  /** 取笔记（没有则 `undefined`） */
  getNote: (module: ModuleKey, id: string) => NoteEntry | undefined;
  /**
   * 写入笔记内容。传空字符串等于删除该条笔记。
   *
   * @returns 是否仍存在笔记
   */
  setNote: (input: NoteInput, content: string) => boolean;
  /** 删除笔记 */
  removeNote: (module: ModuleKey, id: string) => void;
  /** 清空全部笔记 */
  clear: () => void;
}

/**
 * 按更新时间倒序的条目列表（笔记页"最近编辑在前"）。
 *
 * @param items 笔记表
 */
export function sortedNotes(items: Readonly<Record<string, NoteEntry>>): readonly NoteEntry[] {
  return Object.values(items).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

/** 笔记 store */
export const useNotesStore = create<NotesState>()((set, get) => ({
  items: {},
  loaded: false,

  hydrate: async () => {
    if (get().loaded) return;
    try {
      const raw = await readUserData('notes');
      set({ items: coerceNotes(raw), loaded: true });
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn('[notes] 读取失败，按空笔记继续', error);
      }
      set({ items: {}, loaded: true });
    }
  },

  getNote: (module, id) => {
    const key: EntityKey = entityKeyOf(module, id);
    return get().items[key];
  },

  setNote: (input, content) => {
    const key: EntityKey = entityKeyOf(input.module, input.id);
    const current = get().items;
    const trimmed = content.slice(0, NOTE_MAX_LENGTH);

    let next: Record<string, NoteEntry>;
    if (trimmed.trim() === '') {
      // 清空即删除：留一条 content="" 的笔记会让笔记列表里出现"打开是空的"条目
      if (current[key] === undefined) return false;
      next = { ...current };
      delete next[key];
      set({ items: next });
      scheduleWriteUserData('notes', next);
      return false;
    }

    next = {
      ...current,
      [key]: {
        module: input.module,
        id: input.id,
        nameSnapshot: input.nameSnapshot,
        content: trimmed,
        updatedAt: new Date().toISOString(),
      },
    };
    set({ items: next });
    scheduleWriteUserData('notes', next);
    return true;
  },

  removeNote: (module, id) => {
    const key: EntityKey = entityKeyOf(module, id);
    if (get().items[key] === undefined) return;
    const next = { ...get().items };
    delete next[key];
    set({ items: next });
    scheduleWriteUserData('notes', next);
  },

  clear: () => {
    set({ items: {} });
    scheduleWriteUserData('notes', {});
  },
}));
