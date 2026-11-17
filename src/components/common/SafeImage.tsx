/**
 * 图片组件（T04）
 *
 * 三条约定：
 *  1. **一律传数据包里的 `icon` 相对路径**，不要在外层用 id 拼。
 *     666 个敌人变体只对应 222 张图，按 id 拼会 2/3 全 404。
 *  2. `onError` 不是「显示占位图」就完事：还要把相对路径上报给 DAL，
 *     排障时能一次拿到完整缺图清单，而不是逐个页面点开看。
 *  3. 开发态额外 `fetch` 一次拿状态码。asset 协议在 Rust 侧把
 *     scope 拒绝 / 路径非法报成 403、文件不存在报成 404（tauri asset.rs:48/54/71），
 *     但 Tauri core 没装 logger，那三条 `log::error!` 不会出现在 stderr。
 *     所以只在这里按需自查，生产态不做这次额外请求。
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { dal } from '@/lib/data/dal';

/** 图片属性 */
export interface SafeImageProps {
  /** 数据包内相对路径，如 `img/character/1001.webp`；空值直接走占位 */
  readonly src?: string | null;
  /** 替代文本（必填，列表页用实体名） */
  readonly alt: string;
  /** 外层容器类名（决定尺寸/圆角） */
  readonly className?: string;
  /** `<img>` 自身的类名（一般 `object-contain`） */
  readonly imgClassName?: string;
  /** 首屏图片设为 true，跳过懒加载 */
  readonly eager?: boolean;
  /**
   * 候选源链：`src` 加载失败时依次尝试，全部失败才显示占位。
   * 用于「同一实体在包里有两套图标」的情况，例如货币战争角色
   * 优先用原站的 `img/character/{id}.webp`（avatarshopicon），
   * 缺失时退到 `img/avatarroundicon/{id}.webp`。
   */
  readonly fallbacks?: readonly string[];
  /** 自定义占位节点；不传则显示一个短横线 */
  readonly fallback?: ReactNode;
}

/** 图片组件 */
export function SafeImage({
  src,
  alt,
  className = '',
  imgClassName = '',
  eager = false,
  fallbacks = [],
  fallback,
}: SafeImageProps): ReactNode {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // src 变化 = 换了一条实体，必须重置加载态与候选链，否则会一直显示上一张图
  useEffect(() => {
    setAttempt(0);
    setFailed(false);
    setLoaded(false);
  }, [src]);

  const chain = useMemo(() => [src, ...fallbacks].filter((item): item is string => Boolean(item)), [src, fallbacks]);
  const current = chain[attempt];

  const handleError = useCallback((): void => {
    setLoaded(false);
    if (current) dal.reportMissingAsset(current);

    if (attempt + 1 < chain.length) {
      setAttempt(attempt + 1);
      return;
    }
    setFailed(true);

    if (import.meta.env.DEV && current) {
      let url = '';
      try {
        url = dal.assetUrl(current);
      } catch {
        return;
      }
      void fetch(url)
        .then((response) => {
          console.warn(
            `[SafeImage] ${current} → HTTP ${response.status}（403=scope/路径非法，404=文件缺失）`,
          );
        })
        .catch(() => {
          console.warn(`[SafeImage] ${current} → 协议层未通（检查 protocol-asset feature）`);
        });
    }
  }, [attempt, chain.length, current]);

  const placeholder: ReactNode = fallback ?? (
    <span aria-hidden="true" className="text-xs text-dim">
      —
    </span>
  );

  if (!current || failed) {
    return (
      <div
        className={`flex items-center justify-center bg-elev ${className}`}
        role="img"
        aria-label={alt}
      >
        {placeholder}
      </div>
    );
  }

  let url: string;
  try {
    url = dal.assetUrl(current);
  } catch {
    return (
      <div className={`flex items-center justify-center bg-elev ${className}`} role="img" aria-label={alt}>
        {placeholder}
      </div>
    );
  }

  return (
    <div className={`relative overflow-hidden bg-elev ${className}`}>
      {!loaded ? (
        <div className="absolute inset-0 animate-pulse bg-elev" aria-hidden="true" />
      ) : null}
      <img
        src={url}
        alt={alt}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        draggable={false}
        onLoad={() => setLoaded(true)}
        onError={handleError}
        className={`relative h-full w-full ${imgClassName}`}
      />
    </div>
  );
}
