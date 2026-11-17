/**
 * 跨模块实体助手（v2.9 新增，v2.10 扩展货币战争）
 *
 * 对比页、卡片右键菜单、收藏/笔记页都需要「`module:id` → 名称/图标/详情路由」的
 * 统一解析。此前这套 switch 散落在 `FavoritesPage` 内部，右键菜单一进来就会出现
 * 第三份拷贝，故收敛到这里。
 *
 * ## 货币战争（v2.10）
 *
 * `currency*` 六个子模块的数据**不在启动索引里**（走 `getCurrencyEntries` 异步读，
 * 且显示名依赖 `t`），所以这里的「名称/图标/稀有度」三个同步查询函数对它们
 * 一律返回保守值（`undefined` / `null`）——调用方（右键菜单 / 收藏 / 笔记）用的是
 * **名称快照**（卡片渲染时同步可得），根本不查索引；对比页则自己异步加载候选。
 *
 * 唯一对 currency 有意义的两个导出是 {@link MODULE_LABEL_KEYS}（模块标签）与
 * {@link detailRouteOf}（详情路由）。
 */

import { dal } from '@/lib/data/dal';
import { CURRENCY_MODULE_KIND } from '@/lib/userdata/types';
import type { LocalizedNames, ModuleKey } from '@/lib/data/types';

/** 模块 → 侧栏本地化文案 key（字面量，配合调用处的 as 断言绕过 i18next 严格 typing） */
export const MODULE_LABEL_KEYS: Readonly<Record<ModuleKey, string>> = {
  character: 'nav.characters',
  lightcone: 'nav.lightcones',
  relicset: 'nav.relics',
  monster: 'nav.monsters',
  item: 'nav.items',
  achievementSeries: 'nav.achievements',
  // 货币战争六个图鉴：标签走 `currency.*`（与图鉴页一致）
  currencyRole: 'currency.currencyRole',
  currencyItem: 'currency.currencyItem',
  currencyBuff: 'currency.currencyBuff',
  currencyAugment: 'currency.currencyAugment',
  currencySpotlight: 'currency.currencySpotlight',
  currencyTrait: 'currency.currencyTrait',
};

/** `currency*` 模块 → 图鉴种类；非 currency 模块返回 `undefined` */
export function currencyKindOf(module: ModuleKey): string | undefined {
  return CURRENCY_MODULE_KIND[module];
}

/** 判断是否是货币战争的图鉴子模块 */
export function isCurrencyModule(module: ModuleKey): boolean {
  return CURRENCY_MODULE_KIND[module] !== undefined;
}

/**
 * 模块 + id → 详情页路由。
 *
 * 成就系列没有独立详情路由（条目在 `/achievements` 页内展开），返回 `null`；
 * 货币战争里 role 有独立详情页（`/currency/role/:id`），其余五个图鉴没有单条路由，
 * 跳到图鉴并用 `?entry=` 打开该条。调用方应据此隐藏「打开详情」入口或走图鉴跳转。
 */
export function detailRouteOf(module: ModuleKey, id: string): string | null {
  switch (module) {
    case 'character':
      return `/characters/${id}`;
    case 'lightcone':
      return `/lightcones/${id}`;
    case 'relicset':
      return `/relics/${id}`;
    // 敌人键是 groupKey（可能含中文/特殊字符），必须编码
    case 'monster':
      return `/monsters/${encodeURIComponent(id)}`;
    case 'item':
      return `/items/${id}`;
    case 'achievementSeries':
      return null;
    case 'currencyRole':
      return `/currency/role/${encodeURIComponent(id)}`;
    case 'currencyItem':
    case 'currencyBuff':
    case 'currencyAugment':
    case 'currencySpotlight':
    case 'currencyTrait': {
      const kind = CURRENCY_MODULE_KIND[module];
      return `/currency/${kind}?entry=${encodeURIComponent(id)}`;
    }
  }
}

