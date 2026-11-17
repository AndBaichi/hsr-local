/**
 * 富文本渲染器 × 真实数据包（`HSR_SWEEP_PACK=<解包目录> npm test`）
 *
 * ## 为什么单测之外还要这一条
 *
 * `richtext.test.ts` 证明的是「逻辑对」，用的是照抄真实形状的内联夹具。
 * 但它证明不了两件事：
 *  1. 夹具**确实**是照抄的（万一抄错一位，单测会一直绿）
 *  2. 渲染器的严格性（未知 `f` 就抛错）**不会在真实数据里误伤**——一旦某个敌人描述
 *     带了没见过的格式，11 个页面会一起白屏
 *
 * 所以这条测试直接扫 `db/zh/**`（1022 个文件、3.6 万个节点）：
 *  - 每个富文本都要能渲染，不抛错
 *  - 6 条金标准向量的期望字符串，要与**真实文件**算出来的结果逐字一致
 *
 * 没设 `HSR_SWEEP_PACK` 时整组跳过（CI 上没有 `%APPDATA%` 数据不会红），
 * 与 Rust 侧 `HSR_SELFTEST_PACK` 的做法一致。
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { RichText } from '@/lib/data/types';

import { renderRichText, richTextToPlain } from './richtext';

/** 解包后的数据包根目录（未设置则整组跳过） */
const PACK_ROOT = process.env.HSR_SWEEP_PACK;

/** 兜底参数表：足够长，保证「下标越界」不会掩盖「格式未知」 */
const FALLBACK_PARAMS = [0.5, 3, 0.3, 190, 5, 1.5, 0.6, 0.12, 0.24, 2.2, 0.665, 973.75, 0.9, 1, 0.75];

/** 扫描统计 */
interface SweepStats {
  files: number;
  richTexts: number;
  nodes: number;
  formats: Set<string>;
  suffixes: Set<string>;
  colors: Set<string>;
}

/**
 * 判断一个值是否是富文本（`[{ nodes: [...] }]`）。
 *
 * @param value 待判定值
 */
function isRichText(value: unknown): value is RichText {
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.every(
    (paragraph) =>
      typeof paragraph === 'object' &&
      paragraph !== null &&
      Array.isArray((paragraph as { nodes?: unknown }).nodes),
  );
}

/**
 * 递归遍历一个 JSON 值，渲染所有富文本。
 *
 * `paramList` 沿祖先链向下传递：真实数据里参数表总是富文本的兄弟/父级字段
 * （`levels[].paramList`、`effects[].paramList`），遇到就带着往下走。
 *
 * @param value 当前值
 * @param stats 统计累加器
 * @param paramList 最近的参数表
 */
function walk(value: unknown, stats: SweepStats, paramList: readonly number[]): void {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, stats, paramList);
    return;
  }
  if (typeof value !== 'object' || value === null) return;

  const record = value as Record<string, unknown>;

  // 同一层里若有 paramList，先接管再往下走（effects[] / levels[] 的结构）
  const ownParams =
    Array.isArray(record.paramList) && record.paramList.every((item) => typeof item === 'number')
      ? (record.paramList as number[])
      : undefined;

  const nextParams = ownParams ?? paramList;

  for (const child of Object.values(record)) {
    if (isRichText(child)) {
      stats.richTexts += 1;
      for (const paragraph of child) {
        for (const node of paragraph.nodes) {
          stats.nodes += 1;
          if (typeof node.f === 'string') stats.formats.add(node.f);
          if (typeof node.s === 'string') stats.suffixes.add(node.s);
          if (typeof node.c === 'string') stats.colors.add(node.c);
        }
      }
      // 渲染失败会直接抛错 → 测试失败，错误信息里带节点原文
      const rendered = renderRichText(child, { paramList: nextParams });
      // 顺带压平一次，确保 richTextToPlain 也不会炸（T04 的 title/复制会用）
      richTextToPlain(child, { paramList: nextParams });
      expect(rendered.length).toBe(child.length);
      continue;
    }
    walk(child, stats, nextParams);
  }
}

/**
 * 递归收集目录下所有 .json 文件。
 *
 * @param dir 目录
 */
function listJson(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listJson(full));
    } else if (entry.name.endsWith('.json')) {
      out.push(full);
    }
  }
  return out;
}

