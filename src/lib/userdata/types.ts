/**
 * 用户数据的类型与归一化（架构文档 §5.1「用户数据」）
 *
 * 与数据包类型（`src/lib/data/types.ts`）分开放，因为两者的**生命周期不同**：
 * 数据包随版本更换、可整个删掉重装；用户数据跨版本存活，是唯一"属于用户"的东西。
 * 混在一个文件里会诱使人给数据包类型加用户字段。
 *
 * 所有 `coerce*` 函数都是**逐字段校验**而非整体信任：用户数据在磁盘上是普通 JSON，
 * 用户可能手改、旧版本应用可能写过少字段的结构。一个字段坏了不该丢掉整份数据。
 */

import type { Lang } from '@/i18n';

import type { ModuleKey } from '@/lib/data/types';

/** 本地化文本（与数据包 brief 的 `names` 同形状） */
export type LocalizedNames = Partial<Record<Lang, string>>;

/** 实体键：`"character:1001"`。收藏/笔记都以它为 key */
export type EntityKey = `${ModuleKey}:${string}`;

/** 12 个模块的稳定顺序（收藏页 tab 顺序、`parseEntityKey` 校验都用它） */
export const MODULE_KEYS: readonly ModuleKey[] = [
  'character',
  'lightcone',
  'relicset',
  'monster',
  'item',
  'achievementSeries',
  'currencyRole',
  'currencyItem',
  'currencyBuff',
  'currencyAugment',
  'currencySpotlight',
  'currencyTrait',
];

/** 货币战争图鉴子模块（`currency*`）→ 图鉴种类（`CurrencyKind`） */
export const CURRENCY_MODULE_KIND: Readonly<Partial<Record<ModuleKey, string>>> = {
  currencyRole: 'role',
  currencyItem: 'item',
  currencyBuff: 'buff',
  currencyAugment: 'augment',
  currencySpotlight: 'spotlight',
  currencyTrait: 'trait',
};

/**
 * 拼实体键。
 *
 * @param module 模块
 * @param id 实体 id
 */
export function entityKeyOf(module: ModuleKey, id: string): EntityKey {
  return `${module}:${id}`;
}

/**
 * 拆实体键；模块名不在白名单内时返回 `undefined`。
 *
 * @param key 实体键
 */
export function parseEntityKey(key: string): { module: ModuleKey; id: string } | undefined {
  const separator = key.indexOf(':');
  if (separator <= 0) return undefined;
  const module = key.slice(0, separator);
  const id = key.slice(separator + 1);
  if (id === '') return undefined;
  const matched = MODULE_KEYS.find((candidate) => candidate === module);
  return matched === undefined ? undefined : { module: matched, id };
}

/** 收藏条目（`userdata/favorites.json` 的值类型） */
export interface FavoriteEntry {
  /** 模块 */
  readonly module: ModuleKey;
  /** 实体 id */
  readonly id: string;
  /** 名称快照：实体随数据包升级消失后仍能显示（PRD「已移除条目」占位） */
  readonly nameSnapshot: LocalizedNames;
  /** 收藏时的数据包 id，用于判定「已随版本移除」 */
  readonly packId: string;
  /** ISO8601 */
  readonly addedAt: string;
  /** 分组（P1-04，本批次恒为 null） */
  readonly group: string | null;
  /** 手动排序位（越大越靠后） */
  readonly order: number;
}

/** 笔记条目（`userdata/notes.json` 的值类型） */
export interface NoteEntry {
  /** 模块 */
  readonly module: ModuleKey;
  /** 实体 id */
  readonly id: string;
  /** 名称快照 */
  readonly nameSnapshot: LocalizedNames;
  /** 纯文本内容（Q5 决策：不做 Markdown） */
  readonly content: string;
  /** ISO8601 */
  readonly updatedAt: string;
}

/** 最近浏览条目（`userdata/recent.json` 的元素类型） */
export interface RecentEntry {
  /** 模块 */
  readonly module: ModuleKey;
  /** 实体 id */
  readonly id: string;
  /** 名称快照 */
  readonly nameSnapshot: LocalizedNames;
  /** ISO8601 */
  readonly at: string;
}

/** 单个实体键 → 条目 */
export type EntityRecord<T> = Readonly<Record<string, T>>;

/** 笔记内容上限（字符数）。与 Rust 侧 4MiB 是两道不同目的的闸门 */
export const NOTE_MAX_LENGTH = 20_000;

/**
 * 判断字符串是否是合法模块名。
 *
 * @param value 待判定值
 */
function isModuleKey(value: unknown): value is ModuleKey {
  return typeof value === 'string' && MODULE_KEYS.some((candidate) => candidate === value);
}

/**
 * 把任意值收敛为本地化名称对象（丢弃非字符串字段）。
 *
 * @param raw 原始值
 */
