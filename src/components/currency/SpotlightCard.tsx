/**
 * 主角光环图鉴的专属卡片（对齐原站 `/currency/spotlight` 的版式）
 *
 * ## 为什么单独一个组件
 *
 * 主角光环是货币战争里信息密度最高的一类条目，一张卡要装下六块内容：
 *  1. 图标 + 名称
 *  2. 标签 chips（全量，不截断 —— 它决定这套光环能进哪些阵容）
 *  3. 「敌方难度提升 +N」（原站**无条件**渲染，+0 也显示）
 *  4. 光环自身的 `desc`（宏文本，含 `<unbreak>` 等行内样式）
 *  5. `remark.desc`（小字补充，实测形如「当前提高：…」）
 *  6. `trait_id` 指向的羁绊及其**每一档**效果（层级 N）
 *  7. `recommend` 推荐角色（id 数组，头像取 `avatarroundicon/{id 前 4 位}`）
 *
 * 通用小卡只能放「图标 + 名称 + 两行描述」，所以原站这里用 md 两列 / xl 三列的大卡。
 *
 * ## 数据形状的坑
 *
 *  - `tag` 是 `[{ id, name, color }]` 对象数组（物品图鉴的 `tag` 不是这个形状）；
 *  - `remark` 是对象 `{ desc, param_list }`，没有备注时是空对象 `{}`；
 *  - `layer` 的键是档位数字字符串，必须按数字升序（见 {@link currencyLayers}）；
 *  - `trait_id` 为 `0` 表示「没有关联羁绊」，不能拿 `0` 去查表。
 */

import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { MacroText } from '@/components/common/MacroText';
import { expandGridFightInfo, replaceVariablePlaceholders } from '@/lib/text/gridfight';
import { SafeImage } from '@/components/common/SafeImage';
import {
  currencyDisplayName,
  currencyIconCandidates,
  currencyLayers,
  currencyParams,
  currencyRoleIconCandidates,
  currencyTags,
  recommendIds,
  type CurrencyEntry,
} from '@/lib/data/extra';

/** 主角光环卡片属性 */
export interface SpotlightCardProps {
  /** 光环条目 */
  readonly entry: CurrencyEntry;
  /** `entry.trait_id` 指向的羁绊条目；查不到（或 `trait_id` 为 0）时不显示层级区块 */
  readonly trait?: CurrencyEntry;
  /** 推荐角色的显示名解析（推荐列表只给 id，名字要向角色图鉴查） */
  readonly roleLabelOf: (id: string) => string;
  /**
   * `<gridfightinfo type=item id=…>` 的显示名解析（v2.19）。
   *
   * 源站这个标签自身没有正文，只给 id；不解析会在卡片上留下 `可通过【】获取…`。
   */
  readonly infoLabelOf?: (type: string, id: string) => string | undefined;
  /** 打开详情面板（图鉴没有单条路由，详情是页内弹层） */
  readonly onOpen: () => void;
  /** 右上角操作区（评级徽标等），由调用方决定 */
  readonly actions?: ReactNode;
  /** 右键菜单（由调用方上报实体，加入对比/收藏/笔记） */
  readonly onContextMenu?: (event: React.MouseEvent) => void;
}

/** 备注块的形状：`{ desc, param_list }`，没有 desc 时整块不渲染 */
interface Remark {
  readonly desc: string;
  readonly params: readonly number[];
}

/**
 * 解析主角光环的 `remark`。
 *
 * 实测三种形态：`{}`（无备注）、`{ desc, param_list: [] }`、带参数的
 * `{ desc: "当前提高：<variable …/>", param_list: [0.01] }`。
 * `desc` 缺失或为空串一律视为没有备注。
 *
 * @param entry 光环条目
 */
function remarkOf(entry: CurrencyEntry): Remark | undefined {
  const raw: unknown = entry.remark;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  const desc = typeof record.desc === 'string' ? record.desc : '';
  if (desc.trim() === '') return undefined;
  const list = record.param_list;
  const params =
    Array.isArray(list) && (list as readonly unknown[]).every((item) => typeof item === 'number')
      ? (list as readonly number[])
      : currencyParams(entry);
  return { desc, params };
}

/**
 * 主角光环卡片。
 *
 * 整卡是一个 `<button>`（视觉与原站 `<article>` 一致）：图鉴没有单条路由，详情是
 * 页内弹层，卡片不点就等于「主角光环没有任何详情入口」。评级徽标仍是**兄弟节点**
 * 绝对定位（button 里不能嵌 button），因此区段标题降级成 `div` —— 一个大按钮里
 * 放 `<h2>` 既不合内容模型，也会让读屏把整张卡念成一个标题。
 *
 * @param props 见 {@link SpotlightCardProps}
 */
