/**
 * 终局内容详情页（T04b）· `/endgame/:mode/:id`
 *
 * 四种模式的数据**结构完全不同**，按模式分派解析，绝不假设一个统一形状：
 *  - maze  → 数组，每关 `{ name, group_name, desc, param, challenge[], countdown, ... }`
 *  - story → 对象 `{ id, name, buff, option[], sub_option[], level[], begin_time, end_time }`
 *  - boss  → 对象，同 story 再加 `buff_list1/2/3`，`level[].name` 自带宏
 *  - peak  → 对象 `{ id, name, pre_level[], boss_level, boss_config }`
 *
 * 所有 `desc / name / challenge[].name / buff.desc / boss_config.buff_list[].desc`
 * 等都是**源站原始宏字符串**（`<color=#...>` `<unbreak>` `#1[i]` 字面 `\\n`），
 * 一律经 `MacroText` 渲染并传入匹配的参数表；不允许 dangerouslySetInnerHTML、
 * 不允许拼 HTML 字符串、不允许把宏文本当纯文本 `{string}` 输出。
 *
 * 数据来自第三方包，字段大量为 null / [] / 缺失：全程用 `asObject / asArray / asString`
 * 防御式取值，空区块直接隐藏，任一字段缺失都不会白屏。详情按 `db/{lang}/...` 读取，
 * 语言切换由 `useDetail` 自动重取。
 */

import { useCallback, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useParams } from 'react-router-dom';

import { ErrorState } from '@/components/common/ErrorState';
import { MacroText } from '@/components/common/MacroText';
import { DetailSection, DetailShell, InfoRow } from '@/components/detail/DetailShell';
import { PageHeader } from '@/components/layout/PageHeader';
import { useDetail } from '@/hooks/useDetail';
import type { Lang } from '@/i18n';
import { ENDGAME_MODES, getEndgameDetail, type EndgameMode } from '@/lib/data/extra';
import { elementName } from '@/lib/labels';
import { macroTextToPlain } from '@/lib/text/macrotext';

/** 第三方 JSON 的通用对象视图 */
type JsonObject = Record<string, unknown>;

/* ------------------------------------------------------------------ */
/* 防御式取值：任何非预期形状都被规整成「空」，绝不抛错                    */
/* ------------------------------------------------------------------ */

function asObject(value: unknown): JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? (value as readonly unknown[]) : [];
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * 参数表归一成 `readonly number[]`：
 *  - 数字（challenge[].param 实测多为单个 int）→ 包成单元素数组
 *  - 数组（buff.param / tag_list[].param）→ 过滤出有限数字
 *  - 其余（null / 缺失 / 对象）→ []，占位符由 MacroText 原样保留
 */
function asParamList(value: unknown): readonly number[] {
  if (typeof value === 'number' && Number.isFinite(value)) return [value];
  if (Array.isArray(value)) {
    return value.filter((item): item is number => typeof item === 'number' && Number.isFinite(item));
  }
  return [];
}

/** 一个「具名效果 / 挑战」对象该用的参数表：优先 param，其次 param_list */
function paramsOf(object: JsonObject): readonly number[] {
  const primary = asParamList(object.param);
  return primary.length > 0 ? primary : asParamList(object.param_list);
}

/** 该对象是否含任何可展示的值（用于过滤整段空数据） */
function meaningful(object: JsonObject): boolean {
  return Object.values(object).some((value) => {
    if (value === null || value === undefined) return false;
    if (typeof value === 'string') return value.trim() !== '';
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'object') return Object.keys(value as object).length > 0;
    return true;
  });
}

function visibleEffects(items: readonly unknown[]): readonly JsonObject[] {
  return items
    .map(asObject)
    .filter((effect) => asString(effect.name) !== undefined || asString(effect.desc) !== undefined);
}

function visibleChallenges(items: readonly unknown[]): readonly JsonObject[] {
  return items.map(asObject).filter((challenge) => asString(challenge.name) !== undefined);
}

