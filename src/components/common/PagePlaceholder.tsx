/**
 * 页面占位（T01 批次范围内使用）
 *
 * 架构文档 T01 的源文件清单里写作「17 个页面占位文件（每个
 * `export default function X(){return <PagePlaceholder/>}`）」，
 * 为了让 16 个占位页面不各写一遍布局，这里把该占位实现为共享组件。
 *
 * 占位页只陈述事实：路由已通、布局/主题已生效、内容属于哪个批次。
 * 不写 TODO 注释，也不渲染假数据。
 */

import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';

import { PageHeader } from '@/components/layout/PageHeader';

/** 页面占位属性 */
export interface PagePlaceholderProps {
  /** 页面标题（已翻译） */
  title: string;
  /** 该页面内容所属批次，例如 `T04` */
  batch: string;
  /** 补充说明（已翻译），不传则使用默认文案 */
  description?: string;
}

/** 页面占位 */
export function PagePlaceholder({
  title,
  batch,
  description,
}: PagePlaceholderProps): ReactNode {
  const { t } = useTranslation();
  const location = useLocation();

  return (
    <div className="flex flex-col gap-4 pt-2">
      <PageHeader
        title={title}
        badge={t('placeholder.badge')}
        description={description ?? t('placeholder.desc')}
      />

      <div className="hsr-panel grid gap-4 p-6 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wider text-dim">{t('placeholder.route')}</span>
          <code className="w-fit rounded-btn border border-line bg-elev px-2 py-1 text-xs text-ink">
            {location.pathname}
          </code>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wider text-dim">{t('placeholder.scope')}</span>
          <span className="w-fit rounded-tag border border-line bg-elev px-2 py-1 text-xs text-accent">
            {batch}
          </span>
        </div>
      </div>
    </div>
  );
}
