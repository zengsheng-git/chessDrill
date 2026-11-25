# 棋谱 / 残局练习转视频 — 实现方案

> 状态：**已实现**（一次性完成全部范围；本文档保留为设计记录）
> 需求：竖版 1080×1920 MP4；支持用户自定义输入文字合成配音；入口覆盖「复盘棋谱」与「残局练习」

---

## 1. 结论先行

- **可行**。复用 sibling 项目 residual-deduction 已验证的「Rust 软渲染 + ffmpeg stdin 管道」模式，移植其 `video.rs` / `tts.rs`，新写一个象棋棋盘渲染器。
- **自定义文字配音完全可行**。TTS 用 Edge TTS（微软朗读接口，免费、无需 API key，需联网），`synthesize(text, voice, rate)` 接受任意文字，与棋局数据完全解耦。用户逐手编辑或整段输入均可。
- chessDrill 现有「录制」功能与视频无关（那是截屏识别录谱），本方案为纯新增能力。

## 2. 总体架构与数据流

```
前端（数据源 + 参数 + 解说词编辑 + 进度UI）
  │  invoke("generate_video", { params })
  ▼
Rust 后台线程（单任务槽 + AtomicBool 取消）
  ├─ 解析 FEN → 构造场景序列（Intro / Move×N / Outro）
  ├─ 逐场景：TTS 合成 mp3 → ffmpeg 转 wav → wav 时长定场景时长
  ├─ 帧迭代器 render_frame(scene, t)：1080×1920 RGBA → RGB24 裸流
  ├─ 帧流 + wav 同写 ffmpeg stdin → 分段 mp4
  ├─ concat -c copy 拼接 → 抽封面
  └─ emit gen://progress / gen://done / gen://error
  ▼
前端：进度条 → <video> 预览（convertFileSrc）→ 打开文件夹 / 另存为
```

**职责划分遵循工程约定**：棋规与走子推演仍全部在前端 TS（`applyMove` 产出的 `record` 已含 `fenBefore/fenAfter/iccs/notation/captured/check`，直接序列化传给 Rust）；Rust 端只做 FEN→棋子坐标解析（约 20 行，非棋规）、渲染与合成。

## 3. Rust 端设计

### 3.1 新增模块 `src-tauri/src/video/`

| 文件 | 职责 | 来源 |
|---|---|---|
| `render.rs` | 竖版棋盘软渲染器：Layout、FEN 解析、棋盘线格绘制、棋子圆+字、滑动插值、字幕 | **新写**（翻译 `Board.tsx` SVG 逻辑） |
| `ffmpeg.rs` | ffmpeg 进程封装：spawn/stdin 管道编码、mp3→wav、wav 时长解析、concat、抽帧、时长探测 | **移植** residual `video.rs`（~250 行，几乎原样） |
| `tts.rs` | Edge TTS：WebSocket 直连、Sec-MS-GEC 令牌、SSML、分段重试、跳段降级 | **移植** residual `tts.rs`（~460 行，几乎原样） |
| `generator.rs` | 生成调度：场景构建、逐场景 TTS+渲染+编码、进度事件、取消检查 | **新写**（比 residual 简单：无引擎推演、无剧本分支） |
| `mod.rs` | 参数结构体、命令 `generate_video` / `stop_video_generation` | 新写 |

### 3.2 渲染器要点（render.rs）

> 修订：初版沿用了 residual-deduction 的深色布局与精灵图棋子，与本项目浅色米黄主题割裂且版式空旷；
> 现已完全重写为**本项目 Board.tsx 的 1:1 视觉翻译**，并重新设计了版式。

- **画幅**：1080×1920 @ 30fps，`FPS=30`。
- **视觉规格（对齐 Board.tsx / index.css）**：
  - 画布底 `#f5f0e2`（--c-ink-950，与应用 body 一致）
  - 渐变木底板 `#f0d8a8→#e6c68c→#dcb877` + `#8a5a20` 外框 + `#7a5426` 格线/九宫/角标
  - 楷体（`--font-piece` → simkai.ttf，内置 qiti.ttf 兜底）：标题、楚河汉界、棋子字、记谱大字
  - 棋子：径向渐变面 `#faf0d8/#f1e2bd/#e2cb98` + 红黑描边/内环 + 柔投影，预烘焙 14 个精灵（底图缓存 + 精灵 overlay 保证 30fps 软渲染性能）
  - 走子标记与前端同款：起点绿色四角括号 `#2e9e5b` + 落点绿圆环；将军红圈 `#dc2626`
  - 字幕条：深色圆角（ink-200）+ 米白字（正文用微软雅黑，即 body 字体）
