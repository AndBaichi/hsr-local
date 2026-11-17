/**
 * 自定义窗口控制（v2.17）
 *
 * 窗口改成无边框（`decorations: false`）后，系统标题栏连同自己的最小化/最大化/关闭
 * 一起消失。这一组按钮把三个动作接回应用顶栏右侧，位置比原来的系统标题栏低一行，
 * 视觉上也与 56px 的 TopBar 对齐。
 *
 * 关闭按钮**不直接退出**：它调用 `getCurrentWindow().close()`，仍然走
 * `lib/windowBehavior.ts` 注册的 `onCloseRequested` —— 「询问 / 收纳至托盘 / 退出」
 * 三态、关窗前冲刷用户数据，全部保持不变。
 */

import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/** 是否运行在 Tauri 里（浏览器直开 vite 时没有窗口 API） */
function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** 双击标题栏（拖拽区）切换最大化 */
export function toggleWindowMaximize(): void {
  if (!isTauri()) return;
  void getCurrentWindow().toggleMaximize().catch(() => undefined);
}

/** 无边框窗口的控制按钮组 */
export function WindowControls(): ReactNode {
  const { t } = useTranslation();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;
    const win = getCurrentWindow();
    const sync = (): void => {
      void win.isMaximized().then(setMaximized).catch(() => undefined);
    };
    sync();
    // 拖到屏幕边缘 / 双击最大化时按钮图标要跟着换
    let unlisten: (() => void) | undefined;
    void win.onResized(sync).then((stop) => {
      unlisten = stop;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  // 浏览器直开（无 Tauri）时不渲染，免得出现三个点不动的按钮
  if (!isTauri()) return null;

  const win = getCurrentWindow();
  const buttonClass =
    'flex h-full w-11 items-center justify-center text-dim transition-colors duration-fast hover:bg-elev hover:text-ink';

  return (
    <div className="flex h-full shrink-0 items-stretch">
      <button
        type="button"
        aria-label={t('window.minimize') as string}
        title={t('window.minimize') as string}
        onClick={() => {
          void win.minimize().catch(() => undefined);
        }}
        className={buttonClass}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M0 5.5h10" stroke="currentColor" strokeWidth="1" />
        </svg>
      </button>

      <button
        type="button"
        aria-label={(maximized ? t('window.restore') : t('window.maximize')) as string}
        title={(maximized ? t('window.restore') : t('window.maximize')) as string}
        onClick={() => {
          void win.toggleMaximize().catch(() => undefined);
        }}
        className={buttonClass}
      >
        {maximized ? (
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" fill="none" stroke="currentColor">
            <rect x="0.5" y="2.5" width="6" height="6" strokeWidth="1" />
            <path d="M2.5 2.5V0.5h7v7h-2" strokeWidth="1" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" fill="none" stroke="currentColor">
            <rect x="0.5" y="0.5" width="9" height="9" strokeWidth="1" />
          </svg>
        )}
      </button>

      <button
        type="button"
        aria-label={t('window.close') as string}
        title={t('window.close') as string}
        onClick={() => {
          void win.close().catch(() => undefined);
        }}
        className={`${buttonClass} hover:bg-danger hover:text-white`}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" stroke="currentColor" strokeWidth="1" />
        </svg>
      </button>
    </div>
  );
}
