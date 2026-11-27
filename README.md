# 象棋研习（chessDrill）

桌面端中国象棋**研习**应用：刷题练杀 · 复盘研棋 · 视频解说。三大模块——**杀招残局练习**（以 Pikafish 皮卡鱼引擎为对手）、**棋谱复盘**（棋谱库 / 复盘台 / 录制对局 / 软件检测）、**视频工坊**（局面一键转竖版解说视频）。主打"上班摸鱼"场景的竖屏窄窗布局。

> 平台：Windows · 架构：Tauri 2 + React 19 · 引擎：Pikafish（GPL-3.0，独立进程）

## 功能特性

### 杀招残局练习
- 15 个内置题库（杀着大全、连将杀、古谱适情雅趣、实用残局、分级练习等，上千道题）
- 顺序练习 / 随机练习，题库进度条与正确率实时展示
- 点击选子（高亮合法落点）→ 走子 → 引擎应手 → 将杀/困毙/回合数判定
- 执红将杀过关；`2#` 执黑题守和 60 回合过关
- **看答案**：引擎求解完整杀法线，逐手动画演示
- **阶梯提示**：绿色箭头直指引擎建议着法（同局面缓存，不重复计算）
- 悔棋（连引擎一手一起悔）/ 重做 / 上一题 / 下一题，答对可自动跳下一题

### 测试
- 从任一题库随机抽 10 题模拟考
- 无提示、无悔棋，做完出分（正确数 / 正确率 / 用时）
- 成绩历史保留最近 100 次

### 错题本
- 答错自动收录、答对一次自动移出
- 按题库分组重刷，支持移出单题 / 清空整库

### 统计
- 累计练习数、总正确率、错题待重刷数、测试次数
- 各题库进度与练习正确率明细

### 棋谱复盘
- **棋谱库**：内置棋谱 + 自定义目录扫描，支持 PGN / XQF（象棋桥）格式
- **复盘台**：滚轮 / 按钮 / 键盘前后翻看；变招以绿色箭头 + 编号标注，点编号选着；分歧一键跳转；着法树与对局信息；翻转棋盘；PGN 另存
- **天天象棋导入**：粘贴分享链接直接还原成棋谱
- **录制对局**：选定对方棋软窗口，屏幕截图 + YOLO 棋子识别自动记录着法，可导出 PGN 或直接导入复盘台
- **软件检测**：Pikafish 逐手对照分析，评估对局着法是否软件生成（仅供参考）
- **视频导出**：把当前棋谱主线（含勾选的变招）导出为竖版解说视频

### 视频工坊
- 竖版 1080×1920 解说视频：棋盘渲染 + 走子动画 + 分段字幕 + Edge TTS 配音（多音色 / 语速可调，在线合成，单段失败自动静音不影响出片）
- 三种数据源：
  - 复盘棋谱 → 主线解说（分叉点变招可勾选进视频）
  - 残局题目 → 引擎求解参考杀法线
  - **截图识别** → 粘贴 / 拖拽 / 上传任意棋局截图，YOLO 两遍识别局面（棋盘定位、红下校正、合法性校验），确认行棋方后由引擎求解
- 变招演示：分叉点预览卡（主线绿箭头 / 变招红箭头对比）先讲清分歧，主线讲完后片尾逐个回看变招，每个变招演示前回到预览画面；预览与回看预览解说词可自定义（默认词只列已勾选变招）
- 逐手棋盘标注（圈注 / 箭头，红 / 绿双色）+ 逐手解说词自定义；标注编辑器显示当前招法与走子标记
- 视频库：播放 / 另存为 / 删除（移入回收站）/ 打开目录，生成进度实时展示

### 设置
- 音效开关（走子 / 吃子 / 将军 / 胜负，WebAudio 程序合成，无素材文件）
- 答对自动下一题
- **界面缩放**：Ctrl + 滚轮随时缩放（70%~150%），摸鱼时调小更隐蔽

