/**
 * 关窗行为与托盘联动
 *
 * ## 行为矩阵
 *
 * | `prefs.closeAction` | 点标题栏关闭按钮 | 托盘「关闭」 |
 * |---------------------|------------------|--------------|
 * | `ask`（首次）        | 弹窗询问，选完记住 | 退出         |
 * | `tray`              | 冲刷数据 → 隐藏窗口 | 退出         |
 * | `quit`              | 冲刷数据 → 退出应用 | 退出         |
 *
 * ## 为什么要拦截关窗自己做
 *
 * 1. `prefs` 的写盘有 300ms 防抖、笔记有 600ms 防抖。直接关窗可能丢掉最后一次输入，
 *    所以关窗前必须**阻塞式**冲刷一遍（原先这段逻辑在 `lib/ipc/userdata.ts`，
 *    现在因为要插入「询问 / 隐藏」分支，独立到这里）。
 * 2. 从托盘退出时窗口可能是隐藏的，前端仍活着（webview 没销毁），
 *    因此 Rust 侧不直接 `exit`，而是 `emit("hsr://quit-request")` 让前端先冲刷，
 *    前端冲完再调 `quit_app`。Rust 里另有一个 1.5s 看门狗兜底，防止前端卡死关不掉。
 *
 * ## 为什么不用 `getCurrentWindow().hide()`
 *
 * 那需要 `core:window:allow-hide` 权限；走自定义命令可以让 capabilities 维持最小集。
 */

import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';

import i18n from '@/i18n';
import { hideMainWindow, quitApp, setTrayLabels } from '@/lib/ipc/appWindow';
import { flushUserData } from '@/lib/ipc/userdata';
import { useClosePromptStore } from '@/stores/closePrompt';
import { flushPrefs, getPrefsSnapshot, useSettingsStore } from '@/stores/settings';

/** 关窗冲刷的兜底超时（ms）：IPC 卡死也不能让窗口关不掉 */
const FLUSH_TIMEOUT_MS = 2000;

/** 钩子是否已安装（重复调用只生效一次） */
let installed = false;

/** 上一次同步过托盘文案的语言（避免每次 prefs 变动都打一次 IPC） */
let trayLang: string | null = null;

/** 关窗裁决结果：`cancel` = 这次关窗作废 */
type CloseDecision = 'tray' | 'quit' | 'cancel';

/**
 * 判断是否运行在 Tauri 里（浏览器直开 vite 时没有 IPC / 窗口 API）。
 */
function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** 简单延时 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 同步托盘菜单文案到当前界面语言。
 *
 * 托盘菜单是 Rust 侧的原生菜单，拿不到 i18n，所以由前端把译文推过去。
 */
async function syncTrayLabels(): Promise<void> {
  const lang = getPrefsSnapshot().lang;
  if (lang === trayLang) return;
  trayLang = lang;
  try {
    await setTrayLabels(i18n.t('tray.show'), i18n.t('tray.quit'));
  } catch (error) {
    // 托盘没建起来（或已退出）时不该影响主流程
    if (import.meta.env.DEV) {
      console.warn('[window] 托盘文案同步失败', error);
    }
  }
}

/**
 * 冲刷所有挂起的用户数据写入。
 *
 * 两步：先让 `prefs` 的防抖计时器立即落地（它在 store 里，不在 userdata 队列中），
 * 再冲 userdata 队列；整体有 2s 上限。
 */
async function flushBeforeExit(): Promise<void> {
  try {
    flushPrefs(getPrefsSnapshot());
  } catch (error) {
    if (import.meta.env.DEV) console.warn('[window] prefs 冲刷失败', error);
  }
  try {
    await Promise.race([flushUserData(), delay(FLUSH_TIMEOUT_MS)]);
  } catch (error) {
    if (import.meta.env.DEV) console.warn('[window] userdata 冲刷失败', error);
  }
}

/**
 * 决定这次关窗要做什么。
 *
 * 未询问过 → 弹窗；用户取消 → `cancel`（这次关窗作废，窗口留着）。
 */
async function decideClose(): Promise<CloseDecision> {
  const { closeAction } = getPrefsSnapshot();
  if (closeAction === 'tray' || closeAction === 'quit') return closeAction;

  const answer = await useClosePromptStore.getState().request();
  if (answer === 'cancel') return 'cancel';
  // 记住选择：下次关窗不再询问（可在设置里改回来）
  useSettingsStore.getState().setCloseAction(answer);
  return answer;
}

/**
 * 安装关窗拦截与托盘退出监听（只生效一次）。
 */
export function installWindowBehavior(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  // 仅 Tauri 环境有窗口/事件 API；浏览器直开 vite 时跳过
  if (!isTauri()) return;

  void getCurrentWindow()
    .onCloseRequested(async (event) => {
      // 一律先拦下来：要不要真的关，由 decideClose 决定
      event.preventDefault();
      try {
        const decision = await decideClose();
        if (decision === 'cancel') return;
        await flushBeforeExit();
        if (decision === 'tray') {
          await hideMainWindow();
        } else {
          await quitApp();
        }
      } catch (error) {
        if (import.meta.env.DEV) {
          console.warn('[window] 关窗处理失败', error);
        }
        // 兜底：任何一步出错都不能让窗口"关不掉"（用户会以为程序卡死）。
        // 这里不再依赖 `core:window:allow-destroy`，统一走退出命令。
        try {
          await quitApp();
        } catch {
          // 连命令都调不通就只能保持现状，至少不会崩
        }
      }
    })
    .catch((error: unknown) => {
      if (import.meta.env.DEV) {
        console.warn('[window] 注册关窗拦截失败', error);
      }
    });

  // 托盘「关闭」：Rust 只发信号，冲刷完再由前端真正退出
  void listen('hsr://quit-request', async () => {
    await flushBeforeExit();
    await quitApp();
  }).catch((error: unknown) => {
    if (import.meta.env.DEV) {
      console.warn('[window] 注册托盘退出监听失败', error);
    }
  });

  // 托盘文案跟随语言；启动时先同步一次
  void syncTrayLabels();
  useSettingsStore.subscribe((state) => {
    if (state.prefs.lang === trayLang) return;
    void syncTrayLabels();
  });
}
