/**
 * 角色详情页（原站 `/currency/role/:id`）
 *
 * ## 为什么从弹层改成独立页
 *
 * v2.4 之前角色卡点开的是通用弹层 —— 把条目字段一个个列出来（`front_back_type:
 * Back`、`trait_list: [1002, 2009]`），对角色来说等于没内容：真正的星魂、前后排
 * 技能、三档属性都在**单条详情文件**里，汇总文件根本没有这些字段。
 *
 * 本页按原站 `nodes/13.*.js` 的分区顺序组织：
 * 立绘与星级 → 星级特质 → 羁绊 → 角色属性（三档并排）→ 前排 / 后排 / 支援技能
 * → 星魂 → 推荐光锥。
 *
 * ## 与原站的差异（都是主动取舍）
 *
 * - 原站顶部有「Version Diff」版本对比。本包只装当前版本，没有历史数据，故不提供。
 * - 原站技能等级可用滑块切换 1–15 档。这里固定按**最高档**显示，并在技能区标注；
 *   数据层已按「优先顶层 `param_list`，否则取最高 `level`」统一（见 `roleDetail.ts`）。
 * - 原站的光锥区直接列出效果文案；本包只显示光锥图、名称与星级，点进去看已有的
 *   光锥详情页（`/lightcones/:id`），避免再把 174 条光锥详情文件搬进包。
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';

import { RarityStars } from '@/components/common/EntityGrid';
import { ErrorState } from '@/components/common/ErrorState';
import { MacroText } from '@/components/common/MacroText';
import { SafeImage } from '@/components/common/SafeImage';
import { SkeletonBlock } from '@/components/common/SkeletonBlock';
import { PageHeader } from '@/components/layout/PageHeader';
import { DataAccessError } from '@/lib/data/errors';
import { dal } from '@/lib/data/dal';
import {
  currencyDisplayName,
  currencyIconCandidates,
  getCurrencyEntries,
  roleSeasonOf,
  type CurrencyEntry,
} from '@/lib/data/extra';
import { getRoleDetail, type RoleDetailData, type RoleDetailSkill, type RoleStar } from '@/lib/data/roleDetail';
import { skillTagLabel } from '@/i18n/enums';
import { useSettingsStore } from '@/stores/settings';

/** 光锥索引条目（`db/lightcone.json`，只用到这几个字段） */
interface LightconeBrief {
  readonly id: string;
  readonly name: string;
  readonly rarity?: number;
  readonly icon?: string;
}

/** 属性表的一行定义：文案 key + 图标文件 + 取值函数 */
const STAT_ROWS: readonly {
  readonly labelKey:
    | 'currencyDetail.statHp'
    | 'currencyDetail.statFront'
    | 'currencyDetail.statBack'
    | 'currencyDetail.statSpd'
    | 'currencyDetail.statHeal'
    | 'currencyDetail.statShield';
  readonly icon: string;
  readonly valueOf: (star: RoleStar) => string;
}[] = [
  { labelKey: 'currencyDetail.statHp', icon: 'img/gridfight/IconBuffHPBoost.webp', valueOf: (star) => `${star.hpRatio}%` },
  {
    labelKey: 'currencyDetail.statFront',
    icon: 'img/gridfight/IconFrontRow.webp',
    valueOf: (star) => (star.frontPower === undefined ? '-' : String(star.frontPower)),
  },
  {
    labelKey: 'currencyDetail.statBack',
    icon: 'img/gridfight/IconBackRow.webp',
    valueOf: (star) => (star.backPower === undefined ? '-' : String(star.backPower)),
  },
  { labelKey: 'currencyDetail.statSpd', icon: 'img/gridfight/IconAccele.webp', valueOf: (star) => `${star.spdRatio}%` },
  {
    labelKey: 'currencyDetail.statHeal',
    icon: 'img/gridfight/IconTreatmentIntensity.webp',
    valueOf: (star) => (star.healBase === undefined ? '-' : String(star.healBase)),
  },
  {
    labelKey: 'currencyDetail.statShield',
    icon: 'img/gridfight/IconShieldStrength.webp',
    valueOf: (star) => (star.shieldBase === undefined ? '-' : String(star.shieldBase)),
  },
];

