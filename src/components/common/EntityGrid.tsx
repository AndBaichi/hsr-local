/**
 * 列表页通用卡片（T04）
 *
 * 六个模块的列表长得不一样（角色有属性+命途、光锥有攻击力、敌人有弱点），
 * 但「图标 + 名称 + 副标题 + 标签 + 跳详情」这层完全一致，收在这里。
 *
 * 虚拟滚动：项目已装 `@tanstack/react-virtual`，但**没用**。索引最大只有 1606 条
 * （物品），卡片本身很矮；1606 张卡约 1.4 万个 DOM 节点，WebView2 实测一次性布局
 * ~80–130ms、滚动无 per-item JS，体感可接受（同一份量测见 `docs/02-architecture.md` §20）。
 *
 * v2.8 起列表**全量渲染、不分页**：虚拟滚动会让段头不在 DOM 里（字母条无法
 * `querySelector` 定位）、`Ctrl+F` 也搜不到屏幕外的条目，两个代价都比这点布局开销大。
 * 若将来数据包涨到数千条，再评估换成虚拟滚动 + 段偏移量跳转。
 */

import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';

import { openEntityContextMenu, type EntityMenuTarget } from '@/components/common/ContextMenu';
import { SafeImage } from '@/components/common/SafeImage';
import { rarityColor } from '@/lib/format';

/** 卡片属性 */
export interface EntityCardProps {
  /** 详情路由，如 `/characters/1001` */
  readonly to: string;
  /** 主标题（已本地化） */
  readonly title: string;
  /** 副标题（已本地化），一般是稀有度/类型 */
  readonly subtitle?: string;
  /** 数据包内图片相对路径 */
  readonly icon?: string | null;
  /** 稀有度 1–5，控制描边色与星标 */
  readonly rarity?: number;
  /** 右下角小标签，如「冰」「存护」 */
  readonly badges?: readonly (string | undefined)[];
  /** 右上角附加内容（收藏状态等） */
  readonly corner?: ReactNode;
  /** 图标容器为正方形时设 true（物品/遗器），人像设 false */
  readonly squareIcon?: boolean;
  /**
   * 右键菜单目标（v2.9）。传入后卡片右键弹出「打开详情/加入对比/加入收藏/记录笔记」，
   * 不传则保持原行为（无自定义菜单）。
   */
  readonly contextEntity?: EntityMenuTarget;
}

/** 稀有度星标 */
export function RarityStars({ rarity }: { readonly rarity: number }): ReactNode {
  if (!Number.isInteger(rarity) || rarity < 1) return null;
  return (
    <span
      className="text-xs tracking-tight"
      style={{ color: rarityColor(rarity) }}
      aria-label={`${rarity} star`}
    >
      {'★'.repeat(Math.min(5, rarity))}
    </span>
  );
}

/** 实体卡片 */
export function EntityCard({
  to,
  title,
  subtitle,
  icon,
  rarity,
  badges,
  corner,
  squareIcon = false,
  contextEntity,
}: EntityCardProps): ReactNode {
  const tags = (badges ?? []).filter((badge): badge is string => Boolean(badge));

  return (
    <Link
      to={to}
      onContextMenu={
        contextEntity === undefined
          ? undefined
          : (event) => openEntityContextMenu(contextEntity, event)
      }
      className="hsr-panel group flex min-w-0 gap-3 rounded-card border border-line p-3 transition-colors duration-fast hover:border-accent"
    >
      <SafeImage
        src={icon}
        alt={title}
        className={`shrink-0 rounded-btn ${squareIcon ? 'h-16 w-16' : 'h-20 w-16'}`}
        imgClassName="object-contain"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-start justify-between gap-2">
          <span className="truncate text-sm font-semibold text-ink group-hover:text-accent" title={title}>
            {title}
          </span>
          {corner}
        </div>
        {typeof rarity === 'number' ? <RarityStars rarity={rarity} /> : null}
        {subtitle ? <span className="truncate text-xs text-dim">{subtitle}</span> : null}
        {tags.length > 0 ? (
          <div className="mt-auto flex flex-wrap gap-1 pt-1">
            {tags.map((tag) => (
              <span key={tag} className="rounded-tag border border-line bg-elev px-1.5 py-[1px] text-[11px] text-dim">
                {tag}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </Link>
  );
}

/** 卡片网格 */
export function EntityGrid({
  children,
  className = '',
}: {
  readonly children: ReactNode;
  readonly className?: string;
}): ReactNode {
  return (
    <div
      className={`grid gap-3 ${className}`}
      style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}
    >
      {children}
    </div>
  );
}
