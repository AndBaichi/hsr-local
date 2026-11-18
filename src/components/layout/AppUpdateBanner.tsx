/**
 * 程序本体更新提示条（v2.21）
 *
 * 只在 Tauri Updater 发现新版本/安装完成时出现；下载动作交给设置页，
 * 避免启动时直接下几十 MB 的安装包。
 */

import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { useAppUpdaterStore } from '@/stores/appUpdater';

/** 应用更新提示条 */
export function AppUpdateBanner(): ReactNode {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const phase = useAppUpdaterStore((state) => state.phase);
  const latestVersion = useAppUpdaterStore((state) => state.latestVersion);
  const restart = useAppUpdaterStore((state) => state.restart);

  if (phase === 'ready') {
    return (
      <div className="flex shrink-0 items-center gap-3 border-b border-accent/30 bg-accent/10 px-4 py-2 text-xs">
        <span className="text-accent">✦</span>
        <span className="min-w-0 flex-1 truncate text-ink">{t('settings.appReady') as string}</span>
        <button
          type="button"
          onClick={() => void restart()}
          className="rounded-btn border border-accent/40 bg-accent/15 px-2.5 py-1 text-[11px] text-accent hover:bg-accent/25"
        >
          {t('settings.appRestart') as string}
        </button>
      </div>
    );
  }

  if (phase !== 'available' || latestVersion === undefined) return null;

  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-accent/30 bg-accent/10 px-4 py-2 text-xs">
      <span className="text-accent">✦</span>
      <span className="min-w-0 flex-1 truncate text-ink">
        {t('settings.appAvailable', { version: latestVersion })}
      </span>
      <button
        type="button"
        onClick={() => navigate('/settings')}
        className="rounded-btn border border-accent/40 bg-accent/15 px-2.5 py-1 text-[11px] text-accent hover:bg-accent/25"
      >
        {t('update.go')}
      </button>
    </div>
  );
}
