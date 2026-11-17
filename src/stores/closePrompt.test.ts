/**
 * 关窗询问 store 的单元测试
 *
 * 这里验证的是「异步阻塞」那套协议：关窗处理器在等 Promise，弹窗负责回填。
 * 三个用例都对应真实会发生的场景（正常选择 / 连点关闭 / 误触回填）。
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { useClosePromptStore } from './closePrompt';

/** 清掉上一个用例可能遗留的等待者，保证用例之间互不影响 */
function reset(): void {
  useClosePromptStore.getState().answer('cancel');
  useClosePromptStore.setState({ open: false });
}

describe('useClosePromptStore', () => {
  beforeEach(reset);

  it('request 打开弹窗，answer 后 promise 落地并关闭弹窗', async () => {
    const promise = useClosePromptStore.getState().request();
    expect(useClosePromptStore.getState().open).toBe(true);

    useClosePromptStore.getState().answer('tray');

    await expect(promise).resolves.toBe('tray');
    expect(useClosePromptStore.getState().open).toBe(false);
  });

  it('弹窗已开着时再 request 立即得到 cancel（连点关闭不会抢同一次询问）', async () => {
    const first = useClosePromptStore.getState().request();
    await expect(useClosePromptStore.getState().request()).resolves.toBe('cancel');

    useClosePromptStore.getState().answer('quit');
    await expect(first).resolves.toBe('quit');
  });

  it('没有等待者时 answer 是空操作，不抛错', () => {
    expect(() => {
      useClosePromptStore.getState().answer('quit');
    }).not.toThrow();
    expect(useClosePromptStore.getState().open).toBe(false);
  });
});