/** 一条技能 */
function SkillCard({ skill }: { readonly skill: RoleDetailSkill }): ReactNode {
  const { t } = useTranslation();
  return (
    <article className="rounded-card border border-line bg-panel p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-sm font-semibold text-ink">{skill.name}</h4>
        {skill.tag !== '' ? (
          <span className="rounded-tag border border-solid border-line px-1.5 py-[1px] text-[11px] text-dim">
            {skillTagLabel(t, skill.tag)}
          </span>
        ) : null}
        {skill.spBase !== undefined ? (
          <span className="rounded-tag bg-elev px-1.5 py-[1px] text-[11px] text-accent">
            {t('currencyDetail.spCost') as string} {skill.spBase}
          </span>
        ) : null}
      </div>
      <div className="mt-2 text-sm text-ink">
        <MacroText value={skill.desc} paramList={skill.paramList} />
      </div>
      {skill.extras.length > 0 ? (
        <div className="mt-2 flex flex-col gap-1 border-t border-line pt-2">
          {skill.extras.map((extra) => (
            <div key={extra.name} className="text-xs text-dim">
              <span className="font-semibold text-accent">{extra.name}</span>
              <div className="mt-0.5 whitespace-pre-line">{extra.desc}</div>
            </div>
          ))}
        </div>
      ) : null}
    </article>
  );
}

/** 一个技能分区（无技能时整块不渲染） */
function SkillSection({
  title,
  skills,
}: {
  readonly title: string;
  readonly skills: readonly RoleDetailSkill[];
}): ReactNode {
  if (skills.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-display text-base font-bold text-ink">{title}</h3>
      {skills.map((skill) => (
        <SkillCard key={`${skill.id}-${skill.name}`} skill={skill} />
      ))}
    </section>
  );
}

