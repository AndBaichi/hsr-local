/**
 * 图片映射与下载（架构文档 §8.9 `scripts/lib/images.ts`）
 *
 * 路径转换三步（主理人给的硬规则）：
 *  1. 取 basename 去扩展名
 *  2. 按 kind 规范化：item 不区分 ItemIcon / ItemFigures，统一进 `item`；
 *     monster 去掉 `Monster_` 前缀；element / path 转小写
 *  3. 拼 `img/{kind}/{name}.webp`
 *
 * 明确忽略：`item_currency_icon_path`（`itemcurrency/` 实测 404）、`item_avatar_icon_path`（多为空）。
 * 遗器套装图共用 `itemfigures/{基名}.webp`，不新增 relicset kind。
 */

import { readFile } from 'node:fs/promises';

import { join } from 'node:path';

import {
  ASSET_ORIGIN,
  ELEMENT_SLUGS,
  HTTP,
  IMG_DIR,
  IMAGE_FAMILIES,
  CACHE_DIR,
  LANGUAGES,
  PATH_SLUGS,
} from './consts.mjs';
import { createLimiter, fetchToCache, writeFileAtomic } from './http.mjs';

/** 图片缓存命名空间（与 JSON 缓存区分） */
const IMG_CACHE_PREFIX = 'img';

/**
 * 本地属性名 → 源站文件名。
 *
 * 应用侧统一用 `Lightning`（本地文件 `lightning.webp`），但源站叫 `thunder.webp`。
 * 实测：`element/lightning.webp` = 404，`element/thunder.webp` = 200。
 */
const ELEMENT_SOURCE_ALIAS = { lightning: 'thunder' };

/**
 * 取路径的 basename 并去掉扩展名。
 *
 * @param {string} path 源站路径，如 `SpriteOutput/ItemIcon/71000.png`
 * @returns {string} 基名，如 `71000`
 */
export function basenameNoExt(path) {
  if (typeof path !== 'string' || path.length === 0) return '';
  const last = path.split('/').pop() ?? '';
  const dot = last.lastIndexOf('.');
  return dot > 0 ? last.slice(0, dot) : last;
}

/**
 * 把源站图片路径规范化为本地相对路径。
 *
 * @param {'character'|'lightcone'|'monster'|'item'|'element'|'path'} kind 类别
 * @param {string} sourcePath 源站路径或已规范化的名字
 * @returns {string} 本地相对路径，如 `img/item/71000.webp`
 */
export function toLocalImagePath(kind, sourcePath) {
  let name = basenameNoExt(sourcePath);
  if (kind === 'monster') {
    name = name.replace(/^Monster_/i, '');
  }
  if (kind === 'element' || kind === 'path') {
    name = name.toLowerCase();
  }
  return `img/${kind}/${name}.webp`;
}

/**
 * 把本地相对路径反查为源站 URL。
 *
 * @param {string} localPath 形如 `img/item/71000.webp`
 * @returns {string} 完整 URL
 */
export function toSourceUrl(localPath) {
  const [, kind, file] = localPath.split('/');
  const name = file.replace(/\.webp$/, '');
  switch (kind) {
    case 'character':
      return `${ASSET_ORIGIN}avatarshopicon/${name}.webp`;
    case 'lightcone':
      return `${ASSET_ORIGIN}lightconemediumicon/${name}.webp`;
    case 'monster':
      // 敌人图绝大多数是 `Monster_{id}.webp`，但 `BossIconTemporary` 是唯一例外：
      // 实测 `monstermiddleicon/BossIconTemporary.webp` = 200，
      // `monstermiddleicon/Monster_BossIconTemporary.webp` = 404。
      // 8 个特殊敌人组（飞剑 / 反物质引擎 …）共用这张图；之前按统一前缀请求，
      // 被误判成「源站不存在的占位名」而跳过（契约测试 contract.test.ts 抓到的）。
      // 另一个非数字名 `Unknown` 恰恰相反，必须带前缀，别一并去掉。
      return `${ASSET_ORIGIN}monstermiddleicon/${
        name === 'BossIconTemporary' ? name : `Monster_${name}`
      }.webp`;
    case 'item':
      return `${ASSET_ORIGIN}itemfigures/${name}.webp`;
    case 'element':
      return `${ASSET_ORIGIN}element/${ELEMENT_SOURCE_ALIAS[name] ?? name}.webp`;
    case 'path':
      return `${ASSET_ORIGIN}pathicon/${name}.webp`;
    default:
      throw new Error(`未知图片类别: ${kind}`);
  }
}

