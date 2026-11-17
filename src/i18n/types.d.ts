import type zhTranslation from './locales/zh.json';

/**
 * 由 `zh.json` 推导 i18next 的资源类型（架构文档 §11.4）。
 *
 * 效果：`t('nav.characters')` 在编译期校验 key；
 * 拼错 key 或忘记同步 zh.json 会直接让 `tsc` 失败，而不是运行期显示原文。
 */
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    returnNull: false;
    resources: {
      translation: typeof zhTranslation;
    };
  }
}
