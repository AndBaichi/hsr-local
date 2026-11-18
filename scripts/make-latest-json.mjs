/**
 * 生成 Tauri Updater 的 `latest.json`。
 *
 * 输入（命令行参数）：
 *  --installer  <path>  已签名的安装包（Windows 下就是 NSIS .exe）
 *  --signature  <path>  Tauri 生成的 .sig（内容就是签名文本）
 *  --url        <url>   安装包的公开下载地址
 *  --notes      <text>  更新说明（可空）
 *  --out        <path>  输出路径，默认 latest.json
 *
 * 版本自动读 package.json（应用版本，不是数据版本）。
 */

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * 读 `--key value` 参数。
 *
 * @param {string[]} argv
 * @returns {Record<string,string>}
 */
function parseArgs(argv) {
  /** @type {Record<string,string>} */
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith('--')) {
      out[token.slice(2)] = next;
      index += 1;
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.installer === undefined || args.signature === undefined || args.url === undefined) {
  console.error('用法: node scripts/make-latest-json.mjs --installer <exe> --signature <sig> --url <url> [--notes text] [--out latest.json]');
  process.exit(1);
}

const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
const signature = (await readFile(args.signature, 'utf8')).trim();
const manifest = {
  version: pkg.version,
  notes: args.notes ?? `星穹铁道数据库 ${pkg.version}`,
  pub_date: new Date().toISOString(),
  platforms: {
    'windows-x86_64': {
      signature,
      url: args.url,
    },
  },
};

const outPath = args.out ?? join(ROOT, 'latest.json');
await writeFile(outPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`latest.json → ${outPath} (version ${pkg.version})`);
