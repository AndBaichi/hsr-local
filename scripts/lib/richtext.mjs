/**
 * 富文本清洗管线（架构文档 §7，7 步）
 *
 * 输入是源站的"半 HTML 半宏"文本，输出是**结构化节点树**（不是 HTML 字符串）：
 *  - 天然免疫 XSS，运行时不需要 `dangerouslySetInnerHTML`
 *  - 参数占位（`#1[i]`）保留为节点，运行时按当前技能等级的 `param_list` 取值 → 支持等级切换
 *
 * 处理顺序（强约束，不能调换）：
 *   step1 转义换行 & 剥离未知标签（含 `<color>` / `<unbreak>` / `<i>` / `<align>`）
 *   step2 `{RUBY_B#…}…{RUBY_E#}` 注音
 *   step3 参数替换 `#n[spec]`（可带上限 `%`）
 *   step4 宏展开 `{NICKNAME}` / `{F#…}{M#…}` / `{TextID#…}` / `{TEXTJOIN#…}`
 *   step5 ruby 转节点
 *   step6 换行分行（块级）
 *   step7 输出节点树
 */

/** 女主默认名（`{F#…}{M#…}` 取 F 分支，`{NICKNAME}` 用同一个名字） */
const NICKNAME = {
  zh: '开拓者',
  en: 'Trailblazer',
  ja: '開拓者',
  ko: '개척자',
};

/** 清洗过程中的告警收集器（按类别计数 + 保留前若干样本） */
export class RichtextWarnings {
  constructor(limitPerKind = 8) {
    this.limitPerKind = limitPerKind;
    /** @type {Record<string, {count: number, samples: string[]}>} */
    this.kinds = Object.create(null);
  }

  /**
   * 记录一次告警。
   *
   * @param {string} kind 告警类别
   * @param {string} sample 样本文本
   */
  add(kind, sample) {
    const bucket = this.kinds[kind] ?? { count: 0, samples: [] };
    bucket.count += 1;
    if (bucket.samples.length < this.limitPerKind && !bucket.samples.includes(sample)) {
      bucket.samples.push(sample.slice(0, 160));
    }
    this.kinds[kind] = bucket;
  }

  /** 汇总（供 report 使用） */
  summary() {
    const out = {};
    for (const [kind, bucket] of Object.entries(this.kinds)) {
      out[kind] = { count: bucket.count, samples: bucket.samples };
    }
    return out;
  }

  /**
   * 某类告警的计数。
   *
   * @param {string} kind 类别
   */
  count(kind) {
    return this.kinds[kind]?.count ?? 0;
  }

  /** 全部告警总计数 */
  total() {
    return Object.values(this.kinds).reduce((sum, bucket) => sum + bucket.count, 0);
  }
}

/**
 * 数值格式化（对应架构文档 §7 `formatParam`）。
 *
 * ⚠️ 百分比语义：源站把 0.1 写成 `#1[i]%` 这种"数值在括号内、`%` 在括号外"的形式，
 * 游戏内显示为 `10%`。因此 **`percent` 为真时，先 ×100 再按 spec 取整/保留小数**。
 * 运行时 UI 消费 `{p,f,s:'%'}` 节点时必须用同样的规则，否则会显示成 `0%`。
 *
 * @param {number} value 原始值
 * @param {string} spec 格式：`i` / `f1` / `f2` / `i%` / `m` / `p`
 * @param {string} lang 语言（影响 compact 记数法）
 * @param {RichtextWarnings} [warnings] 告警收集器
 * @param {string} [sample] 样本（告警用）
 * @param {boolean} [percent] 是否存在括号外的 `%`（需要 ×100）
 * @returns {string} 格式化结果
 */
