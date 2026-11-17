/**
 * 富文本渲染器（架构文档 §7 的消费端）
 *
 * ## 数据长什么样
 *
 * 所有详情页的正文都不是字符串，而是**段落 → 节点**两级结构，宏已在 T02 被降级成字段：
 *
 * ```json
 * [{ "nodes": [
 *    { "v": "对指定敌方单体造成等同于三月七" },
 *    { "p": 1, "f": "i", "s": "%", "c": "#f29e38" },
 *    { "v": "攻击力的冰属性伤害。" }
 * ]}]
 * ```
 *
 * 全量扫描 1022 个 `db/zh/**` 详情文件（36896 个节点）后确认的取值域：
 *
 * | 键 | 出现次数 | 取值 |
 * |---|---|---|
 * | `v` | 文本 | 任意字符串 |
 * | `p` | 2371 | 1-based 参数下标 |
 * | `f` | 2371 | `i`(2138) / `f1`(225) / `f2`(8) |
 * | `s` | 1512 | **只有** `"%"` |
 * | `c` | 1849 | 5 个色值：`#f29e38`(1523) / `#8790ab`(314) / `#cb2f2f`(9) / `#de7a66`(2) / `#f9b0f0`(1) |
 * | `u` | 4386 | `true`（术语/技能名，如「追加施放」） |
 * | `i` | 779 | `true`（风味文本 / 引号台词） |
 * | 段落 `align` | 2 | `"right"`（物品署名行） |
 *
 * `p` 与 `f` 是 1:1 成对出现的（2371/2371），没有「有参数没格式」的节点。
 *
 * ## 两条刻意的严格性
 *
 * 1. **未知 `f` 直接抛错**，不回落到原值。回落会让 `0.12` 变成字面的 `0.12`（而不是
 *    `12%`），页面看起来完全正常——这是本项目唯一「错了不崩溃、只静默输出错数值」的
 *    地方，必须让它炸在开发期。同理 `p` 越界、`p` 无 `f` 也抛错。
 * 2. **`%` 的 ×100 只由 `s === '%'` 触发**，不看 `f`。这是唯一一处纯语义约定，
 *    所以有固定测试向量（`richtext.test.ts`）钉住它。
 *
 * PRD §6.3 那张「7 种格式」的表描述的是**上游源串**，成品包里 `m/i%/f1%/f2%` 一次都没出现
 * （管线早就归一成 `{p,f,s,c}`），因此这里**不实现**那四种格式。
 */

import type { RichText, RichTextNode, RichTextParagraph } from '@/lib/data/types';

/** 段落对齐方式（数据里只出现过 `right`） */
export type RichAlign = 'left' | 'center' | 'right';

/** 渲染后的文本片段（组件据此产出 `<span>`，不拼 HTML 字符串） */
export interface RichSpan {
  /** 文本 */
  readonly text: string;
  /** 覆盖色（来自节点 `c`，已校验为合法 hex） */
  readonly color?: string;
  /** 斜体（节点 `i`） */
  readonly italic?: boolean;
  /** 下划线 / 术语态（节点 `u`） */
  readonly term?: boolean;
  /** 参数片段为 1-based 下标，纯文本片段为 `undefined` */
  readonly paramIndex?: number;
}

/** 渲染后的段落 */
export interface RenderedParagraph {
  /** 片段序列 */
  readonly spans: readonly RichSpan[];
  /** 对齐方式（缺省由样式决定） */
  readonly align?: RichAlign;
}

/** 渲染错误码（UI 可据此提示"数据不兼容"而不是空白） */
export type RichTextErrorCode =
  | 'UNKNOWN_FORMAT'
  | 'MISSING_FORMAT'
  | 'PARAM_OUT_OF_RANGE'
  | 'PARAM_NOT_NUMBER'
  | 'EMPTY_NODE';

/** 富文本渲染错误 */
export class RichTextError extends Error {
  /** 稳定错误码 */
  readonly code: RichTextErrorCode;

  /** 出问题的节点原文（便于定位） */
  readonly node: RichTextNode;

  constructor(code: RichTextErrorCode, message: string, node: RichTextNode) {
    super(message);
    this.name = 'RichTextError';
    this.code = code;
    this.node = node;
  }

  /** 便于日志复现 */
  override toString(): string {
    return `RichTextError(${this.code}): ${this.message} — node=${JSON.stringify(this.node)}`;
  }
}

/** 渲染选项 */
export interface RenderOptions {
  /**
   * 参数表（0-based 数组，节点里的 `p` 是 1-based）。
   *
   * 由调用方按上下文解析（见 README §7）：角色技能取 `levels[i].paramList`，
   * 光锥取 `refinement.levels[i].paramList`，遗器取固定的 `effects[i].paramList`，
   * 物品没有参数。
   */
  readonly paramList?: readonly number[];
}

/** 合法 hex 颜色（`#rgb` / `#rrggbb` / 带 alpha） */
const HEX_COLOR = /^#[0-9a-fA-F]{3,8}$/;

/**
 * 判断节点是否是参数占位。
 *
 * @param node 节点
 */
function isParamNode(node: RichTextNode): boolean {
  return node.p !== undefined;
}

/**
 * 格式化一个数字。**不含**百分号语义（×100 在外面做）。
 *
 * # Errors
 * `format` 不在 `i|f1|f2` 内时抛 `UNKNOWN_FORMAT`
 *
 * @param value 数值（百分比已 ×100）
 * @param format 来自节点 `f`
 * @param node 节点原文（用于报错）
 */
