/**
 * 统一数据访问层 `DataAccessLayer`（架构文档 §5.2）
 *
 * ## 三条通道，各有各的理由
 *
 * | 数据 | 通道 | 理由 |
 * |---|---|---|
 * | 6 个模块索引（~700KB） | `datapack_index` command，**一次拿全** | 一次 IPC + 一次 `JSON.parse`；分 6 次取要多付 6 次往返，错误处理还要写 6 遍 |
 * | 详情 / 成就条目 | `read_json(rel)` command | 保留 `AppError.code`。走 asset 协议时 `ENOENT` 会变成 HTTP 404，前端只能拿到 `Failed to fetch`，没有错误码可用 |
 * | 图片 | asset 协议（`convertFileSrc`） | 二进制、要流式与浏览器缓存 |
 *
 * ## 状态从哪来
 *
 * **不新增 `datapack_root` 命令**：`pack_status` 是数据包状态的唯一真相源，
 * `ready` 分支里已经带了 `root`。多一个命令就多一处状态要同步。
 *
 * ## 语言
 *
 * 详情按语言分目录（`db/{lang}/**`），所以 DAL 持有一个当前语言，
 * 由 `boot({ lang })` / `setLang()` 设置，`getCharacter(id)` 这类签名
 * 才能和架构文档一致（不用把 `lang` 塞进每个方法）。
 */

import { convertFileSrc, invoke } from '@tauri-apps/api/core';

import type { Lang } from '@/i18n';

import { isLiveView } from '@/stores/dataView';

import { DataAccessError } from './errors';
import { isExcludedFromLive, type LiveFilterKind } from './liveView';
import type {
  AchievementSeriesDetail,
  CharacterDetail,
  DatapackIndexBundle,
  IndexModuleKey,
  ItemDetail,
  LightconeDetail,
  ModuleIndexMap,
  MonsterBrief,
  MonsterDetail,
  RelicSetDetail,
} from './types';

/** 轮询 `pack_status` 的间隔（ms）。解包期间前端只等这个，不做别的 */
const POLL_INTERVAL_MS = 120;

/** 等数据包就绪的上限（ms）。首启实测 17–28s，留足余量给慢盘 */
const BOOT_TIMEOUT_MS = 300_000;

/** 详情 LRU 容量（架构文档 §5.2：120 条） */
const DETAIL_CACHE_LIMIT = 120;

/** 物品索引分片数，必须与 Rust 侧 `ITEM_SHARD_COUNT` 一致 */
const ITEM_SHARD_COUNT = 16;

/** `pack_status` 的三种返回形状（与 Rust `PackStatus` 的 serde 契约一致） */
type PackStatus =
  | {
      readonly state: 'ready';
      readonly packId: string;
      readonly root: string;
      readonly gameVersion: string;
      readonly schemaVersion: number;
    }
  | { readonly state: 'extracting'; readonly packId: string; readonly files: number; readonly total: number }
  | { readonly state: 'failed'; readonly code: string; readonly message: string; readonly detail?: string };

/** 启动信息（boot 成功后可用） */
export interface BootInfo {
  /** 数据包 id，如 `hsr-4.7.51-local` */
  readonly packId: string;
  /** 解包后的绝对目录（Windows 路径） */
  readonly root: string;
  /** 游戏数据版本 */
  readonly gameVersion: string;
  /** 数据结构版本 */
  readonly schemaVersion: number;
}

/** 启动进度（首启解包时上报） */
export interface BootProgress {
  /** `extracting`：正在解包；`indexing`：正在读索引 */
  readonly phase: 'extracting' | 'indexing';
  /** 已完成数量 */
  readonly done: number;
  /** 总量（`indexing` 阶段为 6） */
  readonly total: number;
}

/** `boot()` 选项 */
export interface BootOptions {
  /** 详情使用的语言 */
  readonly lang: Lang;
  /** 进度回调（首启解包 / 读索引时调用） */
  readonly onProgress?: (progress: BootProgress) => void;
  /** 超时上限，默认 300s；测试用 */
  readonly timeoutMs?: number;
}

