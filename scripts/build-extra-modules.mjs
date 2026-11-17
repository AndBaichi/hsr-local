#!/usr/bin/env node
/**
 * T02b：三个新栏目（更新日志 / 终局内容 / 货币战争）+ 原站导航图标的数据下载
 *
 * 用法：
 *   node scripts/build-extra-modules.mjs                # 增量下载（已存在即跳过）
 *   node scripts/build-extra-modules.mjs --out <dir>    # 指定数据包根目录
 *   node scripts/build-extra-modules.mjs --dry          # 只列清单，不下载
 *
 * 数据源全部来自 `docs/03-module-expansion.md` 的实测结论，不要在别处重复猜路径。
 * 特别注意两组「名字对不上」：
 *  - 汇总 `maze_extra.json` → 详情目录 `story/`；`maze_boss.json` → `boss/`；`maze_peak.json` → `peak/`
 *  - 源站元素图标叫 `thunder.webp`，包内已重命名为 `lightning.webp`；这里下载的是**导航图标**，无此问题
 *
 * 只往包里**新增**文件，不修改、不删除任何既有文件（用户约束）。
 * 不新增模块计数项，因此不需要改 `pack.rs` 的 `EXPECTED_COUNTS` 常量：
 * 现有自检只核对六个原有索引的条数，额外的 JSON 通过 `read_json` 按路径读取即可。
 */

import { mkdir, stat, writeFile, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const VERSION = '4.7.51';
const STATIC = `https://static.nanoka.cc/hsr/${VERSION}`;
const ASSETS = 'https://static.nanoka.cc/assets/hsr';
const LANGS = ['zh', 'en', 'ja', 'ko'];
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const argv = process.argv.slice(2);
const outArg = argv.indexOf('--out');
const OUT = outArg >= 0 ? resolve(argv[outArg + 1]) : resolve('data/datapack');
const DRY = argv.includes('--dry');

/** 原站导航图标（nodes/0.*.js 里读出的真实表） */
const NAV_ICONS = [
  'phoneappicon/DataBankIcon.webp',
  'phoneappicon/AvatarIcon.webp',
  'tabicon/teach/BattleTeachBasicIcon.webp',
  'tabicon/activity/BoxingClubIcon.webp',
  'phoneappicon/AchievementIcon.webp',
  'phoneappicon/InventoryIcon.webp',
  'tabicon/maze/MonsterIcon.webp',
  'tabicon/abyss/AbyssIcon01.webp',
  'gridfight/icon/1001.webp',
  'avatarroundicon/1001.webp',
  'gridfight/equipment/350101.webp',
  'gridfight/portal/101.webp',
  'gridfight/augmentbig/100101.webp',
  'gridfight/maincharacterbuff/100000.webp',
];

const CURRENCY_FILES = ['role', 'item', 'buff', 'augment', 'spotlight', 'trait'];

/**
 * 角色详情页的属性图标（原站 `nodes/13.*.js` 的 `Nt` 表，实测全部 200）。
 *
 * 这 6 张不在六个图鉴的 `icon_path` 里，是详情页属性表写死引用的，
 * 因此不能靠第 5b 步的「按 icon_path 推导」拿到，必须单独下载。
 */
const ATTRIBUTE_ICONS = [
  'IconBuffHPBoost', // 生命值提高
  'IconFrontRow', // 前台基础强度
  'IconBackRow', // 后台基础强度
  'IconAccele', // 速度提高
  'IconTreatmentIntensity', // 基础治疗强度
  'IconShieldStrength', // 基础护盾强度
];

/** 终局四个模式：汇总文件 → 详情目录 */
const ENDGAME = [
  { summary: 'maze.json', detailDir: 'maze' },
  { summary: 'maze_extra.json', detailDir: 'story' },
  { summary: 'maze_boss.json', detailDir: 'boss' },
  { summary: 'maze_peak.json', detailDir: 'peak' },
];

/** 简易并发限流 */
function limiter(concurrency) {
  let active = 0;
  const queue = [];
  const next = () => {
    active -= 1;
    const resume = queue.shift();
    if (resume) resume();
  };
  return (task) =>
    new Promise((resolveTask, rejectTask) => {
      const run = () => {
        active += 1;
        Promise.resolve()
          .then(task)
          .then(resolveTask, rejectTask)
          .finally(next);
      };
      if (active < concurrency) run();
      else queue.push(run);
    });
}

/** 带重试的下载；404 视为「源站没有」而不是失败 */
async function download(url) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: '*/*' },
        signal: AbortSignal.timeout(30_000),
      });
      if (response.status === 404) return { status: 404, body: null };
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return { status: 200, body: Buffer.from(await response.arrayBuffer()) };
    } catch (error) {
      lastError = error;
      await new Promise((done) => setTimeout(done, 200 * (attempt + 1)));
    }
  }
  throw lastError;
}