function formatNumber(value: number, format: string | undefined, node: RichTextNode): string {
  if (format === undefined) {
    // 数据里 0 例（p 与 f 恒成对）。刻意不回落：没有格式就无法确定该显示 0.12 还是 12%
    throw new RichTextError('MISSING_FORMAT', '参数节点缺少数字格式 f', node);
  }
  switch (format) {
    case 'i':
      return String(Math.round(value));
    case 'f1':
      return value.toFixed(1);
    case 'f2':
      return value.toFixed(2);
    default:
      throw new RichTextError('UNKNOWN_FORMAT', `未知数字格式 f="${format}"`, node);
  }
}

/**
 * 把参数节点渲染成文本。
 *
 * 顺序固定：`s === '%'` 先 ×100 → 再按 `f` 格式化 → 最后拼后缀。
 * 顺序反了会把 `0.5` 显示成 `50.0`（f1 先取位再乘 100）。
 *
 * # Errors
 * `p` 越界 / 参数不是数字 / 格式未知
 *
 * @param node 参数节点
 * @param options 渲染选项
 */
function renderParamText(node: RichTextNode, options: RenderOptions): string {
  const index = node.p as number;
  const list = options.paramList ?? [];
  if (!Number.isInteger(index) || index < 1 || index > list.length) {
    throw new RichTextError(
      'PARAM_OUT_OF_RANGE',
      `参数下标 p=${String(index)} 超出 paramList 长度 ${list.length}`,
      node,
    );
  }

  const raw = list[index - 1];
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    throw new RichTextError('PARAM_NOT_NUMBER', `paramList[${index - 1}] 不是有限数字`, node);
  }

  const isPercent = node.s === '%';
  const scaled = isPercent ? raw * 100 : raw;
  const body = formatNumber(scaled, node.f, node);
  const suffix = node.s ?? '';
  return `${body}${suffix}`;
}

/**
 * 渲染一个段落。
 *
 * # Errors
 * 节点为空 / 参数问题 / 未知格式
 *
 * @param paragraph 段落
 * @param options 渲染选项
 */
export function renderParagraph(
  paragraph: RichTextParagraph,
  options: RenderOptions = {},
): RenderedParagraph {
  const spans: RichSpan[] = [];

  for (const node of paragraph.nodes) {
    if (isParamNode(node)) {
      spans.push({
        text: renderParamText(node, options),
        color: typeof node.c === 'string' && HEX_COLOR.test(node.c) ? node.c : undefined,
        italic: node.i === true ? true : undefined,
        term: node.u === true ? true : undefined,
        paramIndex: node.p,
      });
      continue;
    }

    if (typeof node.v !== 'string') {
      throw new RichTextError(
        'EMPTY_NODE',
        '节点既没有文本 v 也没有参数 p（清洗管线不该产出这种节点）',
        node,
      );
    }

    spans.push({
      text: node.v,
      color: typeof node.c === 'string' && HEX_COLOR.test(node.c) ? node.c : undefined,
      italic: node.i === true ? true : undefined,
      term: node.u === true ? true : undefined,
    });
  }

  const align =
    paragraph.align === 'right' || paragraph.align === 'center' || paragraph.align === 'left'
      ? paragraph.align
      : undefined;

  return align === undefined ? { spans } : { spans, align };
}

/**
 * 渲染整段富文本（段落数组）。
 *
 * `null` / `undefined` / 空数组都返回空数组——「没有文案」是合法状态，不是错误。
 *
 * # Errors
 * 见 {@link renderParagraph}
 *
 * @param rich 富文本
 * @param options 渲染选项
 */
export function renderRichText(
  rich: RichText | null | undefined,
  options: RenderOptions = {},
): readonly RenderedParagraph[] {
  if (rich === null || rich === undefined) return [];
  return rich.map((paragraph) => renderParagraph(paragraph, options));
}

/**
 * 压平成纯文本（用于 `title` 提示、复制、搜索摘要）。
 *
 * 段落之间用换行连接。
 *
 * @param rich 富文本
 * @param options 渲染选项
 */
export function richTextToPlain(rich: RichText | null | undefined, options: RenderOptions = {}): string {
  return renderRichText(rich, options)
    .map((paragraph) => paragraph.spans.map((span) => span.text).join(''))
    .join('\n');
}

/**
 * 取某等级的 `paramList`（角色技能 / 光锥叠影共用）。
 *
 * 为什么需要它：`levels[]` 里 `level` 是 1-based 且长度不一（技能有 10 级也有 15 级，
 * 迷宫的 1 级），所以**不能**用 `levels[level - 1]` 之外的任何下标方式，
 * 更不能假设"最后一级 = 10 级"（15 级的技能最后一档是 180%，不是 150%）。
 *
 * @param levels 等级表
 * @param level 目标等级
 * @returns 该等级的 paramList；等级不存在时回退到最近的一档（并保持顺序）
 */
export function paramListAtLevel(
  levels: readonly { readonly level: number; readonly paramList?: readonly number[] }[] | undefined,
  level: number,
): readonly number[] {
  if (levels === undefined || levels.length === 0) return [];
  const exact = levels.find((entry) => entry.level === level);
  if (exact !== undefined) return exact.paramList ?? [];

  // 越界时取最近一档：等级选择器的上限由 UI 控制，这里只做兜底，
  // 保证"数据只有 10 级但 UI 给了 12 级"时仍然显示得出来（而不是抛错）
  const sorted = [...levels].sort((left, right) => left.level - right.level);
  const fallback = level < sorted[0].level ? sorted[0] : sorted[sorted.length - 1];
  return fallback.paramList ?? [];
}
