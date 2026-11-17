/**
 * 货币战争条目评级徽标（C / B / A / S / SS / SSS，以及恒显示「千」的第二套评级）
 *
 * ## 形态
 *
 * 一个描边小方块，显示在词条卡片**右上角**：未评时是 `-`，已评时是档位字母。
 * 颜色随档位（C 灰 / B 白 / A 绿 / S 紫 / SS 金 / SSS 红）。点击弹出档位菜单，
 * 直接选档，不用循环点六次。
 *
 * ## 两套评级
 *
 * `variant` 决定这个徽标读写哪一套：
 *  - `grade`（默认）：显示档位字母，数据字段 `grade`
 *  - `tier`：文字恒为「千」，只靠颜色区分档位，数据字段 `tier`
 *
 * 两套数据完全独立（见 `stores/ratings.ts` 的 `RatingEntry`），所以同一词条可以
 * 「千-红 + A」并存。调用方把两枚徽标并排放，tier 在左 grade 在右。
 *
 * ## 备注
 *
 * 备注挂在同一个 `RatingEntry` 上，但**两枚徽标都能触发它的展示**：悬停任一徽标
 * 都浮出备注气泡（没有备注就不浮，避免空气泡）。编辑入口放在档位菜单底部，
 * 因为徽标本身只能承载"点开一个菜单"，写长文本需要文本框。
 *
 * ## 为什么点击目标是徽标本身，不是整张卡
 *
 * 卡片主体已经是「打开详情面板」的按钮（`EntryCardButton`）。若把整卡点击改成
 * 改评级，就没有自然的"看详情"手势了。所以徽标单独做按钮，卡片行为不变。
 *
 * ## 为什么不用 `<MenuItem>` 包一层 `<button>`
 *
 * 卡片本身就是 `<button>`，徽标不能嵌进去（button 里不能放 button）。
 * 调用方把徽标放在卡片的**兄弟**节点、用绝对定位叠在右上角，见 `CurrencyPage`。
 */

import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';

import {
  RATING_GRADES,
  ratingKeyOf,
  REMARK_MAX_LENGTH,
  type RatingGrade,
} from '@/lib/userdata/types';
import { useRatingsStore } from '@/stores/ratings';

/** 档位 → 颜色（色值只在 `tokens.css` 定义，这里只引用变量） */
export const RATING_COLOR: Readonly<Record<RatingGrade, string>> = {
  C: 'var(--hsr-rating-c)',
  B: 'var(--hsr-rating-b)',
  A: 'var(--hsr-rating-a)',
  S: 'var(--hsr-rating-s)',
  SS: 'var(--hsr-rating-ss)',
  SSS: 'var(--hsr-rating-sss)',
};

/** 第二套评级的徽标文字：恒为「千」，档位只体现在颜色上 */
const TIER_LABEL = '千';

/** 徽标属性 */
export interface RatingBadgeProps {
  /** 图鉴种类（role / item / …） */
  readonly kind: string;
  /** 条目 id */
  readonly id: string;
  /** 尺寸：卡片用 sm，详情面板用 md */
  readonly size?: 'sm' | 'md';
  /** 是否允许点击修改（详情面板里同样允许；将来只读场景传 false） */
  readonly interactive?: boolean;
  /** 显示哪一套评级：`grade` 显示字母（默认），`tier` 恒显示「千」 */
  readonly variant?: 'grade' | 'tier';
}

/**
 * 评级徽标 + 档位菜单 + 备注对话框。
 *
 * @param props 见 {@link RatingBadgeProps}
 */
