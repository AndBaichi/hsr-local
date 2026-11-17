/**
 * 详情文件抓取（架构文档 §8.9 `scripts/lib/details.ts`）
 *
 * 1005 个实体 × 4 语言 = 4020 个文件。源站按语言分开存放，
 * 逐个落地到 `.cache/fetch/{lang}/{kind}/{id}.json`。
 *
 * 注意：T02 的产物按语言分目录输出（`db/{lang}/{kind}/{id}.json`），
 * 不做四语言合并且运行时切语言需要重新请求——这是主理人定的产物形态，
 * 与架构文档 §3.2「四语言合并」不同，以主理人指令为准。
 */

import { LIST_FILES, LANGUAGES, ORIGIN } from './consts.mjs';
import { createLimiter, fetchToCache, readCachedJson } from './http.mjs';
import { HTTP } from './consts.mjs';

/** 详情文件族 → 对应列表文件 key */
const FAMILY_LIST_KEY = {
  character: 'character',
  lightcone: 'lightcone',
  relicset: 'relicset',
  monster: 'monster',
};

/** 期望文件数（每语言） */
const EXPECTED_PER_LANG = {
  character: 101,
  lightcone: 174,
  relicset: 64,
  monster: 666,
};

/**
 * 从缓存中的列表文件取出全部实体 id。
 *
 * @param {string} listKey LIST_FILES 里的 key
 * @returns {Promise<string[]>} id 字符串数组（升序）
 */
async function idsForList(listKey) {
  const file = LIST_FILES.find((entry) => entry.key === listKey);
  if (!file) throw new Error(`未知列表文件 key: ${listKey}`);
  const data = await readCachedJson(file.path);
  if (!data) {
    throw new Error(`列表文件不在缓存中：${file.path}，请先跑 --stage lists`);
  }
  return Object.keys(data).sort((a, b) => a.localeCompare(b));
}

/**
 * 阶段：下载全部详情文件。
 *
 * @param {(message: string) => Promise<void>} log 日志函数
 */
export async function stageDetails(log) {
  await log('=== stage: details ===');

  /** @type {Array<{relPath: string, url: string, family: string, lang: string}>} */
  const tasks = [];

  for (const [family, listKey] of Object.entries(FAMILY_LIST_KEY)) {
    const ids = await idsForList(listKey);
    const expected = EXPECTED_PER_LANG[family];
    if (ids.length !== expected) {
      throw new Error(`列表 ${listKey} 实体数 ${ids.length} ≠ 期望 ${expected}`);
    }
    for (const lang of LANGUAGES) {
      for (const id of ids) {
        const relPath = `${lang}/${family}/${id}.json`;
        tasks.push({ relPath, url: `${ORIGIN}${relPath}`, family, lang });
      }
    }
    await log(`  ${family}: ${ids.length} 实体 × ${LANGUAGES.length} 语言 = ${ids.length * LANGUAGES.length} 个文件`);
  }

  await log(`  待处理 ${tasks.length} 个详情文件（并发 ${HTTP.concurrency}）`);

  const schedule = createLimiter(HTTP.concurrency);
  let done = 0;
  let bytes = 0;
  const failures = [];

  await Promise.all(
    tasks.map((task) =>
      schedule(async () => {
        try {
          const buffer = await fetchToCache(task.relPath, task.url);
          bytes += buffer.byteLength;
        } catch (error) {
          failures.push({ ...task, message: String(error.message ?? error) });
        } finally {
          done += 1;
          if (done % HTTP.logEvery === 0 || done === tasks.length) {
            await log(`  details ${done}/${tasks.length}（失败 ${failures.length}）`);
          }
        }
      }),
    ),
  );

  if (failures.length > 0) {
    const sample = failures
      .slice(0, 10)
      .map((failure) => `${failure.relPath}: ${failure.message}`)
      .join('\n    ');
    throw new Error(`详情抓取失败 ${failures.length} 个：\n    ${sample}`);
  }

  const counts = {};
  for (const family of Object.keys(FAMILY_LIST_KEY)) {
    counts[family] = EXPECTED_PER_LANG[family] * LANGUAGES.length;
  }

  await log(`  ✓ 详情全部就绪，共 ${tasks.length} 个文件，${(bytes / 1048576).toFixed(1)}MB`);

  return { details: { total: tasks.length, bytes, counts, failures } };
}
