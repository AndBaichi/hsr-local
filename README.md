# 星穹铁道数据库

崩坏：星穹铁道（Honkai: Star Rail）的**全量离线**桌面资料库。
游戏数据源自第三方社区数据库 `nanoka.cc`，全部内容（含图标 / 立绘）随安装包分发，运行期不访问原站。

> **唯一的联网点**：首页「公告 / 资讯」两张卡实时拉取米游社公开接口
> （`bbs-api-static.miyoushe.com/painter/wapi/getNewsList`），点击条目用系统浏览器打开原文。
> 结果缓存在本地，断网时回退到上次内容并标注「缓存 · 时间」；
> 该区块仅在简体中文界面显示。除此之外全程不发请求（详见文末「联网边界」）。

---

## 构建链三步

### 0. 环境（Windows + GNU 工具链，无 MSVC）

本项目只能使用 `x86_64-pc-windows-gnu` 工具链。每个新终端都要先执行：

```bash
export PATH="/c/Users/26609/.cargo/bin:$PATH"
export PATH="/c/Users/26609/AppData/Local/Microsoft/WinGet/Packages/BrechtSanders.WinLibs.POSIX.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe/mingw64/bin:$PATH"
```

验证：`cargo -V`、`windres --version` 均能输出版本。

### 1. 装依赖

```bash
npm install
```

### 2. 生成数据包

```bash
npm run datapack            # 全量：聚合文件 → 详情 → 图片 → 构建 → 打包 → 校验（≈6min 首跑）
npm run datapack:lists      # 只下 12 个聚合文件（<10s，用于验证网络与路径）
npm run datapack:validate   # 只跑断言（需先有 data/datapack）
```

单阶段也可以直接指定（阶段名：`lists` / `details` / `images` / `build` / `pack` / `validate` / `all`）：

```bash
node scripts/build-datapack.mjs --stage build
```

产物：

- `data/datapack/`（**6801 个文件 / 136.0MB**，解开的目录；T02 六模块 + T02b 三栏目）
- `hsr-local-4.7.51.hsrpack`（zip，**6802 条目 / 75,925,903 B（72.4 MiB）**；webp 用 store、json 用 deflate-9；源 136.0MB → 压缩率 53.2%）
- `datapack-report.json`（全量断言结果，含 12 个聚合文件的逐字节核对；仍记录 T02 首轮的 5461 条目，见下方注）
- `scripts/build.log`（每 100 个文件一行进度）

> 加了三个栏目后重打包时**不要**直接跑 `node scripts/build-datapack.mjs --stage pack`：
> CLI 的 `main()` 总会覆写 `hsr-local/datapack-report.json`，会丢掉 lists/details/images/build/validate
> 各阶段统计。`scripts/lib/pack.mjs` 的 `stagePack()` 会递归 walk 整个 `data/datapack/`
> （**无白名单**），所以直接内联调用它即可把新文件全部纳入：
>
> ```bash
> node --input-type=module -e 'import { stagePack } from "./scripts/lib/pack.mjs"; await stagePack(console.log);'
> ```
>
> `src-tauri/src/pack.rs` 的 `EXPECTED_COUNTS` **不需要改**：它只校验 8 个编译期常量
> （六个原索引 + 变体/成就条数），新模块不在这些路径上；`PackMeta` 也没有
> `deny_unknown_fields`。Rust `selftest` 36/36 即为证据。

中断后直接重跑即可续传：下载落地到 `.cache/fetch/`（先写 `.tmp` 再 rename），已存在的文件跳过；
源站确认 404 的资源会留一个 `*.missing` 标记做**负缓存**，续跑不再重复请求（例如 `BossIconTemporary.webp`）。
全部产物与临时文件都在 C 盘，不写 D 盘。

数据规模（4.7.51 实测）：角色 101 / 光锥 174 / 遗器套装 64 / 敌人 666（382 组）/ 物品 1606 / 成就 2022（9 系列）；
图片按**源文件去重**共 1351 张（角色 101、光锥 174、敌人 222、物品+套装 838、属性 7、命途 9）。
`img/monster/BossIconTemporary.webp` **已补齐**：它确实存在于源站，早前 404 是因为
`scripts/lib/images.mjs` 误拼成 `Monster_BossIconTemporary.webp`（`BossIconTemporary`
不加 `Monster_` 前缀），并因此留下了错误的负缓存，现已移到本地归档 `_attic/negative-cache/`（不随仓库分发）。

T02b 追加（见 `docs/03-module-expansion.md`）：终局内容 4 汇总 + 114 赛季 × 4 语言 = 456 详情、
货币战争 6 图鉴 × 4 语言、更新日志 4 语言差异包、原站导航图标 14 个、货币战争图标约 829 张。
下载脚本 `scripts/build-extra-modules.mjs`，清单 `data/datapack/extra-manifest.json`。
其中 68 个 NPC 角色头像源站本身 404，属**预期**占位，由 `SafeImage` 的候选源链兜底。

### 3. 开发 / 打包

```bash
npm run dev                 # 仅前端（浏览器）
npm run tauri:dev           # 桌面窗口（推荐）
npm run tauri:build         # 产出 NSIS 安装包
```

产物位置：`src-tauri/target/release/bundle/nsis/`（Tauri 按 host 构建，不带三元组子目录；详见末节「已产出产物与校验」）。

### 3.1 自检（为什么不是 `cargo test`）

```bash
npm run selftest            # 推荐：包装器自带 cargo + MinGW 的 PATH
npm run selftest            # 未设包路径时 35/36（最后 1 条跳过）
HSR_SELFTEST_PACK="<解包后的数据包目录>" npm run selftest   # 36/36
# 或手工跑（需自己把 ~/.cargo/bin 与 MINGW_BIN 加进 PATH）：
cd src-tauri && cargo run --bin selftest   # 退出码 0 = 全绿，1 = 有失败
```

36 条断言全部在 `src-tauri/src/selftest.rs`，由 `src/bin/selftest.rs` 驱动
（35 条逻辑断言 + 1 条真实数据集成检查，见 §5.5）。

> `scripts/with-mingw.mjs` 现在会把 `~/.cargo/bin`（或 `$CARGO_HOME/bin`）与
> `MINGW_BIN` **依次累积**前置到 PATH。曾经 `prependPath()` 每次都从
> `process.env.PATH` 取基准，导致第二次注入 MinGW 时把第一次注入的 cargo 覆盖掉，
> 表现为 `npm run selftest` 报「'cargo' 不是内部或外部命令」。
> 修法是让 `prependPath(prefix, base)` 接收上一次的结果。排查用的探针留在
> `_attic/probe/pathprobe.cjs`。

