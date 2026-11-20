/**
 * 顶栏数据版本选择器。
 *
 * 不用原生 `<select>`：原生控件的字体、箭头、下拉面板在各 WebView 里差异很大，
 * 和应用的 hsr-panel / 圆角 / 描边体系不搭。这里做成自绘按钮 + 下拉面板。
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import CheckOutlined from '@mui/icons-material/CheckOutlined';
import ExpandMoreOutlined from '@mui/icons-material/ExpandMoreOutlined';

import { DATA_VIEW_OPTIONS, useDataViewStore, type DataViewVersion } from '@/stores/dataView';

/** 每个版本的展示文案 key 与状态色 */
const VERSION_META: Readonly<
  Record<
    DataViewVersion,
    {
      readonly label: string;
      readonly hintKey:
        | 'common.dataVersionHintLive'
        | 'common.dataVersionHintMid'
        | 'common.dataVersionHintLatest';
      readonly descKey:
        | 'common.dataVersionDescLive'
        | 'common.dataVersionDescMid'
        | 'common.dataVersionDescLatest';
      readonly dot: string;
    }
  >
> = {
  live: {
    label: '4.7',
    hintKey: 'common.dataVersionHintLive',
    descKey: 'common.dataVersionDescLive',
    dot: 'bg-emerald-400',
  },
  '4.7.51': {
    label: '4.7.51',
    hintKey: 'common.dataVersionHintMid',
    descKey: 'common.dataVersionDescMid',
    dot: 'bg-dim',
  },
  '4.7.52': {
    label: '4.7.52',
    hintKey: 'common.dataVersionHintLatest',
    descKey: 'common.dataVersionDescLatest',
    dot: 'bg-accent',
  },
};

/** 数据版本选择器 */
export function DataVersionPicker(): ReactNode {
  const { t } = useTranslation();
  const version = useDataViewStore((state) => state.version);
  const setVersion = useDataViewStore((state) => state.setVersion);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent): void => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const current = VERSION_META[version];

  return (
    <div ref={rootRef} className="relative flex items-center pr-2">
      <button
        type="button"
        onClick={() => {
          setOpen((value) => !value);
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls="data-version-menu"
        aria-label={t('common.dataVersion') as string}
        className={`group flex h-9 items-center gap-2 rounded-full border py-1 pl-1.5 pr-2.5 text-left transition-all duration-fast ${
          open
            ? 'border-[color:var(--hsr-accent-line)] bg-elev shadow-panel'
            : 'border-line bg-elev hover:border-[color:var(--hsr-accent-line)] hover:bg-elev'
        }`}
      >
        <span className="relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[color:var(--hsr-accent-line)] bg-[color:var(--hsr-accent-soft)]">
          <span className={`h-1.5 w-1.5 rounded-full ${current.dot}`} />
          <span className="absolute inset-0 rounded-full ring-1 ring-inset ring-white/5" />
        </span>
        <span className="min-w-0 leading-tight">
          <span className="block text-[9px] font-medium uppercase tracking-[0.14em] text-dim">
            {t('common.dataVersion')}
          </span>
          <span className="flex items-baseline gap-1.5">
            <span className="text-xs font-semibold text-ink">{current.label}</span>
            <span className="text-[10px] text-dim">{t(current.hintKey) as string}</span>
          </span>
        </span>
        <ExpandMoreOutlined
          sx={{ fontSize: 16 }}
          className={`shrink-0 text-dim transition-transform duration-fast ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open ? (
        <div
          id="data-version-menu"
          role="listbox"
          aria-label={t('common.dataVersionChoose') as string}
          className="hsr-panel absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-card border border-line p-1.5 shadow-lg"
        >
          <div className="px-2.5 pb-1.5 pt-1 text-[10px] font-medium uppercase tracking-[0.14em] text-dim">
            {t('common.dataVersionChoose')}
          </div>
          {DATA_VIEW_OPTIONS.map((option) => {
            const meta = VERSION_META[option];
            const selected = option === version;
            return (
              <button
                key={option}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  setVersion(option);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2.5 rounded-btn px-2.5 py-2 text-left transition-colors duration-fast ${
                  selected ? 'bg-[color:var(--hsr-accent-soft)]' : 'hover:bg-elev'
                }`}
              >
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border ${
                    selected
                      ? 'border-[color:var(--hsr-accent-line)] bg-[color:var(--hsr-accent-soft)]'
                      : 'border-line bg-elev'
                  }`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className="text-sm font-semibold text-ink">{meta.label}</span>
                    <span className="text-[10px] text-dim">{t(meta.hintKey) as string}</span>
                  </span>
                  <span className="mt-0.5 block text-[10px] leading-snug text-dim">
                    {t(meta.descKey) as string}
                  </span>
                </span>
                {selected ? (
                  <CheckOutlined sx={{ fontSize: 14 }} className="shrink-0 text-accent" />
                ) : null}
              </button>
            );
          })}
          <div className="mt-1 border-t border-line/70 px-2.5 py-2 text-[10px] leading-relaxed text-dim">
            {t('common.dataVersionFootnote')}
          </div>
        </div>
      ) : null}
    </div>
  );
}