/* ------------------------------------------------------------------ */
/* 通用渲染小件：name / desc 全部走 MacroText                             */
/* ------------------------------------------------------------------ */

/** 单个具名效果（name + desc，各自带匹配的参数表） */
function EffectCard({ effect }: { readonly effect: JsonObject }): ReactNode {
  const name = asString(effect.name);
  const desc = asString(effect.desc);
  const params = paramsOf(effect);
  return (
    <div className="flex flex-col gap-1 rounded-btn border border-line bg-elev p-3">
      {name ? (
        <div className="text-sm font-medium text-ink">
          <MacroText value={name} paramList={[]} />
        </div>
      ) : null}
      {desc ? <MacroText value={desc} paramList={params} /> : null}
    </div>
  );
}

function EffectList({ effects }: { readonly effects: readonly JsonObject[] }): ReactNode {
  return (
    <div className="flex flex-col gap-2">
      {effects.map((effect, index) => (
        <EffectCard key={`fx-${index}`} effect={effect} />
      ))}
    </div>
  );
}

/** 挑战条件：`challenge[].name` 用其自身的 param 数组渲染 */
function ChallengeList({ challenges }: { readonly challenges: readonly JsonObject[] }): ReactNode {
  return (
    <div className="flex flex-col gap-1.5">
      {challenges.map((challenge, index) => (
        <div key={`ch-${index}`} className="flex items-baseline gap-2">
          <span className="text-xs text-dim">·</span>
          <MacroText value={asString(challenge.name)} paramList={paramsOf(challenge)} />
        </div>
      ))}
    </div>
  );
}

/** 带小标题的嵌套分组（不自带面板，供放进某个 DetailSection 内） */
function LabeledBlock({ label, children }: { readonly label: string; readonly children: ReactNode }): ReactNode {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold text-dim">{label}</h3>
      {children}
    </div>
  );
}

function EmptyNotice({ message }: { readonly message: string }): ReactNode {
  return (
    <div className="hsr-panel rounded-card border border-line p-4">
      <p className="text-sm text-dim">{message}</p>
    </div>
  );
}

/** 属性标签：源站 `Thunder` 与包内枚举 `Lightning` 同义，先归一再本地化 */
function ElementTags({ t, elements }: { readonly t: TFunction; readonly elements: readonly unknown[] }): ReactNode {
  const names = elements
    .filter((value): value is string => typeof value === 'string' && value !== '')
    .map((value) => elementName(t, value === 'Thunder' ? 'Lightning' : value));
  if (names.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {names.map((name, index) => (
        <span key={`el-${index}`} className="rounded-tag border border-line bg-elev px-2 py-0.5 text-xs text-dim">
          {name}
        </span>
      ))}
    </div>
  );
}

/**
 * 关卡元数据行：推荐属性 / 轮次上限 / 敌人等级 / 敌方波次 / 开放时间。
 * 兼容 peak 的 `damage_type` 单数组与 maze/story/boss 的 `damage_type1/2` 双数组。
 * 全空返回 null（空区块自动隐藏）。
 */
