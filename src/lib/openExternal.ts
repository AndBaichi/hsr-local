/**
 * 用系统默认浏览器打开外部链接
 *
 * ## 为什么要白名单
 *
 * `openUrl` 能打开任意协议（含 `file://`、自定义 scheme），一旦某个
 * 数据字段被污染成恶意 URL，就可能在用户机器上触发意料之外的动作。
 * 现在唯一的外链来源是米游社，所以这里把可放行范围钉死成米游社文章域，
 * 其余一律拒绝并留日志。
 *
 * ## 为什么要判 Tauri
 *
 * `npm run dev` 走的是普通浏览器，没有 `__TAURI_INTERNALS__`，
 * 此时 `openUrl` 会抛错。降级成 `window.open` 保证开发时也能验证交互。
 */

import { openUrl } from '@tauri-apps/plugin-opener';

/** 允许打开的前缀（米游社星穹铁道文章页） */
const ALLOWED_PREFIXES: readonly string[] = ['https://www.miyoushe.com/sr/'];

/** 是否运行在 Tauri 容器里（与 `lib/data/dal.ts` 的判定方式一致） */
function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * 打开外链。
 *
 * 失败只写 `console.warn`，不向 UI 冒泡——用户点了没反应比弹出报错框体验更好，
 * 而且这里失败基本只有两种情况（系统没有默认浏览器、权限没配对），
 * 都不是用户能自行处理的。
 */
export async function openExternal(url: string): Promise<void> {
  if (!ALLOWED_PREFIXES.some((prefix) => url.startsWith(prefix))) {
    console.warn('[openExternal] 拒绝打开白名单外的链接', url);
    return;
  }

  try {
    if (isTauri()) {
      await openUrl(url);
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  } catch (error) {
    console.warn('[openExternal] 打开外链失败', url, error);
  }
}
