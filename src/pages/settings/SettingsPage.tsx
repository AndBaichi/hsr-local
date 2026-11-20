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
 * 数据包分区同时承担 v4.8 的更新/回滚/手动导入 UI；下载与解包全部走 Rust 命令。
 * 所有可能缺失的包信息用 `common.unknown` 兜底，绝不打印 "undefined"。
 */

import { invoke } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import { open } from '@tauri-apps/plugin-dialog';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { PagePlaceholder } from '@/components/common/PagePlaceholder';
import { PageHeader } from '@/components/layout/PageHeader';
import { dal } from '@/lib/data/dal';
import { CURSOR_PREVIEW_URL } from '@/lib/cursorTheme';
import { LANGUAGE_ORDER, type Lang } from '@/i18n';
import { useFavoritesStore } from '@/stores/favorites';
import { useNotesStore } from '@/stores/notes';
import { useSettingsStore } from '@/stores/settings';
import { DATA_VIEW_OPTIONS, useDataViewStore } from '@/stores/dataView';
import { useUpdaterStore } from '@/stores/updater';
import { useAppUpdaterStore } from '@/stores/appUpdater';

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
  const dataVersion = useDataViewStore((state) => state.version);
  const setDataVersion = useDataViewStore((state) => state.setVersion);
  const setLang = useSettingsStore((state) => state.setLang);
  const setShortcutsEnabled = useSettingsStore((state) => state.setShortcutsEnabled);
  const setCloseAction = useSettingsStore((state) => state.setCloseAction);
  const setCursorTheme = useSettingsStore((state) => state.setCursorTheme);
  const setAutoUpdate = useSettingsStore((state) => state.setAutoUpdate);
  const updater = useUpdaterStore();
  const refreshPrevious = useUpdaterStore((state) => state.refreshPrevious);
  const appUpdater = useAppUpdaterStore();
  const resetPrefs = useSettingsStore((state) => state.resetPrefs);

  const [pending, setPending] = useState<PendingAction | undefined>(undefined);
  const [importError, setImportError] = useState<string | undefined>(undefined);
  const [appVersion, setAppVersion] = useState('');

  useEffect(() => {
    void getVersion().then(setAppVersion).catch(() => undefined);
    void useAppUpdaterStore.getState().check(false);
  }, []);
  // 设置页挂载时确认一次「有没有可回滚的上一版」
  useEffect(() => {
    void refreshPrevious();
  }, [refreshPrevious]);

  /** 手动导入：选一个 .hsrpack 并安装 */
  const handleImportPack = async (): Promise<void> => {
    setImportError(undefined);
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: 'HSR Pack', extensions: ['hsrpack'] }],
      });
      if (typeof selected === 'string') await updater.installFile(selected);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : String(error));
    }
  };  const [folderError, setFolderError] = useState<string | undefined>(undefined);

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
  const updatePercent =
    updater.total > 0 ? Math.min(100, Math.round((updater.downloaded / updater.total) * 100)) : 0;
  const updateBusy =
    updater.phase === 'checking' ||
    updater.phase === 'downloading' ||
    updater.phase === 'installing';
  const latestVersion = updater.manifest?.gameVersion ?? '—';
  const installedVersion = updater.installed?.gameVersion ?? latestVersion;
  const appPercent =
    appUpdater.total > 0 ? Math.min(100, Math.round((appUpdater.downloaded / appUpdater.total) * 100)) : 0;
  const appBusy =
    appUpdater.phase === 'checking' ||
    appUpdater.phase === 'downloading' ||
    appUpdater.phase === 'installing';
  const shownAppVersion = appUpdater.currentVersion || appVersion;
  const shownLatestAppVersion = appUpdater.latestVersion ?? '—';
  let appStatus = t('settings.appNotChecked') as string;
  switch (appUpdater.phase) {
    case 'checking':
      appStatus = t('settings.appChecking') as string;
      break;
    case 'up-to-date':
      appStatus = t('settings.appUpToDate') as string;
      break;
    case 'available':
      appStatus = t('settings.appAvailable', { version: shownLatestAppVersion }) as string;
      break;
    case 'downloading':
      appStatus = t('settings.appDownloading', { percent: appPercent }) as string;
      break;
    case 'installing':
      appStatus = t('settings.appInstalling') as string;
      break;
    case 'ready':
      appStatus = t('settings.appReady') as string;
      break;
    case 'error':
      appStatus = t('settings.appError', { message: appUpdater.error ?? unknownLabel }) as string;
      break;
    default:
      break;
  }  const currentVersion =
    updater.phase === 'ready' && updater.installed !== undefined
      ? updater.installed.gameVersion
      : dal.bootInfo?.gameVersion;
  let updateStatus = t('settings.notChecked') as string;
  switch (updater.phase) {
    case 'checking':
      updateStatus = t('settings.checkingUpdate') as string;
      break;
    case 'up-to-date':
      updateStatus = t('settings.upToDate') as string;
      break;
    case 'available':
      updateStatus = t('settings.updateAvailable', { version: latestVersion }) as string;
      break;
    case 'app-outdated':
      updateStatus = t('settings.appOutdated', {
        version: updater.manifest?.minAppVersion ?? '—',
      }) as string;
      break;
    case 'downloading':
      updateStatus = t('settings.downloadingUpdate', { percent: updatePercent }) as string;
      break;
    case 'installing':
      updateStatus = t('settings.installingUpdate') as string;
      break;
    case 'ready':
      updateStatus = t('settings.updateReady', { version: installedVersion }) as string;
      break;
    case 'error':
      updateStatus = t('settings.updateError', {
        message: updater.error ?? unknownLabel,
      }) as string;
      break;
    default:
      break;
  }  const dangerButton =
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

      {/* 2. 数据版本：现场 / 历史 / 最新 */}
      <Section title={t('settings.dataVersion') as string} description={t('settings.dataVersionDesc') as string}>
        <div className="flex flex-wrap gap-2">
          {DATA_VIEW_OPTIONS.map((option) => (
            <ChoiceButton
              key={option}
              active={dataVersion === option}
              label={
                t(
                  option === 'live'
                    ? 'common.dataVersionLive'
                    : option === '4.7.51'
                      ? 'common.dataVersionMid'
                      : 'common.dataVersionLatest',
                ) as string
              }
              onClick={() => setDataVersion(option)}
            />
          ))}
        </div>
      </Section>

      {/* 3. 数据包：信息 + 更新 / 回滚 / 手动导入（v4.8） */}
      <Section title={t('settings.datapack') as string} description={t('settings.datapackDesc') as string}>
        <div className="flex flex-col gap-2">
          <InfoRow
            label={t('settings.currentVersion') as string}
            value={orUnknown(currentVersion, unknownLabel)}
          />
          <InfoRow label={t('settings.latestVersion') as string} value={latestVersion} />
          <InfoRow
            label={t('settings.packId') as string}
            value={orUnknown(dal.bootInfo?.packId, unknownLabel)}
          />
          <InfoRow
            label={t('settings.schemaVersion') as string}
            value={orUnknown(dal.meta?.schemaVersion, unknownLabel)}
          />
        </div>

        <div className="mt-1 flex flex-col gap-2 border-t border-line pt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-medium text-ink">{t('settings.update') as string}</h3>
            <span
              className={`text-[11px] ${
                updater.phase === 'error' ? 'text-danger' : 'text-dim'
              }`}
            >
              {updateStatus}
            </span>
          </div>
          <p className="text-[11px] leading-relaxed text-dim">
            {t('settings.updateDesc') as string}
          </p>

          {updater.phase === 'downloading' ? (
            <div className="flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
                <div
                  className="h-full rounded-full bg-accent transition-[width] duration-200"
                  style={{ width: `${updatePercent}%` }}
                />
              </div>
              <span className="w-10 text-right text-[11px] text-dim">{updatePercent}%</span>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={updateBusy}
              onClick={() => void updater.check(true)}
              className="rounded-btn border border-line bg-elev px-3 py-1.5 text-xs text-ink hover:border-accent disabled:cursor-default disabled:opacity-40"
            >
              {updater.phase === 'checking'
                ? (t('settings.checkingUpdate') as string)
                : (t('settings.checkUpdate') as string)}
            </button>

            {updater.phase === 'available' ||
            (updater.phase === 'error' && updater.manifest !== undefined) ? (
              <button
                type="button"
                disabled={updateBusy}
                onClick={() => void updater.download()}
                className="rounded-btn border border-accent/50 bg-accent/15 px-3 py-1.5 text-xs text-accent hover:bg-accent/25 disabled:cursor-default disabled:opacity-40"
              >
                {t('settings.downloadUpdate') as string}
              </button>
            ) : null}

            {updater.phase === 'ready' ? (
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="rounded-btn border border-accent/50 bg-accent/15 px-3 py-1.5 text-xs text-accent hover:bg-accent/25"
              >
                {t('settings.restartApp') as string}
              </button>
            ) : null}

            <button
              type="button"
              disabled={updateBusy}
              onClick={() => void handleImportPack()}
              className="rounded-btn border border-line bg-elev px-3 py-1.5 text-xs text-ink hover:border-accent disabled:cursor-default disabled:opacity-40"
            >
              {t('settings.importPack') as string}
            </button>

            <button
              type="button"
              disabled={updateBusy || !updater.hasPrevious}
              title={updater.hasPrevious ? undefined : (t('settings.noPrevious') as string)}
              onClick={() => void updater.rollback()}
              className="rounded-btn border border-line bg-elev px-3 py-1.5 text-xs text-ink hover:border-accent disabled:cursor-default disabled:opacity-40"
            >
              {t('settings.rollbackPack') as string}
            </button>
          </div>

          {updater.manifest?.notes ? (
            <p className="text-[11px] leading-relaxed text-dim">
              {t('settings.updateNotes') as string}：{updater.manifest.notes}
            </p>
          ) : null}

          <label className="flex cursor-pointer items-center gap-2 text-xs text-ink">
            <input
              type="checkbox"
              checked={prefs.autoUpdate}
              onChange={(event) => setAutoUpdate(event.target.checked)}
              className="h-4 w-4"
            />
            <span>{t('settings.autoUpdate') as string}</span>
          </label>
          <p className="text-[11px] text-dim">{t('settings.autoUpdateHint') as string}</p>

          {importError ? <p className="text-[11px] text-danger">{importError}</p> : null}
        </div>
      </Section>

      {/* 2b. 应用自身更新（Tauri Updater，v2.21） */}
      <Section title={t('settings.appUpdate') as string} description={t('settings.appUpdateDesc') as string}>
        <div className="flex flex-col gap-2">
          <InfoRow label={t('settings.appCurrentVersion') as string} value={shownAppVersion || '—'} />
          <InfoRow label={t('settings.appLatestVersion') as string} value={shownLatestAppVersion} />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className={`text-[11px] ${appUpdater.phase === 'error' ? 'text-danger' : 'text-dim'}`}>
              {appStatus}
            </span>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={appBusy}
                onClick={() => void appUpdater.check(true)}
                className="rounded-btn border border-line bg-elev px-3 py-1.5 text-xs text-ink hover:border-accent disabled:cursor-default disabled:opacity-40"
              >
                {appUpdater.phase === 'checking'
                  ? (t('settings.appChecking') as string)
                  : (t('settings.appCheckUpdate') as string)}
              </button>
              {appUpdater.phase === 'available' || (appUpdater.phase === 'error' && appUpdater.latestVersion) ? (
                <button
                  type="button"
                  disabled={appBusy}
                  onClick={() => void appUpdater.install()}
                  className="rounded-btn border border-accent/50 bg-accent/15 px-3 py-1.5 text-xs text-accent hover:bg-accent/25 disabled:cursor-default disabled:opacity-40"
                >
                  {t('settings.appInstall') as string}
                </button>
              ) : null}
              {appUpdater.phase === 'ready' ? (
                <button
                  type="button"
                  onClick={() => void appUpdater.restart()}
                  className="rounded-btn border border-accent/50 bg-accent/15 px-3 py-1.5 text-xs text-accent hover:bg-accent/25"
                >
                  {t('settings.appRestart') as string}
                </button>
              ) : null}
            </div>
          </div>
          {appUpdater.phase === 'downloading' && appUpdater.total > 0 ? (
            <div className="flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
                <div
                  className="h-full rounded-full bg-accent transition-[width] duration-200"
                  style={{ width: `${appPercent}%` }}
                />
              </div>
              <span className="w-10 text-right text-[11px] text-dim">{appPercent}%</span>
            </div>
          ) : null}
          {appUpdater.notes ? (
            <p className="text-[11px] leading-relaxed text-dim">{appUpdater.notes}</p>
          ) : null}
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
