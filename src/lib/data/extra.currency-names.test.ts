/**
 * 货币战争的「特殊显示名 / 图标候选 / 搜索名」单测（**不需要数据包**，CI 默认就跑）
 *
 * ## 为什么单独一组
 *
 * 这两类特例是「数据本身残了」的补丁，编译期完全抓不到：
 *  - `604202`（帕姆王）的 `name` 在四语言里**都是 `null`**、头像 `6042.webp` 在包内**不存在**，
 *    必须靠 {@link currencyDisplayName} + {@link currencyRoleIconCandidates} 兜到敌人立绘
 *  - `8007` / `8009` / `800902` 的 `name` 字面是 `{NICKNAME}`，原站替换成「开拓者」，
 *    漏掉就会在卡片上渲染出 `{NICKNAME}` 这串占位符
 *
 * 同时钉死「**别误伤普通条目**」：显示名入口被卡片、详情、搜索、羁绊成员、光环推荐五处共用，
 * 规则一旦写成 `id.startsWith('6042')` 之类，受影响的就不止这 4 条。
 *
 * ## 翻译函数怎么来
 *
 * 直接从 `src/i18n/locales/{lang}.json` 读真实取值，而不是在测试里手写一份中文常量 ——
 * 手写的那份和 locale 漂移后测试照样绿，等于没测。这样也能顺手证明四语言 key 确实存在。
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';

import {
  CURRENCY_PAM_KING_ID,
  currencyDisplayName,
  currencyIconCandidates,
  currencyNameAliases,
  currencyRoleIconCandidates,
  currencySearchNames,
  currencySpecialName,
  roleAvatarId,
  type CurrencyEntry,
  type CurrencyKind,
} from '@/lib/data/extra';

const LANGS = ['zh', 'en', 'ja', 'ko'] as const;
type Lang = (typeof LANGS)[number];

/** 帕姆王的图标（敌人页「合金机铠•帕姆王」立绘，`primaryId 5014020`） */
const PAM_KING_ICON = 'img/monster/5014020.webp';

/** 数据里字面写成宏占位符的名字 */
const NICKNAME = '{NICKNAME}';

/** 三个 `{NICKNAME}` 条目的 id（与实测数据一致） */
const NICKNAME_IDS = ['8007', '8009', '800902'] as const;

/**
 * 读某个语言的 locale JSON（`currency` 子树）。
 *
 * @param lang 语言
 */
function currencyLocale(lang: Lang): Record<string, string> {
  const file = join(process.cwd(), 'src', 'i18n', 'locales', `${lang}.json`);
  const json = JSON.parse(readFileSync(file, 'utf8')) as { currency: Record<string, string> };
  return json.currency;
}

/**
 * 用真实 locale 取值拼一个只认 `currency.*` 的 `t`。
 *
 * @param lang 语言
 */
function makeT(lang: Lang): TFunction {
  const table = currencyLocale(lang);
  const t = (key: string): string => table[key.replace(/^currency\./, '')] ?? key;
  return t as unknown as TFunction;
}

/**
 * 构造条目。
 *
 * `CurrencyEntry` 是索引签名接口，`name` 声明成 `string | undefined`，但真实数据里
 * `604202.name` 是 **`null`** —— 这个形状差异本身就是被测对象，所以只在这里做一次收窄。
 *
 * @param data 条目字段
 */
function entry(data: Record<string, unknown>): CurrencyEntry {
  return data as unknown as CurrencyEntry;
}

