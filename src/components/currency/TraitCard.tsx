/**
 * 羁绊图鉴的专属卡片（对齐原站 `/currency/trait` 的版式）
 *
 * ## 为什么单独一个组件，不用通用卡片
 *
 * 通用卡片是「图标 + 名称 + 两行描述」，适合装备 / 增益这类"看一眼就够"的条目；
 * 羁绊的信息量完全不同：它要按**激活人数**分档列出效果、列出子羁绊、列出能激活它的
 * 角色（普通角色与专家顾问分开），还有条件备注。原站因此用 md 两列的大卡片，
 * 而不是统一的小格子。
 *
 * ## 数据形状的两个坑
 *
 *  - `layer` / `sub_trait` / `remark` 都是**对象**（键是激活人数 / 子羁绊 id / 备注 id），
 *    不是数组，直接用 `Object.values` 前要按数字键排序，否则 2 会排在 10 后面；
 *  - `layer[k].buff_desc` 的 `#1[i]` 取的是 `buff_param_list`，**不是**条目自身的
 *    `param_list` —— 用错了会显示成 0 或空。
 */

import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { MacroText } from '@/components/common/MacroText';
import { SafeImage } from '@/components/common/SafeImage';
import {
  currencyDisplayName,
  currencyIconCandidates,
  currencyLayers,
  currencyParams,
  type CurrencyEntry,
  type CurrencyLayer,
} from '@/lib/data/extra';

/** 羁绊卡片属性 */
export interface TraitCardProps {
  /** 羁绊条目 */
  readonly entry: CurrencyEntry;
  /** 能激活它的普通角色 */
  readonly members: readonly CurrencyEntry[];
  /** 能激活它的专家顾问 */
  readonly advisors: readonly CurrencyEntry[];
  /** 右上角操作区（评级徽标等），由调用方决定 */
  readonly actions?: ReactNode;
  /** 右键菜单（由调用方上报实体，加入对比/收藏/笔记） */
  readonly onContextMenu?: (event: React.MouseEvent) => void;
}

