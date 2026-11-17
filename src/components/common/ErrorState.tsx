/**
 * 错误状态（架构文档 §8.7 ErrorState、§11.5）
 *
 * 展示规则（PRD §7.4「错误可读」）：
 *  - 一律展示**人话文案**，技术细节折叠在 `<details>` 里且可一键复制
 *  - 绝不展示裸堆栈作为主内容
 */

import ContentCopyOutlined from '@mui/icons-material/ContentCopyOutlined';
import ErrorOutlineOutlined from '@mui/icons-material/ErrorOutlineOutlined';
import RefreshOutlined from '@mui/icons-material/RefreshOutlined';
import Button from '@mui/material/Button';
import { useCallback, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';

/** 错误状态属性 */
export interface ErrorStateProps {
  /** 主标题（已翻译） */
  title: string;
  /** 说明文案（已翻译） */
  description?: string;
  /** 技术细节：错误码、路径、底层报错等 */
  detail?: string;
  /** 重试回调；不传则不显示重试按钮 */
  onRetry?: () => void;
  /** 重试按钮文案（已翻译），默认取 `common.retry` */
  retryLabel?: string;
  /** 跳转目标（应用内路由），与 `actionLabel` 配对使用 */
  actionTo?: string;
  /** 跳转按钮文案（已翻译） */
  actionLabel?: string;
  /** 外层附加类名 */
  className?: string;
}

/**
 * 复制文本到剪贴板，失败时静默降级（老 WebView 可能没有 clipboard API）。
 *
 * @param text 待复制文本
 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

/** 错误状态区块 */
export function ErrorState({
  title,
  description,
  detail,
  onRetry,
  retryLabel,
  actionTo,
  actionLabel,
  className = '',
}: ErrorStateProps): ReactNode {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    if (!detail) return;
    void copyText(detail).then((ok) => {
      if (ok) {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      }
    });
  }, [detail]);

  return (
    <div
      role="alert"
      className={`hsr-panel flex flex-col items-start gap-3 p-6 ${className}`}
    >
      <div className="flex items-center gap-2 text-danger">
        <ErrorOutlineOutlined fontSize="small" />
        <h2 className="text-lg font-semibold text-ink">{title}</h2>
      </div>

      {description ? <p className="text-dim text-sm leading-relaxed">{description}</p> : null}

      {(onRetry ?? actionTo) ? (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {onRetry ? (
            <Button
              variant="contained"
              color="primary"
              size="small"
              startIcon={<RefreshOutlined fontSize="small" />}
              onClick={onRetry}
            >
              {retryLabel ?? t('common.retry')}
            </Button>
          ) : null}
          {actionTo && actionLabel ? (
            <Button variant="outlined" size="small" component={RouterLink} to={actionTo}>
              {actionLabel}
            </Button>
          ) : null}
        </div>
      ) : null}

      {detail ? (
        <details className="w-full pt-1">
          <summary className="cursor-pointer select-none text-xs text-dim hover:text-ink">
            {t('error.detail')}
          </summary>
          <div className="mt-2 flex flex-col gap-2">
            <pre className="max-h-64 overflow-auto rounded-btn border border-line bg-elev p-3 text-xs leading-relaxed text-dim">
              {detail}
            </pre>
            <Button
              variant="text"
              size="small"
              startIcon={<ContentCopyOutlined fontSize="small" />}
              onClick={handleCopy}
              className="self-start"
            >
              {copied ? t('error.copied') : t('error.copy')}
            </Button>
          </div>
        </details>
      ) : null}
    </div>
  );
}