/** 数据层接口（架构文档 §5.2） */
export interface DataAccessLayer {
  /** 启动：等数据包就绪 + 一次读全索引。幂等（重复调用只重读一次索引）。 */
  boot(options: BootOptions): Promise<BootInfo>;
  /** 换数据包后重新绑定（清空全部缓存，不 reload 页面） */
  rebind(info: BootInfo): void;
  /** 切换详情语言（已缓存的详情会被清空，因为它们按语言分目录） */
  setLang(lang: Lang): void;

  /** 启动信息；未 boot 时为 `undefined` */
  readonly bootInfo: BootInfo | undefined;
  /** 索引里的计数与版本（未 boot 时为 `undefined`） */
  readonly meta: DatapackIndexBundle | undefined;

  /** 把数据包内相对路径解析成 `<img src>` 可用的 URL */
  assetUrl(relPath: string): string;

  /**
   * 按包内相对路径读取任意 JSON。
   *
   * 给 T04b 的三个新栏目用：它们的数据不参与 `datapack_index` 的六模块索引，
   * 但同样走 `read_json` 命令（保留 `AppError.code`）与详情 LRU。
   * 缓存键带完整路径，`setLang()` / `rebind()` 会清空，所以切语言不会读到旧语言。
   */
  readJson<T>(rel: string): Promise<T>;

  /** 模块索引（boot 时已读入，同步可用） */
  getIndex<K extends IndexModuleKey>(module: K): ModuleIndexMap[K];

  getCharacter(id: string): Promise<CharacterDetail>;
  getLightcone(id: string): Promise<LightconeDetail>;
  getRelicSet(id: string): Promise<RelicSetDetail>;
  /** `id` 可以是 `groupKey` 或任一变体 id（内部换算到 `primaryId`） */
  getMonster(id: string): Promise<MonsterDetail>;
  getItem(id: string): Promise<ItemDetail>;
  /** 成就系列（含条目），按当前语言读 `db/{lang}/achievement.json` */
  getAchievements(): Promise<readonly AchievementSeriesDetail[]>;

  /** 图片加载失败时上报（`SafeImage` 用），只做去重收集，不落盘 */
  reportMissingAsset(relPath: string): void;
  /** 取已上报的缺失图片列表（排障用） */
  getMissingAssets(): readonly string[];
}

/**
 * 极简 LRU（`Map` 的插入顺序即访问顺序，`get` 后重新插入即可实现 LRU）。
 *
 * 不引第三方库：只需要「容量上限 + 命中提升」两件事。
 */
class LruCache<V> {
  private readonly map = new Map<string, V>();

  constructor(private readonly limit: number) {}

  get(key: string): V | undefined {
    const value = this.map.get(key);
    if (value === undefined) return undefined;
    // 命中后移到队尾：Map 迭代顺序 = 插入顺序，这就是 LRU 的全部实现
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: string, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.limit) {
      const oldest = this.map.keys().next();
      if (!oldest.done) this.map.delete(oldest.value);
    }
  }

  clear(): void {
    this.map.clear();
  }
}

