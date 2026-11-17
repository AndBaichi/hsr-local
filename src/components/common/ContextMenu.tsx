/**
 * 资料库卡片右键菜单 + 笔记弹窗（v2.9 新增）
 *
 * ## 为什么需要它
 *
 * WebView2 默认右键菜单一无是处（没有「后退/刷新」以外的有效项，还露出调试入口），
 * 而收藏/笔记/对比此前只能进详情页操作。v2.9 起：
 *  - 全局抑制默认菜单（输入框/文本域/`contentEditable` 除外，那里还要靠它复制粘贴）
 *  - 资料库卡片右键弹本组件：打开详情 / 加入对比 / 加入收藏 / 记录笔记
 *
 * ## 形态
 *
 * 单例菜单：任何时刻最多一个，挂在 `<ContextMenuHost />`（AppShell 内）。
 * 卡片通过 `openEntityContextMenu(target, x, y)` 上报，菜单项点击后自动关闭；
 * 点击外部 / Escape / 滚动 / 缩放 / 路由切换都会关闭。
 *
 * 「记录笔记」打开本文件内的 `<NoteDialog />`：内容与 `DetailTools` 共用一个
 * notes store（600ms 防抖落盘），在列表页记的笔记进详情页能看到，反之亦然。
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { create } from 'zustand';

import { dal } from '@/lib/data/dal';
import type { LocalizedNames, ModuleKey } from '@/lib/data/types';
import { detailRouteOf } from '@/lib/entities';
import { pickName } from '@/lib/userdata/types';
import { useFavoritesStore } from '@/stores/favorites';
import { useNotesStore } from '@/stores/notes';
import { COMPARE_LIMIT, useSettingsStore } from '@/stores/settings';

/** 一次实体右键的全部上下文 */
export interface EntityMenuTarget {
  readonly module: ModuleKey;
  /** 实体键（敌人传 groupKey，与收藏/详情一致） */
  readonly id: string;
  /** 名称快照（收藏/笔记落盘用，跨数据包版本存活） */
  readonly names: LocalizedNames;
}

interface ContextMenuState {
  /** 当前目标；`null` = 菜单关闭 */
  readonly target: EntityMenuTarget | null;
  /** 菜单左上角坐标（已做视口边缘收敛） */
  readonly x: number;
  readonly y: number;
  /** 打开菜单 */
  readonly open: (target: EntityMenuTarget, x: number, y: number) => void;
  /** 关闭菜单 */
  readonly close: () => void;
}

/** 菜单的估算尺寸（用于视口右/下边缘收敛，实际渲染按内容自适应） */
const MENU_WIDTH = 176;
const MENU_HEIGHT = 168;

/** 右键菜单单例 store（组件外也可触发关闭） */
export const useContextMenuStore = create<ContextMenuState>()((set) => ({
  target: null,
  x: 0,
  y: 0,
  open: (target, x, y) =>
    set({
      target,
      // 贴右/下边缘打开时往回收，避免菜单被视口裁掉
      x: Math.max(4, Math.min(x, window.innerWidth - MENU_WIDTH - 8)),
      y: Math.max(4, Math.min(y, window.innerHeight - MENU_HEIGHT - 8)),
    }),
  close: () => set({ target: null }),
}));

/**
 * 卡片 `onContextMenu` 的统一入口。
 *
 * 只在卡片上调用：全局默认菜单抑制在 AppShell 做，卡片这里 `preventDefault`
 * 是为了保证即使抑制逻辑漏了也不会两个菜单叠着出。
 */
export function openEntityContextMenu(
  target: EntityMenuTarget,
  event: { preventDefault: () => void; stopPropagation: () => void; clientX: number; clientY: number },
): void {
  event.preventDefault();
  event.stopPropagation();
  useContextMenuStore.getState().open(target, event.clientX, event.clientY);
}

/** 判断事件目标是否落在可编辑控件里（那里保留系统默认菜单） */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable ||
    target.closest('input, textarea, [contenteditable="true"]') !== null
  );
}

/**
 * 全局抑制 WebView2 默认右键菜单（v2.9）。
 *
 * 挂一次在 AppShell：捕获阶段拦截，命中卡片时卡片自己的 handler 已经
 * `stopPropagation`，到这里的是「非卡片区域」——直接 preventDefault，
 * 这就是「优化原鼠标右键会出现的选项」：默认菜单整体不再出现。
 */
export function installContextMenuSuppression(): () => void {
  const handler = (event: MouseEvent): void => {
    if (isEditableTarget(event.target)) return;
    event.preventDefault();
  };
  window.addEventListener('contextmenu', handler, { capture: true });
  return () => window.removeEventListener('contextmenu', handler, { capture: true });
}

