/**
 * 源站宏文本里的 `<gridfightinfo>` / `<variable>` 预处理。
 *
 * `gridfightinfo` 是「按 id 引用另一个图鉴条目」的标签，自身没有正文：
 * `<gridfightinfo type=item id=35030607>` → 原站渲染成「闪光手榴弹」。
 * MacroText 对未知标签的策略是「去标签、保留正文」，这种自闭合标签就会留下
 * 一对空括号（`可通过【】获取【虚弱】`），造成内容缺失。所以卡片在交给
 * MacroText 之前先用本模块把 id 解析成显示名。
 *
 * `variable` 是主角光环的运行时数值占位（如「当前提高：<variable …>」）。
 * 静态数据里拿不到战斗内数值，原站显示「战斗中决定」，这里同样替换成
 * 本地化占位，而不是用 `param_list` 编造一个当前值。
 */

/** 把 `gridfightinfo` 的 type/id 解析成显示名；返回 undefined 时回退 id */
export type GridFightInfoResolver = (type: string, id: string) => string | undefined;

/** `<gridfightinfo type=item id=35030607>`（源站没有闭合标签） */
const GRIDFIGHT_INFO_TAG = /<gridfightinfo\b([^>]*)>/gi;

/** 属性里的 `type=` / `id=`；允许等号两侧有空格 */
const TYPE_ATTR = /type\s*=\s*([A-Za-z]+)/i;
const ID_ATTR = /id\s*=\s*([^>\s]+)/i;

/** `<variable … format=i%>`（属性里还嵌着 `<unbreak>`，不能用通用标签正则） */
const VARIABLE_TAG = /<variable\b[\s\S]*?format=([^>\s]*)\s*>/gi;

/**
 * 把 `<gridfightinfo>` 替换成解析后的名字。
 *
 * @param input 原始宏文本
 * @param resolve 解析函数；缺省时原样返回，不改变现有页面的行为
 * @returns 替换后的文本
 */
export function expandGridFightInfo(input: string, resolve?: GridFightInfoResolver): string {
  if (resolve === undefined || !input.includes('<gridfightinfo')) return input;
  return input.replace(GRIDFIGHT_INFO_TAG, (whole, attrs: string) => {
    const type = TYPE_ATTR.exec(attrs)?.[1] ?? '';
    const id = ID_ATTR.exec(attrs)?.[1] ?? '';
    if (type === '' || id === '') return whole;
    const label = resolve(type, id);
    // 解析不到时至少把 id 露出来，避免又变成一对空括号
    return label !== undefined && label !== '' ? label : id;
  });
}

/**
 * 把 `<variable>` 运行时占位替换成「战斗中决定」。
 *
 * @param input 原始宏文本
 * @param placeholder 已翻译的占位文案
 * @returns 替换后的文本
 */
export function replaceVariablePlaceholders(input: string, placeholder: string): string {
  if (!input.includes('<variable')) return input;
  return input.replace(VARIABLE_TAG, placeholder);
}