/** 判断是否运行在 Tauri 里（浏览器直开 vite 时没有 IPC） */
function hasTauriIpc(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * 把 Windows 绝对路径 + 相对路径拼成 asset 协议可用的 URL。
 *
 * @param root 数据包根目录（Windows 绝对路径）
 * @param relPath 包内相对路径（正/反斜杠均可）
 */
function joinAssetPath(root: string, relPath: string): string {
  const base = root.replace(/\\/g, '/').replace(/\/+$/, '');
  const rel = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  return `${base}/${rel}`;
}

/** 物品 id → 分片序号（与 T02 的分片规则一致：`Number(id) % 16`） */
function itemShardOf(id: string): number {
  const numeric = Number(id);
  if (!Number.isFinite(numeric) || numeric < 0) {
    throw new DataAccessError('PACK_FILE_MISSING', `物品 id 不是数字：${id}`, `id=${id}`);
  }
  return Math.floor(numeric) % ITEM_SHARD_COUNT;
}

/** 把 JSON 对象里的 `id -> value` 映射摊平成数组（分片可能是对象形态） */
function valuesOfRecord<T>(value: unknown): readonly T[] {
  if (Array.isArray(value)) return value as readonly T[];
  if (typeof value === 'object' && value !== null) return Object.values(value) as readonly T[];
  return [];
}

/** 单例实现 */
class DatapackDal implements DataAccessLayer {
  private info: BootInfo | undefined;

  private bundle: DatapackIndexBundle | undefined;

  private lang: Lang = 'zh';

  /** 详情缓存（按 `${kind}:${id}` 键，切换语言时整体清空） */
  private readonly detailCache = new LruCache<unknown>(DETAIL_CACHE_LIMIT);

  /** 物品分片缓存：分片号 → (id → 详情)。分片首次读入后常驻（与 LRU 分开） */
  private readonly itemShards = new Map<number, Map<string, ItemDetail>>();

  /** 成就系列缓存（按语言） */
  private achievements: { lang: Lang; series: readonly AchievementSeriesDetail[] } | undefined;

  /** 缺失图片收集（Set 去重，排障用） */
  private readonly missingAssets = new Set<string>();

  get bootInfo(): BootInfo | undefined {
    return this.info;
  }

  get meta(): DatapackIndexBundle | undefined {
    return this.bundle;
  }

  /**
   * 启动：等数据包就绪，然后一次读全索引。
   *
   * # Errors
   * 数据包就绪失败（`pack_status` 报 failed）时抛 `DataAccessError`，
   * `code` 直接来自 Rust；超时抛 `DATAPACK_TIMEOUT`。
   */
  async boot(options: BootOptions): Promise<BootInfo> {
    if (!hasTauriIpc()) {
      throw new DataAccessError(
        'DATAPACK_NOT_READY',
        '当前不在 Tauri 环境中运行，无法访问数据包',
        '请在 `npm run tauri:dev` 里打开，而不是浏览器直开 vite',
      );
    }

    this.lang = options.lang;

    const ready = await this.waitForReady(options);
    this.info = {
      packId: ready.packId,
      root: ready.root,
      gameVersion: ready.gameVersion,
      schemaVersion: ready.schemaVersion,
    };

    options.onProgress?.({ phase: 'indexing', done: 0, total: 6 });

    const bundle = await this.invoke<DatapackIndexBundle>('datapack_index');
    this.verifyIndex(bundle);
    this.bundle = bundle;

    options.onProgress?.({ phase: 'indexing', done: 6, total: 6 });
    return this.info;
  }

  /** 轮询 `pack_status` 直到 ready */
  private async waitForReady(options: BootOptions): Promise<Extract<PackStatus, { state: 'ready' }>> {
    const deadline = Date.now() + (options.timeoutMs ?? BOOT_TIMEOUT_MS);
    let last: PackStatus | undefined;

    while (Date.now() < deadline) {
      const status = await this.invoke<PackStatus>('pack_status');
      last = status;

      if (status.state === 'ready') return status;

      if (status.state === 'extracting') {
        options.onProgress?.({ phase: 'extracting', done: status.files, total: status.total });
      } else {
        // failed：把 Rust 的 code 原样透出去，前端据此决定是否露出「重新导入」。
        // 走 `DataAccessError.from` 而不是直接 `new`，是因为 `code` 在运行时是字符串，
        // 由它负责收敛到 `DataErrorCode`（未知码归 UNKNOWN），这里不重复写一遍映射表。
        throw DataAccessError.from({
          code: status.code,
          message: status.message,
          detail: status.detail,
        });
      }

      await new Promise<void>((resolve) => {
        setTimeout(resolve, POLL_INTERVAL_MS);
      });
    }

    throw new DataAccessError(
      'DATAPACK_TIMEOUT',
      '等待数据包就绪超时',
      last === undefined ? 'pack_status 一直没有返回' : `最后一次状态：${last.state}`,
    );
  }

  /**
   * 核对「读到的条数」和「meta 声明的条数」。
   *
   * 这是 `counts_mismatch` 的前端镜像：少读一批时**当场报错**，
   * 而不是等到某个详情页空白才被发现。
   */
  private verifyIndex(bundle: DatapackIndexBundle): void {
    const expected: readonly [string, number, number][] = [
      ['character', bundle.characters.length, bundle.counts.character],
      ['lightcone', bundle.lightcones.length, bundle.counts.lightcone],
      ['relicset', bundle.relicsets.length, bundle.counts.relicset],
      // 敌人索引按「组」聚合，对应 monsterGroups（382）而不是 monster（666）
      ['monsterGroups', bundle.monsters.length, bundle.counts.monsterGroups],
      ['item', bundle.items.length, bundle.counts.item],
      ['achievementSeries', bundle.achievementSeries.length, bundle.counts.achievementSeries],
    ];

    const mismatch = expected.find(([, got, want]) => got !== want);
    if (mismatch) {
      const [name, got, want] = mismatch;
      throw new DataAccessError(
        'PACK_CORRUPT',
        '数据包索引条数与声明不符',
        `${name}: 读到 ${got} 条，meta 声明 ${want} 条`,
      );
    }
  }

  rebind(info: BootInfo): void {
    this.info = info;
    this.bundle = undefined;
    this.detailCache.clear();
    this.itemShards.clear();
    this.achievements = undefined;
  }

  setLang(lang: Lang): void {
    if (lang === this.lang) return;
    this.lang = lang;
    // 详情按语言分目录：语言一变，旧缓存全部作废
    this.detailCache.clear();
    this.itemShards.clear();
    this.achievements = undefined;
  }

  assetUrl(relPath: string): string {
    if (this.info === undefined) {
      throw new DataAccessError('DATAPACK_NOT_READY', '数据层尚未完成 boot，无法解析资源路径');
    }
    return convertFileSrc(joinAssetPath(this.info.root, relPath));
  }

  readJson<T>(rel: string): Promise<T> {
    return this.getDetailJson<T>('raw', rel);
  }

  getIndex<K extends IndexModuleKey>(module: K): ModuleIndexMap[K] {
    const bundle = this.requireBundle();
    const live = isLiveView();
    /** 4.7 现场视图：按 live 排除表过滤；其余模块原样返回 */
    const apply = <T extends { readonly id?: string; readonly groupKey?: string }>(
      kind: LiveFilterKind,
      rows: readonly T[],
    ): readonly T[] =>
      live
        ? rows.filter(
            (row) => !isExcludedFromLive(kind, String(row.id ?? row.groupKey ?? '')),
          )
        : rows;
    switch (module) {
      case 'character':
        return apply('character', bundle.characters) as ModuleIndexMap[K];
      case 'lightcone':
        return apply('lightcone', bundle.lightcones) as ModuleIndexMap[K];
      case 'relicset':
        return bundle.relicsets as ModuleIndexMap[K];
      case 'monster':
        return apply('monster', bundle.monsters) as ModuleIndexMap[K];
      case 'item':
        return apply('item', bundle.items) as ModuleIndexMap[K];
      case 'achievementSeries':
        return bundle.achievementSeries as ModuleIndexMap[K];
      default: {
        // 穷尽性检查：新增 IndexModuleKey 而漏了分支时，这里编译期报错
        const exhaustive: never = module;
        throw new DataAccessError('UNKNOWN', `未知模块：${String(exhaustive)}`);
      }
    }
  }

  async getCharacter(id: string): Promise<CharacterDetail> {
    return this.getDetailJson<CharacterDetail>('character', `db/${this.lang}/character/${id}.json`);
  }

  async getLightcone(id: string): Promise<LightconeDetail> {
    return this.getDetailJson<LightconeDetail>('lightcone', `db/${this.lang}/lightcone/${id}.json`);
  }

  async getRelicSet(id: string): Promise<RelicSetDetail> {
    return this.getDetailJson<RelicSetDetail>('relicset', `db/${this.lang}/relicset/${id}.json`);
  }

  async getMonster(id: string): Promise<MonsterDetail> {
    const brief = this.findMonsterBrief(id);
    const fileId = brief?.primaryId ?? id;
    return this.getDetailJson<MonsterDetail>('monster', `db/${this.lang}/monster/${fileId}.json`);
  }

  async getItem(id: string): Promise<ItemDetail> {
    const shard = itemShardOf(id);
    const cached = this.itemShards.get(shard)?.get(id);
    if (cached !== undefined) return cached;

    const rel = `db/${this.lang}/item/${shard}.json`;
    const raw = await this.invoke<unknown>('read_json', { rel });
    const records = valuesOfRecord<ItemDetail>(raw);

    // 分片内是对象，需要按 id 命中；顺手把整片塞进缓存，同片的后续查询零 IPC。
    // 一片约 100 条，内存代价可忽略。
    const byId = new Map<string, ItemDetail>();
    for (const record of records) {
      if (typeof record?.id === 'string') byId.set(record.id, record);
    }
    this.itemShards.set(shard, byId);

    const found = byId.get(id);
    if (found === undefined) {
      throw new DataAccessError(
        'PACK_FILE_MISSING',
        '未找到该物品',
        `rel=${rel} 中没有 id=${id}（分片内 ${byId.size} 条）`,
      );
    }
    return found;
  }

  async getAchievements(): Promise<readonly AchievementSeriesDetail[]> {
    if (this.achievements !== undefined) return this.achievements.series;

    const rel = `db/${this.lang}/achievement.json`;
    const raw = await this.invoke<unknown>('read_json', { rel });
    const series = valuesOfRecord<AchievementSeriesDetail>(raw);
    this.achievements = { lang: this.lang, series };
    return series;
  }

  reportMissingAsset(relPath: string): void {
    this.missingAssets.add(relPath);
    if (import.meta.env.DEV) {
      console.warn('[dal] 图片缺失', relPath);
    }
  }

  getMissingAssets(): readonly string[] {
    return [...this.missingAssets];
  }

  // -------------------------------------------------------------------------
  // 内部
  // -------------------------------------------------------------------------

  /** 统一走 `invoke` 并归一化错误，保证每条命令的失败都是 `DataAccessError` */
  private async invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    try {
      return await invoke<T>(command, args);
    } catch (caught: unknown) {
      throw DataAccessError.from(caught);
    }
  }

  private requireBundle(): DatapackIndexBundle {
    if (this.bundle === undefined) {
      throw new DataAccessError('DATAPACK_NOT_READY', '数据层尚未完成 boot，索引不可用');
    }
    return this.bundle;
  }

  /**
   * 详情统一读法：先查 LRU，再走 `read_json`，读到的结果写回 LRU。
   *
   * @param kind 模块名（只用于缓存键与日志）
   * @param rel 包内相对路径
   */
  private async getDetailJson<T>(kind: string, rel: string): Promise<T> {
    const key = `${kind}:${rel}`;
    const cached = this.detailCache.get(key);
    if (cached !== undefined) return cached as T;

    const value = await this.invoke<T>('read_json', { rel });
    this.detailCache.set(key, value);
    return value;
  }

  /**
   * 用 `groupKey` 或任一变体 id 找到敌人 brief。
   *
   * 路由里存 `groupKey` 对人更可读，但外部链接可能给的是变体 id；
   * 两种都接受，避免详情页因为 id 形式不同而 404。
   */
  private findMonsterBrief(id: string): MonsterBrief | undefined {
    const monsters = this.requireBundle().monsters;
    return monsters.find(
      (brief) => brief.groupKey === id || brief.primaryId === id || brief.variantIds.includes(id),
    );
  }
}

/**
 * 全局单例。
 *
 * 用单例而不是 React Context，是因为数据层要在 React 之外被调用
 * （路由 loader、启动编排、排障工具），而它本身无 UI 状态。
 */
export const dal: DataAccessLayer = new DatapackDal();

/** 需要具体实现的场景（测试/排障）用这个类型，避免 `as` */
export type { DatapackDal };