- **竖版布局**：标题/副标题（顶部）→ 大棋盘 CELL=108 水平绝对居中 → 当前行棋大字 → 字幕条；底部约 300px 留抖音安全区。
- **动画**：走子 ease-out 滑动插值 0.45s；起点括号动画期常显。

### 3.3 场景时间轴

| 场景 | 内容 | 时长 |
|---|---|---|
| Intro | 标题卡 + 初始局面 | 2.5s（有开场配音时 = 配音时长 + 留白） |
| Move × N | 滑动动画 + 字幕 + 配音 | 0.45s 动画 + max(0.9s, 配音时长 + 0.35s) |
| Outro | 结尾卡（"完"） | 2.5s |

每场景独立编码 `scene_NN.mp4`，最后 concat `-c copy` 拼接（中途失败/取消不浪费已产出片段）。音频作为第二 `-i` 输入 `-shortest` 对齐，音画天然同步。

**核心 ffmpeg 参数**（与 residual 一致）：
```
-y -f rawvideo -pix_fmt rgb24 -s 1080x1920 -r 30 -i - -i scene.wav
-af apad -c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p -c:a aac -b:a 128k -shortest
```

### 3.4 TTS 与自定义配音（回答用户问题）

- 引擎：Edge TTS，`tts::synthesize(text, voice, rate) -> mp3 bytes`，任意 UTF-8 文本，长文自动按句切分（90 字/段）。
- **配音模式三种**：
  1. **无配音**：纯字幕，场景按时长估算；
  2. **自动解说**（默认）：按中文记谱模板生成「红方 炮二平五」「黑方 马8进7」「将军！」等；
  3. **自定义编辑**：对话框内逐手表格（手数 / 记谱 / 解说词输入框），每行可改可清空（清空=该手不配音）；另有「开场白」「结束语」两个独立文本框可整段输入。
- 音色预设 4 个（沿用 residual）：`zh-CN-YunxiNeural`（男·云希）、`zh-CN-XiaoxiaoNeural`（女·晓晓）、`zh-CN-YunjianNeural`（男·云健）、`zh-CN-XiaoyiNeural`（女·晓伊）；语速 -50%~+100%。
- **降级链**：单段重试 3 次 → 单句失败跳过 → 整体失败写静音 wav（视频照出，仅无声）。

### 3.5 命令与事件

- `generate_video(params)`：单任务槽（重复调用拒绝），后台线程 + `catch_unwind` 兜底发 error 事件。
- `stop_video_generation()`：`AtomicBool`，在场景边界检查。
- 事件：`gen://progress {phase, index, total, percent}`、`gen://done {dir, videoPath, coverPath}`、`gen://error {message}`。
- 输出目录：`app_data_dir/videos/<yyyyMMdd-HHmmss>/`，含 `video.mp4`、`cover.jpg`（末局局面抽帧）、`narration.json`（解说词存档）。中间 wav/mp4 清理。
- 复用现有 `reveal_in_explorer` 做打开文件夹；「另存为」用已有 `tauri-plugin-dialog`。

## 4. 前端设计

### 4.1 新增文件

| 文件 | 职责 |
|---|---|
| `src/lib/video/types.ts` | `GenerateVideoParams`、`VideoMoveStep`、事件类型 |
| `src/lib/video/api.ts` | `generateVideo()` / `stopGeneration()` invoke 封装 + `gen://*` 事件监听 |
| `src/components/video/VideoExportDialog.tsx` | 导出对话框：参数区（标题/副标题/音色/语速/配音模式）+ 解说词逐手编辑表格 + 开场白/结束语文本框 + 进度条 + 完成预览 |

### 4.2 入口（修改）

- **复盘页** `ReviewPage.tsx`：工具栏加「导出视频」——取 MoveTree 主线走子序列（每手 record 已含所需字段）。
- **练习页** `DrillPanel.tsx`：答案演示区加「导出视频」——用 `solve_line(fen)` 结果在前端 `applyMove` 推演为 record 序列（复用 `revealFrames` 现有推演逻辑）。

### 4.3 参数序列化类型

```ts
interface VideoMoveStep {
  fenBefore: string; fenAfter: string;
  from: string; to: string;          // ICCS，如 "h2-e2"
  notation: string;                   // "炮二平五"
  capturedPiece?: string;
  check: boolean;
  side: "red" | "black";
}
interface GenerateVideoParams {
  title: string; subtitle?: string;
  moves: VideoMoveStep[];
  narration: string[];                // 与 moves 等长，空串=该手不配音
  introNarration?: string; outroNarration?: string;
  voiceEnabled: boolean; voice: string; rate: number;
}
```

