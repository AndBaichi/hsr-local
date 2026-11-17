/**
 * 详情页的收藏按钮与笔记面板（PRD §4.2 第 3/5/9 项）
 *
 * 这就是我在 T04 之前先做 `userdata_*` 的原因：五个详情页都要内嵌这两个控件，
 * 先写页面就得回头把五处全改一遍。
 *
 * 收藏键是 `{module}:{id}`。**敌人必须用 `groupKey` 而不是 `primaryId`**——
 * 同一组敌人有多个变体，从列表点进去和从详情收藏若用了不同 id，
 * 会生成两条指向同一实体的收藏。
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { dal } from '@/lib/data/dal';
import type { LocalizedNames, ModuleKey } from '@/lib/data/types';
import type { LocalizedNames as SnapshotNames } from '@/lib/userdata/types';
import { useFavoritesStore } from '@/stores/favorites';
import { useNotesStore } from '@/stores/notes';

/** 详情工具属性 */
export interface DetailToolsProps {
  /** 模块 */
  readonly module: ModuleKey;
  /** 实体键（敌人传 groupKey，其余传 id） */
  readonly id: string;
  /** 名称快照，跨数据版本保留显示名 */
  readonly names: LocalizedNames;
}

/** 详情工具 */
export function DetailTools({ module, id, names }: DetailToolsProps): ReactNode {
  const { t } = useTranslation();
  const favorite = useFavoritesStore((state) => Boolean(state.items[`${module}:${id}`]));
  const toggleFavorite = useFavoritesStore((state) => state.toggle);
  const note = useNotesStore((state) => state.items[`${module}:${id}`]);
  const setNote = useNotesStore((state) => state.setNote);

  const [draft, setDraft] = useState(note?.content ?? '');

  // 切换到另一条实体时同步草稿；否则会把上一条的笔记显示在新页面上
  useEffect(() => {
    setDraft(note?.content ?? '');
  }, [module, id, note?.content]);

  const snapshot: SnapshotNames = names as SnapshotNames;

  const handleToggle = useCallback((): void => {
    toggleFavorite({
      module,
      id,
      nameSnapshot: snapshot,
      packId: dal.meta?.packId ?? '',
    });
  }, [toggleFavorite, module, id, snapshot]);

  const handleNoteChange = useCallback(
    (value: string): void => {
      setDraft(value);
      setNote({ module, id, nameSnapshot: snapshot }, value);
    },
    [setNote, module, id, snapshot],
  );

  return (
    <section className="hsr-panel flex flex-col gap-4 rounded-card border border-line p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-ink">{t('detail.tools')}</h2>
        <button
          type="button"
          onClick={handleToggle}
          aria-pressed={favorite}
          className={`rounded-btn border px-3 py-1.5 text-xs transition-colors duration-fast ${
            favorite
              ? 'border-accent bg-elev text-accent'
              : 'border-line bg-elev text-dim hover:text-ink'
          }`}
        >
          {favorite ? t('detail.unfavorite') : t('detail.favorite')}
        </button>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs text-dim">{t('detail.note')}</span>
        <textarea
          value={draft}
          onChange={(event) => handleNoteChange(event.target.value)}
          placeholder={t('detail.notePlaceholder') as string}
          rows={3}
          maxLength={20_000}
          className="w-full resize-y rounded-btn border border-line bg-elev px-3 py-2 text-sm leading-relaxed text-ink outline-none placeholder:text-dim focus:border-accent"
        />
        <span className="text-[11px] text-dim">{t('detail.noteSaved')}</span>
      </label>
    </section>
  );
}
