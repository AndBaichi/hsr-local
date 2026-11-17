/**
 * 物品详情页（PRD §4.2 页面 11）
 *
 * 字段覆盖率（1606 条实测）：desc 56.9% / bgDesc 92.3% / comefrom 26.3% / pileLimit 100%。
 * 所以「空则整块隐藏」，不要显示「暂无」——否则 74% 的物品会挂着一条像坏掉的空文案。
 * `returnItemIds` 恒为空数组、`customData` 仅 1 条有值，首版不渲染。
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
import type { LocalizedNames, ItemDetail } from '@/lib/data/types';
import { itemTypeName, rarityName } from '@/lib/labels';

export default function ItemDetailPage(): ReactNode {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const loader = useCallback((key: string, _lang: Lang) => dal.getItem(key), []);
  const result = useDetail<ItemDetail>(loader, id);

  const names: LocalizedNames = useMemo(() => {
    const brief = dal.getIndex('item').find((entry) => entry.id === id);
    if (brief) return brief.names;
    return result.data ? { [result.lang]: result.data.name } : {};
  }, [id, result.data, result.lang]);

  return (
    <DetailShell
      result={result}
      backTo="/items"
      fallbackTitle={t('nav.items')}
      titleOf={(data) => data.name}
    >
      {(data) => (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(240px,1fr)]">
          <div className="flex flex-col gap-4">
            {data.desc && data.desc.length > 0 ? (
              <DetailSection title={t('detail.desc')}>
                <RichTextView value={data.desc} />
              </DetailSection>
            ) : null}

            {data.bgDesc && data.bgDesc.length > 0 ? (
              <DetailSection title={t('detail.bgDesc')}>
                <RichTextView value={data.bgDesc} />
              </DetailSection>
            ) : null}

            {data.comefrom && data.comefrom.length > 0 ? (
              <DetailSection title={t('detail.source')}>
                <div className="flex flex-col gap-1 text-sm text-ink">
                  {data.comefrom.map((source, index) => (
                    <span key={index}>{typeof source === 'string' ? source : JSON.stringify(source)}</span>
                  ))}
                </div>
              </DetailSection>
            ) : null}
          </div>

          <div className="flex flex-col gap-4">
            <DetailSection title={t('detail.basic')}>
              <div className="mb-3 flex justify-center">
                <SafeImage src={data.icon} alt={data.name} className="h-24 w-24 rounded-card" imgClassName="object-contain" eager />
              </div>
              <InfoRow label={t('detail.id')}>{data.id}</InfoRow>
              <InfoRow label={t('detail.rarity')}>{rarityName(t, data.rarity)}</InfoRow>
              <InfoRow label={t('detail.mainType')}>{itemTypeName(t, data.mainType)}</InfoRow>
              {data.subType !== data.mainType ? <InfoRow label={t('detail.subType')}>{itemTypeName(t, data.subType)}</InfoRow> : null}
              {typeof data.pileLimit === 'number' ? (
                <InfoRow label={t('detail.pileLimit')}>{data.pileLimit.toLocaleString()}</InfoRow>
              ) : null}
            </DetailSection>
            {id ? <DetailTools module="item" id={id} names={names} /> : null}
          </div>
        </div>
      )}
    </DetailShell>
  );
}
