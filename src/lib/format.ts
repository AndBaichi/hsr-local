/**
 * 展示层格式化助手（T04）
 *
 * 这里只放「从真实数据结构推导出 UI 字符串/路径」的纯函数，不碰 IPC、不碰 React。
 * 所有函数都必须容忍数据包字段缺失——4.7.51 里已经出现过
 * `maze_boss` 赛季四语言 name 全为 null 的情况（见 03-module-expansion.md §2.4）。
 */

import type { Lang } from '@/i18n';
import type { LocalizedNames } from '@/lib/data/types';

/**
 * 取当前语言的名称。
 *
 * 回退顺序：当前语言 → zh → en → 任意非空 → 调用方给的兜底串。
 * **不做 `names[lang] ?? ''`**：物品索引根本没有 `name` 字段，
 * 敌人详情在某些语言下也可能整条为空，空白列表项比占位串更难排查。
 *
 * @param names 多语言名称对象
 * @param lang 当前语言
 * @param fallback 全部缺失时显示的内容（一般传 `ID` 或「赛季 3024」）
 */
export function localizedName(
  names: LocalizedNames | null | undefined,
  lang: Lang,
  fallback: string,
): string {
  if (!names) return fallback;
  const preferred = names[lang];
  if (typeof preferred === 'string' && preferred.trim() !== '') return preferred;
  const zh = names.zh;
  if (typeof zh === 'string' && zh.trim() !== '') return zh;
  const en = names.en;
  if (typeof en === 'string' && en.trim() !== '') return en;
  for (const value of Object.values(names)) {
    if (typeof value === 'string' && value.trim() !== '') return value;
  }
  return fallback;
}

/**
 * 元素图标路径。
 *
 * 注意别把「源站文件名」和「包内文件名」搞混：
 * 源站是 `assets/hsr/element/thunder.webp`（`lightning.webp` 实测 404），
 * 但 **T02 构建脚本下载时已经重命名成了包内的 `img/element/lightning.webp`**。
 * 所以这里一律按枚举名小写拼，不要再做 thunder 映射——那会让七个元素的图标全裂。
 * 契约测试 `contract.test.ts` 钉住了这一点。
 *
 * @param element 属性枚举，如 `Lightning`
 */
export function elementIconPath(element: string): string {
  return `img/element/${element.toLowerCase()}.webp`;
}

/** 命途图标路径 */
export function pathIconPath(path: string): string {
  return `img/path/${path.toLowerCase()}.webp`;
}

/**
 * 稀有度对应的文本颜色 token。
 *
 * 用 CSS 变量而不是硬编码色值，深浅主题切换时才不会有一块颜色不跟着变。
 *
 * @param rarity 1–5
 */
export function rarityColor(rarity: number): string {
  if (rarity >= 5) return 'var(--hsr-rarity-5-from)';
  if (rarity === 4) return 'var(--hsr-rarity-4)';
  if (rarity === 3) return 'var(--hsr-rarity-3)';
  return 'var(--hsr-text-dim)';
}

/** 把 Unix 秒格式化成本地日期（无时间戳时返回空串） */
export function formatDate(seconds: number | undefined, lang: Lang): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return '';
  try {
    return new Intl.DateTimeFormat(lang, { year: 'numeric', month: '2-digit', day: '2-digit' }).format(
      new Date(seconds * 1000),
    );
  } catch {
    return '';
  }
}

/** 折叠空白但不吞掉换行（富文本段落里可能有刻意留的空格） */
export function compactText(value: string): string {
  return value.replace(/[\t ]+/g, ' ').trim();
}
