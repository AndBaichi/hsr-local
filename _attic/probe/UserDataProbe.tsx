/**
 * 用户数据落盘验证探针（临时文件，验证完删除）
 *
 * 验证的是 PRD P0-16 / team-lead 验收的三条：
 *  1. 收藏后强杀进程，重启仍在（→ 落盘而非内存）
 *  2. 笔记输入后 1 秒内落盘，强杀不丢
 *  3. 文件损坏时应用仍能启动，坏文件备份 `.bak` 并重建空文件（这条用真实应用验，不需要探针）
 *
 * 自排序逻辑：如果 `notes.json` 里已经有标记笔记，说明上一轮已经写成功，
 * 本次只上报"读到了什么"（AFTER 阶段）；否则执行一次收藏 + 笔记写入（ACTION 阶段）。
 *
 * 上报通道：本机 4199（`scripts/probe-server.mjs` 打印）。
 * 为什么不用 `document.title`：实测 wry/WebView2 不把 `document.title` 转发到窗口标题。
 */

import { invoke } from '@tauri-apps/api/core';
import { useEffect, useRef, useState } from 'react';

import { useFavoritesStore } from '@/stores/favorites';
import { useNotesStore } from '@/stores/notes';

/** 探针标记（用来判断这一轮是"首次写入"还是"重启后读回"） */
const NOTE_MARKER = '探针笔记-v1';

/** 上报通道 */
const REPORT_URL = 'http://127.0.0.1:4199/r';

/** 上报一行结果（no-cors：不需要读响应） */
function report(line: string): void {
  void fetch(`${REPORT_URL}?d=${encodeURIComponent(line)}`, { mode: 'no-cors' }).catch(
    () => undefined,
  );
}

/**
 * 测量「某个值多久后真的出现在磁盘上」。
 *
 * 通过 IPC 反复读文件来观测——读的是 Rust `userdata_read`，也就是应用真实使用的路径，
 * 不是另开一个"测试专用"的通道。
 *
 * @param name 文件名
 * @param needle 期望出现的内容片段
 * @returns 毫秒数；超时返回 `undefined`
 */
async function measurePersisted(name: 'notes' | 'favorites', needle: string): Promise<number | undefined> {
  const started = performance.now();
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    const raw = await invoke<string | null>('userdata_read', { name });
    if ((raw ?? '').includes(needle)) {
      return Math.round(performance.now() - started);
    }
  }
  return undefined;
}

/**
 * 用户数据探针组件。
 *
 * @returns 探针 UI
 */
export function UserDataProbe(): React.ReactElement {
  const [lines, setLines] = useState<readonly string[]>([]);
  const started = useRef(false);

  /**
   * 追加一行并上报。
   *
   * @param line 文本
   */
  function log(line: string): void {
    setLines((prev) => [...prev, line]);
    report(line);
  }

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    void (async () => {
      try {
        // —— 阶段一：读磁盘现状（不经过 store，避免"内存里看着有"的假象）——
        const favoritesRaw = await invoke<string | null>('userdata_read', { name: 'favorites' });
        const notesRaw = await invoke<string | null>('userdata_read', { name: 'notes' });
        log(
          `[READ] favorites=${favoritesRaw === null ? 'null' : `${favoritesRaw.length}B:${favoritesRaw.slice(0, 80)}`}`,
        );
        log(
          `[READ] notes=${notesRaw === null ? 'null' : `${notesRaw.length}B:${notesRaw.slice(0, 80)}`}`,
        );

        const alreadyWritten = (notesRaw ?? '').includes(NOTE_MARKER);
        if (alreadyWritten) {
          log('[AFTER] 磁盘上已有标记笔记 —— 上一轮的写入活过了强杀');
          return;
        }

        // —— 阶段二：走 store 的真实动作（hydrate → toggle → setNote）——
        await Promise.all([
          useFavoritesStore.getState().hydrate(),
          useNotesStore.getState().hydrate(),
        ]);
        log(`[STORE] loaded favorites=${useFavoritesStore.getState().loaded} notes=${useNotesStore.getState().loaded}`);

        const favorited = useFavoritesStore.getState().toggle({
          module: 'character',
          id: '1001',
          nameSnapshot: { zh: '三月七', en: 'March 7th' },
          packId: 'hsr-4.7.51-local',
        });
        log(`[ACTION] toggle character:1001 → ${favorited ? '已收藏' : '已取消'}`);

        const kept = useNotesStore.getState().setNote(
          { module: 'character', id: '1001', nameSnapshot: { zh: '三月七' } },
          NOTE_MARKER,
        );
        log(`[ACTION] setNote character:1001 → ${kept ? '已写入' : '已删除'}`);

        // 实测落盘延迟：不靠"防抖配了 600ms"这种推断，直接量文件里出现内容花了多久
        const notesMs = await measurePersisted('notes', NOTE_MARKER);
        const favoritesMs = await measurePersisted('favorites', 'character:1001');
        log(`[LATENCY] notes 落盘 ${notesMs ?? -1}ms，favorites 落盘 ${favoritesMs ?? -1}ms`);
        log('[ACTION-DONE] 全程未调用 flush，等防抖自然触发');
      } catch (error: unknown) {
        log(`[ERROR] ${error instanceof Error ? error.message : String(error)}`);
      }
    })();
  }, []);

  return (
    <div
      style={{
        padding: 24,
        fontFamily: 'Consolas, monospace',
        fontSize: 13,
        color: '#E7ECF4',
        background: '#0B0E14',
        height: '100%',
        overflow: 'auto',
      }}
    >
      <div style={{ fontSize: 16, marginBottom: 12 }}>用户数据落盘探针</div>
      {lines.length === 0 ? <div style={{ color: '#8B96A8' }}>运行中…</div> : null}
      {lines.map((line, index) => (
        <div key={`${index}-${line.slice(0, 12)}`} style={{ marginBottom: 6, wordBreak: 'break-all' }}>
          {line}
        </div>
      ))}
    </div>
  );
}

export default UserDataProbe;