**不要用 `cargo test`**：本工具链（`x86_64-pc-windows-gnu`）下 `libtest` 生成的 harness
二进制起不来，退出码 `0xC0000139`（`STATUS_ENTRYPOINT_NOT_FOUND`）。已验证排除的因素：

- 不是目录位置问题 —— 把测试 exe 拷到 `target/debug/` 仍同样失败
- 不是缺 `WebView2Loader.dll` —— 补上 DLL 仍失败
- 不是导入表差异 —— `objdump -p` 对比测试 exe 与主 exe 几乎一致，仅主 exe 多 `shlwapi.dll`
- 而**主 exe 与普通 bin 目标的链接/运行完全正常** ⇒ 挂的是 harness 本身，不是业务代码

结论：绕开 harness，把断言写成普通 bin。断言放在 **lib 内**（`selftest.rs`）而不是 bin 里，
是因为断言需要触达 `sanitize_entry_path`/`read_meta`/`bak_path_for` 等内部实现——
写进 bin 就得把它们全改成 `pub` 扩大公共 API 面。放 lib 内部只需 `pub(crate)`。
`selftest.rs` 自带 30 行 `TempDir`（建唯一目录 + Drop 删除），因此没有 `[dev-dependencies]`。

> 请用 debug 跑。`[profile.release]` 有 `panic = "abort"`，`catch_unwind` 会失效，
> 第一个失败就终止进程，看不到其余断言结果。

> **待办（公开发布前必须处理）**：`cargo build --bins` 会把 `selftest.exe`（约 500KB）
> 一起打进 NSIS 安装包，安装目录里因此会多一个"不认识的 exe"，双击还会闪一个控制台窗口。
> 现阶段保留它（现场排障能直接跑断言，相对 75,925,903 B 的数据包可忽略）；一旦要公开分发，
> 改成 `cargo` 的 `--example`（`src-tauri/examples/selftest.rs`，不进安装包），
> 用法改为 `cargo run --example selftest`。

> **断言夹具必须照抄真实 JSON 形状**。`pack: read_stats` 这条曾经把夹具写成
> `{"1001":{"name":{"zh":…}}}`，而真实数据是
> `[{"id":"1001","name":"三月七","names":{"zh":…}}]` —— **容器是数组**、**`name` 是字符串**，
> 两处都不一样。结果夹具永远通过、真机 `sampleCharacter` 永远 `None`（它只进日志，
> 不会报错，所以谁都没发现）。夹具照抄真实形状后，这个 bug 一次就暴露了。
> 现在三条断言分别覆盖：数组容器、只有 `name` 的退化包、对象容器。

### 3.2 构建环境：PATH 里必须有 MinGW（`windres` / `dlltool`）

`.cargo/config.toml` 钉死了 `linker` / `ar`，并用 `rustflags = ["-Cdlltool=…"]` 解决了
`dlltool`，但 **`windres` 只能按名字从 PATH 找**（`embed-resource` 里硬编码
`Compiler::windres("windres")`，`tauri-winres::set_windres_path()` 是个空壳）。
缺了它会 panic：

```
panicked at tauri-winres-0.3.7/src/lib.rs:543
called `Result::unwrap()` on an `Err` value: NotAttempted("windres")
```

`.cargo/config.toml` 的 `[env] PATH = { prepend = true }` **实测无效**（cargo 静默忽略
`prepend`，build.rs 里读到的 PATH 完全没变），所以改由 `scripts/with-mingw.mjs` 统一注入：
它从 `.cargo/config.toml` 读 `MINGW_BIN`（单一真源），前置到 PATH 后再 spawn 子进程。
`npm run tauri` / `tauri:dev` / `tauri:build` / `selftest` 都已走这个包装器，
因此这几个命令都不需要手工 `export PATH`（§0 的两行 export 只在**手工跑 cargo** 时才需要）。

若手工跑 `cargo`，请自己带上 PATH：

```bash
export PATH="/c/Users/26609/.cargo/bin:$PATH"
# 并把 .cargo/config.toml 里的 MINGW_BIN 前置到 PATH
```

> 另一个环境坑：若 `cargo build` 长时间停在某个 crate 上，先分清是「慢」还是「卡住」，
> 不要去猜。**采样法**（PowerShell，每 10 秒一行）：
>
> ```powershell
> while ($true) {
>   $p = Get-Process rustc -ErrorAction SilentlyContinue | Measure-Object -Property TotalProcessorTime -Sum
>   $files = (Get-ChildItem src-tauri\target\debug\deps -File | Measure-Object).Count
>   "$(Get-Date -Format HH:mm:ss) cpu=$($p.Sum) files=$files"
>   Start-Sleep 10
> }
> ```
>
> - `cpu` 持续增长 → **慢**，继续等（首次全量编译 7–8 分钟是正常的）
> - `cpu` 不动 **且** `files` 不动超过 2 分钟 → **卡住**（增量编译锁），
>   `CARGO_INCREMENTAL=0 cargo build -j 1` 绕过（实测 7m27s 编完，之前挂了 30 分钟）
> - `cpu` 不动但 `files` 在涨 → 正在链接/打包，别杀
>
> 卡住时 `TaskStop` 不够——它只杀 shell，`cargo.exe` / `rustc.exe` 会留在后台继续抢构建锁，
> 下一个 `cargo build` 就会静默排队。要么 `taskkill //F //IM cargo.exe //IM rustc.exe`，
> 要么 PowerShell `Get-Process cargo,rustc | Stop-Process -Force`，然后再确认一次真的没了：
> `tasklist //FI "IMAGENAME eq cargo.exe"`。

### 3.3 已知警告（不是错误，不要试图"修掉"）

```
warning: linker stderr: ... ld.exe: .rsrc merge failure: multiple non-default manifests
```

每个 exe 都会报。成因**与 Tauri / Rust 无关**，是 GNU 工具链的固定行为：

1. ld 会从 sysroot 强制链入 MinGW 的 `default-manifest.o`，我们自己的
   `windows-app.manifest`（由 `build.rs` 经 `tauri_build` 嵌入）也在，于是 exe 里出现
   两份同名同语言的 `RT_MANIFEST`（资源 id 都是 1）
2. 解析 PE 资源段可确认：`#0 nameId=1 2090B`（我们的，含 `permonitorv2`）+
   `#1 nameId=1 599B`（MinGW 的）。Windows 取哪一份**规范上不保证**

最小复现（3 行 C，与项目无关）：

```bash
printf 'int main(void){return 0;}' > t.c
gcc t.c            # 1 份清单，无警告
gcc t.c app.res    # 2 份清单，报 .rsrc merge failure
```

已排除的修法：`ld --disable-manifest` 在 binutils 2.47 **不存在**（`unrecognized option`，
`ld --help | grep manifest` 输出 0 行）；`default-manifest.o` 也不在 `libmingw32.a` 或 specs 里。

