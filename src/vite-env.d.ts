/// <reference types="vite/client" />

/**
 * Vite 环境变量类型扩展（架构文档 §8.2 `src/vite-env.d.ts`）
 *
 * Tauri 在构建期注入 `TAURI_ENV_*`，通过 `vite.config.ts` 的 `envPrefix` 暴露。
 */
declare global {
  interface ImportMetaEnv {
    /** 应用展示版本（来自 package.json，构建期注入，可选） */
    readonly VITE_APP_VERSION?: string;
    /** Tauri 目标平台，如 `windows` */
    readonly TAURI_ENV_PLATFORM?: string;
    /** Tauri 构建类型：`debug` | `release` */
    readonly TAURI_ENV_DEBUG?: string;
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }
}

export {};
