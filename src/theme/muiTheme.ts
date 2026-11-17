/**
 * MUI 主题工厂（架构文档 §8.2、§2.2）
 *
 * 设计要点：
 *  1. 颜色取自 `tokens.ts`（`tokens.css` 的 JS 镜像），随 `data-theme` 切换整套主题对象。
 *  2. 排版、圆角、间距与 Tailwind 的 4px 网格对齐，避免两套体系视觉漂移。
 *  3. **不在业务代码里用 `sx` 改颜色/间距**（架构文档 §2.2 约定 ①），
 *     因此这里把交互类组件的默认样式一次性收敛好。
 */

import { createTheme } from '@mui/material/styles';
import type { Theme } from '@mui/material/styles';

import { DURATION, FONT_SIZE, THEME_TOKENS, type ThemeName } from '@/theme/tokens';

/** MUI 字体栈：与 `--hsr-font-sans` 完全一致 */
const FONT_FAMILY =
  "'HarmonyOS Sans SC', 'Microsoft YaHei UI', 'Inter', 'Segoe UI', system-ui, -apple-system, 'Noto Sans CJK SC', 'Source Han Sans SC', sans-serif";

/**
 * 创建一套完整的 MUI 主题。
 *
 * @param mode `dark`（默认）或 `light`
 * @returns 可直接传给 `<ThemeProvider theme={...}>` 的主题对象
 */
