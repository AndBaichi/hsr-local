/** 遗器详情页（PRD §4.2 页面 7）：套装级，2/4 件套效果 + 部位构成表 */

import { useCallback, useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';

import { RichTextView } from '@/components/common/RichTextView';
import { SafeImage } from '@/components/common/SafeImage';
import { DetailSection, DetailShell, InfoRow } from '@/components/detail/DetailShell';
import { DetailTools } from '@/components/detail/DetailTools';
import { useDetail } from '@/hooks/useDetail';
import type { Lang } from '@/i18n';
import { dal } from '@/lib/data/dal';
import type { LocalizedNames, RelicSetDetail } from '@/lib/data/types';

export default function RelicDetailPage(): ReactNode {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const loader = useCallback((key: string, _lang: Lang) => dal.getRelicSet(key), []);
  const result = useDetail<RelicSetDetail>(loader, id);

  const names: LocalizedNames = useMemo(() => {
    const brief = dal.getIndex('relicset').find((entry) => entry.id === id);
    if (brief) return brief.names;
    return result.data ? { [result.lang]: result.data.name } : {};
  }, [id, result.data, result.lang]);

  return (
    <DetailShell
      result={result}
      backTo="/relics"
      fallbackTitle={t('nav.relics')}
      titleOf={(data) => data.name}
    >
      {(data) => (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(240px,1fr)]">
          <div className="flex flex-col gap-4">
            <DetailSection title={t('detail.effects')}>
              {data.effects.length === 0 ? (
                <p className="text-xs text-dim">{t('detail.noContent')}</p>
              ) : (
                <div className="flex flex-col gap-3">
                  {data.effects.map((effect) => (
                    <div key={effect.pieces} className="rounded-btn border border-line bg-elev p-3">
                      <div className="mb-1 text-xs font-semibold text-accent">
                        {effect.pieces} {t('detail.pieces')}
                      </div>
                      {/* 遗器文案里没有 p 节点（10% 写死在文本里），但没有也不会出错 */}
                      <RichTextView value={effect.desc} paramList={effect.paramList} />
                    </div>
                  ))}
                </div>
              )}
            </DetailSection>

            <DetailSection title={t('detail.parts')}>
              <div className="flex flex-col gap-2">
                {data.parts.map((part) => (
                  <div key={part.id} className="rounded-btn border border-line bg-elev p-3">
                    <div className="mb-1 text-sm font-semibold text-ink">{part.name}</div>
                    <RichTextView value={part.desc} />
                    {part.story ? <RichTextView value={part.story} className="mt-2 text-dim" /> : null}
                  </div>
                ))}
              </div>
            </DetailSection>
          </div>

          <div className="flex flex-col gap-4">
            <DetailSection title={t('detail.basic')}>
              <div className="mb-3 flex justify-center">
                <SafeImage src={data.icon} alt={data.name} className="h-24 w-24 rounded-card" imgClassName="object-contain" eager />
              </div>
              <InfoRow label={t('detail.id')}>{data.id}</InfoRow>
              <InfoRow label={t('detail.kind')}>
                {/* 数据包 kind 是英文枚举 cavern / planar，映射为中文分类名 */}
                {data.kind === 'cavern'
                  ? (t('list.kindCavern') as string)
                  : data.kind === 'planar'
                    ? (t('list.kindPlanar') as string)
                    : data.kind}
              </InfoRow>
              <InfoRow label={t('detail.parts')}>{data.parts.length}</InfoRow>
            </DetailSection>
            {id ? <DetailTools module="relicset" id={id} names={names} /> : null}
          </div>
        </div>
      )}
    </DetailShell>
  );
}
