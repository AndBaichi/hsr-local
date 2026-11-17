/**
 * 角色详情页（PRD §4.2 页面 3）
 *
 * 技能按等级渲染参数占位：`paramListAtLevel(levels, level)` 由调用方解析，
 * 渲染器本身不知道「等级」这个概念。这也是 `renderRichText(paras, {paramList})`
 * 把参数表做成入参的原因。
 */

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
import type { LocalizedNames, CharacterDetail, CharacterSkill } from '@/lib/data/types';
import { elementIconPath, pathIconPath } from '@/lib/format';
import { elementName, pathName, rarityName } from '@/lib/labels';
import { paramListAtLevel } from '@/lib/text/richtext';

/** 单个技能区块（自带等级选择器） */
function SkillBlock({ skill }: { readonly skill: CharacterSkill }): ReactNode {
  const { t } = useTranslation();
  const levels = useMemo(
    () => [...skill.levels].map((entry) => entry.level).sort((a, b) => a - b),
    [skill.levels],
  );
  const [level, setLevel] = useState(levels[levels.length - 1] ?? 1);
  const paramList = useMemo(() => paramListAtLevel(skill.levels, level), [skill.levels, level]);

  return (
    <div className="flex flex-col gap-2 rounded-btn border border-line bg-elev p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <SafeImage src={skill.icon} alt={skill.name} className="h-9 w-9 rounded-tag" imgClassName="object-contain" />
          <span className="text-sm font-semibold text-ink">{skill.name}</span>
          <span className="rounded-tag border border-line px-1.5 py-[1px] text-[11px] text-dim">
            {skill.typeName ?? skill.type}
          </span>
        </div>
        {levels.length > 1 ? (
          <label className="flex items-center gap-1.5 text-xs text-dim">
            {t('detail.level')}
            <select
              value={level}
              onChange={(event) => setLevel(Number(event.target.value))}
              className="rounded-btn border border-line bg-base px-2 py-1 text-xs text-ink"
            >
              {levels.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      {skill.simpleDesc ? <p className="text-xs text-dim">{skill.simpleDesc}</p> : null}
      <RichTextView value={skill.desc} paramList={paramList} />
    </div>
  );
}

export default function CharacterDetailPage(): ReactNode {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const loader = useCallback((key: string, _lang: Lang) => dal.getCharacter(key), []);
  const result = useDetail<CharacterDetail>(loader, id);

  // 收藏/笔记要名称快照：索引里四语言齐全，优先用索引；详情兜底只有当前语言
  const names: LocalizedNames = useMemo(() => {
    const brief = dal.getIndex('character').find((entry) => entry.id === id);
    if (brief) return brief.names;
    return result.data ? { [result.lang]: result.data.name } : {};
  }, [id, result.data, result.lang]);

  return (
    <DetailShell
      result={result}
      backTo="/characters"
      fallbackTitle={t('nav.characters')}
      titleOf={(data) => data.name}
    >
      {(data) => (
        <>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(240px,1fr)]">
            <div className="flex flex-col gap-4">
              <DetailSection title={t('detail.overview')}>
                <div className="flex gap-4">
                  <SafeImage
                    src={dal.getIndex('character').find((entry) => entry.id === id)?.icon}
                    alt={data.name}
                    className="h-28 w-24 shrink-0 rounded-card"
                    imgClassName="object-contain"
                    eager
                  />
                  <div className="flex flex-col gap-1">
                    <RichTextView value={data.desc} />
                  </div>
                </div>
              </DetailSection>

              {data.skills && data.skills.length > 0 ? (
                <DetailSection title={t('detail.skills')}>
                  <div className="flex flex-col gap-2">
                    {data.skills.map((skill) => <SkillBlock key={skill.id} skill={skill} />)}
                  </div>
                </DetailSection>
              ) : null}

              {data.ranks && data.ranks.length > 0 ? (
                <DetailSection title={t('detail.ranks')}>
                  <div className="flex flex-col gap-2">
                    {data.ranks.map((rank) => (
                      <div key={rank.id} className="rounded-btn border border-line bg-elev p-3">
                        <div className="mb-1 text-sm font-semibold text-ink">{rank.name}</div>
                        <RichTextView value={rank.desc} />
                      </div>
                    ))}
                  </div>
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
                <InfoRow label={t('detail.element')}>
                  <span className="inline-flex items-center gap-1.5">
                    <SafeImage src={elementIconPath(data.element)} alt="" className="h-5 w-5" imgClassName="object-contain" />
                    {elementName(t, data.element)}
                  </span>
                </InfoRow>
                {typeof data.spNeed === 'number' ? <InfoRow label="SP">{data.spNeed}</InfoRow> : null}
              </DetailSection>
              {id ? <DetailTools module="character" id={id} names={names} /> : null}
            </div>
          </div>
        </>
      )}
    </DetailShell>
  );
}
