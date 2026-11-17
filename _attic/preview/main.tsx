/**
 * PagedGrid 的纯前端预览页（仅用于视觉自查，不参与 `npm run build` 的入口）。
 *
 * 起法：`npm run dev` 后访问 `/preview/index.html`。
 * 不依赖 Tauri IPC：数据是手写的中文名称，只为验证「分组标题 + 右侧字母条」的观感。
 */

import { StrictMode, useCallback, useEffect, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';

import { FilterBar, PagedGrid } from '@/components/common/ListControls';
import { EntityCard } from '@/components/common/EntityGrid';
// 与 `src/main.tsx` 保持同一套样式入口顺序：tokens 必须最先，utility 才能取到变量
import '@/styles/tokens.css';
import '@/styles/globals.css';
import '@/styles/richtext.css';

interface Fake {
  readonly id: string;
  readonly name: string;
  readonly sub: string;
  readonly rarity: number;
}

const NAMES = [
  '三月七', '阿哈·简易武装箱', '景元', '镜流', '布洛妮娅', '长夜月', '重返幽冥', '重塑时光之忆',
  '丹恒', '符玄', '花火', '黄泉', '流萤', '卡芙卡', '罗刹', '白露', '银狼', '希儿',
  '云无留迹的过客', '繁星璀璨的天才', '毁灭', '存护', '同谐', '虚无', '巡猎', '丰饶',
  '3 星光锥', '「醉于盛会的此刻」', '████', '藿藿', '砂金', '托帕', '符玄·太卜司',
];

const ITEMS: readonly Fake[] = Array.from({ length: 120 }, (_, index) => {
  const base = NAMES[index % NAMES.length];
  return {
    id: String(index + 1),
    name: index < NAMES.length ? base : `${base}${index}`,
    sub: '冰 · 存护',
    rarity: 4 + (index % 2),
  };
});

function App(): ReactNode {
  const titleOf = useCallback((item: Fake) => item.name, []);

  // 视觉自查用：`?scroll=900` 直接把列表滚到指定位置，验证吸顶标题与字母条高亮
  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get('scroll');
    if (raw === null) return;
    const main = document.querySelector('main');
    if (main !== null) main.scrollTop = Number(raw);
  }, []);

  // 视觉自查用：`?pick=S` 模拟点击字母条上的 S，验证跨页跳转 + 滚动定位
  useEffect(() => {
    const symbol = new URLSearchParams(window.location.search).get('pick');
    if (symbol === null) return;
    const timer = setTimeout(() => {
      const bar = document.querySelector('[aria-label="按首字母跳转"]');
      const button = [...(bar?.querySelectorAll('button') ?? [])].find(
        (item) => item.textContent === symbol,
      );
      button?.click();
    }, 400);
    return () => {
      clearTimeout(timer);
    };
  }, []);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-base text-ink">
      <aside className="h-full w-nav shrink-0 bg-panel p-4 text-sm text-dim">侧栏（240px 占位）</aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="h-topbar shrink-0 border-b border-line px-6 py-3 text-sm text-dim">顶栏（56px 占位）</div>
        <main className="hsr-backdrop min-h-0 flex-1 overflow-y-auto">
          <div className="hsr-content-width py-6">
            <div className="flex flex-col gap-4 pt-2">
              <FilterBar
                query=""
                onQueryChange={() => undefined}
                filters={[]}
                values={{}}
                onFilterChange={() => undefined}
                total={ITEMS.length}
                allCount={ITEMS.length}
                searchPlaceholder="按名称或 ID 搜索…"
                allLabel="全部"
                countLabel={`共 ${ITEMS.length} 项`}
              />
              <PagedGrid
                items={ITEMS}
                pageSize={20}
                resetKey="preview"
                keyOf={(item) => item.id}
                titleOf={titleOf}
                indexLabel="按首字母跳转"
                emptyLabel="没有匹配的条目"
                nextLabel="下一页"
                prevLabel="上一页"
                renderItem={(item) => (
                  <EntityCard to="#" title={item.name} subtitle={item.sub} rarity={item.rarity} badges={['冰', '存护']} />
                )}
              />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

const container = document.getElementById('root');
if (container !== null) {
  createRoot(container).render(
    <StrictMode>
      <HashRouter>
        <App />
      </HashRouter>
    </StrictMode>,
  );
}
