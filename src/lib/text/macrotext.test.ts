/** 宏文本渲染器单测：真实样例 + 边界 */

import { describe, expect, it } from 'vitest';

import { macroTextToPlain, renderMacroText } from './macrotext';

describe('renderMacroText', () => {
  it('空值返回空片段', () => {
    expect(renderMacroText(null).spans).toEqual([]);
    expect(renderMacroText(undefined).spans).toEqual([]);
    expect(renderMacroText('').spans).toEqual([]);
  });

  it('真实样例：百分比参数 + color + unbreak + 字面换行', () => {
    // db/zh/currency/buff.json 的真实形态（简化）
    const raw =
      '敌方全体受到的伤害提高<color=#f29e38ff><unbreak>#1[i]%</unbreak></color>。\\n持续#2[i]回合。';
    expect(macroTextToPlain(raw, [0.25, 3])).toBe('敌方全体受到的伤害提高25%。\n持续3回合。');
  });

  it('百分比触发 ×100，且 f1/f2 保留小数', () => {
    expect(macroTextToPlain('#1[i]%', [0.12])).toBe('12%');
    expect(macroTextToPlain('#1[f1]%', [0.125])).toBe('12.5%');
    expect(macroTextToPlain('#1[f2]%', [0.1234])).toBe('12.34%');
    expect(macroTextToPlain('#1[i]', [3])).toBe('3');
  });

  it('没有参数表时原样保留占位，绝不编造数字', () => {
    expect(macroTextToPlain('造成#1[i]%伤害')).toBe('造成#1[i]%伤害');
    expect(macroTextToPlain('造成#2[i]伤害', [9])).toBe('造成#2[i]伤害');
  });

  it('未知规格不猜，降级为可识别占位', () => {
    expect(macroTextToPlain('#1[m]', [12345])).toBe('#?[m]');
  });

  it('未知标签去掉标签但保留正文，且不会污染外层颜色', () => {
    const raw = '<color=#f29e38ff>红<property type=X display=icon>内文</property>后</color>尾';
    const result = renderMacroText(raw);
    expect(macroTextToPlain(raw)).toBe('红内文后尾');
    expect(result.unknownTags).toContain('property');
    // 相邻同样式片段会合并，所以「红内文后」是同一个 span
    const colored = result.spans.find((span) => span.text.includes('后'));
    expect(colored?.text).toBe('红内文后');
    expect(colored?.color).toBe('#f29e38ff');
    const end = result.spans.find((span) => span.text === '尾');
    expect(end?.color).toBeUndefined();
  });

  it('<variable> 展开成参数值，属性里嵌的标签不会漏成正文', () => {
    // db/zh/currency/spotlight.json 的真实形态：factor 里还嵌着 <unbreak>
    const raw =
      '当前提高：<variable name=SpotLight100100_SavedValue01 factor=<unbreak>#1[i]</unbreak> format=i%>';
    expect(macroTextToPlain(raw, [0.01])).toBe('当前提高：1%');
    expect(macroTextToPlain(`<variableproperty type=X>甲</variableproperty>`)).toBe('甲');
  });

  it('样式标签正确嵌套与出栈', () => {
    const raw = '<u>甲<i>乙</i>丙</u>丁';
    const result = renderMacroText(raw);
    expect(result.spans.map((span) => [span.text, span.underline, span.italic])).toEqual([
      ['甲', true, undefined],
      ['乙', true, true],
      ['丙', true, undefined],
      ['丁', undefined, undefined],
    ]);
  });

  it('孤立闭合标签不会把样式栈弹穿', () => {
    const raw = '</property><color=#abcdef>甲</nothing>乙</color>';
    expect(macroTextToPlain(raw)).toBe('甲乙');
    // 未知闭合标签不能把 <color> 弹掉；「甲乙」合并为一个仍带色的 span
    expect(renderMacroText(raw).spans.find((span) => span.text.includes('乙'))?.color).toBe('#abcdef');
  });

  it('非法颜色值不会注入到 style（只允许 hex）', () => {
    const raw = '<color=red>甲</color>';
    expect(renderMacroText(raw).spans[0].color).toBeUndefined();
  });

  it('真实字符串：换行是字面 \\n 而非真实换行', () => {
    const raw = '第一行\\n第二行';
    expect(macroTextToPlain(raw)).toBe('第一行\n第二行');
  });
});
