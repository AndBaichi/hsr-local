/**
 * 启动三态门禁（架构文档 §8.7 BootGuard、§6 启动时序）
 *
 * 状态机：`loading` → `ready` | `error`
 *  - `loading`：展示与最终布局同构的骨架，避免加载完成时布局跳动
 *  - `error`  ：交给 `BootErrorPage`（含可读文案 + 技术详情 + 重试）
 *  - `ready`  ：渲染真实应用
 *
 * 说明（T01）：数据层 `dal.boot()` 属于 T03 批次。本组件通过可注入的 `boot`
 * 任务参数实现完整状态机——T03 只需 `<BootGuard boot={useBoot().run}>`，
 * 组件本身不需要任何改动。未注入 `boot` 时视为「无启动任务」，直接进入 ready。
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { SkeletonBlock } from '@/components/common/SkeletonBlock';
import BootErrorPage from '@/pages/error/BootErrorPage';

/** 启动阶段 */
export type BootPhase = 'loading' | 'ready' | 'error';

/** BootGuard 属性 */
export interface BootGuardProps {
  /** 就绪后渲染的子树 */
  children: ReactNode;
  /**
   * 启动任务：成功 resolve 进入 ready，抛错进入 error。
   * 不传表示本次启动没有需要等待的异步步骤。
   */
  boot?: () => Promise<void>;
  /** 骨架屏显示的最短时间（ms），避免过快闪烁；默认 0 */
  minLoadingMs?: number;
}

/** 全屏启动骨架：与 AppShell 的三分布局同构 */
function BootSplash(): ReactNode {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-base" aria-busy="true">
      <aside className="flex w-nav shrink-0 flex-col gap-3 border-r border-line bg-panel p-4">
        <SkeletonBlock lines={1} titleHeight={20} />
        <div className="mt-4 flex flex-col gap-2">
          {Array.from({ length: 7 }, (_unused, index) => (
            <SkeletonBlock key={`nav-skeleton-${index}`} lines={1} titleHeight={14} />
          ))}
        </div>
        <div className="mt-auto">
          <SkeletonBlock lines={1} titleHeight={14} />
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-topbar shrink-0 items-center border-b border-line bg-panel px-4">
          <SkeletonBlock lines={1} titleHeight={14} />
        </header>
        <main className="min-h-0 flex-1 overflow-hidden bg-base p-8">
          <div className="mx-auto w-full max-w-content">
            <SkeletonBlock lines={4} />
          </div>
        </main>
      </div>
    </div>
  );
}

/** 启动门禁 */
export function BootGuard({ children, boot, minLoadingMs = 0 }: BootGuardProps): ReactNode {
  const [phase, setPhase] = useState<BootPhase>(boot ? 'loading' : 'ready');
  const [error, setError] = useState<unknown>(undefined);
  const bootRef = useRef(boot);

  bootRef.current = boot;

  const run = useCallback(async () => {
    const task = bootRef.current;
    if (!task) {
      setPhase('ready');
      return;
    }

    setPhase('loading');
    setError(undefined);

    const startedAt = Date.now();
    try {
      await task();
      const elapsed = Date.now() - startedAt;
      if (minLoadingMs > elapsed) {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, minLoadingMs - elapsed);
        });
      }
      setPhase('ready');
    } catch (caught: unknown) {
      if (import.meta.env.DEV) {
        console.error('[BootGuard] 启动失败', caught);
      }
      setError(caught);
      setPhase('error');
    }
  }, [minLoadingMs]);

  useEffect(() => {
    if (bootRef.current) {
      void run();
    } else {
      setPhase('ready');
    }
  }, [run]);

  if (phase === 'loading') {
    return <BootSplash />;
  }

  if (phase === 'error') {
    return <BootErrorPage error={error} onRetry={() => void run()} />;
  }

  return <>{children}</>;
}