**为什么保留自写清单而不删**：删掉它虽然能让警告消失，但会丢掉 Common-Controls 与
`longPathAware`，反而带来别的显示问题。而 DPI 不依赖清单是否被选中——
`src-tauri/src/dpi.rs` 在创建窗口前调用 `SetProcessDpiAwarenessContext(-4)`，
失败再退 `SetProcessDpiAwareness(2)`，**结果由 `GetProcessDpiAwareness` 实测确认**。

因此 `src-tauri/src/main.rs` 顶部有 `#![allow(linker_messages)]`，
**这条 allow 是为了静音一个已定性、不可修的结构性警告，不是掩盖问题**。
只加在 bin 目标（`main.rs` / `bin/selftest.rs`），**不加在 `lib.rs`**——库里的链接器
消息以后可能有用。

### 4. 数据包在运行期怎么用（首启展开）

`hsr-local-4.7.51.hsrpack` 作为 Tauri resource 随安装包分发（`tauri.conf.json` 的
`bundle.resources`），**首次启动**时由 `src-tauri/src/pack.rs` 展开：

```
$RESOURCE/hsr-local-4.7.51.hsrpack          ← 只读压缩包（6802 条目 / 75,925,903 B）
  ↓ 首次启动解包（约 12s / 6802 条目）
%APPDATA%/com.hsr.local.databank/packs/hsr-4.7.51-local/
  ↓ 写完指针
%APPDATA%/com.hsr.local.databank/active.json  ← {"packId","root","gameVersion","schemaVersion","installedAt"}
```

- 目录级原子：先解到 `packs/{id}.tmp`，校验 `meta.json`（`packId` + `schemaVersion`）通过后整体 `rename`
- 之后每次启动只读 `active.json` + 一次 `stat`，不走解包路径
- 展开在后台线程跑，前端用 `pack_status` 命令查进度（`ready` / `extracting{files,total}` / `failed`）
- 解压在 `cargo build` 形态下没有 resource 目录，会按 `$RESOURCE → exe 同目录 → 项目根` 依次回退

---

## 5. 数据访问层（前端怎么读数据）

三层，各自负责一件事，**边界是刻意划死的**：

```
页面 / 组件
   ↓  只调 DAL，不直接 invoke
src/lib/data/dal.ts        DataAccessLayer：boot / 索引 / 详情 LRU / assetUrl
   ↓  invoke
src-tauri/src/datapack.rs  read_json(rel) / datapack_index()
   ↓  复用 pack::sanitize_entry_path
src-tauri/src/pack.rs      active.json → 数据包目录
```

### 5.1 三条通道

| 数据 | 通道 | 为什么是它 |
|---|---|---|
| 6 个模块索引（约 700KB） | `datapack_index`，**一次返回全部** | 一次 IPC + 一次 `JSON.parse`。分 6 次取要多付 6 次往返，错误处理还得写 6 遍 |
| 详情 / 成就条目 | `read_json(rel)` | **保留 `AppError.code`**。走 asset 协议时 `ENOENT` 会变成 HTTP 404，前端只能拿到 `Failed to fetch`，没有任何码可用 |
| 图片 | asset 协议（`convertFileSrc`） | 二进制、要流式与浏览器缓存，asset 协议正合适 |

数据包根目录**不新增命令**：`pack_status` 是唯一真相源，`ready` 分支里已经带了 `root`。

### 5.2 错误码

`read_json` 的失败一律带稳定码，前端只按 `code` 分支、不解析 `message`：

| 码 | 含义 | UI 该怎么办 |
|---|---|---|
| `PACK_NOT_FOUND` | 没有可用数据包 | 引导「重新导入」 |
| `PACK_FILE_MISSING` | 包在、某个文件缺 | 「数据缺失，请重装数据包」 |
| `PACK_INVALID_PATH` | 路径越界（`..`/绝对路径/盘符） | 正常前端不会触发，按内部错误处理 |
| `PACK_CORRUPT` | JSON 坏了 / 索引条数与 `meta` 不符 | 引导重装 |
| `PACK_INCOMPATIBLE_SCHEMA` | `schemaVersion` 不匹配 | 提示升级应用或换包 |
| `DATAPACK_NOT_READY` / `DATAPACK_TIMEOUT` | 前端自有：未 boot / 等就绪超时 | 重试 |

文案在 `src/i18n/locales/*.json` 的 `error.codes.*`，四语言齐全。
`DataAccessError.userMessageKey` 是模板字面量类型，**漏加一条文案会让 `tsc` 直接报错**。

### 5.3 两个「前后端同一套尺子」的地方

1. **条数核对**。Rust 的 `counts_mismatch` 比对 `meta.json` 与编译期常量；
   前端 `dal.boot()` 里的 `verifyIndex()` 比对**实际读到的条数**与 `meta` 声明。
   少读一批时当场报 `PACK_CORRUPT`，而不是等某个详情页空白才发现。
   注意敌人索引是按「组」聚合的：**382**（`monsterGroups`）而不是 666。
2. **路径校验**。`read_json` 复用 `pack::sanitize_entry_path`——zip-slip 那套规则
   在 JSON 通道上不开口子。`selftest` 里有 `../meta.json`、`C:/Windows/x.json`、
   `/etc/passwd`、空串四个用例。

### 5.4 缓存

| 缓存 | 位置 | 失效条件 |
|---|---|---|
| 6 个索引 | Rust `IndexCache`，键是 `root` | `root` 变（换包）即失效 |
| 详情 LRU（120 条） | 前端 `dal` | 切语言 / `rebind()` |
| 物品分片（16 片） | 前端 `dal` | 切语言 / `rebind()` |

物品走 `Number(id) % 16` 定位分片（T02 的规则，已验证 1606/1606 全部落在正确分片），
分片内是对象，首次读入后整片常驻——同片的后续查询零 IPC。

### 5.5 集成检查

`selftest` 的单测用的是 2 角色 / 30 物品的迷你夹具，只证明「逻辑对」。
要证明「真实数据包读得出来」，把它指向真实解包目录：

```bash
export HSR_SELFTEST_PACK="C:/Users/<你>/AppData/Roaming/com.hsr.local.databank/packs/hsr-4.7.51-local"
cd src-tauri && ./target/debug/selftest.exe
#   ok   集成: 真实数据包（6 索引条数对照 datapack-report.json + 详情正反三条）
#         样例角色=三月七，gameVersion=4.7.51，期望值来源=datapack-report.json
#         冷读一次 6 个索引：67 ms（含 serde_json 解析，目标 ≤150ms）；索引 JSON 合计 639.0 KiB
```

