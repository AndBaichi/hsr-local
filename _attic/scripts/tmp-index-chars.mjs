/**
 * 一次性分析脚本（临时）：统计各列表页卡片标题在四语言下的首字符集合。
 *
 * 用途：为「首字母索引条」确定需要覆盖的字符范围。
 * 产物：/tmp/hsr-index/*.json（首字清单，供 pypinyin 生成拼音表）。
 *
 * 不属于构建链，验证完即可移入 `_attic/`。
 */

import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.argv[2];
if (!ROOT) throw new Error('usage: node tmp-index-chars.mjs <packRoot>');

const DB = join(ROOT, 'db');
mkdirSync('/tmp/hsr-index', { recursive: true });

/** 各语言的名称收集器 */
const buckets = new Map([['zh', new Map()], ['en', new Map()], ['ja', new Map()], ['ko', new Map()]]);

function addName(lang, name, source) {
  if (typeof name !== 'string' || name === '') return;
  const ch = Array.from(name)[0];
  const bucket = buckets.get(lang);
  if (!bucket.has(ch)) bucket.set(ch, []);
  const list = bucket.get(ch);
  if (!list.includes(source)) list.push(source);
}

function readJson(path) {
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  return Array.isArray(parsed) ? parsed : Object.values(parsed);
}

// 1) 四语言索引里的 names
for (const file of ['character.json', 'lightcone.json', 'relicset.json', 'monster.json']) {
  for (const entry of readJson(join(DB, file))) {
    for (const lang of ['zh', 'en', 'ja', 'ko']) addName(lang, entry.names?.[lang], file);
  }
}

// 2) 物品索引分片（只有 names）
for (const shard of readdirSync(join(DB, 'item'))) {
  if (!shard.endsWith('.json')) continue;
  for (const entry of readJson(join(DB, 'item', shard))) {
    for (const lang of ['zh', 'en', 'ja', 'ko']) addName(lang, entry.names?.[lang], 'item');
  }
}

// 3) 货币战争六个图鉴（单语言，取 zh 目录；其余语言目录结构相同）
for (const file of ['augment.json', 'buff.json', 'item.json', 'role.json', 'spotlight.json', 'trait.json']) {
  for (const entry of readJson(join(DB, 'zh', 'currency', file))) {
    addName('zh', entry.name, `currency/${file}`);
  }
}
for (const lang of ['en', 'ja', 'ko']) {
  for (const file of ['augment.json', 'buff.json', 'item.json', 'role.json', 'spotlight.json', 'trait.json']) {
    for (const entry of readJson(join(DB, lang, 'currency', file))) {
      addName(lang, entry.name, `currency/${file}`);
    }
  }
}

for (const [lang, bucket] of buckets) {
  const chars = [...bucket.keys()].sort();
  writeFileSync(`/tmp/hsr-index/${lang}.json`, JSON.stringify(chars), 'utf8');
  const cjk = chars.filter((c) => /[\u4e00-\u9fff]/.test(c));
  const kana = chars.filter((c) => /[\u3040-\u30ff]/.test(c));
  const hangul = chars.filter((c) => /[\uac00-\ud7af]/.test(c));
  const latin = chars.filter((c) => /[A-Za-z]/.test(c));
  console.log(
    `${lang}: 首字 ${chars.length}（汉字 ${cjk.length} / 假名 ${kana.length} / 谚文 ${hangul.length} / 拉丁 ${latin.length} / 其他 ${chars.length - cjk.length - kana.length - hangul.length - latin.length}）`,
  );
}

console.log('\nzh 非汉字首字符：', [...buckets.get('zh').keys()].filter((c) => !/[\u4e00-\u9fff]/.test(c)).join(' '));
console.log('en 非拉丁首字符：', [...buckets.get('en').keys()].filter((c) => !/[A-Za-z]/.test(c)).join(' '));
