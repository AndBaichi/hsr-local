/**
 * 数据契约验证：页面依赖的字段与路径，在真实数据包里是否真的存在
 * （`HSR_SWEEP_PACK=<解包目录> npm test`）
 *
 * ## 为什么需要它
 *
 * 11 个页面全部能通过 `tsc`，但 TS 只能证明「代码符合我们写的类型声明」，
 * 证明不了「类型声明符合真实 JSON」。本项目已经踩过一次：
 * `read_stats` 把 `db/character.json` 当对象、把 `name` 当对象，两层都错却从不报错。
 *
 * 这个文件直接读真实包，把最容易静默出错的几条约定钉死：
 *  - 物品索引**没有** `name`，只有 `names{}`
 *  - 敌人索引**没有** `id`，用 `groupKey` + `primaryId`
 *  - 图片必须用 `icon` 字段，按 id 拼路径会大面积 404
 *  - 详情文件的真实路径（尤其 `db/{lang}/item/{id%16}.json` 分片）
 *  - `element/lightning` 实际文件名是 `thunder.webp`
 *
 * 没设环境变量时整组跳过，CI 上没有数据包也不会红。
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const PACK = process.env.HSR_SWEEP_PACK;

/** 读 JSON，缺失直接让测试失败（而不是静默跳过） */
function readJson(rel: string): unknown {
  return JSON.parse(readFileSync(join(PACK as string, rel), 'utf8')) as unknown;
}

/** 断言是数组 */
function asArray(value: unknown, label: string): readonly Record<string, unknown>[] {
  expect(Array.isArray(value), `${label} 应该是数组`).toBe(true);
  return value as Record<string, unknown>[];
}

/** 所有条目都必须有这些字段且类型/非空符合预期 */
function requireFields(
  rows: readonly Record<string, unknown>[],
  fields: readonly string[],
  label: string,
): void {
  expect(rows.length, `${label} 不应为空`).toBeGreaterThan(0);
  for (const field of fields) {
    const missing = rows.filter((row) => !(field in row) || row[field] === undefined);
    expect(missing.length, `${label} 有 ${missing.length} 条缺字段 ${field}`).toBe(0);
  }
}

