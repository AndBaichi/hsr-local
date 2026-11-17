/**
 * 骨架屏（架构文档 §8.7 SkeletonBlock）
 *
 * 用于首页与列表页的加载态，保证「首屏 ≤1s 有可见内容」（PRD §7.1）。
 * 不使用 MUI 的 `sx`，尺寸全部走 Tailwind，颜色由主题的 `MuiSkeleton` 覆盖控制。
 */

import Skeleton from '@mui/material/Skeleton';
import type { ReactNode } from 'react';

/** 骨架块属性 */
export interface SkeletonBlockProps {
  /** 行数，默认 3 */
  lines?: number;
  /** 首行高度（标题行），默认 18px */
  titleHeight?: number;
  /** 普通行高度，默认 12px */
  lineHeight?: number;
  /** 外层附加类名 */
  className?: string;
  /** 是否在骨架下方额外渲染一段自定义内容（例如表格占位） */
  children?: ReactNode;
}

/**
 * 多行骨架占位。
 *
 * 最后一行的宽度收缩到 60%，视觉上更接近真实文本块。
 */
export function SkeletonBlock({
  lines = 3,
  titleHeight = 18,
  lineHeight = 12,
  className = '',
  children,
}: SkeletonBlockProps): ReactNode {
  const safeLines = Math.max(1, Math.floor(lines));

  return (
    <div className={className} aria-busy="true" aria-live="polite">
      {Array.from({ length: safeLines }, (_unused, index) => {
        const isFirst = index === 0;
        const isLast = index === safeLines - 1;
        return (
          <Skeleton
            key={`skeleton-${index}`}
            variant="rounded"
            height={isFirst ? titleHeight : lineHeight}
            width={isLast && safeLines > 1 ? '60%' : '100%'}
            animation="wave"
          />
        );
      })}
      {children}
    </div>
  );
}

/** 卡片网格骨架（列表页常用：3 列 × 2 行） */
export function SkeletonCardGrid({
  columns = 3,
  rows = 2,
}: {
  columns?: number;
  rows?: number;
}): ReactNode {
  return (
    <div
      className="grid gap-4"
      style={{ gridTemplateColumns: `repeat(${Math.max(1, columns)}, minmax(0, 1fr))` }}
      aria-busy="true"
    >
      {Array.from({ length: Math.max(1, columns * rows) }, (_unused, index) => (
        <Skeleton
          key={`skeleton-card-${index}`}
          variant="rounded"
          height={132}
          animation="wave"
          style={{ borderRadius: 12 }}
        />
      ))}
    </div>
  );
}
