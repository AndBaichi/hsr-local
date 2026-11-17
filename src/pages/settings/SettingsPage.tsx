/**
 * 设置页（PRD §4.2 页面 17 / T03）
 *
 * 分区：语言 / 数据包（只读） / 偏好 / 用户数据 / 数据管理 / 关于。
 * 语言、快捷键全部直接连 `useSettingsStore`（含 localStorage
 * 同步镜像与 prefs.json 落盘）；收藏与笔记的清空走各自 store 的 `clear()`。
 *
 * 原「列表每页条数」分区已在 v2.8 移除（列表改为全量渲染，不再有页）。
 * `prefs.listPageSize` 字段、clamp 与 `setListPageSize` **保留**——用户已有的
 * prefs.json 里带着这个键，删字段会让反序列化与 `resetPrefs` 失配；只是不再有
 * UI 入口，四个语言的 `settings.pageSize*` 文案也一并留着（见 PRD §4.10）。
 *
 * 数据包信息一律只读展示：更新/回滚机制尚未实现，不提供任何导入 UI。
 * 所有可能缺失的包信息用 `common.unknown` 兜底，绝不打印 "undefined"。
 */

import { invoke } from '@tauri-apps/api/core';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { PagePlaceholder } from '@/components/common/PagePlaceholder';
import { PageHeader } from '@/components/layout/PageHeader';
import { dal } from '@/lib/data/dal';
import { CURSOR_PREVIEW_URL } from '@/lib/cursorTheme';
import { LANGUAGE_ORDER, type Lang } from '@/i18n';
import { useFavoritesStore } from '@/stores/favorites';
import { useNotesStore } from '@/stores/notes';
import { useSettingsStore } from '@/stores/settings';

/**
 * 原 T01 占位实现：页面已接入真实内容，此处不再渲染，
 * 但按「先不删东西」的要求保留引用，未删除（parked, not deleted）。
 */
export const ATTIC_T01_PLACEHOLDER = PagePlaceholder;

/** 语言 → 文案 key */
const LANG_LABEL_KEY = {
  zh: 'settings.langZh',
  en: 'settings.langEn',
  ja: 'settings.langJa',
  ko: 'settings.langKo',
} as const satisfies Record<Lang, string>;

/** 破坏性操作类型 */
type PendingAction = 'favorites' | 'notes' | 'reset';

/** 破坏性操作 → 确认文案 key */
const CONFIRM_KEY = {
  favorites: 'favorites.clearConfirm',
  notes: 'notes.clearConfirm',
  reset: 'settings.resetConfirm',
} as const satisfies Record<PendingAction, string>;

/** 缺失 / 空值统一显示「未知」，绝不打印 undefined */
function orUnknown(value: string | number | undefined, unknownLabel: string): string {
  if (value === undefined || value === null || value === '') return unknownLabel;
  return String(value);
}

