/**
 * 本地便签的媒体文件 IPC（v2.15）
 *
 * 图片/附件本体不进 `localnotes.json`：Rust 侧 `notes_media_*` 命令把文件复制到
 * `$APPDATA/notes/media/`，JSON 里只留元数据。这里封装四个动作：
 *  - {@link notesMediaDir}：取媒体目录绝对路径（拼 asset URL 用）
 *  - {@link importNotesMedia}：复制用户选中的文件
 *  - {@link deleteNotesMedia}：便签/附件删除时清理文件
 *  - {@link openNotesMedia}：用系统默认程序打开
 *
 * ## 为什么图片走 asset 协议而不是读成 base64
 *
 * 图片可能有几 MB，塞进 JSON 会让 600ms 防抖的每次输入都重写几 MB；而 asset 协议
 * 是 Tauri 内置的只读通道，配合 `tauri.conf.json` 里放行的 `$APPDATA/notes/**`
 * 就能直接给 `<img src>` 用，不需要把二进制搬进 JS 内存。
 */

import { convertFileSrc, invoke } from '@tauri-apps/api/core';

/** Rust `notes_media_import` 的返回元素（camelCase） */
export interface ImportedMedium {
  /** 媒体 id */
  readonly id: string;
  /** 原始文件名 */
  readonly fileName: string;
  /** 落盘文件名 */
  readonly storedName: string;
  /** `image` / `file` */
  readonly kind: 'image' | 'file';
  /** 字节数 */
  readonly size: number;
}

/** 取媒体目录（会顺带确保目录存在） */
export async function notesMediaDir(): Promise<string> {
  return invoke<string>('notes_media_dir');
}

/**
 * 复制用户选中的文件到媒体目录。
 *
 * @param paths 系统文件对话框返回的绝对路径
 */
export async function importNotesMedia(paths: readonly string[]): Promise<readonly ImportedMedium[]> {
  if (paths.length === 0) return [];
  return invoke<ImportedMedium[]>('notes_media_import', { paths: [...paths] });
}

/**
 * 删除媒体文件（尽力而为：不存在的文件会被 Rust 侧跳过）。
 *
 * @param storedNames 落盘文件名
 */
export async function deleteNotesMedia(storedNames: readonly string[]): Promise<void> {
  if (storedNames.length === 0) return;
  await invoke('notes_media_delete', { storedNames: [...storedNames] });
}

/**
 * 用系统默认程序打开媒体文件。
 *
 * @param storedName 落盘文件名
 */
export async function openNotesMedia(storedName: string): Promise<void> {
  await invoke('notes_media_open', { storedName });
}

/**
 * 拼出 `<img src>` 可用的 asset URL。
 *
 * @param mediaDir {@link notesMediaDir} 的结果
 * @param storedName 落盘文件名
 */
export function notesMediaUrl(mediaDir: string, storedName: string): string {
  // convertFileSrc 在 Windows 上接受正斜杠更稳（反斜杠会被当成转义序列）
  return convertFileSrc(`${mediaDir.replace(/\\/g, '/')}/${storedName}`);
}
