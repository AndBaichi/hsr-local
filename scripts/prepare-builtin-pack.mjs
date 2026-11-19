/**
 * 把当前版本的数据包复制成安装包内置资源。
 *
 * Tauri 的 `bundle.resources` 不能写变量，所以统一用固定文件名
 * `hsr-local-builtin.hsrpack`；同时把包 id 写给 `build.rs`，
 * 让 Rust 侧的 `BUILTIN_PACK_ID` 跟随实际版本，而不是硬编码 4.7.51。
 *
 * 用法：
 *   HSR_VERSION=4.7.52 node scripts/prepare-builtin-pack.mjs
 *   npm run tauri:build   # 已自动串上本脚本
 */

import { copyFile, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { VERSION } from './lib/consts.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(ROOT, `hsr-local-${VERSION}.hsrpack`);
const target = join(ROOT, 'hsr-local-builtin.hsrpack');
const idFile = join(ROOT, 'src-tauri', 'builtin-pack-id.txt');

try {
  await stat(source);
} catch {
  console.error(`找不到数据包：${source}`);
  console.error('请先运行 npm run datapack:full');
  process.exit(1);
}

const meta = JSON.parse(await readFile(join(ROOT, 'data', 'datapack', 'meta.json'), 'utf8'));
if (meta.gameVersion !== VERSION) {
  console.error(`meta.gameVersion=${meta.gameVersion} 与 VERSION=${VERSION} 不一致`);
  process.exit(1);
}
if (typeof meta.packId !== 'string' || meta.packId === '') {
  console.error('meta.packId 缺失');
  process.exit(1);
}

await copyFile(source, target);
await writeFile(idFile, `${meta.packId}\n`, 'utf8');
const info = await stat(target);
console.log(
  `内置数据包：${meta.packId} / ${meta.gameVersion} / ${info.size} B → ${target}`,
);