export function RatingBadge({
  kind,
  id,
  size = 'sm',
  interactive = true,
  variant = 'grade',
}: RatingBadgeProps): ReactNode {
  const { t } = useTranslation();
  // 选择器必须返回 `items[key]` 这个稳定引用本身：在这里构造新对象会让
  // zustand 的 Object.is 比较永远为 false，触发无限重渲染
  const entry = useRatingsStore((state) => state.items[ratingKeyOf(kind, id)]);
  const setGrade = useRatingsStore((state) => state.setGrade);
  const setTier = useRatingsStore((state) => state.setTier);
  const setGradeRemark = useRatingsStore((state) => state.setGradeRemark);
  const setTierRemark = useRatingsStore((state) => state.setTierRemark);

  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [remarkOpen, setRemarkOpen] = useState(false);
  const [draft, setDraft] = useState('');

  const isTier = variant === 'tier';
  const current = isTier ? entry?.tier : entry?.grade;
  // 两套备注独立：tier 徽标读 tierRemark，grade 徽标读 gradeRemark
  const remark = isTier ? entry?.tierRemark : entry?.gradeRemark;
  const commitRemark = isTier ? setTierRemark : setGradeRemark;

  const color = current === undefined ? 'var(--hsr-text-dim)' : RATING_COLOR[current];
  const label = current === undefined ? '-' : isTier ? TIER_LABEL : current;
  const box = size === 'md' ? 'h-6 min-w-8 px-2 text-sm' : 'h-5 min-w-7 px-1.5 text-[11px]';
  const featureName = isTier ? t('currency.tier') : t('currency.rating');
  // 有备注时提示交给 Tooltip，这里不再设原生 title（否则两个提示会叠在一起）
  const nativeTitle =
    remark !== undefined
      ? undefined
      : current === undefined
        ? t(isTier ? 'currency.tierNone' : 'currency.ratingNone')
        : featureName;

  /**
   * 打开备注对话框，并用当前备注初始化草稿。
   *
   * 草稿在打开时一次性赋值（不在 `useEffect` 里同步 `entry.remark`）：否则用户在
   * 文本框里打字期间，一次来自别处的 store 变更就会把草稿冲掉。
   */
  const openRemark = (): void => {
    setDraft(remark ?? '');
    setRemarkOpen(true);
  };

  const badgeButton = (
    <button
      type="button"
      // 卡片是可点击的链接/按钮，徽标点击不该顺带把详情打开
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (interactive) setAnchor(event.currentTarget);
      }}
      disabled={!interactive}
      title={nativeTitle}
      aria-label={`${featureName} ${label}`}
      className={`inline-flex items-center justify-center rounded-tag border font-semibold leading-none tabular-nums transition-colors duration-fast ${box} ${
        interactive ? 'cursor-pointer hover:brightness-125' : 'cursor-default'
      }`}
      style={{
        color,
        borderColor: color,
        // 底色压一层页面底：卡片本身有面板底色，徽标要能"浮"在上面才读得清
        backgroundColor: 'var(--hsr-bg)',
      }}
    >
      {label}
    </button>
  );

  return (
    <>
      {remark === undefined ? (
        badgeButton
      ) : (
        <Tooltip
          title={remark}
          placement="top"
          enterDelay={250}
          // 包一层 span 而不是直接给 button：Tooltip 需要子节点能接 ref，
          // 且 button 在 disabled 时不派发鼠标事件
          slotProps={{
            tooltip: {
              sx: { maxWidth: 240, whiteSpace: 'pre-wrap', fontSize: 12, lineHeight: 1.5 },
            },
          }}
        >
          <span className="inline-flex">{badgeButton}</span>
        </Tooltip>
      )}

      <Menu
        anchorEl={anchor}
        open={anchor !== null}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { minWidth: 132 } } }}
      >
        {RATING_GRADES.map((candidate) => (
          <MenuItem
            key={candidate}
            selected={candidate === current}
            onClick={() => {
              if (isTier) setTier(kind, id, candidate);
              else setGrade(kind, id, candidate);
              setAnchor(null);
            }}
            sx={{ fontSize: 13, fontWeight: 600, color: RATING_COLOR[candidate] }}
            // 「千」六项文字相同，靠 aria-label 区分档位
            aria-label={`${featureName} ${candidate}`}
          >
            {isTier ? TIER_LABEL : candidate}
          </MenuItem>
        ))}
        <MenuItem
          onClick={() => {
            if (isTier) setTier(kind, id, null);
            else setGrade(kind, id, null);
            setAnchor(null);
          }}
          disabled={current === undefined}
          sx={{ fontSize: 13, color: 'var(--hsr-text-dim)' }}
        >
          {t('currency.ratingClear')}
        </MenuItem>
        {/* 备注入口放在档位下面：两套评级的菜单各改各自的备注 */}
        <MenuItem
          onClick={() => {
            setAnchor(null);
            openRemark();
          }}
          sx={{ fontSize: 13, color: 'var(--hsr-text-dim)' }}
        >
          {isTier ? t('currency.tierRemark') : t('currency.gradeRemark')}
        </MenuItem>
      </Menu>

      <Dialog
        open={remarkOpen}
        maxWidth="xs"
        fullWidth
        // 遮罩 / Esc 等同取消：草稿不落盘，用户下次进来仍是已保存的备注
        onClose={() => setRemarkOpen(false)}
      >
        <DialogTitle>{isTier ? t('currency.tierRemarkTitle') : t('currency.gradeRemarkTitle')}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            multiline
            rows={4}
            fullWidth
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={t('currency.remarkPlaceholder')}
            slotProps={{ htmlInput: { maxLength: REMARK_MAX_LENGTH } }}
            helperText={`${draft.length}/${REMARK_MAX_LENGTH}`}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setRemarkOpen(false)}>{t('common.cancel')}</Button>
          <Button
            onClick={() => {
              commitRemark(kind, id, '');
              setDraft('');
              setRemarkOpen(false);
            }}
            disabled={remark === undefined}
          >
            {t('currency.remarkClear')}
          </Button>
          <Button
            variant="contained"
            onClick={() => {
              commitRemark(kind, id, draft);
              setRemarkOpen(false);
            }}
          >
            {t('common.confirm')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
