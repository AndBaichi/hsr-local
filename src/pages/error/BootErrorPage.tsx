/**
 * 启动错误页（架构文档 §8.8 `pages/error/BootErrorPage.tsx`）
 *
 * 当数据层初始化失败（数据包缺失 / schema 不兼容 / 校验失败）时替换整个内容区。
 * T03 批次会在这里追加「重新导入数据包」入口（依赖 `ipc/import.ts`）。
 */

import { useTranslation } from 'react-i18next';
import { useMemo, type ReactNode } from 'react';

import { ErrorState } from '@/components/common/ErrorState';

/** 启动错误页属性 */
export interface BootErrorPageProps {
  /** 捕获到的错误对象（可能是 `AppError` 形状的普通对象） */
  error?: unknown;
  /** 重试回调 */
  onRetry?: () => void;
  /** 外层附加类名 */
  className?: string;
}

/**
 * 把任意错误对象转成可复制的技术详情文本。
 *
 * 兼容三种形状：
 *  1. JS `Error`
 *  2. Rust `AppError` 序列化后的 `{ code, message, detail }`
 *  3. 其它（字符串化）
 *
 * @param error 原始错误
 */
function toDetailText(error: unknown): string {
  if (error === undefined || error === null) return '';
  if (error instanceof Error) {
    return `${error.name}: ${error.message}${error.stack ? `\n${error.stack}` : ''}`;
  }
  if (typeof error === 'object') {
    const candidate = error as { code?: unknown; message?: unknown; detail?: unknown };
    if (typeof candidate.code === 'string' || typeof candidate.message === 'string') {
      const lines = [
        typeof candidate.code === 'string' ? `code: ${candidate.code}` : '',
        typeof candidate.message === 'string' ? `message: ${candidate.message}` : '',
        typeof candidate.detail === 'string' ? `detail: ${candidate.detail}` : '',
      ].filter((line) => line.length > 0);
      return lines.join('\n');
    }
    try {
      return JSON.stringify(error, null, 2);
    } catch {
      return String(error);
    }
  }
  return String(error);
}

/** 启动错误页 */
export default function BootErrorPage({
  error,
  onRetry,
  className = '',
}: BootErrorPageProps): ReactNode {
  const { t } = useTranslation();
  const detail = useMemo(() => toDetailText(error), [error]);

  return (
    <div className={`flex min-h-screen items-center justify-center bg-base p-8 ${className}`}>
      <div className="w-full max-w-[720px]">
        <ErrorState
          title={t('error.boot.title')}
          description={t('error.boot.desc')}
          detail={detail || undefined}
          onRetry={onRetry}
          retryLabel={t('error.boot.action')}
        />
      </div>
    </div>
  );
}
