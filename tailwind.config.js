/**
 * Tailwind CSS v3.4 配置（架构文档 §2.2）
 *
 * 与 MUI 共存的 4 条硬约定：
 *  1) `preflight: false` —— 否则会重置掉 MUI 的按钮/输入框基础样式
 *  2) 颜色只有一个真源：`var(--hsr-*)`（见 src/styles/tokens.css）
 *  3) 间距/圆角只用 4px 基准网格，圆角以语义名扩展（card/btn/tag）
 *  4) 深色下不用投影，用 1px 描边 + 内高光（shadow-panel）
 */
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  corePlugins: {
    // 关键：必须关闭，交给 MUI 的 CssBaseline 处理
    preflight: false,
  },
  theme: {
    extend: {
      colors: {
        // 命名说明：`bg-base / bg-panel / bg-elev / border-line / text-ink / text-dim`
        // 均为 `var(--hsr-*)` 的映射，切主题只改 <html data-theme>，无需重算样式。
        base: 'var(--hsr-bg)',
        panel: 'var(--hsr-panel)',
        elev: 'var(--hsr-elev)',
        line: 'var(--hsr-line)',
        ink: 'var(--hsr-text)',
        dim: 'var(--hsr-text-dim)',
        accent: 'var(--hsr-accent)',
        accent2: 'var(--hsr-accent2)',
        gold: 'var(--hsr-gold)',
        danger: 'var(--hsr-danger)',
      },
      borderRadius: {
        card: '12px',
        btn: '8px',
        tag: '6px',
      },
      boxShadow: {
        panel: '0 1px 0 rgba(255,255,255,.04) inset',
        overlay: '0 18px 48px rgba(0,0,0,.45)',
      },
      fontFamily: {
        sans: ['var(--hsr-font-sans)'],
        mono: ['var(--hsr-font-mono)'],
      },
      transitionDuration: {
        fast: '120ms',
        base: '180ms',
      },
      maxWidth: {
        content: '1280px',
      },
      spacing: {
        nav: '240px',
        'nav-collapsed': '64px',
        // 顶栏高度走 CSS 变量（tokens.css），否则改 tokens 不会生效
        topbar: 'var(--hsr-topbar-h)',
      },
    },
  },
  plugins: [],
};
