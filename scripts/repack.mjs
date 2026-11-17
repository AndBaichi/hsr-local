/**
 * 只重新打包 `data/datapack` → `.hsrpack`。
 *
 * `build-datapack.mjs --stage pack` 会把 `datapack-report.json` 覆盖成只有 pack
 * 统计的版本，丢掉 lists/details/images/build/validate 各阶段结果；而 T02b 的
 * `build-extra-modules.mjs` 又是在主构建之后往同一个目录追加文件。所以 CI 的
 * 顺序是：主构建（不 pack）→ extra → 这里直接调 `stagePack`。
 *
 * 用法：node scripts/repack.mjs
 */

import { stagePack } from './lib/pack.mjs';

await stagePack((message) => {
  process.stdout.write(`${message}\n`);
  return Promise.resolve();
});
