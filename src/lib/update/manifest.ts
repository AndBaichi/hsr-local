/**
 * 数据包更新 manifest（`update.json`）的类型、拉取与版本比较。
 *
 * 网络请求走 Rust 命令 `update_fetch_manifest`：WebView 的 fetch 会受 CORS
 * 影响，而 Rust 侧已经为了下载 `.hsrpack` 引入了 HTTP 客户端，顺便复用。
 *
 * 信任边界：
 *  - 只接受 HTTPS；
 *  - `sha256` 必须是 64 位十六进制；
 *  - `archiveBytes` 必须是正整数。
 * 下载完成后 Rust 会再校验一次，这里的校验只负责「别把明显坏的 manifest 当真」。
 */

import { invoke } from '@tauri-apps/api/core';

/** 固定的 manifest 地址（公开仓库的 latest release 资产） */
export const UPDATE_MANIFEST_URL =
  'https://github.com/AndBaichi/hsr-local/releases/latest/download/update.json';

/** `update.json` 的字段 */
export interface UpdateManifest {
  /** 结构版本（目前 1） */
  readonly schemaVersion: number;
  /** 渠道（stable） */
  readonly channel: string;
  /** 本应用的数据包版本，如 `4.7.51-local.1` */
  readonly packVersion: string;
  /** 上游游戏数据版本，如 `4.7.51` */
  readonly upstreamVersion: string;
  /** 游戏数据版本（与 upstreamVersion 相同，保留给老客户端） */
  readonly gameVersion: string;
  /** 最低应用版本 */
  readonly minAppVersion: string;
  /** 压缩包字节数 */
  readonly archiveBytes: number;
  /** 压缩包条目数（可空） */
  readonly entryCount: number | null;
  /** 压缩包 sha256 */
  readonly sha256: string;
  /** 下载地址 */
  readonly url: string;
  /** 发布时间 */
  readonly releasedAt: string;
  /** 更新说明 */
  readonly notes: string;
}

/**
 * 解析并校验 manifest。
 *
 * @param raw 服务端返回的 JSON 文本
 * @throws Error 字段缺失/类型不对/sha256 或 URL 不合法
 */
export function parseUpdateManifest(raw: string): UpdateManifest {
  const data = JSON.parse(raw) as Partial<UpdateManifest> | null;
  if (data === null || typeof data !== 'object') throw new Error('update.json 不是对象');
  const stringFields: Array<keyof UpdateManifest> = [
    'channel',
    'packVersion',
    'upstreamVersion',
    'gameVersion',
    'minAppVersion',
    'sha256',
    'url',
    'releasedAt',
    'notes',
  ];
  for (const field of stringFields) {
    if (typeof data[field] !== 'string') throw new Error(`update.json 字段 ${field} 不合法`);
  }
  if (data.schemaVersion !== 1) throw new Error(`update.json schemaVersion 不支持：${String(data.schemaVersion)}`);
  if (typeof data.archiveBytes !== 'number' || !Number.isFinite(data.archiveBytes) || data.archiveBytes <= 0) {
    throw new Error('update.json archiveBytes 不合法');
  }
  if (typeof data.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(data.sha256)) {
    throw new Error('update.json sha256 不合法');
  }
  if (typeof data.url !== 'string' || !data.url.startsWith('https://')) {
    throw new Error('update.json url 必须是 HTTPS');
  }
  return data as UpdateManifest;
}

/**
 * 从固定地址拉取 manifest。
 *
 * @returns 解析后的 manifest
 */
export async function fetchUpdateManifest(): Promise<UpdateManifest> {
  const raw = await invoke<string>('update_fetch_manifest', { url: UPDATE_MANIFEST_URL });
  return parseUpdateManifest(raw);
}

/**
 * 比较两个 `a.b.c` 版本号。
 *
 * @param left 左值
 * @param right 右值
 * @returns 正数表示 left 更高，0 相等，负数表示更低
 */
export function compareVersions(left: string, right: string): number {
  const parse = (value: string): number[] =>
    value
      .split('.')
      .map((segment) => Number.parseInt(segment, 10))
      .map((value) => (Number.isFinite(value) ? value : 0));
  const a = parse(left);
  const b = parse(right);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