export function formatParam(value, spec, lang, warnings, sample = '', percent = false) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    warnings?.add('paramNotNumber', sample);
    return '?';
  }

  // `i%` / `p` 自身就表示百分比，不需要再乘
  if (spec === 'i%' || spec === 'p') {
    return `${Math.round(numeric * 100)}%`;
  }

  const scaled = percent ? numeric * 100 : numeric;

  switch (spec) {
    case 'i':
      return String(Math.round(scaled));
    case 'f1':
      return scaled.toFixed(1);
    case 'f2':
      return scaled.toFixed(2);
    case 'm': {
      try {
        return new Intl.NumberFormat(lang === 'zh' ? 'zh-CN' : lang, {
          notation: 'compact',
          maximumFractionDigits: 1,
        }).format(scaled);
      } catch {
        return String(scaled);
      }
    }
    default:
      warnings?.add('unknownSpec', `${spec}|${sample}`);
      return String(scaled);
  }
}

/** 允许保留为"斜体/加粗"的简单标签 */
const SIMPLE_TAGS = {
  i: 'i',
  b: 'b',
  u: 'u',
  s: 's',
  em: 'i',
  strong: 'b',
};

/** 直接丢弃（只影响排版，不影响语义）的标签 */
const DROP_TAGS = new Set([
  'unbreak',
  'size',
  'space',
  'rotate',
  'shadow',
  'gradient',
  'br',
  'nobr',
  'line-height',
  'lineheight',
  'indent',
  'center',
  'left',
  'font',
  'ruby',
  'rt',
  'rp',
  'span',
  'p',
  'div',
]);

/**
 * 清洗一段源站富文本，输出块级节点树。
 *
 * @param {string} input 源文本
 * @param {object} options 选项
 * @param {string} options.lang 语言（zh/en/ja/ko）
 * @param {'template'|'resolve'} [options.mode] `template` 保留参数占位节点；`resolve` 直接代入数值
 * @param {number[]|null} [options.paramList] `resolve` 模式使用的参数表
 * @param {'body'|'comefrom'} [options.context] 上下文；`comefrom` 下含 `{TextID#}` 的条目应整条丢弃
 * @param {RichtextWarnings} [options.warnings] 告警收集器
 * @returns {{blocks: Array<{align?: string, nodes: Array<object>}>, dropped: boolean, plain: string}}
 */
