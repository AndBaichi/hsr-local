/**
 * 敌人详情页（PRD §4.2 页面 9）
 *
 * 路由参数是 `groupKey`，DAL 内部会换算成 `primaryId` 去读详情文件。
 * 收藏键坚持用 `groupKey`，与列表页一致。
 */

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
import type { LocalizedNames, MonsterDetail } from '@/lib/data/types';
import { elementName, monsterRankName } from '@/lib/labels';

export default function MonsterDetailPage(): ReactNode {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const loader = useCallback((key: string, _lang: Lang) => dal.getMonster(key), []);
  const result = useDetail<MonsterDetail>(loader, id);

  const brief = useMemo(
    () => dal.getIndex('monster').find((entry) => entry.groupKey === id || entry.primaryId === id),
    [id],
  );
  const names: LocalizedNames = useMemo(
    () => brief?.names ?? (result.data ? { [result.lang]: result.data.name } : {}),
    [brief, result.data, result.lang],
  );
  // 收藏键必须与列表页一致：优先 groupKey，拿不到才退回路由参数
  const entityId = brief?.groupKey ?? id ?? '';

  return (
    <DetailShell
      result={result}
      backTo="/monsters"
      fallbackTitle={t('nav.monsters')}
      titleOf={(data) => data.name}
    >
      {(data) => (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(240px,1fr)]">
          <div className="flex flex-col gap-4">
            <DetailSection title={t('detail.overview')}>
              <div className="flex gap-4">
                <SafeImage
                  src={brief?.icon ?? data.icon}
                  alt={data.name}
                  className="h-24 w-24 shrink-0 rounded-card"
                  imgClassName="object-contain"
                  eager
                />
                <RichTextView value={data.desc} />
              </div>
            </DetailSection>

            {brief && brief.variantIds.length > 1 ? (
              <DetailSection title={t('detail.variants')}>
                <div className="flex flex-wrap gap-1.5">
                  {brief.variantIds.map((variant) => (
                    <span key={variant} className="rounded-tag border border-line bg-elev px-2 py-1 font-mono text-[11px] text-dim">
                      {variant}
                    </span>
                  ))}
                </div>
              </DetailSection>
            ) : null}
          </div>

          <div className="flex flex-col gap-4">
            <DetailSection title={t('detail.basic')}>
              <InfoRow label={t('detail.id')}>{data.id}</InfoRow>
              <InfoRow label={t('list.filterRank')}>{monsterRankName(t, data.rank)}</InfoRow>
              {data.camp ? <InfoRow label={t('detail.kind')}>{data.camp}</InfoRow> : null}
              {brief && brief.weak.length > 0 ? (
                <InfoRow label={t('detail.weakness')}>
                  <span className="flex flex-wrap justify-end gap-1">
                    {brief.weak.map((weak) => (
                      <span key={weak} className="rounded-tag border border-line bg-elev px-1.5 py-[1px] text-[11px] text-dim">
                        {elementName(t, weak)}
                      </span>
                    ))}
                  </span>
                </InfoRow>
              ) : null}
            </DetailSection>
            {entityId ? <DetailTools module="monster" id={entityId} names={names} /> : null}
          </div>
        </div>
      )}
    </DetailShell>
  );
}
