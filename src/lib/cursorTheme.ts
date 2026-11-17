/**
 * 银狼鼠标指针主题（v2.16）
 *
 * 素材是从用户提供的 Silver Wolf 指针包（`.ani`）里抽出的首帧，由
 * `scripts/extract-cursor-theme.py` 统一缩放到 32×32 并保留热点；PNG 提交进仓库，
 * 构建时由 Vite 打进前端资源，**运行期不读用户下载目录**。
 *
 * ## 为什么是 PNG 而不是 .ani / .cur
 *
 * `cursor: url(...)` 只支持静态图：Chromium 不解码 `.ani`，`.cur` 的支持也随平台
 * 而变。所以动画帧只取首帧——换主题换的是"长相"，不是动画。
 *
 * ## 怎么挂到 DOM 上
 *
 * 这里只把每个角色写成 CSS 变量（`--hsr-cursor-arrow` 等，值是完整的
 * `url(...) x y, fallback`），真正的选择器在 `styles/globals.css` 里，
 * 靠 `<html data-cursor-theme="silverwolf">` 整体开关。想临时给某个元素换指针，
 * 在元素上写 `data-cursor="move|we|ns|nwse|nesw|cross|busy|working"` 即可。
 */

import arrowUrl from '@/assets/cursors/arrow.png?url';
import beamUrl from '@/assets/cursors/beam.png?url';
import busyUrl from '@/assets/cursors/busy.png?url';
import crossUrl from '@/assets/cursors/cross.png?url';
import linkUrl from '@/assets/cursors/link.png?url';
import moveUrl from '@/assets/cursors/move.png?url';
import neswUrl from '@/assets/cursors/nesw.png?url';
import noUrl from '@/assets/cursors/no.png?url';
import nsUrl from '@/assets/cursors/ns.png?url';
import nwseUrl from '@/assets/cursors/nwse.png?url';
import weUrl from '@/assets/cursors/we.png?url';
import workingUrl from '@/assets/cursors/working.png?url';

/** 指针主题：跟随系统 / 银狼 */
export type CursorTheme = 'system' | 'silverwolf';

/** 默认主题（用户明确要求内置，首次启动即生效） */
export const DEFAULT_CURSOR_THEME: CursorTheme = 'silverwolf';

/** 设置页预览用的箭头图 */
export const CURSOR_PREVIEW_URL = arrowUrl;

/** 一个角色的指针定义 */
interface CursorSpec {
  /** 图片 URL */
  readonly url: string;
  /** 热点 X（点击判定点） */
  readonly x: number;
  /** 热点 Y */
  readonly y: number;
  /** 图片不可用时的回退指针 */
  readonly fallback: string;
}

/**
 * 12 个角色 → 指针文件 + 热点。
 *
 * 热点是原 `.ani` 帧头里的值按 32/48 缩放后的结果（见抽取脚本输出）：
 * 箭头/手型/禁止在左上角，I 型在 (3,5)，十字在 (6,6)，移动/缩放类在中心 (15,15)。
 */
const CURSOR_SPECS: Readonly<Record<string, CursorSpec>> = {
  arrow: { url: arrowUrl, x: 0, y: 0, fallback: 'default' },
  link: { url: linkUrl, x: 0, y: 0, fallback: 'pointer' },
  beam: { url: beamUrl, x: 3, y: 5, fallback: 'text' },
  no: { url: noUrl, x: 0, y: 0, fallback: 'not-allowed' },
  move: { url: moveUrl, x: 15, y: 15, fallback: 'move' },
  cross: { url: crossUrl, x: 6, y: 6, fallback: 'crosshair' },
  busy: { url: busyUrl, x: 0, y: 0, fallback: 'wait' },
  working: { url: workingUrl, x: 0, y: 0, fallback: 'progress' },
  ns: { url: nsUrl, x: 15, y: 15, fallback: 'ns-resize' },
  we: { url: weUrl, x: 15, y: 15, fallback: 'ew-resize' },
  nwse: { url: nwseUrl, x: 15, y: 15, fallback: 'nwse-resize' },
  nesw: { url: neswUrl, x: 15, y: 15, fallback: 'nesw-resize' },
};

/** 光标图片是否已预热（避免第一次悬停时闪一下系统指针） */
let preloaded = false;

/** 预加载全部指针图：浏览器缓存命中后 `cursor` 才能立即生效 */
function preload(): void {
  if (preloaded || typeof Image === 'undefined') return;
  preloaded = true;
  for (const spec of Object.values(CURSOR_SPECS)) {
    const image = new Image();
    image.src = spec.url;
  }
}

/** 拼出 CSS `cursor` 值 */
function toCssValue(spec: CursorSpec): string {
  return `url("${spec.url}") ${spec.x} ${spec.y}, ${spec.fallback}`;
}

/**
 * 应用指针主题。
 *
 * 只切 `<html data-cursor-theme>`：CSS 变量在第一次调用时写入，之后切换主题
 * 不需要重算样式表。`system` 会删掉标记，指针回到浏览器 / Windows 默认。
 *
 * @param theme 目标主题
 */
export function applyCursorTheme(theme: CursorTheme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;

  for (const [role, spec] of Object.entries(CURSOR_SPECS)) {
    root.style.setProperty(`--hsr-cursor-${role}`, toCssValue(spec));
  }

  if (theme === 'silverwolf') {
    root.dataset.cursorTheme = 'silverwolf';
    preload();
  } else {
    delete root.dataset.cursorTheme;
  }
}
