/**
 * 右侧字母索引条（PRD §4.9，v2.17 改为纯指示器）
 *
 * 形态对齐手机音乐 App 的 A–Z 索引：贴右边缘竖排、当前字母高亮成气泡。
 *
 * ## 为什么不再可点/可拖
 *
 * 用户反馈：字母条「作为滚动条」的点击跳转/按住拖动会误触，要求保留字母显示、
 * 但关掉它的滚动功能。所以这里只保留**位置指示**：
 *  - 当前分组字母高亮，滚动时跟着变；
 *  - 没有条目的字母置灰；
 *  - `pointer-events-none`：不接收点击/拖动，也不会挡住右侧的滚动条与卡片。
 *
 * 滚动仍然用滚轮、触控板或真正的滚动条完成。
 */

import type { ReactNode } from 'react';

/** 索引条属性 */
export interface IndexBarProps {
  /** 要显示的符号（按序，含末尾的 `#`） */
  readonly symbols: readonly string[];
  /** 有条目的符号（其余置灰） */
  readonly available: ReadonlySet<string>;
  /** 当前滚动位置对应的符号 */
  readonly active: string | null;
}

/** 单个符号的行高（px） */
const ROW_HEIGHT = 13;

/** 右侧字母索引条（纯展示） */
export function IndexBar({ symbols, available, active }: IndexBarProps): ReactNode {
  return (
    <div
      // `right-4`：全局滚动条是 10px（`::-webkit-scrollbar`），贴 `right-2` 会被压住一半；
      // 16px 宽正好落在内容区右 padding（32px）之内，不压卡片
      className="pointer-events-none fixed right-4 top-1/2 z-30 hidden -translate-y-1/2 select-none lg:block"
      aria-hidden="true"
    >
      <div className="flex flex-col items-center">
        {symbols.map((symbol) => {
          const usable = available.has(symbol);
          const isActive = active === symbol;
          return (
            <div
              key={symbol}
              className="relative m-0 flex w-4 items-center justify-center"
              style={{ height: ROW_HEIGHT }}
            >
              {isActive ? (
                // 气泡只做视觉，不占布局（absolute + 负边距），避免整列抖动
                <span className="absolute -inset-x-1.5 -inset-y-0.5 rounded-full bg-accent/25" />
              ) : null}
              <span
                className={`relative text-[10px] leading-none ${
                  isActive ? 'font-semibold text-accent' : usable ? 'text-dim' : 'text-dim opacity-25'
                }`}
              >
                {symbol}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
