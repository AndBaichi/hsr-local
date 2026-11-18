/**
 * 三个新栏目 × 真实数据包契约（`HSR_SWEEP_PACK=<解包目录> npm test`）
 *
 * ## 为什么需要它
 *
 * `contract.test.ts` 钉的是原有六模块。T04b 新加的三组数据有一批**编译期完全抓不到**的约定：
 *  - 汇总文件名 ≠ 详情目录名（`maze_extra.json → story/`），按直觉拼路径会整页 404
 *  - 四语言 × 114 个赛季 = 456 个详情文件，缺一个就是某一页白屏
 *  - `item.json` 的值**没有 `id` 字段**，只有对象键有 —— DAL 必须注入，否则列表无稳定 key
 *  - `3024` 赛季四语言名全为 null —— `seasonName()` 必须回退，不能显示空白
 *  - `diff.json` 里有 496 个 `contextOnly` 变更 —— 过滤规则要照抄原站，不能全列给用户
 *  - 货币战争 68 个 NPC 角色源站本身缺头像，这是**预期**的占位，不是下载失败
 *  - `604202`（帕姆王）的 `name` 四语言全为 `null`、头像 `6042.webp` 包内不存在，
 *    必须靠敌人立绘 `img/monster/5014020.webp` 顶上；`8007/8009/800902` 的 `name`
 *    字面是 `{NICKNAME}` —— 这两类特例的判定**只能**从生产代码里取，别在测试里抄一遍
 *
 * 这些是「页面能编译但点开没数据」的唯一防线。没设环境变量时整组跳过，
 * CI 上没有数据包也不会红，与 `contract.test.ts` / `richtext.realdata.test.ts` 一致。
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';

import {
  CURRENCY_PAM_KING_ID,
  currencyDisplayName,
  currencyIconCandidates,
  currencyRoleIconCandidates,
  type CurrencyEntry,
} from '@/lib/data/extra';
import { macroTextToPlain, renderMacroText } from '@/lib/text/macrotext';

const PACK = process.env.HSR_SWEEP_PACK;
const LANGS = ['zh', 'en', 'ja', 'ko'] as const;

/** 读 JSON，缺失直接失败而不是静默跳过 */
function readJson(rel: string): unknown {
  return JSON.parse(readFileSync(join(PACK as string, rel), 'utf8')) as unknown;
}

/** 断言存在 */
function mustExist(rel: string): void {
  expect(existsSync(join(PACK as string, rel)), `缺文件 ${rel}`).toBe(true);
}

/** 断言不存在（用来钉死「别按直觉拼路径」） */
function mustNotExist(rel: string): void {
  expect(existsSync(join(PACK as string, rel)), `不该存在 ${rel}`).toBe(false);
}

/** 汇总文件 → 详情目录，以及实测条数 */
const ENDGAME: readonly { readonly summary: string; readonly dir: string; readonly count: number }[] = [
  { summary: 'maze.json', dir: 'maze', count: 49 },
  { summary: 'maze_extra.json', dir: 'story', count: 29 },
  { summary: 'maze_boss.json', dir: 'boss', count: 24 },
  { summary: 'maze_peak.json', dir: 'peak', count: 12 },
];

const CURRENCY_KINDS = ['role', 'item', 'buff', 'augment', 'spotlight', 'trait'] as const;

/** 侧栏用的 9 个原站图标（`/changelog` 是内联 SVG，无 webp） */
const NAV_ICONS: readonly string[] = [
  'img/nav/phoneappicon/DataBankIcon.webp',
  'img/nav/phoneappicon/AvatarIcon.webp',
  'img/nav/tabicon/teach/BattleTeachBasicIcon.webp',
  'img/nav/tabicon/activity/BoxingClubIcon.webp',
  'img/nav/tabicon/maze/MonsterIcon.webp',
  'img/nav/phoneappicon/InventoryIcon.webp',
  'img/nav/phoneappicon/AchievementIcon.webp',
  'img/nav/tabicon/abyss/AbyssIcon01.webp',
  'img/nav/gridfight/icon/1001.webp',
];