期望条数**不写字面量**，直接从 `datapack-report.json` 的 `expected.*` 读
（可用 `HSR_SELFTEST_REPORT` 指定别的路径）。理由：手写 101/174/64/382/1606/9 的风险是
数据包换版本后没人改，断言会一直"通过"到真实数据变了才炸——那时已经没人记得这些数字从哪来。

同一条里还跑三条真实数据断言：`db/zh/character/1001.json` 的 `name == "三月七"`、
`999999.json → PACK_FILE_MISSING`、`../../etc/passwd → PACK_INVALID_PATH`。

不设 `HSR_SELFTEST_PACK` 时该条**跳过**（打印 `skip`），不算通过也不算失败——CI 上不会因为
没有 `%APPDATA%` 数据而红。

### 5.6 asset 协议 scope：已实测（不要让这个结论只活在脑子里）

`tauri.conf.json` 里 `assetProtocol.scope = ["$APPDATA/packs/**"]`，
而数据包实际落在 `%APPDATA%\com.hsr.local.databank\packs\hsr-4.7.51-local\…`。
`$APPDATA` 在**字面上**是 `%APPDATA%`，容易被读成"少一层目录"；
实际它在 Tauri 里解析成 `app_data_dir()` ＝ `%APPDATA%\{identifier}`（`tauri-2.12.5/src/path/mod.rs:336`
→ `BaseDirectory::AppData → resolver.app_data_dir()`），所以 `$APPDATA/packs/**` 正好命中。

这个结论做过一次实测（临时探针 + 本机 HTTP 上报通道，验完即删），证据：

| 项 | 结果 |
|---|---|
| `img/character/1001.webp` | `OK 376×512` |
| `img/item/101.webp` | `OK 256×256` |
| `img/lightcone/20000.webp` | `OK 348×408` |
| `%APPDATA%\probe-outside.txt`（scope 外对照） | `ERR load-failed` ← **scope 确实在生效**，不是"没检查" |
| `fetch(assetUrl(...))` | `HTTP 200` |
| URL 形状 | `http://asset.localhost/C%3A%2FUsers%2F…%2F1001.webp` |

负向对照（scope 外那个文件）是这条验证里最值钱的一行：没有它，"三张图都能显示"也可能
只是 scope 根本没拦。**改 scope 后必须重跑一次负向对照。**

没法在 dev 形态验证的一条：`$RESOURCE/datapack/**`。生产包里 `resources` 只映射单个
`hsr-local-4.7.51.hsrpack` 文件，`$RESOURCE/datapack` 不存在，这条 scope 匹配不到任何东西，
**已从 `tauri.conf.json` 删掉**（留着的唯一后果是让人误以为资源目录里有解压好的数据）。
将来若改成"随包分发解压后的 `datapack/` 目录"，要把它加回来。

### 5.7 图裂了怎么定位（T04 之前先记住这个决策树）

`<img onError>` **分不出 403 和 404**——两者都是"裂图"，webview 里 `fetch` 抛的都是
`TypeError: Failed to fetch`。所以要主动拿状态码：

```ts
// SafeImage 的 onError 里做一次（只做一次，别循环）
const res = await fetch(url).catch(() => undefined);
// res === undefined → 协议层/网络层没通
// res.status === 403  → scope 拒绝 或 路径非法 → 是 bug，必须上抛
// res.status === 404  → 文件真的不存在 → 走占位图
```

Tauri 侧的分支（`tauri-2.12.5/src/protocol/asset.rs`）是三条，不是两条：

| 源码位置 | 文案 | 状态码 |
|---|---|---|
| `:48` | `asset protocol path "…" is not valid` | 403（`SafePathBuf` 拒绝：相对路径/含 `..`） |
| `:54` | `asset protocol not configured to allow the path: …` | 403（scope 不匹配） |
| `:71` | `File does not exist at path: …` | 404（文件真的不在） |

**注意：这三句是 `log::error!`，而我们没有装任何 logger**（`Cargo.toml` 里没有
`tauri-plugin-log`，tauri core 自己也 `set_logger` 过一次都没有），所以**它们现在不会打印到任何地方**。
别指望从 stderr 看到它们——上面那段 `fetch` 拿状态码才是当下唯一可行的判据。
（若将来想要真日志，加 `tauri-plugin-log` 或 `env_logger` 并 `init()`，这是一行的事，但会多一个依赖。）

一条让人安心的基线：**当前数据包的图片是 100% 齐全的**——按 brief 里的 `icon` 字段核对，
1606 个物品的 `icon` 文件全部存在（838 个文件被多个物品共用），101 角色 / 174 光锥各 0 缺图。
所以 T04 看到 `onError` 时，第一反应应该是"我拼错路径了"或"scope 出问题"，而不是"数据缺图"。

---

## 6. 用户数据（收藏 / 笔记 / 偏好）

`%APPDATA%\com.hsr.local.databank\userdata\` 下五个文件，与数据包目录**物理隔离**：
导入 / 回滚 / 删包永不触碰它们（架构文档 §1.2 ④）。

| 文件 | 顶层 | 写入防抖 | 谁写 |
|---|---|---|---|
| `prefs.json` | 对象 | 300ms | `stores/settings.ts`（同时写 localStorage 镜像） |
| `favorites.json` | 对象 `Record<EntityKey, FavoriteEntry>` | 200ms | `stores/favorites.ts` |
| `notes.json` | 对象 `Record<EntityKey, NoteEntry>` | 600ms | `stores/notes.ts` |
| `recent.json` | 数组 | 1000ms | P1，未接线（Rust 侧已就绪） |
| `ratings.json` | 对象 `Record<"currency:{kind}:{id}", { grade?, tier?, remark? }>` | 200ms | `stores/ratings.ts`（货币战争双评级 + 备注，v2.2；v2.1 的裸档位字符串仍可读入） |

### 6.1 分层

```
src/stores/{favorites,notes,settings}.ts   业务动作（toggle / setNote）+ 归一化
   ↓ scheduleWriteUserData(name, value)
src/lib/ipc/userdata.ts                    防抖 + 退出前 flush + invoke
   ↓ userdata_read / userdata_write
src-tauri/src/userdata.rs                  白名单 + 内容校验 + 损坏恢复
   ↓
