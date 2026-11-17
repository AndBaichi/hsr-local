/**
 * 左侧导航（架构文档 §8.7 SideNav、PRD §4.3）
 *
 * 骨架：首页 / 角色 / 光锥 / 遗器 / 敌人 / 物品 / 成就 / 更新日志 / 终局内容 / 货币战争
 *       ｜ 对比 / 收藏 / 笔记 ｜ 设置
 * 双态：240px（展开，图标 + 文案）/ 64px（折叠，仅图标 + Tooltip）
 *
 * 图标来源：资料库栏目优先用原站 webp（`img/nav/...`，经 SafeImage 读数据包，全离线）；
 *   更新日志无对应 webp，按原站用内联 SVG 双向箭头还原（docs §5「保留 SVG」）；
 *   工具/设置/折叠按钮继续沿用 MUI 图标。渲染优先级：image → inlineSvg → icon(MUI)。
 *   折叠态由 `AppShell` 决定并传入：手动折叠来自 prefs，窄窗口来自断点。
 */

import AutoAwesomeOutlined from '@mui/icons-material/AutoAwesomeOutlined';
import BugReportOutlined from '@mui/icons-material/BugReportOutlined';
import CompareArrowsOutlined from '@mui/icons-material/CompareArrowsOutlined';
import DiamondOutlined from '@mui/icons-material/DiamondOutlined';
import EditNoteOutlined from '@mui/icons-material/EditNoteOutlined';
import EmojiEventsOutlined from '@mui/icons-material/EmojiEventsOutlined';
import ExpandMoreOutlined from '@mui/icons-material/ExpandMoreOutlined';
import HomeOutlined from '@mui/icons-material/HomeOutlined';
import Inventory2Outlined from '@mui/icons-material/Inventory2Outlined';
import MenuOutlined from '@mui/icons-material/MenuOutlined';
import PersonOutlined from '@mui/icons-material/PersonOutlined';
import SearchOutlined from '@mui/icons-material/SearchOutlined';
import SettingsOutlined from '@mui/icons-material/SettingsOutlined';
import StarBorderOutlined from '@mui/icons-material/StarBorderOutlined';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Tooltip from '@mui/material/Tooltip';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';

import { SafeImage } from '@/components/common/SafeImage';
import { toggleWindowMaximize } from '@/components/layout/WindowControls';
import { CURRENCY_KINDS } from '@/lib/data/extra';

/** 图标组件类型（所有 MUI 图标共享同一签名，直接取其一即可） */
type IconComponent = typeof HomeOutlined;

/**
 * 停放（未删除）的原资料库 MUI 图标。
 * 资料库 7 个栏目已改用原站 webp（NavItemDefinition.image），这些 MUI 图标暂时
 * 不用，但按「先不要删东西」的要求保留在此并 export，避免 noUnusedLocals 报错；
 * 将来若要回退或复用，直接从这里取即可。
 */
export const ATTIC_LIBRARY_MUI_ICONS = {
  home: HomeOutlined,
  characters: PersonOutlined,
  lightcones: AutoAwesomeOutlined,
  relics: DiamondOutlined,
  monsters: BugReportOutlined,
  items: Inventory2Outlined,
  achievements: EmojiEventsOutlined,
} as const;

/** 导航项定义 */
interface NavItemDefinition {
  /** 路由 */
  readonly to: string;
  /** i18n key */
  readonly labelKey:
    | 'nav.home'
    | 'nav.characters'
    | 'nav.lightcones'
    | 'nav.relics'
    | 'nav.monsters'
    | 'nav.items'
    | 'nav.achievements'
    | 'nav.changelog'
    | 'nav.endgame'
    | 'nav.currency'
    | 'nav.compare'
    | 'nav.favorites'
    | 'nav.notes'
    | 'nav.settings';
  /** 原站 webp 图标：数据包内相对路径（img/nav/...），优先级最高 */
  readonly image?: string;
  /** 内联 SVG：无 webp 且需还原原站矢量图标时使用（如更新日志 /diff），次级优先 */
  readonly inlineSvg?: ReactNode;
  /** MUI 图标：webp / 内联 SVG 均缺失时的回退，以及工具/设置/折叠按钮使用 */
  readonly icon?: IconComponent;
  /** 是否精确匹配（仅首页需要，避免 `/` 吃掉所有子路由；子路由需保持高亮故不设 end） */
  readonly end?: boolean;
}

