# 03 · 模块扩展：更新日志 / 终局内容 / 货币战争 + 原站图标

> 状态：**T02b + T04b 已实现并验收**（2026-11-15）。三个栏目均已上线、数据已入包。
> 待并入 PRD（下一个版本号）与架构文档附录。
> 触发：用户 2026-11-15 提出「软件内还缺少更新日志、高难内容、货币战争这几个栏目」，
> 并要求「图标内容直接用原网站的」「现在先不要删东西，不用的放一边」。
> 本文所有路径、大小、条数均为 **2026-11-15 实测**，不是推测。
>
> 落地结果见文末 **§9 实现与验收记录**（本轮新增）。

---

## 1. 原站导航全表（这是本次最重要的一份事实）

从 `https://hsr.nanoka.cc/_app/immutable/nodes/0.C6CeEqQi.js`（布局组件）里直接读出的
导航数组，**这就是原站的全部栏目，没有遗漏**：

| # | 路由 | i18n 键 | 中文文案（实测） | 图标路径 | 本项目现状 |
|---|---|---|---|---|---|
| 1 | `/` | — | HSR | `phoneappicon/DataBankIcon.webp` | 已有首页 |
| 2 | `/character` | `nav.character` | 角色 | `phoneappicon/AvatarIcon.webp` | 已有（T04 待写） |
| 3 | `/lightcone` | `nav.lightcone` | 光锥 | `tabicon/teach/BattleTeachBasicIcon.webp` | 已有 |
| 4 | `/relic` | `nav.relic` | 遗器 | `tabicon/activity/BoxingClubIcon.webp` | 已有 |
| 5 | **`/diff`** | `nav.diff` | **更新日志** | 内联 SVG（双向箭头） | **缺** |
| 6 | `/achievement` | `nav.achievement` | 成就 | `phoneappicon/AchievementIcon.webp` | 已有 |
| 7 | `/item` | `nav.item` | 物品 | `phoneappicon/InventoryIcon.webp` | 已有 |
| 8 | `/monster` | `nav.monster` | 敌对物种 | `tabicon/maze/MonsterIcon.webp` | 已有 |
| 9 | **`/maze`** | `nav.endgame` | **终局内容**（侧边栏标题为「终局挑战」） | `tabicon/abyss/AbyssIcon01.webp` | **缺** |
| 10 | **`/currency`** | `nav.currency` | **货币战争** | `gridfight/icon/1001.webp` | **缺** |

### 1.1 必须纠正的一个认知偏差

**原站的「更新日志」= `/diff` = 两个数据版本之间的实体差异对比**，不是运营公告，
也不是我们 PRD 里的「多角色对比」。

原站 i18n 原文（`chunks/kelNncm4.js` 内嵌）：

> `description: "Compare changes across characters, Light Cones, and relics for the selected data releases."`
> `status: { added: "Added", removed: "Removed", changed: "Changed" }`
> `entity: { character: "Characters", lightcone: "Light Cones", relic: "Relics" }`

即：**更新日志只覆盖 角色 / 光锥 / 遗器 三类实体**，状态为 新增 / 移除 / 修改。

我们 PRD 里的「多角色对比」（ComparePage）是用户另外勾选的一项**增强功能**，
与原站 `/diff` 是两件事，**两者都要保留，不能互相顶替**。这是本次需求里最容易做错的一点。

---

## 2. 终局内容（用户所称「高难内容」）

### 2.1 四个子栏目

从 `chunks/D3adk-8K.js`（终局子导航组件）读出：

| 子栏目 | 路由 | i18n 键 | 中文 |
|---|---|---|---|
| 忘却之庭 | `/maze` | `endgame.moc.title` | 忘却之庭 |
| 虚构叙事 | `/story` | `endgame.pf.title` | 虚构叙事 |
| 末日幻影 | `/boss` | `endgame.as.title` | 末日幻影 |
| 异相仲裁 | `/peak` | `endgame.peak.title` | 异相仲裁 |

### 2.2 数据源（实测）

