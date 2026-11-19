/**
 * 产物生成（架构文档 §8.9 `index-build.ts` + `pack` 前置步骤）
 *
 * 把缓存里的源站 JSON 规范化后写入 `data/datapack/`：
 *
 *   db/character.json            101 条 brief（含四语言名 + 筛选字段）
 *   db/lightcone.json            174 条
 *   db/relicset.json             64 条（kind: cavern|planar）
 *   db/monster.json              382 组（组内含变体 id）
 *   db/item/{0..15}.json         1606 条 brief，按 Number(id)%16 分片
 *   db/achievement.json          9 系列索引（计数）
 *   db/{lang}/character/{id}.json   4×101
 *   db/{lang}/lightcone/{id}.json   4×174
 *   db/{lang}/relicset/{id}.json    4×64
 *   db/{lang}/monster/{id}.json     4×666
 *   db/{lang}/item/{0..15}.json     4×16 分片（含描述/获取途径）
 *   db/{lang}/achievement.json      4 份（含条目详情）
 *   meta.json                    版本/计数/布局说明
 */

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  BASELINE_VERSION,
  CACHE_DIR,
  DB_DIR,
  DEFAULT_LANGUAGE,
  EXPECTED,
  ITEM_SHARDS,
  LANGUAGES,
  META_PATH,
  OUT_DIR,
  SCHEMA_VERSION,
  VERSION,
  ORIGIN,
} from './consts.mjs';
import { createLimiter, writeFileAtomic } from './http.mjs';
import {
  normalizeAchievement,
  normalizeCharacterBrief,
  normalizeCharacterDetail,
  normalizeItemBrief,
  normalizeItemDetail,
  normalizeLightconeBrief,
  normalizeLightconeDetail,
  normalizeMonsterDetail,
  normalizeMonsterIndex,
  normalizeRelicsetBrief,
  normalizeRelicsetDetail,
} from './normalize.mjs';
import { copyImagesToOutput, collectImageTasks } from './images.mjs';
import { RichtextWarnings } from './richtext.mjs';

/** 富文本残留检测：标签与宏 */
const RESIDUAL_TAG = /<\/?[a-zA-Z][^>]*>/;
const RESIDUAL_MACRO = /\{[A-Za-z_][A-Za-z0-9_]*#?/;

/**
 * 读取缓存 JSON。
 *
 * @param {string} rel 缓存相对路径
 */
async function readCache(rel) {
  const buffer = await readFile(join(CACHE_DIR, rel), 'utf8');
  return JSON.parse(buffer);
}

/**
 * 写 JSON（紧凑格式，减小体积）。
 *
 * @param {string} path 绝对路径
 * @param {unknown} value 内容
 * @returns {Promise<number>} 写入字节数
 */
async function writeJson(path, value) {
  const text = JSON.stringify(value);
  await writeFileAtomic(path, text);
  return Buffer.byteLength(text);
}

/**
 * 统计目录下所有文件的字节数与数量。
 *
 * @param {string} dir 目录
 * @returns {Promise<{count: number, bytes: number}>}
 */
async function measureDir(dir) {
  let count = 0;
  let bytes = 0;
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        const info = await readFile(full);
        count += 1;
        bytes += info.byteLength;
      }
    }
  }
  return { count, bytes };
}

/**
 * 阶段：生成 db 产物 + meta.json。
 *
 * @param {(message: string) => Promise<void>} log 日志函数
 */
