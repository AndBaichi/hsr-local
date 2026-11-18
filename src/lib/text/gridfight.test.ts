import { describe, expect, it } from 'vitest';

import { expandGridFightInfo, replaceVariablePlaceholders } from './gridfight';

describe('expandGridFightInfo', () => {
  it('把 item id 解析成名字（源站无闭合标签）', () => {
    const input = '可通过【<gridfightinfo type=item id=35030607>】获取【虚弱】。';
    expect(expandGridFightInfo(input, (type, id) => (type === 'item' && id === '35030607' ? '闪光手榴弹' : undefined))).toBe(
      '可通过【闪光手榴弹】获取【虚弱】。',
    );
  });

  it('解析不到时回退 id，而不是留空', () => {
    expect(expandGridFightInfo('【<gridfightinfo type=item id=999>】', () => undefined)).toBe('【999】');
  });

  it('没有 resolver 时保持原样（不影响其他页面）', () => {
    const input = '【<gridfightinfo type=item id=1>】';
    expect(expandGridFightInfo(input)).toBe(input);
  });
});

describe('replaceVariablePlaceholders', () => {
  it('把 variable 标签换成运行时占位', () => {
    const input = '当前提高：<variable name=SpotLight1_SavedValue01 factor=<unbreak>#1[i]</unbreak> format=i%>';
    expect(replaceVariablePlaceholders(input, '战斗中决定')).toBe('当前提高：战斗中决定');
  });

  it('不含 variable 时原样返回', () => {
    expect(replaceVariablePlaceholders('所需节点数：#1', '战斗中决定')).toBe('所需节点数：#1');
  });
});