src-tauri/src/atomic.rs                    tmp → fsync → rename
```

`userdata_read` / `userdata_write` 传送的是**JSON 原文（String）**，不是结构化对象。
用户的字段结构归 TS 管，Rust 只做"带原子性的文本仓库"——这样加字段不需要两侧同步改结构体，
旧版本应用也不会因为"不认识新字段"就把用户数据丢掉。

**关窗时的落盘保证**：`installUserDataFlushHooks`（`src/lib/ipc/userdata.ts`）负责
`pagehide` / `beforeunload` / `visibilitychange` 这些尽力而为的 flush；
真正的**阻塞式冲刷**在 `src/lib/windowBehavior.ts`——拦截关窗 → `preventDefault` →
`flushPrefs()` + `await flushUserData()`（带 2s 兜底超时）→ 再按偏好决定「隐藏到托盘」或「退出」。
这保证「输入后 <600ms 立即关窗」也不丢最后一次输入。浏览器直开 vite（无 Tauri）时该分支跳过。

### 6.1.1 关窗行为与系统托盘

托盘由 `src-tauri/src/tray.rs` 常驻创建，左键唤回主窗口，**右键菜单**给出「显示主窗口 / 关闭」。

| `prefs.closeAction` | 点标题栏关闭按钮 | 托盘「关闭」 |
|---------------------|------------------|--------------|
| `ask`（默认，仅首次） | 弹窗询问并记住选择 | 退出 |
| `tray` | 冲刷数据 → 隐藏窗口 | 退出 |
| `quit` | 冲刷数据 → 退出应用 | 退出 |

首次关窗的询问弹窗是 `src/components/layout/ClosePromptDialog.tsx`，选择写入
`prefs.json` 的 `closeAction`，可在「设置 → 关闭窗口时」改回。

从托盘退出时窗口可能是隐藏的，因此 Rust 不直接 `exit`，而是
`emit("hsr://quit-request")` → 前端冲刷 → 调 `quit_app`；Rust 侧另有 1.5s 看门狗线程，
前端若没响应也一定会退出。隐藏/退出走的是两条自定义命令（`hide_main_window` / `quit_app`），
**不引入** `core:window:allow-hide`、`core:app:allow-exit`，capabilities 仍是最小集。

### 6.2 为什么要写自己的原子写

`tauri-plugin-store` 的 `save()` 是直接 `fs::write`：写到一半被杀 = 文件是半个 JSON。
`atomic.rs` 的做法是 `写 .{name}.tmp → sync_all → rename`（同目录，跨分区 rename 会退化成复制+删除），
进程在任何一步被杀，目标文件**要么是旧内容、要么是新内容**。

### 6.3 损坏恢复

读文件时三态（`atomic::read_json_text`）：

| 状态 | 行为 |
|---|---|
| `Missing` | 返回 `null`，前端用默认值，**不创建文件**（避免首启就落一堆空文件） |
| `Corrupt`（非 UTF-8 / 非法 JSON / 顶层形状不符） | 复制为 `.bak` → 用默认内容重建 → 返回 `null` |
| `Valid` | 原文返回 |

写文件时**先校验再写**：非法 JSON 或顶层形状不对（`prefs/favorites/notes` 必须是对象，
`recent` 必须是数组）一律拒绝（`USERDATA_INVALID_CONTENT`），一个字节都不落盘。
理由：坏内容写进去等于"下次启动丢数据"——读取侧会把它当损坏、备份后重建成空文件。

### 6.4 实测证据（不是"应该没问题"）

| 验证 | 手法 | 结果 |
|---|---|---|
| 收藏后强杀不丢 | 真实 store 动作 → `taskkill //F` → 重启读回 | `favorites.json` 192B 原样存活，含 `character:1001` |
| 笔记 1s 内落盘（PRD P0-16） | 记录 `setNote` 时刻，每 50ms 轮询 `userdata_read` 直到文件里出现内容 | **613ms**（600ms 防抖 + 13ms 写盘）；收藏 200ms 防抖 |
| 损坏不阻断启动 | 手工写坏 `notes.json` 后启动真实应用 | 应用正常启动（`数据包就绪` + `索引就绪` 都在），`notes.json.bak` = 坏文件原文，`notes.json` = `{}` |
| 白名单外名字 | `userdata_read({name: "../active"})` | `USERDATA_INVALID_NAME` |
| 形状不符 | `userdata_write('recent', "{}")` | `USERDATA_INVALID_CONTENT` |

前四条中的第 1、2 条用真实应用验证（临时探针 + 本机 HTTP 上报通道，验完删除），
第 3、4 条既有 selftest 断言，也在真实应用上跑过一次。

### 6.5 双写的边界（`prefs`）

`prefs` 写两处，职责不同，**不要合并**：

- `localStorage`：同步镜像。`main.tsx` 必须在首帧前同步拿到主题/语言，否则会闪白。
- `userdata/prefs.json`：权威副本，可备份、可迁移（PRD §7.3）。

冲突时以 localStorage 为准。只有它**空着**时（新机器、清了站点数据、从别人那拷了 userdata 目录）
才用 `hydratePrefsFromUserdata()` 从 `prefs.json` 水合——这条路径就是"用户数据可迁移"的实现。

---

## 6.6 联网边界（唯一的在线功能：首页公告 / 资讯）

### 边界在哪

| 项 | 结论 |
|---|---|
| 在线内容 | **只有**首页「公告」「资讯」两张卡 |
| 端点 | `https://bbs-api-static.miyoushe.com/painter/wapi/getNewsList?gids=6&page_size=5&type=1\|3&page=1` |
| 请求发起方 | WebView 里的 `fetch`（`src/lib/news/miyoushe.ts`），**不经 Rust 代理** |
| 为什么不走 Rust | 该域返回 `Access-Control-Allow-Origin: *`，WebView 直接请求不受 CORS 限制，无需 `tauri-plugin-http`，也不改 `security.csp`（当前为 `null`） |
| 请求时机 | 进入首页时各拉一次（两类并发，8s 超时）+ 卡片右上角手动刷新 |
| 轮询 | **没有**。挂机不产生请求 |
| 语言门控 | 仅 `prefs.lang === 'zh'` 渲染并发请求；en / ja / ko 下整个区块不存在（米游社只有简中内容） |
| 游戏数据 | 不受影响，仍然全量离线 |

### 降级链路

```
进首页 → readCache() 命中？ → 有：立刻铺上（状态 fallback，底部标「缓存 · 时间」）
                            → 无：骨架屏（状态 loading）
        → 并发拉两类
           → 成功：写缓存 + 状态 ready，底部标「更新于 时间」
           → 失败：已有内容 → 保留并标「缓存 · 时间」
                   无内容   → 状态 error，显示「暂时无法获取」+ 重试按钮
```

缓存键 `hsr.news.cache.v1`（localStorage，跨重启保留）。**故意不写 Rust 侧 userdata**——
它是纯展示缓存，丢了下次进首页重新拉一次就回来了，不值得为它扩 `UserDataName` 枚举并重编后端。

### 外链跳转