/** 一条「标题 + 富文本」的小区块 */
function Section({
  title,
  children,
  accent = false,
}: {
  readonly title: string;
  readonly children: ReactNode;
  readonly accent?: boolean;
}): ReactNode {
  return (
    <div className="mt-3 border-l-2 border-line pl-3">
      <div className={`text-xs ${accent ? 'font-semibold text-accent' : 'text-dim'}`}>{title}</div>
      <div className="mt-1 flex flex-col gap-1.5">{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 形状解析                                                            */
/* ------------------------------------------------------------------ */

/** 一个子羁绊 */
interface SubTrait {
  readonly id: string;
  readonly name: string;
  readonly desc: string;
  readonly params: readonly number[];
}

/** 从对象形状的字段里取富文本（有的档位写 `desc`，有的写 `buff_desc`） */
function textOf(source: Record<string, unknown> | undefined): string {
  if (source === undefined) return '';
  for (const key of ['buff_simple_desc', 'buff_desc', 'simple_desc', 'desc']) {
    const value = source[key];
    if (typeof value === 'string' && value.trim() !== '') return value;
  }
  return '';
}

/** 从对象形状的字段里取参数表 */
function paramsOf(
  source: Record<string, unknown> | undefined,
  fallback: readonly number[],
): readonly number[] {
  if (source === undefined) return fallback;
  for (const key of ['buff_param_list', 'param_list']) {
    const value = source[key];
    if (Array.isArray(value) && value.every((item) => typeof item === 'number')) {
      return value as readonly number[];
    }
  }
  return fallback;
}

/**
 * 羁绊卡片。
 *
 * @param props 见 {@link TraitCardProps}
 */
export function TraitCard({ entry, members, advisors, actions, onContextMenu }: TraitCardProps): ReactNode {
  const { t } = useTranslation();
  const candidates = currencyIconCandidates(entry, 'trait');
  const name = currencyDisplayName(entry, 'trait', t);
  const params = currencyParams(entry);

  // 层级解析放在数据层（`currencyLayers`）：主角光环卡片要渲染**同一套** `layer` 结构，
  // 两边共用一份解析逻辑，避免「羁绊页层级 2/4/6、光环页层级 2/10/4」这类排序不一致。
  const layers = useMemo<readonly CurrencyLayer[]>(() => currencyLayers(entry), [entry]);

  const subTraits = useMemo<readonly SubTrait[]>(() => {
    const raw = entry.sub_trait ?? {};
    return Object.entries(raw).map(([key, value]) => {
      const source = value as Record<string, unknown> | undefined;
      return {
        id: key,
        name: typeof source?.name === 'string' ? source.name : key,
        desc: textOf(source),
        params: paramsOf(source, params),
      };
    });
  }, [entry, params]);

  // 条件备注：对象里每条是 `{ desc, simple_desc }`
  const remarks = useMemo<readonly { id: string; desc: string; params: readonly number[] }[]>(() => {
    const raw = entry.remark;
    if (raw === undefined || typeof raw === 'string') return [];
    return Object.entries(raw).map(([key, value]) => {
      const source = value as Record<string, unknown> | undefined;
      return {
        id: key,
        desc: textOf(source),
        params: paramsOf(source, params),
      };
    });
  }, [entry, params]);

  return (
    <div className="hsr-panel relative flex h-full flex-col rounded-card border border-line p-4" onContextMenu={onContextMenu}>
      {actions !== undefined ? <div className="absolute right-2 top-2 z-[2]">{actions}</div> : null}

      <div className="flex items-center gap-3 pr-20">
        <SafeImage
          src={candidates[0]}
          fallbacks={candidates.slice(1)}
          alt={name}
          className="h-10 w-10 shrink-0"
          imgClassName="object-contain"
        />
        <h3 className="min-w-0 break-words font-semibold text-ink">{name}</h3>
      </div>

      {typeof entry.desc === 'string' && entry.desc !== '' ? (
        <MacroText value={entry.desc} paramList={params} className="mt-3 text-sm leading-relaxed text-dim" />
      ) : null}

      {layers.length > 0 ? (
        <div className="mt-3 flex flex-col">
          {layers.map((layer) => (
            <Section key={layer.level} title={`${t('currency.layer')} ${layer.level}`}>
              <MacroText value={layer.desc} paramList={layer.params} className="text-sm text-dim" />
            </Section>
          ))}
        </div>
      ) : null}

      {subTraits.length > 0 ? (
        <Section title={t('currency.subTraits')} accent>
          {subTraits.map((sub) => (
            <div key={sub.id}>
              <div className="text-sm font-medium text-ink">{sub.name}</div>
              <MacroText value={sub.desc} paramList={sub.params} className="text-sm text-dim" />
            </div>
          ))}
        </Section>
      ) : null}

      {members.length > 0 || advisors.length > 0 ? (
        <div className="mt-auto pt-3">
          {members.length > 0 ? <MemberRow title={t('currency.members')} list={members} size="md" /> : null}
          {advisors.length > 0 ? (
            <MemberRow title={t('currency.expertAdvisors')} list={advisors} size="sm" />
          ) : null}
        </div>
      ) : null}

      {remarks.length > 0 ? (
        <Section title={t('currency.remark')}>
          {remarks.map((remark) => (
            <MacroText
              key={remark.id}
              value={remark.desc}
              paramList={remark.params}
              className="text-xs text-dim"
            />
          ))}
        </Section>
      ) : null}
    </div>
  );
}

/** 一组角色头像（原站：普通成员 48px，专家顾问 40px） */
function MemberRow({
  title,
  list,
  size,
}: {
  readonly title: string;
  readonly list: readonly CurrencyEntry[];
  readonly size: 'md' | 'sm';
}): ReactNode {
  const { t } = useTranslation();
  const box = size === 'md' ? 'h-10 w-10' : 'h-9 w-9';
  return (
    <div className="mt-2">
      <div className="mb-1.5 text-xs text-dim">{title}</div>
      <div className="flex flex-wrap gap-2">
        {list.map((member) => {
          const candidates = currencyIconCandidates(member, 'role');
          // 与角色图鉴卡片同一个显示名入口：`{NICKNAME}` → 开拓者、604202 → 帕姆王
          const label = currencyDisplayName(member, 'role', t);
          return (
            <span
              key={String(member.id)}
              className="inline-flex items-center gap-1.5 rounded-btn border border-line bg-elev px-1.5 py-1 text-xs text-dim"
              title={label}
            >
              <SafeImage
                src={candidates[0]}
                fallbacks={candidates.slice(1)}
                alt={label}
                className={`${box} shrink-0 overflow-hidden rounded-btn`}
                imgClassName="object-cover"
              />
              <span className="max-w-[6rem] truncate">{label}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
