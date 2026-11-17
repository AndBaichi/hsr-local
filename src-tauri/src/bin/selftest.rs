//! 自检入口：`cargo run --bin selftest`
//!
//! 退出码语义与 CTest / CI 一致：`0` = 全绿，`1` = 有失败。
//! 不要加 `--release`：release profile 里 `panic = "abort"`，
//! `catch_unwind` 会失效，第一个失败就会直接终止进程（其余断言看不到）。
//!
//! 断言本体在 `hsr_local_lib::selftest`，这里只负责跑和报退出码。

// 与 `main.rs` 同一原因：GNU 工具链会把 MinGW 的 `default-manifest.o` 一起链进来，
// 于是每个 exe 都有一份结构性的 `.rsrc merge failure` 警告。这不是本 crate 能修的问题，
// 详见 `dpi.rs` 模块文档与 README「已知限制」。库（lib.rs）里不加这条 allow。
#![allow(linker_messages)]

fn main() {
    let report = hsr_local_lib::selftest::run_all();

    println!();
    if report.is_ok() {
        if report.skipped > 0 {
            println!(
                "selftest: {}/{} passed, {} skipped",
                report.passed,
                report.total(),
                report.skipped
            );
        } else {
            println!("selftest: {}/{} passed", report.passed, report.total());
        }
        return;
    }

    println!(
        "selftest: {}/{} passed, {} FAILED, {} skipped",
        report.passed,
        report.total(),
        report.failed,
        report.skipped
    );
    for (name, message) in &report.failures {
        println!("  - {name}: {message}");
    }
    std::process::exit(1);
}
