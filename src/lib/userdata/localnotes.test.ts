/** 本地便签的收敛逻辑单测（v2.15） */

import { describe, expect, it } from 'vitest';

import {
  coerceLocalNotes,
  isSafeStoredName,
  LOCAL_NOTE_MAX_ATTACHMENTS,
  LOCAL_NOTE_MAX_LENGTH,
  LOCAL_NOTE_TITLE_MAX,
} from './types';

const VALID = {
  id: 'n1',
  title: '标题',
  content: '正文',
  color: 'mint',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  attachments: [
    {
      id: 'a1',
      fileName: '图.png',
      storedName: 'abc123.png',
      kind: 'image',
      size: 2048,
      addedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
};

describe('coerceLocalNotes', () => {
  it('接受 { notes: [...] } 与裸数组两种形状', () => {
    expect(coerceLocalNotes({ notes: [VALID] })).toHaveLength(1);
    expect(coerceLocalNotes([VALID])).toHaveLength(1);
  });

  it('丢弃没有 id 的条目与重复 id', () => {
    const result = coerceLocalNotes({
      notes: [VALID, { ...VALID, id: '' }, { ...VALID }],
    });
    expect(result).toHaveLength(1);
  });

  it('缺省字段补默认值，非法配色回退 amber', () => {
    const result = coerceLocalNotes({ notes: [{ id: 'n2', color: 'rainbow' }] });
    expect(result[0]?.title).toBe('');
    expect(result[0]?.content).toBe('');
    expect(result[0]?.color).toBe('amber');
    expect(result[0]?.attachments).toEqual([]);
  });

  it('标题/正文超长会被截断', () => {
    const result = coerceLocalNotes({
      notes: [{ id: 'n3', title: 'x'.repeat(500), content: 'y'.repeat(LOCAL_NOTE_MAX_LENGTH + 100) }],
    });
    expect(result[0]?.title).toHaveLength(LOCAL_NOTE_TITLE_MAX);
    expect(result[0]?.content).toHaveLength(LOCAL_NOTE_MAX_LENGTH);
  });

  it('附件里不安全的 storedName 整条丢弃，超出上限的截断', () => {
    const attachments = Array.from({ length: LOCAL_NOTE_MAX_ATTACHMENTS + 5 }, (_, index) => ({
      id: `a${index}`,
      fileName: 'f',
      storedName: `ok${index}.png`,
      kind: 'image',
      size: 1,
      addedAt: '2026-01-01T00:00:00.000Z',
    }));
    attachments.push({
      id: 'bad',
      fileName: 'x',
      storedName: '../escape.png',
      kind: 'image',
      size: 1,
      addedAt: '2026-01-01T00:00:00.000Z',
    });
    const result = coerceLocalNotes({ notes: [{ id: 'n4', attachments }] });
    expect(result[0]?.attachments).toHaveLength(LOCAL_NOTE_MAX_ATTACHMENTS);
    expect(result[0]?.attachments.every((item) => isSafeStoredName(item.storedName))).toBe(true);
  });
});

describe('isSafeStoredName', () => {
  it('拒绝路径分隔符、..、隐藏文件与超长名字', () => {
    expect(isSafeStoredName('abc123.png')).toBe(true);
    expect(isSafeStoredName('../a.png')).toBe(false);
    expect(isSafeStoredName('a/b.png')).toBe(false);
    expect(isSafeStoredName('a\\b.png')).toBe(false);
    expect(isSafeStoredName('.hidden')).toBe(false);
    expect(isSafeStoredName('x'.repeat(81))).toBe(false);
    expect(isSafeStoredName(42)).toBe(false);
  });
});
