#!/usr/bin/env node
/**
 * 用带 MinGW 的 PATH 跑一条命令。
 *
 * ## 为什么需要这个包装器
 *
 * 本项目的工具链是 `x86_64-pc-windows-gnu`（无 MSVC）。`src-tauri/.cargo/config.toml`
 * 已经钉死了 `linker` / `ar` 的绝对路径，也用 `rustflags = ["-Cdlltool=…"]` 解决了
 * `dlltool` 的查找问题，但还有两个工具是**只按名字从 PATH 找的**，配置文件管不到：
 *
 *   - `windres`：`embed-resource` 里硬编码 `Compiler::windres("windres")`，
 *     `tauri-winres` 的 `set_windres_path()` 是个空壳（参数名 `_path`，什么都不做）。
 *     缺了它 `cargo build --release` 在编译本 crate 的 build script 时直接 panic：
 *       panicked at tauri-winres-0.3.7/src/lib.rs:543
 *       called `Result::unwrap()` on an `Err` value: NotAttempted("windres")
 *   - `dlltool`：rustflags 已经覆盖，但保留在 PATH 里更保险（其它工具链组件也会用到）。
 *
 * ## 为什么不用 `.cargo/config.toml` 的 `[env] PATH = { prepend = true }`
 *
 * 实测本机 cargo **静默忽略** `prepend`：build.rs 里读到的 PATH 完全没变
 * （见 `src-tauri/.cargo/config.toml` 里的注释）。也没有 `force` 能只前置不覆盖，
 * 覆盖整个 PATH 又会丢掉 node / git / 系统 DLL 目录。
 *
 * 所以退一步：让 npm 脚本自己带上 PATH。`MINGW_BIN` 从 `.cargo/config.toml` 读，
 * **只有一处真源**，换机器只改那一个值。
 *
 * 用法：
 *   node scripts/with-mingw.mjs tauri build
 *   node scripts/with-mingw.mjs cargo run --bin selftest
 */

import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = resolve(HERE, "../src-tauri/.cargo/config.toml");

/**
 * 从 `.cargo/config.toml` 里读 `MINGW_BIN`。
 *
 * 只做一行正则提取，不引入 TOML 解析依赖 —— 这个脚本要在 `npm install` 之后、
 * 甚至在依赖不全的情况下都能跑起来。
 *
 * @returns {string | null} MinGW 的 bin 目录，读不到时返回 null
 */
function readMingwBin() {
  if (!existsSync(CONFIG_PATH)) {
    return null;
  }
  const text = readFileSync(CONFIG_PATH, "utf8");
  const match = text.match(/^\s*MINGW_BIN\s*=\s*"([^"]+)"/m);
  return match ? match[1] : null;
}

/**
 * 把目录前置到 PATH，保留原有内容，并去重。
 *
 * @param {string} prefix 要前置的目录
 * @param {string} [base] 基准 PATH；不传则用进程原始 PATH。
 *   调用方注入多个目录时**必须传上一次的结果**，否则第二次会覆盖第一次。
 * @returns {string} 新的 PATH
 */
function prependPath(prefix, base) {
  const current = base ?? process.env.PATH ?? "";
  const parts = [prefix, ...current.split(";").filter(Boolean)];
  const seen = new Set();
  const deduped = [];
  for (const part of parts) {
    const key = part.toLowerCase().replace(/[\\/]+$/, "");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(part);
  }
  return deduped.join(";");
}

const mingwBin = readMingwBin();
const env = { ...process.env };

// cargo / rustup 装在 ~/.cargo/bin，但系统 PATH 里没有它。
// 只注入 MINGW_BIN 时 `npm run selftest` 会报
// "'cargo' 不是内部或外部命令" —— 实测过，包装器必须连 cargo 一起补。
// 非 Windows 下 rustup 一般已在 PATH，existsSync 会自然跳过。
const cargoBin = join(process.env.CARGO_HOME ?? join(homedir(), ".cargo"), "bin");
if (existsSync(cargoBin)) {
  env.PATH = prependPath(cargoBin, env.PATH);
}

if (mingwBin) {
  // 传 env.PATH（已含 cargo），不要再用 process.env.PATH 覆盖掉前面的注入
  env.PATH = prependPath(mingwBin, env.PATH);
  // 顺带把 MINGW_BIN 也暴露出去：tauri-build 编译 .rc 时会用它拼 windres 路径。
  env.MINGW_BIN = mingwBin;
} else {
  console.warn(
    `[with-mingw] 没能从 ${CONFIG_PATH} 读到 MINGW_BIN，将直接使用当前 PATH。` +
      "如果接下来报 windres / dlltool 找不到，就是这个原因。",
  );
}

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error("用法: node scripts/with-mingw.mjs <命令> [参数...]");
  process.exit(2);
}

const child = spawn(command, args, {
  stdio: "inherit",
  env,
  // Windows 下 `tauri` / `cargo` 是 .cmd / .exe，需要 shell 才能解析到 PATHEXT
  shell: process.platform === "win32",
});

child.on("error", (error) => {
  console.error(`[with-mingw] 启动失败: ${error.message}`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`[with-mingw] 子进程被信号终止: ${signal}`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});
