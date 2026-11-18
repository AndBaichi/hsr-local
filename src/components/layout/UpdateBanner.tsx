/**
 * 顶栏下方的更新提示条（v4.8）
 *
 * 只在「检查到可用新版本」且用户没点过忽略时出现；点「去更新」跳到设置页，
 * 点「忽略」只隐藏当前版本，下次版本号变化会重新出现。
 *
 * 不自动下载：默认行为是提示，下载动作交给设置页（避免启动时偷跑 78 MB）。
 */

import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { useUpdaterStore } from '@/stores/updater';

/** 更新提示条 */
export function UpdateBanner(): ReactNode {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const phase = useUpdaterStore((state) => state.phase);
  const manifest = useUpdaterStore((state) => state.manifest);
  const installed = useUpdaterStore((state) => state.installed);
  const dismissedVersion = useUpdaterStore((state) => state.dismissedVersion);
  const dismiss = useUpdaterStore((state) => state.dismiss);

  if (phase === 'ready' && installed !== undefined) {
    return (
      <div className="flex shrink-0 items-center gap-3 border-b border-accent/30 bg-accent/10 px-4 py-2 text-xs">
        <span className="text-accent">✦</span>
        <span className="min-w-0 flex-1 truncate text-ink">
          {t('settings.updateReady', { version: installed.gameVersion })}
        </span>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-btn border border-accent/40 bg-accent/15 px-2.5 py-1 text-[11px] text-accent hover:bg-accent/25"
        >
          {t('settings.restartApp')}
        </button>
      </div>
    );
  }

  if (phase !== 'available' || manifest === undefined) return null;
  if (dismissedVersion === manifest.gameVersion) return null;

  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-accent/30 bg-accent/10 px-4 py-2 text-xs">
      <span className="text-accent">✦</span>
      <span className="min-w-0 flex-1 truncate text-ink">
        {t('update.banner', { version: manifest.gameVersion })}
      </span>
      <button
        type="button"
        onClick={() => navigate('/settings')}
        className="rounded-btn border border-accent/40 bg-accent/15 px-2.5 py-1 text-[11px] text-accent hover:bg-accent/25"
      >
        {t('update.go')}
      </button>
      <button
        type="button"
        onClick={dismiss}
        className="rounded-btn px-2 py-1 text-[11px] text-dim hover:text-ink"
      >
        {t('update.dismiss')}
      </button>
    </div>
  );
}
