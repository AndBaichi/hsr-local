/**
 * Provider 树（架构文档 §8.2 `src/App.tsx`）
 *
 * 顺序（架构文档 §2.2 约定 ②）：
 *   StyledEngineProvider injectFirst  →  emotion 先注入
 *   ThemeProvider                     →  MUI 主题（随 data-theme 切换整套调色板）
 *   CssBaseline                       →  只有 MUI 的基础重置（Tailwind preflight 已关闭）
 *   I18nextProvider                   →  显式注入实例，避免隐式全局依赖
 *   BootGuard                         →  启动三态门禁
 *   RouterProvider                    →  路由
 */

import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider, StyledEngineProvider } from '@mui/material/styles';
import { useMemo } from 'react';
import { I18nextProvider } from 'react-i18next';

import { BootGuard } from '@/components/common/BootGuard';
import { ClosePromptDialog } from '@/components/layout/ClosePromptDialog';
import { useBoot } from '@/hooks/useBoot';
import { useThemeMode } from '@/hooks/useThemeMode';
import i18n from '@/i18n';
import { AppRouter } from '@/router';
import { createAppTheme } from '@/theme/muiTheme';

/** 应用根组件 */
export function App(): React.ReactElement {
  const { resolved } = useThemeMode();
  // 数据层启动：等数据包就绪 + 一次读全索引（T03）
  const { run: bootDatapack } = useBoot();

  // 主题对象随 data-theme 变化重建；createTheme 的结果被 MUI 内部缓存，开销可忽略
  const theme = useMemo(() => createAppTheme(resolved), [resolved]);

  return (
    <StyledEngineProvider injectFirst>
      <ThemeProvider theme={theme}>
        <CssBaseline enableColorScheme />
        <I18nextProvider i18n={i18n}>
          <BootGuard boot={bootDatapack}>
            <AppRouter />
          </BootGuard>
          {/* 关窗询问弹窗挂在 BootGuard 之外：启动阶段点关闭按钮也要能问 */}
          <ClosePromptDialog />
        </I18nextProvider>
      </ThemeProvider>
    </StyledEngineProvider>
  );
}

export default App;