点击条目走 `src/lib/openExternal.ts` → Tauri opener（权限 `opener:allow-open-url`）打开系统浏览器。
调用侧有**白名单**：只放行 `https://www.miyoushe.com/sr/` 前缀，其余拒绝——
`openUrl` 本身能开任意协议，不能让数据字段的污染变成任意命令执行面。
非 Tauri 环境（`npm run dev` 浏览器）降级为 `window.open`。

### 端点踩坑记录

- **不是** `post/wapi/getNewsList`——该路径已下线，任何 `gids` 都返回 `404 page not found`，
  但网上大量旧教程仍在用。
- 正确路径是 `painter/wapi/getNewsList`。
- `type`：`1` 公告、`2` 活动征集、`3` 资讯、`4` 空。
- `post_id` 是**字符串**，`created_at` 是**秒级**时间戳（不是毫秒）。
- 原文链接 `https://www.miyoushe.com/sr/article/{post_id}`。

### 回归

`src/lib/news/miyoushe.test.ts`（13 条）覆盖：归一化的整体性错误 vs 单条脏数据跳过、
`limit` 截断、时间倒序、两类 `type` 参数、缓存读写的坏数据与写失败。用例向量按真实返回结构构造
（`post_id` 字符串 / `created_at` 秒），不是随手写的假数据。

---

## 目录结构

```
hsr-local/
├── docs/                   # PRD 与架构文档
├── index.html
├── scripts/
│   ├── build-datapack.mjs       # T02 数据管线
│   ├── build-extra-modules.mjs  # T02b：终局/货币战争/更新日志/原站图标
│   └── with-mingw.mjs           # 注入 cargo + MinGW 的 PATH 再跑 cargo/tauri（见 §3.2）
├── src/                    # React 前端（L4 表现层 + L2/L3 逻辑层）
│   ├── components/         # layout / common / detail
│   ├── hooks/              # useThemeMode / useBoot / useDetail / useListState
│   ├── i18n/               # zh / en / ja / ko 四语言（340 key 逐 key 对齐）
│   ├── lib/data/           # 数据访问层：dal.ts / types.ts / errors.ts / extra.ts（见 §5）
│   ├── lib/text/           # richtext.ts（节点数组）+ macrotext.ts（原始宏字符串），两套不能合并
│   ├── lib/ipc/            # userdata.ts：用户数据 IPC + 防抖（见 §6）
│   ├── lib/userdata/       # 用户数据类型与归一化（EntityKey / FavoriteEntry / NoteEntry）
│   ├── pages/              # 23 个页面：六模块 + 三新栏目 + 搜索/对比/收藏/笔记/设置/首页
│   ├── stores/             # zustand：settings / favorites / notes
│   ├── styles/             # tokens.css 是唯一颜色真源
│   └── theme/              # MUI 主题（全部映射到 CSS 变量）
├── src-tauri/              # L1 壳层（Rust）
│   ├── .cargo/config.toml  # GNU linker + target-dir 锁定 C 盘
│   ├── capabilities/       # 最小权限集
│   ├── windows-app.manifest # per-monitor v2 DPI + Common-Controls
│   ├── src/
│   │   ├── bin/selftest.rs  # 自检入口（cargo run --bin selftest）
│   │   ├── datapack.rs      # 数据访问层：read_json / datapack_index / 索引缓存
│   │   ├── selftest.rs      # 35 条断言 + 1 条真实数据集成检查（36/36）
│   │   ├── userdata.rs     # 用户数据：白名单 / 内容校验 / 损坏恢复
│   │   └── ...              # main / lib / error / paths / atomic / dpi / pack
└── vite.config.ts
```

## 磁盘约束

所有产物必须在 **C 盘**。`src-tauri/.cargo/config.toml` 已把 `target-dir`
显式锁到 `.../hsr-local/src-tauri/target`，请勿改为其他盘符。

## 最终全量验收（代码 / 测试实测）

> 本节记录最终全量验收（#21）的实测数字与口径，供后续排障对照，**不要凭印象改写**。
> 这里验收的是代码与测试；安装包产物与字节级校验见下一节。

| 项 | 命令 / 对象 | 实测结果 |
|---|---|---|
| 类型检查 | `npm run typecheck` | `EXIT 0` |
| 前端构建 | `npm run build` | `EXIT 0`（672 modules / 19.34s） |
| 前端测试（基线，不设环境变量） | `npx vitest run` | `35 passed \| 17 skipped (52)` |
| 前端测试（带真实数据包） | `HSR_SWEEP_PACK=<安装态解包目录> npx vitest run` | `52 passed (52)`、**0 跳过** |
| Rust 自检 | `npm run selftest` | `36/36 passed`、**0 skipped**；真实包冷读 6 索引 `67ms`，索引 JSON 合计 `639.0 KiB` |
| 四语言 i18n | zh / en / ja / ko 逐键比对 | 各 **340** 个叶子键完全对齐 |
| 富文本扫描 `[sweep]` | 原模块全量扫描 | 1145 文件 / 20530 段富文本 / 36827 节点 |
| 数据包 `.hsrpack` | zip 结构 | 75,925,903 B；`manifest.json` 为 **zip 首条目** |

> **vitest 口径（最容易误判的一条）**：两次 `total` 都是 **52**，不是「解锁后用例数变多」。
> 17 个真实数据契约 / 扫描用例在 `describe.skipIf(PACK === undefined)` 下**仍被收集并计入 total**，
> 未设 `HSR_SWEEP_PACK` 时只是从未跑到「通过」；设了之后是把这 17 个 `skipped` 转为 `passed`。
> 正确表述是「设 `HSR_SWEEP_PACK` 时 **52/52 全通过、0 跳过**」，
> **不要写「52 → 更多」或「解锁后用例数增加」**。
>
> 另：§5.5 示例输出与本节同为最终验收批次实测（冷读 6 索引 67ms、索引 JSON 合计 639.0 KiB），两处一致。

## 构建最终安装包

> **安装包已产出**（2026-11-17 15:03，产品名「星穹铁道数据库」，含托盘 / 关窗行为）。本节保留可复现的构建指令与产物校验记录。

```bash
CARGO_INCREMENTAL=0 npm run tauri:build
```

- 该命令 = `node scripts/with-mingw.mjs tauri build`（见 `package.json`），经
  `scripts/with-mingw.mjs` 统一把 `~/.cargo/bin` 与 `MINGW_BIN` 注入 PATH 后再启动 `tauri build`；
  因此不需要手工 `export PATH`（§0 的两行 export 只在**手工跑 cargo** 时需要）。系统 PATH 里没有 cargo，
  **不要裸调 cargo**。