function stageMetaRows(t: TFunction, stage: JsonObject): ReactNode {
  const rows: ReactNode[] = [];

  const elements: string[] = [];
  for (const field of ['damage_type', 'damage_type1', 'damage_type2']) {
    for (const value of asArray(stage[field])) {
      if (typeof value === 'string' && value !== '' && !elements.includes(value)) elements.push(value);
    }
  }
  if (elements.length > 0) {
    rows.push(
      <InfoRow key="elements" label={t('endgame.recommendedElements')}>
        <ElementTags t={t} elements={elements} />
      </InfoRow>,
    );
  }

  const countdown = asNumber(stage.countdown);
  if (countdown !== undefined) {
    rows.push(<InfoRow key="loop" label={t('endgame.maxLoop')}>{countdown}</InfoRow>);
  }

  const levels: number[] = [];
  const waves: number[] = [];
  for (const field of ['event_id_list', 'event_id_list1', 'event_id_list2']) {
    for (const raw of asArray(stage[field])) {
      const event = asObject(raw);
      const level = asNumber(event.level);
      if (level !== undefined && !levels.includes(level)) levels.push(level);
      const waveCount = asArray(event.monster_list).length;
      if (waveCount > 0 && !waves.includes(waveCount)) waves.push(waveCount);
    }
  }
  if (levels.length > 0) {
    rows.push(<InfoRow key="ml" label={t('endgame.monsterLevel')}>{levels.join(' / ')}</InfoRow>);
  }
  if (waves.length > 0) {
    rows.push(<InfoRow key="wv" label={t('endgame.enemyWaves')}>{waves.join(' / ')}</InfoRow>);
  }

  const begin = asString(stage.begin_time);
  const end = asString(stage.end_time);
  if (begin || end) {
    const text = `${begin ? begin.slice(0, 10) : '—'} → ${end ? end.slice(0, 10) : '—'}`;
    rows.push(<InfoRow key="period" label={t('endgame.period')}>{text}</InfoRow>);
  }

  if (rows.length === 0) return null;
  return <div className="flex flex-col">{rows}</div>;
}

/* ------------------------------------------------------------------ */
/* 四种结构的分派渲染                                                    */
/* ------------------------------------------------------------------ */

/** maze：数组，逐关一块面板；关卡名 / 描述 / 挑战名全走 MacroText */
function renderMaze(t: TFunction, data: unknown): ReactNode {
  const stages = asArray(data).map(asObject);
  if (stages.length === 0) return <EmptyNotice message={t('endgame.noStages')} />;

  const blocks: (ReactNode | null)[] = stages.map((stage, index) => {
    const groupName = asString(stage.group_name);
    const name = asString(stage.name);
    const desc = asString(stage.desc);
    const challenges = visibleChallenges(asArray(stage.challenge));
    const meta = stageMetaRows(t, stage);
    if (!groupName && !name && !desc && challenges.length === 0 && !meta) return null;
    return (
      <DetailSection key={`stage-${index}`} title={t('endgame.stageIndex', { index: index + 1 }) as string}>
        {groupName ? (
          <div className="text-xs text-dim">
            <MacroText value={groupName} paramList={[]} />
          </div>
        ) : null}
        {name ? (
          <div className="text-sm font-medium text-ink">
            <MacroText value={name} paramList={[]} />
          </div>
        ) : null}
        {desc ? <MacroText value={desc} paramList={paramsOf(stage)} /> : null}
        {meta}
        {challenges.length > 0 ? (
          <LabeledBlock label={t('endgame.challenge')}>
            <ChallengeList challenges={challenges} />
          </LabeledBlock>
        ) : null}
      </DetailSection>
    );
  });

  const visible = blocks.filter((block): block is ReactNode => block !== null);
  if (visible.length === 0) return <EmptyNotice message={t('endgame.noStages')} />;
  return <>{visible}</>;
}

