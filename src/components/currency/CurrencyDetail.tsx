/**
 * 货币战争详情面板（v2.21）
 *
 * 旧实现把所有非空字段按 `DETAIL_ORDER` 逐条摊开，`tag` / `recommend` / `param`
 * 这类结构化字段会直接以 JSON 形式露出来，和原站详情差得很远。这里按图鉴类型
 * 做真正的内容布局：
 *  - spotlight：图标/名称 → 标签 → 敌方难度 → 描述 → 备注 → 关联羁绊层级 → 推荐角色
 *  - trait：图标/名称 → 描述 → 各档效果 → 子羁绊 → 条件备注
 *  - item：类型/分类 → 描述 → 装备属性
 *  - augment：品质/分类 → 描述 → 章节限制
 *  - buff：描述
 *
 * 技术字段（`icon_path` / `param_list` / `trait_id` / `is_oc_effective` …）不再展示。
 */

import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { MacroText } from '@/components/common/MacroText';
import { SafeImage } from '@/components/common/SafeImage';
import { RatingBadge } from '@/components/currency/RatingBadge';
import { currencyBadges } from '@/components/currency/badges';
import {
  currencyDisplayName,
  currencyIconCandidates,
  currencyLayers,
  currencyParams,
  currencyRoleIconCandidates,
  currencyTags,
  recommendIds,
  type CurrencyEntry,
  type CurrencyKind,
} from '@/lib/data/extra';
import { expandGridFightInfo, replaceVariablePlaceholders } from '@/lib/text/gridfight';

/** 详情面板属性 */
export interface CurrencyDetailProps {
  /** 条目 */
  readonly entry: CurrencyEntry;
  /** 图鉴类型 */
  readonly kind: CurrencyKind;
  /** 关闭面板 */
  readonly onClose: () => void;
  /** 主角光环关联的羁绊（只有 spotlight 用） */
  readonly trait?: CurrencyEntry;
  /** 角色 id → 显示名（推荐角色用） */
  readonly roleLabelOf: (id: string) => string;
  /** `<gridfightinfo>` 解析（描述里的物品/角色引用） */
  readonly infoLabelOf?: (type: string, id: string) => string | undefined;
}

/** 一个详情分区 */
function Section({ title, children }: { readonly title: string; readonly children: ReactNode }): ReactNode {
  return (
    <section className="flex flex-col gap-1 border-t border-line pt-3">
      <h3 className="text-xs font-semibold text-accent">{title}</h3>
      {children}
    </section>
  );
}

/** 属性值格式化：`*Ratio` 统一按百分比显示 */
function formatPropertyValue(propertyType: string, value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return String(value ?? '');
  if (propertyType.toLowerCase().includes('ratio')) {
    const percent = value * 100;
    return `${percent.toFixed(1).replace(/\.0$/, '')}%`;
  }
  return String(value);
}

