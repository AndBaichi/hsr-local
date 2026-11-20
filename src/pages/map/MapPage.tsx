/** 米游社官方互动地图（在线内嵌） */

import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { PageHeader } from '@/components/layout/PageHeader';

/**
 * 官方地图页。
 *
 * `mhy_presentation_style=fullscreen` 让官方页面以全屏模式渲染。
 * 地图的点位/图片由官方接口实时加载，所以这一页需要联网；
 * iframe 是跨域的，官方页面自己的更新日志弹窗无法从外部关闭。
 */
const MAP_URL =
  '/sr/app/interactive-map/index.html#/map/39?zoom=0.50&center=-267.14,2.97&origin_map_id=&shown_types=24,306,340,137,152,193,194,218,220,71,35,659,662,667';

export default function MapPage(): ReactNode {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-3 pt-2">
      <PageHeader title={t('nav.map')} description={t('map.subtitle')} />
      <div className="h-[calc(100vh-190px)] min-h-[560px] overflow-hidden rounded-card border border-line bg-panel">
        <iframe
          title={t('nav.map')}
          src={MAP_URL}
          className="h-full w-full border-0"
          allow="fullscreen; clipboard-write"
          referrerPolicy="no-referrer-when-downgrade"
        />
      </div>
    </div>
  );
}
