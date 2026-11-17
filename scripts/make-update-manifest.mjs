/**
 * 生成 `update.json`（应用内更新检查读的就是它）。
 *
 * 输入：
 *  - `hsr-local-{VERSION}.hsrpack`（由 `npm run datapack:full` 产出）
 *  - `package.json` 的 `version`（作为 `minAppVersion`）
 *  - 环境变量 `GITHUB_REPOSITORY`（Actions 自带）与 `HSR_VERSION`
 *
 * 输出：
 *  - 仓库根目录的 `update.json`（不提交，CI 只把它挂到 Release 资产上）
 *
 * 字段口径：
 *  - `upstreamVersion`：nanoka 的游戏数据版本（4.7.51）
 *  - `packVersion`：本应用自己的包版本（`4.7.51-local.1`，同版本重打包时用 `PACK_REVISION` 递增）
 *  - `minAppVersion`：低于它的客户端不要装这个包（scheme 不兼容时用来强制升级程序）
 *  - `url`：Release 资产直链，客户端下载用
 */

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PACK_PATH, VERSION } from './lib/consts.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * 读 zip 的 EOCD（中央目录结束记录），拿条目数。
 *
 * 只读文件尾部，用来给客户端一个「包是否完整」的廉价指纹；读不到就返回 null，
 * 不为一个可选字段引入 zip 依赖。
 *
 * @param {Buffer} buffer
 * @returns {number|null}
 */
function zipEntryCount(buffer) {
  const min = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= min; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      return buffer.readUInt16LE(offset + 10);
    }
  }
  return null;
}

const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
const pack = await readFile(PACK_PATH);
const repository = process.env.GITHUB_REPOSITORY ?? 'AndBaichi/hsr-local';
const revision = (process.env.PACK_REVISION ?? '1').trim();
const tag = `datapack-${VERSION}`;
const assetName = `hsr-local-${VERSION}.hsrpack`;

const manifest = {
  schemaVersion: 1,
  channel: (process.env.CHANNEL ?? 'stable').trim(),
  packVersion: `${VERSION}-local.${revision}`,
  upstreamVersion: VERSION,
  gameVersion: VERSION,
  minAppVersion: pkg.version,
  archiveBytes: pack.length,
  entryCount: zipEntryCount(pack),
  sha256: createHash('sha256').update(pack).digest('hex'),
  url:
    process.env.PACK_URL?.trim() ??
    `https://github.com/${repository}/releases/download/${tag}/${assetName}`,
  releasedAt: new Date().toISOString(),
  notes:
    process.env.RELEASE_NOTES?.trim() ??
    `星穹铁道数据库数据包 ${VERSION}（自动构建；数据来源 nanoka.cc）`,
};

const outPath = join(ROOT, 'update.json');
await writeFile(outPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`update.json → ${outPath}`);
console.log(JSON.stringify(manifest, null, 2));
