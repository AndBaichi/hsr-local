/** 光锥详情页（PRD §4.2 页面 5）：叠影等级切换会实时重渲染参数占位 */

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';

import { RichTextView } from '@/components/common/RichTextView';
import { SafeImage } from '@/components/common/SafeImage';
import { DetailSection, DetailShell, InfoRow } from '@/components/detail/DetailShell';
import { DetailTools } from '@/components/detail/DetailTools';
import { useDetail } from '@/hooks/useDetail';
import type { Lang } from '@/i18n';
import { dal } from '@/lib/data/dal';
import type { LocalizedNames, LightconeDetail } from '@/lib/data/types';
import { pathIconPath } from '@/lib/format';
import { pathName, rarityName } from '@/lib/labels';
import { paramListAtLevel } from '@/lib/text/richtext';

export default function LightconeDetailPage(): ReactNode {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const loader = useCallback((key: string, _lang: Lang) => dal.getLightcone(key), []);
  const result = useDetail<LightconeDetail>(loader, id);

  const [level, setLevel] = useState(1);
  const refinement = result.data?.refinement;
  const levels = useMemo(
    () => (refinement ? [...refinement.levels].map((entry) => entry.level).sort((a, b) => a - b) : []),
    [refinement],
  );
  const paramList = useMemo(
    () => (refinement ? paramListAtLevel(refinement.levels, level) : []),
    [refinement, level],
  );

  const names: LocalizedNames = useMemo(() => {
    const brief = dal.getIndex('lightcone').find((entry) => entry.id === id);
    if (brief) return brief.names;
    return result.data ? { [result.lang]: result.data.name } : {};
  }, [id, result.data, result.lang]);

  return (
    <DetailShell
      result={result}
      backTo="/lightcones"
      fallbackTitle={t('nav.lightcones')}
      titleOf={(data) => data.name}
    >
      {(data) => (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(240px,1fr)]">
          <div className="flex flex-col gap-4">
            <DetailSection title={t('detail.overview')}>
              <div className="flex gap-4">
                <SafeImage
                  src={dal.getIndex('lightcone').find((entry) => entry.id === id)?.icon}
                  alt={data.name}
                  className="h-28 w-24 shrink-0 rounded-card"
                  imgClassName="object-contain"
                  eager
                />
                <RichTextView value={data.desc} />
              </div>
            </DetailSection>

            {refinement ? (
              <DetailSection
                title={`${t('detail.refinement')} · ${refinement.name}`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs text-dim">{t('detail.level')}</span>
                  <select
                    value={level}
                    onChange={(event) => setLevel(Number(event.target.value))}
                    className="rounded-btn border border-line bg-elev px-2 py-1 text-xs text-ink"
                  >
                    {levels.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </div>
                <RichTextView value={refinement.desc} paramList={paramList} />
              </DetailSection>
            ) : null}
          </div>

          <div className="flex flex-col gap-4">
            <DetailSection title={t('detail.basic')}>
              <InfoRow label={t('detail.id')}>{data.id}</InfoRow>
              <InfoRow label={t('detail.rarity')}>{rarityName(t, data.rarity)}</InfoRow>
              <InfoRow label={t('detail.path')}>
                <span className="inline-flex items-center gap-1.5">
                  <SafeImage src={pathIconPath(data.path)} alt="" className="h-5 w-5" imgClassName="object-contain" />
                  {pathName(t, data.path)}
                </span>
              </InfoRow>
            </DetailSection>
            {id ? <DetailTools module="lightcone" id={id} names={names} /> : null}
          </div>
        </div>
      )}
    </DetailShell>
  );
}