function coerceNames(raw: unknown): LocalizedNames {
  if (typeof raw !== 'object' || raw === null) return {};
  const source = raw as Record<string, unknown>;
  const names: LocalizedNames = {};
  for (const lang of ['zh', 'en', 'ja', 'ko'] as const) {
    const value = source[lang];
    if (typeof value === 'string' && value !== '') {
      names[lang] = value;
    }
  }
  return names;
}

/**
 * 把任意值收敛为收藏表。
 *
 * 丢弃规则（都是"无法在 UI 里表示"的条目，不是"看起来不顺眼"的条目）：
 *  - 值不是对象、`module` 不认识、`id` 为空 → 丢弃
 *  - key 与 `module:id` 不一致 → 以值里的字段为准重建 key（防止手改后错位）
 *
 * @param raw `userdata_read('favorites')` 解析后的值
 */
export function coerceFavorites(raw: unknown): Record<string, FavoriteEntry> {
  const result: Record<string, FavoriteEntry> = {};
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return result;

  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null) continue;
    const source = value as Record<string, unknown>;
    const module = isModuleKey(source.module) ? source.module : parseEntityKey(key)?.module;
    const id = typeof source.id === 'string' && source.id !== '' ? source.id : parseEntityKey(key)?.id;
    if (module === undefined || id === undefined) continue;

    const order = typeof source.order === 'number' && Number.isFinite(source.order) ? source.order : 0;
    result[entityKeyOf(module, id)] = {
      module,
      id,
      nameSnapshot: coerceNames(source.nameSnapshot),
      packId: typeof source.packId === 'string' ? source.packId : '',
      addedAt:
        typeof source.addedAt === 'string' && source.addedAt !== ''
          ? source.addedAt
          : new Date(0).toISOString(),
      group: typeof source.group === 'string' && source.group !== '' ? source.group : null,
      order: Math.round(order),
    };
  }
  return result;
}

/**
 * 把任意值收敛为笔记表。
 *
 * @param raw `userdata_read('notes')` 解析后的值
 */
export function coerceNotes(raw: unknown): Record<string, NoteEntry> {
  const result: Record<string, NoteEntry> = {};
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return result;

  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null) continue;
    const source = value as Record<string, unknown>;
    const module = isModuleKey(source.module) ? source.module : parseEntityKey(key)?.module;
    const id = typeof source.id === 'string' && source.id !== '' ? source.id : parseEntityKey(key)?.id;
    if (module === undefined || id === undefined) continue;
    if (typeof source.content !== 'string') continue;

    result[entityKeyOf(module, id)] = {
      module,
      id,
      nameSnapshot: coerceNames(source.nameSnapshot),
      content: source.content.slice(0, NOTE_MAX_LENGTH),
      updatedAt:
        typeof source.updatedAt === 'string' && source.updatedAt !== ''
          ? source.updatedAt
          : new Date(0).toISOString(),
    };
  }
  return result;
}

/**
 * 取名称快照里最适合当前语言的文本。
 *
 * @param names 名称快照
 * @param lang 当前语言
 * @param fallback 兜底文本（通常是实体 id）
 */
export function pickName(
  names: LocalizedNames,
  lang: Lang,
  fallback = '',
): string {
  return names[lang] ?? names.zh ?? names.en ?? Object.values(names)[0] ?? fallback;
}

/* ------------------------------------------------------------------ */
/* 货币战争评级                                                        */
/* ------------------------------------------------------------------ */

/**
 * 评级档位（由低到高）。
 *
 * 档位字母本身**不翻译**（C / B / A / S / SS / SSS 是游戏圈通用写法），
 * 只有"评级"这个功能名进 i18n。
 */
export const RATING_GRADES = ['C', 'B', 'A', 'S', 'SS', 'SSS'] as const;

/** 评级档位类型 */
export type RatingGrade = (typeof RATING_GRADES)[number];

/**
 * 判断任意值是否是合法评级。
 *
 * @param value 待判定值
 */
export function isRatingGrade(value: unknown): value is RatingGrade {
  return typeof value === 'string' && RATING_GRADES.some((grade) => grade === value);
}

/**
 * 评级表在 `ratings.json` 里的键。
 *
 * 格式 `currency:{kind}:{id}`。**不属于** `EntityKey`（那是六个数据包的模块键），
 * 图鉴条目在本应用里没有实体路由，所以单独一套键名，避免被收藏/笔记的
 * `parseEntityKey` 误认成非法实体而丢掉。
 *
 * @param kind 图鉴种类
 * @param id 条目 id
 */
export function ratingKeyOf(kind: string, id: string): string {
  return `currency:${kind}:${id}`;
}

/** 备注长度上限：防止误把长文粘进 userdata */
export const REMARK_MAX_LENGTH = 200;