describe.skipIf(PACK === undefined || PACK === '')('真实数据包契约', () => {
  it('六个索引的条数与必填字段符合前端类型声明', () => {
    const characters = asArray(readJson('db/character.json'), 'character');
    const lightcones = asArray(readJson('db/lightcone.json'), 'lightcone');
    const relicsets = asArray(readJson('db/relicset.json'), 'relicset');
    const monsters = asArray(readJson('db/monster.json'), 'monster');
    const achievements = asArray(readJson('db/achievement.json'), 'achievement');

    expect(characters).toHaveLength(101);
    expect(lightcones).toHaveLength(174);
    expect(relicsets).toHaveLength(64);
    expect(monsters).toHaveLength(382);
    expect(achievements).toHaveLength(9);

    requireFields(characters, ['id', 'names', 'rarity', 'path', 'element', 'icon'], 'character');
    requireFields(lightcones, ['id', 'names', 'rarity', 'path', 'icon'], 'lightcone');
    requireFields(relicsets, ['id', 'names', 'kind', 'icon'], 'relicset');
    requireFields(monsters, ['groupKey', 'names', 'icon', 'primaryId', 'variantIds'], 'monster');
    requireFields(achievements, ['id', 'name', 'itemCount'], 'achievementSeries');

    // 物品 16 分片合并后 1606 条，且索引只有精简字段
    let items = 0;
    for (let shard = 0; shard < 16; shard += 1) {
      const rows = asArray(readJson(`db/item/${shard}.json`), `item/${shard}`);
      items += rows.length;
      requireFields(rows, ['id', 'names', 'icon'], `item/${shard}`);
      // 「精简索引副本」不应该带详情字段
      const withDesc = rows.filter((row) => 'desc' in row);
      expect(withDesc.length, `db/item/${shard}.json 不该含 desc（那是 zh/ 下的详情副本）`).toBe(0);
    }
    expect(items).toBe(1606);
  });

  it('物品索引没有 name 字段；敌人索引没有 id 字段（页面必须按此取数）', () => {
    const itemRows = asArray(readJson('db/item/0.json'), 'item/0');
    for (const row of itemRows) {
      expect('name' in row, '物品索引若新增 name，localizedName 仍可用，但需复核这条约定').toBe(false);
      expect(typeof row.names).toBe('object');
    }

    const monsterRows = asArray(readJson('db/monster.json'), 'monster');
    for (const row of monsterRows) {
      expect('id' in row, '敌人索引若新增 id，收藏键仍需用 groupKey').toBe(false);
      expect(typeof row.groupKey).toBe('string');
      expect(typeof row.primaryId).toBe('string');
      expect(Array.isArray(row.variantIds)).toBe(true);
    }
  });

  it('索引里的 icon 文件全部存在（按 icon 字段，不按 id 拼）', () => {
    const files = [
      'db/character.json',
      'db/lightcone.json',
      'db/relicset.json',
      'db/monster.json',
      ...Array.from({ length: 16 }, (_unused, shard) => `db/item/${shard}.json`),
    ];
    let checked = 0;
    const missing: string[] = [];
    for (const file of files) {
      for (const row of asArray(readJson(file), file)) {
        const icon = typeof row.icon === 'string' ? row.icon : '';
        if (icon === '') continue;
        checked += 1;
        if (!existsSync(join(PACK as string, icon))) missing.push(`${file}:${String(row.id)} → ${icon}`);
      }
    }
    expect(checked, '至少应检查 2000 张图标').toBeGreaterThan(2000);
    expect(missing.slice(0, 10), `缺失 ${missing.length} 张：${missing.slice(0, 3).join(', ')}`).toEqual([]);
  });

  it('五个模块抽样 20 条的详情路径真实存在，且内容能对上 id', () => {
    const langs = ['zh', 'en', 'ja', 'ko'];
    const characters = asArray(readJson('db/character.json'), 'character').slice(0, 20);
    const lightcones = asArray(readJson('db/lightcone.json'), 'lightcone').slice(0, 20);
    const relicsets = asArray(readJson('db/relicset.json'), 'relicset').slice(0, 20);
    const monsters = asArray(readJson('db/monster.json'), 'monster').slice(0, 20);
    const items = asArray(readJson('db/item/0.json'), 'item/0').slice(0, 20);

    for (const lang of langs) {
      for (const row of characters) {
        expect(existsSync(join(PACK as string, `db/${lang}/character/${String(row.id)}.json`))).toBe(true);
      }
      for (const row of lightcones) {
        expect(existsSync(join(PACK as string, `db/${lang}/lightcone/${String(row.id)}.json`))).toBe(true);
      }
      for (const row of relicsets) {
        expect(existsSync(join(PACK as string, `db/${lang}/relicset/${String(row.id)}.json`))).toBe(true);
      }
      for (const row of monsters) {
        // DAL.getMonster 会换算到 primaryId，不是 groupKey
        expect(existsSync(join(PACK as string, `db/${lang}/monster/${String(row.primaryId)}.json`))).toBe(true);
      }
      for (const row of items) {
        const shard = Number(row.id) % 16;
        const rel = `db/${lang}/item/${shard}.json`;
        expect(existsSync(join(PACK as string, rel)), rel).toBe(true);
        const records = asArray(readJson(rel), rel);
        expect(records.some((record) => String(record.id) === String(row.id)), `${rel} 缺 id=${String(row.id)}`).toBe(true);
      }
    }
  });

  it('元素/命途图标：包内一律按枚举名小写命名（源站的 thunder 已被重命名）', () => {
    const elements = ['physical', 'fire', 'ice', 'lightning', 'wind', 'quantum', 'imaginary'];
    for (const element of elements) {
      const rel = `img/element/${element}.webp`;
      expect(existsSync(join(PACK as string, rel)), rel).toBe(true);
    }
    // 反向钉死：包里不该出现源站那个 thunder.webp
    expect(existsSync(join(PACK as string, 'img/element/thunder.webp'))).toBe(false);

    const paths = ['warrior', 'rogue', 'mage', 'shaman', 'knight', 'warlock', 'priest', 'elation', 'memory'];
    for (const path of paths) {
      const rel = `img/path/${path}.webp`;
      expect(existsSync(join(PACK as string, rel)), rel).toBe(true);
    }
  });
});