/**
 * 更新日志图标：还原原站 `/diff` 的内联 SVG 双向箭头（docs §5「保留 SVG」）。
 * 两条水平箭头：上方朝右、下方朝左；`currentColor` 跟随 text-dim / text-accent，
 * 深浅双主题自动切换，不依赖硬编码颜色或 CSS filter。
 * 外层固定 18×18 盒，与 SafeImage / MUI 图标（fontSize 18）视觉等宽，折叠态对齐。
 */
const CHANGELOG_INLINE_SVG: ReactNode = (
  <span className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center">
    <svg
      viewBox="0 0 24 24"
      width={18}
      height={18}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* 上方箭头：朝右 */}
      <path d="M4 8h16" />
      <path d="m16 4 4 4-4 4" />
      {/* 下方箭头：朝左 */}
      <path d="M20 16H4" />
      <path d="m8 12-4 4 4 4" />
    </svg>
  </span>
);

/** 资料库分组（图标为原站 webp，见 docs/03-module-expansion.md §1） */
const LIBRARY_ITEMS: readonly NavItemDefinition[] = [
  { to: '/', labelKey: 'nav.home', image: 'img/nav/phoneappicon/DataBankIcon.webp', end: true },
  { to: '/characters', labelKey: 'nav.characters', image: 'img/nav/phoneappicon/AvatarIcon.webp' },
  { to: '/lightcones', labelKey: 'nav.lightcones', image: 'img/nav/tabicon/teach/BattleTeachBasicIcon.webp' },
  { to: '/relics', labelKey: 'nav.relics', image: 'img/nav/tabicon/activity/BoxingClubIcon.webp' },
  { to: '/monsters', labelKey: 'nav.monsters', image: 'img/nav/tabicon/maze/MonsterIcon.webp' },
  { to: '/items', labelKey: 'nav.items', image: 'img/nav/phoneappicon/InventoryIcon.webp' },
  { to: '/achievements', labelKey: 'nav.achievements', image: 'img/nav/phoneappicon/AchievementIcon.webp' },
  // 新增三栏目：与路由 /changelog、/endgame、/currency 对应
  // 更新日志：原站 /diff 用内联 SVG 双向箭头、无对应 webp 资源（docs §5「保留 SVG」），
  // 用内联 SVG 还原，避免与 /compare 的 MUI 图标撞车
  { to: '/changelog', labelKey: 'nav.changelog', inlineSvg: CHANGELOG_INLINE_SVG },
  { to: '/endgame', labelKey: 'nav.endgame', image: 'img/nav/tabicon/abyss/AbyssIcon01.webp' },
  // 货币战争不在这里：它渲染成可展开分组（NavGroup），六个图鉴是它的子项，见下方 CURRENCY_SUB_ITEMS
];

/**
 * 「货币战争」分组：父项是折叠开关，子项是六个图鉴。
 *
 * 图标与文案直接复用图鉴页的数据源（`CURRENCY_KINDS` + `currency.currencyXx` 的 i18n key），
 * 避免侧栏与页面各维护一份列表。
 */
const CURRENCY_PARENT: NavItemDefinition = {
  to: '/currency',
  labelKey: 'nav.currency',
  image: 'img/nav/gridfight/icon/1001.webp',
};

/** 六个图鉴的文案 key（与图鉴页共用同一批 i18n key） */
type CurrencyLabelKey =
  | 'currency.currencyRole'
  | 'currency.currencyItem'
  | 'currency.currencyBuff'
  | 'currency.currencyAugment'
  | 'currency.currencySpotlight'
  | 'currency.currencyTrait';

