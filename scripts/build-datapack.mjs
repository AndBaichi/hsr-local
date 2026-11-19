#!/usr/bin/env node
/**
 * 数据管线 CLI（架构文档 §8.9 `scripts/build-datapack.ts`）
 *
 * 用法：
 *   node scripts/build-datapack.mjs                    # 全量：lists → details → images → build → pack → validate
 *   node scripts/build-datapack.mjs --stage lists      # 只跑 12 个聚合文件（<1 分钟，用于校验路径）
 *   node scripts/build-datapack.mjs --stage details,images
 *   node scripts/build-datapack.mjs --clean            # 丢弃本地缓存后重跑
 *
 * 所有阶段都按「缓存已存在则跳过」工作，随时 Ctrl+C 后重跑即可续传。
 */

import { appendFile, mkdir } from 'node:fs/promises';

import {
  CACHE_DIR,
  BASELINE_VERSION,
  EXPECTED,
  LANGUAGES,
  LIST_FILES,
  LOG_PATH,
  ORIGIN,
  OUT_DIR,
  REPORT_PATH,
  VERSION,
} from './lib/consts.mjs';
import { fetchToCache, httpStats, readCachedJson } from './lib/http.mjs';

/** 解析命令行参数 */
function parseArgs(argv) {
  /** @type {Record<string, string|null>} */
  const args = { stage: 'all' };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const name = token.slice(2);
    const nextToken = argv[i + 1];
    if (nextToken && !nextToken.startsWith('--')) {
      args[name] = nextToken;
      i += 1;
    } else {
      args[name] = null;
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const stages = new Set(String(args.stage ?? 'all').split(',').map((s) => s.trim()));

/**
 * 判断某阶段是否要执行。
 *
 * @param {string} name 阶段名
 */
function want(name) {
  return stages.has('all') || stages.has(name);
}

/** 追加一行构建日志（供外部监控） */
async function log(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  process.stdout.write(line);
  try {
    await appendFile(LOG_PATH, line, 'utf8');
  } catch {
    // 日志失败不阻断构建
  }
}

/** 阶段 1：12 个聚合文件 */
async function stageLists() {
  await log('=== stage: lists ===');
  const result = new Map();

  for (const file of LIST_FILES) {
    const buffer = await fetchToCache(file.path, `${ORIGIN}${file.path}`);
    const actualBytes = buffer.byteLength;
    // 4.7.51 之后上游文件会正常变化；新版本只做结构校验，不再拿基线字节卡死。
    const ok = actualBytes === file.bytes || VERSION !== BASELINE_VERSION;
    result.set(file.key, { key: file.key, path: file.path, bytes: actualBytes, expectedBytes: file.bytes, ok });
    if (!ok) {
      await log(`  ✗ ${file.path} 字节数不符：实际 ${actualBytes}，期望 ${file.bytes}`);
    } else {
      await log(`  ✓ ${file.path} ${actualBytes} bytes`);
    }
  }

  const mismatched = [...result.values()].filter((entry) => !entry.ok);
  if (mismatched.length > 0) {
    throw new Error(`聚合文件字节数校验失败：${mismatched.map((e) => e.path).join(', ')}`);
  }
  return { lists: [...result.values()] };
}

/**
 * 统计数组/对象的条目数，便于校验结构。
 *
 * @param {unknown} value 解析后的 JSON
 */
function countEntries(value) {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === 'object') return Object.keys(value).length;
  return -1;
}

/**
 * 读取既有的 datapack-report.json（用于单独跑 validate 时继承前序统计）。
 *
 * @returns {Promise<Record<string, any>|null>} 报告内容；不存在或损坏时返回 null
 */
async function readPreviousReport() {
  const { readFile } = await import('node:fs/promises');
  try {
    const parsed = JSON.parse(await readFile(REPORT_PATH, 'utf8'));
    const out = {};
    // http 一并继承：单纯跑 validate 时没有网络请求，避免把上一轮的真实下载统计覆盖成 0
    for (const key of ['lists', 'details', 'images', 'build', 'pack', 'http']) {
      if (parsed[key] !== undefined) out[key] = parsed[key];
    }
    return Object.keys(out).length > 0 ? out : null;
  } catch {
    return null;
  }
}

/** 阶段：检查（打印各列表文件的结构与计数，不产生产物） */
async function stageInspect() {
  await log('=== stage: inspect ===');
  for (const file of LIST_FILES) {
    const data = await readCachedJson(file.path);
    if (data === null) {
      await log(`  ! ${file.path} 不在缓存中，先跑 --stage lists`);
      continue;
    }
    const entries = countEntries(data);
    const firstEntry = Array.isArray(data) ? data[0] : Object.values(data)[0];
    const keys =
      firstEntry && typeof firstEntry === 'object' && !Array.isArray(firstEntry)
        ? Object.keys(firstEntry)
        : [];
    await log(`  · ${file.path}: ${Array.isArray(data) ? 'array' : typeof data} entries=${entries}`);
    if (keys.length > 0) {
      await log(`    keys(${keys.length}): ${keys.join(', ')}`);
    }
  }
}

/** 主流程 */
async function main() {
  const startedAt = Date.now();
  await mkdir(CACHE_DIR, { recursive: true });
  await mkdir(OUT_DIR, { recursive: true });

  await log(`build-datapack start: version=${VERSION} stage=${[...stages].join(',')}`);

  const collected = {};

  // 单独跑 --stage validate 时，从既有 report 继承前序阶段的结果，
  // 否则断言只能拿到 undefined（validate 依赖 build/lists/details/images 的统计）
  if (
    want('validate') &&
    !want('lists') &&
    !want('details') &&
    !want('images') &&
    !want('build') &&
    !want('pack')
  ) {
    const previous = await readPreviousReport();
    if (previous) {
      Object.assign(collected, previous);
      await log('  从既有 datapack-report.json 继承前序阶段统计');
    } else {
      await log('  ! 没有可继承的 datapack-report.json，先跑 --stage all');
    }
  }

  if (want('lists')) {
    Object.assign(collected, await stageLists());
  }

  if (want('inspect') || stages.has('all')) {
    await stageInspect();
  }

  if (want('details')) {
    const { stageDetails } = await import('./lib/details.mjs');
    Object.assign(collected, await stageDetails(log));
  }

  if (want('images')) {
    const { stageImages } = await import('./lib/images.mjs');
    Object.assign(collected, await stageImages(log));
  }

  if (want('build')) {
    const { stageBuild } = await import('./lib/build-db.mjs');
    Object.assign(collected, await stageBuild(log));
  }

  if (want('pack')) {
    const { stagePack } = await import('./lib/pack.mjs');
    Object.assign(collected, await stagePack(log));
  }

  if (want('validate')) {
    const { stageValidate } = await import('./lib/validate.mjs');
    Object.assign(collected, await stageValidate(log, collected));
  }

  const elapsedMs = Date.now() - startedAt;
  await log(
    `build-datapack done in ${(elapsedMs / 1000).toFixed(1)}s, requests=${httpStats.requests}, ` +
      `cacheHits=${httpStats.cacheHits}, negativeHits=${httpStats.negativeHits}, downloaded=${(httpStats.bytes / 1048576).toFixed(1)}MB, ` +
      `retries=${httpStats.retries}, failures=${httpStats.failures.length}`,
  );

  if (httpStats.failures.length > 0) {
    await log(`失败清单（前 20 条）：`);
    for (const failure of httpStats.failures.slice(0, 20)) {
      await log(`  - ${failure.relPath}: ${failure.message}`);
    }
  }

  // 只在最后阶段产出 report；中间阶段也写一份，便于随时查看进度
  const report = {
    version: VERSION,
    builtAt: new Date().toISOString(),
    elapsedMs,
    expected: EXPECTED,
    languages: LANGUAGES,
    http: {
      requests: httpStats.requests,
      cacheHits: httpStats.cacheHits,
      negativeHits: httpStats.negativeHits,
      downloadedBytes: httpStats.bytes,
      retries: httpStats.retries,
      failures: httpStats.failures,
    },
    ...collected,
  };
  const { writeFile } = await import('node:fs/promises');
  await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await log(`report → ${REPORT_PATH}`);
}

main().catch(async (error) => {
  await log(`BUILD FAILED: ${error?.stack ?? error}`);
  process.exitCode = 1;
});
