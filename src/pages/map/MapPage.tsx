/** 米游社官方互动地图（在线内嵌，带地图位置记忆） */

import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { PageHeader } from '@/components/layout/PageHeader';

/**
 * 本地壳路径：HTML 由 app 提供（用于跳过官方更新日志、隐藏二维码），
 * 地图脚本/样式仍从官方 webstatic 加载。
 */
const MAP_PATH = '/sr/app/interactive-map/index.html';

/** 默认地图：基座舱段（用户给的链接） */
const DEFAULT_HASH = '#/map/39?zoom=0.50';

/**
 * 本次进程内的地图位置。
 *
 * 用模块变量而不是 localStorage/sessionStorage：
 *  - 切到别的栏目再回来 → 停留在上次的地图；
 *  - 重新打开软件 → 模块重新加载，回到默认地图。
 */
let lastMapHash: string | undefined;

/**
 * 官方路由偶尔会拼出 `#/map/0#/map/38?zoom=0.50&center=旧地图坐标` 这种双 hash。
 * 取第二个 `#` 后面的真实路由，并丢掉旧地图的 center/shown_types，
 * 否则目标地图会沿用上一张图的中心点，出现空图或参数错误。
 */
function normalizeHash(hash: string): string | undefined {
  const second = hash.indexOf('#', 1);
  if (second <= 0) return undefined;
  const raw = hash.slice(second);
  const [path, query = ''] = raw.split('?');
  const params = new URLSearchParams(query);
  params.delete('center');
  params.delete('origin_map_id');
  params.delete('shown_types');
  const nextQuery = params.toString();
  return nextQuery === '' ? path : `${path}?${nextQuery}`;
}

export default function MapPage(): ReactNode {
  const { t } = useTranslation();
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const win = iframeRef.current?.contentWindow;
      if (!win) return;
      const hash = win.location.hash;
      if (hash === '') return;

      const fixed = normalizeHash(hash);
      if (fixed !== undefined) {
        // 官方内部导航偶尔会把旧 hash 再拼一次；直接重载到修复后的 hash。
        win.location.replace(`${window.location.origin}${MAP_PATH}${fixed}`);
        return;
      }
      lastMapHash = hash;
    }, 400);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="flex flex-col gap-3 pt-2">
      <PageHeader title={t('nav.map')} description={t('map.subtitle')} />
      <div className="h-[calc(100vh-190px)] min-h-[560px] overflow-hidden rounded-card border border-line bg-panel">
        <iframe
          ref={iframeRef}
          title={t('nav.map')}
          src={`${MAP_PATH}${lastMapHash ?? DEFAULT_HASH}`}
          className="h-full w-full border-0"
          allow="fullscreen; clipboard-write"
          referrerPolicy="no-referrer-when-downgrade"
        />
      </div>
    </div>
  );
}