export function SpotlightCard({
  entry,
  trait,
  roleLabelOf,
  infoLabelOf,
  onOpen,
  actions,
  onContextMenu,
}: SpotlightCardProps): ReactNode {
  const { t } = useTranslation();
  const name = currencyDisplayName(entry, 'spotlight', t);
  const candidates = currencyIconCandidates(entry, 'spotlight');
  const params = currencyParams(entry);
  const tags = currencyTags(entry);
  const remark = remarkOf(entry);
  // 原站无条件显示，+0 也渲染（数据里实测 0 / 3 / 5 / 8 四档）
  const difficulty = entry.enemy_diff_lv_add ?? 0;

  const layers = trait === undefined ? [] : currencyLayers(trait);
  const traitName = trait === undefined ? '' : currencyDisplayName(trait, 'trait', t);
  const recommends = recommendIds(entry);

  /**
   * 卡片内所有宏文本的统一预处理：
   *  - `<gridfightinfo>` → 条目名（物品图鉴 / 角色图鉴）
   *  - `<variable>` → 「战斗中决定」（静态包拿不到战斗内数值）
   */
  const localizeMacro = (value: string | null | undefined): string | undefined => {
    if (typeof value !== 'string' || value.trim() === '') return undefined;
    return replaceVariablePlaceholders(
      expandGridFightInfo(value, infoLabelOf),
      t('currency.determinedInBattle') as string,
    );
  };

  const descText = localizeMacro(entry.desc);
  // 「闭关」的 remark 是 `所需节点数：#1`，param_list 为空；原站显示「战斗中决定」。
  // 备注里没有可代入的参数时，把残留占位也换成同一个本地化占位。
  const remarkText =
    remark === undefined
      ? undefined
      : (() => {
          const text = localizeMacro(remark.desc);
          if (text === undefined) return undefined;
          return remark.params.length === 0
            ? text.replace(/#\d+(?:\[[^\]]+\])?%?/g, t('currency.determinedInBattle') as string)
            : text;
        })();

  return (
    <div className="relative h-full" onContextMenu={onContextMenu}>
      <button
        type="button"
        onClick={onOpen}
        className="hsr-panel group flex h-full w-full flex-col rounded-card border border-line p-4 text-left transition-colors duration-fast hover:border-accent"
      >
        {/* 图标 + 名称：pr-20 给右上角两枚评级徽标让位 */}
        <div className="flex items-center gap-3 pr-20">
          <SafeImage
            src={candidates[0]}
            fallbacks={candidates.slice(1)}
            alt={name}
            className="h-12 w-12 shrink-0"
            imgClassName="object-contain"
          />
          <div className="min-w-0 break-words font-semibold text-ink group-hover:text-accent">
            {name}
          </div>
        </div>

        {/* 标签 chips：全量显示（原站不截断），边框色取标签自带的颜色。
            ⚠️ 项目关闭了 Tailwind 的 preflight，`border` 只写 `border-width:1px`，
            没有 `border-style:solid` 就完全看不见（浏览器默认 `none`），所以这里必须带
            `border-solid`，否则标签颜色的边框会静默消失。 */}
        {tags.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
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

        <div className="mt-3 text-xs text-dim">
          {t('currency.enemyDifficulty')}
          {t('currency.labelValueSeparator')}
          <span className="font-semibold text-ink">{`+${difficulty}`}</span>
        </div>

        {descText !== undefined ? (
          <MacroText value={descText} paramList={params} className="mt-3 text-sm leading-relaxed" />
        ) : null}

        {remark !== undefined && remarkText !== undefined ? (
          <MacroText
            value={remarkText}
            paramList={remark.params}
            className="mt-3 text-xs leading-relaxed text-dim"
          />
        ) : null}

        {/* 关联羁绊：标题 + 每一档效果（层级 N）。查不到羁绊时整块不渲染 */}
        {trait !== undefined && layers.length > 0 ? (
          <div className="mt-4">
            <div className="py-2 text-sm font-semibold text-ink">{traitName}</div>
            {layers.map((layer) => (
              // flex-col：MacroText 的根节点是 <span>（行内），靠 flex 把它块级化，
              // 否则「层级 N」与效果文案会挤在同一行，`mt-1` 也不会生效
              <div key={layer.level} className="flex flex-col py-2 text-sm">
                <span className="text-xs text-dim">
                  {t('currency.layer')} {layer.level}
                </span>
                <MacroText
                  value={localizeMacro(layer.desc)}
                  paramList={layer.params}
                  className="mt-1 whitespace-pre-line"
                />
              </div>
            ))}
          </div>
        ) : null}

        {/* 推荐角色：数据只给 id，名字与头像都从角色侧派生（帕姆王 / 开拓者同样走特例） */}
        {recommends.length > 0 ? (
          <div className="mt-4">
            <div className="mb-2 text-xs font-semibold text-dim">
              {t('currency.recommendRoles')}
            </div>
            <div className="flex flex-wrap gap-2">
              {recommends.map((roleId) => {
                const iconCandidates = currencyRoleIconCandidates(roleId);
                const label = roleLabelOf(roleId);
                return (
                  <span
                    key={roleId}
                    className="inline-flex items-center gap-1.5 rounded-btn border border-line bg-elev px-2 py-1 text-xs text-dim"
                    title={label}
                  >
                    <SafeImage
                      src={iconCandidates[0]}
                      fallbacks={iconCandidates.slice(1)}
                      alt={label}
                      className="h-7 w-7 shrink-0 overflow-hidden rounded-full"
                      imgClassName="object-contain"
                    />
                    <span className="max-w-[8rem] truncate">{label}</span>
                  </span>
                );
              })}
            </div>
          </div>
        ) : null}
      </button>
      {/* 徽标是卡片的兄弟节点：button 里不能再嵌 button。tier 在左、grade 在右 */}
      {actions !== undefined ? (
        <div className="absolute right-2 top-2 z-[2] flex items-center gap-1">{actions}</div>
      ) : null}
    </div>
  );
}
