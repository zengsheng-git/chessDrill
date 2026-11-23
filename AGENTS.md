# AGENTS.md

## 提交规则

- **未经用户明确允许，不得执行 `git commit` 或 `git push`**。
- 修改完成后，先说明改动内容和预览，等用户确认后再提交。

## 工程约定

- `src-tauri/resources/tiku/` 为内置题库目录（一行一个 FEN 的 txt，格式见 chessPractice 的题库说明），请勿改名。
- `src-tauri/resources/libs/pikafish/` 为 Pikafish 引擎与 NNUE 权重，Rust 端按资源目录解析，移动文件需同步修改。
- 前端与 Rust 交互统一走 `src/lib/ipc.ts` 封装的 invoke 命令。
- 棋规与走子推演在前端 TS（`src/lib/board/`、`src/lib/move.ts`），Rust 端只做引擎搜索与题库读取。