describe('货币战争 · 特殊显示名', () => {
  it.each(LANGS)('%s：604202 显示为本地化的「帕姆王」，且取的是本地值不是中文', (lang) => {
    const t = makeT(lang);
    const pam = entry({ id: CURRENCY_PAM_KING_ID, name: null });
    const expected = currencyLocale(lang).pamKingName as string;

    expect(expected, `${lang} 缺 currency.pamKingName`).toBeTruthy();
    expect(currencyDisplayName(pam, 'role', t)).toBe(expected);
  });

  it('604202 在四语言下取值互不相同（证明走的是 i18n 而不是写死中文）', () => {
    const names = LANGS.map((lang) => currencyDisplayName(entry({ id: CURRENCY_PAM_KING_ID, name: null }), 'role', makeT(lang)));
    expect(new Set(names).size, `四种语言的显示名应互不相同，实得 ${names.join(' / ')}`).toBe(4);
    expect(names[0]).toBe('帕姆王');
  });

  it.each(LANGS)('%s：三个 {NICKNAME} 条目显示为本地化的「开拓者」，且不残留占位符', (lang) => {
    const t = makeT(lang);
    const expected = currencyLocale(lang).trailblazerName as string;

    for (const id of NICKNAME_IDS) {
      const name = currencyDisplayName(entry({ id, name: NICKNAME }), 'role', t);
      expect(name, `${id} 应为 ${expected}`).toBe(expected);
      expect(name).not.toContain('{');
      expect(name).not.toContain('}');
    }
  });

  it('{NICKNAME} 的替换与图鉴种类无关（卡片以外的调用方传 trait/item 也不会漏）', () => {
    const t = makeT('zh');
    const kinds: readonly CurrencyKind[] = ['role', 'trait', 'item', 'buff', 'augment', 'spotlight'];
    for (const kind of kinds) {
      expect(currencyDisplayName(entry({ id: '800902', name: NICKNAME }), kind, t), `kind=${kind}`).toBe('开拓者');
    }
  });

  it('特殊名只认这 4 个 id：相似 id / 普通条目一律不被误伤', () => {
    const t = makeT('zh');
    // 前缀相近、位数相近的 id 都必须走原名
    const traps: readonly Record<string, unknown>[] = [
      { id: '6042', name: '虎克' },
      { id: '60420', name: '某角色' },
      { id: '6042020', name: '另一个角色' },
      { id: '800', name: '某角色' },
      { id: '80090', name: '某角色' },
      { id: '18007', name: '某角色' },
      { id: 604202 as unknown as string, name: '数字型 id 的同名条目仍应特判' },
    ];
    for (const trap of traps) {
      const name = currencyDisplayName(entry(trap), 'role', t);
      if (String(trap.id) === CURRENCY_PAM_KING_ID) {
        expect(name, `数字型 ${CURRENCY_PAM_KING_ID} 也应显示帕姆王`).toBe('帕姆王');
      } else {
        expect(name, `id=${String(trap.id)} 不该被特例命中`).toBe(String(trap.name));
      }
    }
  });

  it('普通条目逐字返回原名的 trim 结果（不被别名/特例改写）', () => {
    const t = makeT('zh');
    const normal = entry({ id: '1101', name: '  三月七  ' });
    expect(currencyDisplayName(normal, 'role', t)).toBe('三月七');
    expect(currencySpecialName('1101', t)).toBeUndefined();
  });

  it('name 为空 / 缺失时回退 id，绝不留空标题', () => {
    const t = makeT('zh');
    expect(currencyDisplayName(entry({ id: '999999', name: '' }), 'role', t)).toBe('999999');
    expect(currencyDisplayName(entry({ id: '999998' }), 'role', t)).toBe('999998');
    expect(currencyDisplayName(entry({ id: '999997', name: '   ' }), 'role', t)).toBe('999997');
  });

  it('特例只在角色图鉴生效（非 role 种类不套帕姆王的名字）', () => {
    const t = makeT('zh');
    // 同一个 id 出现在别的图鉴里（现实数据不会，但要防「按 id 全域特判」的写法）
    expect(currencyDisplayName(entry({ id: CURRENCY_PAM_KING_ID, name: '某物品' }), 'item', t)).toBe('某物品');
  });
});