| 用途 | 路径（相对 `https://static.nanoka.cc/hsr/4.7.51/`） | 实测 |
|---|---|---|
| 忘却之庭 汇总 | `maze.json` | 200，17,051 B，**49 条** |
| 虚构叙事 汇总 | `maze_extra.json` | 200，7,451 B，**29 条** |
| 末日幻影 汇总 | `maze_boss.json` | 200，7,080 B，**24 条** |
| 异相仲裁 汇总 | `maze_peak.json` | 200，1,580 B，**12 条** |
| 忘却之庭 版本映射 | `{lang}/maze/version.json` | 200，969 B |
| 异相仲裁 版本映射 | `{lang}/peak/version.json` | 200，273 B |

汇总条目结构（`maze.json` 样例）：

```json
"100": { "param":[0.5], "id":"100", "zh":"永屹之城遗秘", "en":"...",
         "ja":"...", "ko":"...", "begin":"", "end":"",
         "live_begin":"", "live_end":"" }
```

`maze.json` 的 id 分布：`100` / `900`（常驻）、`110–119`、`1001–1038`（赛季）。
原站 `/maze` 列表的过滤条件是 `Number(id) >= 1000 || id === '100' || id === '900'`。

`version.json` 把游戏版本映射到赛季 id，例如 `"4.7": [1037]`、`"static": [100, 900]`，
用于给赛季生成「4.7 v1」这样的标签。

### 2.3 ⚠️ 汇总文件名与详情目录名**不一致**（已实测，别再踩）

| 汇总文件 | 详情实际路径 | 实测 |
|---|---|---|
| `maze.json` | `{lang}/maze/{id}.json` | `zh/maze/1001.json` 200，43,340 B |
| `maze_extra.json` | **`{lang}/story/{id}.json`** | `zh/story/2029.json` 200，53,473 B |
| `maze_boss.json` | **`{lang}/boss/{id}.json`** | `zh/boss/3023.json` 200，74,442 B |
| `maze_peak.json` | **`{lang}/peak/{id}.json`** | `zh/peak/12.json` 200，14,204 B |

反例（全部 404，不要用）：`zh/maze_extra/2029.json`、`zh/maze_boss/3023.json`、
`zh/maze_peak/12.json`。

**推论**：详情文件总量 = (49 + 29 + 24 + 12) × 4 语言 = **456 个文件**，
单文件 14–74 KB，估算 15–25 MB（未压缩）。

### 2.4 已知的空值坑

`maze_boss.json` 的最新赛季 `3024`：`"en":null, "zh":null, "ja":null, "ko":null`
（未实装/测试服数据）。**列表与详情都必须容忍 name 为 null**，
回退策略：显示 `赛季 {id}`，不要显示空白或 `null`。

原站 i18n 里终局相关文案键已确认存在，可直接借用语义：
`status.{current,currentLive,currentTest,upcoming,past,unknown}`、
`common.{openSeason,stageList,stage,seasonEffects,stageEffects,challenge,
recommendedElements,enemyWaves,permanent,monsterLevel,teamLimit,maxLoopCount,
circuitBuffs,roleEnhance,passScore,targetScore,rewards,seasonId,zoneList,zoneBuffs}`、
`common.hardMode`、以及 `invasion.*`（贪饕污染，异相仲裁专属机制）。

---

## 3. 货币战争

### 3.1 六个子栏目

从 `nodes/8.D-htPWCR.js`（`/currency` 首页卡片）读出，**这就是全部六个**：

| 路由 | i18n 键 | 中文 | 图标 |
|---|---|---|---|
| `/currency/role` | `currency.roleTitle` | 角色图鉴 | `avatarroundicon/1001.webp` |
| `/currency/item` | `currency.itemTitle` | 装备图鉴 | `gridfight/equipment/350101.webp` |
| `/currency/buff` | `currency.buffTitle` | 投资环境图鉴 | `gridfight/portal/101.webp` |
| `/currency/augment` | `currency.augmentTitle` | 投资策略图鉴 | `gridfight/augmentbig/100101.webp` |
| `/currency/spotlight` | `currency.spotlightTitle` | 主角光环图鉴 | `gridfight/maincharacterbuff/100000.webp` |
| `/currency/trait` | `currency.traitTitle` | 羁绊图鉴 | `gridfight/icon/1001.webp` |

