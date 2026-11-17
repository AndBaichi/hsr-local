# 搁置目录索引

> 用户约束（2026-11-15）：**功能全部可用之前不删任何东西**。
> 不用的文件按原相对路径移到这里，等验收通过后再统一决定去留。
> 所有条目都记「原路径 / 日期 / 原因 / 恢复方法」。

| 现路径 | 原路径 | 搁置日期 | 原因 | 恢复方法 |
|---|---|---|---|---|
| `_attic/probe/AssetProbe.tsx` | `src/.../AssetProbe.tsx`（临时探针页） | 2026-11-15 | asset 协议 scope 验证用的临时页面，验证已完成 | 移回 `src/` 并在路由里注册即可 |
| `_attic/probe/UserDataProbe.tsx` | `src/.../UserDataProbe.tsx`（临时探针页） | 2026-11-15 | userdata 三条验收的测量脚本 | 同上 |
| `_attic/probe/probe-server.mjs` | 项目根临时脚本 | 2026-11-15 | 探针的 4199 端口 HTTP 上报通道 | `node _attic/probe/probe-server.mjs` |
| `_attic/i18n-merge.mjs` | 项目根临时脚本 | 2026-11-15 | 向四语言包批量合并 `list.*` / `detail.*` / 新导航键 | `node _attic/i18n-merge.mjs`（会重复合并，幂等） |
| `_attic/i18n-fix.mjs` | 项目根临时脚本 | 2026-11-15 | 补 `list.kindCavern/kindPlanar`、修日文 `件套` | `node _attic/i18n-fix.mjs`（幂等） |
| `_attic/negative-cache/BossIconTemporary.webp.missing` | `.cache/fetch/img/monster/BossIconTemporary.webp.missing` | 2026-11-15 | 这张图其实存在（源站 200），旧 URL 拼错写了负缓存。移开后重建才会重新下载 | 移回 `.cache/fetch/img/monster/` 即恢复「跳过下载」行为 |
| `_attic/probe/pathprobe.cjs` | 项目根 `.tmp_probe/pathprobe.cjs`（一次性探针） | 2026-11-15 | 排查 `scripts/with-mingw.mjs` 注入多个 PATH 目录时后者覆盖前者，导致 `npm run selftest` 报 cargo 找不到。问题已修复 | `node scripts/with-mingw.mjs node _attic/probe/pathprobe.cjs` 可复现子进程的 PATH 内容 |
| `_attic/i18n-t04b.mjs` | 项目根临时脚本 | 2026-11-15 | T04b 期间批量补 22 个 i18n key 的四语言合并脚本，已停用 | `node _attic/i18n-t04b.mjs`（幂等） |
| `_attic/preview/index.html` + `main.tsx` | `preview/`（项目根） | 2026-11-17 | `PagedGrid` 的纯前端预览页，用来在 Edge headless 里截屏验证「分组标题 + 右侧字母条 + 吸顶」的观感。视觉验收已完成，且它不参与 `npm run build`（Vite 单入口 `index.html`） | 把 `_attic/preview/` 移回项目根，并在 `tailwind.config.js` 的 `content` 数组加回 `'./preview/**/*.{ts,tsx}'`（否则预览页的 utility 类不会被生成），然后 `npx vite --port 1420` 访问 `/preview/index.html`。支持的查询参数：`?scroll=900`（滚到指定像素）、`?pick=S`（模拟点击字母 S） |
| `_attic/scripts/tmp-index-chars.mjs` | `scripts/` | 2026-11-17 | 统计四语言索引里所有卡片的**首字符**去重集合，用来定拼音表的覆盖范围（839 个汉字） | `node _attic/scripts/tmp-index-chars.mjs <解包目录>`，产物写到 `/tmp/hsr-index/*.json` |
| `_attic/scripts/tmp-gen-pinyin.py` | `scripts/` | 2026-11-17 | 用 `pypinyin` 给上一步的首字取 `Style.FIRST_LETTER`，生成初版分组 + 多音字清单。依赖 Python 包 `pypinyin`（`pip install pypinyin`） | `python _attic/scripts/tmp-gen-pinyin.py` |
| `_attic/scripts/tmp-emit-pinyin.mjs` | `scripts/` | 2026-11-17 | 把上一步的 JSON 写成 `src/lib/text/pinyin-initials.generated.ts`，并应用多音字人工裁决（长 / 重 → c） | `node _attic/scripts/tmp-emit-pinyin.mjs`（会覆盖生成文件，先确认例外表） |

## 源码树内「未删除」的事实记录（不在本目录，不回避）

