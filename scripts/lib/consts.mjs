/**
 * 数据管线常量（架构文档 §8.9 consts.ts 的 `.mjs` 实现）
 *
 * 所有期望计数 / 字节数都集中在这里，validate 阶段逐条比对；
 * 任何一处与源站不一致都必须让构建以非 0 退出码失败，而不是"尽力而为"。
 */

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** scripts/lib/ -> 项目根 */
const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, '..', '..');

/** 数据源版本（唯一出现版本号的地方是设置页/关于页展示，运行期零网络） */
export const VERSION = (process.env.HSR_VERSION ?? '4.7.51').trim();

/** 硬编码字节/计数断言对应的基线版本；新版本只做结构校验 */
export const BASELINE_VERSION = '4.7.51';

/** 版本根路径 */
export const ORIGIN = `https://static.nanoka.cc/hsr/${VERSION}/`;

/**
 * 图片根路径。
 * 图片不在 `hsr/{version}/` 下，而在站点根的 `assets/hsr/` 下。
 */
export const ASSET_ORIGIN = 'https://static.nanoka.cc/assets/hsr/';

/** 支持的语言（顺序即产物目录顺序） */
export const LANGUAGES = ['zh', 'en', 'ja', 'ko'];

/** 默认语言 */
export const DEFAULT_LANGUAGE = 'zh';

/** 请求 UA：默认 UA 会被源站 403 */
export const USER_AGENT = 'HSRLocal/0.1 (+local datapack builder)';

/** 网络参数 */
export const HTTP = {
  concurrency: 8,
  retries: 3,
  timeoutMs: 20_000,
  retryDelayMs: 800,
  /** 每下载 N 个文件往 build.log 写一行进度 */
  logEvery: 100,
};

/** 本地目录 */
export const CACHE_DIR = join(ROOT, '.cache', 'fetch');
export const OUT_DIR = join(ROOT, 'data', 'datapack');
export const DB_DIR = join(OUT_DIR, 'db');
export const IMG_DIR = join(OUT_DIR, 'img');
export const META_PATH = join(OUT_DIR, 'meta.json');
export const REPORT_PATH = join(ROOT, 'datapack-report.json');
export const LOG_PATH = join(ROOT, 'scripts', 'build.log');
export const PACK_PATH = join(ROOT, `hsr-local-${VERSION}.hsrpack`);

/**
 * 12 个列表 / 聚合文件。
 * `bytes` 是源站实测字节数——逐语言比对，避免"某语言缺文件、另一语言重复计入"凑平。
 */
export const LIST_FILES = [
  { key: 'character', path: 'character.json', bytes: 57_734 },
  { key: 'lightcone', path: 'lightcone.json', bytes: 53_818 },
  { key: 'relicset', path: 'relicset.json', bytes: 98_457 },
  { key: 'monster', path: 'monster.json', bytes: 492_872 },
  { key: 'item:zh', path: 'zh/item_all.json', bytes: 1_398_420 },
  { key: 'item:en', path: 'en/item_all.json', bytes: 1_461_580 },
  { key: 'item:ja', path: 'ja/item_all.json', bytes: 1_512_231 },
  { key: 'item:ko', path: 'ko/item_all.json', bytes: 1_498_085 },
  { key: 'achievement:zh', path: 'zh/achievement/achievement.json', bytes: 519_810 },
  { key: 'achievement:en', path: 'en/achievement/achievement.json', bytes: 545_654 },
  { key: 'achievement:ja', path: 'ja/achievement/achievement.json', bytes: 573_746 },
  { key: 'achievement:ko', path: 'ko/achievement/achievement.json', bytes: 573_929 },
];

/** 详情文件族与每个语言的期望文件数 */
export const DETAIL_FAMILIES = [
  { key: 'character', count: 404 },
  { key: 'lightcone', count: 696 },
  { key: 'relicset', count: 256 },
  { key: 'monster', count: 2664 },
];

/** 图片族与期望张数 */
export const IMAGE_FAMILIES = [
  { key: 'character', dir: 'avatarshopicon', ext: '.webp', count: 101 },
  { key: 'lightcone', dir: 'lightconemediumicon', ext: '.webp', count: 174 },
  { key: 'monster', dir: 'monstermiddleicon', ext: '.webp', count: 666 },
  { key: 'item', dir: 'itemfigures', ext: '.webp', count: 1670 },
  { key: 'element', dir: 'element', ext: '.webp', count: 7 },
  { key: 'path', dir: 'pathicon', ext: '.webp', count: 9 },
];

/** 7 种战斗属性（图标文件名必须全小写） */
export const ELEMENT_SLUGS = [
  'physical',
  'fire',
  'ice',
  'lightning',
  'wind',
  'quantum',
  'imaginary',
];

/** 9 种命途（图标文件名必须全小写） */
export const PATH_SLUGS = [
  'warrior',
  'rogue',
  'mage',
  'shaman',
  'knight',
  'warlock',
  'priest',
  'elation',
  'memory',
];

/** 实体计数期望值 */
export const EXPECTED = {
  character: 101,
  lightcone: 174,
  relicset: 64,
  monster: 666,
  monsterGroups: 382,
  item: 1606,
  achievement: 2022,
  achievementSeries: 9,
  /** 被整体丢弃的 `{TextID#…}` 获取途径条目数 */
  droppedTextIdEntries: 29,
};

/** 物品分片数：`Number(id) % 16` */
export const ITEM_SHARDS = 16;

/** 应用自有 schema 版本；与 Rust 侧 `SCHEMA_VERSION` 一致 */
export const SCHEMA_VERSION = 1;
