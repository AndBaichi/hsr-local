/**
 * 启动编排（T03）
 *
 * 把「等数据包就绪 → 读全索引 → 切语言」这套顺序收在一处，交给 `<BootGuard>` 驱动。
 * `BootGuard` 在 T01 就设计成「通过可注入的 `boot` 任务工作」，这里正好接上，
 * 组件本身一行都不用改（当时那句注释没有落空）。
 *
 * ## 为什么 boot 只跑一次、而语言用 effect 单独同步
 *
 * 索引与语言无关（brief 里 4 种语言都有），换语言只需要重读详情——
 * 那是 `dal.setLang()` 的事。所以 `run` 的依赖里刻意没有 `lang`，
 * 避免用户一切语言就把整个应用打回骨架屏。
 */

import { useCallback, useEffect, useState } from 'react';

import { getPrefsSnapshot, hydratePrefsFromUserdata, useSettingsStore, writePersistedPrefs } from '@/stores/settings';
import { useFavoritesStore } from '@/stores/favorites';
import { useNotesStore } from '@/stores/notes';
import { useRatingsStore } from '@/stores/ratings';
import { installUserDataFlushHooks } from '@/lib/ipc/userdata';
import { installWindowBehavior } from '@/lib/windowBehavior';
import { dal, type BootInfo, type BootProgress } from '@/lib/data/dal';

/** `useBoot` 的返回 */
export interface UseBootResult {
  /** 传给 `<BootGuard boot={...}>` 的任务；抛错即进入错误页 */
  run: () => Promise<void>;
  /** 最近一次启动进度（首启解包时有用，T04 的进度界面会消费它） */
  progress: BootProgress | null;
  /** 就绪后的数据包信息 */
  info: BootInfo | undefined;
}

/**
 * 启动数据层。
 *
 * 顺序（前三步都是"用户数据"，与数据包无关，所以放在前面）：
 *  1. 装退出前冲刷钩子（笔记 600ms 防抖的兜底）
 *  2. 从 `prefs.json` 水合偏好（仅当 localStorage 为空，即"用户数据迁移"场景）
 *  3. 读收藏 / 笔记（UI 需要它们决定收藏按钮状态）
 *  4. 等数据包就绪 + 一次读全索引
 *
 * @returns 启动任务与进度
 */
export function useBoot(): UseBootResult {
  const lang = useSettingsStore((state) => state.prefs.lang);
  const [progress, setProgress] = useState<BootProgress | null>(null);
  const [info, setInfo] = useState<BootInfo | undefined>(undefined);

  const run = useCallback(async (): Promise<void> => {
    setProgress(null);

    installUserDataFlushHooks();
    // 关窗行为（询问 / 收纳至托盘 / 退出）与托盘联动，同样只装一次
    installWindowBehavior();
    await hydratePrefsFromUserdata();
    // 启动时把当前偏好回写一次：保证 `prefs.json` 一定存在（用户从不改设置时也有文件可备份/迁移）
    writePersistedPrefs(getPrefsSnapshot());
    await Promise.all([
      useFavoritesStore.getState().hydrate(),
      useNotesStore.getState().hydrate(),
      // 评级徽标在货币战争列表首屏就要显示，必须与收藏同批水合，否则会先闪一屏 `-`
      useRatingsStore.getState().hydrate(),
    ]);

    // 语言从 store 现取：水合可能刚把它改掉，而 `lang` 闭包值是首次渲染时的旧值。
    // 这也是 `run` 的依赖里不需要 `lang` 的原因（否则切语言会把应用打回骨架屏）。
    const bootInfo = await dal.boot({
      lang: getPrefsSnapshot().lang,
      onProgress: (next) => {
        setProgress(next);
      },
    });
    setInfo(bootInfo);
  }, []);

  // 语言变更 → 只让数据层换目录，不重启应用
  useEffect(() => {
    dal.setLang(lang);
  }, [lang]);

  return { run, progress, info };
}