/** 笔记弹窗（与详情页 DetailTools 共用 notes store，自动保存） */
function NoteDialog({ target, onClose }: { readonly target: EntityMenuTarget; readonly onClose: () => void }): ReactNode {
  const { t } = useTranslation();
  const lang = useSettingsStore((state) => state.prefs.lang);
  const note = useNotesStore((state) => state.items[`${target.module}:${target.id}`]);
  const setNote = useNotesStore((state) => state.setNote);
  const [draft, setDraft] = useState(note?.content ?? '');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const name = pickName(target.names, lang, target.id);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Escape 关闭；输入框里的 Escape 先清空再关（与列表搜索框行为一致）
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    },
    [onClose],
  );

  const handleChange = useCallback(
    (value: string): void => {
      setDraft(value);
      setNote({ module: target.module, id: target.id, nameSnapshot: target.names }, value);
    },
    [setNote, target],
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t('contextMenu.editNote') as string}
      onClick={onClose}
      onKeyDown={handleKeyDown}
    >
      <div
        className="hsr-panel flex w-full max-w-md flex-col gap-3 rounded-card border border-line p-4"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="min-w-0 truncate text-sm font-semibold text-ink" title={name}>
            {t('noteDialog.title', { name })}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-btn border border-line bg-elev px-2.5 py-1 text-xs text-dim hover:text-ink"
          >
            {t('common.close')}
          </button>
        </div>
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(event) => handleChange(event.target.value)}
          placeholder={t('detail.notePlaceholder') as string}
          rows={6}
          maxLength={20_000}
          className="w-full resize-y rounded-btn border border-line bg-elev px-3 py-2 text-sm leading-relaxed text-ink outline-none placeholder:text-dim focus:border-accent"
        />
        <span className="text-[11px] text-dim">{t('detail.noteSaved')}</span>
      </div>
    </div>
  );
}

/** 菜单本体 + 笔记弹窗宿主；在 AppShell 挂一次 */
export function ContextMenuHost(): ReactNode {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const lang = useSettingsStore((state) => state.prefs.lang);
  const target = useContextMenuStore((state) => state.target);
  const x = useContextMenuStore((state) => state.x);
  const y = useContextMenuStore((state) => state.y);
  const close = useContextMenuStore((state) => state.close);
  const compareIds = useSettingsStore((state) => state.prefs.compareIds);
  const setCompareIds = useSettingsStore((state) => state.setCompareIds);
  const favorite = useFavoritesStore((state) =>
    target === null ? false : Boolean(state.items[`${target.module}:${target.id}`]),
  );
  const toggleFavorite = useFavoritesStore((state) => state.toggle);
  const [noteTarget, setNoteTarget] = useState<EntityMenuTarget | null>(null);

  // 路由一切换就关菜单：菜单里的「打开详情」导航后不应残留
  useEffect(() => {
    close();
  }, [location.pathname, close]);

  // 点击外部 / Escape / 滚动 / 缩放时关闭
  useEffect(() => {
    if (target === null) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (!(event.target instanceof HTMLElement)) return;
      if (event.target.closest('[data-context-menu]') === null) close();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close();
    };
    const onPassive = (): void => close();
    window.addEventListener('pointerdown', onPointerDown, { capture: true });
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('wheel', onPassive, { capture: true, passive: true });
    window.addEventListener('resize', onPassive);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, { capture: true });
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('wheel', onPassive, { capture: true });
      window.removeEventListener('resize', onPassive);
    };
  }, [target, close]);

  if (target === null) {
    return noteTarget !== null ? (
      <NoteDialog target={noteTarget} onClose={() => setNoteTarget(null)} />
    ) : null;
  }

  const key = `${target.module}:${target.id}`;
  const detailPath = detailRouteOf(target.module, target.id);
  const inCompare = compareIds.includes(key);
  const compareFull = !inCompare && compareIds.length >= COMPARE_LIMIT;

  const handleCompare = (): void => {
    const current = useSettingsStore.getState().prefs.compareIds;
    if (current.includes(key)) {
      setCompareIds(current.filter((entry) => entry !== key));
    } else if (current.length < COMPARE_LIMIT) {
      setCompareIds([...current, key]);
    }
    close();
  };

  const handleFavorite = (): void => {
    toggleFavorite({
      module: target.module,
      id: target.id,
      nameSnapshot: target.names,
      packId: dal.meta?.packId ?? '',
    });
    close();
  };

  const handleNote = (): void => {
    setNoteTarget(target);
    close();
  };

  const handleOpenDetail = (): void => {
    if (detailPath !== null) navigate(detailPath);
    close();
  };

  const itemClass =
    'flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-ink transition-colors duration-fast hover:bg-elev disabled:cursor-not-allowed disabled:text-dim disabled:hover:bg-transparent';

  return (
    <>
      <div
        data-context-menu
        role="menu"
        aria-label={pickName(target.names, lang, target.id)}
        className="hsr-panel fixed z-50 min-w-[11rem] overflow-hidden rounded-btn border border-line py-1 shadow-lg"
        style={{ left: x, top: y }}
      >
        {detailPath !== null ? (
          <button type="button" role="menuitem" onClick={handleOpenDetail} className={itemClass}>
            {t('contextMenu.openDetail')}
          </button>
        ) : null}
        <button
          type="button"
          role="menuitem"
          onClick={handleCompare}
          disabled={compareFull}
          title={compareFull ? (t('contextMenu.compareFull', { count: COMPARE_LIMIT }) as string) : undefined}
          className={itemClass}
        >
          {inCompare ? t('contextMenu.removeCompare') : t('contextMenu.addCompare')}
        </button>
        <button type="button" role="menuitem" onClick={handleFavorite} className={itemClass}>
          {favorite ? t('contextMenu.removeFavorite') : t('contextMenu.addFavorite')}
        </button>
        <button type="button" role="menuitem" onClick={handleNote} className={itemClass}>
          {t('contextMenu.editNote')}
        </button>
      </div>
      {noteTarget !== null ? (
        <NoteDialog target={noteTarget} onClose={() => setNoteTarget(null)} />
      ) : null}
    </>
  );
}