- **同一时刻只允许一个 cargo 进程**：`tauri build` 不转发 cargo 的 `-j` 参数，串行靠
  `CARGO_INCREMENTAL=0` + 只启动一个构建进程来保证；两个 cargo 并发会抢同一把构建锁，
  互相静默排队甚至死锁。仅当怀疑有残留构建进程时才**分别**执行
  `taskkill //F //IM cargo.exe` 与 `taskkill //F //IM rustc.exe`（`/F` 是强杀，不是构建前的常规步骤）。
- **路径口径**：Tauri CLI 不传 `--target` 时按 host 三元组构建，产物落在
  `src-tauri/target/release/`；`src-tauri/target/x86_64-pc-windows-gnu/release/` **并不存在**。
  主二进制实际名为 `hsr-local.exe`，「星穹铁道数据库」只是产品名。
- 数据包 `hsr-local-4.7.51.hsrpack`（**7359 条目 / 78,089,854 B**）通过
  `tauri.conf.json` 的 `bundle.resources` 随安装包嵌入，运行期首启由 `src-tauri/src/pack.rs` 展开。
- **联网时机要分清两段，别混为一谈**：
  ① **安装期（条件触发）**：`webviewInstallMode = downloadBootstrapper` 下，安装包**不内嵌**
  WebView2 引导器 —— `installer.nsi:58-59` 的 `WEBVIEW2BOOTSTRAPPERPATH` /
  `WEBVIEW2INSTALLERPATH` 均为空，`embedBootstrapper` / `offlineInstaller` 两个分支
  （`:617` / `:625`）不生效。仅当安装脚本从注册表查不到 WebView2 Runtime 时，
  `:603` 才用 `NSISdl::download` 从 `go.microsoft.com/fwlink/p/?LinkId=2124703`
  **现场下载**引导器，下载失败即 `Abort`（`:605-609`），成功后 `:636 ExecWait` 静默安装。
  已装 WebView2 的机器（Win11 / 已更新的 Win10）整段跳过，全程不联网。
  ② **运行期（游戏数据读取）**：游戏数据自身零网络请求 —— 全部数据 / 图片来自内嵌 pack，
  源码里不出现 `nanoka.cc` 等原站域名。**运行期联网点：数据包更新检查、应用更新检查、首页公告 / 资讯**
  （`src/lib/news/miyoushe.ts`，请求米游社 `-static` 只读域，CORS 为 `*`，不经 Rust 代理）；
  首页公告/资讯在 en/ja/ko 下不渲染也不发请求；更新检查失败静默，不阻塞首屏。
- **排障**：首次构建若在 `Compiling hsr-local` 收尾阶段报
  `failed to remove ... .rcgu.o: 拒绝访问 (os error 5)`，属 Windows 瞬时文件锁 / AV 实时扫描竞态，
  **不是代码缺陷**——链接其实已完成。原样重试同一命令即可（本项目第 2 次重试 EXIT 0，
  `Finished release profile in 2m 59s` 后出包），不要改配置、不要删文件。

### 已产出产物与校验

| 项 | 值 |
|---|---|
| 安装包 | `src-tauri/target/release/bundle/nsis/星穹铁道数据库_4.8.0_x64-setup.exe` |
| 体积 | **85,423,221 B**（81.47 MiB），2026-11-19 06:31（GitHub Actions / 4.8.0 构建） |
| SHA-256 | `91abe54dc92575ff334c9c9775f34a4e5bc04ca2f7d10de6172996ddc9d816c3` |
| 格式 | 合法 PE（`MZ`），含 `Nullsoft` / `NSIS` 标志 |
| 主程序 | `src-tauri/target/release/hsr-local.exe`，7,100,928 B |
| 内嵌数据包 | 78,089,853 B / **7359** 条目 / `manifest.json` 为 zip 首条目，SHA-256 `44c475dfcca29ef80343e776cee66f63869d4c12831570d5c1d2844ffebe4715` |
| 内嵌证据 | `src-tauri/target/release/nsis/x64/installer.nsi:690` 的 `File /a "/oname=hsr-local-4.7.51.hsrpack"`；暂存副本与根目录 `.hsrpack` SHA-256 完全一致 |
| 构建日志 | 成功日志 61 行，0 条 WARN/ERROR |

> 发布说明（如实记录，未擅自改动配置）：
> ① `bundle.windows.webviewInstallMode = { type: "downloadBootstrapper", silent: true }`
> ——仅当目标机器**没有** WebView2 Runtime 时，首次安装需要联网取运行时；Win11 与已更新的 Win10
> 通常自带。**游戏数据部分完全离线**：所有数据 / 图片来自内嵌的 75.9 MB pack，运行期不访问原站；
> 运行期联网点：数据包更新检查、应用更新检查、首页「公告 / 资讯」；游戏数据本身全部来自内嵌 pack，断网仍可正常浏览。
> ② `installer.nsi:694` 会把 `selftest.exe`（约 558 KB 的独立自检程序）一并打进安装包，
> 因为 Tauri NSIS 默认打包全部 `[[bin]]` 目标。它无害、不影响 App 运行；
> 按用户「先不要删东西」要求**保留**，未删除任何文件。

## 7. 客户端更新（v2.21，应用版本 4.8.0）

从 v2.18 起，数据包可以脱离安装包更新，朋友不需要每次重装整个软件。

### 7.1 固定的更新地址

- manifest（应用检查这个）：
  `https://github.com/AndBaichi/hsr-local/releases/latest/download/update.json`
- 数据包：`update.json` 里的 `url` 字段，指向 `releases/download/datapack-{版本}/hsr-local-{版本}.hsrpack`

仓库已改为 **Public**，上面两个地址都可以匿名访问。

### 7.2 CI 怎么出包

`.github/workflows/datapack.yml`：

- 每天 `03:17 UTC`（北京时间 11:17）跑一次；
- 用 `scripts/detect-upstream-version.mjs` 读 `https://hsr.nanoka.cc/peak` 找版本号；
- 若 `datapack-{版本}` Release 已存在则跳过（手动触发可勾 `force` 强制重建）；
- 否则 `npm run datapack:full`：主构建（不 pack）→ 额外栏目 → `repack`；
- `npm run update:manifest` 生成 `update.json`（字节数 / 条目数 / sha256 / 下载地址 / `minAppVersion`）；
- `gh release create datapack-{版本}` 上传 `.hsrpack` + `update.json`，并标记 latest。

首次构建踩过一个坑：`build-extra-modules.mjs` 在读 `db/zh/currency/role.json` 时，这个文件还在后面的下载任务里，导致 CI 全新环境少 552 个角色详情（6808 而不是 7360 条目）。现在本地没有该文件时直接从源站读一次，已修复并强制重建验证。

### 7.3 客户端怎么更新