export function cleanRichText(input, options) {
  const {
    lang = 'zh',
    mode = 'template',
    paramList = null,
    context = 'body',
    warnings,
  } = options ?? {};

  const sample = typeof input === 'string' ? input.slice(0, 120) : '';
  if (typeof input !== 'string' || input.length === 0) {
    return { blocks: [], dropped: false, plain: '' };
  }

  /* ---------------- step1：换行归一 + 标签解析 ---------------- */
  // 源站把换行写成字面量 `\n`（反斜杠 + n），先统一成真换行，
  // 再把真换行统一成 `<br>` 交给下面的标签扫描器切块（step6 的落点）
  let text = input
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\n')
    .replace(/\r\n/g, '\n')
    .replace(/\n/g, '<br>');

  // `{TextID#…}` 在「获取途径」上下文里整条丢弃
  if (context === 'comefrom' && /\{TextID#[^}]*\}/.test(text)) {
    return { blocks: [], dropped: true, plain: '' };
  }

  // 逐字符扫描标签，维护样式栈；`<align="right">` 切换后续块的对齐
  /** @type {Array<{nodes: Array<object>, align?: string}>} */
  const blocks = [];
  /** @type {Array<object>} */
  let nodes = [];
  /** @type {Array<object>} */
  const styleStack = [];
  let align = null;

  const currentStyle = () => {
    const style = {};
    for (const frame of styleStack) {
      if (frame.b) style.b = true;
      if (frame.i) style.i = true;
      if (frame.u) style.u = true;
      if (frame.s) style.s = true;
      if (frame.c) style.c = frame.c;
    }
    return style;
  };

  const pushText = (value) => {
    if (!value) return;
    nodes.push({ v: value, ...currentStyle() });
  };

  const flushBlock = () => {
    if (nodes.length > 0) {
      if (align) blocks.push({ align, nodes });
      else blocks.push({ nodes });
      nodes = [];
    }
  };

  /** 处理一段纯文本（不含标签）：宏 → 参数 → 文本节点 */
  const pushSegment = (segment) => {
    if (!segment) return;

    // step2：注音 {RUBY_B#reading}base{RUBY_E#}
    const segments = [];
    let cursor = 0;
    const rubyRe = /\{RUBY_B#([^}]*)\}([\s\S]*?)\{RUBY_E#\}/g;
    let match;
    while ((match = rubyRe.exec(segment)) !== null) {
      if (match.index > cursor) segments.push({ kind: 'text', value: segment.slice(cursor, match.index) });
      segments.push({ kind: 'ruby', reading: match[1], base: match[2] });
      cursor = match.index + match[0].length;
    }
    // 残留的单个 {RUBY_B#…} / {RUBY_E#}
    let rest = segment.slice(cursor);
    if (rest.includes('{RUBY_B#') || rest.includes('{RUBY_E#')) {
      warnings?.add('unpairedRuby', rest);
      rest = rest.replace(/\{RUBY_B#([^}]*)\}/g, '').replace(/\{RUBY_E#\}/g, '');
    }
    if (rest) segments.push({ kind: 'text', value: rest });

    for (const piece of segments) {
      if (piece.kind === 'ruby') {
        // step5：ruby 转节点（base 里还可能含参数占位，继续走参数处理）
        const inner = renderInline(piece.base, {
          lang,
          mode,
          paramList,
          warnings,
          sample,
          style: currentStyle(),
          emitParam: true,
        });
        for (const node of inner) {
          if (node.v !== undefined && node.p === undefined) {
            nodes.push({ ...node, ruby: piece.reading });
          } else {
            nodes.push(node);
          }
        }
        continue;
      }

      // step3 + step4：参数替换与宏展开
      const inline = renderInline(piece.value, {
        lang,
        mode,
        paramList,
        warnings,
        sample,
        style: currentStyle(),
        emitParam: true,
      });
      nodes.push(...inline);
    }
  };

  let index = 0;
  const tagRe = /<([^>]*)>/g;
  while (index < text.length) {
    tagRe.lastIndex = index;
    const tagMatch = tagRe.exec(text);
    if (!tagMatch) {
      pushSegment(text.slice(index));
      break;
    }
    if (tagMatch.index > index) {
      pushSegment(text.slice(index, tagMatch.index));
    }

    const raw = tagMatch[1] ?? '';
    const lower = raw.toLowerCase().trim();

    if (lower.startsWith('align')) {
      // 落款右对齐：切换后续块的对齐方式，本身不产生文本
      flushBlock();
      align = /right/.test(lower) ? 'right' : null;
    } else if (lower === 'br') {
      flushBlock();
    } else if (lower.startsWith('/')) {
      // 闭合标签：弹出最近的同类样式
      const name = lower.slice(1).trim();
      if (name.startsWith('color')) {
        for (let i = styleStack.length - 1; i >= 0; i -= 1) {
          if (styleStack[i].c) {
            styleStack.splice(i, 1);
            break;
          }
        }
      } else if (SIMPLE_TAGS[name]) {
        const key = SIMPLE_TAGS[name];
        for (let i = styleStack.length - 1; i >= 0; i -= 1) {
          if (styleStack[i][key]) {
            styleStack.splice(i, 1);
            break;
          }
        }
      }
    } else if (lower.startsWith('color')) {
      const colorMatch = /#([0-9a-fA-F]{6,8})/.exec(lower);
      if (colorMatch) {
        // 只保留 6 位 RGB：8 位带 alpha，深色底上会发灰
        styleStack.push({ c: `#${colorMatch[1].slice(0, 6)}` });
      }
    } else if (SIMPLE_TAGS[lower]) {
      styleStack.push({ [SIMPLE_TAGS[lower]]: true });
    } else if (/^icon(\s|$|\/)/.test(lower)) {
      // `<icon SpriteName=AvatarCyrene id=0 width=1 height=1>` 是内联头像/精灵占位，
      // 本身不含文字；本地版没有 sprite 图集，整条丢弃，但单独计数便于复核
      warnings?.add('inlineIcon', raw);
    } else if (DROP_TAGS.has(lower) || DROP_TAGS.has(lower.split(/[=/ ]/)[0])) {
      // 无副作用，直接忽略
    } else if (/^[\u3040-\u30ff\u3400-\u9fff\uff00-\uffef]/.test(raw)) {
      // 内容本身就是中日韩文字（如「<大守护者>」），属于正文而非标签，原样保留
      pushSegment(`<${raw}>`);
    } else {
      warnings?.add('unknownTag', `<${raw}>`);
    }

    index = tagMatch.index + tagMatch[0].length;
  }

  flushBlock();

  // step6/7：块内合并相邻同一样式文本节点，去掉空块
  const cleanedBlocks = blocks
    .map((block) => {
      const merged = [];
      for (const node of block.nodes) {
        const previous = merged[merged.length - 1];
        const mergeable =
          previous &&
          previous.p === undefined &&
          node.p === undefined &&
          previous.ruby === undefined &&
          node.ruby === undefined &&
          previous.b === node.b &&
          previous.i === node.i &&
          previous.u === node.u &&
          previous.s === node.s &&
          previous.c === node.c;
        if (mergeable) {
          previous.v += node.v;
        } else if (node.v !== '' || node.p !== undefined) {
          merged.push({ ...node });
        }
      }
      return { ...block, nodes: merged };
    })
    .filter((block) => block.nodes.length > 0);

  const plain = cleanedBlocks
    .map((block) => block.nodes.map((node) => node.v ?? `#${node.p}`).join(''))
    .join('\n');

  return { blocks: cleanedBlocks, dropped: false, plain };
}

/**
 * 处理不含标签的一段文本：宏展开 + 参数替换，返回节点数组。
 *
 * @param {string} value 文本
 * @param {object} options 选项
 * @returns {Array<object>} 节点数组
 */
function renderInline(value, options) {
  const { lang, mode, paramList, warnings, sample, style, emitParam } = options;
  /** @type {Array<object>} */
  const out = [];

  let text = value;

  // step4 宏 1：{F#女}{M#男} —— 必须成对整体匹配，只吃一半会出现「他她」重复
  text = text.replace(/\{F#([^}]*)\}\{M#([^}]*)\}/g, (_all, female) => female);
  // 单独出现的 {F#…} / {M#…} 也要消费掉
  if (/\{[FM]#/.test(text)) {
    warnings?.add('unpairedGenderMacro', text);
    text = text.replace(/\{F#([^}]*)\}/g, '$1').replace(/\{M#([^}]*)\}/g, '$1');
  }

  // step4 宏 2：{NICKNAME}
  text = text.replace(/\{NICKNAME\}/g, NICKNAME[lang] ?? NICKNAME.zh);

  // step4 宏 3：{TextID#…}（正文）→ `…`；{TEXTJOIN#…} 无表可查 → `…`
  text = text.replace(/\{TextID#[^}]*\}/g, () => {
    warnings?.add('textIdInBody', sample);
    return '…';
  });
  text = text.replace(/\{TEXTJOIN#([^}]*)\}/g, (_all, inner) => {
    // `{TEXTJOIN#1234}` 里的内容多为 id 列表，无对照表可查，降级为省略号
    warnings?.add('textJoin', inner);
    return '…';
  });

  // step4 宏 4：`#{series_ref_skill_desc:UIText_…,151129,2}` —— 系列技能引用，无表可查，降级为 `…`
  text = text.replace(/#\{[^}]*\}/g, () => {
    warnings?.add('seriesRef', sample);
    return '…';
  });

  // step4 宏 5：`{LAYOUT_MOBILE#…}{LAYOUT_CONTROLLER#…}{LAYOUT_KEYBOARD#…}`
  // 是「按操作设备切换文案」的三选一排版标记：桌面端固定取 KEYBOARD（鼠标点击）分支。
  // 实测源站把三段**连写**（如 `{LAYOUT_MOBILE#Tap}{LAYOUT_CONTROLLER#Press}{LAYOUT_KEYBOARD#Click}`），
  // 因此必须整体匹配取第三段；只按单段裸删会把 `#Tap` 留成正文。
  if (/\{LAYOUT_[A-Z_]+#/.test(text)) {
    warnings?.add('layoutMacro', sample);
  }
  text = text.replace(
    /\{LAYOUT_MOBILE#([^}]*)\}\{LAYOUT_CONTROLLER#([^}]*)\}\{LAYOUT_KEYBOARD#([^}]*)\}/g,
    '$3',
  );
  // 兜底：残缺 / 单段 / 无 payload 的 LAYOUT 宏整体丢弃，不留空壳
  text = text
    .replace(/\{LAYOUT_[A-Z_]+#[^}]*\}/g, '')
    .replace(/\{LAYOUT_[A-Z_]+\}/g, '');

  // 兜底：任何剩余的 `{XXX#…}` / `{XXX}` 都记为 unknownMacro 并降级为 `…`
  text = text.replace(/\{([A-Za-z_][A-Za-z0-9_]*)(#[^}]*)?\}/g, (_all, name) => {
    warnings?.add('unknownMacro', `{${name}}`);
    return '…';
  });

  // step3 参数替换：#1[i] / #2[f1] / #1[i]% / #4[m]
  const paramRe = /#(\d+)\[([a-z0-9]+)\](%)?/gi;
  let cursor = 0;
  let match;
  while ((match = paramRe.exec(text)) !== null) {
    const before = text.slice(cursor, match.index);
    if (before) out.push({ v: before, ...style });

    const paramIndex = Number(match[1]);
    const spec = (match[2] ?? 'i').toLowerCase();
    const hasPercent = Boolean(match[3]);

    if (mode === 'resolve') {
      const raw = Array.isArray(paramList) ? paramList[paramIndex - 1] : undefined;
      if (raw === undefined) {
        // 数据本身缺 param_list（实测极少，例如个别星魂描述）：
        // 保留占位节点而不是塞 '?'，运行时可回退显示参数表；同时记为 paramMissing 供数据侧修
        warnings?.add('paramMissing', `${paramIndex} of ${paramList?.length ?? 0} | ${sample}`);
        out.push({ p: paramIndex, f: spec, ...(hasPercent ? { s: '%' } : {}), ...style });
      } else {
        const formatted = formatParam(raw, spec, lang, warnings, sample, hasPercent);
        out.push({ v: hasPercent ? `${formatted}%` : formatted, ...style });
      }
    } else if (emitParam) {
      out.push({ p: paramIndex, f: spec, ...(hasPercent ? { s: '%' } : {}), ...style });
    }
    cursor = match.index + match[0].length;
  }

  const tail = text.slice(cursor);
  if (tail) out.push({ v: tail, ...style });

  // 兜底扫描：仍未消费的 `{`（例如 `{abc` 缺右括号）
  for (const node of out) {
    if (typeof node.v === 'string' && node.v.includes('{')) {
      warnings?.add('residualBrace', node.v);
      node.v = node.v.replace(/\{[^}]*$/, '…').replace(/\{/g, '');
    }
  }

  return out;
}

/**
 * 清洗为单行纯文本（用于名称、短描述、搜索摘要）。
 *
 * @param {string} input 源文本
 * @param {object} options 选项（同 {@link cleanRichText}）
 * @returns {string} 纯文本
 */
export function cleanPlainText(input, options) {
  const { blocks } = cleanRichText(input, { ...options, mode: 'resolve' });
  return blocks
    .map((block) =>
      block.nodes
        .map((node) => (node.p !== undefined ? '' : (node.v ?? '')))
        .join(''),
    )
    .join('\n')
    .trim();
}

/**
 * 清洗为富文本节点树，并把 `{TextID#}` 所在条目整条丢弃的行为暴露给调用方。
 *
 * @param {string} input 源文本
 * @param {object} options 选项
 * @returns {Array<{align?: string, nodes: Array<object>}>|null} 被丢弃时返回 null
 */
export function cleanBlocks(input, options) {
  const result = cleanRichText(input, options);
  if (result.dropped) return null;
  return result.blocks;
}
