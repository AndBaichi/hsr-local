/**
 * 路由 404 页（架构文档 §8.8 `pages/error/NotFoundPage.tsx`）
 *
 * 注意：它渲染在 AppShell 的 `<Outlet/>` 内，因此侧栏/顶栏仍然可用，
 * 用户可以立刻切到别的模块，而不是被一张全屏错误页堵住。
 */

import Button from '@mui/material/Button';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';

/** 404 页 */
export default function NotFoundPage(): ReactNode {
  const { t } = useTranslation();
  const location = useLocation();

  return (
    <div className="hsr-panel mt-2 flex flex-col items-start gap-3 p-8">
      <span className="rounded-tag border border-line bg-elev px-2 py-[2px] text-xs text-dim">
        404
      </span>
      <h1 className="text-2xl font-semibold text-ink">{t('error.notFound.title')}</h1>
      <p className="text-sm text-dim">{t('error.notFound.desc')}</p>
      <code className="rounded-btn border border-line bg-elev px-3 py-1 text-xs text-dim">
        {location.pathname}
      </code>
      <Button variant="contained" size="small" component={RouterLink} to="/" className="mt-1">
        {t('error.notFound.action')}
      </Button>
    </div>
  );
}
