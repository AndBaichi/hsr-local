import { fileURLToPath, URL } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Tauri 会把窗口指向一个固定端口，且会在 `tauri dev` 时把
 * `TAURI_DEV_HOST` 传进来（真机/多网卡场景）。这里保持与 Tauri 模板一致的行为。
 */
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],

  resolve: {
    // 与 tsconfig.json 的 `paths` 必须保持完全一致（架构文档 §11.2）
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },

  // 让 Tauri CLI 的输出不被 Vite 清屏覆盖，便于排查工具链问题
  clearScreen: false,

  server: {
    port: 1420,
    strictPort: true,
    host: host || '127.0.0.1',
    // `public/datapack`（约 80MB 数据包）在 dev 下由 Vite 直接 serve，
    // 需要显式允许项目根目录作为 fs 白名单。
    fs: {
      allow: [fileURLToPath(new URL('.', import.meta.url))],
    },
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },

  build: {
    // WebView2 Evergreen 的内核版本远高于此，固定 target 可避免多余的降级转译
    target: 'chrome110',
    // 数据包不进 web bundle：它作为 Tauri resource / 静态资源存在（架构文档 §1.3）
    copyPublicDir: false,
    sourcemap: Boolean(process.env.TAURI_ENV_DEBUG),
    chunkSizeWarningLimit: 1500,
  },

  envPrefix: ['VITE_', 'TAURI_ENV_'],
});
