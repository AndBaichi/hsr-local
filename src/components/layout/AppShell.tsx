/**
 * 应用外壳（架构文档 §8.7 AppShell、PRD §4.3）
 *
 * 三分布局：左侧导航（240/64px）+ 顶栏（56px）+ 内容区。
 * 内容区最大宽 1280px 居中、左右留白 32px；窗口 < 1100px 时侧栏自动折叠为图标态。
 *
 * 注意：自动折叠**不写入** prefs —— 那是「用户选择」，窗口变宽后应恢复原状。
 */

import { useEffect, useState, type ReactNode } from 'react';
import { Outlet } from 'react-router-dom';

import { ContextMenuHost, installContextMenuSuppression } from '@/components/common/ContextMenu';
import { SideNav } from '@/components/layout/SideNav';
import { TopBar } from '@/components/layout/TopBar';
import { AppUpdateBanner } from '@/components/layout/AppUpdateBanner';
import { UpdateBanner } from '@/components/layout/UpdateBanner';
import { useSettingsStore } from '@/stores/settings';
import { useUpdaterStore } from '@/stores/updater';
import { useAppUpdaterStore } from '@/stores/appUpdater';
import { LAYOUT } from '@/theme/tokens';

/** 窄窗口媒体查询：`max-width: (breakpoint - 1)px` */
const NARROW_QUERY = `(max-width: ${LAYOUT.collapseBreakpoint - 1}px)`;

/**
 * 读取当前是否处于窄窗口。
 *
 * 测试环境无 `matchMedia` 时按「非窄窗口」处理。
 */
function isNarrowWindow(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(NARROW_QUERY).matches;
}

/** 应用外壳 */
export function AppShell(): ReactNode {
  const sidebarCollapsed = useSettingsStore((state) => state.prefs.sidebarCollapsed);
  const setSidebarCollapsed = useSettingsStore((state) => state.setSidebarCollapsed);

  const [narrow, setNarrow] = useState<boolean>(() => isNarrowWindow());

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const media = window.matchMedia(NARROW_QUERY);
    const onChange = (event: MediaQueryListEvent): void => {
      setNarrow(event.matches);
    };
    setNarrow(media.matches);
    media.addEventListener('change', onChange);
    return () => {
      media.removeEventListener('change', onChange);
    };
  }, []);

  const collapsed = sidebarCollapsed || narrow;

  // v2.9：全局抑制 WebView2 默认右键菜单（输入框等可编辑控件除外），
  // 卡片上的自定义菜单由 EntityCard / 成就系列头各自触发
  useEffect(() => installContextMenuSuppression(), []);

  // v4.8：启动后延迟 10 秒做一次静默更新检查（24h 节流在 store 里）。
  // 延迟是为了不和首屏索引加载抢网络/CPU，也让「刚打开就弹更新」显得突兀。
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void useUpdaterStore.getState().check(false);
      void useAppUpdaterStore.getState().check(false);
    }, 10_000);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-base text-ink">
      <SideNav
        collapsed={collapsed}
        allowToggle={!narrow}
        onToggle={() => {
          setSidebarCollapsed(!sidebarCollapsed);
        }}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <AppUpdateBanner />
        <UpdateBanner />

        <main className="hsr-backdrop min-h-0 flex-1 overflow-y-auto">
          <div className="hsr-content-width py-6">
            <Outlet />
          </div>
        </main>
      </div>

      <ContextMenuHost />
    </div>
  );
}