/** story / boss：对象；boss 额外把 buff_list1/2/3 归入「效果列表」 */
function renderStoryBoss(t: TFunction, data: unknown, isBoss: boolean): ReactNode {
  const obj = asObject(data);
  const blocks: (ReactNode | null)[] = [];

  const overviewName = asString(obj.name);
  const overviewMeta = stageMetaRows(t, obj);
  if (overviewName || overviewMeta) {
    blocks.push(
      <DetailSection key="overview" title={t('detail.overview')}>
        {overviewName ? (
          <div className="text-sm font-medium text-ink">
            <MacroText value={overviewName} paramList={[]} />
          </div>
        ) : null}
        {overviewMeta}
      </DetailSection>,
    );
  }

  const buff = visibleEffects([obj.buff]);
  if (buff.length > 0) {
    blocks.push(
      <DetailSection key="buff" title={t('endgame.buff')}>
        <EffectList effects={buff} />
      </DetailSection>,
    );
  }

  const option = visibleEffects(asArray(obj.option));
  if (option.length > 0) {
    blocks.push(
      <DetailSection key="option" title={t('endgame.option')}>
        <EffectList effects={option} />
      </DetailSection>,
    );
  }

  const extra = isBoss
    ? visibleEffects([
        ...asArray(obj.buff_list1),
        ...asArray(obj.buff_list2),
        ...asArray(obj.buff_list3),
      ])
    : visibleEffects(asArray(obj.sub_option));
  if (extra.length > 0) {
    blocks.push(
      <DetailSection key="extra" title={t('endgame.effects')}>
        <EffectList effects={extra} />
      </DetailSection>,
    );
  }

  asArray(obj.level)
    .map(asObject)
    .forEach((level, index) => {
      const levelName = asString(level.name);
      const challenges = visibleChallenges(asArray(level.challenge));
      const meta = stageMetaRows(t, level);
      if (!levelName && challenges.length === 0 && !meta) return;
      blocks.push(
        <DetailSection key={`level-${index}`} title={`${t('endgame.level')} ${index + 1}`}>
          {levelName ? (
            <div className="text-sm font-medium text-ink">
              <MacroText value={levelName} paramList={[]} />
            </div>
          ) : null}
          {meta}
          {challenges.length > 0 ? (
            <LabeledBlock label={t('endgame.challenge')}>
              <ChallengeList challenges={challenges} />
            </LabeledBlock>
          ) : null}
        </DetailSection>,
      );
    });

  const visible = blocks.filter((block): block is ReactNode => block !== null);
  if (visible.length === 0) return <EmptyNotice message={t('endgame.noDetail')} />;
  return <>{visible}</>;
}

/** peak：对象，前置关卡 / 首领关卡 / 首领配置三块 + 各自的 tag_list 效果 */
function renderPeak(t: TFunction, data: unknown): ReactNode {
  const obj = asObject(data);
  const blocks: (ReactNode | null)[] = [];

  const name = asString(obj.name);
  const overviewMeta = stageMetaRows(t, obj);
  if (name || overviewMeta) {
    blocks.push(
      <DetailSection key="overview" title={t('detail.overview')}>
        {name ? (
          <div className="text-sm font-medium text-ink">
            <MacroText value={name} paramList={[]} />
          </div>
        ) : null}
        {overviewMeta}
      </DetailSection>,
    );
  }

  // pre_level / boss_level 形状一致：name + damage_type + tag_list + event_id_list
  const addLevelSection = (title: string, level: JsonObject, key: string): void => {
    const levelName = asString(level.name);
    const tags = visibleEffects(asArray(level.tag_list));
    const meta = stageMetaRows(t, level);
    if (!levelName && tags.length === 0 && !meta) return;
    blocks.push(
      <DetailSection key={key} title={title}>
        {levelName ? (
          <div className="text-sm font-medium text-ink">
            <MacroText value={levelName} paramList={[]} />
          </div>
        ) : null}
        {meta}
        {tags.length > 0 ? (
          <LabeledBlock label={t('endgame.effects')}>
            <EffectList effects={tags} />
          </LabeledBlock>
        ) : null}
      </DetailSection>,
    );
  };

  asArray(obj.pre_level)
    .map(asObject)
    .forEach((level, index) => {
      addLevelSection(`${t('endgame.preLevel')} ${index + 1}`, level, `pre-${index}`);
    });
  addLevelSection(t('endgame.bossLevel'), asObject(obj.boss_level), 'boss-level');

  const config = asObject(obj.boss_config);
  if (meaningful(config)) {
    const hardName = asString(config.hard_name);
    const buffList = visibleEffects(asArray(config.buff_list));
    const tags = visibleEffects(asArray(config.tag_list));
    const configMeta = stageMetaRows(t, config);
    blocks.push(
      <DetailSection key="boss-config" title={t('endgame.bossConfig')}>
        {hardName ? (
          <InfoRow label={t('endgame.hardMode')}>
            <MacroText value={hardName} paramList={[]} />
          </InfoRow>
        ) : null}
        {configMeta}
        {buffList.length > 0 ? (
          <LabeledBlock label={t('endgame.buff')}>
            <EffectList effects={buffList} />
          </LabeledBlock>
        ) : null}
        {tags.length > 0 ? (
          <LabeledBlock label={t('endgame.effects')}>
            <EffectList effects={tags} />
          </LabeledBlock>
        ) : null}
      </DetailSection>,
    );
  }

  const visible = blocks.filter((block): block is ReactNode => block !== null);
  if (visible.length === 0) return <EmptyNotice message={t('endgame.noDetail')} />;
  return <>{visible}</>;
}

