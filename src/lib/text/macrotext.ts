/**
 * 宏文本渲染器（T04b）
 *
 * ## 为什么不能复用 richtext.ts
 *
 * 原有六个模块的详情在 T02 就已被**归一化成节点数组** `{v,p,f,s,c}`。
 * 但新加入的三个栏目（终局内容 / 货币战争）拿到的是**源站原始宏字符串**：
 *
 * ```
 * 造成<color=#f29e38ff><unbreak>#1[i]%</unbreak></color>点伤害，\\n持续#2[i]回合。
 * ```
 *
 * 全量扫 122 个新文件 / 38478 个字符串后的实测：
 *  - 标签 18 种：`unbreak`(12712) `color`(12520) `property`(655) `u`(590)
 *    `gridfightinfo`(562) `name`(115) `i`(90) `variable`(29) `textswitch`(12)
 *    `variableproperty`(8) `gridfightcolor`(6) `gainotherroletrait`(6)
 *    `layerparam`(3) `gridfightcontext`(2) `removedaffix`(2) `value`(2)
 *    `threshold`(2) `equips`(1)
 *  - 参数格式只有两种：`#N[i]` 与 `#N[f1|f2]`，`%` 作为紧跟其后的字面量
 *
 * ## 严格性策略与 richtext 不同，是刻意的
 *
 * `richtext.ts` 对未知 `f` 直接抛错，因为那是**我们自己管线产出**的封闭取值域。
 * 这里面对的是**第三方原始文本**，标签会随版本增加，抛错会让整页白屏。
 * 所以：未知标签一律「去标签、保留正文」，同时把标签名收集到 `unknownTags`
 * 并在开发态打印——既不吞内容，也不假装认识它。
 *
 * ## 参数不凭空造数
 *
 * 没有提供 `paramList` 时，参数占位**原样保留**（`#1[i]`），
 * 而不是替换成 0 或省略。这是「不编造数据」原则：缺参数一眼能看出来。
 */

/** 渲染后的片段 */
export interface MacroSpan {
  readonly text: string;
  readonly color?: string;
  readonly underline?: boolean;
  readonly italic?: boolean;
  readonly nowrap?: boolean;
}

/** 渲染结果 */
export interface MacroRenderResult {
  readonly spans: readonly MacroSpan[];
  /** 本次遇到的未知标签（开发态上报用，不影响渲染） */
  readonly unknownTags: readonly string[];
}

/** 已知会改变样式的标签 */
const STYLE_TAGS: ReadonlySet<string> = new Set(['color', 'unbreak', 'u', 'i', 'align']);

/** 合法的 hex 颜色（源站用 8 位带 alpha） */
const HEX = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/**
 * `<variable …>` 标签（主角光环备注里出现过 29 次）。
 *
 * 它的属性值里**还嵌着标签**，例如：
 * `<variable name=SpotLight100100_SavedValue01 factor=<unbreak>#1[i]</unbreak> format=i%>`
 * 直接用通用标签正则会在内层 `<unbreak>` 的 `>` 处截断，把 ` format=i%>` 漏成正文
 * （实测会显示成一行原始标记）。所以先用这条专用正则整体吃掉：`format=…>`
 * 才是真正的结束位置。
 */
const VARIABLE_TAG = /<variable\b[\s\S]*?format=([^>\s]*)\s*>/g;

/**
 * 把 `<variable …>` 展开成它引用的参数值。
 *
 * 语义来自原站：`factor` 里是参数占位（可能包着样式标签），`format` 决定格式。
 * 参数缺失时只去掉标签、保留占位原文，不编造数值。
 */
function expandVariables(input: string, paramList?: readonly number[]): string {
  if (!input.includes('<variable')) return input;
  return input.replace(VARIABLE_TAG, (whole, rawFormat: string) => {
    const factor = /factor=([\s\S]*?)\s+format=/.exec(whole)?.[1] ?? '';
    const plain = factor.replace(/<[^>]*>/g, '');
    const param = /#(\d+)\[([^\]]+)\](%)?/.exec(plain);
    if (param === null) return plain;
    const format = rawFormat.replace(/%$/, '');
    const spec = format !== '' ? format : (param[2] ?? 'i');
    const percent = rawFormat.includes('%') || param[3] === '%';
    const value = paramList?.[Number(param[1]) - 1];
    if (typeof value !== 'number' || !Number.isFinite(value)) return plain;
    return formatParam(value, spec, percent);
  });
}