describe.skipIf(PACK_ROOT === undefined || PACK_ROOT === '')('真实数据包：富文本渲染', () => {
  it('db/zh/** 全部富文本都能渲染，且格式/后缀/颜色都在已知取值域内', () => {
    const stats: SweepStats = {
      files: 0,
      richTexts: 0,
      nodes: 0,
      formats: new Set(),
      suffixes: new Set(),
      colors: new Set(),
    };

    for (const file of listJson(join(PACK_ROOT as string, 'db/zh'))) {
      stats.files += 1;
      walk(JSON.parse(readFileSync(file, 'utf8')), stats, FALLBACK_PARAMS);
    }

    // 扫描规模的下限：文件少说明路径配错了，"全部通过"会变成假阳性
    expect(stats.files).toBeGreaterThanOrEqual(1000);
    expect(stats.nodes).toBeGreaterThanOrEqual(30_000);

    // 严格性的护栏：真实数据只用这三种格式（未知格式会让渲染器抛错）
    expect([...stats.formats].sort()).toEqual(['f1', 'f2', 'i']);
    // 后缀实测只有 %
    expect([...stats.suffixes]).toEqual(['%']);

    console.log(
      `[sweep] ${stats.files} 个文件 / ${stats.richTexts} 段富文本 / ${stats.nodes} 个节点；` +
        `f=${[...stats.formats].sort().join(',')} s=${[...stats.suffixes].join(',')} ` +
        `c=${[...stats.colors].sort().join(',')}`,
    );
    // 全量扫 1022 个 JSON / 3.6 万节点实测约 6.9s，vitest 默认 5s 会误判超时。
    // 这是 IO 密集型断言，不是逻辑卡死；放宽到 30s 并按规模下限防止假阳性。
  }, 30_000);

  it('6 条金标准向量与真实文件逐字一致（夹具没有抄错）', () => {
    const character = JSON.parse(
      readFileSync(join(PACK_ROOT as string, 'db/zh/character/1001.json'), 'utf8'),
    ) as {
      skills: {
        name: string;
        desc: RichText;
        levels: { level: number; paramList: number[] }[];
      }[];
    };
    const lightcone = JSON.parse(
      readFileSync(join(PACK_ROOT as string, 'db/zh/lightcone/20000.json'), 'utf8'),
    ) as { refinement: { desc: RichText; levels: { level: number; paramList: number[] }[] } };

    /**
     * 取真实等级表里某一级的参数。
     *
     * @param levels 等级表
     * @param level 目标等级
     */
    const paramsAt = (levels: { level: number; paramList: number[] }[], level: number): number[] => {
      const found = levels.find((entry) => entry.level === level);
      if (found === undefined) throw new Error(`数据包里没有 Lv.${level}`);
      return found.paramList;
    };

    expect(
      richTextToPlain(character.skills[0].desc, {
        paramList: paramsAt(character.skills[0].levels, 1),
      }),
    ).toBe('对指定敌方单体造成等同于三月七50%攻击力的冰属性伤害。');

    expect(
      richTextToPlain(character.skills[0].desc, {
        paramList: paramsAt(character.skills[0].levels, 10),
      }),
    ).toBe('对指定敌方单体造成等同于三月七140%攻击力的冰属性伤害。');

    expect(
      richTextToPlain(character.skills[1].desc, {
        paramList: paramsAt(character.skills[1].levels, 1),
      }),
    ).toBe(
      '为指定我方单体提供能够抵消等同于三月七38%防御力+190伤害的护盾，持续3回合。\n若该目标当前生命值百分比大于等于30%，被敌方攻击的概率大幅提高。',
    );

    expect(
      richTextToPlain(character.skills[2].desc, {
        paramList: paramsAt(character.skills[2].levels, 10),
      }),
    ).toBe(
      '对敌方全体造成等同于三月七150%攻击力的冰属性伤害。受到攻击的敌方目标有50%基础概率陷入冻结状态，持续1回合。\n冻结状态下，敌方目标不能行动同时每回合开始时受到等同于三月七60%攻击力的冰属性附加伤害。',
    );

    expect(
      richTextToPlain(lightcone.refinement.desc, {
        paramList: paramsAt(lightcone.refinement.levels, 1),
      }),
    ).toBe('战斗开始时，使装备者的暴击率提高12%，持续3回合。');

    expect(
      richTextToPlain(lightcone.refinement.desc, {
        paramList: paramsAt(lightcone.refinement.levels, 5),
      }),
    ).toBe('战斗开始时，使装备者的暴击率提高24%，持续3回合。');
  });
});