/** 六个图鉴子项（文案 key 用 `currency.*`，与图鉴页一致） */
const CURRENCY_SUB_ITEMS: readonly NavSubItem[] = CURRENCY_KINDS.map((kind) => ({
  to: `/currency/${kind.key}`,
  labelKey: `currency.${kind.navKey}` as CurrencyLabelKey,
  image: kind.icon,
}));

/** 工具分组 */
const TOOL_ITEMS: readonly NavItemDefinition[] = [
  { to: '/compare', labelKey: 'nav.compare', icon: CompareArrowsOutlined },
  { to: '/favorites', labelKey: 'nav.favorites', icon: StarBorderOutlined },
  { to: '/notes', labelKey: 'nav.notes', icon: EditNoteOutlined },
];

/** 底部设置项 */
const SETTINGS_ITEM: NavItemDefinition = {
  to: '/settings',
  labelKey: 'nav.settings',
  icon: SettingsOutlined,
};

/** SideNav 属性 */
export interface SideNavProps {
  /** 是否处于折叠（仅图标）态 */
  collapsed: boolean;
  /** 切换折叠态 */
  onToggle: () => void;
  /**
   * 是否允许手动切换折叠态。
   * 窗口过窄时侧栏由断点强制折叠，此时隐藏切换按钮，避免出现「点了没反应」的按钮。
   */
  allowToggle?: boolean;
}

/** 单个导航条目 */
function NavEntry({
  item,
  collapsed,
}: {
  item: NavItemDefinition;
  collapsed: boolean;
}): ReactNode {
  const { t } = useTranslation();
  const Icon = item.icon;
  const label = t(item.labelKey);

  const link = (
    <NavLink
      to={item.to}
      end={item.end}
      aria-label={label}
      className={({ isActive }) =>
        [
          'group relative flex items-center gap-3 rounded-btn px-3 py-2 no-underline transition-colors duration-fast',
          collapsed ? 'justify-center px-0' : '',
          isActive
            ? 'bg-elev text-accent'
            : 'text-dim hover:bg-elev hover:text-ink',
        ].join(' ')
      }
    >
      {({ isActive }) => (
        <>
          {/* 激活态左侧指示条（纯 CSS，不用素材） */}
          <span
            aria-hidden="true"
            className={[
              'absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full transition-opacity duration-fast',
              isActive ? 'bg-accent opacity-100' : 'opacity-0',
            ].join(' ')}
          />
          {/* 图标渲染优先级：原站 webp（固定 18x18 盒）→ 内联 SVG → MUI 图标；皆无则不渲染 */}
          {item.image ? (
            <SafeImage
              src={item.image}
              alt={label}
              className="h-[18px] w-[18px] shrink-0"
              imgClassName="object-contain"
            />
          ) : item.inlineSvg ? (
            item.inlineSvg
          ) : Icon ? (
            <Icon style={{ fontSize: 18 }} className="shrink-0" />
          ) : null}
          {collapsed ? null : <span className="truncate text-sm">{label}</span>}
        </>
      )}
    </NavLink>
  );

  return collapsed ? (
    <Tooltip title={label} placement="right" arrow>
      {/* Tooltip 需要一个能接收 ref 的宿主，用 span 包一层 */}
      <span className="block">{link}</span>
    </Tooltip>
  ) : (
    link
  );
}

/** 分组子项（货币战争六个图鉴） */
interface NavSubItem {
  /** 路由（`/currency/:kind`） */
  readonly to: string;
  /** i18n key（`currency.currencyRole` 等） */
  readonly labelKey: CurrencyLabelKey;
  /** 原站 webp 图标 */
  readonly image: string;
}

/**
 * 可展开 / 折叠的导航分组（当前只有「货币战争」用它）。
 *
 * 交互按用户要求：点父项展开，再点折叠；**启动时默认折叠**（`useState` 初值取当前路由）。
 * 折叠成 64px 时没有展开空间，父项退化为普通链接（直接进图鉴总览页）。
 */