## 5. 依赖与资源变更清单

| 变更 | 内容 |
|---|---|
| `src-tauri/Cargo.toml` 新增 | `imageproc = "0.25"`、`ab_glyph = "0.2"`、`sha2 = "0.10"`、`base64 = "0.22"`、`tungstenite = { version = "0.26", features = ["rustls-tls-webpki-roots"] }`、`rustls = { version = "0.23", default-features = false, features = ["ring", "std", "tls12"] }` |
| `tauri` features | 加 `"protocol-asset"`（前端 `<video>` 预览用 convertFileSrc） |
| `lib.rs` | 注册 2 个新命令；启动时解析 `resources/libs/ffmpeg/ffmpeg.exe`（不存在仅禁用视频入口并提示，不阻断启动） |
| 资源 | 拷贝 residual-deduction 的 `libs/ffmpeg/ffmpeg.exe` → `src-tauri/resources/libs/ffmpeg/`。`tauri.conf.json` 的 `resources` 已含 `resources/libs`，**无需改 conf** |
| `package.json` | 无新增依赖 |

## 6. 实施阶段

1. **阶段一（跑通闭环）**：移植 `ffmpeg.rs` + 新写 `render.rs`（无配音版）+ `generator.rs` + 命令注册；复盘页入口。验收：任意 PGN → 出竖版 MP4，带记谱字幕与滑动动画。
2. **阶段二（配音）**：移植 `tts.rs`；对话框配音模式与逐手解说词编辑；TTS 失败降级验证。
3. **阶段三（练习入口与打磨）**：DrillPanel 入口（solve_line 推演）；封面、进度、取消、另存为；生成性能调优（如必要降 preset）。

## 7. 风险与对策

| 风险 | 对策 |
|---|---|
| Edge TTS 需联网、接口有限频/瞬断 | 已有重试+跳段+静音降级；设置里加「生成前检测」提示。离线需求二期换 Windows SAPI 或本地模型 |
| ffmpeg.exe 增大安装包（静态版约 80–130MB） | 明确告知；也可改用系统 PATH 中的 ffmpeg（检测不到再回退自带） |
| 软渲染性能：4500 帧/百手视频 | 单帧 RGBA 绘制约 5–15ms，全片约 2–4 分钟生成，可接受；必要时 `-preset fast` |
| 系统缺中文字体 | 明确报错提示；后续可内置开源字体子集 |
| 与 residual-deduction 代码漂移 | ffmpeg.rs/tts.rs 移植时保持文件头注释标注来源，便于同步修复 |

## 8. 待确认项

1. ~~配音默认模式~~ 已实现：默认自动解说，可切自定义/关闭
2. 是否需要 BGM？（本期未规划，架构已预留：concat 后 `-c:v copy` 混音一步即可）
3. 结尾卡样式：简单「完」字卡，还是带「关注」引导文案（可自定义输入）？

## 9. 追加：视频工坊模块（已实现）

- 参照 residual-deduction 的视频库模式：每个产物目录写 `meta.json` 索引，`list_videos` 扫描按时间倒序，`delete_video` 移入系统回收站（chessDrill 风格，误删可恢复）。
- 首页新增第三个模块卡片「视频工坊」（`VideoPage`）：封面列表、播放浮层（视频/打开文件夹/另存为/删除）、生成完成自动刷新、空态引导。
- 生成完成即入库，导出对话框与视频库共用产物目录（`app_data_dir/videos/`）。

## 10. 追加：逐手棋盘标注（已实现）

- **类型**：圈注（套棋子高亮圆环）+ 箭头（杆+三角头，公式同 Board.tsx 提示箭头）；颜色红 `#dc2626`（威胁/关键）/ 绿 `#2e9e5b`（路线/说明）可切。
- **编辑**：导出对话框顶部常驻「📌 棋盘标注」入口 + 逐手表格行 📌 按钮 → `AnnotationEditor` 浮层：mini 棋盘（复用 Board 组件，显示该手 fenAfter）点选，点 1 下加圈注、箭头模式点 2 下；列表可删、可清空。标注入口独立于配音模式。
- **渲染**：走子滑动动画结束后显示，画在棋子上层；数据随 `VideoMoveStep.annotations` 传入，非法标注（箭头缺终点/坐标越界）静默跳过。