describe('货币战争 · 角色图标候选', () => {
  it('604202 首候选是敌人立绘，常规两只候选退到后面', () => {
    const candidates = currencyRoleIconCandidates(CURRENCY_PAM_KING_ID);
    expect(candidates[0]).toBe(PAM_KING_ICON);
    expect(candidates).toHaveLength(3);
    expect(candidates.slice(1)).toEqual([`img/character/${roleAvatarId(CURRENCY_PAM_KING_ID)}.webp`, `img/avatarroundicon/${roleAvatarId(CURRENCY_PAM_KING_ID)}.webp`]);
  });

  it('普通角色不走特例：首候选是 img/character/{id 前 4 位}.webp', () => {
    for (const [id, avatar] of [['11011', '1101'], ['15061', '1506'], ['100402', '1004']] as const) {
      const candidates = currencyRoleIconCandidates(id);
      expect(candidates[0], `id=${id}`).toBe(`img/character/${avatar}.webp`);
      expect(candidates).toHaveLength(2);
      expect(candidates[1]).toBe(`img/avatarroundicon/${avatar}.webp`);
    }
  });

  it('数字型 id 与字符串型 id 得到同一条候选链', () => {
    expect(currencyRoleIconCandidates(604202 as unknown as string)).toEqual(currencyRoleIconCandidates('604202'));
    expect(currencyRoleIconCandidates(1101 as unknown as string)[0]).toBe(currencyRoleIconCandidates('1101')[0]);
  });

  it('currencyIconCandidates 在 role 种类下与 currencyRoleIconCandidates 完全一致', () => {
    const pam = entry({ id: CURRENCY_PAM_KING_ID, name: null });
    expect(currencyIconCandidates(pam, 'role')).toEqual(currencyRoleIconCandidates(CURRENCY_PAM_KING_ID));
    // 非 role 图鉴走 icon_path，role 条目没有 icon_path → 空候选（交给 SafeImage 占位）
    expect(currencyIconCandidates(pam, 'trait')).toEqual([]);
  });
});

describe('货币战争 · 搜索名与别名', () => {
  it('604202 的别名覆盖四语言与敌人全名，中文界面也能被英文名命中', () => {
    const aliases = currencyNameAliases(entry({ id: CURRENCY_PAM_KING_ID, name: null }), 'role');
    expect(aliases).toContain('帕姆王');
    expect(aliases).toContain('King Pom-Pom');
    expect(aliases).toContain('パムキング');
    expect(aliases).toContain('폼폼킹');
    expect(aliases).toContain('合金机铠•帕姆王');
  });

  it('{NICKNAME} 条目靠 name 字面命中别名（四语言开拓者）', () => {
    for (const id of NICKNAME_IDS) {
      const aliases = currencyNameAliases(entry({ id, name: NICKNAME }), 'role');
      expect(aliases, `id=${id}`).toEqual(expect.arrayContaining(['开拓者', 'Trailblazer', '開拓者', '개척자']));
    }
  });

  it('普通条目没有别名（防止别名逻辑把搜索结果撑出重复命中）', () => {
    expect(currencyNameAliases(entry({ id: '1101', name: '三月七' }), 'role')).toEqual([]);
  });

  it('主角光环通过推荐角色继承别名，但推荐列表的 id 不被误当成特例', () => {
    const spotlight = entry({ id: '100000', name: '某光环', recommend: [CURRENCY_PAM_KING_ID, 1101] });
    const aliases = currencyNameAliases(spotlight, 'spotlight');
    expect(aliases).toContain('帕姆王');
    // 普通推荐角色（1101）不带来任何别名
    expect(aliases).not.toContain('三月七');
  });

  it('currencySearchNames 同时给出显示名、原始名与别名（帕姆王原始名为空时不塞 undefined 值）', () => {
    const t = makeT('zh');
    const pam = currencySearchNames(entry({ id: CURRENCY_PAM_KING_ID, name: null }), 'role', t);
    expect(pam.display).toBe('帕姆王');
    expect(pam.raw).toBeUndefined();
    expect(Object.values(pam)).not.toContain('');

    const normal = currencySearchNames(entry({ id: '1101', name: '三月七' }), 'role', t);
    expect(normal.display).toBe('三月七');
    expect(normal.raw).toBe('三月七');
  });
});
