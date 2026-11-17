/**
 * 详情页数据加载（T04）
 *
 * 五个详情页共用的异步编排。三件事容易写错，统一收在这里：
 *
 * 1. **切语言要重取**：详情按 `db/{lang}/...` 分目录，`dal.setLang()` 只清缓存，
 *    不会替页面重新发请求。所以 `lang` 必须进依赖数组。
 * 2. **切实体要丢弃旧响应**：快速连点两个角色时，先发的请求可能后返回，
 *    直接用 `setData` 会让页面显示上一个角色。用 `cancelled` 标志挡掉。
 * 3. **错误要保留 `code`**：`DataAccessError.userMessageKey` 是文案键，
 *    页面靠它显示四语言提示，不能在这里被 `String(error)` 抹平。
 */

import { useCallback, useEffect, useState } from 'react';

import type { Lang } from '@/i18n';
import { DataAccessError } from '@/lib/data/errors';
import { useSettingsStore } from '@/stores/settings';

/** 详情加载结果 */
export interface DetailResult<T> {
  /** 已加载的数据；加载中或失败时为 undefined */
  readonly data: T | undefined;
  /** 是否正在加载 */
  readonly loading: boolean;
  /** 归一化后的错误 */
  readonly error: DataAccessError | undefined;
  /** 重试 */
  readonly retry: () => void;
  /** 当前语言（页面做本地化展示时直接用，避免再取一次 store） */
  readonly lang: Lang;
}

/** 把任意抛出物归一成 DataAccessError */
function toError(error: unknown): DataAccessError {
  if (error instanceof DataAccessError) return error;
  return new DataAccessError('UNKNOWN', '详情读取失败', error instanceof Error ? error.message : String(error));
}

/**
 * 加载一条详情。
 *
 * @param loader 由调用方提供的数据层 getter，必须是**稳定引用**或纯函数
 * @param id 路由参数（undefined 时不发请求）
 */
export function useDetail<T>(
  loader: (id: string, lang: Lang) => Promise<T>,
  id: string | undefined,
): DetailResult<T> {
  const lang = useSettingsStore((state) => state.prefs.lang);
  const [data, setData] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<DataAccessError | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback((): void => setAttempt((value) => value + 1), []);

  useEffect(() => {
    let cancelled = false;

    if (!id) {
      setData(undefined);
      setLoading(false);
      setError(new DataAccessError('PACK_FILE_MISSING', '缺少条目 ID'));
      return;
    }

    setLoading(true);
    setError(undefined);
    setData(undefined);

    void loader(id, lang)
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setLoading(false);
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setError(toError(reason));
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id, lang, attempt, loader]);

  return { data, loading, error, retry, lang };
}