/**
 * 读取缓存中的 JSON。
 *
 * @param {string} rel 相对缓存路径
 */
async function readCacheJson(rel) {
  const buffer = await readFile(join(CACHE_DIR, rel), 'utf8');
  return JSON.parse(buffer);
}

/**
 * 收集全部需要的图片（本地相对路径去重）。
 *
 * @returns {Promise<Array<{localPath: string, url: string, kind: string, optional: boolean}>>}
 */
export async function collectImageTasks() {
  /** @type {Map<string, {localPath: string, url: string, kind: string, optional: boolean}>} */
  const tasks = new Map();

  const add = (kind, sourcePath, optional = false) => {
    if (typeof sourcePath !== 'string' || sourcePath.length === 0) return;
    const localPath = toLocalImagePath(kind, sourcePath);
    if (tasks.has(localPath)) return;
    tasks.set(localPath, { localPath, url: toSourceUrl(localPath), kind, optional });
  };

  const character = await readCacheJson('character.json');
  for (const id of Object.keys(character)) add('character', id);

  const lightcone = await readCacheJson('lightcone.json');
  for (const id of Object.keys(lightcone)) add('lightcone', id);

  // ⚠️ 敌人图必须用 `icon` 里的 basename，不能用列表 key！
  // 实测 666 条列表项只映射到 222 张不同图片（例如 1002015 的 icon 是 Monster_1002011.png），
  // 用 id 拼 `Monster_{id}.webp` 会有 2/3 的请求 404。
  const monster = await readCacheJson('monster.json');
  // 敌人图设为可选：源站存在 BossIconTemporary 这类占位名（实测 404），
  // 缺失由前端 SafeImage 兜底，且命中 404 会写负缓存、后续续跑不再重复请求
  for (const id of Object.keys(monster)) add('monster', monster[id].icon || id, true);

  // 物品：优先 figure 图，缺失时回退普通图标；两者都取 basename 后去重
  const items = await readCacheJson(`${LANGUAGES[0]}/item_all.json`);
  for (const key of Object.keys(items)) {
    const item = items[key];
    const figure = item.item_figure_icon_path;
    const icon = item.item_icon_path;
    add('item', figure || icon, true);
  }

  // 遗器套装图：共用 itemfigures
  const relicset = await readCacheJson('relicset.json');
  for (const id of Object.keys(relicset)) {
    add('item', relicset[id].icon, true);
  }

  for (const slug of ELEMENT_SLUGS) add('element', slug);
  for (const slug of PATH_SLUGS) add('path', slug);

  return [...tasks.values()];
}

/**
 * 阶段：下载全部图片。
 *
 * @param {(message: string) => Promise<void>} log 日志函数
 */
