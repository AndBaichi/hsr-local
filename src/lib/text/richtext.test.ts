/**
 * 富文本渲染器单测（`npm test`）
 *
 * ## 为什么这些向量必须存在
 *
 * `s: "%"` 触发 ×100 是整个渲染器唯一「错了不崩溃、只静默输出错数值」的地方：
 * `0.12` 会渲染成 `0.12%` 而不是 `12%`，页面看起来完全正常，只有懂游戏的玩家
 * 才会发现数字不对。所以下面 6 条**金标准向量**的期望字符串是逐字钉死的，
 * 数据取自真实数据包（`db/zh/character/1001.json` 与 `db/zh/lightcone/20000.json`，
 * 节点数组与 paramList 都是原文照抄，不是手写构造），
 * 期望输出与游戏内文案逐字一致。
 */

import { describe, expect, it } from 'vitest';

import type { RichText } from '@/lib/data/types';

import { paramListAtLevel, renderRichText, richTextToPlain, RichTextError } from './richtext';

/** 三月七 `skills[0].desc`（「极寒的弓矢」，普通攻击）——原文照抄 */
const MARCH7_SKILL0: RichText = [
  {
    nodes: [
      { v: '对指定敌方单体造成等同于三月七' },
      { p: 1, f: 'i', s: '%', c: '#f29e38' },
      { v: '攻击力的冰属性伤害。' },
    ],
  },
];

/** 三月七 `skills[1].desc`（「可爱即是正义」，战技，两段）——原文照抄 */
const MARCH7_SKILL1: RichText = [
  {
    nodes: [
      { v: '为指定我方单体提供能够抵消等同于三月七' },
      { p: 1, f: 'i', s: '%', c: '#f29e38' },
      { v: '防御力+' },
      { p: 4, f: 'i', c: '#f29e38' },
      { v: '伤害的护盾，持续' },
      { p: 2, f: 'i' },
      { v: '回合。' },
    ],
  },
  {
    nodes: [
      { v: '若该目标当前生命值百分比大于等于' },
      { p: 3, f: 'i', s: '%' },
      { v: '，被敌方攻击的概率大幅提高。' },
    ],
  },
];

/** 三月七 `skills[2].desc`（「冰刻箭雨之时」，终结技，带两个术语）——原文照抄 */
const MARCH7_SKILL2: RichText = [
  {
    nodes: [
      { v: '对敌方全体造成等同于三月七' },
      { p: 1, f: 'i', s: '%', c: '#f29e38' },
      { v: '攻击力的冰属性伤害。受到攻击的敌方目标有' },
      { p: 2, f: 'i', s: '%' },
      { v: '基础概率', u: true },
      { v: '陷入冻结状态，持续' },
      { p: 3, f: 'i' },
      { v: '回合。' },
    ],
  },
  {
    nodes: [
      { v: '冻结状态下，敌方目标不能行动同时每回合开始时受到等同于三月七' },
      { p: 4, f: 'i', s: '%', c: '#f29e38' },
      { v: '攻击力的冰属性' },
      { v: '附加伤害', u: true },
      { v: '。' },
    ],
  },
];

/** 光锥 20000 `refinement.desc`（「危机」，叠影 1–5）——原文照抄 */
const LIGHTCONE_20000: RichText = [
  {
    nodes: [
      { v: '战斗开始时，使装备者的暴击率提高' },
      { p: 1, f: 'i', s: '%', c: '#f29e38' },
      { v: '，持续' },
      { p: 2, f: 'i' },
      { v: '回合。' },
    ],
  },
];

/** 真实数据里出现的全部 5 个色值（扫描 1022 个 zh 详情文件得到） */
const REAL_COLORS = ['#f29e38', '#8790ab', '#cb2f2f', '#de7a66', '#f9b0f0'] as const;

