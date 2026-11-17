/**
 * 宏文本视图（T04b）
 *
 * 与 `RichTextView` 是两套并行体系：那边消费归一化节点数组，这边消费原始宏字符串。
 * 两者都只产出 React 节点树，不用 `dangerouslySetInnerHTML`——
 * 数据来自第三方包，拼 HTML 字符串等于把 XSS 面直接交出去。
 */

import { useMemo, type ReactNode } from 'react';

import { renderMacroText } from '@/lib/text/macrotext';

/** 宏文本视图属性 */
export interface MacroTextProps {
  /** 原始宏字符串；空值渲染为 null，不显示「暂无」 */
  readonly value: string | null | undefined;
  /** 参数表，`#1` 对应第 0 项；缺省时参数占位原样保留 */
  readonly paramList?: readonly number[];
  /** 外层类名 */
  readonly className?: string;
}

/** 宏文本视图 */
export function MacroText({ value, paramList, className = '' }: MacroTextProps): ReactNode {
  const result = useMemo(() => renderMacroText(value, paramList), [value, paramList]);

  if (import.meta.env.DEV && result.unknownTags.length > 0) {
    // 不阻断渲染，但让新宏在开发期可见（换版本的数据包会带来新标签）
    console.debug('[MacroText] 未识别标签（已保留正文）:', result.unknownTags);
  }

  if (result.spans.length === 0) return null;

  return (
    <span className={`whitespace-pre-line text-sm leading-relaxed text-ink ${className}`}>
      {result.spans.map((span, index) => (
        <span
          key={`macro-${index}`}
          style={{
            color: span.color,
            textDecoration: span.underline ? 'underline' : undefined,
            fontStyle: span.italic ? 'italic' : undefined,
            whiteSpace: span.nowrap ? 'nowrap' : undefined,
          }}
        >
          {span.text}
        </span>
      ))}
    </span>
  );
}