## 界面设计

- 手机竖屏比例（默认 440×800，最小可缩至 340×560），窗口任意拉伸内容自适应居中
- 首页三张模块卡：杀招残局练习 / 棋谱复盘 / 视频工坊
- 走子标记采用主流棋类 App 风格：起点四角括号 + 落子绿色细圆环，无箭头遮挡
- 结算浮层可关闭（× 或点击遮罩），关闭后可查看棋盘终局，底部保留"看答案"入口

## 技术栈

| 层 | 技术 |
|---|---|
| 桌面壳 | Tauri 2（WebView2） |
| 前端 | React 19 + TypeScript + Zustand 5 + Tailwind CSS 4 + Vite 8 |
| 棋规 | 纯 TS 自研（`src/lib/board/`）：伪合法走法、将军检测（含白脸将）、合法走法过滤、将杀/困毙判定、中文纵线记法 |
| 引擎 | Pikafish UCI 独立子进程（`src-tauri/src/engine.rs`），杀法线求解走 `position fen ... moves ...` 推进，Rust 端零棋规代码 |
| 屏幕识别 | YOLOv8 + ONNX Runtime（`ort` load-dynamic，`resources/libs/large.onnx` 运行时加载，15 类棋子/棋盘标签） |
| 棋谱解析 | PGN / XQF 解析器（`src/lib/pgn/`、`src/lib/xqf/`） |
| 视频合成 | 棋盘软渲染（imageproc / ab_glyph）逐帧喂 ffmpeg 管道编码 + Edge TTS（WebSocket 在线合成） |
| 截图 | xcap 窗口 / 屏幕捕获 |
| 音效 | WebAudio 程序合成 |

### 引擎配置

- 对手应手：26 层深搜（上限 2.5s），线程自动取 CPU 全核，Hash 512MB
- 答案线求解：28 层深搜（上限 4s）

## 快速开始

环境要求：Windows 10+、Node.js ≥ 20、Rust stable（MSVC 工具链）。

```bash
npm install
npm run tauri dev    # 开发运行
npm run tauri build  # 打包安装程序（MSI/NSIS）
```

引擎、NNUE 权重、YOLO 模型（`large.onnx`）、onnxruntime、ffmpeg 均已随 `src-tauri/resources/libs/` 分发，克隆即用，无需额外下载。

## 题库格式

题库为 UTF-8 txt，**每行一个题目**，兼容「一二残局」题库格式（`2#` 执黑翻转、行尾中文标题）。支持四种写法：

```text
FEN                    # 1. 执红：玩家执红将杀引擎
2#FEN                  # 2. 执黑：玩家执黑，守和 60 回合过关
FEN 中文标题            # 3. 执红带标题
2#FEN 中文标题          # 4. 执黑带标题
```

- 空行与 `#` / `//` 开头的注释行会被忽略
- 自定义题库：把 txt 放入 `src-tauri/resources/tiku/`（或打包后的资源目录）即可被扫描加载

内置题库来自「一二残局」开源项目（GPL-3.0），含：象棋杀着大全、竹子涨棋、连将杀一至四步/五至七步杀、古谱（适情雅趣、梦入神机、烂柯神机）、屠景明/陈松顺实用残局、夏老大分级练习等 15 库。

## 目录结构