/** token：标签 或 参数占位（含紧随其后的 %） */
const TOKEN = /<(\/?)([A-Za-z_][A-Za-z0-9_-]*)([^>]*)>|#(\d+)\[([^\]]+)\](%?)/g;

interface Style {
  readonly color?: string;
  readonly underline?: boolean;
  readonly italic?: boolean;
  readonly nowrap?: boolean;
}

/** 从 `<color=#f29e38ff>` 的 attrs 里取色值 */
function parseColor(attrs: string): string | undefined {
  const match = /=\s*(#[0-9a-fA-F]+)/.exec(attrs);
  return match && HEX.test(match[1]) ? match[1] : undefined;
}

/** 按规格格式化参数（与 richtext.ts 同一套语义） */
function formatParam(value: number, spec: string, percent: boolean): string {
  const scaled = percent ? value * 100 : value;
  let body: string;
  switch (spec) {
    case 'i':
      body = String(Math.round(scaled));
      break;
    case 'f1':
      body = scaled.toFixed(1);
      break;
    case 'f2':
      body = scaled.toFixed(2);
      break;
    default:
      // 未知格式：保留原占位，不猜
      return `#?[${spec}]`;
  }
  return percent ? `${body}%` : body;
}

/**
 * 把源站宏字符串解析成片段树。
 *
 * @param input 原始字符串（可能是 null / 非字符串，一律返回空）
 * @param paramList 参数表，`#1` 对应 `paramList[0]`
 */
export function renderMacroText(
  input: string | null | undefined,
  paramList?: readonly number[],
): MacroRenderResult {
  if (typeof input !== 'string' || input === '') return { spans: [], unknownTags: [] };

  // 源站 JSON 里换行是字面的两个字符 `\` + `n`，不是真实换行
  const text = expandVariables(
    input.replace(/\\n/g, '\n').replace(/\r/g, ''),
    paramList,
  );

  const spans: MacroSpan[] = [];
  const unknown = new Set<string>();
  // 栈里同时记标签名：未知标签的 `</property>` 之类不能把外层 <color> 弹掉，
  // 否则颜色会串到后面所有文字上。只有「压过栈的标签」才允许出栈。
  const stack: { tag: string; style: Style }[] = [{ tag: '', style: {} }];
  const style = (): Style => stack[stack.length - 1].style;

  const push = (value: string): void => {
    if (value === '') return;
    const current = style();
    const last = spans[spans.length - 1];
    // 相邻同样式片段合并，减少 DOM 节点
    if (
      last &&
      last.color === current.color &&
      last.underline === current.underline &&
      last.italic === current.italic &&
      last.nowrap === current.nowrap
    ) {
      spans[spans.length - 1] = { ...last, text: last.text + value };
      return;
    }
    spans.push({ text: value, ...current });
  };

  let cursor = 0;
  TOKEN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN.exec(text)) !== null) {
    push(text.slice(cursor, match.index));
    cursor = match.index + match[0].length;

    const isClose = match[1] === '/';
    const tag = match[2];

    if (tag !== undefined) {
      if (!STYLE_TAGS.has(tag)) unknown.add(tag);

      if (isClose) {
        if (stack.length > 1 && stack[stack.length - 1].tag === tag) stack.pop();
        continue;
      }
      const current = style();
      if (tag === 'color') {
        stack.push({ tag, style: { ...current, color: parseColor(match[3] ?? '') ?? current.color } });
      } else if (tag === 'unbreak') {
        stack.push({ tag, style: { ...current, nowrap: true } });
      } else if (tag === 'u') {
        stack.push({ tag, style: { ...current, underline: true } });
      } else if (tag === 'i') {
        stack.push({ tag, style: { ...current, italic: true } });
      }
      // align / 其余未知标签：只去标签，不改样式，也不压栈，正文照常保留
      continue;
    }

    // 参数占位
    const index = Number(match[4]);
    const spec = match[5] ?? 'i';
    const percent = match[6] === '%';
    const value = paramList?.[index - 1];
    push(
      typeof value === 'number' && Number.isFinite(value)
        ? formatParam(value, spec, percent)
        : match[0],
    );
  }
  push(text.slice(cursor));

  return { spans, unknownTags: [...unknown] };
}

/** 压成纯文本（列表摘要 / 搜索索引 / title 用） */
export function macroTextToPlain(input: string | null | undefined, paramList?: readonly number[]): string {
  return renderMacroText(input, paramList)
    .spans.map((span) => span.text)
    .join('');
}