/**
 * 把备注裁到上限。
 *
 * 用 `Array.from` 按**码点**切而不是 `String.prototype.slice`：后者按 UTF-16 单元切，
 * 会把边界上的 emoji 劈成孤立代理项（渲染成 �），而输入框的 maxLength 也是按 UTF-16
 * 计数，所以只有粘贴才会撞上。
 *
 * @param raw 原始备注
 */
export function clampRemark(raw: string): string {
  return Array.from(raw.trim()).slice(0, REMARK_MAX_LENGTH).join('');
}

/** 一条词条的评级数据：四个字段互相独立，任一可缺省 */
export interface RatingEntry {
  /** 第一套评级（徽标显示字母） */
  readonly grade?: RatingGrade;
  /** 第二套评级（徽标恒显示「千」，仅颜色区分档位） */
  readonly tier?: RatingGrade;
  /** 字母评级备注（trim 后非空才保留） */
  readonly gradeRemark?: string;
  /** 千评级备注（trim 后非空才保留） */
  readonly tierRemark?: string;
}

/**
 * 判断条目是否「四字段全空」。
 *
 * @param entry 条目
 */
export function isEmptyRatingEntry(entry: RatingEntry): boolean {
  return (
    entry.grade === undefined &&
    entry.tier === undefined &&
    entry.gradeRemark === undefined &&
    entry.tierRemark === undefined
  );
}

/**
 * 把任意值收敛为评级表。
 *
 * 丢弃规则（都是"在 UI 里表示不了"的值，不是"看起来不顺眼"的值）：
 *  - 键不合 `currency:{kind}:{id}` 形状 → 丢弃（留着只会在 UI 里查不到、白白占体积）
 *  - 值不是对象（且不是旧格式裸档位字符串）→ 丢弃
 *  - 单个字段非法 → 只丢该字段，同条目的其它合法字段照常保留
 *  - 三字段全非法 → 整键丢弃，不留一个空对象在文件里
 *
 * **旧格式兼容**：早期版本把值直接写成 `"SSS"`，这里按 `{ grade: "SSS" }` 升级，
 * 用户不需要手动迁移，也不需要额外一趟写盘（下次真正评级时自然写成新格式）。
 *
 * @param raw `userdata_read('ratings')` 解析后的值
 */
export function coerceRatings(raw: unknown): Record<string, RatingEntry> {
  const result: Record<string, RatingEntry> = {};
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return result;

  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const parts = key.split(':');
    if (parts.length !== 3 || parts[0] !== 'currency' || parts[1] === '' || parts[2] === '') continue;

    if (isRatingGrade(value)) {
      result[key] = { grade: value };
      continue;
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) continue;

    const source = value as Record<string, unknown>;
    const entry: { grade?: RatingGrade; tier?: RatingGrade; gradeRemark?: string; tierRemark?: string } = {};
    if (isRatingGrade(source.grade)) entry.grade = source.grade;
    if (isRatingGrade(source.tier)) entry.tier = source.tier;
    // 旧格式只有一个共用 `remark`：迁移到字母评级备注（字母评级是默认展示的那套，
    // 历史用户记的备注最可能归属它）；新格式分别读 gradeRemark / tierRemark。
    if (typeof source.gradeRemark === 'string') {
      const text = clampRemark(source.gradeRemark);
      if (text !== '') entry.gradeRemark = text;
    } else if (typeof source.remark === 'string') {
      const text = clampRemark(source.remark);
      if (text !== '') entry.gradeRemark = text;
    }
    if (typeof source.tierRemark === 'string') {
      const text = clampRemark(source.tierRemark);
      if (text !== '') entry.tierRemark = text;
    }
    if (isEmptyRatingEntry(entry)) continue;
    result[key] = entry;
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* 本地便签（v2.15）                                                    */
/* ------------------------------------------------------------------ */

/** 便签配色（只影响外观，不参与排序/筛选） */
export type LocalNoteColor = 'amber' | 'rose' | 'mint' | 'sky' | 'violet';

/** 可选配色，新建时按顺序轮换 */
export const LOCAL_NOTE_COLORS: readonly LocalNoteColor[] = ['amber', 'rose', 'mint', 'sky', 'violet'];

/** 标题上限（字符数） */
export const LOCAL_NOTE_TITLE_MAX = 80;

/** 正文上限（字符数）；比实体笔记的 20k 小，便签定位是"临时记一笔" */
export const LOCAL_NOTE_MAX_LENGTH = 8_000;

/** 单张便签的附件数上限 */
export const LOCAL_NOTE_MAX_ATTACHMENTS = 30;

/** 附件种类：能内联预览的图片 / 交给系统程序打开的其它文件 */
export type LocalNoteAttachmentKind = 'image' | 'file';

/** 便签附件（文件本体在 `$APPDATA/notes/media/`，这里只有元数据） */
export interface LocalNoteAttachment {
  /** 附件 id（React key） */
  readonly id: string;
  /** 用户原始文件名 */
  readonly fileName: string;
  /** 落盘文件名（`{id}.{ext}`） */
  readonly storedName: string;
  /** 图片可内联预览，其余按附件处理 */
  readonly kind: LocalNoteAttachmentKind;
  /** 字节数 */
  readonly size: number;
  /** ISO8601 */
  readonly addedAt: string;
}

/** 本地便签（`userdata/localnotes.json` 的 `notes[]` 元素） */
export interface LocalNote {
  /** 便签 id */
  readonly id: string;
  /** 标题（可为空） */
  readonly title: string;
  /** 正文 */
  readonly content: string;
  /** 便签配色 */
  readonly color: LocalNoteColor;
  /** 附件列表 */
  readonly attachments: readonly LocalNoteAttachment[];
  /** ISO8601 */
  readonly createdAt: string;
  /** ISO8601 */
  readonly updatedAt: string;
}

/** 配色是否合法 */
function isLocalNoteColor(value: unknown): value is LocalNoteColor {
  return typeof value === 'string' && LOCAL_NOTE_COLORS.some((candidate) => candidate === value);
}

/**
 * 落盘文件名是否安全。
 *
 * 与 Rust 侧 `notes_media::is_safe_stored_name` 同规则：只允许字母数字、`-`、`_`、
 * 一个点，且不以点开头。前端先过滤一遍，避免把 `../` 之类的脏值渲染进 img src 或
 * 传给 open 命令（Rust 还会再挡一次）。
 */
export function isSafeStoredName(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value === '' || value.length > 80 || value.startsWith('.')) return false;
  if (value.includes('..') || value.includes('/') || value.includes('\\')) return false;
  return /^[A-Za-z0-9._-]+$/.test(value);
}