- 启动后 **10 秒**静默检查一次，24 小时内不重复；手动检查不受限制；
- 默认**只提示**（顶栏下方横幅 + 设置页「数据包更新」），不自动下载 78 MB；
- 设置里可开「自动下载更新」；开启后检查到新版自动下载，完成后仍提示重启；
- 下载：Rust `reqwest`（`native-tls`，走 Windows 系统证书库）流式写入
  `%APPDATA%\com.hsr.local.databank\update\`，每 1 MB 发一次进度事件；
- 校验：字节数 + sha256，缺一不装；
- 安装：解包到 `packs/.staging-*` → 读 `meta.json`（`schemaVersion` 必须为 1）→
  改名成 `packs/{packId}-{时间戳}` → 备份当前 `active.json` 到 `previous.json` →
  原子写新指针 → 刷新 `PackState` 与索引缓存；
- 失败：删临时文件/staging，**不碰** `active.json`，继续用旧包；
- 生效：`location.reload()`（BootGuard 重新读索引）；设置页 / 横幅都有「重启应用」按钮；
- 回滚：`datapack_rollback` 把 `previous.json` 写回 `active.json`，清缓存后重载；
- 手动导入：设置页选本地 `.hsrpack`，走同一套安装逻辑（`source = manual`）。

### 7.4 几个必须知道的实现细节

- **`active.json` 的 `source`**：`builtin` / `update` / `manual`。
  启动时 `update` / `manual` 的包不会被旧安装包里的内置包覆盖；只有内置数据的
  `gameVersion` **更高**（用户升级了程序）才重新展开内置包。
- **计数校验只对内置包**：`read_meta` 原先用编译期 `EXPECTED_COUNTS`（4.7.51）卡所有包，
  未来 4.7.52 一装就会被判「内容不完整」。现在只在 `extract_builtin_pack` 里校验；
  外部包依赖 manifest 的 sha256 保证完整性。
- **为什么用 native-tls**：本机 hosts 把 GitHub 指到 `127.0.0.1:443`（Steam++ 加速器），
  它用自签 CA 重签证书；`rustls` 自带 webpki 根证书不认，报 `invalid peer certificate:
  UnknownIssuer`。`native-tls` 用 Windows 证书库，和浏览器一致。
- **旧包清理**：每次更新会产生一份约 160 MB 的完整目录；启动时只保留
  `active` / `previous` / 内置包三份，其余 `packs/hsr-*` 与 `packs/.staging-*` 删除；
  `update/` 下的残留临时文件也一并清掉。
- **错误 sha256**：会返回 `数据包 sha256 校验失败`，临时文件删除，`active.json` 保持不变。

### 7.5 验证记录（2026-11-18）

- 真实 `update.json`：检查成功，当前 4.7.51 → 「已是最新版本」；
- 258 B 测试包：完整 URL 下载 + sha256 + 安装 + 回滚，3 秒；
- 78 MB 本地完整包：手动导入 14 秒；重启进程后仍指向外部目录，角色页 101 条正常；
- UI「回滚上一版」→ active 恢复内置包 → 「重启应用」→ 角色页正常；
- 错误 sha256：拒绝且 active 不变；
- 启动清理：2 个孤儿目录（测试包 + 旧完整包）被删除，只留内置包。
- 回归：typecheck 0 错、vitest **115 passed**。
- 当前安装包：`星穹铁道数据库_4.8.0_x64-setup.exe`，85,423,221 B（81.47 MiB），
  SHA-256 `91abe54dc92575ff334c9c9775f34a4e5bc04ca2f7d10de6172996ddc9d816c3`
  （2026-11-19 05:48 构建，含本节的客户端更新）。

### 7.6 主角光环卡片内容补全（v2.19）

- 源站宏文本里的 `<gridfightinfo type=item id=…>` 是自闭合标签，自身没有正文；
  MacroText 的未知标签策略只去标签、保留正文，卡片上会留下 `可通过【】获取【虚弱】`。
  现在 `src/lib/text/gridfight.ts` 按 type/id 把物品名解析回来，卡片与详情都生效。
- `<variable>` 是战斗内数值，原站显示「战斗中决定」；此前用 `param_list` 算成
  「当前提高：1%」，现在统一显示占位文案。
- 用无头 Edge 逐个比对源站 82 张卡与本地 82 张卡的文本，除源站重复推荐角色去重外无缺失。
### 7.7 角色名里的宏标签清理（v2.20）

- 源站有个别角色名带样式标签，例如 `银狼LV.<unbreak>999</unbreak>`；
  `RoleCard` 之前按纯文本渲染，会把 `<unbreak>` 原样显示出来。
- 现在 `currencyDisplayName` 统一用 `macroTextToPlain` 压平（保留正文、去掉标签），
  卡片、详情、搜索、右键快照、对比页共用同一入口。
- 实测角色图鉴 4 张「银狼LV.999」卡显示正常，页面内 `<unbreak>` 计数 0。
### 7.8 应用本体更新（Tauri Updater，v2.21）

- 应用版本已与数据版本解耦：程序 **4.8.0**，数据包仍 4.7.51。
- 端点固定为 `https://github.com/AndBaichi/hsr-local/releases/download/app-latest/latest.json`；
  `app-latest` 是 **prerelease**，不会抢数据包使用的 `releases/latest`。
- 安装包由 Tauri 生成 minisign 签名（`*.exe.sig`），`latest.json` 里带签名；
  客户端校签通过后才安装。
- 设置页「应用更新」可手动检查 / 下载安装 / 重启；启动 10 秒后也会静默检查一次（24h 节流）。
- 签名私钥在 `~/.tauri/hsr-local.key`，**绝不入库**；CI 需要仓库 Secrets：
  `TAURI_SIGNING_PRIVATE_KEY`（私钥全文）与 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`（无密码留空）。
- `release.yml` 在 Windows runner 上构建数据包 → 签名安装包 → 发布 `v{version}` 与
  `app-latest/latest.json`；`TAURI_SIGNING_PRIVATE_KEY` 缺失时构建会明确失败，不会产出未签名包。

### 7.9 许可证与数据版权

- 代码与文档：**MIT**，见 `LICENSE`。
- 游戏数据/图片：版权归 miHoYo / HoYoverse，数据整理自 nanoka.cc，**不在 MIT 范围**；
  仅限个人离线查阅，不得商业使用或再分发素材，详见 `NOTICE.md`。
- 鼠标指针主题：版权归原指针作者，仓库只做本地主题展示。

### 7.10 版本与分支

- 应用版本：`4.8.0`（`package.json` / `tauri.conf.json` / `Cargo.toml` 同步）。
- 数据版本：`4.7.51`（由 `scripts/lib/consts.mjs` 的 `HSR_VERSION` 控制，CI 自动探测）。
- 数据包更新不会改应用版本；程序更新走 Tauri Updater，两者互不覆盖。