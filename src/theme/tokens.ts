/**
 * MUI 主题与色标计算用的 JS 常量。
 *
 * ⚠️ 与 `src/styles/tokens.css` 必须逐字保持一致（同一个真源的两份投影）：
 *  - CSS 侧供 Tailwind 工具类与全局样式使用（`var(--hsr-*)`）
 *  - TS 侧供 MUI 主题与 canvas / 渐变 / 色标计算使用
 *
 * 为什么 MUI 主题不用 `var(--hsr-*)`：
 * MUI 内部（MenuItem 选中态、Tabs hover、Chip 等）会对 `palette.primary.main` 调用
 * `alpha()`，而 `alpha()` 的 `decomposeColor()` 遇到 `var(...)` 会直接抛
 * `Unsupported color`。因此 MUI 侧必须拿到**具体色值**，由主题对象随 `data-theme` 切换。
 * Tailwind 侧仍然只消费 CSS 变量，切换主题依旧是改一个 `data-theme` 属性。
 */

/** 主题名，与 `<html data-theme>` 的取值一致（仅深色，浅色已移除） */
export type ThemeName = 'dark';

/** 用户主题模式（仅深色；浅色 / 跟随系统已按用户要求移除） */
export type ThemeMode = 'dark';

/** 一套完整的语义色板 */
export interface ThemePalette {
  /** 应用底色 */
  readonly bg: string;
  /** 卡片 / 面板 */
  readonly panel: string;
  /** 浮层 / 悬停 */
  readonly elev: string;
  /** 描边 / 分隔线 */
  readonly line: string;
  /** 主文字 */
  readonly text: string;
  /** 次文字 */
  readonly textDim: string;
  /** 主强调（冰蓝） */
  readonly accent: string;
  /** 辅强调（星紫） */
  readonly accent2: string;
  /** 稀有度金 */
  readonly gold: string;
  /** 危险 / 警告 */
  readonly danger: string;
  /** 主强调的 12% 透明底 */
  readonly accentSoft: string;
  /** 主强调的描边 */
  readonly accentLine: string;
  /** 危险的 14% 透明底 */
  readonly dangerSoft: string;
  /** 悬停背景 */
  readonly hover: string;
  /** 选中背景 */
  readonly active: string;
  /** 面板阴影（深色下是内高光） */
  readonly shadowPanel: string;
}

/** 深色（唯一主题）—— 1:1 对齐原站 hsr.nanoka.cc 的紫色系配色 */
const DARK: ThemePalette = {
  bg: '#080510',
  panel: '#120D22',
  elev: '#1B1431',
  line: '#2D2248',
  text: '#F8FAFC',
  textDim: '#94A3B8',
  accent: '#B892FF',
  accent2: '#FF79CF',
  gold: '#F2C14E',
  danger: '#FB7185',
  accentSoft: 'rgba(184, 146, 255, 0.12)',
  accentLine: 'rgba(184, 146, 255, 0.32)',
  dangerSoft: 'rgba(251, 113, 133, 0.14)',
  hover: 'rgba(255, 255, 255, 0.05)',
  active: 'rgba(184, 146, 255, 0.10)',
  shadowPanel: '0 1px 0 rgba(255, 255, 255, 0.04) inset',
};

/** 主题色板（仅深色） */
export const THEME_TOKENS: Readonly<Record<ThemeName, ThemePalette>> = {
  dark: DARK,
};

/** 稀有度色标（PRD §5.1：5★ 金→紫渐变 / 4★ 紫 / 3★ 蓝） */
export const RARITY_TOKENS = {
  gradientFrom: '#F2C14E',
  gradientTo: '#A78BFA',
  four: '#A78BFA',
  three: '#5AA9E6',
  oneTwo: '#8B96A8',
} as const;

/** 字号标度（与 tokens.css 的 `--hsr-fs-*` 一致） */
export const FONT_SIZE = {
  '2xs': 10,
  xs: 11,
  sm: 12,
  base: 13,
  md: 14,
  lg: 16,
  xl: 20,
  '2xl': 26,
  '3xl': 32,
} as const;

/** 布局常量（与 tokens.css 一致） */
export const LAYOUT = {
  navWidth: 240,
  navCollapsedWidth: 64,
  topBarHeight: 40,
  contentMaxWidth: 1280,
  contentPaddingX: 32,
  /** 侧栏自动折叠阈值（PRD §4.3：<1100px 折叠） */
  collapseBreakpoint: 1100,
  /** 内容区双栏断点（详情页右栏下移） */
  twoColumnBreakpoint: 1100,
} as const;

/** 默认主题：深色（PRD §5.1「深色为默认」） */
export const DEFAULT_THEME_MODE: ThemeMode = 'dark';

/** 动画时长（ms），PRD §5.1：仅状态反馈，120–180ms */
export const DURATION = {
  fast: 120,
  base: 180,
} as const;

/**
 * 读取当前生效的 CSS 变量值（供 canvas / 图表 / 动态渐变使用）。
 *
 * 注意：只能在浏览器环境调用；SSR / 单测环境下返回空串。
 *
 * @param name CSS 变量名，需带 `--` 前缀，例如 `--hsr-accent`
 * @param fallback 变量不存在或不在浏览器环境时的回退值
 */
export function readCssVar(name: string, fallback = ''): string {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return fallback;
  }
  const value = window.getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value.length > 0 ? value : fallback;
}

/**
 * 按稀有度（1–5）取色标。
 *
 * 5★ 需要渐变，由调用方决定用 `RARITY_TOKENS.gradientFrom/To`；
 * 本函数给出**单色**表示（用于文字、描边、色条）。
 *
 * @param rarity 稀有度 1–5
 */
export function rarityColor(rarity: number): string {
  if (rarity >= 5) return RARITY_TOKENS.gradientFrom;
  if (rarity === 4) return RARITY_TOKENS.four;
  if (rarity === 3) return RARITY_TOKENS.three;
  return RARITY_TOKENS.oneTwo;
}