`/currency` 本身只是这六张卡片的入口页，无独立数据。

### 3.2 数据源（实测，均为 `{lang}/currency/{name}.json`）

| 文件 | 中文 | 实测大小（zh） |
|---|---|---|
| `role.json` | 角色图鉴 | 200，40,689 B |
| `item.json` | 装备图鉴 | 200，201,599 B |
| `buff.json` | 投资环境图鉴 | 200，39,682 B |
| `augment.json` | 投资策略图鉴 | 200，188,195 B |
| `spotlight.json` | 主角光环图鉴 | 200，59,923 B |
| `trait.json` | 羁绊图鉴 | 200，333,316 B |

zh 合计约 **823 KB**，四语言约 **3.3 MB**（未压缩）。

反例（404）：`currency/role.json`（不带语言前缀不存在）、`zh/currency_role.json`。

其它已确认的 i18n 键：`currency.{season,title,open,recommendedSpotlights,
recommendedCharacters,enemyDifficultyIncrease,tags,frontline,backline,
firstChoice,secondChoice,battleValue}` —— 说明详情里至少有「赛季 / 标签 / 前后排 /
推荐度 / 推荐角色与光环」这些展示维度。

---

## 4. 更新日志（`/diff`）

### 4.1 数据是**预算好的差异包**，不需要同时装两个版本

从 `nodes/16.Dy40E1pb.js` 的 loader 读出：

```js
let base = `${STATIC}/${toVersion}/diff`;
let url  = `${base}/${lang}.json`;
// 404 时回退：
url = `${base}/from-${fromVersion}/${lang}.json`;
```

实测：`https://static.nanoka.cc/hsr/4.7.51/diff/zh.json` → **200，3,544,719 B**。

包结构（loader 里的默认值即 schema）：

```json
{ "schemaVersion":1, "projectorRevision":"", "fromVersion":"", "toVersion":"",
  "locale":"", "generatedAt":"", "sourceHashes":{"from":"","to":""},
  "counts":{"character":0,"lightcone":0,"relic":0,"total":0},
  "items":[ ... ] }
```

`items[].entity ∈ {character, lightcone, relic}`；
`items[].changes[]` 里带 `contextOnly` 标志，原站会过滤掉「只有上下文变化」的条目
（`Q` 函数：过滤后若仍含非 contextOnly 的变更才保留该 item）。

### 4.2 首版范围裁剪（**建议，待用户确认**）

原站支持任意 from/to 版本对。完整复刻需要打包多个版本的数据，体积与复杂度都会上一个台阶。

**首版建议：只打包当前版本相对上一版的差异包**，即
`4.7.51/diff/{lang}.json` × 4 语言 ≈ **14 MB**（未压缩，压缩后会小很多）。
UI 上做「更新日志」单页：版本切换固定为 `上一版 → 4.7.51`，提供
角色/光锥/遗器三个页签 + 新增/移除/修改 分组。

「任意版本对比较」列为后续项（P2），因为它本质上是「多数据包并存」，
会牵动 `active.json` 指针与索引缓存的现有设计。

---

## 5. 图标策略（用户：「图标内容直接用原网站的就好了」）

**决策：下载原站图标文件、随数据包打包，不在运行时引用远程 URL。**

理由：本项目已确认的核心承诺是「全量离线、首启零网络请求」（PRD 附录 A）。
运行时引用 `static.nanoka.cc` 会在断网时得到一排裂图，且违背该承诺。
「用原网站的」理解为**素材来源用原站**，而非**运行时联网**。

补充（v1.8，仅追加）：该承诺的范围是**游戏数据、图片、搜索索引与数据包**。此后新增的首页「公告 / 资讯」两张卡是**唯一的联网点**（仅简中界面渲染、进入首页各拉一次、断网回退本地缓存、点条目走白名单交系统浏览器），它不改变上面这条素材离线原则——图标仍然全部下载进包，运行时不向 `static.nanoka.cc` 发任何请求。边界与降级链路见 `docs/01-PRD.md` 附录 D §D.0 的 v1.8 行与 `docs/02-architecture.md` §13。

上表 14 个图标已全部实测可下载（200，单个 1.2–11.3 KB），总量 < 60 KB。

