/**
 * 详情页外壳（T04）
 *
 * 五个详情页的「加载中 / 出错 / 返回列表 / 页头」完全一致，收在这里。
 * 出错时显示 `DataAccessError.code` 对应的四语言文案 + 技术细节（可复制），
 * 而不是一句笼统的「加载失败」。
 */

import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { ErrorState } from '@/components/common/ErrorState';
import { SkeletonBlock, SkeletonCardGrid } from '@/components/common/SkeletonBlock';
import { PageHeader } from '@/components/layout/PageHeader';
import type { DetailResult } from '@/hooks/useDetail';

/** 详情外壳属性 */
export interface DetailShellProps<T> {
  /** `useDetail` 的结果 */
  readonly result: DetailResult<T>;
  /** 返回列表的路由 */
  readonly backTo: string;
  /** 页头标题（数据未就绪时也要能显示，一般传模块名） */
  readonly fallbackTitle: string;
  /** 数据就绪后的页头标题 */
  readonly titleOf: (data: T) => string;
  /** 数据就绪后的主体 */
  readonly children: (data: T) => ReactNode;
}

/** 详情外壳 */
export function DetailShell<T>({
  result,
  backTo,
  fallbackTitle,
  titleOf,
  children,
}: DetailShellProps<T>): ReactNode {
  const { t } = useTranslation();
  const { data, loading, error, retry } = result;

  const back = (
    <Link
      to={backTo}
      className="rounded-btn border border-line bg-elev px-3 py-1.5 text-xs text-dim hover:text-ink"
    >
      ← {t('detail.back')}
    </Link>
  );

  if (loading) {
    return (
      <div className="flex flex-col gap-4 pt-2">
        <PageHeader title={fallbackTitle} actions={back} />
        <SkeletonBlock lines={2} />
        <SkeletonCardGrid columns={3} rows={1} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col gap-4 pt-2">
        <PageHeader title={fallbackTitle} actions={back} />
        <ErrorState
          title={t(error.userMessageKey)}
          description={t('error.boot.desc')}
          detail={`${error.code}\n${error.detail ?? error.message}`}
          onRetry={retry}
          actionTo={backTo}
          actionLabel={t('detail.back')}
        />
      </div>
    );
  }

  if (data === undefined) {
    return (
      <div className="flex flex-col gap-4 pt-2">
        <PageHeader title={fallbackTitle} actions={back} />
        <ErrorState title={t('detail.notFound')} actionTo={backTo} actionLabel={t('detail.back')} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 pt-2">
      <PageHeader title={titleOf(data)} actions={back} />
      {children(data)}
    </div>
  );
}

/** 详情区块（标题 + 内容），五个详情页共用 */
export function DetailSection({
  title,
  children,
  className = '',
}: {
  readonly title: string;
  readonly children: ReactNode;
  readonly className?: string;
}): ReactNode {
  return (
    <section className={`hsr-panel flex flex-col gap-3 rounded-card border border-line p-4 ${className}`}>
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      {children}
    </section>
  );
}

/** 键值行（基础信息表） */
export function InfoRow({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line py-1.5 last:border-0">
      <span className="text-xs text-dim">{label}</span>
      <span className="text-sm text-ink">{children}</span>
    </div>
  );
}
