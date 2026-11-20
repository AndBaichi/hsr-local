/**
 * 顶栏（架构文档 §8.7 TopBar、PRD §4.3）
 *
 * v2.17 起窗口改为无边框：本栏同时承担标题栏职责 ——
 *  - 左：面包屑（整条空白区域可拖动窗口，双击最大化）
 *  - 右：最小化 / 最大化 / 关闭（自定义按钮，见 `WindowControls`）
 *
 * 全局搜索入口已移到左侧导航的品牌区（`SideNav`），语言切换已并入设置页；
 * 本栏不再有搜索/语言图标。快捷键 `Ctrl/Cmd+K` 与 `/` 仍然直达搜索页。
 */

import { useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { Breadcrumb } from '@/components/layout/Breadcrumb';
import { DataVersionPicker } from '@/components/layout/DataVersionPicker';
import { toggleWindowMaximize, WindowControls } from '@/components/layout/WindowControls';
import { useSettingsStore } from '@/stores/settings';

/**
 * 焦点是否位于可输入控件。`/` 快捷键需避让输入框 / 文本域 / 下拉 / contenteditable，
 * 否则在搜索框里打 `/` 会被误判成导航而跳走。
 */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable ||
    target.closest('[contenteditable]') !== null
  );
}

/** 顶栏 */
export function TopBar(): ReactNode {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const shortcutsEnabled = useSettingsStore((state) => state.prefs.shortcutsEnabled);

  // 全局快捷键：Ctrl/Cmd+K 直达搜索；纯 `/` 且焦点不在输入控件时同样直达。
  // 受 prefs.shortcutsEnabled 门控；关闭时连 preventDefault 都不做。
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (!shortcutsEnabled) return;
      const key = event.key.toLowerCase();
      const isCtrlK = (event.ctrlKey || event.metaKey) && key === 'k';
      const isSlash =
        key === '/' &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !isTypingTarget(event.target);
      if (!isCtrlK && !isSlash) return;
      event.preventDefault();
      // 附带 state：搜索页据此在「已经停留在本页、仅重复按快捷键」时也能重新聚焦输入框
      navigate('/search', { state: { focusSearch: true } });
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [navigate, shortcutsEnabled]);

  return (
    <header
      // 无边框窗口的拖动区；子元素（链接、按钮）没有该属性，不会被误拖
      data-tauri-drag-region
      onDoubleClick={(event) => {
        if ((event.target as HTMLElement).hasAttribute('data-tauri-drag-region')) {
          toggleWindowMaximize();
        }
      }}
      className="flex h-topbar shrink-0 items-stretch gap-3 border-b border-line bg-panel pl-4"
      aria-label={t('app.name') as string}
    >
      <div className="flex min-w-0 flex-1 items-center" data-tauri-drag-region>
        <Breadcrumb />
      </div>

      <DataVersionPicker />

      <WindowControls />
    </header>
  );
}