function NavGroup({
  parent,
  items,
  collapsed,
}: {
  readonly parent: NavItemDefinition;
  readonly items: readonly NavSubItem[];
  readonly collapsed: boolean;
}): ReactNode {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const label = t(parent.labelKey);
  const childActive = items.some((item) => location.pathname === item.to);
  const [open, setOpen] = useState(childActive);
  // 折叠态（64px）没有内联展开的空间，改为从图标右侧弹出同一组子项
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  // 深链直接落在某个图鉴（或从图鉴页的「返回」回来）时自动展开一次
  useEffect(() => {
    if (childActive) setOpen(true);
  }, [childActive]);

  if (collapsed) {
    return (
      <div>
        <Tooltip title={label} placement="right" arrow>
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={anchor !== null}
            aria-label={label}
            onClick={(event) => {
              const button = event.currentTarget;
              // 再点一次收起：同一个按钮在「开 / 关」之间切换
              setAnchor((previous) => (previous === null ? button : null));
            }}
            className={[
              'relative flex w-full items-center justify-center rounded-btn px-0 py-2 transition-colors duration-fast hover:bg-elev hover:text-ink',
              childActive || anchor !== null ? 'text-accent' : 'text-dim',
            ].join(' ')}
          >
            <SafeImage
              src={parent.image ?? ''}
              alt={label}
              className="h-[18px] w-[18px] shrink-0"
              imgClassName="object-contain"
            />
          </button>
        </Tooltip>

        <Menu
          anchorEl={anchor}
          open={anchor !== null}
          onClose={() => setAnchor(null)}
          anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
          transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        >
          {items.map((item) => (
            <MenuItem
              key={item.to}
              selected={location.pathname === item.to}
              onClick={() => {
                setAnchor(null);
                navigate(item.to);
              }}
            >
              <SafeImage
                src={item.image}
                alt={t(item.labelKey)}
                className="h-4 w-4 shrink-0"
                imgClassName="object-contain"
              />
              <span className="text-[13px]">{t(item.labelKey)}</span>
            </MenuItem>
          ))}
        </Menu>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[2px]">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={label}
        className={[
          'flex items-center gap-3 rounded-btn px-3 py-2 text-left transition-colors duration-fast hover:bg-elev hover:text-ink',
          childActive ? 'text-accent' : 'text-dim',
        ].join(' ')}
      >
        <SafeImage
          src={parent.image ?? ''}
          alt={label}
          className="h-[18px] w-[18px] shrink-0"
          imgClassName="object-contain"
        />
        <span className="truncate text-sm">{label}</span>
        <ExpandMoreOutlined
          style={{ fontSize: 16 }}
          className={[
            'ml-auto shrink-0 transition-transform duration-fast',
            open ? 'rotate-180' : '',
          ].join(' ')}
        />
      </button>

      {open ? (
        <div className="flex flex-col gap-[2px]">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              aria-label={t(item.labelKey)}
              className={({ isActive }) =>
                [
                  // 左缩进与父项文字对齐：12(px-3) + 18(图标) + 12(gap) = 42px
                  'flex items-center gap-2.5 rounded-btn py-1.5 pl-[42px] pr-3 no-underline transition-colors duration-fast',
                  isActive ? 'bg-elev text-accent' : 'text-dim hover:bg-elev hover:text-ink',
                ].join(' ')
              }
            >
              <SafeImage
                src={item.image}
                alt={t(item.labelKey)}
                className="h-4 w-4 shrink-0"
                imgClassName="object-contain"
              />
              <span className="truncate text-[13px]">{t(item.labelKey)}</span>
            </NavLink>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** 分组标题 */
function GroupLabel({ labelKey }: { labelKey: 'nav.library' | 'nav.tools' }): ReactNode {
  const { t } = useTranslation();
  return (
    <div className="px-3 pb-1 pt-4 text-xs font-medium uppercase tracking-wider text-dim opacity-70">
      {t(labelKey)}
    </div>
  );
}

/** 左侧导航 */
export function SideNav({ collapsed, onToggle, allowToggle = true }: SideNavProps): ReactNode {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <aside
      className={[
        'flex h-full shrink-0 flex-col border-r border-line bg-panel',
        'transition-[width] duration-base',
        collapsed ? 'w-nav-collapsed' : 'w-nav',
      ].join(' ')}
      aria-label={t('nav.library')}
    >
      {/* 品牌区（不使用官方 Logo，仅文字 + 渐变描边）
          v2.17：全局搜索入口从顶栏移到这里（用户指定位置）；整行可拖动窗口 */}
      <div
        data-tauri-drag-region
        onDoubleClick={(event) => {
          if ((event.target as HTMLElement).hasAttribute('data-tauri-drag-region')) {
            toggleWindowMaximize();
          }
        }}
        className={[
          'flex h-topbar shrink-0 items-center border-b border-line',
          collapsed ? 'justify-center px-0' : 'gap-2 px-4',
        ].join(' ')}
      >
        {collapsed ? null : (
          <>
            <span
              aria-hidden="true"
              className="h-2 w-2 shrink-0 rounded-full"
              style={{
                background: 'linear-gradient(135deg, var(--hsr-accent), var(--hsr-accent2))',
              }}
            />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-semibold text-ink">{t('app.name')}</span>
              {/* 副标题已按用户要求删除（不再显示「本地版」），为空时不渲染 */}
              {t('app.subtitle') ? (
                <span className="truncate text-xs text-dim">{t('app.subtitle')}</span>
              ) : null}
            </div>
          </>
        )}

        <Tooltip
          title={`${t('topbar.search') as string} · ${t('topbar.searchShortcut') as string}`}
          placement={collapsed ? 'right' : 'bottom'}
          arrow
        >
          <button
            type="button"
            onClick={() => navigate('/search', { state: { focusSearch: true } })}
            aria-label={t('topbar.search') as string}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-btn text-dim transition-colors duration-fast hover:bg-elev hover:text-ink"
          >
            <SearchOutlined style={{ fontSize: 18 }} />
          </button>
        </Tooltip>
      </div>

      {/* 导航滚动区 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {collapsed ? null : <GroupLabel labelKey="nav.library" />}
        <div className="flex flex-col gap-[2px] pt-2">
          {LIBRARY_ITEMS.map((item) => (
            <NavEntry key={item.to} item={item} collapsed={collapsed} />
          ))}
          <NavGroup parent={CURRENCY_PARENT} items={CURRENCY_SUB_ITEMS} collapsed={collapsed} />
        </div>

        <div className="my-2 border-t border-line" role="separator" />

        {collapsed ? null : <GroupLabel labelKey="nav.tools" />}
        <div className="flex flex-col gap-[2px] pt-1">
          {TOOL_ITEMS.map((item) => (
            <NavEntry key={item.to} item={item} collapsed={collapsed} />
          ))}
        </div>
      </div>

      {/* 底部：设置 + 折叠按钮 */}
      <div className="shrink-0 border-t border-line p-2">
        <div className="flex flex-col gap-[2px]">
          <NavEntry item={SETTINGS_ITEM} collapsed={collapsed} />
          {allowToggle ? (
            <Tooltip
              title={collapsed ? t('nav.expand') : t('nav.collapse')}
              placement="right"
              arrow
            >
              <button
                type="button"
                onClick={onToggle}
                aria-label={collapsed ? t('nav.expand') : t('nav.collapse')}
                className={[
                  // 与 NavEntry 保持完全一致的排版与交互（含 hover 背景）
                  'flex items-center gap-3 rounded-btn px-3 py-2 text-left text-dim transition-colors duration-fast hover:bg-elev hover:text-ink',
                  collapsed ? 'justify-center px-0' : '',
                ].join(' ')}
              >
                <MenuOutlined style={{ fontSize: 18 }} />
                {collapsed ? null : <span className="text-sm">{t('nav.collapse')}</span>}
              </button>
            </Tooltip>
          ) : null}
        </div>
      </div>
    </aside>
  );
}
