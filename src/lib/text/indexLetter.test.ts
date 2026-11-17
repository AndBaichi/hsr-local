/** 首字母索引单测：分组符号、跨语言字母表、排序不变量 */

import { describe, expect, it } from 'vitest';

import { alphabetIndexFor, firstMeaningfulChar, FALLBACK_SYMBOL, sortByIndex } from './indexLetter';

describe('firstMeaningfulChar', () => {
  it('取第一个字母/汉字，跳过前导标点与空白', () => {
    expect(firstMeaningfulChar('三月七')).toBe('三');
    expect(firstMeaningfulChar('「醉于盛会的此刻」')).toBe('醉');
    expect(firstMeaningfulChar('  《冒险鼹鼠队》')).toBe('冒');
    expect(firstMeaningfulChar('【开拓者】')).toBe('开');
  });

  it('数字也是「有意义的字符」——数字开头的名字不往后找字母', () => {
    expect(firstMeaningfulChar('3 星光锥')).toBe('3');
  });

  it('全是标点时返回 null', () => {
    expect(firstMeaningfulChar('……')).toBeNull();
    expect(firstMeaningfulChar('')).toBeNull();
  });
});

describe('alphabetIndexFor(zh)', () => {
  const index = alphabetIndexFor('zh');

  it('汉字取拼音首字母', () => {
    expect(index.groupOf('三月七')).toBe('S');
    expect(index.groupOf('云无留迹的过客')).toBe('Y');
    expect(index.groupOf('阿哈·简易武装箱')).toBe('A');
    expect(index.groupOf('毁灭')).toBe('H');
  });

  it('多音首字按游戏内语境取音（长/重 读 cháng/chóng）', () => {
    expect(index.groupOf('长夜月')).toBe('C');
    expect(index.groupOf('长路终有归途')).toBe('C');
    expect(index.groupOf('重返幽冥')).toBe('C');
    expect(index.groupOf('重塑时光之忆')).toBe('C');
  });

  it('未收录汉字、数字、纯符号落 #', () => {
    expect(index.groupOf('龘')).toBe(FALLBACK_SYMBOL);
    expect(index.groupOf('3 星光锥')).toBe(FALLBACK_SYMBOL);
    expect(index.groupOf('███')).toBe(FALLBACK_SYMBOL);
    // 占位符字串（数据里的 `{NICKNAME}`）跳过符号后仍能按字母分组
    expect(index.groupOf('{NICKNAME}')).toBe('N');
  });

  it('拉丁字母直接取大写（四语言混排时不至于全进 #）', () => {
    expect(index.groupOf('March 7th')).toBe('M');
  });

  it('字母条是 A–Z + #', () => {
    expect(index.enabled).toBe(true);
    expect(index.symbols).toHaveLength(27);
    expect(index.symbols[0]).toBe('A');
    expect(index.symbols[25]).toBe('Z');
    expect(index.symbols[26]).toBe(FALLBACK_SYMBOL);
  });
});

describe('alphabetIndexFor 其他语言', () => {
  it('en 按首字母大写', () => {
    const index = alphabetIndexFor('en');
    expect(index.groupOf('Arrows')).toBe('A');
    expect(index.groupOf('amber')).toBe('A');
    expect(index.groupOf('""')).toBe(FALLBACK_SYMBOL);
  });

  it('ko 按谚文初声，双辅音并入基本音', () => {
    const index = alphabetIndexFor('ko');
    expect(index.groupOf('화살촉')).toBe('ㅎ');
    expect(index.groupOf('단')).toBe('ㄷ');
    expect(index.groupOf('깡')).toBe('ㄱ'); // ㄲ → ㄱ
    expect(index.groupOf('똘')).toBe('ㄷ'); // ㄸ → ㄷ
    expect(index.symbols).toHaveLength(15);
  });

  it('ja 不启用字母条（数据包无假名读音，汉字无法取五十音行）', () => {
    const index = alphabetIndexFor('ja');
    expect(index.enabled).toBe(false);
    expect(index.symbols).toEqual([]);
  });
});

describe('sortByIndex', () => {
  const index = alphabetIndexFor('zh');

  it('按符号顺序排，组内按拼音，最后才是 #', () => {
    const items = ['三月七', '阿哈', '镜流', '3 星', '巴洛'];
    const result = sortByIndex(items, (item) => item, index, 'zh');
    expect(result.sorted).toEqual(['阿哈', '巴洛', '镜流', '三月七', '3 星']);
    expect(result.symbols).toEqual(['A', 'B', 'J', 'S', '#']);
  });

  it('符号与条目一一对应，长度为 0 时不炸', () => {
    const result = sortByIndex([], (item: string) => item, index, 'zh');
    expect(result.sorted).toEqual([]);
    expect(result.symbols).toEqual([]);
  });

  it('不修改入参', () => {
    const items = ['三月七', '阿哈'];
    sortByIndex(items, (item) => item, index, 'zh');
    expect(items).toEqual(['三月七', '阿哈']);
  });

  it('排序结果的首字母序列非递减（不变量）', () => {
    const items = ['云无留迹的过客', '三月七', '阿哈', '毁灭', '镜流', '2 型', '「醉于盛会」'];
    const result = sortByIndex(items, (item) => item, index, 'zh');
    const ranks = result.symbols.map((symbol) => index.symbols.indexOf(symbol));
    for (let i = 1; i < ranks.length; i += 1) {
      expect(ranks[i]).toBeGreaterThanOrEqual(ranks[i - 1]);
    }
  });
});