async function exists(path) {
  try {
    const info = await stat(path);
    return info.size > 0;
  } catch {
    return false;
  }
}

const stats = { added: 0, skipped: 0, missing: [], failed: [] };

/** 下载一个 URL 到包内相对路径 */
async function grab(localRel, url, run) {
  const target = join(OUT, localRel);
  if (await exists(target)) {
    stats.skipped += 1;
    return;
  }
  if (DRY) {
    console.log(`  [dry] ${localRel}`);
    return;
  }
  await run(async () => {
    try {
      const { status, body } = await download(url);
      if (status === 404) {
        stats.missing.push({ localRel, url });
        return;
      }
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, body);
      stats.added += 1;
    } catch (error) {
      stats.failed.push({ localRel, url, message: String(error?.message ?? error) });
    }
  });
}

async function main() {
  console.log(`[T02b] 目标包目录：${OUT}${DRY ? '（dry-run）' : ''}`);
  const run = limiter(8);
  /** @type {Array<{localRel:string,url:string}>} */
  const tasks = [];

  // 1. 终局四个汇总 + 各自详情
  for (const { summary, detailDir } of ENDGAME) {
    const response = await fetch(`${STATIC}/${summary}`, { headers: { 'User-Agent': UA } });
    if (!response.ok) throw new Error(`汇总文件 ${summary} 读取失败：HTTP ${response.status}`);
    const json = await response.json();
    const ids = Object.keys(json);
    tasks.push({ localRel: `db/${summary}`, url: `${STATIC}/${summary}` });
    for (const lang of LANGS) {
      for (const id of ids) {
        tasks.push({ localRel: `db/${lang}/${detailDir}/${id}.json`, url: `${STATIC}/${lang}/${detailDir}/${id}.json` });
      }
    }
    console.log(`  ${summary}: ${ids.length} 个赛季 → ${detailDir}/`);
  }

  // 2. 版本映射（只有 maze 与 peak 有，实测 story/boss 的 404）
  for (const lang of LANGS) {
    for (const dir of ['maze', 'peak']) {
      tasks.push({ localRel: `db/${lang}/${dir}/version.json`, url: `${STATIC}/${lang}/${dir}/version.json` });
    }
  }

  // 3. 货币战争六个图鉴
  for (const lang of LANGS) {
    for (const name of CURRENCY_FILES) {
      tasks.push({ localRel: `db/${lang}/currency/${name}.json`, url: `${STATIC}/${lang}/currency/${name}.json` });
    }
  }

  // 3b. 角色详情（原站 `/currency/role/:id`）
  //
  // 汇总 `role.json` 每条只有 8 个字段（id/name/星级/前后排/充能/trait_list），
  // 星魂、前后排技能、三档属性、推荐光锥全在**单条文件**里：
  // `{STATIC}/{lang}/currency/role/{id}.json`（实测 1006 为 60 KB）。
  // 不抓这一层，详情页就只能把 id 列表摊开显示，等于没有详情。
  try {
    const raw = JSON.parse(await readFile(join(OUT, 'db/zh/currency/role.json'), 'utf8'));
    const rows = Array.isArray(raw) ? raw : Object.values(raw);
    const roleIds = rows.map((row) => String(row?.id ?? '')).filter((id) => id !== '');
    for (const lang of LANGS) {
      for (const id of roleIds) {
        tasks.push({
          localRel: `db/${lang}/currency/role/${id}.json`,
          url: `${STATIC}/${lang}/currency/role/${id}.json`,
        });
      }
    }
    console.log(`  角色详情：${roleIds.length} 条 × ${LANGS.length} 语言 = ${roleIds.length * LANGS.length} 个文件`);
  } catch {
    console.log('  角色详情：本地还没有 db/zh/currency/role.json，跳过（先跑一次本脚本的列表阶段）');
  }

  // 3c. 详情页属性表的 6 个图标（见 ATTRIBUTE_ICONS 注释）
  for (const icon of ATTRIBUTE_ICONS) {
    tasks.push({ localRel: `img/gridfight/${icon}.webp`, url: `${ASSETS}/gridfight/${icon}.webp` });
  }

  // 4. 更新日志差异包（源站是 {version}/diff/{lang}.json，落到包内 db/{lang}/diff.json）
  for (const lang of LANGS) {
    tasks.push({ localRel: `db/${lang}/diff.json`, url: `${STATIC}/diff/${lang}.json` });
  }

  // 5. 原站导航图标，保持原目录层级
  for (const icon of NAV_ICONS) {
    tasks.push({ localRel: `img/nav/${icon}`, url: `${ASSETS}/${icon}` });
  }

  console.log(`  合计 ${tasks.length} 个文件，8 并发下载…`);
  for (const task of tasks) {
    await grab(task.localRel, task.url, run);
  }

  // 5b. 货币战争的实体图标。
  // 源站 `icon_path` 是 `SpriteOutput/GridFight/<族>/<名字>.png`，
  // 实际资源在 `assets/hsr/gridfight/<小写族>/<名字>.webp`（全部实测 200）。
  // 角色图鉴没有 icon_path，用 `avatarroundicon/{id}.webp`。
  if (!DRY) {
    const { readFile } = await import('node:fs/promises');
    const FAMILY = {
      GridItem: 'equipment',
      Equipment: 'equipment',
      AugmentBig: 'augmentbig',
      Portal: 'portal',
      MainCharacterBuff: 'maincharacterbuff',
      TraitIcon: 'icon',
    };
    /** @type {Array<{localRel:string,url:string}>} */
    const iconTasks = [];
    for (const name of CURRENCY_FILES) {
      const raw = JSON.parse(await readFile(join(OUT, `db/zh/currency/${name}.json`), 'utf8'));
      const rows = Array.isArray(raw) ? raw : Object.values(raw);
      for (const row of rows) {
        const sourcePath = typeof row?.icon_path === 'string' ? row.icon_path : '';
        if (sourcePath) {
          const segments = sourcePath.split('/');
          const family = FAMILY[segments[2]] ?? FAMILY[segments[3]];
          const base = (segments[segments.length - 1] ?? '').replace(/\.png$/i, '');
          if (!family || !base) continue;
          iconTasks.push({
            localRel: `img/gridfight/${family}/${base}.webp`,
            url: `${ASSETS}/gridfight/${family}/${base}.webp`,
          });
        } else if (name === 'role' && row?.id !== undefined) {
          iconTasks.push({
            localRel: `img/avatarroundicon/${row.id}.webp`,
            url: `${ASSETS}/avatarroundicon/${row.id}.webp`,
          });
        }
      }
    }
    const uniqueIcons = [...new Map(iconTasks.map((task) => [task.localRel, task])).values()];
    console.log(`  货币战争图标 ${uniqueIcons.length} 张…`);
    tasks.push(...uniqueIcons);
    for (const task of uniqueIcons) {
      await grab(task.localRel, task.url, run);
    }
  }

  // 6. 清单（便于校验与以后重建）
  const manifest = {
    version: VERSION,
    generatedAt: new Date().toISOString(),
    note: 'docs/03-module-expansion.md 描述的新增栏目数据；只新增，不改动既有文件',
    counts: {
      requested: tasks.length,
      added: stats.added,
      skipped: stats.skipped,
      missing404: stats.missing.length,
      failed: stats.failed.length,
    },
    missing404: stats.missing,
    failed: stats.failed,
  };
  if (!DRY) {
    await writeFile(join(OUT, 'extra-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  }
  console.log(JSON.stringify(manifest.counts));
  if (stats.failed.length > 0) {
    console.error('失败样例：', stats.failed.slice(0, 5));
    process.exitCode = 1;
  }
}

await main();