/** 索引里是否仍存在该实体（敌人按 groupKey / 主变体 / 任一变体 id 命中）。currency 不在索引，恒 false。 */
export function entityExistsInIndex(module: ModuleKey, id: string): boolean {
  switch (module) {
    case 'character':
      return dal.getIndex('character').some((brief) => brief.id === id);
    case 'lightcone':
      return dal.getIndex('lightcone').some((brief) => brief.id === id);
    case 'relicset':
      return dal.getIndex('relicset').some((brief) => brief.id === id);
    case 'item':
      return dal.getIndex('item').some((brief) => brief.id === id);
    case 'achievementSeries':
      return dal.getIndex('achievementSeries').some((brief) => brief.id === id);
    case 'monster':
      return dal.getIndex('monster').some(
        (brief) => brief.groupKey === id || brief.primaryId === id || brief.variantIds.includes(id),
      );
    case 'currencyRole':
    case 'currencyItem':
    case 'currencyBuff':
    case 'currencyAugment':
    case 'currencySpotlight':
    case 'currencyTrait':
      // 不在启动索引，同步查不到；调用方对 currency 走名称快照，不依赖此判断
      return false;
  }
}

/** 索引级本地化名称（成就系列索引只有当前语言单名，补成单语言 names）。currency 不在索引，返回 `undefined`。 */
export function entityNamesOf(module: ModuleKey, id: string): LocalizedNames | undefined {
  switch (module) {
    case 'character':
      return dal.getIndex('character').find((brief) => brief.id === id)?.names;
    case 'lightcone':
      return dal.getIndex('lightcone').find((brief) => brief.id === id)?.names;
    case 'relicset':
      return dal.getIndex('relicset').find((brief) => brief.id === id)?.names;
    case 'item':
      return dal.getIndex('item').find((brief) => brief.id === id)?.names;
    case 'monster':
      return dal.getIndex('monster').find((brief) => brief.groupKey === id)?.names;
    case 'achievementSeries': {
      const name = dal.getIndex('achievementSeries').find((brief) => brief.id === id)?.name;
      // 详情数据按语言各存一份，索引里的 name 就是当前包语言；四语言位填同一个值，
      // pickName 无论界面切到什么语言都能显示（换包后快照自然刷新）
      return name === undefined ? undefined : { zh: name, en: name, ja: name, ko: name };
    }
    case 'currencyRole':
    case 'currencyItem':
    case 'currencyBuff':
    case 'currencyAugment':
    case 'currencySpotlight':
    case 'currencyTrait':
      return undefined;
  }
}

/** 索引级图标相对路径（成就系列无图标，返回 `null`）。currency 不在索引，返回 `null`。 */
export function entityIconOf(module: ModuleKey, id: string): string | null {
  switch (module) {
    case 'character':
      return dal.getIndex('character').find((brief) => brief.id === id)?.icon ?? null;
    case 'lightcone':
      return dal.getIndex('lightcone').find((brief) => brief.id === id)?.icon ?? null;
    case 'relicset':
      return dal.getIndex('relicset').find((brief) => brief.id === id)?.icon ?? null;
    case 'item':
      return dal.getIndex('item').find((brief) => brief.id === id)?.icon ?? null;
    case 'monster':
      return dal.getIndex('monster').find((brief) => brief.groupKey === id)?.icon ?? null;
    case 'achievementSeries':
    case 'currencyRole':
    case 'currencyItem':
    case 'currencyBuff':
    case 'currencyAugment':
    case 'currencySpotlight':
    case 'currencyTrait':
      return null;
  }
}

/** 数字稀有度（仅角色/光锥/物品有；其余模块返回 `null` 由展示层给「无」）。currency 不在索引，返回 `null`。 */
export function entityRarityOf(module: ModuleKey, id: string): number | null {
  switch (module) {
    case 'character':
      return dal.getIndex('character').find((brief) => brief.id === id)?.rarity ?? null;
    case 'lightcone':
      return dal.getIndex('lightcone').find((brief) => brief.id === id)?.rarity ?? null;
    case 'item':
      return dal.getIndex('item').find((brief) => brief.id === id)?.rarity ?? null;
    case 'relicset':
    case 'monster':
    case 'achievementSeries':
    case 'currencyRole':
    case 'currencyItem':
    case 'currencyBuff':
    case 'currencyAugment':
    case 'currencySpotlight':
    case 'currencyTrait':
      return null;
  }
}