export async function stageImages(log) {
  await log('=== stage: images ===');

  const tasks = await collectImageTasks();
  const byKind = {};
  for (const task of tasks) {
    byKind[task.kind] = (byKind[task.kind] ?? 0) + 1;
  }
  await log(`  待下载 ${tasks.length} 张：${JSON.stringify(byKind)}（并发 ${HTTP.concurrency}）`);

  const schedule = createLimiter(HTTP.concurrency);
  let done = 0;
  let bytes = 0;
  /** @type {Array<{localPath: string, message: string}>} */
  const missing = [];

  await Promise.all(
    tasks.map((task) =>
      schedule(async () => {
        const cacheRel = `${IMG_CACHE_PREFIX}/${task.localPath.replace(/^img\//, '')}`;
        try {
          const buffer = await fetchToCache(cacheRel, task.url, {
            required: !task.optional,
            // 可选图片（物品/套装）命中 404 是数据侧现实，少重试以加快整体速度
            retries: task.optional ? 1 : HTTP.retries,
          });
          if (buffer) {
            bytes += buffer.byteLength;
          } else {
            // 命中负缓存（上一轮已确认 404）也计入缺失，保证 report 口径一致
            missing.push({ localPath: task.localPath, message: '源站无此文件（404）' });
          }
        } catch (error) {
          // 必需类别是否致命由下方 hardKinds 统一判定，这里只记录
          missing.push({ localPath: task.localPath, message: String(error.message ?? error) });
        } finally {
          done += 1;
          if (done % HTTP.logEvery === 0 || done === tasks.length) {
            await log(`  images ${done}/${tasks.length}（缺失 ${missing.length}）`);
          }
        }
      }),
    ),
  );

  // 必需类别：角色 / 光锥 / 属性 / 命途 —— 任何一张缺失都视为数据源异常
  // 敌人图允许极少量缺失（实测 `BossIconTemporary` 这类占位名在源站不存在），
  // 由前端 `SafeImage` 显示统一占位，不阻断构建。
  const hardKinds = new Set(['character', 'lightcone', 'element', 'path']);
  const hardMissing = missing.filter((entry) => {
    const kind = entry.localPath.split('/')[1];
    return hardKinds.has(kind);
  });
  if (hardMissing.length > 0) {
    throw new Error(
      `必需图片缺失 ${hardMissing.length} 张：${hardMissing
        .slice(0, 10)
        .map((entry) => entry.localPath)
        .join(', ')}`,
    );
  }

  const monsterMissing = missing.filter((entry) => entry.localPath.startsWith('img/monster/'));

  await log(
    `  ✓ 图片就绪 ${tasks.length - missing.length}/${tasks.length}，${(bytes / 1048576).toFixed(1)}MB，` +
      `缺失 ${missing.length}（敌人 ${monsterMissing.length}，其余为源站无对应文件）`,
  );

  return {
    images: {
      total: tasks.length,
      downloaded: tasks.length - missing.length,
      bytes,
      byKind,
      missing: missing.slice(0, 60),
      missingCount: missing.length,
      hardMissingCount: hardMissing.length,
      monsterMissingCount: monsterMissing.length,
      monsterMissing: monsterMissing.map((entry) => entry.localPath),
      expected: Object.fromEntries(IMAGE_FAMILIES.map((f) => [f.key, f.count])),
    },
  };
}

/**
 * 把缓存中的图片复制到产物目录。
 *
 * @param {(message: string) => Promise<void>} log 日志函数
 * @param {Array<{localPath: string}>} available 可用的图片清单
 * @returns {Promise<{copied: number, bytes: number}>}
 */
export async function copyImagesToOutput(log, available) {
  const schedule = createLimiter(16);
  let copied = 0;
  let bytes = 0;

  await Promise.all(
    available.map((entry) =>
      schedule(async () => {
        const cacheRel = `${IMG_CACHE_PREFIX}/${entry.localPath.replace(/^img\//, '')}`;
        const source = join(CACHE_DIR, cacheRel);
        const target = join(IMG_DIR, entry.localPath.replace(/^img\//, ''));
        try {
          const buffer = await readFile(source);
          await writeFileAtomic(target, buffer);
          copied += 1;
          bytes += buffer.byteLength;
        } catch {
          // 缓存缺失时跳过（validate 阶段会统计差异）
        }
      }),
    ),
  );

  await log(`  ✓ 图片写入产物 ${copied} 张，${(bytes / 1048576).toFixed(1)}MB`);
  return { copied, bytes };
}