/** 分区面板 */
function Section({
  title,
  description,
  children,
}: {
  readonly title: string;
  readonly description?: string;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <section className="hsr-panel flex flex-col gap-3 rounded-card border border-line p-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {description ? <p className="text-xs text-dim">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** 分段选择按钮（主题 / 语言共用） */
function ChoiceButton({
  active,
  label,
  onClick,
}: {
  readonly active: boolean;
  readonly label: string;
  readonly onClick: () => void;
}): ReactNode {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-btn border px-3 py-1.5 text-xs ${
        active ? 'border-accent bg-elev text-accent' : 'border-line bg-elev text-dim hover:text-ink'
      }`}
    >
      {label}
    </button>
  );
}

/** 只读信息行 */
function InfoRow({ label, value }: { readonly label: string; readonly value: string }): ReactNode {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2 text-xs">
      <span className="text-dim">{label}</span>
      <span className="font-mono text-ink">{value}</span>
    </div>
  );
}

/** 页内确认条：确定 / 取消 */
function ConfirmBar({
  message,
  onConfirm,
  onCancel,
}: {
  readonly message: string;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}): ReactNode {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-btn border border-line bg-elev px-3 py-2">
      <span className="min-w-0 flex-1 text-xs text-ink">{message}</span>
      <button
        type="button"
        onClick={onConfirm}
        className="rounded-btn border border-line bg-elev px-3 py-1 text-xs text-danger hover:text-ink"
      >
        {t('common.yes') as string}
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="rounded-btn border border-line bg-elev px-3 py-1 text-xs text-dim hover:text-ink"
      >
        {t('common.no') as string}
      </button>
    </div>
  );
}

/** 设置页 */
export default function SettingsPage(): ReactNode {
  const { t } = useTranslation();
  const prefs = useSettingsStore((state) => state.prefs);
  const setLang = useSettingsStore((state) => state.setLang);
  const setShortcutsEnabled = useSettingsStore((state) => state.setShortcutsEnabled);
  const setCloseAction = useSettingsStore((state) => state.setCloseAction);
  const setCursorTheme = useSettingsStore((state) => state.setCursorTheme);
  const resetPrefs = useSettingsStore((state) => state.resetPrefs);

  const [pending, setPending] = useState<PendingAction | undefined>(undefined);
  const [folderError, setFolderError] = useState<string | undefined>(undefined);

  const handleOpenFolder = (): void => {
    setFolderError(undefined);
    void invoke('userdata_open_folder').catch((error: unknown) => {
      setFolderError(error instanceof Error ? error.message : String(error));
    });
  };

  const runPending = (): void => {
    switch (pending) {
      case 'favorites':
        useFavoritesStore.getState().clear();
        break;
      case 'notes':
        useNotesStore.getState().clear();
        break;
      case 'reset':
        resetPrefs();
        break;
      default:
        break;
    }
    setPending(undefined);
  };

  const unknownLabel = t('common.unknown') as string;
  const dangerButton =
    'rounded-btn border border-line bg-elev px-3 py-1.5 text-xs text-danger hover:text-ink';

  return (
    <div className="flex flex-col gap-4 pt-2">
      <PageHeader title={t('settings.title') as string} />

      {/* 三个破坏性操作共用一个页内确认条 */}
      {pending ? (
        <ConfirmBar
          message={t(CONFIRM_KEY[pending] as 'favorites.clearConfirm') as string}
          onConfirm={runPending}
          onCancel={() => setPending(undefined)}
        />
      ) : null}

      {/* 1. 语言 */}
      <Section title={t('settings.language') as string} description={t('settings.languageDesc') as string}>
        <div className="flex flex-wrap gap-2">
          {LANGUAGE_ORDER.map((lang) => (
            <ChoiceButton
              key={lang}
              active={prefs.lang === lang}
              label={t(LANG_LABEL_KEY[lang] as 'settings.langZh') as string}
              onClick={() => setLang(lang)}
            />
          ))}
        </div>
      </Section>

      {/* 2. 数据包：只读信息，更新/回滚机制尚未实现 */}
      <Section title={t('settings.datapack') as string} description={t('settings.datapackDesc') as string}>
        <div className="flex flex-col gap-2">
          <InfoRow
            label={t('settings.packVersion') as string}
            value={orUnknown(dal.bootInfo?.gameVersion, unknownLabel)}
          />
          <InfoRow
            label={t('settings.packId') as string}
            value={orUnknown(dal.bootInfo?.packId, unknownLabel)}
          />
          <InfoRow
            label={t('settings.schemaVersion') as string}
            value={orUnknown(dal.meta?.schemaVersion, unknownLabel)}
          />
          <p className="text-[11px] text-dim">{t('settings.readOnly') as string}</p>
        </div>
      </Section>

      {/* 3. 偏好：快捷键开关 */}
      <Section title={t('settings.shortcuts') as string} description={t('settings.shortcutsDesc') as string}>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={prefs.shortcutsEnabled}
            onChange={(event) => setShortcutsEnabled(event.target.checked)}
            className="h-4 w-4"
          />
          <span>{t('settings.shortcutsEnabled') as string}</span>
        </label>
      </Section>

      {/* 3. 偏好：关窗行为（首次关窗时也会问一次，这里用来改回来） */}
      <Section
        title={t('settings.closeBehavior') as string}
        description={t('settings.closeBehaviorDesc') as string}
      >
        <div className="flex flex-wrap gap-2">
          <ChoiceButton
            active={prefs.closeAction === 'quit'}
            label={t('settings.closeQuit') as string}
            onClick={() => setCloseAction('quit')}
          />
          <ChoiceButton
            active={prefs.closeAction === 'tray'}
            label={t('settings.closeToTray') as string}
            onClick={() => setCloseAction('tray')}
          />
        </div>
        <p className="text-[11px] text-dim">{t('settings.closeToTrayHint') as string}</p>
      </Section>

      {/* 3. 偏好：鼠标指针主题（v2.16 内置银狼指针） */}
      <Section
        title={t('settings.cursorTheme') as string}
        description={t('settings.cursorThemeDesc') as string}
      >
        <div className="flex flex-wrap items-center gap-2">
          <ChoiceButton
            active={prefs.cursorTheme === 'silverwolf'}
            label={t('settings.cursorSilverWolf') as string}
            onClick={() => setCursorTheme('silverwolf')}
          />
          <ChoiceButton
            active={prefs.cursorTheme === 'system'}
            label={t('settings.cursorSystem') as string}
            onClick={() => setCursorTheme('system')}
          />
          <img
            src={CURSOR_PREVIEW_URL}
            alt=""
            aria-hidden
            className="h-8 w-8 rounded-btn border border-line bg-elev object-contain p-1"
          />
        </div>
      </Section>

      {/* 4. 用户数据 */}
      <Section title={t('settings.userdata') as string} description={t('settings.openFolderDesc') as string}>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleOpenFolder}
            className="rounded-btn border border-line bg-elev px-3 py-1.5 text-xs text-ink hover:border-accent"
          >
            {t('settings.openFolder') as string}
          </button>
          <button type="button" className={dangerButton} onClick={() => setPending('favorites')}>
            {t('settings.clearFavorites') as string}
          </button>
          <button type="button" className={dangerButton} onClick={() => setPending('notes')}>
            {t('settings.clearNotes') as string}
          </button>
        </div>
        {folderError ? (
          <p role="alert" className="rounded-btn border border-line bg-elev px-3 py-2 text-xs text-danger">
            {t('error.codes.IO_FAILED') as string} · {folderError}
          </p>
        ) : null}
      </Section>

      {/* 5. 数据管理（危险区） */}
      <Section title={t('settings.dangerZone') as string} description={t('settings.resetDesc') as string}>
        <div>
          <button type="button" className={dangerButton} onClick={() => setPending('reset')}>
            {t('settings.reset') as string}
          </button>
        </div>
      </Section>

      {/* 6. 关于与署名 */}
      <Section title={t('settings.about') as string}>
        <div className="flex flex-col gap-1 text-xs text-dim">
          <span className="text-sm font-semibold text-ink">
            {/* 副标题为空（已删除「本地版」）时不再拼接分隔符 */}
            {t('app.subtitle')
              ? `${t('app.name') as string} · ${t('app.subtitle') as string}`
              : (t('app.name') as string)}
          </span>
          <span>{t('settings.aboutDesc') as string}</span>
          <span>{t('settings.offlineNote') as string}</span>
        </div>
      </Section>
    </div>
  );
}