/** 角色属性表：三档并排，当前星级列高亮 */
function StatTable({ stars, active }: { readonly stars: readonly RoleStar[]; readonly active: number }): ReactNode {
  const { t } = useTranslation();
  if (stars.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-display text-base font-bold text-ink">{t('currencyDetail.characterDetails') as string}</h3>
      <div className="overflow-x-auto rounded-card border border-line">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-elev">
              <th className="px-3 py-2 text-left text-xs font-medium text-dim">
                {t('currencyDetail.statLabel') as string}
              </th>
              {stars.map((star) => (
                <th
                  key={star.star}
                  className={`px-3 py-2 text-center text-xs font-medium ${
                    star.star === active ? 'text-accent' : 'text-dim'
                  }`}
                >
                  ★{star.star}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {STAT_ROWS.map((row) => (
              <tr key={row.labelKey} className="border-t border-line">
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2 text-xs text-dim">
                    <SafeImage src={row.icon} alt="" className="h-4 w-4 shrink-0" imgClassName="object-contain" />
                    {t(row.labelKey) as string}
                  </div>
                </td>
                {stars.map((star) => (
                  <td
                    key={star.star}
                    className={`px-3 py-2 text-center text-xs tabular-nums ${
                      star.star === active ? 'bg-elev font-semibold text-ink' : 'text-dim'
                    }`}
                  >
                    {row.valueOf(star)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** 星级特质（前排 / 后排各一条一句话描述） */
function StarTraitSection({ star }: { readonly star: RoleStar }): ReactNode {
  const { t } = useTranslation();
  const rows = [
    { key: 'front', title: t('currencyDetail.frontlineTrait') as string, text: star.frontTrait },
    { key: 'back', title: t('currencyDetail.backlineTrait') as string, text: star.backTrait },
  ].filter((row) => row.text !== '');
  if (rows.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      {rows.map((row) => (
        <article key={row.key} className="rounded-card border border-line bg-panel p-3">
          <div className="text-[11px] uppercase tracking-[0.14em] text-accent">{row.title}</div>
          <div className="mt-1 text-sm text-ink">
            <MacroText value={row.text} />
          </div>
        </article>
      ))}
    </section>
  );
}

/** 羁绊区块：名称 + 描述，点击回羁绊图鉴并自动打开该条 */
function TraitSection({
  ids,
  traits,
}: {
  readonly ids: readonly string[];
  readonly traits: readonly CurrencyEntry[];
}): ReactNode {
  const { t } = useTranslation();
  const items = useMemo(
    () => ids.map((id) => traits.find((entry) => String(entry.id) === id)).filter((entry): entry is CurrencyEntry => entry !== undefined),
    [ids, traits],
  );
  if (items.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-display text-base font-bold text-ink">{t('currencyDetail.traits') as string}</h3>
      <div className="grid gap-2 md:grid-cols-2">
        {items.map((entry) => {
          const [icon] = currencyIconCandidates(entry, 'trait');
          return (
            <Link
              key={String(entry.id)}
              to={`/currency/trait?entry=${String(entry.id)}`}
              className="flex items-start gap-3 rounded-card border border-line bg-panel p-3 transition-colors duration-fast hover:border-accent"
            >
              <SafeImage src={icon} alt="" className="h-10 w-10 shrink-0" imgClassName="object-contain" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-ink">{currencyDisplayName(entry, 'trait', t)}</div>
                {typeof entry.desc === 'string' && entry.desc !== '' ? (
                  <div className="mt-1 line-clamp-3 text-xs text-dim">
                    <MacroText value={entry.desc} paramList={Array.isArray(entry.param_list) ? entry.param_list : []} />
                  </div>
                ) : null}
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

/** 推荐光锥 */
function LightconeSection({ ids, index }: { readonly ids: readonly string[]; readonly index: readonly LightconeBrief[] }): ReactNode {
  const { t } = useTranslation();
  const items = useMemo(
    () => ids.map((id) => index.find((entry) => String(entry.id) === id)).filter((entry): entry is LightconeBrief => entry !== undefined),
    [ids, index],
  );
  if (items.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-display text-base font-bold text-ink">{t('currencyDetail.lightCones') as string}</h3>
      <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
        {items.map((item) => (
          <Link
            key={item.id}
            to={`/lightcones/${item.id}`}
            className="flex items-center gap-3 rounded-card border border-line bg-panel p-3 transition-colors duration-fast hover:border-accent"
          >
            <SafeImage
              src={item.icon}
              alt={item.name}
              className="h-20 w-14 shrink-0"
              imgClassName="object-contain"
            />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-ink">{item.name}</div>
              {typeof item.rarity === 'number' ? <RarityStars rarity={item.rarity} /> : null}
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

/** 星魂列表 */
function EidolonSection({ detail }: { readonly detail: RoleDetailData }): ReactNode {
  const { t } = useTranslation();
  if (detail.eidolons.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-display text-base font-bold text-ink">{t('currencyDetail.eidolons') as string}</h3>
      <div className="flex flex-col gap-2">
        {detail.eidolons.map((eidolon) => (
          <article key={eidolon.rank} className="rounded-card border border-line bg-panel p-3">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-elev text-xs font-semibold text-accent">
                {eidolon.rank}
              </span>
              <h4 className="text-sm font-semibold text-ink">{eidolon.name}</h4>
            </div>
            <div className="mt-2 text-sm text-ink">
              <MacroText value={eidolon.desc} paramList={eidolon.paramList} />
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

/** 角色详情页 */
export default function RoleDetailPage(): ReactNode {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const lang = useSettingsStore((state) => state.prefs.lang);

  const [detail, setDetail] = useState<RoleDetailData | undefined>(undefined);
  const [loaded, setLoaded] = useState(false);
  const [traits, setTraits] = useState<readonly CurrencyEntry[]>([]);
  const [lightcones, setLightcones] = useState<readonly LightconeBrief[]>([]);
  const [error, setError] = useState<DataAccessError | undefined>(undefined);
  const [star, setStar] = useState(1);

  useEffect(() => {
    if (id === undefined) return;
    let cancelled = false;
    setLoaded(false);
    setDetail(undefined);
    setError(undefined);
    setStar(1);
    void getRoleDetail(id, lang)
      .then((data) => {
        if (cancelled) return;
        setDetail(data);
        setLoaded(true);
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setError(DataAccessError.from(reason));
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [id, lang]);

  // 羁绊与光锥是「锦上添花」的数据：读不到就不显示对应区块，不影响主内容
  useEffect(() => {
    let cancelled = false;
    void getCurrencyEntries('trait', lang)
      .then((list) => {
        if (!cancelled) setTraits(list);
      })
      .catch(() => {
        if (!cancelled) setTraits([]);
      });
    void dal
      .readJson<LightconeBrief[]>('db/lightcone.json')
      .then((list) => {
        if (!cancelled) setLightcones(Array.isArray(list) ? list : []);
      })
      .catch(() => {
        if (!cancelled) setLightcones([]);
      });
    return () => {
      cancelled = true;
    };
  }, [lang]);

  const entry = useMemo<CurrencyEntry | undefined>(() => {
    if (detail === undefined) return undefined;
    // 只是为了让统一显示名与头像候选链吃到同一个 id / name（含帕姆王与开拓者特例）
    return { id: detail.id, name: detail.name } as CurrencyEntry;
  }, [detail]);

  const activeStar = useMemo(() => {
    if (detail === undefined) return undefined;
    return detail.stars.find((item) => item.star === star) ?? detail.stars[0];
  }, [detail, star]);

  if (id === undefined) {
    return (
      <div className="pt-2">
        <ErrorState title={t('currencyDetail.notFound') as string} actionTo="/currency/role" actionLabel={t('currencyDetail.backToList') as string} />
      </div>
    );
  }

  if (!loaded) {
    return (
      <div className="pt-2">
        <SkeletonBlock lines={8} />
      </div>
    );
  }

  if (error !== undefined) {
    return (
      <div className="pt-2">
        <ErrorState
          title={t(error.userMessageKey) as string}
          detail={`${error.code}\n${error.detail ?? error.message}`}
          actionTo="/currency/role"
          actionLabel={t('currencyDetail.backToList') as string}
        />
      </div>
    );
  }

  if (detail === undefined || entry === undefined) {
    // 两种缺失原因，提示要分开：
    // - entry 缺失：图鉴汇总里根本没有这个 id（链接错了）
    // - detail 缺失但 entry 在：汇总有这条、单条详情文件却没有 —— 典型的数据包版本旧
    //   （详情文件是 v2.5 才进包的），说成「链接失效」会把人带偏
    return (
      <div className="pt-2">
        <ErrorState
          title={t('currencyDetail.notFound') as string}
          description={
            entry === undefined
              ? (t('error.notFound.desc') as string)
              : (t('currencyDetail.missingInPack') as string)
          }
          actionTo="/currency/role"
          actionLabel={t('currencyDetail.backToList') as string}
        />
      </div>
    );
  }

  const name = currencyDisplayName(entry, 'role', t);
  const portrait = currencyIconCandidates(entry, 'role');
  const season = roleSeasonOf(detail.id);

  return (
    <div className="flex flex-col gap-5 pt-2">
      <PageHeader
        title={name}
        description={`${t('currency.seasonValue', { season: String(season) }) as string} · #${detail.id}`}
        badge={t('currency.currencyRole') as string}
        actions={
          <Link
            to="/currency/role"
            className="rounded-btn border border-line bg-elev px-3 py-1.5 text-xs text-dim hover:text-ink"
          >
            {t('currencyDetail.backToList') as string}
          </Link>
        }
      />

      {/* 头部：立绘 + 星级 + 星级切换（原站用滑块，这里用按钮，键盘可达性更好） */}
      <section className="grid gap-4 rounded-card border border-line bg-panel p-4 md:grid-cols-[12rem_1fr]">
        <SafeImage
          src={portrait[0]}
          fallbacks={portrait.slice(1)}
          alt={name}
          eager
          className="aspect-[3/4] w-full overflow-hidden rounded-btn bg-elev"
          imgClassName="object-contain p-2"
        />
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {detail.rarity > 0 ? <RarityStars rarity={detail.rarity} /> : null}
            {detail.frontBackType === 'Front' ? (
              <span className="rounded-tag border border-solid border-line px-1.5 py-[1px] text-[11px] text-dim">
                {t('currency.frontline') as string}
              </span>
            ) : null}
            {detail.frontBackType === 'Back' ? (
              <span className="rounded-tag border border-solid border-line px-1.5 py-[1px] text-[11px] text-dim">
                {t('currency.backline') as string}
              </span>
            ) : null}
            {detail.healOrShield === 'Healer' ? (
              <span className="rounded-tag border border-solid border-line px-1.5 py-[1px] text-[11px] text-dim">
                {t('currency.healer') as string}
              </span>
            ) : null}
            {detail.healOrShield === 'Shield' ? (
              <span className="rounded-tag border border-solid border-line px-1.5 py-[1px] text-[11px] text-dim">
                {t('currency.shielder') as string}
              </span>
            ) : null}
          </div>
          <div className="flex flex-col gap-1">
            <div className="text-[11px] uppercase tracking-[0.14em] text-accent">
              {t('currencyDetail.starLevel') as string}
            </div>
            <div className="flex flex-wrap gap-2">
              {detail.stars.map((item) => (
                <button
                  key={item.star}
                  type="button"
                  onClick={() => setStar(item.star)}
                  className={`rounded-btn border px-3 py-1 text-sm transition-colors duration-fast ${
                    item.star === activeStar?.star
                      ? 'border-accent bg-elev text-accent'
                      : 'border-line text-dim hover:text-ink'
                  }`}
                >
                  ★{item.star}
                </button>
              ))}
            </div>
          </div>
          {activeStar !== undefined ? <StarTraitSection star={activeStar} /> : null}
        </div>
      </section>

      <TraitSection ids={detail.traitIds} traits={traits} />

      <StatTable stars={detail.stars} active={activeStar?.star ?? 1} />

      {activeStar !== undefined ? (
        <>
          <p className="text-xs text-dim">{t('currencyDetail.valuesAtMaxLevel') as string}</p>
          <SkillSection title={t('currencyDetail.frontlineSkills') as string} skills={activeStar.frontSkills} />
          <SkillSection title={t('currencyDetail.backlineSkills') as string} skills={activeStar.backSkills} />
          <SkillSection title={t('currencyDetail.supportSkills') as string} skills={activeStar.supportSkills} />
        </>
      ) : null}

      <EidolonSection detail={detail} />

      <LightconeSection ids={detail.lightcones} index={lightcones} />
    </div>
  );
}