落地方式：
- 放入数据包 `img/nav/{原路径}`，保持原站目录层级，便于以后对照
- 前端 `SideNav` 的图标改为 `<SafeImage>` 读数据包，不再用 MUI 图标字体
- `/diff` 原站用的是内联 SVG 而非 webp，**保留 SVG**（无对应资源文件）
- 应用自身的窗口/安装包图标（`src-tauri/icons/*`）可用
  `phoneappicon/DataBankIcon.webp` 派生，**但不删除现有 icons 目录**，见 §6

---

## 6. 「先不删东西」的落地规则

用户明确要求：功能都可用之前不删任何东西，不用的放一边。

- 新建 `hsr-local/_attic/` 作为**唯一的搁置目录**，按原相对路径存放
- 搁置 = `git mv` / 移动到 `_attic/`，**不是删除**
- 已发生的两处删除（事实记录，不回避）：
  1. `tauri.conf.json` 的 `assetProtocol.scope` 里 `$RESOURCE/datapack/**` 已被移除
     —— 纯配置项收窄，无文件丢失；如需还原，加回该字符串即可
  2. T03 的临时探针脚本已移出源码树，备份在 `/tmp/hsr-dev-probe-backup`
     —— **建议下次开工时把它移入 `_attic/probe/`**，/tmp 不是可靠存放点
- 后续所有「这个文件没用了」一律走 `_attic/`，并在 `_attic/INDEX.md` 记一行：
  原路径 / 搁置日期 / 搁置原因 / 恢复方法

---

## 7. 批次安排建议

| 批次 | 内容 | 依赖 |
|---|---|---|
| **T02b** | 数据包扩展：终局 456 详情 + 4 汇总 + 2 版本映射、货币 6×4 文件、更新日志 4 文件、导航图标 14 个；`meta.json` 的 `EXPECTED_COUNTS` 同步扩展 | 无，可与 T04 并行 |
| **T04**（进行中） | 原有 11 个页面 + 富文本渲染器 + SafeImage | 渲染器先行 |
| **T04b** | 终局 4 列表 + 4 详情、货币 1 入口 + 6 列表/详情、更新日志 1 页 | T02b 完成 |
| **T05** | 搜索/对比/收藏收尾、性能验收、打包 | 全部页面 |

**注意**：T02b 会改 `meta.json` 的条数声明，而 `pack.rs` 的 `counts_mismatch`
用的是**编译期常量**，`selftest` 的条数断言也对它做校验。
**改包必须同步改 `EXPECTED_COUNTS`，否则自检会报 `PACK_CORRUPT`** —— 这是刻意的，
但意味着 T02b 不是纯数据侧工作，必须连带改 Rust 常量并重跑 selftest。

---

## 8. 待确认项

1. 更新日志首版是否接受「仅当前版本 vs 上一版」（§4.2）
2. 货币战争六个子栏目是否全做，还是首版只做角色/装备/投资策略三个高价值项
3. 终局内容的「异相仲裁」（`/peak`，12 条）是否纳入首版——它是最新模式，
   数据量最小但机制文案（`invasion.*` 贪饕污染）与其它三个不通用


---

## 9. 实现与验收记录（2026-11-15 实测）

> 本节是落地后的事实记录，不改写上文任何侦察结论；上文 §1–§8 保留原样作为依据。

### 9.1 三个待确认项的处置

| §8 待确认项 | 本轮处置 | 理由 |
|---|---|---|
| 更新日志首版是否只做当前版本 vs 上一版 | **是**，只打包 `4.7 → 4.7.51` | 任意版本对本质是多数据包并存，会牵动 `active.json` 与索引缓存，留 P2 |
| 货币战争六个子栏目是否全做 | **全做** | 六份数据总计不足 1 MB（zh），六个页面成本远低于只做三个 |
| 异相仲裁 `/peak` 是否纳入首版 | **纳入** | 12 条、最小，机制文案与其它三个共用 `MacroText` 渲染器即可 |

### 9.2 数据与页面

