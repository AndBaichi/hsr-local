/**
 * 评级表的归一化测试
 *
 * 只测"从磁盘读回来的脏数据会变成什么"——这是用户数据唯一会出问题的地方
 * （手改文件、旧版本写过裸档位字符串、键名被改）。store 里的 set/get 是纯内存
 * 逻辑，由 `store.test.ts` 那类用例覆盖成本更高、收益更低。
 */

import { describe, expect, it } from 'vitest';

import {
  coerceRatings,
  isRatingGrade,
  ratingKeyOf,
  REMARK_MAX_LENGTH,
  RATING_GRADES,
} from './types';

describe('coerceRatings', () => {
  it('旧格式裸档位字符串升级为 { grade }', () => {
    const raw = {
      'currency:role:1001': 'SSS',
      'currency:item:350101': 'C',
    };
    expect(coerceRatings(raw)).toEqual({
      'currency:role:1001': { grade: 'SSS' },
      'currency:item:350101': { grade: 'C' },
    });
  });

  it('新格式四字段全部保留', () => {
    const raw = {
      'currency:role:1001': { grade: 'SSS', tier: 'A', gradeRemark: '主 C 用，配专武', tierRemark: '爆发强' },
      'currency:item:350101': { tier: 'C' },
      'currency:item:350102': { gradeRemark: '只在活动里拿' },
      'currency:item:350103': { tierRemark: '千评级备注' },
    };
    expect(coerceRatings(raw)).toEqual({
      'currency:role:1001': { grade: 'SSS', tier: 'A', gradeRemark: '主 C 用，配专武', tierRemark: '爆发强' },
      'currency:item:350101': { tier: 'C' },
      'currency:item:350102': { gradeRemark: '只在活动里拿' },
      'currency:item:350103': { tierRemark: '千评级备注' },
    });
  });

  it('旧格式共用 remark 迁移到 gradeRemark', () => {
    const raw = {
      'currency:role:1001': { grade: 'SSS', remark: '旧版共用备注' },
      'currency:item:350102': { remark: '只在活动里拿' },
    };
    expect(coerceRatings(raw)).toEqual({
      'currency:role:1001': { grade: 'SSS', gradeRemark: '旧版共用备注' },
      'currency:item:350102': { gradeRemark: '只在活动里拿' },
    });
  });

  it('非法档位只丢该字段，同条目其它合法字段保留', () => {
    const raw = {
      'currency:role:1': { grade: 'sss', tier: 'SS' },
      'currency:role:2': { grade: 'X', gradeRemark: '备注还在' },
      'currency:role:3': { grade: 5, tier: null, tierRemark: '同理' },
    };
    expect(coerceRatings(raw)).toEqual({
      'currency:role:1': { tier: 'SS' },
      'currency:role:2': { gradeRemark: '备注还在' },
      'currency:role:3': { tierRemark: '同理' },
    });
  });

  it('备注 trim 并截断到 REMARK_MAX_LENGTH', () => {
    const long = 'あ'.repeat(REMARK_MAX_LENGTH + 50);
    const raw = {
      'currency:role:1': { gradeRemark: '  两边空白要去掉  ' },
      'currency:role:2': { gradeRemark: long },
      'currency:role:3': { gradeRemark: '   ' },
    };
    const result = coerceRatings(raw);
    expect(result['currency:role:1']).toEqual({ gradeRemark: '两边空白要去掉' });
    expect(result['currency:role:2']?.gradeRemark).toHaveLength(REMARK_MAX_LENGTH);
    // 纯空白等于没写备注：该条目四字段全空 → 整键丢弃
    expect(result['currency:role:3']).toBeUndefined();
  });

  it('备注按码点截断，不劈开代理对', () => {
    const raw = { 'currency:role:1': { gradeRemark: '😀'.repeat(250) } };
    const remark = coerceRatings(raw)['currency:role:1']?.gradeRemark;
    // 200 个完整码点：按 UTF-16 单元切只会剩 100 个 emoji，末尾还会留半个代理对
    expect(remark).toBe('😀'.repeat(REMARK_MAX_LENGTH));
  });

  it('丢弃非法档位（手改成 X / 小写 / 数字）', () => {
    const raw = {
      'currency:role:1': 'X',
      'currency:role:2': 'sss',
      'currency:role:3': 5,
      'currency:role:4': null,
      'currency:role:5': 'SS',
    };
    expect(coerceRatings(raw)).toEqual({ 'currency:role:5': { grade: 'SS' } });
  });

  it('丢弃空对象与四字段全非法的条目', () => {
    const raw = {
      'currency:role:1': {},
      'currency:role:2': { grade: 'Z', tier: 'z', gradeRemark: 42 },
      'currency:role:3': [],
      'currency:role:4': { grade: 'A' },
    };
    expect(coerceRatings(raw)).toEqual({ 'currency:role:4': { grade: 'A' } });
  });

  it('丢弃键形状不对的条目（段数 / 前缀 / 空段）', () => {
    const raw = {
      'currency:role': 'S',
      'currency:role:1:extra': 'S',
      'favorite:role:1': 'S',
      'currency::1': 'S',
      'currency:role:': 'S',
      'currency:role:9': 'A',
    };
    expect(coerceRatings(raw)).toEqual({ 'currency:role:9': { grade: 'A' } });
  });

  it('非对象输入一律当空表', () => {
    expect(coerceRatings(undefined)).toEqual({});
    expect(coerceRatings(null)).toEqual({});
    expect(coerceRatings([])).toEqual({});
    expect(coerceRatings('x')).toEqual({});
  });
});

describe('ratingKeyOf / isRatingGrade', () => {
  it('键格式为三段式', () => {
    expect(ratingKeyOf('role', '1001')).toBe('currency:role:1001');
  });

  it('只认六个档位', () => {
    for (const grade of RATING_GRADES) expect(isRatingGrade(grade)).toBe(true);
    expect(isRatingGrade('SSSS')).toBe(false);
    expect(isRatingGrade('')).toBe(false);
    expect(isRatingGrade(undefined)).toBe(false);
  });
});