```
src/                        # React 前端
├── lib/
│   ├── board/              # 棋规：types/fen/rules(走法·将军·终局)/notation
│   ├── pgn/ xqf/           # PGN / XQF 棋谱解析
│   ├── record/             # 录制走子流 → 棋谱还原
│   ├── video/              # 视频导出：api / types / build(数据源构造)
│   ├── tiku.ts             # 题库行解析（四种写法）
│   ├── move.ts             # 走子推演与着法记录
│   ├── ipc.ts              # Tauri 命令封装
│   └── audio.ts            # WebAudio 合成音效
├── stores/                 # Zustand：quiz/progress/library/settings/recorder 等
└── components/
    ├── board/              # 棋盘（走子标记 / 预览标注渲染）
    ├── drill/              # 练习模块（practice/test/wrong/stats/settings）
    ├── review/             # 复盘台 / 录制面板 / 天天导入 / 软件检测
    ├── video/              # 导出对话框 / 变招勾选 / 标注编辑 / 截图识别 / 视频库
    └── common/             # 通用小组件
src-tauri/
├── src/
│   ├── engine.rs           # Pikafish UCI 封装：单步搜索 + 完整杀法线求解
│   ├── capture.rs          # 窗口枚举与截图
│   ├── yolo.rs             # YOLOv8 ONNX 推理（运行时加载模型）
│   ├── detect.rs           # 检测框 → 盘面 / FEN / 合法性校验
│   ├── recorder.rs         # 录制状态机：轮询截图 → 识别 → 走子事件
│   ├── recognize.rs        # 单张截图识别局面（两遍推理）
│   ├── tiantian.rs         # 天天象棋分享链接拉谱
│   ├── analysis.rs         # 逐手对照分析（软件检测）
│   ├── video/              # 视频生成：场景构建 / 渲染 / TTS / ffmpeg / 视频库
│   ├── tiku.rs             # 题库扫描与解析（Rust 侧）
│   └── lib.rs              # 命令装配
├── capabilities/           # Tauri 权限
├── icons/                  # 应用图标
└── resources/
    ├── tiku/               # 内置题库（15 个 txt）
    ├── games/              # 内置棋谱库
    └── libs/               # pikafish(引擎+NNUE) / large.onnx + onnxruntime.dll / ffmpeg.exe
```

## 前后端交互

| 命令 | 说明 |
|---|---|
| `list_tiku` / `read_tiku(name)` | 内置题库列表 / 读取题目 |
| `engine_move(fen)` | 引擎在指定局面走一步（对手应手） |
| `solve_line(fen)` | 求解完整参考杀法线（双方均按引擎最强应对，直到终局） |
| `library_dir` / `scan_dir` / `read_file_bytes` / `save_pgn` 等 | 棋谱库文件管理与 PGN 另存 |
| `start_recording` / `stop_recording` | 录制对局（识别结果经 `recorder://*` 事件推送） |
| `fetch_tiantian_qipu(link)` | 天天象棋分享链接换棋谱 |
| `analyze_game` / `stop_analysis` | 逐手对照分析（软件检测） |
| `recognize_image(bytes)` | 截图识别局面（FEN + 预览图） |
| `generate_video` / `stop_video_generation` | 视频生成（进度经 `video://progress` / `done` / `error` 事件推送） |
| `list_videos` / `delete_video` / `reveal_video` / `save_video_as` | 视频库管理 |

练习进度、错题本、测试成绩持久化于应用本地存储（localStorage）；视频产物存于应用数据目录 `videos/`。

## 引擎与开源声明

- 内置 [Pikafish（皮卡鱼）](https://github.com/official-pikafish/Pikafish) 引擎以 **GPL-3.0** 协议独立进程运行，经 UCI 协议与本应用进程边界通信；本应用不含其源码与派生作品。
- 题库内容来自开源项目「一二残局」（GPL-3.0），格式规范详见其项目说明。
- 本项目遵循 GPL-3.0 开源。

## 路线图

- [x] 阶梯提示（绿色箭头直指引擎建议着法）
- [x] 棋谱复盘 / 录制对局 / 软件检测
- [x] 视频工坊（变招回看 / 逐手标注 / 截图识别）
- [ ] 答案线预计算管线（离线批量求解 → JSON 分发，为轻量端复用）
- [ ] 走子滑行动画
- [ ] 自定义课程 / 杀型标签专项刷题
- [ ] H5 / 小程序端（复用棋规库与题库数据包）
