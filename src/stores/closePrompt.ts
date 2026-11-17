/**
 * 首次关窗询问的弹窗状态
 *
 * 用户要求：第一次点关闭按钮时问一句「以后直接退出，还是收纳至托盘」，
 * 选完记住。询问本身是一次「异步的阻塞」——关窗处理器必须等用户回答后
 * 才知道该隐藏还是该退出，所以这里用 Promise + store 组合：
 *
 *  - `request()` 由**关窗处理器**调用，返回一个 Promise，同时把弹窗置为可见；
 *  - `answer()` 由**弹窗组件**调用，回填选择并让上面的 Promise 落地。
 *
 * 同一时刻只允许一个弹窗：连点关闭按钮时，第二次直接得到 `cancel`（放弃这次关窗），
 * 避免两个 Promise 抢同一个 `pending` 回调。
 */

import { create } from 'zustand';

/** 用户在弹窗里的选择 */
export type CloseAnswer = 'tray' | 'quit' | 'cancel';

/** 弹窗状态与动作 */
export interface ClosePromptState {
  /** 弹窗是否可见 */
  readonly open: boolean;
  /** 请求一次询问（已开着就直接返回 `cancel`） */
  readonly request: () => Promise<CloseAnswer>;
  /** 回填用户的选择 */
  readonly answer: (choice: CloseAnswer) => void;
}

/** 当前等待中的应答回调；`null` 表示没有弹窗在等 */
let pending: ((choice: CloseAnswer) => void) | null = null;

export const useClosePromptStore = create<ClosePromptState>()((set) => ({
  open: false,

  request: () => {
    if (pending !== null) return Promise.resolve<CloseAnswer>('cancel');
    set({ open: true });
    return new Promise<CloseAnswer>((resolve) => {
      pending = (choice) => {
        pending = null;
        set({ open: false });
        resolve(choice);
      };
    });
  },

  answer: (choice) => {
    pending?.(choice);
  },
}));
