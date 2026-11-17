/**
 * 详情页页内锚点导航（架构文档 §8.7 SectionNav、PRD §4.2 角色详情「页内锚点导航」）
 *
 * T01 只落地「导航条 + 点击滚动 + 激活项高亮」这一层通用能力；
 * T04 的角色/光锥/敌人详情页直接传入各自的 section 列表即可。
 *
 * 激活项由调用方通过 `activeId` 传入（通常来自 IntersectionObserver），
 * 本组件不自行监听滚动，避免与列表虚拟滚动互相干扰。
 */

import type { ReactNode } from 'react';

/** 锚点项 */
export interface SectionNavItem {
  /** 目标区块的 DOM id */
  readonly id: string;
  /** 显示名（已翻译） */
  readonly label: string;
}

/** 页内锚点导航属性 */
export interface SectionNavProps {
  /** 锚点列表 */
  sections: readonly SectionNavItem[];
  /** 当前激活的锚点 id */
  activeId?: string;
  /** 外层附加类名 */
  className?: string;
  /** 自定义点击行为；默认滚动到对应 DOM 元素 */
  onNavigate?: (id: string) => void;
}

/**
 * 默认跳转：滚动到目标元素。
 *
 * 用 `scrollIntoView` 而不是改 `window.scrollTo`，
 * 因为内容滚动容器是 `<main>` 而不是 window。
 *
 * @param id 目标元素 id
 */
function defaultNavigate(id: string): void {
  if (typeof document === 'undefined') return;
  const element = document.getElementById(id);
  if (element) {
    element.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

/** 页内锚点导航 */
export function SectionNav({
  sections,
  activeId,
  className = '',
  onNavigate,
}: SectionNavProps): ReactNode {
  const navigate = onNavigate ?? defaultNavigate;

  if (sections.length === 0) return null;

  return (
    <nav
      aria-label="页内导航"
      className={`sticky top-0 z-10 -mx-1 flex flex-wrap items-center gap-1 border-b border-line bg-base px-1 py-2 ${className}`}
    >
      {sections.map((section) => {
        const active = section.id === activeId;
        return (
          <button
            key={section.id}
            type="button"
            onClick={() => navigate(section.id)}
            aria-current={active ? 'true' : undefined}
            className={[
              'rounded-btn px-3 py-1 text-sm transition-colors duration-fast',
              active
                ? 'bg-elev text-accent'
                : 'text-dim hover:bg-elev hover:text-ink',
            ].join(' ')}
          >
            {section.label}
          </button>
        );
      })}
    </nav>
  );
}
