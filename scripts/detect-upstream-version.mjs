/**
 * 探测 nanoka 上游当前数据版本。
 *
 * 为什么用 `/peak`：它是 SvelteKit SSR 页面里体积最小的一个（约 8 KB），
 * 且 SSR 数据里一定带 `https://static.nanoka.cc/hsr/{版本}/...` 的 URL。
 * 首页 1.1 MB、角色页 700 KB，做每日探测都太重。
 *
 * 用法：
 *   node scripts/detect-upstream-version.mjs          # 打印版本号，例如 4.7.51
 *   node scripts/detect-upstream-version.mjs --json   # 打印 { version, source, fetchedAt }
 */

import { fileURLToPath } from 'node:url';

const PEAK_URL = 'https://hsr.nanoka.cc/peak';
const USER_AGENT = 'HSRLocal/0.1 (+upstream version probe)';
const PATTERN = /static\.nanoka\.cc\/hsr\/(\d+\.\d+\.\d+)\//g;

/**
 * 拉取并解析上游版本。
 *
 * @returns {Promise<string>} 版本号（如 `4.7.51`）
 */
export async function detectUpstreamVersion() {
  const response = await fetch(PEAK_URL, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`上游探测失败：${PEAK_URL} → HTTP ${response.status}`);
  const text = await response.text();
  const match = PATTERN.exec(text);
  PATTERN.lastIndex = 0;
  if (match === null) throw new Error(`上游页面里没找到数据版本号：${PEAK_URL}`);
  return match[1];
}

const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  try {
    const version = await detectUpstreamVersion();
    if (process.argv.includes('--json')) {
      console.log(JSON.stringify({ version, source: PEAK_URL, fetchedAt: new Date().toISOString() }));
    } else {
      console.log(version);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