/** 任意值 → 合法 ISO 字符串（非法值回退到 fallback） */
function isoOr(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const time = Date.parse(value);
  return Number.isFinite(time) ? value : fallback;
}

/** 把任意值收敛为一条附件；形状不对返回 undefined */
function coerceAttachment(value: unknown): LocalNoteAttachment | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  if (!isSafeStoredName(source.storedName)) return undefined;
  const kind: LocalNoteAttachmentKind = source.kind === 'image' ? 'image' : 'file';
  return {
    id: typeof source.id === 'string' && source.id !== '' ? source.id : source.storedName,
    fileName:
      typeof source.fileName === 'string' && source.fileName !== ''
        ? source.fileName
        : source.storedName,
    storedName: source.storedName,
    kind,
    size:
      typeof source.size === 'number' && Number.isFinite(source.size) && source.size >= 0
        ? Math.round(source.size)
        : 0,
    addedAt: isoOr(source.addedAt, new Date(0).toISOString()),
  };
}

/**
 * 把任意值收敛为本地便签数组。
 *
 * 兼容两种顶层形状：`{ notes: [...] }`（当前写法）与裸数组（早期/手改文件）。
 * 坏条目整条丢弃（没有 id 的便签在 UI 里无法编辑/删除），坏字段只丢该字段：
 * 用户手改过 JSON 时，能救回来的内容尽量救。
 *
 * @param raw `userdata_read('localnotes')` 解析后的值
 */
export function coerceLocalNotes(raw: unknown): readonly LocalNote[] {
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === 'object' && raw !== null && Array.isArray((raw as Record<string, unknown>).notes)
      ? ((raw as Record<string, unknown>).notes as readonly unknown[])
      : [];
  const fallbackTime = new Date(0).toISOString();
  const seen = new Set<string>();
  const result: LocalNote[] = [];

  for (const item of list) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue;
    const source = item as Record<string, unknown>;
    const id = typeof source.id === 'string' ? source.id.trim() : '';
    if (id === '' || seen.has(id)) continue;
    seen.add(id);

    const attachments: LocalNoteAttachment[] = [];
    if (Array.isArray(source.attachments)) {
      for (const attachment of source.attachments) {
        const coerced = coerceAttachment(attachment);
        if (coerced === undefined) continue;
        if (attachments.length >= LOCAL_NOTE_MAX_ATTACHMENTS) break;
        attachments.push(coerced);
      }
    }

    const createdAt = isoOr(source.createdAt, fallbackTime);
    result.push({
      id,
      title: typeof source.title === 'string' ? source.title.slice(0, LOCAL_NOTE_TITLE_MAX) : '',
      content: typeof source.content === 'string' ? source.content.slice(0, LOCAL_NOTE_MAX_LENGTH) : '',
      color: isLocalNoteColor(source.color) ? source.color : 'amber',
      attachments,
      createdAt,
      updatedAt: isoOr(source.updatedAt, createdAt),
    });
  }

  return result;
}
