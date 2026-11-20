/**
 * 数据版本视图。
 *
 * 原站顶部有 `4.7 (live)` / `4.7.51` / `4.7.52 (latest)` 选择器；
 * 本应用只有一份 4.7.52 数据包，因此：
 *  - `live`：隐藏 4.7 之后才加入的实体（见 `liveView.ts`），默认值；
 *  - `4.7.51` / `4.7.52`：显示数据包全量。
 *
 * 选择写入 localStorage，重启后保持；首次启动没有记录时默认 `live`，
 * 避免默认把未上线内容摆到首页。
 */

import { create } from 'zustand';

/** 版本视图 */
export type DataViewVersion = 'live' | '4.7.51' | '4.7.52';

/** localStorage key */
const DATA_VERSION_KEY = 'hsr.dataVersion';

/** 选项（顺序与原站一致：live → 4.7.51 → 4.7.52） */
export const DATA_VIEW_OPTIONS: readonly DataViewVersion[] = ['live', '4.7.51', '4.7.52'];

/** 读取上次选择；非法值回落到 live */
function readVersion(): DataViewVersion {
  if (typeof window === 'undefined') return 'live';
  const value = window.localStorage.getItem(DATA_VERSION_KEY);
  return value === '4.7.51' || value === '4.7.52' ? value : 'live';
}

/** 写入选择 */
function writeVersion(value: DataViewVersion): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(DATA_VERSION_KEY, value);
  } catch {
    // 忽略存储失败
  }
}

/** 数据版本 store */
interface DataViewStore {
  /** 当前视图 */
  readonly version: DataViewVersion;
  /** 切换视图 */
  readonly setVersion: (value: DataViewVersion) => void;
}

export const useDataViewStore = create<DataViewStore>()((set) => ({
  version: readVersion(),
  setVersion: (value) => {
    writeVersion(value);
    set({ version: value });
  },
}));

/** 当前是否为 4.7 现场视图 */
export function isLiveView(): boolean {
  return useDataViewStore.getState().version === 'live';
}

/** 页面 badge 用的当前视图版本：live → 4.7，其余用选择值 */
export function useDataVersionLabel(): string {
  return useDataViewStore((state) => (state.version === 'live' ? '4.7' : state.version));
}