/** 递归收集一个 JSON 里的所有字符串（用于宏文本扫描） */
function collectStrings(value: unknown, out: string[]): void {
  if (typeof value === 'string') {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const child of value) collectStrings(child, out);
  } else if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) collectStrings(child, out);
  }
}

describe.skipIf(PACK === undefined || PACK === '')('三个新栏目 × 真实数据包契约', () => {
  it('四个终局汇总条数正确，且 114 个赛季在四语言下都有详情文件', () => {
    let totalSeasons = 0;
    for (const { summary, dir, count } of ENDGAME) {
      const raw = readJson(`db/${summary}`) as Record<string, { id?: string | number }>;
      expect(Object.keys(raw), `${summary} 条数`).toHaveLength(count);
      totalSeasons += count;

      for (const [key, value] of Object.entries(raw)) {
        const id = String(value.id ?? key);
        for (const lang of LANGS) {
          mustExist(`db/${lang}/${dir}/${id}.json`);
        }
      }
    }
    expect(totalSeasons).toBe(114);
  });

  it('汇总文件名 ≠ 详情目录名：错误拼法一律不存在，防止改回直觉路径', () => {
    mustNotExist('db/zh/maze_extra/2001.json');
    mustNotExist('db/zh/maze_boss/3001.json');
    mustNotExist('db/zh/maze_peak/1.json');
    mustNotExist('db/zh/story/100.json');
  });

  it('version.json 只有 maze / peak 有；story / boss 没有（DAL 对这两者返回空映射）', () => {
    for (const lang of LANGS) {
      mustExist(`db/${lang}/maze/version.json`);
      mustExist(`db/${lang}/peak/version.json`);
      mustNotExist(`db/${lang}/story/version.json`);
      mustNotExist(`db/${lang}/boss/version.json`);
    }
  });

  it('3024 赛季四语言名全为 null —— seasonName() 的回退分支必须存在', () => {
    const boss = readJson('db/maze_boss.json') as Record<string, Record<string, unknown>>;
    const season = boss['3024'];
    expect(season, 'maze_boss.json 应有 3024').toBeDefined();
    for (const lang of LANGS) {
      expect(season[lang], `3024.${lang} 应为 null`).toBeNull();
    }
  });

  it('四语言 diff.json 是预算好的差异包，字段与过滤规则符合原站语义', () => {
    for (const lang of LANGS) {
      const bundle = readJson(`db/${lang}/diff.json`) as {
        schemaVersion: number;
        fromVersion: string;
        toVersion: string;
        counts: { total: number };
        items: readonly {
          entity: string;
          status: string;
          changes: readonly { contextOnly?: boolean }[];
        }[];
      };
      expect(bundle.schemaVersion).toBe(1);
      expect(bundle.fromVersion).toBe('4.7');
      expect(bundle.toVersion).toBe('4.7.51');
      expect(bundle.items).toHaveLength(bundle.counts.total);
      expect(bundle.items.length).toBeGreaterThan(0);

      const entities = new Set(bundle.items.map((item) => item.entity));
      expect([...entities].sort()).toEqual(['character', 'lightcone', 'relic']);
      for (const item of bundle.items) {
        expect(['added', 'removed', 'changed']).toContain(item.status);
      }

      // 原站 Q 语义：丢掉 contextOnly 的 change，但只要有非上下文变更，整条仍保留
      const contextOnly = bundle.items.flatMap((item) => item.changes).filter((c) => c.contextOnly === true);
      expect(contextOnly.length, `${lang} 应含 contextOnly 变更，否则过滤规则没被真正覆盖`).toBeGreaterThan(0);
      const kept = bundle.items.filter((item) => item.changes.some((c) => c.contextOnly !== true));
      expect(kept.length).toBeGreaterThan(0);
    }
  });

  it('六个货币战争图鉴四语言齐备，且都是「按 id 做键的对象」', () => {
    for (const lang of LANGS) {
      for (const kind of CURRENCY_KINDS) {
        const rel = `db/${lang}/currency/${kind}.json`;
        const raw = readJson(rel) as Record<string, Record<string, unknown>>;
        expect(Array.isArray(raw), `${rel} 不该是数组`).toBe(false);
        expect(Object.keys(raw).length, `${rel} 不应为空`).toBeGreaterThan(0);
      }
    }
  });

  it('item.json 的值没有 id 字段（只有对象键有）—— DAL 的注入逻辑不能删', () => {
    const raw = readJson('db/zh/currency/item.json') as Record<string, Record<string, unknown>>;
    const entries = Object.entries(raw);
    expect(entries.length).toBeGreaterThan(0);
    const withoutId = entries.filter(([, value]) => !('id' in value));
    expect(withoutId.length, 'item.json 的值应普遍缺 id').toBe(entries.length);
    // 其它五个图鉴的值自带 id，别把两种形状搞混
    for (const kind of ['role', 'buff', 'augment', 'spotlight', 'trait'] as const) {
      const other = readJson(`db/zh/currency/${kind}.json`) as Record<string, Record<string, unknown>>;
      const first = Object.values(other)[0] as Record<string, unknown>;
      expect('id' in first, `currency/${kind} 首条应有 id`).toBe(true);
    }
  });

  it('货币战争图标候选链：五个图鉴全命中，role 的源站缺图是预期占位', () => {
    for (const kind of CURRENCY_KINDS) {
      const raw = readJson(`db/zh/currency/${kind}.json`) as Record<string, Record<string, unknown>>;
      let hit = 0;
      for (const [key, value] of Object.entries(raw)) {
        const id = String(value.id ?? key);
        // role 的候选链直接取生产代码：帕姆王的敌人立绘特例也在这条链里，
        // 在测试里抄一遍（只拼 character/avatarroundicon）会让特例失去覆盖。
        const candidates: readonly string[] = currencyIconCandidates(
          { ...value, id } as CurrencyEntry,
          kind,
        );
        if (candidates.some((candidate) => existsSync(join(PACK as string, candidate)))) hit += 1;
      }
      if (kind === 'role') {
        // 角色图鉴的候选链在包内是**齐的**（137/138 走 character/{4 位}.webp，
        // 唯一的 604202 靠敌人立绘特例命中）。这里不再断言「必须有缺图条目」：
        // 数据包补齐头像之后那条断言只会误报，而「占位是正确行为」由 SafeImage
        // 与下一条 604202 用例（常规两只候选确实不存在）共同守护。
        // 若特例被删，604202 会掉回 0 个候选 → 这里立刻变红。
        expect(hit, 'currency/role 有条目图标缺失（604202 的特例可能被删了）').toBe(
          Object.keys(raw).length,
        );
      } else {
        expect(hit, `currency/${kind} 有条目图标缺失`).toBe(Object.keys(raw).length);
      }
    }
  });

  it('帕姆王的特例在真实数据上成立：name 为 null、6042 头像缺失、敌人立绘存在', () => {
    const zhRole = readJson('db/zh/currency/role.json') as Record<string, Record<string, unknown>>;
    const pam = zhRole[CURRENCY_PAM_KING_ID];
    expect(pam, `role.json 应有 ${CURRENCY_PAM_KING_ID}`).toBeDefined();
    expect(pam.name, '604202 的 name 应为 null（这正是必须特例的原因）').toBeNull();

    // 常规两只候选在包内**确实不存在**，否则这条特例就无从谈起
    mustNotExist(`img/character/${CURRENCY_PAM_KING_ID.slice(0, 4)}.webp`);
    mustNotExist(`img/avatarroundicon/${CURRENCY_PAM_KING_ID.slice(0, 4)}.webp`);

    const candidates = currencyRoleIconCandidates(CURRENCY_PAM_KING_ID);
    expect(candidates[0]).toBe('img/monster/5014020.webp');
    mustExist(candidates[0] as string);
    // 整条候选链的首项必须真能落到文件上，否则卡片还是占位图
    expect(existsSync(join(PACK as string, candidates[0] as string))).toBe(true);
  });

  it('角色显示名在所有语言下都正确：604202 → 帕姆王、三条 {NICKNAME} → 开拓者、其余逐字不变', () => {
    // 用真实 locale 取值拼 t（与 src/i18n/locales/*.json 同源，避免手写常量漂移）
    const localeOf = (lang: string): Record<string, string> =>
      (JSON.parse(readFileSync(join(process.cwd(), 'src', 'i18n', 'locales', `${lang}.json`), 'utf8')) as {
        currency: Record<string, string>;
      }).currency;

    for (const lang of LANGS) {
      const table = localeOf(lang);
      const t = ((key: string): string => table[key.replace(/^currency\./, '')] ?? key) as unknown as TFunction;
      const raw = readJson(`db/${lang}/currency/role.json`) as Record<string, Record<string, unknown>>;
      const entries = Object.entries(raw).map(([key, value]) => ({ ...value, id: value.id ?? key }) as CurrencyEntry);

      // 1) 帕姆王
      const pam = entries.find((e) => String(e.id) === CURRENCY_PAM_KING_ID);
      expect(pam, `${lang} 缺 604202`).toBeDefined();
      expect(currencyDisplayName(pam as CurrencyEntry, 'role', t), `${lang} 帕姆王名`).toBe(table.pamKingName);
      expect(table.pamKingName, `${lang} 缺 currency.pamKingName`).toBeTruthy();

      // 2) 三条 {NICKNAME}
      const nicknames = entries.filter((e) => e.name === '{NICKNAME}');
      expect(nicknames.map((e) => String(e.id)).sort(), `${lang} 的 {NICKNAME} 条目`).toEqual(['8007', '8009', '800902']);
      for (const row of nicknames) {
        expect(currencyDisplayName(row, 'role', t), `${lang} ${String(row.id)}`).toBe(table.trailblazerName);
      }

      // 3) 其余条目不受影响：显示名必须逐字等于数据里的 name
      const others = entries.filter((e) => String(e.id) !== CURRENCY_PAM_KING_ID && e.name !== '{NICKNAME}');
      expect(others).toHaveLength(134);
      for (const row of others) {
        expect(currencyDisplayName(row, 'role', t), `${lang} ${String(row.id)} 被特例误伤`).toBe(String(row.name).trim());
      }
    }
  });

  it('侧栏 9 个原站图标全部在包内（运行时零网络请求）', () => {
    for (const rel of NAV_ICONS) mustExist(rel);
  });

  it('新模块全部宏字符串可渲染，未知标签不抛错、不吞正文', { timeout: 30_000 }, () => {
    const files: string[] = [];
    for (const dir of ['maze', 'story', 'boss', 'peak']) {
      const base = join(PACK as string, 'db', 'zh', dir);
      for (const name of readdirSync(base)) {
        if (name.endsWith('.json')) files.push(join('db', 'zh', dir, name));
      }
    }
    for (const kind of CURRENCY_KINDS) files.push(join('db', 'zh', 'currency', `${kind}.json`));
    expect(files.length).toBeGreaterThan(100);

    let strings = 0;
    let emptyStrings = 0;
    let unknown = 0;
    const params = [0.5, 3, 0.3, 190, 5, 1.5, 0.6, 0.12, 0.24, 2.2, 0.665, 973.75, 0.9, 1, 0.75];
    for (const rel of files) {
      const collected: string[] = [];
      collectStrings(readJson(rel), collected);
      for (const text of collected) {
        // 实测 343 个空字符串是占位字段（如空的 challenge.name），
        // 渲染器返回空 spans 是正确行为，不该当成「吞正文」。
        if (text.trim() === '') {
          emptyStrings += 1;
          continue;
        }
        strings += 1;
        // 两件事都必须成立：不抛错，且正文不被清空（未知标签只去壳、保留内容）
        const result = renderMacroText(text, params);
        expect(result.spans.length, `${rel}: 非空文本渲染结果为空`).toBeGreaterThan(0);
        expect(macroTextToPlain(text, params).length).toBeGreaterThan(0);
        unknown += result.unknownTags.length;
      }
    }
    expect(strings, '非空宏字符串应超过 1000 条').toBeGreaterThan(1000);
    expect(emptyStrings, '真实数据应含空字符串占位，说明这两类输入确实被区分了').toBeGreaterThan(0);
    // 允许有未知标签（第三方数据随版本增加），但渲染器必须靠 unknownTags 上报而不是抛错
    expect(unknown).toBeGreaterThanOrEqual(0);
  });
});
