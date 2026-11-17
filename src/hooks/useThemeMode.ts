/**
 * 主题编排（架构文档 §8.6 useThemeMode）
 *
 * 仅深色主题（浅色 / 跟随系统已按用户要求移除）。
 * 保留此 hook 是为了不破坏调用方（App / TopBar）的签名；
 * `resolved` 恒为 `dark`，`mode` 恒为 `dark`。
 *
 * 实现要点：主题只体现在 `<html data-theme="dark">` 一个属性上，
 * CSS 变量与 MUI 主题对象随之生效。
 */

import { useCallback, useEffect, useMemo } from 'react';

import type { ThemeMode, ThemeName } from '@/theme/tokens';

/**
 * 把主题名写到 `<html>`（`data-theme` + `color-scheme`）。
 *
 * @param name 实际生效的主题名（当前仅 dark）
 */
export function applyThemeToDocument(name: ThemeName): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (root.getAttribute('data-theme') !== name) {
    root.setAttribute('data-theme', name);
  }
  // 让滚动条、表单控件、原生 UI 一并跟随
  root.style.colorScheme = name;
}

/** 系统深/浅色查询（保留供向后兼容；当前恒深色） */
export function getSystemTheme(): ThemeName {
  return 'dark';
}

/**
 * 把主题模式解析为实际生效的主题名。
 *
 * @param mode 主题模式（当前仅 dark）
 */
export function resolveThemeName(mode: ThemeMode): ThemeName {
  return mode;
}

/** 主题模式 hook（仅深色） */
export function useThemeMode(): {
  mode: ThemeMode;
  resolved: ThemeName;
  setMode: (mode: ThemeMode) => void;
  cycleMode: () => void;
} {
  const mode: ThemeMode = 'dark';
  const resolved: ThemeName = 'dark';

  useEffect(() => {
    applyThemeToDocument(resolved);
  }, [resolved]);

  const setMode = useCallback((next: ThemeMode) => {
    // 仅深色；忽略任何其它值，但保持 no-op 以兼容调用方
    void next;
    applyThemeToDocument('dark');
  }, []);

  const cycleMode = useCallback(() => {
    // 无浅色可切，恒深色
    applyThemeToDocument('dark');
  }, []);

  return useMemo(
    () => ({ mode, resolved, setMode, cycleMode }),
    [mode, resolved, setMode, cycleMode],
  );
}