describe('renderRichText：金标准向量（期望值 = 游戏内文案逐字）', () => {
  it('三月七 skills[0] Lv.1 → 50%', () => {
    expect(richTextToPlain(MARCH7_SKILL0, { paramList: [0.5] })).toBe(
      '对指定敌方单体造成等同于三月七50%攻击力的冰属性伤害。',
    );
  });

  it('三月七 skills[0] Lv.10 → 140%', () => {
    expect(richTextToPlain(MARCH7_SKILL0, { paramList: [1.4] })).toBe(
      '对指定敌方单体造成等同于三月七140%攻击力的冰属性伤害。',
    );
  });

  it('三月七 skills[1] Lv.1 → 38% / +190 / 3 回合 / 30%（两段）', () => {
    const params = [0.38, 3, 0.3, 190, 5];
    const paragraphs = renderRichText(MARCH7_SKILL1, { paramList: params });
    expect(paragraphs).toHaveLength(2);
    expect(richTextToPlain(MARCH7_SKILL1, { paramList: params })).toBe(
      '为指定我方单体提供能够抵消等同于三月七38%防御力+190伤害的护盾，持续3回合。\n若该目标当前生命值百分比大于等于30%，被敌方攻击的概率大幅提高。',
    );
  });

  it('三月七 skills[2] Lv.10 → 150% / 50% / 1 回合 / 60%', () => {
    expect(richTextToPlain(MARCH7_SKILL2, { paramList: [1.5, 0.5, 1, 0.6] })).toBe(
      '对敌方全体造成等同于三月七150%攻击力的冰属性伤害。受到攻击的敌方目标有50%基础概率陷入冻结状态，持续1回合。\n冻结状态下，敌方目标不能行动同时每回合开始时受到等同于三月七60%攻击力的冰属性附加伤害。',
    );
  });

  it('光锥 20000 refinement Lv.1 → 12% / 3 回合', () => {
    expect(richTextToPlain(LIGHTCONE_20000, { paramList: [0.12, 3] })).toBe(
      '战斗开始时，使装备者的暴击率提高12%，持续3回合。',
    );
  });

  it('光锥 20000 refinement Lv.5 → 24% / 3 回合', () => {
    expect(richTextToPlain(LIGHTCONE_20000, { paramList: [0.24, 3] })).toBe(
      '战斗开始时，使装备者的暴击率提高24%，持续3回合。',
    );
  });
});

describe('renderRichText：百分比语义（唯一静默出错点）', () => {
  it('s="%" 先 ×100 再格式化（不是先格式化再乘）', () => {
    expect(
      richTextToPlain([{ nodes: [{ p: 1, f: 'f1', s: '%' }] }], { paramList: [0.1234] }),
    ).toBe('12.3%');
  });

  it('没有 s 的参数不 ×100', () => {
    expect(richTextToPlain([{ nodes: [{ p: 1, f: 'i' }] }], { paramList: [0.9] })).toBe('1');
    expect(richTextToPlain([{ nodes: [{ p: 1, f: 'i' }] }], { paramList: [190] })).toBe('190');
  });

  it('i 四舍五入，f1/f2 保留小数位', () => {
    expect(richTextToPlain([{ nodes: [{ p: 1, f: 'i' }] }], { paramList: [973.75] })).toBe('974');
    expect(richTextToPlain([{ nodes: [{ p: 1, f: 'f1' }] }], { paramList: [2.25] })).toBe('2.3');
    expect(richTextToPlain([{ nodes: [{ p: 1, f: 'f2' }] }], { paramList: [2.2] })).toBe('2.20');
  });

  it('浮点误差不会漏到界面上（0.38 × 100 = 38.000000000000004）', () => {
    expect(
      richTextToPlain([{ nodes: [{ p: 1, f: 'i', s: '%' }] }], { paramList: [0.38] }),
    ).toBe('38%');
    expect(
      richTextToPlain([{ nodes: [{ p: 1, f: 'i', s: '%' }] }], { paramList: [0.665] }),
    ).toBe('67%');
  });
});

describe('renderRichText：样式标志', () => {
  it('u 标记为 term，i 标记为 italic，c 透传颜色', () => {
    const [paragraph] = renderRichText(
      [
        {
          nodes: [
            { v: '追加施放', u: true },
            { v: '台词', i: true },
            { p: 1, f: 'i', c: '#8790ab' },
          ],
        },
      ],
      { paramList: [7] },
    );

    expect(paragraph.spans[0]).toEqual({ text: '追加施放', term: true });
    expect(paragraph.spans[1]).toEqual({ text: '台词', italic: true });
    expect(paragraph.spans[2]).toEqual({ text: '7', color: '#8790ab', paramIndex: 1 });
  });

  it('段落 align 透传（物品署名行）', () => {
    const [paragraph] = renderRichText([
      { nodes: [{ v: '——悬锋城母亲教育孩子的俗语' }], align: 'right' },
    ]);
    expect(paragraph.align).toBe('right');
  });

  it('非法颜色被忽略而不是炸掉整段', () => {
    const [paragraph] = renderRichText([{ nodes: [{ p: 1, f: 'i', c: 'red' }] }], {
      paramList: [1],
    });
    expect(paragraph.spans[0]?.color).toBeUndefined();
  });

  it('真实数据里的 5 个色值都能透传', () => {
    for (const color of REAL_COLORS) {
      const [paragraph] = renderRichText([{ nodes: [{ v: 'x', c: color }] }]);
      expect(paragraph.spans[0]?.color).toBe(color);
    }
  });
});

