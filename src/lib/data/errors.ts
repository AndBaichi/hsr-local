/**
 * 数据层错误（架构文档 §11.5）
 *
 * ## 为什么不用「抛字符串 + 判断 message」
 *
 * Rust 侧所有 command 都返回 `AppError { code, message, detail }`，`code` 是**稳定**的
 * 大写枚举串。前端唯一允许的分支依据就是 `code`——`message` 是给人看的中文短句，
 * 将来可能改文案，绝不参与逻辑判断。这个文件就是这条约定的落地点。
 *
 * ## 为什么 JSON 不走 asset 协议（在这里能看出来）
 *
 * 走 asset 协议时，文件不存在会变成 HTTP 404，`fetch` 抛的是 `TypeError: Failed to fetch`
 * ——**错误码体系在这一层就断了**，前端没有任何办法区分「数据包没装」和「这个角色的
 * 详情文件缺失」。所以 JSON 一律走 `read_json` command，把 `code` 完整带回来；
 * asset 协议只留给图片（二进制、要流式与缓存）。
 */

/** 后端 `ErrorCode` 的稳定字符串 + 前端自己产生的两个码 */
export type DataErrorCode =
  // —— 来自 Rust `ErrorCode` ——
  | 'PACK_NOT_FOUND'
  | 'PACK_FILE_MISSING'
  | 'PACK_INVALID_PATH'
  | 'PACK_CORRUPT'
  | 'PACK_INCOMPATIBLE_SCHEMA'
  | 'PACK_EXTRACT_FAILED'
  | 'USERDATA_WRITE_FAILED'
  | 'USERDATA_INVALID_NAME'
  | 'USERDATA_INVALID_CONTENT'
  | 'NETWORK_DISABLED'
  | 'UPDATE_CHECK_FAILED'
  | 'IO_FAILED'
  | 'INTERNAL'
  // —— 前端自有 ——
  /** 数据层还没 boot 就调了需要数据的方法 */
  | 'DATAPACK_NOT_READY'
  /** 等数据包就绪超时（解包卡住 / 磁盘很慢） */
  | 'DATAPACK_TIMEOUT'
  /** 拿到的错误形状不认识（IPC 层异常、JS 运行时错误） */
  | 'UNKNOWN';

/** 除 `UNKNOWN` 外，每个码都对应一条 i18n 文案 */
const KNOWN_CODES: ReadonlySet<string> = new Set<DataErrorCode>([
  'PACK_NOT_FOUND',
  'PACK_FILE_MISSING',
  'PACK_INVALID_PATH',
  'PACK_CORRUPT',
  'PACK_INCOMPATIBLE_SCHEMA',
  'PACK_EXTRACT_FAILED',
  'USERDATA_WRITE_FAILED',
  'USERDATA_INVALID_NAME',
  'USERDATA_INVALID_CONTENT',
  'NETWORK_DISABLED',
  'UPDATE_CHECK_FAILED',
  'IO_FAILED',
  'INTERNAL',
  'DATAPACK_NOT_READY',
  'DATAPACK_TIMEOUT',
]);

/**
 * 数据层统一错误。
 *
 * 继承 `Error` 是为了让 React Router 的 `errorElement`、`ErrorBoundary`
 * 和 `console.error` 都能正常处理它；`code` 供 UI 分支用。
 */
export class DataAccessError extends Error {
  /** 稳定错误码 */
  readonly code: DataErrorCode;

  /** 技术细节（路径、底层报错），展示在折叠区 */
  readonly detail: string | undefined;

  /**
   * 给 `t()` 用的文案 key。
   *
   * 用模板字面量类型而不是 `string`，这样 `t(error.userMessageKey)` 能通过 i18next 的
   * 编译期 key 校验；漏往 4 个 locale 里加文案会直接让 `tsc` 报错。
   */
  readonly userMessageKey: `error.codes.${DataErrorCode}`;

  constructor(code: DataErrorCode, message: string, detail?: string) {
    super(message);
    this.name = 'DataAccessError';
    this.code = code;
    this.detail = detail;
    this.userMessageKey = `error.codes.${code}`;
  }

  /** 便于日志复现的完整描述 */
  override toString(): string {
    return this.detail
      ? `DataAccessError(${this.code}): ${this.message} — ${this.detail}`
      : `DataAccessError(${this.code}): ${this.message}`;
  }

  /**
   * 把任意被抛出的东西收敛成 `DataAccessError`。
   *
   * 兼容三种形状：
   *  1. 已经是 `DataAccessError`（原样返回，保留 code）
   *  2. Rust `AppError` 序列化后的 `{ code, message, detail }`
   *     （Tauri 的 `invoke` reject 出来的就是这种普通对象，**不是 Error**）
   *  3. JS `Error` 或其它 —— 归为 `UNKNOWN`
   *
   * @param caught 捕获到的任意值
   */
  static from(caught: unknown): DataAccessError {
    if (caught instanceof DataAccessError) return caught;

    if (typeof caught === 'object' && caught !== null) {
      const candidate = caught as { code?: unknown; message?: unknown; detail?: unknown };
      if (typeof candidate.code === 'string') {
        const code = (KNOWN_CODES.has(candidate.code) ? candidate.code : 'UNKNOWN') as DataErrorCode;
        const message = typeof candidate.message === 'string' ? candidate.message : code;
        const detail = typeof candidate.detail === 'string' ? candidate.detail : undefined;
        return new DataAccessError(code, message, detail);
      }
    }

    if (caught instanceof Error) {
      return new DataAccessError('UNKNOWN', caught.message, caught.stack);
    }

    return new DataAccessError('UNKNOWN', String(caught));
  }
}

/**
 * 判断错误是否「换个数据包就能救」——用于决定要不要露出导入入口。
 *
 * @param error 任意错误
 */
export function isPackLevelFailure(error: unknown): boolean {
  const code = DataAccessError.from(error).code;
  return (
    code === 'PACK_NOT_FOUND' ||
    code === 'PACK_CORRUPT' ||
    code === 'PACK_INCOMPATIBLE_SCHEMA' ||
    code === 'PACK_EXTRACT_FAILED'
  );
}
