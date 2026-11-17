/**
 * asset 协议 scope 验证探针（临时文件，验证完删除）
 *
 * 目的：`tauri.conf.json` 里 `assetProtocol.scope` 写的是
 * `["$RESOURCE/datapack/**", "$APPDATA/packs/**"]`，而数据包实际落在
 * `%APPDATA%\com.hsr.local.databank\packs\hsr-4.7.51-local\…`。
 * 如果 `$APPDATA` 在 scope 里被解析成 `%APPDATA%`（而不是 app 专属目录），
 * 那么模式会变成 `…\Roaming\packs\**`，与实际路径差一层 `com.hsr.local.databank`，
 * 结果就是**所有 JSON 都通、只有图片 403**——这种 bug 极难往 asset 协议上想。
 *
 * 结论通过 HTTP 上报（`scripts/probe-server.mjs`）输出：
 *  实测 `document.title` 改了**不会**转发到窗口标题（wry/WebView2 不转发），
 *  所以 PowerShell 读 `MainWindowTitle` 只能看到 Rust `announce_ready` 写的那串。
 */

import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';

/** 待探测的真实数据包内相对路径 */
const PROBES: readonly (readonly [label: string, rel: string])[] = [
  ['character/1001', 'img/character/1001.webp'],
  ['item/101', 'img/item/101.webp'],
  ['lightcone/20000', 'img/lightcone/20000.webp'],
];

/** `pack_status` ready 分支的最小形状（探针不引 DAL，避免 boot 失败干扰结论） */
interface ReadyStatus {
  readonly state: string;
  readonly root?: string;
  readonly packId?: string;
}

/**
 * 把 Windows 绝对路径转成 asset URL。
 *
 * @param root 数据包根目录（绝对路径）
 * @param rel 包内相对路径
 */
function joinAssetPath(root: string, rel: string): string {
  const base = root.replace(/\\/g, '/').replace(/\/+$/, '');
  return `${base}/${rel.replace(/\\/g, '/').replace(/^\/+/, '')}`;
}

/**
 * 造一个**必须在 scope 之外**的路径（`%APPDATA%\probe-outside.txt`）。
 *
 * root 形如 `…\Roaming\com.hsr.local.databank\packs\{packId}`，向上退三层即 Roaming。
 *
 * @param root 数据包根目录
 */
function outsidePath(root: string): string {
  const parts = root.replace(/\\/g, '/').split('/');
  return [...parts.slice(0, Math.max(parts.length - 3, 0)), 'probe-outside.txt'].join('/');
}

/** 单张图片的探测结果 */
interface ProbeState {
  readonly label: string;
  readonly url: string;
  readonly outcome: 'pending' | 'loaded' | 'error';
  readonly detail: string;
}

/**
 * asset 协议探针组件。
 *
 * @returns 探针 UI
 */
export function AssetProbe(): React.ReactElement {
  const [root, setRoot] = useState<string>('');
  const [states, setStates] = useState<readonly ProbeState[]>([]);
  const [fetchNote, setFetchNote] = useState<string>('-');

  // 第一步：拿 root，拼 URL
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const status = await invoke<ReadyStatus>('pack_status');
        if (!alive) return;
        const resolved = status.root ?? '';
        setRoot(`${status.state}|${status.packId ?? '-'}|${resolved}`);
        if (resolved === '') return;
        const entries: ProbeState[] = PROBES.map(([label, rel]) => ({
          label,
          url: convertFileSrc(joinAssetPath(resolved, rel)),
          outcome: 'pending' as const,
          detail: '',
        }));
        // 负向对照：scope 之外的绝对路径必须被拒（否则说明 scope 根本没生效）
        entries.push({
          label: 'outside-roaming',
          url: convertFileSrc(outsidePath(resolved)),
          outcome: 'pending',
          detail: '',
        });
        setStates(entries);
      } catch (error: unknown) {
        if (!alive) return;
        setRoot(`invoke-failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // 第二步：fetch 通道 —— img onerror 分不出 403 与 404，fetch 能拿到状态码
  useEffect(() => {
    const first = states[0];
    if (first === undefined || first.outcome === 'pending') return;
    void (async () => {
      try {
        const response = await fetch(first.url);
        setFetchNote(`HTTP ${response.status}`);
      } catch (error: unknown) {
        setFetchNote(`THROWN ${error instanceof Error ? error.message : String(error)}`);
      }
    })();
  }, [states]);

  // 第三步：HTTP 上报通道（本机 4199，由 scripts/probe-server.mjs 打印）
  useEffect(() => {
    if (states.length === 0) return;
    if (!states.every((item) => item.outcome !== 'pending')) return;
    const parts = states.map((item) =>
      item.outcome === 'loaded' ? `${item.label}=OK(${item.detail})` : `${item.label}=ERR(${item.detail})`,
    );
    const urls = states.map((item) => `${item.label}→${item.url}`).join(' ');
    const line = `status=${root}\n  ${parts.join(' ')}\n  fetch(first)=${fetchNote}\n  urls: ${urls}`;
    void fetch(`http://127.0.0.1:4199/r?d=${encodeURIComponent(line)}`, { mode: 'no-cors' }).catch(
      () => undefined,
    );
  }, [root, states, fetchNote]);

  /**
   * 记录单张图片的加载结果。
   *
   * @param label 探针标签
   * @param outcome 结果
   * @param detail 附带信息（尺寸 / 错误文本）
   */
  function mark(label: string, outcome: 'loaded' | 'error', detail: string): void {
    setStates((prev) =>
      prev.map((item) => (item.label === label ? { ...item, outcome, detail } : item)),
    );
  }

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
      <div style={{ fontSize: 16, marginBottom: 12 }}>asset 协议探针</div>
      <div style={{ color: '#8B96A8', wordBreak: 'break-all' }}>status = {root}</div>
      <div style={{ color: '#8B96A8' }}>fetch(first) = {fetchNote}</div>
      {states.map((item) => (
        <div
          key={item.label}
          style={{ marginTop: 16, borderTop: '1px solid #232E3D', paddingTop: 12 }}
        >
          <div>
            {item.label} → {item.outcome} {item.detail}
          </div>
          <div style={{ color: '#8B96A8', wordBreak: 'break-all', fontSize: 11 }}>{item.url}</div>
          <img
            src={item.url}
            alt={item.label}
            style={{ marginTop: 8, maxWidth: 200, maxHeight: 200, border: '1px solid #232E3D' }}
            onLoad={(event) =>
              mark(
                item.label,
                'loaded',
                `${event.currentTarget.naturalWidth}x${event.currentTarget.naturalHeight}`,
              )
            }
            onError={() => mark(item.label, 'error', 'load-failed')}
          />
        </div>
      ))}
    </div>
  );
}

export default AssetProbe;
