/**
 * 富文本视图（T04）
 *
 * `richtext.ts` 产出的是**节点树**，这里把它映射成 `<span>`。
 * 刻意不拼 HTML 字符串、不用 `dangerouslySetInnerHTML`：数据来自第三方包，
 * 字符串拼接等于把 XSS 面直接暴露给数据包内容（架构文档 §7 的硬要求）。
 *
 * 渲染器对未知 `f` / 越界 `p` 会抛 `RichTextError`。这里捕获后显示错误码而不是整页白屏：
 * 单个技能描述格式不认识，不该让角色的其它 8 个区块也一起消失。
 */

import { useMemo, type ReactNode } from 'react';

import type { RichText } from '@/lib/data/types';
import { renderRichText, RichTextError } from '@/lib/text/richtext';

/** 富文本视图属性 */
export interface RichTextViewProps {
  /** 富文本段落数组；null / 空数组都渲染为空，不显示「暂无」 */
  readonly value: RichText | null | undefined;
  /** 当前等级对应的参数表（角色技能 / 光锥叠影 / 遗器效果） */
  readonly paramList?: readonly number[];
  /** 外层类名 */
  readonly className?: string;
  /** 段落标签，默认 `p`；表格单元格里可传 `span` */
  readonly as?: 'p' | 'span' | 'div';
}

/** 富文本视图 */
export function RichTextView({
  value,
  paramList,
  className = '',
  as: Tag = 'p',
}: RichTextViewProps): ReactNode {
  const rendered = useMemo(() => {
    try {
      return { paragraphs: renderRichText(value, { paramList }), error: undefined as string | undefined };
    } catch (error) {
      const message =
        error instanceof RichTextError
          ? `${error.code}: ${error.message}`
          : error instanceof Error
            ? error.message
            : String(error);
      return { paragraphs: [], error: message };
    }
  }, [value, paramList]);

  if (rendered.error) {
    return (
      <div className={`rounded-btn border border-line bg-elev px-3 py-2 text-xs text-danger ${className}`}>
        {rendered.error}
      </div>
    );
  }

  if (rendered.paragraphs.length === 0) return null;

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      {rendered.paragraphs.map((paragraph, index) => (
        <Tag
          key={`rich-p-${index}`}
          className="text-sm leading-relaxed text-ink"
          style={paragraph.align ? { textAlign: paragraph.align } : undefined}
        >
          {paragraph.spans.map((span, spanIndex) => {
            if (!span.text) return null;
            return (
              <span
                key={`rich-s-${index}-${spanIndex}`}
                style={{
                  color: span.color,
                  fontStyle: span.italic ? 'italic' : undefined,
                  textDecoration: span.term ? 'underline dotted' : undefined,
                  textUnderlineOffset: span.term ? '3px' : undefined,
                }}
              >
                {span.text}
              </span>
            );
          })}
        </Tag>
      ))}
    </div>
  );
}