| 模块 | 数据 | 页面 |
|---|---|---|
| 更新日志 | `db/{lang}/diff.json` × 4，330 条差异 / 496 个 `contextOnly` 变更 | `src/pages/changelog/ChangelogPage.tsx` |
| 终局内容 | 4 汇总 + 114 赛季 × 4 语言 = 456 详情 + 8 个 `version.json` | `src/pages/endgame/EndgamePage.tsx` + `EndgameDetailPage.tsx` |
| 货币战争 | `db/{lang}/currency/{6 类}.json` × 4 语言 | `src/pages/currency/CurrencyPage.tsx` |
| 原站图标 | `img/nav/**` 14 个 + `img/gridfight/**` | `SideNav` 用 9 个 webp；`/changelog` 按 §5 用内联 SVG |

`EXPECTED_COUNTS` **无需改动**：`pack.rs` 只校验 8 个编译期常量（六个原索引 + 变体/成就条数），新模块不在其路径上；`PackMeta` 无 `deny_unknown_fields`。selftest 36/36 通过即为证据。

### 9.3 实测到的两个「反直觉」数据事实（已写进代码与契约测试）

1. **`maze.json` / `maze_extra.json` / `maze_boss.json` 的值带 `id`，`maze_peak.json` 的值不带** —— 统一用 `Object.entries` 的对象键兜底。
2. **货币战争 `item.json` 的值没有 `id` 字段**（只有对象键有，如 `350101`），其余五个图鉴的值都带。直接 `Object.values` 会让 269 个装备条目 `id === undefined`，列表无稳定 key、图标路径也拿不到。`getCurrencyEntries()` 已改为注入 `value.id ?? key`。
3. `maze_boss.json` 的 `3024` 赛季四语言名全为 `null`，`seasonName()` 回退到「赛季 3024」。

### 9.4 两套富文本体系（不能合并）

| | 原六模块 | 三个新栏目 |
|---|---|---|
| 形状 | 归一化节点数组 `{v,p,f,s,c}` + 段落 | 源站**原始宏字符串** |
| 渲染器 | `src/lib/text/richtext.ts` | `src/lib/text/macrotext.ts` |
| 未知格式 | 抛 `RichTextError`（自有管线封闭取值域） | 去标签保留正文，收集 `unknownTags`（第三方数据会随版本增长） |
| 视图 | `RichTextView.tsx` | `MacroText.tsx` |

两者都只产出 React 节点树，**不用 `dangerouslySetInnerHTML`**、不拼 HTML 字符串。全量扫描：原模块 1145 文件 / 20530 段 / 36827 节点；新模块 122 文件 / 38478 字符串（含 343 个空字符串占位，渲染为空 spans 是正确行为）。

### 9.5 验收数字

- `.hsrpack` 重建：**6802 条目 / 75,925,903 B（72.4 MiB）**，源 136.0 MB，压缩率 53.2%；原包 5461 条 / 66.1 MB。28/28 入包断言 PASS。
- 安装态 `%APPDATA%/com.hsr.local.databank/packs/hsr-4.7.51-local/` 非破坏性 overlay 同步至 6802 文件，`manifest.json` 的 sha256 逐文件核对 **6801 OK / 0 mismatch / 0 missing**；`active.json` 未改动。
- Rust `selftest`：**36/36**（含真实包集成：6 索引 639 KiB 冷读 60 ms）。
- 前端 `typecheck` / `build` EXIT 0；`vitest` **52/52**；新增 `src/lib/data/extra.contract.test.ts` **10/10**，钉住上文所有路径与形状约定。
- 四语言 i18n 340 key，逐 key 校验完全对齐。

### 9.6 仍未闭环

- asset 协议 scope 的**运行时** 403 验证：静态链路已闭合（`tauri.conf.json` 的 `$APPDATA/packs/**` → `%APPDATA%\{identifier}\packs\**` → `dal.assetUrl()` 的 root + rel），安装态图标 9/9 存在；但需在真机/开发态点开侧栏确认无 403（`SafeImage` DEV 下会 warn）。
- 安装态冷启动 28.4 s（Defender 扫描 5461 文件时的旧测量），新包 6802 文件需重测。
- `selftest.exe` 随 NSIS 分发的问题（README §3.1 待办）：按用户「先不删东西」要求**保留**。
