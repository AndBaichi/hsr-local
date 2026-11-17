/**
 * i18next 初始化（架构文档 §8.3、§11.4）
 *
 * 约定：
 *  - `zh.json` 是 key 的唯一权威，`types.d.ts` 由它推导 key 类型 → 漏 key 编译期报错。
 *  - **不做回退到 en**：四语言文案完整（Q3）。仅实体数据缺失语言时回退 `zh`。
 *  - 实体数据语言与 UI 语言共用同一个 `lang`（PRD P0-03「同步切换」），
 *    因此切换语言时同时写 `<html lang>` 与 `<html data-lang>`。
 *  - 文案资源全部静态 import，随 bundle 打包 → 运行期零网络请求（PRD §7.2）。
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from '@/i18n/locales/en.json';
import ja from '@/i18n/locales/ja.json';
import ko from '@/i18n/locales/ko.json';
import zh from '@/i18n/locales/zh.json';

/** 支持的四种语言（顺序即界面展示顺序） */
export const SUPPORTED_LANGUAGES = ['zh', 'en', 'ja', 'ko'] as const;

/** 语言代码 */
export type Lang = (typeof SUPPORTED_LANGUAGES)[number];

/** 默认语言：简体中文 */
export const DEFAULT_LANGUAGE: Lang = 'zh';

/** 语言选择器的展示信息（自身语言名，不翻译） */
export interface LanguageOption {
  /** ISO 语言代码 */
  readonly value: Lang;
  /** 该语言的自称 */
  readonly nativeLabel: string;
  /** BCP-47，写入 `<html lang>` */
  readonly htmlLang: string;
}

/** 四语言元信息 */
export const LANGUAGE_OPTIONS: Readonly<Record<Lang, LanguageOption>> = {
  zh: { value: 'zh', nativeLabel: '简体中文', htmlLang: 'zh-CN' },
  en: { value: 'en', nativeLabel: 'English', htmlLang: 'en' },
  ja: { value: 'ja', nativeLabel: '日本語', htmlLang: 'ja' },
  ko: { value: 'ko', nativeLabel: '한국어', htmlLang: 'ko' },
};

/** 语言选择器渲染顺序 */
export const LANGUAGE_ORDER: readonly Lang[] = SUPPORTED_LANGUAGES;

/**
 * 类型守卫：判断任意字符串是否是受支持的语言。
 *
 * @param value 待判定值
 */
export function isLang(value: unknown): value is Lang {
  return typeof value === 'string' && (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

/**
 * 把任意语言标记归一化为受支持的语言代码。
 *
 * 兼容 `zh-CN` / `zh-Hans` / `en-US` / 大小写混杂 等来源，
 * 无法识别时返回默认语言。
 *
 * @param raw 原始语言标记（可能来自系统、旧版本 prefs 或 URL）
 */
export function normalizeLang(raw: unknown): Lang {
  if (typeof raw !== 'string') return DEFAULT_LANGUAGE;
  const lower = raw.trim().toLowerCase();
  const base = lower.split(/[-_]/)[0] ?? '';
  return isLang(base) ? base : DEFAULT_LANGUAGE;
}

/** 把语言代码同步到 `<html>`，供 CSS 字体回退与屏幕阅读器使用 */
function applyDocumentLanguage(lang: Lang): void {
  if (typeof document === 'undefined') return;
  const option = LANGUAGE_OPTIONS[lang];
  document.documentElement.setAttribute('lang', option.htmlLang);
  // 实体数据语言与 UI 语言共用，选择器统一读 data-lang
  document.documentElement.setAttribute('data-lang', lang);
}

/**
 * 初始化 i18next。必须在首次渲染前 `await` 完成，
 * 否则首帧会出现 key 原文（PRD §7.1「首屏 ≤1s 且无闪烁」）。
 *
 * @param initialLang 从持久化偏好中读到的初始语言
 */
export async function initI18n(initialLang: Lang): Promise<void> {
  if (i18n.isInitialized) {
    await i18n.changeLanguage(initialLang);
    applyDocumentLanguage(initialLang);
    return;
  }

  await i18n.use(initReactI18next).init({
    resources: {
      zh: { translation: zh },
      en: { translation: en },
      ja: { translation: ja },
      ko: { translation: ko },
    },
    lng: initialLang,
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: SUPPORTED_LANGUAGES as unknown as string[],
    defaultNS: 'translation',
    ns: ['translation'],
    interpolation: {
      // React 自身会转义，双重转义会把 & < > 显示成实体
      escapeValue: false,
    },
    returnNull: false,
    react: {
      useSuspense: false,
    },
    saveMissing: false,
    missingKeyHandler: (lngs, ns, key) => {
      if (import.meta.env.DEV) {
        console.warn(`[i18n] 缺少文案 key: ${key} (ns=${ns}, lng=${lngs.join(',')})`);
      }
    },
  });

  applyDocumentLanguage(initialLang);
}

/**
 * 切换语言（UI 文案 + 实体数据语言同步）。
 *
 * @param lang 目标语言
 */
export async function setI18nLanguage(lang: Lang): Promise<void> {
  if (i18n.language === lang) {
    applyDocumentLanguage(lang);
    return;
  }
  await i18n.changeLanguage(lang);
  applyDocumentLanguage(lang);
}

/** 当前生效语言（已归一化） */
export function currentLang(): Lang {
  return normalizeLang(i18n.language);
}

export default i18n;
