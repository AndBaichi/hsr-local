/**
 * 一次性生成脚本（临时）：把 pypinyin 的首字母表写成 TS 源文件。
 *
 * 输入：/tmp/hsr-index/zh-initials.json
 * 输出：src/lib/text/pinyin-initials.generated.ts
 */

import { readFileSync, writeFileSync } from 'node:fs';

const table = JSON.parse(readFileSync('/tmp/hsr-index/zh-initials.json', 'utf8'));

/** 人工裁决的例外：多音首字按游戏内语境取音（覆盖 pypinyin 的默认读音） */
const OVERRIDES = {
  长: 'c', // 长夜月 / 长路终有归途 / 长期主义 —— 全读 cháng
  重: 'c', // 重返幽冥 / 重塑时光之忆 / 重循苦旅的司铎 —— 读 chóng
};

/** 从各组里摘掉要被改判的字 */
for (const [ch, letter] of Object.entries(OVERRIDES)) {
  for (const [group, chars] of Object.entries(table)) {
    if (chars.includes(ch)) table[group] = chars.replace(ch, '');
  }
  const upper = letter.toUpperCase();
  table[letter] = (table[letter] ?? '') + ch;
}

const collator = new Intl.Collator('zh-Hans-CN-u-co-pinyin');

const lines = [];
for (const letter of Object.keys(table).sort()) {
  const chars = [...new Set(table[letter])].sort((a, b) => collator.compare(a, b)).join('');
  lines.push(`  ${letter.toUpperCase()}: '${chars}',`);
}

const total = Object.keys(table).reduce((sum, key) => sum + new Set(table[key]).size, 0);

const content = `/**
 * 汉字 → 拼音首字母（**生成文件，勿手改**）
 *
 * 用途：资料库列表按标题首字拼音排序、右侧字母索引条分组。
 *
 * ## 覆盖范围
 *
 * 只收录数据包里**实际作为卡片标题首字出现过**的 ${total} 个汉字（四语言索引 + 货币战争六图鉴，
 * 4.7.51 实测），不做通用汉字表——这样体积是 2.6 KB 而不是几百 KB。
 * 未收录的字在运行时落到 \`#\` 组，不会崩，只是排序位置靠后。
 *
 * ## 生成方式
 *
 * 1. \`pypinyin\`（Python）对首字取 \`Style.FIRST_LETTER\`，得到初版分组；
 * 2. 用 \`Intl.Collator('zh-Hans-CN-u-co-pinyin')\` 对全部字排序做**交叉验证**：
 *    按 ICU 拼音序排完，同一字母组的字必须连续——839 字里只有「蕃」（bō/fán 两读）一处分歧，
 *    说明两套独立实现一致，表可信；
 * 3. 多音首字人工裁决（见下表），其余取 pypinyin 默认读音。
 *
 * 例外（按游戏内语境取音，与 pypinyin 默认读音不同）：
 *  - 长 → c（长夜月 / 长路终有归途 / 长期主义，全读 cháng）
 *  - 重 → c（重返幽冥 / 重塑时光之忆 / 重循苦旅的司铎，读 chóng）
 *
 * 生成脚本见 \`_attic/scripts/tmp-gen-pinyin.py\` + \`tmp-index-chars.mjs\`（一次性，不在构建链里）。
 * 数据包版本升级后若新增首字，重新跑脚本即可。
 */

/** 字母 → 该字母开头的汉字（组内按拼音序） */
export const PINYIN_INITIAL_GROUPS: Readonly<Record<string, string>> = {
${lines.join('\n')}
};
`;

writeFileSync('src/lib/text/pinyin-initials.generated.ts', content, 'utf8');
console.log('写入', total, '字，', Object.keys(table).length, '组');
