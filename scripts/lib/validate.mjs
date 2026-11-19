/**
 * 全量校验（架构文档 §8.9 `validate.ts`、附录 C）
 *
 * 所有断言都必须为 0 或等于期望值；任一不满足 → 退出码非 0。
 * 报告同时写进 `datapack-report.json`，供人工复核。
 */

import { BASELINE_VERSION, EXPECTED, LANGUAGES, VERSION } from './consts.mjs';
import { measure } from './pack.mjs';

/**
 * 断言辅助。
 *
 * @param {Array<object>} checks 检查项累积数组
 * @param {string} name 检查名
 * @param {unknown} actual 实际值
 * @param {unknown} expected 期望值
 * @param {(a: any, e: any) => boolean} [compare] 比较函数
 * @returns {boolean} 是否通过
 */
function assert(checks, name, actual, expected, compare) {
  const ok = compare ? compare(actual, expected) : actual === expected;
  checks.push({ name, actual, expected, ok });
  return ok;
}

/**
 * 版本相关断言：基线版本要求精确相等；新版本只记录实际值，不因上游新增内容失败。
 * 结构/残留类断言仍走 {@link assert}。
 */
function expect(checks, name, actual, expected, compare) {
  if (VERSION === BASELINE_VERSION) return assert(checks, name, actual, expected, compare);
  checks.push({ name, actual, expected: `new-version(基线 ${JSON.stringify(expected)})`, ok: true });
  return true;
}

/**
 * 阶段：全量校验。
 *
 * @param {(message: string) => Promise<void>} log 日志函数
 * @param {Record<string, any>} collected 前面各阶段的结果
 */
export async function stageValidate(log, collected) {
  await log('=== stage: validate ===');

  /** @type {Array<{name: string, actual: unknown, expected: unknown, ok: boolean}>} */
  const checks = [];

  const build = collected.build ?? {};
  const counts = build.counts ?? {};

  /* ---------------- 计数 ---------------- */
  expect(checks, '角色数', counts.character, EXPECTED.character);
  expect(checks, '光锥数', counts.lightcone, EXPECTED.lightcone);
  expect(checks, '遗器套装数', counts.relicset, EXPECTED.relicset);
  expect(checks, '敌人数', counts.monster, EXPECTED.monster);
  expect(checks, '敌人分组数', counts.monsterGroups, EXPECTED.monsterGroups);
  expect(checks, '物品数', counts.item, EXPECTED.item);
  expect(checks, '成就数', counts.achievement, EXPECTED.achievement);
  expect(checks, '成就系列数', counts.achievementSeries, EXPECTED.achievementSeries);

  /* ---------------- 聚合文件字节（逐语言） ---------------- */
  const lists = collected.lists ?? [];
  assert(checks, '聚合文件数量', lists.length, 12);
  assert(
    checks,
    '聚合文件字节全部匹配',
    lists.filter((entry) => entry.ok).length,
    12,
  );

  /* ---------------- 详情文件数 ---------------- */
  const details = collected.details ?? {};
  expect(checks, '详情文件总数', details.total, 4020);

  /* ---------------- 富文本残留 ---------------- */
  assert(checks, '<...> 标签残留', build.residualTag ?? -1, 0);
  assert(checks, '{...} 宏残留', build.residualMacro ?? -1, 0);

  const warnings = build.warnings ?? {};
  assert(checks, 'unknownMacro', warnings.unknownMacro?.count ?? 0, 0);
  assert(checks, 'unknownSpec', warnings.unknownSpec?.count ?? 0, 0);
  assert(checks, 'unknownTag', warnings.unknownTag?.count ?? 0, 0);
  assert(checks, 'paramOutOfRange', warnings.paramOutOfRange?.count ?? 0, 0);
  assert(checks, 'residualBrace', warnings.residualBrace?.count ?? 0, 0);
  assert(checks, 'paramMissing（参数表缺失）', warnings.paramMissing?.count ?? 0, 0);

  /* 以下三类是**已知可接受的降级**，只记录不判失败（详见 report.richtextWarnings） */
  const degradations = {
    textJoin: warnings.textJoin?.count ?? 0,
    seriesRef: warnings.seriesRef?.count ?? 0,
    inlineIcon: warnings.inlineIcon?.count ?? 0,
    layoutMacro: warnings.layoutMacro?.count ?? 0,
  };

  /* ---------------- 被丢弃的 {TextID#} 获取途径 ---------------- */
  const droppedByLang = build.droppedComefromByLang ?? {};
  const droppedZh = droppedByLang.zh ?? build.droppedComefrom ?? -1;
  expect(checks, '被丢弃的 {TextID#} 获取途径（zh）', droppedZh, EXPECTED.droppedTextIdEntries);

  /* ---------------- 图片 ---------------- */
  const images = collected.images ?? {};
  const imageByKind = images.byKind ?? {};
  expect(checks, '角色头像', imageByKind.character, EXPECTED.character);
  expect(checks, '光锥卡面', imageByKind.lightcone, EXPECTED.lightcone);
  // 敌人图按 icon 基名去重：666 条列表项 → 实测 225 张不同图片
  assert(
    checks,
    '敌人图数量（200–260 区间）',
    imageByKind.monster ?? 0,
    '200..260',
    (actual) => actual >= 200 && actual <= 260,
  );
  assert(checks, '属性图标', imageByKind.element, 7);
  assert(checks, '命途图标', imageByKind.path, 9);
  assert(
    checks,
    '物品/套装图数量（800–1000 区间）',
    imageByKind.item ?? 0,
    '800..1000',
    (actual) => actual >= 800 && actual <= 1000,
  );
  assert(checks, '必需图片缺失', images.hardMissingCount ?? -1, 0);
  assert(
    checks,
    '敌人图缺失（源站无此文件，允许 ≤3）',
    images.monsterMissingCount ?? -1,
    '0..3',
    (actual) => actual >= 0 && actual <= 3,
  );

  /* ---------------- 体积 ---------------- */
  const pack = collected.pack;
  const output = await measure('data/datapack').catch(() => ({ count: 0, bytes: 0 }));

  const failed = checks.filter((check) => !check.ok);
  const summary = {
    ok: failed.length === 0,
    failed: failed.map((check) => check.name),
    checks,
    droppedComefromByLang: droppedByLang,
    richtextWarnings: degradations,
    volume: {
      outputFiles: output.count,
      outputBytes: output.bytes,
      packBytes: pack?.bytes ?? null,
      packEntries: pack?.entries ?? null,
    },
    images: {
      byKind: imageByKind,
      missingCount: images.missingCount ?? 0,
      sample: images.missing ?? [],
    },
    reserved: { languages: LANGUAGES },
  };

  for (const check of checks) {
    await log(`  ${check.ok ? '✓' : '✗'} ${check.name}: ${JSON.stringify(check.actual)}（期望 ${JSON.stringify(check.expected)}）`);
  }

  if (failed.length > 0) {
    throw new Error(`校验失败 ${failed.length} 项：${failed.map((check) => check.name).join(' / ')}`);
  }

  await log('  ✓ 全部断言通过');
  return { validate: summary };
}
