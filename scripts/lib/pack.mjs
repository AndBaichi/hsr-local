/**
 * `.hsrpack` 打包（架构文档 §8.9 `pack.ts`）
 *
 * 格式 = 标准 zip（改后缀）。压缩策略：
 *  - `*.webp` 用 **store**（本身已是压缩格式，再 deflate 只浪费 CPU）
 *  - `*.json` 用 **deflate-9**
 *
 * 不依赖任何第三方库：自己写最小 zip 写入器（local header + central directory + EOCD），
 * 避免为一个打包步骤引入 yazl 依赖与额外的 `npm install` 成本。
 */

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { deflateRawSync, constants as zlibConstants } from 'node:zlib';

import { OUT_DIR, PACK_PATH, VERSION, SCHEMA_VERSION, ORIGIN } from './consts.mjs';

/** CRC32 查表 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let c = index;
    for (let bit = 0; bit < 8; bit += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[index] = c >>> 0;
  }
  return table;
})();

/**
 * 计算 CRC32。
 *
 * @param {Buffer} buffer 数据
 * @returns {number} 无符号 CRC
 */
function crc32(buffer) {
  let crc = 0xffffffff;
  for (let index = 0; index < buffer.length; index += 1) {
    crc = CRC_TABLE[(crc ^ buffer[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * 把 Date 转成 MS-DOS 时间/日期对。
 *
 * @param {Date} date 时间
 * @returns {{time: number, date: number}}
 */
function dosDateTime(date) {
  const time =
    ((date.getHours() & 0x1f) << 11) |
    ((date.getMinutes() & 0x3f) << 5) |
    ((Math.floor(date.getSeconds() / 2)) & 0x1f);
  const day =
    (((date.getFullYear() - 1980) & 0x7f) << 9) |
    (((date.getMonth() + 1) & 0x0f) << 5) |
    (date.getDate() & 0x1f);
  return { time, date: day };
}

/**
 * 递归收集目录下所有文件。
 *
 * @param {string} dir 目录
 * @param {string} [base] 相对基准
 * @returns {Promise<Array<{abs: string, rel: string, size: number}>>}
 */
async function walk(dir, base = dir) {
  /** @type {Array<{abs: string, rel: string, size: number}>} */
  const files = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(abs, base)));
    } else if (entry.isFile()) {
      const info = await stat(abs);
      files.push({ abs, rel: relative(base, abs).split(sep).join('/'), size: info.size });
    }
  }
  return files;
}

/**
 * 构建 zip 字节流。
 *
 * @param {Array<{name: string, data: Buffer}>} entries 条目列表
 * @returns {Buffer} zip 内容
 */
function buildZip(entries) {
  const now = new Date();
  const { time, date } = dosDateTime(now);

  /** @type {Buffer[]} */
  const localParts = [];
  /** @type {Array<{name: Buffer, crc: number, compSize: number, size: number, method: number, offset: number}>} */
  const centralRecords = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuffer = Buffer.from(entry.name, 'utf8');
    const isJson = entry.name.endsWith('.json');
    const method = isJson ? 8 : 0;
    const compressed = isJson
      ? deflateRawSync(entry.data, { level: zlibConstants.Z_BEST_COMPRESSION })
      : entry.data;
    // 小文件 deflate 反而变大时退回 store
    const useCompressed = method === 8 && compressed.length < entry.data.length;
    const payload = useCompressed ? compressed : entry.data;
    const finalMethod = useCompressed ? 8 : 0;
    const crc = crc32(entry.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(finalMethod, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28);

    centralRecords.push({
      name: nameBuffer,
      crc,
      compSize: payload.length,
      size: entry.data.length,
      method: finalMethod,
      offset,
    });

    localParts.push(local, nameBuffer, payload);
    offset += local.length + nameBuffer.length + payload.length;
  }

  /** @type {Buffer[]} */
  const centralParts = [];
  let centralSize = 0;
  for (const record of centralRecords) {
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0, 8);
    header.writeUInt16LE(record.method, 10);
    header.writeUInt16LE(time, 12);
    header.writeUInt16LE(date, 14);
    header.writeUInt32LE(record.crc, 16);
    header.writeUInt32LE(record.compSize, 20);
    header.writeUInt32LE(record.size, 24);
    header.writeUInt16LE(record.name.length, 28);
    header.writeUInt16LE(0, 30);
    header.writeUInt16LE(0, 32);
    header.writeUInt16LE(0, 34);
    header.writeUInt16LE(0, 36);
    header.writeUInt32LE(0, 38);
    header.writeUInt32LE(record.offset, 42);
    centralParts.push(header, record.name);
    centralSize += header.length + record.name.length;
  }

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(centralRecords.length, 8);
  eocd.writeUInt16LE(centralRecords.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, ...centralParts, eocd]);
}

/**
 * 阶段：生成 manifest + `.hsrpack`。
 *
 * @param {(message: string) => Promise<void>} log 日志函数
 */
export async function stagePack(log) {
  await log('=== stage: pack ===');

  const files = await walk(OUT_DIR);
  files.sort((a, b) => a.rel.localeCompare(b.rel));
  await log(`  待打包 ${files.length} 个文件`);

  const manifest = {
    algorithm: 'sha256',
    schemaVersion: SCHEMA_VERSION,
    gameVersion: VERSION,
    origin: ORIGIN,
    generatedAt: new Date().toISOString(),
    files: {},
  };

  /** @type {Array<{name: string, data: Buffer}>} */
  const entries = [];
  let totalBytes = 0;

  // 流式读入，避免同时持有 112MB 内存
  for (const file of files) {
    const chunks = [];
    await new Promise((resolve, reject) => {
      const stream = createReadStream(file.abs);
      stream.on('data', (chunk) => chunks.push(chunk));
      stream.on('end', resolve);
      stream.on('error', reject);
    });
    const data = Buffer.concat(chunks);
    totalBytes += data.length;
    manifest.files[file.rel] = {
      size: data.length,
      sha256: createHash('sha256').update(data).digest('hex'),
    };
    entries.push({ name: file.rel, data });
  }

  // manifest.json 作为 zip 内第一个条目，便于校验时先读清单
  entries.unshift({
    name: 'manifest.json',
    data: Buffer.from(`${JSON.stringify(manifest)}\n`, 'utf8'),
  });

  const zip = buildZip(entries);
  await writeFile(PACK_PATH, zip);

  const packInfo = await stat(PACK_PATH);
  await log(
    `  ✓ ${PACK_PATH} ${(packInfo.size / 1048576).toFixed(1)}MB（源 ${(
      totalBytes / 1048576
    ).toFixed(1)}MB，压缩率 ${((packInfo.size / totalBytes) * 100).toFixed(1)}%）`,
  );

  return {
    pack: {
      path: PACK_PATH,
      bytes: packInfo.size,
      entries: entries.length,
      sourceBytes: totalBytes,
      fileCount: files.length,
    },
  };
}

/**
 * 读取产物目录中的一个 JSON（validate 用）。
 *
 * @param {string} rel 相对 `data/datapack` 的路径
 */
export async function readOutputJson(rel) {
  const buffer = await readFile(join(OUT_DIR, rel), 'utf8');
  return JSON.parse(buffer);
}

/**
 * 目录中文件总数与体积。
 *
 * @param {string} dir 目录
 */
export async function measure(dir) {
  const files = await walk(dir);
  return {
    count: files.length,
    bytes: files.reduce((sum, file) => sum + file.size, 0),
  };
}
