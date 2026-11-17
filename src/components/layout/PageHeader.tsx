/**
 * 页面头部（架构文档 §8.7 PageHeader）
 *
 * 结构：标题 + 可选徽标 + 结果计数 + 右侧操作槽。
 * 列表页统一用它，保证 6 个模块的页头视觉完全一致。
 */

import type { ReactNode } from 'react';

/** 页面头部属性 */
export interface PageHeaderProps {
  /** 主标题（已翻译） */
  title: string;
  /** 副标题 / 说明（已翻译） */
  description?: string;
  /** 右上角徽标文案（已翻译），如数据版本、批次号 */
  badge?: string;
  /** 结果计数（数字），不传则不显示 */
  count?: number;
  /** 计数文案模板的渲染结果（已翻译，如「共 101 项」） */
  countLabel?: string;
  /** 右侧操作槽 */
  actions?: ReactNode;
  /** 外层附加类名 */
  className?: string;
}

/** 页面头部 */
export function PageHeader({
  title,
  description,
  badge,
  count,
  countLabel,
  actions,
  className = '',
}: PageHeaderProps): ReactNode {
  return (
    <header className={`flex flex-wrap items-start justify-between gap-3 ${className}`}>
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold text-ink">{title}</h1>
          {badge ? (
            <span className="rounded-tag border border-line bg-elev px-2 py-[2px] text-xs text-accent">
              {badge}
            </span>
          ) : null}
          {typeof count === 'number' ? (
            <span className="tabular-nums text-xs text-dim">{countLabel ?? String(count)}</span>
          ) : null}
        </div>
        {description ? <p className="text-sm text-dim">{description}</p> : null}
      </div>

      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}
