/**
 * HTTP 抓取层（架构文档 §8.9 `scripts/lib/http.ts`）
 *
 * 硬要求：
 *  - 必须带常规 UA，否则源站 403
 *  - 404 需重试（源站偶发 404 / 限流，隔 ~1s 重试即 200）
 *  - 并发 8，失败重试 3 次
 *  - 落地先写 `.tmp` 再 rename，已存在则跳过 → 天然支持中断续跑
 */

import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { CACHE_DIR, HTTP, USER_AGENT } from './consts.mjs';

/** 进程内统计 */
export const httpStats = {
  /** 真正发出的请求数（含重试） */
  requests: 0,
  /** 命中本地缓存的文件数 */
  cacheHits: 0,
  /** 下载字节数 */
  bytes: 0,
  /** 重试次数 */
  retries: 0,
  /** 命中"源站确认不存在"标记的文件数 */
  negativeHits: 0,
  /** 最终失败的路径 */
  failures: [],
};

/**
 * 把远端相对路径映射到本地缓存路径。
 *
 * 远端路径形如 `zh/character/1001.json`；图片形如 `img/item/71000.webp`
 * （`img/` 前缀是本地命名空间，映射回 `itemfigures/71000.webp`）。
 *
 * @param {string} relPath 缓存相对路径
 */
export function cachePathFor(relPath) {
  return join(CACHE_DIR, relPath);
}

/**
 * 判断缓存是否已存在。
 *
 * @param {string} relPath 缓存相对路径
 */
export async function isCached(relPath) {
  try {
    const info = await stat(cachePathFor(relPath));
    return info.isFile() && info.size > 0;
  } catch {
    return false;
  }
}

/**
 * 原子写文件（`.tmp` → rename）。
 *
 * @param {string} target 目标绝对路径
 * @param {Buffer|string} data 内容
 */
export async function writeFileAtomic(target, data) {
  await mkdir(dirname(target), { recursive: true });
  const tmp = `${target}.tmp`;
  await writeFile(tmp, data);
  await rename(tmp, target);
}

/**
 * 简易并发闸门。
 *
 * @param {number} concurrency 最大并发
 * @returns {(task: () => Promise<any>) => Promise<any>} 调度函数
 */
export function createLimiter(concurrency) {
  let active = 0;
  /** @type {Array<() => void>} */
  const queue = [];

  const next = () => {
    active -= 1;
    const resume = queue.shift();
    if (resume) resume();
  };

  return async function schedule(task) {
    if (active >= concurrency) {
      await new Promise((resolve) => queue.push(resolve));
    }
    active += 1;
    try {
      return await task();
    } finally {
      next();
    }
  };
}

/**
 * 单次请求（不重试）。
 *
 * @param {string} url 完整 URL
 * @returns {Promise<Buffer>} 响应体
 */
async function requestOnce(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP.timeoutMs);
  httpStats.requests += 1;
  try {
    const response = await fetch(url, {
      headers: {
        'user-agent': USER_AGENT,
        accept: '*/*',
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8,ja;q=0.7,ko;q=0.6',
      },
      signal: controller.signal,
      redirect: 'follow',
    });
    if (!response.ok) {
      const error = new Error(`HTTP ${response.status} ${response.statusText}`);
      error.status = response.status;
      throw error;
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    httpStats.bytes += buffer.byteLength;
    return buffer;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 带重试的请求。
 *
 * @param {string} url 完整 URL
 * @param {number} retries 重试次数
 * @returns {Promise<Buffer>}
 */
async function requestWithRetry(url, retries = HTTP.retries) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await requestOnce(url);
    } catch (error) {
      lastError = error;
      // 4xx（除 429）也重试：源站偶发 404，隔约 1s 重试即可 200
      const delay = HTTP.retryDelayMs * (attempt + 1);
      if (attempt < retries) {
        httpStats.retries += 1;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError ?? new Error(`请求失败：${url}`);
}

/**
 * 下载一个文件到缓存（存在则跳过）。
 *
 * @param {string} relPath 缓存相对路径
 * @param {string} url 完整 URL
 * @param {{required?: boolean}} [options]
 * @returns {Promise<Buffer|null>} 内容；`required:false` 且失败时返回 null
 */
export async function fetchToCache(relPath, url, options = {}) {
  const { required = true, retries = HTTP.retries } = options;
  const target = cachePathFor(relPath);

  if (await isCached(relPath)) {
    httpStats.cacheHits += 1;
    const { readFile } = await import('node:fs/promises');
    return readFile(target);
  }

  // 负缓存：上一轮已确认源站 404 的文件不再重复请求（否则每次续跑都要多等 3 次重试）
  if (!required) {
    try {
      const marker = await stat(`${target}.missing`);
      if (marker.isFile()) {
        httpStats.negativeHits += 1;
        return null;
      }
    } catch {
      /* 没有标记，正常走下载 */
    }
  }

  try {
    const buffer = await requestWithRetry(url, retries);
    await writeFileAtomic(target, buffer);
    return buffer;
  } catch (error) {
    if (!required) {
      if (error.status === 404) await writeFileAtomic(`${target}.missing`, '');
      return null;
    }
    httpStats.failures.push({ relPath, url, message: String(error.message ?? error) });
    throw error;
  }
}

/**
 * 下载并解析 JSON。
 *
 * @param {string} cacheRel 缓存相对路径
 * @param {string} url 完整 URL
 */
export async function fetchJson(cacheRel, url) {
  const buffer = await fetchToCache(cacheRel, url);
  try {
    return JSON.parse(buffer.toString('utf8'));
  } catch (error) {
    throw new Error(`JSON 解析失败 ${cacheRel}: ${error.message}`);
  }
}

/**
 * 读取缓存中的 JSON（不联网；不存在则返回 null）。
 *
 * @param {string} cacheRel 缓存相对路径
 */
export async function readCachedJson(cacheRel) {
  const { readFile } = await import('node:fs/promises');
  try {
    const buffer = await readFile(cachePathFor(cacheRel));
    return JSON.parse(buffer.toString('utf8'));
  } catch {
    return null;
  }
}

/**
 * 清理单个缓存文件（用于重建）。
 *
 * @param {string} relPath 缓存相对路径
 */
export async function dropCache(relPath) {
  await rm(cachePathFor(relPath), { force: true });
}