export function createAppTheme(mode: ThemeName): Theme {
  const c = THEME_TOKENS[mode];
  const dark = mode === 'dark';

  return createTheme({
    palette: {
      mode,
      primary: {
        main: c.accent,
        // 冰蓝底色上用深色文字保证对比度（WCAG AA）
        contrastText: dark ? '#06121A' : '#FFFFFF',
      },
      secondary: {
        main: c.accent2,
        contrastText: dark ? '#0B0E14' : '#FFFFFF',
      },
      error: {
        main: c.danger,
        contrastText: dark ? '#1A0909' : '#FFFFFF',
      },
      warning: {
        main: c.gold,
        contrastText: dark ? '#1A1305' : '#FFFFFF',
      },
      success: {
        main: '#4ADE80',
        contrastText: dark ? '#06180D' : '#FFFFFF',
      },
      info: {
        main: c.accent,
        contrastText: dark ? '#06121A' : '#FFFFFF',
      },
      background: {
        default: c.bg,
        paper: c.panel,
      },
      text: {
        primary: c.text,
        secondary: c.textDim,
        disabled: dark ? '#5A6577' : '#9AA4B4',
      },
      divider: c.line,
      action: {
        active: c.text,
        hover: c.hover,
        selected: c.active,
        focus: c.accentSoft,
        disabled: dark ? '#4A5464' : '#B4BCCA',
        disabledBackground: dark ? '#1B2431' : '#E9EDF4',
      },
      grey: dark
        ? {
            50: '#0B0E14',
            100: '#131A24',
            200: '#1B2431',
            300: '#232E3D',
            400: '#2B3646',
            500: '#3A4759',
            600: '#5A6577',
            700: '#8B96A8',
            800: '#C2CBD9',
            900: '#E7ECF4',
          }
        : {
            50: '#F6F8FB',
            100: '#EEF2F8',
            200: '#E1E7F0',
            300: '#CBD4E1',
            400: '#B4BCCA',
            500: '#9AA4B4',
            600: '#7A8496',
            700: '#5B6577',
            800: '#2C3644',
            900: '#141B26',
          },
    },

    shape: {
      borderRadius: 8,
    },

    typography: {
      fontFamily: FONT_FAMILY,
      fontSize: FONT_SIZE.base,
      htmlFontSize: 16,
      fontWeightLight: 300,
      fontWeightRegular: 400,
      fontWeightMedium: 500,
      fontWeightBold: 600,
      h1: { fontSize: FONT_SIZE['3xl'], fontWeight: 600, lineHeight: 1.25, letterSpacing: '-0.01em' },
      h2: { fontSize: FONT_SIZE['2xl'], fontWeight: 600, lineHeight: 1.3, letterSpacing: '-0.005em' },
      h3: { fontSize: FONT_SIZE.xl, fontWeight: 600, lineHeight: 1.35 },
      h4: { fontSize: FONT_SIZE.lg, fontWeight: 600, lineHeight: 1.4 },
      h5: { fontSize: FONT_SIZE.md, fontWeight: 600, lineHeight: 1.45 },
      h6: { fontSize: FONT_SIZE.base, fontWeight: 600, lineHeight: 1.5 },
      subtitle1: { fontSize: FONT_SIZE.md, fontWeight: 500, lineHeight: 1.5 },
      subtitle2: { fontSize: FONT_SIZE.base, fontWeight: 500, lineHeight: 1.5 },
      body1: { fontSize: FONT_SIZE.base, lineHeight: 1.6 },
      body2: { fontSize: FONT_SIZE.sm, lineHeight: 1.6 },
      caption: { fontSize: FONT_SIZE.xs, lineHeight: 1.5 },
      overline: { fontSize: FONT_SIZE['2xs'], lineHeight: 1.6, letterSpacing: '0.08em' },
      button: { fontSize: FONT_SIZE.base, fontWeight: 500, textTransform: 'none', letterSpacing: 0 },
    },

    transitions: {
      duration: {
        shortest: DURATION.fast,
        shorter: DURATION.fast,
        short: DURATION.base,
        standard: DURATION.base,
        complex: DURATION.base,
        enteringScreen: DURATION.base,
        leavingScreen: DURATION.fast,
      },
      easing: {
        easeOut: 'cubic-bezier(0.2, 0, 0, 1)',
        easeIn: 'cubic-bezier(0.4, 0, 1, 1)',
        easeInOut: 'cubic-bezier(0.4, 0, 0.2, 1)',
        sharp: 'cubic-bezier(0.4, 0, 0.6, 1)',
      },
    },

    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            backgroundColor: c.bg,
            color: c.text,
          },
        },
      },
      MuiPaper: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          root: {
            backgroundImage: 'none',
            border: `1px solid ${c.line}`,
          },
        },
      },
      MuiButton: {
        defaultProps: { disableElevation: true, size: 'small' },
        styleOverrides: {
          root: {
            borderRadius: 8,
            minHeight: 30,
            paddingInline: 12,
            transition: `background-color ${DURATION.fast}ms var(--hsr-ease), border-color ${DURATION.fast}ms var(--hsr-ease)`,
          },
          sizeSmall: { fontSize: FONT_SIZE.base },
        },
      },
      MuiIconButton: {
        defaultProps: { size: 'small' },
        styleOverrides: {
          root: { borderRadius: 8, color: c.textDim },
        },
      },
      MuiTooltip: {
        defaultProps: { arrow: true, enterDelay: 400, leaveDelay: 0 },
        styleOverrides: {
          tooltip: {
            backgroundColor: dark ? '#1B2431' : '#2C3644',
            color: '#E7ECF4',
            border: `1px solid ${dark ? c.line : '#3A4759'}`,
            fontSize: FONT_SIZE.sm,
            borderRadius: 6,
            padding: '4px 8px',
          },
          arrow: { color: dark ? '#1B2431' : '#2C3644' },
        },
      },
      MuiMenu: {
        styleOverrides: {
          paper: {
            backgroundColor: c.panel,
            border: `1px solid ${c.line}`,
            borderRadius: 10,
            boxShadow: dark ? '0 18px 48px rgba(0,0,0,.45)' : '0 18px 48px rgba(20,27,38,.16)',
            minWidth: 168,
          },
          list: { paddingTop: 4, paddingBottom: 4 },
        },
      },
      MuiMenuItem: {
        styleOverrides: {
          root: {
            fontSize: FONT_SIZE.base,
            minHeight: 34,
            gap: 8,
            '&.Mui-selected': { backgroundColor: c.active },
            '&.Mui-selected:hover': { backgroundColor: c.active },
          },
        },
      },
      MuiDivider: {
        styleOverrides: {
          root: { borderColor: c.line },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: { borderRadius: 6, fontSize: FONT_SIZE.sm, height: 22 },
          label: { paddingInline: 8 },
        },
      },
      MuiTabs: {
        styleOverrides: {
          indicator: { height: 2, borderRadius: 2 },
        },
      },
      MuiTab: {
        styleOverrides: {
          root: {
            textTransform: 'none',
            minHeight: 38,
            fontSize: FONT_SIZE.base,
            fontWeight: 500,
          },
        },
      },
      MuiSwitch: {
        styleOverrides: {
          root: { padding: 8 },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: {
            backgroundColor: c.panel,
            border: `1px solid ${c.line}`,
            borderRadius: 12,
            backgroundImage: 'none',
          },
        },
      },
      MuiDrawer: {
        styleOverrides: {
          paper: {
            backgroundColor: c.panel,
            borderLeft: `1px solid ${c.line}`,
            backgroundImage: 'none',
          },
        },
      },
      MuiSkeleton: {
        styleOverrides: {
          root: { backgroundColor: dark ? 'rgba(255,255,255,0.05)' : 'rgba(20,27,38,0.06)' },
        },
      },
      MuiSnackbarContent: {
        styleOverrides: {
          root: {
            backgroundColor: c.elev,
            color: c.text,
            border: `1px solid ${c.line}`,
            borderRadius: 8,
            fontSize: FONT_SIZE.base,
          },
        },
      },
      MuiTextField: {
        defaultProps: { size: 'small' },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            borderRadius: 8,
            backgroundColor: dark ? 'rgba(255,255,255,0.02)' : '#FFFFFF',
            fontSize: FONT_SIZE.base,
          },
          notchedOutline: { borderColor: c.line },
        },
      },
      MuiLink: {
        defaultProps: { underline: 'hover' },
      },
    },
  });
}