/** 按模式分派（四种结构互不通用） */
function renderBody(mode: EndgameMode, data: unknown, t: TFunction): ReactNode {
  switch (mode) {
    case 'maze':
      return renderMaze(t, data);
    case 'story':
      return renderStoryBoss(t, data, false);
    case 'boss':
      return renderStoryBoss(t, data, true);
    case 'peak':
      return renderPeak(t, data);
    default:
      return null;
  }
}

/** 页头标题：maze 取首关 group_name（赛季名），其余取顶层 name；宏文本压成纯文本 */
function detailTitle(mode: EndgameMode, data: unknown, t: TFunction): string {
  const root = Array.isArray(data) ? asObject(data[0]) : asObject(data);
  const raw =
    mode === 'maze'
      ? (asString(root.group_name) ?? asString(root.name))
      : (asString(root.name) ?? asString(root.group_name));
  return raw ? macroTextToPlain(raw) : t('nav.endgame');
}

/* ------------------------------------------------------------------ */
/* 页面                                                                */
/* ------------------------------------------------------------------ */

export default function EndgameDetailPage(): ReactNode {
  const { t } = useTranslation();
  const { mode, id } = useParams<{ mode: string; id: string }>();

  // 校验 mode：非法值直接给友好错误，不拼出一条会 404 的数据路径
  const validMode = ENDGAME_MODES.find((entry) => entry.key === mode)?.key;

  // loader 必须稳定引用（在 useDetail 的 useEffect 依赖数组里）。
  // lang 由 useDetail 透传，自动走 db/{lang}/{mode}/{id}.json，四语言通吃。
  const loader = useCallback(
    (key: string, loadLang: Lang): Promise<unknown> =>
      getEndgameDetail<unknown>(validMode ?? 'maze', key, loadLang),
    [validMode],
  );
  const result = useDetail<unknown>(loader, validMode ? id : undefined);

  if (!validMode) {
    return (
      <div className="flex flex-col gap-4 pt-2">
        <PageHeader title={t('nav.endgame')} />
        <ErrorState
          title={t('error.notFound.title')}
          description={t('error.notFound.desc')}
          detail={mode ? String(mode) : undefined}
          actionTo="/endgame"
          actionLabel={t('endgame.back')}
        />
      </div>
    );
  }

  if (!id) {
    return (
      <div className="flex flex-col gap-4 pt-2">
        <PageHeader title={t('nav.endgame')} />
        <ErrorState
          title={t('detail.notFound')}
          actionTo="/endgame"
          actionLabel={t('endgame.back')}
        />
      </div>
    );
  }

  return (
    <DetailShell
      result={result}
      backTo="/endgame"
      fallbackTitle={t('nav.endgame')}
      titleOf={(data) => detailTitle(validMode, data, t)}
    >
      {(data) => renderBody(validMode, data, t)}
    </DetailShell>
  );
}
