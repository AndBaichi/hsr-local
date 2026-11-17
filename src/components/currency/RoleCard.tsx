/**
 * 角色图鉴的专属卡片（对齐原站 `/currency/role` 的版式）
 *
 * ## 为什么单独一个组件，不用通用卡片
 *
 * 通用卡片是「16:20 小图 + 名称 + `#id` + 两行描述 + 前后排/职业徽标」，那是给
 * 装备 / 增益 / 投资环境这类"读文字"的条目用的。角色图鉴的数据里**根本没有描述**
 * （`desc` / `simple_desc` 都不存在），硬套通用卡片的结果是每张卡都挂一句
 * 「暂无描述」，而且 `#id`、`front_back_type` 徽标原站也不显示。
 *
 * 原站的角色卡是标准的「抽卡立绘卡」：3:4 竖版图区（深色底 + `object-contain`
 * 保证立绘完整）+ 最多两行的名字 + 星级。这里照抄这个结构。
 *
 * ## 名字的两个特例
 *
 * `604202`（帕姆王）的 `name` 是 `null`、头像原站就 404；`8007` / `8009` /
 * `800902` 的 `name` 字面是 `{NICKNAME}`。三者都交给
 * {@link currencyDisplayName} 统一处理，卡片这里不做任何 id 判断 —— 否则
 * 「卡片显示帕姆王、详情显示 604202」这类不一致会再次出现。
 */

import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { RarityStars } from '@/components/common/EntityGrid';
import { SafeImage } from '@/components/common/SafeImage';
import {
  currencyDisplayName,
  currencyIconCandidates,
  type CurrencyEntry,
} from '@/lib/data/extra';

/** 角色卡片属性 */
export interface RoleCardProps {
  /** 角色条目 */
  readonly entry: CurrencyEntry;
  /** 打开角色详情页（`/currency/role/:id`，由调用方决定跳转方式） */
  readonly onOpen: () => void;
  /** 右上角操作区（两枚评级徽标），由调用方决定 */
  readonly actions?: ReactNode;
  /** 右键菜单（由调用方上报实体，加入对比/收藏/笔记） */
  readonly onContextMenu?: (event: React.MouseEvent) => void;
}

/**
 * 角色卡片。
 *
 * @param props 见 {@link RoleCardProps}
 */
export function RoleCard({ entry, onOpen, actions, onContextMenu }: RoleCardProps): ReactNode {
  const { t } = useTranslation();
  const name = currencyDisplayName(entry, 'role', t);
  const candidates = currencyIconCandidates(entry, 'role');

  return (
    <div className="relative h-full" onContextMenu={onContextMenu}>
      <button
        type="button"
        onClick={onOpen}
        className="hsr-panel group flex h-full w-full flex-col overflow-hidden rounded-card border border-line text-left transition-colors duration-fast hover:border-accent"
      >
        {/*
          图区：原站是 aspect-[3/4] + bg-black/35 + object-contain。
          `pt-6` 是给右上角两枚评级徽标让位（原站没有评级功能，我们有）——
          徽标高约 22px 且贴在 top-2，直接把脸压住不划算，所以顶部留一条深色空带。
          底色用 `bg-elev` 而不是原站的 `bg-black/35`：SafeImage 的容器自带 `bg-elev`
          （给 object-contain 的留白与缺图占位用），两者不同色会在顶部空带处露出一条接缝。
        */}
        <div className="relative aspect-[3/4] w-full overflow-hidden bg-elev pt-6">
          <SafeImage
            src={candidates[0]}
            fallbacks={candidates.slice(1)}
            alt={name}
            className="h-full w-full"
            imgClassName="object-contain p-2 transition duration-300 group-hover:scale-[1.03]"
          />
        </div>
        {/* min-h-[2.25rem] + line-clamp-2：一行名与两行名的卡片高度一致，网格不会参差 */}
        <div className="space-y-1 p-2.5">
          <div
            className="line-clamp-2 min-h-[2.25rem] break-words text-sm font-semibold text-ink"
            title={name}
          >
            {name}
          </div>
          {typeof entry.rarity === 'number' ? <RarityStars rarity={entry.rarity} /> : null}
        </div>
      </button>
      {/* 徽标是卡片的兄弟节点：button 里不能再嵌 button。tier 在左、grade 在右 */}
      {actions !== undefined ? (
        <div className="absolute right-2 top-2 z-[2] flex items-center gap-1">{actions}</div>
      ) : null}
    </div>
  );
}
