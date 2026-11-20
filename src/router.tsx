/**
 * 路由定义（架构文档 §8.2 `src/router.tsx`、PRD §4.1）
 *
 * 选择说明：
 *  - 使用 **HashRouter**（`createHashRouter`）。Tauri 生产环境的页面由自定义协议服务，
 *    深层链接直接用 BrowserRouter 会在刷新/直达时 404；hash 路由在 Tauri 内最稳。
 *  - 使用 **data router** 只为拿到 `errorElement`（等价于「路由级错误边界」），
 *    不定义任何 loader/action —— 架构文档 §2.1 明确要求不与 Tauri 环境耦合。
 *  - 20 个业务页面 + 404 全部走 `React.lazy`，首屏只加载 AppShell + 首页。
 */

import { Suspense, lazy, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  RouterProvider,
  createHashRouter,
  isRouteErrorResponse,
  useRouteError,
  type RouteObject,
} from 'react-router-dom';

import { SkeletonBlock } from '@/components/common/SkeletonBlock';
import { AppShell } from '@/components/layout/AppShell';
import { ErrorState } from '@/components/common/ErrorState';
import NotFoundPage from '@/pages/error/NotFoundPage';

/* ---------------- 懒加载页面（21 个） ---------------- */

const HomePage = lazy(() => import('@/pages/home/HomePage'));

const CharacterListPage = lazy(() => import('@/pages/characters/CharacterListPage'));
const CharacterDetailPage = lazy(() => import('@/pages/characters/CharacterDetailPage'));

const LightconeListPage = lazy(() => import('@/pages/lightcones/LightconeListPage'));
const LightconeDetailPage = lazy(() => import('@/pages/lightcones/LightconeDetailPage'));

const RelicListPage = lazy(() => import('@/pages/relics/RelicListPage'));
const RelicDetailPage = lazy(() => import('@/pages/relics/RelicDetailPage'));

const MonsterListPage = lazy(() => import('@/pages/monsters/MonsterListPage'));
const MonsterDetailPage = lazy(() => import('@/pages/monsters/MonsterDetailPage'));

const ItemListPage = lazy(() => import('@/pages/items/ItemListPage'));
const ItemDetailPage = lazy(() => import('@/pages/items/ItemDetailPage'));

const AchievementsPage = lazy(() => import('@/pages/achievements/AchievementsPage'));

const ComparePage = lazy(() => import('@/pages/compare/ComparePage'));
const SearchPage = lazy(() => import('@/pages/search/SearchPage'));
const FavoritesPage = lazy(() => import('@/pages/favorites/FavoritesPage'));
const NotesPage = lazy(() => import('@/pages/notes/NotesPage'));
const SettingsPage = lazy(() => import('@/pages/settings/SettingsPage'));
const MapPage = lazy(() => import('@/pages/map/MapPage'));

// 新增栏目（更新日志 / 终局内容 / 货币战争）；后两个详情页由并行 worker 创建
const ChangelogPage = lazy(() => import('@/pages/changelog/ChangelogPage'));
const EndgamePage = lazy(() => import('@/pages/endgame/EndgamePage'));
const EndgameDetailPage = lazy(() => import('@/pages/endgame/EndgameDetailPage'));
const CurrencyPage = lazy(() => import('@/pages/currency/CurrencyPage'));
const RoleDetailPage = lazy(() => import('@/pages/currency/RoleDetailPage'));

/**
 * 给懒加载页面套一层 Suspense。
 *
 * 骨架屏与最终内容共享同一容器高度，避免出现布局跳动（PRD §7.1）。
 *
 * @param node 待渲染的懒加载页面
 */
function page(node: ReactNode): ReactNode {
  return (
    <Suspense
      fallback={
        <div className="pt-2">
          <SkeletonBlock lines={5} />
        </div>
      }
    >
      {node}
    </Suspense>
  );
}

/**
 * 路由级错误边界（等价于 `errorElement`）。
 *
 * 只把**本页面**的错误限制在内容区，侧栏与顶栏继续可用——用户可以直接切到别的模块。
 */
function RouteErrorElement(): ReactNode {
  const { t } = useTranslation();
  const error = useRouteError();
  const isHttpError = isRouteErrorResponse(error);
  const detail = isHttpError
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? `${error.name}: ${error.message}\n${error.stack ?? ''}`
      : String(error);

  return (
    <ErrorState
      title={t('error.route.title')}
      description={t('error.route.desc')}
      detail={detail}
      actionTo="/"
      actionLabel={t('error.route.action')}
      className="mt-2"
    />
  );
}

/** 全部路由 */
export const appRoutes: RouteObject[] = [
  {
    path: '/',
    element: <AppShell />,
    errorElement: <RouteErrorElement />,
    children: [
      { index: true, element: page(<HomePage />) },

      { path: 'characters', element: page(<CharacterListPage />) },
      { path: 'characters/:id', element: page(<CharacterDetailPage />) },

      { path: 'lightcones', element: page(<LightconeListPage />) },
      { path: 'lightcones/:id', element: page(<LightconeDetailPage />) },

      { path: 'relics', element: page(<RelicListPage />) },
      { path: 'relics/:id', element: page(<RelicDetailPage />) },

      { path: 'monsters', element: page(<MonsterListPage />) },
      { path: 'monsters/:id', element: page(<MonsterDetailPage />) },

      { path: 'items', element: page(<ItemListPage />) },
      { path: 'items/:id', element: page(<ItemDetailPage />) },

      { path: 'achievements', element: page(<AchievementsPage />) },

      { path: 'map', element: page(<MapPage />) },

      { path: 'compare', element: page(<ComparePage />) },
      { path: 'search', element: page(<SearchPage />) },
      { path: 'favorites', element: page(<FavoritesPage />) },
      { path: 'notes', element: page(<NotesPage />) },
      { path: 'settings', element: page(<SettingsPage />) },

      { path: 'changelog', element: page(<ChangelogPage />) },
      { path: 'endgame', element: page(<EndgamePage />) },
      { path: 'endgame/:mode/:id', element: page(<EndgameDetailPage />) },
      { path: 'currency', element: page(<CurrencyPage />) },
      // 角色详情走独立路由（原站 `/currency/role/:id`）：星魂 / 技能 / 属性都在
      // 单条详情文件里，弹层摊不下。静态段优先于 `currency/:kind`，位置不影响匹配。
      { path: 'currency/role/:id', element: page(<RoleDetailPage />) },
      { path: 'currency/:kind', element: page(<CurrencyPage />) },

      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

/** 全局路由实例 */
export const router = createHashRouter(appRoutes);

/** 路由 Provider（供 `App.tsx` 使用） */
export function AppRouter(): ReactNode {
  return <RouterProvider router={router} />;
}
