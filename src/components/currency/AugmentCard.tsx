/**
 * 投资策略（augment）卡片，对齐原站 `/currency/augment` 的版式。
 *
 * 原站卡片是：
 *  图标 + 名称 + 品质 → **完整描述**（不截断）→ `章节: 1`
 * 通用卡片会把描述压成两行，也不显示章节，导致投资策略看起来“缺内容”。
 */

import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { MacroText } from '@/components/common/MacroText';
import { SafeImage } from '@/components/common/SafeImage';
import {
  currencyDisplayName,
  currencyIconCandidates,
  currencyParams,
  type CurrencyEntry,
} from '@/lib/data/extra';
import { currencyQualityName } from '@/lib/labels';
import { expandGridFightInfo } from '@/lib/text/gridfight';

/** 投资策略卡片属性 */
export interface AugmentCardProps {
  /** 条目 */
  readonly entry: CurrencyEntry;
  /** 打开详情 */
  readonly onOpen: () => void;
  /** 右上角评级徽标 */
  readonly actions?: ReactNode;
  /** 右键菜单 */
  readonly onContextMenu?: (event: React.MouseEvent) => void;
  /** `<gridfightinfo>` 的显示名解析（物品引用） */
  readonly infoLabelOf?: (type: string, id: string) => string | undefined;
}

/** 投资策略卡片 */
export function AugmentCard({ entry, onOpen, actions, onContextMenu, infoLabelOf }: AugmentCardProps): ReactNode {
  const { t } = useTranslation();
  const name = currencyDisplayName(entry, 'augment', t);
  const candidates = currencyIconCandidates(entry, 'augment');
  const params = currencyParams(entry);
  const quality =
    typeof entry.quality === 'string' ? currencyQualityName(t, entry.quality) : '';
  const rawDesc =
    typeof entry.desc === 'string' && entry.desc.trim() !== ''
      ? entry.desc
      : typeof entry.simple_desc === 'string' && entry.simple_desc.trim() !== ''
        ? entry.simple_desc
        : undefined;
  const desc = rawDesc === undefined ? undefined : expandGridFightInfo(rawDesc, infoLabelOf);
  const chapters = Array.isArray(entry.chapter_limit_list)
    ? (entry.chapter_limit_list as readonly unknown[]).map(String).filter((value) => value !== '')
    : [];

  return (
    <div className="relative h-full" onContextMenu={onContextMenu}>
      <button
        type="button"
        onClick={onOpen}
        className="hsr-panel group flex h-full w-full flex-col rounded-card border border-line p-4 text-left transition-colors duration-fast hover:border-accent"
      >
        <div className="flex items-center gap-3 pr-20">
          <SafeImage
            src={candidates[0]}
            fallbacks={candidates.slice(1)}
            alt={name}
            className="h-10 w-10 shrink-0"
            imgClassName="object-contain"
          />
          <div className="min-w-0">
            <div className="break-words font-semibold text-ink group-hover:text-accent">{name}</div>
            {quality !== '' ? <div className="text-xs text-dim">{quality}</div> : null}
          </div>
        </div>

        {desc !== undefined ? (
          <MacroText
            value={desc}
            paramList={params}
            className="mt-3 text-sm leading-relaxed text-dim"
          />
        ) : null}

        {chapters.length > 0 ? (
          <div className="mt-3 text-xs text-dim">
            {t('currency.chapter')}
            {t('currency.labelValueSeparator')}
            {chapters.join(', ')}
          </div>
        ) : null}
      </button>
      {actions !== undefined ? (
        <div className="absolute right-2 top-2 z-[2] flex items-center gap-1">{actions}</div>
      ) : null}
    </div>
  );
}
