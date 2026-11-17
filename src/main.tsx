/**
 * 应用入口（架构文档 §8.2）
 *
 * 启动顺序（顺序不可调换，否则首帧会闪烁或出现 i18n key 原文）：
 *  1. 读持久化偏好（同步，localStorage / 未来 userdata.json）
 *  2. 把主题写到 `<html data-theme>`（index.html 内联脚本已抢跑一次，这里兜底）
 *  3. await i18n 初始化
 *  4. 挂载 React
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '@/styles/tokens.css';
import '@/styles/globals.css';
import '@/styles/richtext.css';

import { App } from '@/App';
import { applyThemeToDocument, resolveThemeName } from '@/hooks/useThemeMode';
import { initI18n, normalizeLang } from '@/i18n';
import { applyCursorTheme } from '@/lib/cursorTheme';
import { readPersistedPrefs } from '@/stores/settings';

/**
 * 启动失败时的最小兜底 UI。
 *
 * 这里刻意不使用 React / MUI / i18n——它们本身可能就是失败原因。
 *
 * @param error 捕获到的异常
 */
function renderFatalFallback(error: unknown): void {
  const container = document.getElementById('root');
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? (error.stack ?? '') : '';
  if (!container) return;
  container.innerHTML = `
    <div style="padding:32px;font-family:'Microsoft YaHei UI',system-ui,sans-serif;color:#E7ECF4;background:#0B0E14;height:100%">
      <h1 style="font-size:20px;margin:0 0 8px">应用启动失败</h1>
      <p style="margin:0 0 16px;color:#8B96A8;font-size:13px">初始化过程中出现无法恢复的错误，请重启应用。</p>
      <pre style="white-space:pre-wrap;font-size:12px;color:#F87171;background:#131A24;border:1px solid #232E3D;border-radius:8px;padding:12px">${escapeHtml(
        `${message}\n${stack}`,
      )}</pre>
    </div>
  `;
}

/**
 * 最小 HTML 转义，避免把异常内容当作 HTML 注入。
 *
 * @param value 原始字符串
 */
function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** 启动编排 */
async function bootstrap(): Promise<void> {
  const prefs = readPersistedPrefs();

  // 指针主题先于渲染生效：避免首帧用系统指针、随后才切主题
  applyCursorTheme(prefs.cursorTheme);

  // 主题先于渲染生效：避免深→浅切换时首帧闪白
  applyThemeToDocument(resolveThemeName(prefs.themeMode));

  await initI18n(normalizeLang(prefs.lang));

  const container = document.getElementById('root');
  if (!container) {
    throw new Error('找不到挂载点 #root');
  }

  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

bootstrap().catch((error: unknown) => {
  console.error('[hsr] 启动失败', error);
  renderFatalFallback(error);
});