export async function stageBuild(log) {
  await log('=== stage: build ===');
  const warnings = new RichtextWarnings();
  const stats = {
    residualTag: 0,
    residualMacro: 0,
    droppedComefrom: 0,
    droppedComefromByLang: {},
    droppedAchievement: 0,
    files: {},
  };

  /** 递归检查残留（只检查字符串值，避免误伤 key） */
  const checkResidual = (value, fileLabel) => {
    const visit = (node) => {
      if (typeof node === 'string') {
        if (RESIDUAL_TAG.test(node)) {
          stats.residualTag += 1;
          warnings.add('residualTag', `${fileLabel}: ${node.slice(0, 120)}`);
        }
        if (RESIDUAL_MACRO.test(node)) {
          stats.residualMacro += 1;
          warnings.add('residualMacro', `${fileLabel}: ${node.slice(0, 120)}`);
        }
        return;
      }
      if (Array.isArray(node)) {
        for (const child of node) visit(child);
        return;
      }
      if (node && typeof node === 'object') {
        for (const child of Object.values(node)) visit(child);
      }
    };
    visit(value);
  };

  await mkdir(DB_DIR, { recursive: true });

  /* ---------------- 列表 ---------------- */
  const characterList = await readCache('character.json');
  const lightconeList = await readCache('lightcone.json');
  const relicsetList = await readCache('relicset.json');
  const monsterList = await readCache('monster.json');
  const itemLists = {};
  const achievementLists = {};
  for (const lang of LANGUAGES) {
    itemLists[lang] = await readCache(`${lang}/item_all.json`);
    achievementLists[lang] = await readCache(`${lang}/achievement/achievement.json`);
  }

  const charIds = Object.keys(characterList).sort((a, b) => a.localeCompare(b));
  const lcIds = Object.keys(lightconeList).sort((a, b) => a.localeCompare(b));
  const rsIds = Object.keys(relicsetList).sort((a, b) => a.localeCompare(b));
  const itemIds = Object.keys(itemLists[DEFAULT_LANGUAGE]).sort((a, b) => Number(a) - Number(b));

  /* ---------------- 角色 / 光锥 / 遗器 索引 ---------------- */
  const zhCtx = { lang: DEFAULT_LANGUAGE, warnings };

  const characterBriefs = charIds.map((id) =>
    normalizeCharacterBrief(id, characterList[id], zhCtx),
  );
  stats.files['db/character.json'] = await writeJson(join(DB_DIR, 'character.json'), characterBriefs);

  const lightconeBriefs = lcIds.map((id) => normalizeLightconeBrief(id, lightconeList[id], zhCtx));
  stats.files['db/lightcone.json'] = await writeJson(join(DB_DIR, 'lightcone.json'), lightconeBriefs);

  // 遗器 brief 需要详情里的部位数来判定 cavern/planar
  const relicsetDetailsZh = {};
  for (const id of rsIds) {
    try {
      relicsetDetailsZh[id] = await readCache(`${DEFAULT_LANGUAGE}/relicset/${id}.json`);
    } catch {
      relicsetDetailsZh[id] = null;
    }
  }
  const relicsetBriefs = rsIds.map((id) =>
    normalizeRelicsetBrief(id, relicsetList[id], relicsetDetailsZh[id], zhCtx),
  );
  stats.files['db/relicset.json'] = await writeJson(join(DB_DIR, 'relicset.json'), relicsetBriefs);

  /* ---------------- 敌人索引（382 组） ---------------- */
  const monsterIndex = normalizeMonsterIndex(monsterList, zhCtx);
  stats.files['db/monster.json'] = await writeJson(join(DB_DIR, 'monster.json'), monsterIndex.groups);

  /* ---------------- 物品索引（16 分片） ---------------- */
  const itemBriefs = itemIds.map((id) => {
    const byLang = {};
    for (const lang of LANGUAGES) byLang[lang] = itemLists[lang][id];
    return normalizeItemBrief(id, byLang, zhCtx);
  });

  const shards = Array.from({ length: ITEM_SHARDS }, () => []);
  for (const brief of itemBriefs) {
    shards[Number(brief.id) % ITEM_SHARDS].push(brief);
  }
  await mkdir(join(DB_DIR, 'item'), { recursive: true });
  let itemShardBytes = 0;
  for (let index = 0; index < ITEM_SHARDS; index += 1) {
    itemShardBytes += await writeJson(join(DB_DIR, 'item', `${index}.json`), shards[index]);
  }
  stats.files['db/item/*.json'] = itemShardBytes;

  /* ---------------- 成就索引 ---------------- */
  const achZh = normalizeAchievement(achievementLists[DEFAULT_LANGUAGE], zhCtx);
  const achIndex = achZh.series.map((series) => ({
    id: series.id,
    name: series.name,
    priority: series.priority,
    itemCount: series.itemCount,
    hiddenCount: series.hiddenCount,
    hiddenDescCount: series.hiddenDescCount,
  }));
  stats.files['db/achievement.json'] = await writeJson(join(DB_DIR, 'achievement.json'), achIndex);

  /* ---------------- 详情（按语言） ---------------- */
  const schedule = createLimiter(16);

  const detailJobs = [];
  for (const lang of LANGUAGES) {
    const ctx = { lang, warnings };

    for (const id of charIds) {
      detailJobs.push(async () => {
        const raw = await readCache(`${lang}/character/${id}.json`);
        const detail = normalizeCharacterDetail(id, raw, ctx);
        checkResidual(detail, `${lang}/character/${id}`);
        await writeJson(join(DB_DIR, lang, 'character', `${id}.json`), detail);
      });
    }

    for (const id of lcIds) {
      detailJobs.push(async () => {
        const raw = await readCache(`${lang}/lightcone/${id}.json`);
        const detail = normalizeLightconeDetail(id, raw, ctx);
        checkResidual(detail, `${lang}/lightcone/${id}`);
        await writeJson(join(DB_DIR, lang, 'lightcone', `${id}.json`), detail);
      });
    }

    for (const id of rsIds) {
      detailJobs.push(async () => {
        const raw = await readCache(`${lang}/relicset/${id}.json`);
        const detail = normalizeRelicsetDetail(id, raw, ctx);
        checkResidual(detail, `${lang}/relicset/${id}`);
        await writeJson(join(DB_DIR, lang, 'relicset', `${id}.json`), detail);
      });
    }

    for (const id of Object.keys(monsterList)) {
      detailJobs.push(async () => {
        const raw = await readCache(`${lang}/monster/${id}.json`);
        const detail = normalizeMonsterDetail(id, raw, ctx);
        checkResidual(detail, `${lang}/monster/${id}`);
        await writeJson(join(DB_DIR, lang, 'monster', `${id}.json`), detail);
      });
    }
  }

  let detailDone = 0;
  const totalDetailJobs = detailJobs.length;
  await Promise.all(
    detailJobs.map((job) =>
      schedule(async () => {
        await job();
        detailDone += 1;
        if (detailDone % 400 === 0 || detailDone === totalDetailJobs) {
          await log(`  detail ${detailDone}/${totalDetailJobs}`);
        }
      }),
    ),
  );

  // 物品详情（按语言 × 16 分片）
  for (const lang of LANGUAGES) {
    const ctx = { lang, warnings };
    let droppedThisLang = 0;
    const langShards = Array.from({ length: ITEM_SHARDS }, () => []);
    for (const id of itemIds) {
      const { detail, droppedComefrom } = normalizeItemDetail(id, itemLists[lang][id], ctx);
      stats.droppedComefrom += droppedComefrom;
      droppedThisLang += droppedComefrom;
      checkResidual(detail, `${lang}/item/${id}`);
      langShards[Number(id) % ITEM_SHARDS].push(detail);
    }
    stats.droppedComefromByLang[lang] = droppedThisLang;
    let bytes = 0;
    for (let index = 0; index < ITEM_SHARDS; index += 1) {
      bytes += await writeJson(join(DB_DIR, lang, 'item', `${index}.json`), langShards[index]);
    }
    stats.files[`db/${lang}/item/*.json`] = bytes;
  }

  // 成就详情（按语言）
  for (const lang of LANGUAGES) {
    const ctx = { lang, warnings };
    const result = normalizeAchievement(achievementLists[lang], ctx);
    stats.droppedAchievement += result.droppedTextId;
    checkResidual(result.series, `${lang}/achievement`);
    stats.files[`db/${lang}/achievement.json`] = await writeJson(
      join(DB_DIR, lang, 'achievement.json'),
      result.series,
    );
  }

  /* ---------------- 图片 ---------------- */
  const imageTasks = await collectImageTasks();
  const available = [];
  for (const task of imageTasks) {
    const cacheRel = join(CACHE_DIR, 'img', task.localPath.replace(/^img\//, ''));
    try {
      await readFile(cacheRel);
      available.push(task);
    } catch {
      // 缺失的图片不写入产物
    }
  }
  const imageCopy = await copyImagesToOutput(log, available);

  /* ---------------- 校验计数 ---------------- */
  const counts = {
    character: characterBriefs.length,
    lightcone: lightconeBriefs.length,
    relicset: relicsetBriefs.length,
    monster: Object.keys(monsterList).length,
    monsterGroups: monsterIndex.groupCount,
    item: itemBriefs.length,
    achievement: achZh.itemCount,
    achievementSeries: achIndex.length,
    image: imageCopy.copied,
  };

  const countChecks = {};
  for (const [key, expected] of Object.entries(EXPECTED)) {
    if (key === 'droppedTextIdEntries') continue;
    const baseline = VERSION === BASELINE_VERSION;
    countChecks[key] = {
      actual: counts[key] ?? null,
      expected: baseline ? expected : 'new-version',
      ok: !baseline || counts[key] === expected,
    };
  }

  /* ---------------- meta.json ---------------- */
  const measured = await measureDir(OUT_DIR);
  const meta = {
    schemaVersion: SCHEMA_VERSION,
    packId: `hsr-${VERSION}-local`,
    gameVersion: VERSION,
    builtAt: new Date().toISOString(),
    source: {
      origin: ORIGIN,
      notice: '数据来源于第三方社区数据库 nanoka.cc，仅用于本地离线浏览',
    },
    languages: LANGUAGES,
    defaultLanguage: DEFAULT_LANGUAGE,
    counts,
    layout: {
      index: {
        character: 'db/character.json',
        lightcone: 'db/lightcone.json',
        relicset: 'db/relicset.json',
        monster: 'db/monster.json',
        item: 'db/item/{0..15}.json（按 Number(id)%16 分片）',
        achievement: 'db/achievement.json',
      },
      detail: {
        character: 'db/{lang}/character/{id}.json',
        lightcone: 'db/{lang}/lightcone/{id}.json',
        relicset: 'db/{lang}/relicset/{id}.json',
        monster: 'db/{lang}/monster/{id}.json',
        item: 'db/{lang}/item/{0..15}.json',
        achievement: 'db/{lang}/achievement.json',
      },
      image: 'img/{character|lightcone|monster|item|element|path}/{name}.webp',
      itemShardCount: ITEM_SHARDS,
    },
    richtext: {
      nodeKinds: ['text(v,+b/i/u/s/c)', 'ruby(v,ruby)', 'param(p,f,s)'],
      paramPlaceholder: '技能/叠影描述里保留 {p,f} 占位，运行时按当前等级 paramList 取值',
    },
    files: { count: measured.count, bytes: measured.bytes },
  };
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(META_PATH, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');

  await log(
    `  ✓ db 产物完成：${measured.count} 个文件 / ${(measured.bytes / 1048576).toFixed(1)}MB`,
  );
  await log(`  计数：${JSON.stringify(counts)}`);

  return {
    build: {
      counts,
      countChecks,
      files: stats.files,
      residualTag: stats.residualTag,
      residualMacro: stats.residualMacro,
      droppedComefrom: stats.droppedComefrom,
      droppedComefromByLang: stats.droppedComefromByLang,
      droppedAchievement: stats.droppedAchievement,
      warnings: warnings.summary(),
      outputFiles: measured.count,
      outputBytes: measured.bytes,
      meta,
    },
  };
}