/** 条目详情 */
export function CurrencyDetail({
  entry,
  kind,
  onClose,
  trait,
  roleLabelOf,
  infoLabelOf,
}: CurrencyDetailProps): ReactNode {
  const { t } = useTranslation();
  const name = currencyDisplayName(entry, kind, t);
  const candidates = currencyIconCandidates(entry, kind);
  const params = currencyParams(entry);
  const badges = currencyBadges(entry, t);
  const id = String(entry.id);
  const placeholder = t('currency.determinedInBattle') as string;
  const localize = (value: string): string =>
    replaceVariablePlaceholders(expandGridFightInfo(value, infoLabelOf), placeholder);
  const desc =
    typeof entry.desc === 'string' && entry.desc.trim() !== ''
      ? entry.desc
      : typeof entry.simple_desc === 'string'
        ? entry.simple_desc
        : undefined;

  const layers = currencyLayers(entry);
  const tags = currencyTags(entry);
  const headerBadges =
    kind === 'spotlight'
      ? badges.filter((badge) => !tags.some((tag) => tag.name === badge))
      : badges;
  const recommends = recommendIds(entry);
  const difficulty = typeof entry.enemy_diff_lv_add === 'number' ? entry.enemy_diff_lv_add : 0;

  const subTraits: { id: string; name: string; desc: string; params: readonly number[] }[] = (() => {
    const raw = entry.sub_trait;
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return [];
    return Object.entries(raw as Record<string, unknown>).map(([subId, value]) => {
      const record = value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
      const descValue = typeof record.buff_desc === 'string' ? record.buff_desc : record.desc;
      const paramValue = Array.isArray(record.buff_param_list)
        ? (record.buff_param_list as readonly number[])
        : params;
      return {
        id: subId,
        name: typeof record.name === 'string' && record.name !== '' ? record.name : subId,
        desc: typeof descValue === 'string' ? descValue : '',
        params: paramValue,
      };
    });
  })();

  const properties = Array.isArray(entry.general_property_list)
    ? (entry.general_property_list as readonly Record<string, unknown>[])
    : [];
  const chapterLimits = Array.isArray(entry.chapter_limit_list)
    ? (entry.chapter_limit_list as readonly unknown[]).map(String)
    : [];

  const spotlightTraitLayers = trait === undefined ? [] : currencyLayers(trait);
  const traitName = trait === undefined ? '' : currencyDisplayName(trait, 'trait', t);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <SafeImage
          src={candidates[0]}
          fallbacks={candidates.slice(1)}
          alt={name}
          className="h-16 w-16 shrink-0 rounded-btn border border-line bg-elev"
          imgClassName="object-contain p-1"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="break-words text-base font-semibold text-ink">{name}</div>
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-dim">
            <span className="font-mono">#{id}</span>
            <RatingBadge kind={kind} id={id} size="md" variant="tier" />
            <RatingBadge kind={kind} id={id} size="md" />
          </div>
          {headerBadges.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {headerBadges.map((badge) => (
                <span key={badge} className="rounded-tag border border-line bg-elev px-1.5 py-[1px] text-[11px] text-dim">
                  {badge}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-btn border border-line bg-elev px-2.5 py-1 text-xs text-dim hover:text-ink"
        >
          {t('common.close') as string}
        </button>
      </div>

      {kind === 'spotlight' ? (
        <>
          {tags.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <span
                  key={String(tag.id)}
                  className="rounded-tag border border-solid px-2 py-0.5 text-xs text-dim"
                  style={{ borderColor: tag.color }}
                >
                  {typeof tag.name === 'string' && tag.name !== '' ? tag.name : String(tag.id)}
                </span>
              ))}
            </div>
          ) : null}
          <div className="text-xs text-dim">
            {t('currency.enemyDifficulty')}
            {t('currency.labelValueSeparator')}
            <span className="font-semibold text-ink">{`+${difficulty}`}</span>
          </div>
          {desc !== undefined ? (
            <MacroText value={localize(desc)} paramList={params} className="text-sm leading-relaxed" />
          ) : null}
          {entry.remark !== null && typeof entry.remark === 'object' && !Array.isArray(entry.remark) ? (
            (() => {
              const remark = entry.remark as Record<string, unknown>;
              const remarkDesc = typeof remark.desc === 'string' ? remark.desc : '';
              if (remarkDesc.trim() === '') return null;
              const remarkParams = Array.isArray(remark.param_list)
                ? (remark.param_list as readonly number[])
                : params;
              return (
                <MacroText
                  value={localize(remarkDesc)}
                  paramList={remarkParams}
                  className="text-xs leading-relaxed text-dim"
                />
              );
            })()
          ) : null}
          {trait !== undefined && spotlightTraitLayers.length > 0 ? (
            <Section title={traitName}>
              {spotlightTraitLayers.map((layer) => (
                <div key={layer.level} className="flex flex-col py-1">
                  <span className="text-xs text-dim">
                    {t('currency.layer')} {layer.level}
                  </span>
                  <MacroText value={localize(layer.desc)} paramList={layer.params} className="mt-1 text-sm" />
                </div>
              ))}
            </Section>
          ) : null}
          {recommends.length > 0 ? (
            <Section title={t('currency.recommendRoles') as string}>
              <div className="flex flex-wrap gap-2">
                {recommends.map((roleId) => {
                  const icons = currencyRoleIconCandidates(roleId);
                  const label = roleLabelOf(roleId);
                  return (
                    <span
                      key={roleId}
                      className="inline-flex items-center gap-1.5 rounded-btn border border-line bg-elev px-2 py-1 text-xs text-dim"
                      title={label}
                    >
                      <SafeImage
                        src={icons[0]}
                        fallbacks={icons.slice(1)}
                        alt={label}
                        className="h-7 w-7 shrink-0 overflow-hidden rounded-full"
                        imgClassName="object-contain"
                      />
                      <span className="max-w-[8rem] truncate">{label}</span>
                    </span>
                  );
                })}
              </div>
            </Section>
          ) : null}
        </>
      ) : null}

      {kind === 'trait' ? (
        <>
          {desc !== undefined ? (
            <MacroText value={localize(desc)} paramList={params} className="text-sm leading-relaxed" />
          ) : null}
          {layers.length > 0 ? (
            <Section title={t('currency.effect') as string}>
              {layers.map((layer) => (
                <div key={layer.level} className="flex flex-col py-1">
                  <span className="text-xs text-dim">
                    {t('currency.layer')} {layer.level}
                  </span>
                  <MacroText value={localize(layer.desc)} paramList={layer.params} className="mt-1 text-sm" />
                </div>
              ))}
            </Section>
          ) : null}
          {subTraits.length > 0 ? (
            <Section title={t('currency.subTraits') as string}>
              {subTraits.map((sub) => (
                <div key={sub.id} className="py-1">
                  <div className="text-sm font-medium text-ink">{sub.name}</div>
                  {sub.desc !== '' ? (
                    <MacroText value={localize(sub.desc)} paramList={sub.params} className="text-sm text-dim" />
                  ) : null}
                </div>
              ))}
            </Section>
          ) : null}
        </>
      ) : null}

      {kind === 'item' ? (
        <>
          {desc !== undefined ? (
            <MacroText value={localize(desc)} paramList={params} className="text-sm leading-relaxed" />
          ) : null}
          {properties.length > 0 ? (
            <Section title={t('currency.properties') as string}>
              <div className="flex flex-col gap-1">
                {properties.map((property, index) => (
                  <div key={`${String(property.property_type ?? index)}-${index}`} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-dim">
                      {typeof property.name === 'string' ? property.name : String(property.property_type ?? '')}
                    </span>
                    <span className="font-medium text-ink">
                      {formatPropertyValue(String(property.property_type ?? ''), property.value)}
                    </span>
                  </div>
                ))}
              </div>
            </Section>
          ) : null}
        </>
      ) : null}

      {kind === 'augment' ? (
        <>
          {desc !== undefined ? (
            <MacroText value={localize(desc)} paramList={params} className="text-sm leading-relaxed" />
          ) : null}
          {chapterLimits.length > 0 ? (
            <Section title={t('currency.chapterLimit') as string}>
              <div className="text-sm text-dim">{chapterLimits.join(' / ')}</div>
            </Section>
          ) : null}
        </>
      ) : null}

      {kind === 'buff' && desc !== undefined ? (
        <MacroText value={localize(desc)} paramList={params} className="text-sm leading-relaxed" />
      ) : null}
    </div>
  );
}