1. `src-tauri/tauri.conf.json` 的 `app.security.assetProtocol.scope` 里
   `"$RESOURCE/datapack/**"` 被移除。纯配置项收窄，没有文件丢失。
   恢复：把该字符串加回数组即可。
   备注：用户「先不删东西」的指示是在这条改动**之后**下的，此处仅作追溯。
2. `src/components/common/PagePlaceholder.tsx` 等占位组件**仍然保留在源码树**，
   没有删除；原占位页已替换为真实页面。其中 5 个 T05 页仍 `import` 它但不再渲染，
   改为导出 `ATTIC_*` 常量停放（见第 3 条），并非「不再被引用」。
3. T05 五个页面把退役的 `PagePlaceholder` import **不删除，改为导出 `ATTIC_*` 常量停放**：
   `src/pages/search/SearchPage.tsx`（`ATTIC_SearchPagePlaceholder`）、
   `src/pages/compare/ComparePage.tsx`（`ATTIC_PAGE_PLACEHOLDER`）、
   `src/pages/favorites/FavoritesPage.tsx`、`src/pages/notes/NotesPage.tsx`、
   `src/pages/settings/SettingsPage.tsx`（后三者均为 `ATTIC_T01_PLACEHOLDER`）。
   `src/pages/home/HomePage.tsx` 未退役任何 import，故无需停放（源码内有注释说明）。
   同一约定也见于 `src/components/layout/SideNav.tsx` 的 `ATTIC_LIBRARY_MUI_ICONS`
   （停放资料库改用原站 webp 后不再使用的 MUI 图标）。
   即「先不要删东西」在代码里的落地是**显式停放 + export**（顺带避开 `noUnusedLocals`），
   而不是 `rm`；`PagePlaceholder.tsx` 仍在源码树，随时可恢复引用。

## 何时清理

等 T05 打包验收通过、三个新栏目（更新日志 / 终局内容 / 货币战争）也全部可用之后，
再由用户确认是否清理。在此之前本目录只读，禁止 `rm`。

## 本轮核对（2026-11-15 文档定稿）

- 上表 8 个条目对应的文件均已在 `_attic/` 下逐项确认存在，描述与 `README.md` §3.1 / §3.2、
  `docs/02-architecture.md` 附录 B 的实测结论一致；`pathprobe.cjs` 行此前被空行隔断，已并入表格。
- `_attic/i18n-t04b.mjs`（T04b 批次停放的四语言合并脚本）此前漏登，本轮已补入上表；
  文件本身早在 2026-11-15 14:50 就已停放，本轮**未移动或新增任何文件**，只是补齐登记。
- `src-tauri/target/release/bundle/nsis/HSR Databank_0.1.0_x64-setup.exe` 已于
  2026-11-15 16:18 产出（81,593,335 B），T05 打包验收通过；但按用户「等功能都可以用再说」
  的约束，本目录在全部功能验证完成前**仍保持只读，禁止 `rm`**。
- 本轮未删除任何文件。

## 2026-11-17 · 首页公告/资讯联调用的临时测试

- 原路径：`src/lib/news/live.check.test.ts`
- 移动日期：2026-11-17 00:39
- 原因：这是一次性的真实网络联通性验证（打米游社真实接口 + 校验原文链接 200），
  **不适合留在常规测试套件里**（会让 `npm test` 依赖外网，断网即红）。
  验证已通过（两类各 5 条真实数据、`articleUrl` 返回 200），因此按「不删、只停放」的约定移到这里。
- 恢复方法：`mv _attic/src/lib/news/live.check.test.ts.parked src/lib/news/live.check.test.ts`，
  然后 `npx vitest run src/lib/news/live.check.test.ts`（需要联网）。
- 后续补记（2026-11-17 00:59）：vitest 默认扫描**整个项目根目录**，`_attic/**` 也在扫描范围内，
  该文件因相对引用 `./miyoushe` 失效而让 `npm test` 报文件级失败（0 用例失败）。
  已追加 `.parked` 后缀使其不再被收集，测试恢复 48 passed。**在 _attic 里放任何 `*.test.ts` 都会踩这个坑**，
  今后停车测试文件一律加 `.parked` 后缀。

## 2026-11-17 · 改名前的旧安装包

- 原路径：`src-tauri/target/release/bundle/nsis/HSR Databank_0.1.0_x64-setup.exe`
- 现在的路径：`_attic/artifacts/HSR Databank_0.1.0_x64-setup.exe`
- 移动日期：2026-11-17 01:30
- 原因：这是 `productName` 还叫 `HSR Databank` 时打的包（mtime 2026-11-16 22:10），
  与现在的「星穹铁道数据库」并存会让人分不清装哪个。按「不删、只停放」的约定移到这里。
- 恢复方法：`mv "_attic/artifacts/HSR Databank_0.1.0_x64-setup.exe" src-tauri/target/release/bundle/nsis/`