describe('renderRichText：严格性（未知即失败，不回落）', () => {
  it('未知 f 抛 UNKNOWN_FORMAT', () => {
    try {
      renderRichText([{ nodes: [{ p: 1, f: 'f3' }] }], { paramList: [1] });
      throw new Error('应该抛错');
    } catch (error) {
      expect(error).toBeInstanceOf(RichTextError);
      expect((error as RichTextError).code).toBe('UNKNOWN_FORMAT');
    }
  });

  it('PRD §6.3 的四种上游格式（m / i% / f1% / f2%）不在成品包里，遇到也抛错', () => {
    for (const format of ['m', 'i%', 'f1%', 'f2%']) {
      try {
        renderRichText([{ nodes: [{ p: 1, f: format }] }], { paramList: [1] });
        throw new Error(`f="${format}" 应该抛错`);
      } catch (error) {
        expect((error as RichTextError).code).toBe('UNKNOWN_FORMAT');
      }
    }
  });

  it('有 p 无 f 抛 MISSING_FORMAT', () => {
    try {
      renderRichText([{ nodes: [{ p: 1 }] }], { paramList: [1] });
      throw new Error('应该抛错');
    } catch (error) {
      expect((error as RichTextError).code).toBe('MISSING_FORMAT');
    }
  });

  it('p 越界抛 PARAM_OUT_OF_RANGE（不返回空串）', () => {
    try {
      renderRichText([{ nodes: [{ p: 3, f: 'i' }] }], { paramList: [1, 2] });
      throw new Error('应该抛错');
    } catch (error) {
      expect((error as RichTextError).code).toBe('PARAM_OUT_OF_RANGE');
    }
  });

  it('p 是 1-based（p=1 取 paramList[0]）', () => {
    expect(richTextToPlain([{ nodes: [{ p: 1, f: 'i' }] }], { paramList: [42, 99] })).toBe('42');
    expect(richTextToPlain([{ nodes: [{ p: 2, f: 'i' }] }], { paramList: [42, 99] })).toBe('99');
  });

  it('空节点抛 EMPTY_NODE（既无 v 也无 p）', () => {
    try {
      renderRichText([{ nodes: [{}] }]);
      throw new Error('应该抛错');
    } catch (error) {
      expect((error as RichTextError).code).toBe('EMPTY_NODE');
    }
  });

  it('null / undefined / 空数组 返回空数组（"没有文案"是合法状态）', () => {
    expect(renderRichText(null)).toEqual([]);
    expect(renderRichText(undefined)).toEqual([]);
    expect(renderRichText([])).toEqual([]);
  });
});

describe('paramListAtLevel：等级 → 参数', () => {
  it('按 level 字段精确匹配，不用数组下标', () => {
    const levels = [
      { level: 1, paramList: [0.5] },
      { level: 10, paramList: [1.4] },
      { level: 15, paramList: [2] },
    ];
    expect(paramListAtLevel(levels, 10)).toEqual([1.4]);
  });

  it('15 级技能取 Lv.10 得到 150%（不是最后一档 180%）', () => {
    // 真实踩点：skills[2] 有 15 档，最后一档是 180%，
    // 用 levels[length-1] 的实现会把 150% 渲染成 180%
    const levels = [
      { level: 1, paramList: [0.9, 0.5, 1, 0.3] },
      { level: 10, paramList: [1.5, 0.5, 1, 0.6] },
      { level: 15, paramList: [1.8, 0.5, 1, 0.75] },
    ];
    expect(paramListAtLevel(levels, 10)[0]).toBe(1.5);
  });

  it('越界时回退到最近一档（不抛错）', () => {
    const levels = [{ level: 1, paramList: [1] }];
    expect(paramListAtLevel(levels, 12)).toEqual([1]);
    expect(paramListAtLevel(levels, 0)).toEqual([1]);
  });

  it('没有等级表时返回空数组', () => {
    expect(paramListAtLevel(undefined, 1)).toEqual([]);
    expect(paramListAtLevel([], 1)).toEqual([]);
  });
});
