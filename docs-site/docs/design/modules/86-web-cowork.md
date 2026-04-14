# 模块 86: Web Cowork 日常任务协作系统 (web-cowork)

> **版本**: v5.0.3.0
> **状态**: 🔄 实施中
> **日期**: 2026-04-13

## 一、背景与目标

### 1.1 问题陈述

普通用户在日常工作和生活中频繁遇到以下类型的问题：

| 场景类别 | 典型问题 | 当前解决方式 | 痛点 |
|---------|---------|------------|------|
| 文档处理 | Word 转 PDF、合并文档、格式修复 | 手动操作 Office、找在线工具 | 散乱、隐私风险 |
| 音视频处理 | 视频压缩、提取音频、剪辑片段、格式转换 | 下载各种工具、学 ffmpeg 命令 | 门槛高、耗时 |
| 数据分析 | Excel 统计、CSV 趋势图、数据清洗 | 手写公式、学 Python | 非技术用户无法完成 |
| 信息检索 | 多源调研、竞品分析、技术选型 | 手动搜索+整理 | 耗时、遗漏 |
| 图片处理 | 批量压缩、加水印、格式转换、OCR 文字提取 | Photoshop/在线工具 | 批量操作繁琐 |
| 代码辅助 | 生成脚本、调试报错、自动化任务 | 复制粘贴到 ChatGPT | 无法执行、无上下文 |
| 系统运维 | 磁盘清理、进程管理、日志分析 | 手动命令行 | 危险操作多、记不住命令 |
| 文件管理 | 批量重命名、整理归档、查找重复 | 资源管理器一个个改 | 效率极低 |
| 网络工具 | API 调试、网页抓取、下载管理 | Postman/curl/浏览器 | 工具分散 |
| 学习辅助 | 文档翻译、知识总结、论文分析 | 复制到翻译器 | 上下文断裂 |

**核心洞察**: 这些问题的共同特征是 —— **用户知道要做什么，但不知道怎么做或嫌麻烦**。而一个有工具访问权限的 AI Agent 恰好能补上这个缺口：用户用自然语言描述需求，Agent 实时生成代码并执行完成任务。

### 1.2 设计目标

1. **一个 Web 入口覆盖日常 80% 问题** — 用户打开浏览器即可使用，无需安装额外软件
2. **自然语言驱动** — 用户不需要知道 ffmpeg、pandoc、Python，只需描述需求
3. **实时数据 + 大模型** — Agent 能抓取网页、调用 API 获取实时信息，结合 LLM 分析后给出方案
4. **Code Agent 实时生成代码执行** — 不是预置脚本，而是 Agent 根据具体需求动态生成 Python/Node/Shell 脚本并执行
5. **流水线式多步协作** — 复杂任务自动分解为多步，每步独立 Agent 执行，步间传递结构化结果
6. **安全可控** — 所有操作在本机执行，敏感操作需确认，文件不上传第三方

### 1.3 与现有系统的关系

```
现有系统                           新增系统
┌─────────────┐                  ┌──────────────────────┐
│ /chat 页面   │                  │ /cowork 页面          │
│ 通用 AI 对话  │                  │ 任务模板 + 对话 + 执行  │
│ 单轮问答为主  │                  │ 多步流水线为主         │
└──────┬──────┘                  └──────────┬───────────┘
       │                                    │
       └──────────┬─────────────────────────┘
                  ▼
        ┌──────────────────┐
        │ WebSocket Server  │  ← 共用，新增 cowork-task 消息类型
        │ (ws-server.js)    │
        └────────┬─────────┘
                 ▼
        ┌──────────────────┐
        │ Agent Core       │  ← 零改动复用
        │ (agent-core.js)  │
        │ 13 工具 + 138 技能 │
        └──────────────────┘
```

---

## 二、用户场景全覆盖清单

### 2.1 十大场景分类与 Agent 执行路径

#### 场景 1: 文档处理

```
用户输入: "把 report.docx 转成 PDF"
         "合并 chapter1.md 和 chapter2.md 为一个文档"
         "把这个 Excel 导出为带图表的 PDF 报告"

Agent 执行路径 (开源工具优先):

  路径 A — cli-anything 已注册 (最优):
  ① list_skills → 发现 cli-anything-pandoc 已注册
  ② run_skill cli-anything-pandoc "convert report.docx to PDF"
     → cli-anything 自动翻译为: pandoc report.docx -o report.pdf --pdf-engine=xelatex
  ③ verify → run_shell: ls -la report.pdf

  路径 B — cli-anything 未注册，工具已安装:
  ① run_shell: pandoc --version → OK
  ② run_shell: pandoc report.docx -o report.pdf
  ③ 尝试注册: run_shell: chainlesschain cli-anything register pandoc --force
  ④ verify → 确认文件存在

  路径 C — 工具未安装 (自动安装):
  ① run_shell: pandoc --version → 失败
  ② run_shell: winget install JohnMacFarlane.Pandoc --accept-package-agreements --accept-source-agreements
  ③ run_shell: pandoc --version → OK
  ④ run_shell: pandoc report.docx -o report.pdf
  ⑤ 后台注册: chainlesschain cli-anything register pandoc

  路径 D — winget 也没有 (Python 降级):
  ① run_code(python): pip install python-docx pdfkit → 用 Python 库实现

开源工具: pandoc, LibreOffice (soffice), Ghostscript (gs), wkhtmltopdf
Python 降级: python-docx, pdfkit, fpdf2, openpyxl
```

#### 场景 2: 音视频处理

```
用户输入: "把 meeting.mp4 提取音频"
         "压缩这个视频到 50MB 以内"
         "把 podcast.mp3 从 10:30 到 25:00 剪一段"
         "合并 intro.mp4 和 main.mp4"

Agent 执行路径 (开源工具优先):

  路径 A — cli-anything 已注册 (最优):
  ① list_skills → 发现 cli-anything-ffmpeg 已注册
  ② run_skill cli-anything-ffmpeg "extract audio from meeting.mp4 as mp3 192kbps"
     → cli-anything 自动翻译为正确的 ffmpeg 命令
     → 用户不需要知道 -vn -acodec libmp3lame -ab 192k 这些参数
  ③ verify → run_shell: ffprobe output.mp3

  路径 B — 直接调用 ffmpeg:
  ① run_shell: ffprobe -v quiet -print_format json -show_format input.mp4
     (先分析源文件)
  ② run_shell: ffmpeg -i meeting.mp4 -vn -acodec libmp3lame audio.mp3
     (Agent 根据分析结果构造命令)
  ③ verify → ffprobe output.mp3

  路径 C — ffmpeg 未安装 (自动安装):
  ① run_shell: winget install Gyan.FFmpeg --accept-package-agreements --accept-source-agreements
  ② 验证 → ffmpeg -version → OK
  ③ 执行转换 → 同路径 B

  路径 D — Python 降级:
  ① run_code(python): pip install moviepy pydub → 用 Python 库实现

开源工具: FFmpeg, SoX, yt-dlp
Python 降级: moviepy, pydub, ffmpeg-python
```

#### 场景 3: 数据分析

```
用户输入: "分析 sales.csv 的月度趋势，生成图表"
         "清洗这个 Excel，去重并修复格式"
         "比较这两个 CSV 文件的差异"

Agent 执行路径:
  ① read-sample → read_file: sales.csv (前 20 行，理解数据结构)
  ② analyze     → run_code(python): 动态生成 pandas 脚本
     ```python
     import pandas as pd
     import matplotlib.pyplot as plt
     df = pd.read_csv('sales.csv')
     df['month'] = pd.to_datetime(df['date']).dt.to_period('M')
     monthly = df.groupby('month')['amount'].sum()
     monthly.plot(kind='bar', figsize=(12, 6))
     plt.savefig('trend.png', dpi=150, bbox_inches='tight')
     print(monthly.to_string())
     ```
  ③ report      → write_file: 生成分析报告 markdown

依赖工具: Python + pandas + matplotlib
Agent 工具: run_code, read_file, write_file
关键能力: Agent 先看数据再写代码，不是套模板
```

#### 场景 4: 信息检索与实时数据

```
用户输入: "帮我调研 2024 年主流 AI Agent 框架的对比"
         "查一下今天的汇率，人民币兑美元"
         "搜索这个 npm 包的最新版本和 changelog"

Agent 执行路径:
  ① fetch       → run_skill(browser-automation): fetchPage(url) 抓取网页
                   或 run_code(node): fetch('https://api.exchangerate-api.com/...')
  ② parse       → run_code(python/node): 解析 HTML/JSON，提取关键数据
  ③ analyze     → LLM 对抓取到的原始数据进行分析、对比、总结
  ④ report      → write_file: 生成结构化调研报告

Agent 工具: run_skill(browser-automation), run_code, write_file
关键能力: 实时数据 + LLM 分析 = 有时效性的智能报告
```

#### 场景 5: 图片处理

```
用户输入: "把 photos/ 下所有图片压缩到 500KB 以内"
         "给这些图片加公司 logo 水印"
         "识别这张图上的文字 (OCR)"

Agent 执行路径 (开源工具优先):

  路径 A — cli-anything 已注册:
  ① list_skills → 发现 cli-anything-magick
  ② run_skill cli-anything-magick "batch compress all png in photos/ to under 500KB"
     → cli-anything 翻译为: magick mogrify -resize '500000@>' -quality 85 photos/*.png
  ③ OCR 场景:
     run_skill cli-anything-tesseract "recognize text in screenshot.png output as txt"
     → 翻译为: tesseract screenshot.png output -l chi_sim+eng

  路径 B — 直接调用工具:
  ① run_shell: magick --version / tesseract --version
  ② 批量压缩: run_shell: magick mogrify -quality 85 -resize 800x photos/*.png
  ③ OCR: run_shell: tesseract image.png output -l chi_sim

  路径 C — Python 降级:
  ① run_code(python): 用 Pillow 批量处理
     from PIL import Image
     for f in glob.glob('photos/*.png'):
         img = Image.open(f)
         img.save(f'compressed/{os.path.basename(f)}', optimize=True, quality=85)
  ② OCR: run_code(python): pip install pytesseract → pytesseract.image_to_string(img)

开源工具: ImageMagick, Tesseract OCR, OptiPNG, ExifTool
Python 降级: Pillow, pytesseract, img2pdf
```

#### 场景 6: 代码辅助

```
用户输入: "写一个 Python 脚本批量重命名文件"
         "这段代码报错了帮我看看" + 粘贴代码
         "生成一个 Express REST API 的脚手架"

Agent 执行路径:
  ① understand  → LLM 理解需求 / read_file 读取报错代码
  ② generate    → LLM 生成代码方案
  ③ execute     → run_code: 实际运行验证（可选）
  ④ iterate     → 如果报错，Agent 自动读错误信息、修复、重试

Agent 工具: run_code, write_file, edit_file, run_shell
关键能力: 不只是生成代码，还能执行并自动调试
```

#### 场景 7: 系统运维

```
用户输入: "查看磁盘使用情况，找出最大的 10 个文件"
         "分析最近的系统日志，有没有异常"
         "帮我清理 node_modules 和临时文件"

Agent 执行路径:
  ① gather      → run_shell: du -sh / df -h / wmic diskdrive get size
  ② analyze     → run_code(python): 解析输出，排序，生成报告
  ③ suggest     → LLM 给出清理建议（不直接执行危险操作）
  ④ execute     → 用户确认后 run_shell 执行清理（需 approval）

Agent 工具: run_shell, run_code
安全: 删除/清理操作走 approval flow，Agent 不自行删文件
```

#### 场景 8: 文件管理

```
用户输入: "把 downloads/ 按文件类型分类整理"
         "批量把文件名中的空格替换成下划线"
         "找出这个文件夹里的重复文件"

Agent 执行路径:
  ① scan        → list_dir + search_files: 扫描目标目录
  ② plan        → LLM 生成整理/重命名方案并展示给用户
  ③ execute     → run_code(python): 执行文件操作
     ```python
     import os, shutil
     for f in os.listdir('downloads'):
         ext = os.path.splitext(f)[1].lower()
         category = {'images': ['.jpg','.png'], 'docs': ['.pdf','.docx'], ...}
         dest = next((k for k,v in category.items() if ext in v), 'other')
         os.makedirs(f'downloads/{dest}', exist_ok=True)
         shutil.move(f'downloads/{f}', f'downloads/{dest}/{f}')
     ```
  ④ report      → 返回操作统计

Agent 工具: run_code, list_dir, search_files
```

#### 场景 9: 网络工具

```
用户输入: "帮我测一下这个 API 接口能不能通"
         "抓取这个网页的所有图片链接"
         "下载这个 URL 的内容并保存"

Agent 执行路径:
  ① fetch       → run_code(node):
     ```javascript
     const res = await fetch('https://api.example.com/health');
     console.log({ status: res.status, headers: Object.fromEntries(res.headers) });
     console.log(await res.json());
     ```
  ② analyze     → LLM 解读 API 响应，给出诊断
  ③ save        → write_file: 保存结果到文件

Agent 工具: run_code, run_skill(browser-automation), write_file
```

#### 场景 10: 学习辅助

```
用户输入: "翻译这篇英文 PDF 的摘要"
         "帮我总结这个长文档的要点"
         "解释这段代码的工作原理"

Agent 执行路径:
  ① read        → read_file: 读取文档内容
                   或 run_code(python): 解析 PDF
     ```python
     import PyPDF2
     reader = PyPDF2.PdfReader('paper.pdf')
     text = '\n'.join(page.extract_text() for page in reader.pages[:5])
     print(text)
     ```
  ② process     → LLM 翻译/总结/解释
  ③ output      → write_file: 保存翻译/总结结果

Agent 工具: run_code, read_file, write_file
```

### 2.2 实时数据获取能力矩阵

| 数据类型 | 获取方式 | Agent 工具 | 示例 |
|---------|---------|-----------|------|
| 网页内容 | browser-automation skill | run_skill | 新闻、文档、竞品页面 |
| REST API | Node.js fetch / Python requests | run_code | 汇率、天气、股票行情 |
| 本地文件 | 直接读取 | read_file | CSV、日志、配置文件 |
| 系统信息 | Shell 命令 | run_shell | 磁盘、进程、网络状态 |
| Git 仓库 | git 命令 | git 工具 | commit 历史、diff、blame |
| npm/pip 包 | 包管理器 CLI | run_shell | 版本、依赖、changelog |
| 数据库 | sqlite3/psql CLI | run_shell | 查询、导出、统计 |

---

## 三、系统架构

### 3.1 整体架构

```
┌─────────────────── Web Browser ────────────────────────────┐
│                                                             │
│  /cowork 页面 (Cowork.vue)                                   │
│  ┌──────────────┬───────────────────────────────────────┐   │
│  │              │                                       │   │
│  │  任务模板面板  │         对话 + 实时执行面板             │   │
│  │              │                                       │   │
│  │ ┌──────────┐ │  ┌─────────────────────────────────┐  │   │
│  │ │ 文档处理  │ │  │  用户: "把 video.mp4 转成 mp3"  │  │   │
│  │ │ 音视频   │ │  │                                 │  │   │
│  │ │ 数据分析  │ │  │  ┌── Step 1: 环境检查 ────────┐ │  │   │
│  │ │ 信息检索  │ │  │  │ run_shell: ffmpeg -version │ │  │   │
│  │ │ 图片处理  │ │  │  │ ✅ ffmpeg 6.1 已安装       │ │  │   │
│  │ │ 代码辅助  │ │  │  └──────────────────────────┘ │  │   │
│  │ │ 系统运维  │ │  │                                 │  │   │
│  │ │ 文件管理  │ │  │  ┌── Step 2: 执行转换 ────────┐ │  │   │
│  │ │ 网络工具  │ │  │  │ run_shell: ffmpeg -i ...   │ │  │   │
│  │ │ 学习辅助  │ │  │  │ ✅ 输出: audio.mp3 (5.2MB) │ │  │   │
│  │ │ 自由提问  │ │  │  └──────────────────────────┘ │  │   │
│  │ └──────────┘ │  │                                 │  │   │
│  │              │  │  📁 结果: audio.mp3 [下载]       │  │   │
│  │  📂 文件拖拽区 │  └─────────────────────────────────┘  │   │
│  │              │                                       │   │
│  └──────────────┴───────────────────────────────────────┘   │
│                                                             │
└──────────────────────── WebSocket ──────────────────────────┘
                              │
                    ┌─────────┴─────────┐
                    ▼                   ▼
             cowork-task           session-message
             (模板模式)             (自由模式)
                    │                   │
                    ▼                   ▼
          ┌──────────────┐    ┌──────────────┐
          │ CoworkRunner  │    │ Agent Session │
          │ 流水线控制器    │    │ 单次长对话     │
          └──────┬───────┘    └──────────────┘
                 │
      ┌──────────┼──────────┐
      ▼          ▼          ▼
  SubAgent   SubAgent   SubAgent
  (Step 1)   (Step 2)   (Step 3)
      │          │          │
      ▼          ▼          ▼
  agentLoop  agentLoop  agentLoop
  (13 工具)   (13 工具)   (13 工具)
```

### 3.2 核心组件

```
新增文件:
packages/cli/src/lib/cowork-task-runner.js       # 流水线控制器 (~300行)
packages/cli/src/lib/cowork-task-templates.js     # 任务模板定义 (~400行)
packages/web-panel/src/views/Cowork.vue           # Web 主页面 (~400行)
packages/web-panel/src/stores/cowork.js           # 前端状态管理 (~200行)

修改文件:
packages/web-panel/src/router/index.js            # 新增 /cowork 路由
packages/web-panel/src/components/AppLayout.vue   # 侧边栏加入 Cowork 入口
packages/cli/src/gateways/ws/action-protocol.js   # 新增 cowork-task 消息处理
```

### 3.3 数据流

```
用户操作                    前端                    WebSocket                后端
  │                         │                         │                      │
  ├─ 选择模板 ──────────────→│                         │                      │
  ├─ 输入需求 ──────────────→│                         │                      │
  ├─ (可选)拖入文件 ────────→│                         │                      │
  │                         │                         │                      │
  │                         ├─ cowork-task ──────────→│                      │
  │                         │  {template, message,    │                      │
  │                         │   files, cwd}           │── CoworkRunner ─────→│
  │                         │                         │                      │
  │                         │←── step-started ────────│←── SubAgent(step1) ──│
  │ 看到 Step 1 开始       ←│                         │      agentLoop()     │
  │                         │←── tool-executing ──────│←── run_shell(...)  ──│
  │ 看到工具在执行         ←│                         │                      │
  │                         │←── tool-result ─────────│←── result ──────────│
  │ 看到工具结果           ←│                         │                      │
  │                         │←── step-completed ──────│←── summary ─────────│
  │ 看到 Step 1 完成       ←│                         │                      │
  │                         │                         │                      │
  │                         │←── step-started ────────│←── SubAgent(step2) ──│
  │ 看到 Step 2 开始       ←│                         │      agentLoop()     │
  │                         │  ... (重复)              │                      │
  │                         │                         │                      │
  │                         │←── pipeline-complete ───│                      │
  │ 看到最终结果+下载链接  ←│                         │                      │
```

---

## 四、核心实现

### 4.1 任务模板 (cowork-task-templates.js)

任务模板不是硬编码脚本，而是 **给 Agent 的领域知识注入**。Agent 仍然有完整的工具集和自主决策能力，模板只约束"该做什么"和"做完检查什么"。

```javascript
/**
 * Cowork Task Templates
 *
 * 每个模板定义:
 * - id: 唯一标识
 * - name: 显示名称
 * - icon: Ant Design icon 名
 * - category: 分类
 * - description: 一句话描述
 * - examples: 示例输入列表 (帮用户理解能做什么)
 * - steps: 流水线步骤定义
 *   - step: 步骤标识
 *   - prompt(ctx): 生成 Agent prompt 的函数
 *   - validate(result): 从 Agent 返回中提取结构化数据
 *   - maxIterations: Agent 最大循环次数
 *   - tools: 工具白名单 (null = 全部)
 * - systemPromptExtension: 注入到 Agent system prompt 的领域知识
 * - acceptsFiles: 是否接受文件输入
 * - fileTypes: 接受的文件类型
 */

export const TASK_TEMPLATES = {
  "doc-convert": {
    id: "doc-convert",
    name: "文档格式转换",
    icon: "FileTextOutlined",
    category: "document",
    description: "Word、Markdown、HTML、PDF 之间的格式互转",
    examples: [
      "把 report.docx 转成 PDF",
      "把 README.md 转成带样式的 HTML",
      "合并 chapter1.md 和 chapter2.md 为一个 PDF",
    ],
    acceptsFiles: true,
    fileTypes: [".docx", ".md", ".html", ".txt", ".pdf", ".xlsx", ".pptx"],
    systemPromptExtension: `你是文档格式转换专家。
工具优先级: pandoc > soffice (LibreOffice) > wkhtmltopdf > Python。
转换前先检查工具可用性。如果工具未安装，自动安装:
- pandoc: winget install JohnMacFarlane.Pandoc --accept-package-agreements --accept-source-agreements
- LibreOffice: winget install TheDocumentFoundation.LibreOffice --accept-package-agreements --accept-source-agreements
- 安装后验证: pandoc --version / soffice --version
- 如果 winget 不可用，尝试 choco install pandoc -y
- 所有安装工具都不可用时，使用 Python 替代方案 (python-docx, pdfkit)
转换后确认文件存在且大小合理。
如果目标格式是 PDF 且源是 Markdown，用 pandoc 加 --pdf-engine=xelatex 以支持中文。
如果 pandoc 不可用，尝试 Markdown → HTML → soffice → PDF 的降级路径。`,
    steps: [
      {
        step: "check-env",
        maxIterations: 3,
        prompt: (ctx) => `检查以下工具的可用性: pandoc, soffice, wkhtmltopdf, python。
只返回 JSON 格式: {"pandoc":"版本号或false","soffice":"版本号或false","wkhtmltopdf":"版本号或false","python":"版本号或false"}`,
      },
      {
        step: "convert",
        maxIterations: 8,
        prompt: (ctx) => `用户需求: ${ctx.userMessage}
${ctx.files?.length ? `输入文件: ${ctx.files.join(", ")}` : ""}
可用工具: ${JSON.stringify(ctx.steps?.["check-env"] || {})}
请执行转换，完成后确认输出文件路径和大小。`,
      },
      {
        step: "verify",
        maxIterations: 3,
        prompt: (ctx) => `验证转换结果: ${ctx.steps?.convert?.outputFile || "上一步产出的文件"}
检查: 1. 文件存在 2. 大小合理(>0) 3. 可以正常打开
返回验证结论。`,
      },
    ],
  },

  "media-process": {
    id: "media-process",
    name: "音视频处理",
    icon: "PlayCircleOutlined",
    category: "media",
    description: "视频压缩、音频提取、格式转换、剪辑",
    examples: [
      "把 meeting.mp4 提取音频保存为 mp3",
      "压缩 video.mp4 到 50MB 以内",
      "剪辑 podcast.mp3 从 10:30 到 25:00",
      "把 video.avi 转成 mp4 (H.264)",
    ],
    acceptsFiles: true,
    fileTypes: [".mp4", ".avi", ".mkv", ".mov", ".mp3", ".wav", ".flac", ".aac", ".webm"],
    systemPromptExtension: `你是音视频处理专家，精通 ffmpeg/ffprobe。
如果 ffmpeg 未安装，自动安装:
- Windows: winget install Gyan.FFmpeg --accept-package-agreements --accept-source-agreements
- 备选: choco install ffmpeg -y
- 安装后验证: ffmpeg -version
处理前先用 ffprobe 分析源文件（编码、分辨率、码率、时长）。
根据分析结果智能选择编码参数，而非使用固定参数。
压缩视频时优先用 -crf 控制质量，如果有目标大小限制则计算合适的码率。
剪辑使用 -ss 和 -to 参数，优先用 copy 编码避免重新编码。`,
    steps: [
      {
        step: "check-env",
        maxIterations: 3,
        prompt: (ctx) => `检查 ffmpeg 和 ffprobe 是否可用，返回版本号。
JSON 格式: {"ffmpeg":"版本或false","ffprobe":"版本或false"}`,
      },
      {
        step: "analyze",
        maxIterations: 5,
        prompt: (ctx) => `用 ffprobe 分析输入文件: ${ctx.files?.[0] || "用户指定的文件"}
输出关键信息: 格式、编码、分辨率、码率、时长、大小。`,
      },
      {
        step: "process",
        maxIterations: 10,
        prompt: (ctx) => `用户需求: ${ctx.userMessage}
文件分析: ${JSON.stringify(ctx.steps?.analyze || {})}
执行处理，完成后确认输出文件路径和大小。
如果处理失败，分析错误原因并尝试替代方案。`,
      },
    ],
  },

  "data-analysis": {
    id: "data-analysis",
    name: "数据分析",
    icon: "BarChartOutlined",
    category: "data",
    description: "CSV/Excel 分析、统计、可视化图表生成",
    examples: [
      "分析 sales.csv 的月度趋势，生成图表",
      "清洗这个 Excel，去重并修复日期格式",
      "比较 2023.csv 和 2024.csv 的差异",
      "统计 log.csv 中各错误类型的出现频率",
    ],
    acceptsFiles: true,
    fileTypes: [".csv", ".xlsx", ".xls", ".tsv", ".json"],
    systemPromptExtension: `你是数据分析专家，精通 Python pandas/matplotlib/seaborn。
分析前先 read_file 查看数据样本（前 10-20 行），理解列名、数据类型、缺失值情况。
根据数据特征选择合适的分析方法和可视化类型。
图表必须: 有标题、轴标签、适当的颜色；中文用 matplotlib 的 SimHei 或 Arial Unicode MS 字体。
如果 pandas 未安装，先用 run_code 的 auto-install 功能安装。`,
    steps: [
      {
        step: "inspect",
        maxIterations: 5,
        prompt: (ctx) => `读取数据文件 ${ctx.files?.[0] || "用户指定的文件"} 的前 20 行。
分析: 列名、数据类型、行数、缺失值情况。返回数据概况。`,
      },
      {
        step: "analyze",
        maxIterations: 12,
        prompt: (ctx) => `用户需求: ${ctx.userMessage}
数据概况: ${JSON.stringify(ctx.steps?.inspect || {})}
用 Python (pandas + matplotlib) 执行分析并生成图表。
图表保存为 PNG 文件。分析结论写入 markdown 报告。`,
      },
    ],
  },

  "web-research": {
    id: "web-research",
    name: "信息检索与调研",
    icon: "SearchOutlined",
    category: "research",
    description: "网页抓取、API 调用、多源信息汇总",
    examples: [
      "调研 2024 年主流 AI Agent 框架对比",
      "查询今天的美元兑人民币汇率",
      "搜索这个 npm 包的最新版本信息",
      "抓取这个网页的主要内容并翻译成中文",
    ],
    acceptsFiles: false,
    systemPromptExtension: `你是信息检索与分析专家。
获取实时数据的方式:
1. 网页抓取: 用 run_skill browser-automation 的 fetchPage 功能
2. REST API: 用 run_code(node) 调用 fetch 请求公开 API
3. CLI 工具: 用 run_shell 调用 curl
抓取到原始数据后，用 LLM 能力进行分析、对比、总结。
输出结构化的调研报告（markdown 格式），包含数据来源和时间。`,
    steps: [
      {
        step: "gather",
        maxIterations: 10,
        prompt: (ctx) => `用户需求: ${ctx.userMessage}
请从网络获取相关信息。使用以下方式:
- 公开 API: 用 run_code 调用 fetch
- 网页: 用 run_skill browser-automation fetchPage
收集尽可能全面的原始数据。`,
      },
      {
        step: "analyze-report",
        maxIterations: 8,
        prompt: (ctx) => `基于收集到的原始数据:
${JSON.stringify(ctx.steps?.gather || {})}
生成结构化分析报告（markdown），包含:
1. 摘要结论 2. 详细对比/分析 3. 数据来源与时间
保存为 report.md 文件。`,
      },
    ],
  },

  "image-process": {
    id: "image-process",
    name: "图片处理",
    icon: "PictureOutlined",
    category: "media",
    description: "批量压缩、格式转换、加水印、OCR 文字识别",
    examples: [
      "把 photos/ 下所有图片压缩到 500KB 以内",
      "给这些图片加水印文字 'CONFIDENTIAL'",
      "把所有 PNG 转成 WebP 格式",
      "识别这张图上的文字",
    ],
    acceptsFiles: true,
    fileTypes: [".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tiff", ".svg"],
    systemPromptExtension: `你是图片处理专家。
工具优先级: Python Pillow > ImageMagick (magick/convert)。
OCR: 优先用 Python pytesseract (需 Tesseract 引擎)。
批量操作时先处理 1 张确认效果，再批量执行。
输出统计: 处理数量、成功/失败数、原始总大小→处理后总大小。`,
    steps: [
      {
        step: "check-env",
        maxIterations: 3,
        prompt: (ctx) => `检查图片处理工具: Python Pillow, ImageMagick, Tesseract (OCR)。
JSON: {"pillow":"版本或false","imagemagick":"版本或false","tesseract":"版本或false"}`,
      },
      {
        step: "process",
        maxIterations: 12,
        prompt: (ctx) => `用户需求: ${ctx.userMessage}
${ctx.files?.length ? `输入文件: ${ctx.files.join(", ")}` : ""}
可用工具: ${JSON.stringify(ctx.steps?.["check-env"] || {})}
执行处理。批量操作先试 1 张，成功后批量执行。
完成后报告统计数据。`,
      },
    ],
  },

  "code-helper": {
    id: "code-helper",
    name: "代码辅助",
    icon: "CodeOutlined",
    category: "development",
    description: "生成脚本、调试代码、自动化任务",
    examples: [
      "写一个批量重命名文件的 Python 脚本",
      "这段代码报错了帮我看看: ...",
      "生成一个 cron 表达式解析器",
      "写个自动化脚本定时备份数据库",
    ],
    acceptsFiles: true,
    fileTypes: [".py", ".js", ".ts", ".sh", ".bat", ".ps1"],
    systemPromptExtension: `你是编程助手，擅长 Python/Node.js/Shell 脚本。
不只是生成代码 — 用 run_code 实际执行验证，确保代码能跑。
如果执行报错，自动分析错误、修复代码、重试。
生成的脚本保存到文件，方便用户后续使用。`,
    steps: null, // 无固定流水线，走单次 Agent 长对话
  },

  "system-admin": {
    id: "system-admin",
    name: "系统运维",
    icon: "DesktopOutlined",
    category: "system",
    description: "磁盘分析、进程管理、日志分析、环境检查",
    examples: [
      "查看磁盘使用情况，找出最大的 10 个文件夹",
      "分析最近的系统日志有没有异常",
      "检查 Node.js/Python/Java 开发环境版本",
      "列出占用端口的进程",
    ],
    acceptsFiles: false,
    systemPromptExtension: `你是系统运维专家。
当前系统: Windows (检测方式: os.platform())。
使用 PowerShell/cmd 命令获取系统信息。
危险操作（删除文件、杀进程、修改配置）必须先列出影响范围，等用户确认。
绝对不要执行 rm -rf、format、del /f /s 等破坏性命令。`,
    steps: null,
  },

  "file-organize": {
    id: "file-organize",
    name: "文件整理",
    icon: "FolderOpenOutlined",
    category: "file",
    description: "批量重命名、分类整理、查找重复、归档压缩",
    examples: [
      "把 downloads/ 按文件类型分类整理",
      "批量重命名: 把空格替换为下划线",
      "找出这个文件夹里的重复文件",
      "把项目打包为 zip 并排除 node_modules",
    ],
    acceptsFiles: false,
    systemPromptExtension: `你是文件管理专家。
操作前先 list_dir 查看目录结构，确认操作范围。
重命名/移动操作先生成预览列表（旧名→新名），让用户确认后再执行。
永远不要直接删除文件，改为移动到回收站或临时目录。`,
    steps: null,
  },

  "network-tools": {
    id: "network-tools",
    name: "网络工具",
    icon: "GlobalOutlined",
    category: "network",
    description: "API 调试、网页抓取、网络诊断",
    examples: [
      "测试一下 https://api.example.com/health 能不能通",
      "抓取这个网页上的所有图片链接",
      "ping 一下 google.com 看网络延迟",
      "用 curl 发一个 POST 请求到这个接口",
    ],
    acceptsFiles: false,
    systemPromptExtension: `你是网络工具专家。
API 调试: 用 run_code(node) 的 fetch 或 run_shell 的 curl。
网页抓取: 优先用 run_skill browser-automation。
网络诊断: ping, tracert, nslookup, netstat。
展示完整的请求/响应信息: status, headers, body。`,
    steps: null,
  },

  "learning-assist": {
    id: "learning-assist",
    name: "学习辅助",
    icon: "ReadOutlined",
    category: "learning",
    description: "文档翻译、内容总结、知识提取、论文分析",
    examples: [
      "翻译这篇 PDF 的摘要和结论",
      "总结这个长文档的关键要点",
      "解释这段代码的工作原理",
      "把这个技术文档转成通俗易懂的说明",
    ],
    acceptsFiles: true,
    fileTypes: [".pdf", ".md", ".txt", ".docx", ".html"],
    systemPromptExtension: `你是学习辅助专家。
读取文档: PDF 用 run_code(python) + PyPDF2/pdfminer 提取文本。
对于长文档，分段处理: 先提取目录/结构，再逐段翻译/总结。
翻译保持专业术语的准确性，必要时保留原文术语。
输出格式: markdown，便于阅读和后续编辑。`,
    steps: [
      {
        step: "extract",
        maxIterations: 8,
        prompt: (ctx) => `读取文档内容: ${ctx.files?.[0] || "用户指定的文件"}
如果是 PDF，用 Python 提取文本。如果是其他格式，直接 read_file。
返回文档结构概况（标题、章节、总字数）和前 2000 字内容。`,
      },
      {
        step: "process",
        maxIterations: 10,
        prompt: (ctx) => `用户需求: ${ctx.userMessage}
文档内容: ${ctx.steps?.extract?.summary || "见上一步"}
执行翻译/总结/分析，保存结果到 markdown 文件。`,
      },
    ],
  },
};

// 分类索引
export const TEMPLATE_CATEGORIES = [
  { key: "document", label: "文档处理", icon: "FileTextOutlined" },
  { key: "media",    label: "音视频/图片", icon: "PlayCircleOutlined" },
  { key: "data",     label: "数据分析", icon: "BarChartOutlined" },
  { key: "research", label: "信息检索", icon: "SearchOutlined" },
  { key: "development", label: "代码辅助", icon: "CodeOutlined" },
  { key: "system",   label: "系统运维", icon: "DesktopOutlined" },
  { key: "file",     label: "文件管理", icon: "FolderOpenOutlined" },
  { key: "network",  label: "网络工具", icon: "GlobalOutlined" },
  { key: "learning", label: "学习辅助", icon: "ReadOutlined" },
];
```

### 4.2 流水线控制器 (cowork-task-runner.js)

```javascript
/**
 * CoworkTaskRunner — 循环调用 Code Agent 完成多步任务
 *
 * 核心思路:
 * - 有模板的任务 → 按模板定义的步骤序列，逐步创建独立 SubAgentContext 执行
 * - 无模板/自由提问 → 退化为单次 Agent Session（等同 /chat 的 Agent 模式）
 *
 * 每步之间:
 * - validate() 从 Agent 返回中提取结构化数据
 * - 下一步的 prompt(ctx) 拿到上一步的结构化结果
 * - 失败可重试单步，不影响已完成步骤
 *
 * 所有事件通过 async generator yield 出去，前端实时展示。
 */

import { SubAgentContext } from "./sub-agent-context.js";
import { TASK_TEMPLATES } from "./cowork-task-templates.js";

export async function* runCoworkPipeline(templateId, userContext, options = {}) {
  const template = TASK_TEMPLATES[templateId];

  // ── 无模板 或 模板无固定流水线 → 单次 Agent 长对话 ─────────────
  if (!template || !template.steps) {
    yield* runSingleAgentMode(template, userContext, options);
    return;
  }

  // ── 流水线模式 → 逐步 SubAgent 执行 ───────────────────────────
  const stepResults = {};
  const ctx = {
    userMessage: userContext.message,
    files: userContext.files || [],
    steps: stepResults,
  };

  yield {
    type: "pipeline-started",
    templateId,
    templateName: template.name,
    totalSteps: template.steps.length,
  };

  for (let i = 0; i < template.steps.length; i++) {
    const stepDef = template.steps[i];
    const stepPrompt = stepDef.prompt({ ...ctx, steps: stepResults });
    const fullPrompt = template.systemPromptExtension
      ? `${template.systemPromptExtension}\n\n---\n\n${stepPrompt}`
      : stepPrompt;

    yield {
      type: "step-started",
      step: stepDef.step,
      index: i,
      total: template.steps.length,
      prompt: stepPrompt,
    };

    const subCtx = SubAgentContext.create({
      role: `cowork-${templateId}-${stepDef.step}`,
      task: fullPrompt,
      maxIterations: stepDef.maxIterations || 8,
      cwd: options.cwd || process.cwd(),
      allowedTools: stepDef.tools || null,
    });

    try {
      const result = await subCtx.run(fullPrompt);

      // 转发 sub-agent 内部的工具调用事件（如果需要实时展示）
      yield {
        type: "step-completed",
        step: stepDef.step,
        index: i,
        summary: result.summary,
        toolsUsed: result.toolsUsed,
        iterationCount: result.iterationCount,
        artifacts: result.artifacts,
      };

      // 提取结构化数据供下一步使用
      if (stepDef.validate) {
        try {
          stepResults[stepDef.step] = stepDef.validate(result);
        } catch (_e) {
          stepResults[stepDef.step] = { summary: result.summary };
        }
      } else {
        stepResults[stepDef.step] = { summary: result.summary };
      }
    } catch (err) {
      yield {
        type: "step-failed",
        step: stepDef.step,
        index: i,
        error: err.message,
      };
      // 可选: 重试逻辑
      break;
    }
  }

  yield {
    type: "pipeline-complete",
    templateId,
    results: stepResults,
  };
}

/**
 * 单次 Agent 长对话模式（无流水线）
 */
async function* runSingleAgentMode(template, userContext, options) {
  const systemExtension = template?.systemPromptExtension || "";
  const fileContext = userContext.files?.length
    ? `\n\n[用户提供的文件: ${userContext.files.join(", ")}]`
    : "";
  const prompt = userContext.message + fileContext;

  const subCtx = SubAgentContext.create({
    role: template ? `cowork-${template.id}` : "cowork-free",
    task: systemExtension
      ? `${systemExtension}\n\n---\n\n用户需求: ${prompt}`
      : prompt,
    maxIterations: 20, // 自由模式给更多迭代空间
    cwd: options.cwd || process.cwd(),
  });

  yield { type: "agent-started", templateId: template?.id || "free" };

  try {
    const result = await subCtx.run(
      systemExtension
        ? `${systemExtension}\n\n---\n\n用户需求: ${prompt}`
        : prompt
    );

    yield {
      type: "agent-completed",
      summary: result.summary,
      toolsUsed: result.toolsUsed,
      iterationCount: result.iterationCount,
      artifacts: result.artifacts,
    };
  } catch (err) {
    yield { type: "agent-failed", error: err.message };
  }
}
```

### 4.3 WebSocket 协议扩展

新增消息类型 `cowork-task`，在 `action-protocol.js` 中处理：

```javascript
// action-protocol.js — handleCoworkTask

async function handleCoworkTask(ws, msg, context) {
  const { runCoworkPipeline } = await import("../../lib/cowork-task-runner.js");

  const userContext = {
    message: msg.message || msg.content || "",
    files: msg.files || [],
  };

  const options = {
    cwd: msg.cwd || context.cwd || process.cwd(),
  };

  const gen = runCoworkPipeline(msg.template || null, userContext, options);

  for await (const event of gen) {
    _send(ws, {
      ...event,
      requestId: msg.id || msg.requestId,
      sessionId: msg.sessionId || null,
    });
  }
}
```

---

## 五、Web 前端实现

### 5.1 路由注册

```javascript
// router/index.js — 新增
{ path: 'cowork', name: 'Cowork', component: () => import('../views/Cowork.vue') },
```

### 5.2 侧边栏入口

在 AppLayout.vue 的 "概 览" 分组中，AI 对话下方新增:

```html
<a-menu-item key="cowork">
  <template #icon><RocketOutlined /></template>
  日常协作
</a-menu-item>
```

### 5.3 页面结构 (Cowork.vue)

```
┌─────────────────────────────────────────────────────────┐
│ Cowork.vue                                              │
│                                                         │
│ ┌─── 左侧 (280px) ───┐ ┌─── 右侧 (flex:1) ──────────┐ │
│ │                     │ │                              │ │
│ │  任务模板卡片列表     │ │  空状态 / 执行面板           │ │
│ │                     │ │                              │ │
│ │  ┌───────────────┐  │ │  ┌──────────────────────┐   │ │
│ │  │ 📄 文档处理    │  │ │  │ Step 1: 环境检查      │   │ │
│ │  │ 格式转换/合并  │  │ │  │ ✅ ffmpeg 6.1        │   │ │
│ │  └───────────────┘  │ │  └──────────────────────┘   │ │
│ │  ┌───────────────┐  │ │  ┌──────────────────────┐   │ │
│ │  │ 🎬 音视频处理  │  │ │  │ Step 2: 执行转换      │   │ │
│ │  │ 压缩/提取/剪辑│  │ │  │ 🔧 run_shell: ffmpeg  │   │ │
│ │  └───────────────┘  │ │  │ ✅ output.mp3 (5MB)   │   │ │
│ │  ...                │ │  └──────────────────────┘   │ │
│ │                     │ │                              │ │
│ │  ┌───────────────┐  │ │  ┌──────────────────────┐   │ │
│ │  │ ⚡ 自由提问    │  │ │  │ 最终结果              │   │ │
│ │  │ 任意任务      │  │ │  │ 📁 audio.mp3 [下载]   │   │ │
│ │  └───────────────┘  │ │  └──────────────────────┘   │ │
│ │                     │ │                              │ │
│ │  📂 拖拽文件到此处  │ │  ┌──────────────────────┐   │ │
│ │                     │ │  │ 💬 输入框 + 发送按钮   │   │ │
│ └─────────────────────┘ │  └──────────────────────┘   │ │
│                         └──────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

### 5.4 前端状态管理 (cowork.js store)

```javascript
// stores/cowork.js
import { defineStore } from 'pinia'
import { ref, reactive, computed } from 'vue'
import { useWsStore } from './ws.js'

export const useCoworkStore = defineStore('cowork', () => {
  // 当前选中的模板
  const selectedTemplate = ref(null)
  // 上传/拖入的文件路径
  const files = ref([])
  // 执行状态
  const isRunning = ref(false)
  // 流水线步骤状态
  const steps = ref([])    // [{ step, status, summary, tools, ... }]
  // 对话消息 (自由模式)
  const messages = ref([])
  // 最终结果
  const result = ref(null)

  function selectTemplate(template) {
    selectedTemplate.value = template
    reset()
  }

  function reset() {
    steps.value = []
    messages.value = []
    result.value = null
    isRunning.value = false
  }

  async function execute(message) {
    const ws = useWsStore()
    isRunning.value = true
    messages.value.push({ role: 'user', content: message })

    // 注册事件处理
    const unsubscribe = ws.onMessage((msg) => {
      handleCoworkEvent(msg)
    })

    ws.send({
      type: 'cowork-task',
      template: selectedTemplate.value?.id || null,
      message,
      files: files.value,
      cwd: window.__CC_CONFIG__?.projectRoot || null,
    })

    // unsubscribe 在 pipeline-complete/agent-completed 时调用
  }

  function handleCoworkEvent(msg) {
    switch (msg.type) {
      case 'pipeline-started':
        steps.value = []
        break
      case 'step-started':
        steps.value.push({
          step: msg.step,
          index: msg.index,
          status: 'running',
          summary: null,
        })
        break
      case 'step-completed':
        const step = steps.value.find(s => s.step === msg.step)
        if (step) {
          step.status = 'done'
          step.summary = msg.summary
          step.toolsUsed = msg.toolsUsed
        }
        break
      case 'step-failed':
        const failedStep = steps.value.find(s => s.step === msg.step)
        if (failedStep) {
          failedStep.status = 'failed'
          failedStep.error = msg.error
        }
        break
      case 'pipeline-complete':
        result.value = msg.results
        isRunning.value = false
        break
      case 'agent-started':
        break
      case 'agent-completed':
        messages.value.push({ role: 'assistant', content: msg.summary })
        result.value = { summary: msg.summary, artifacts: msg.artifacts }
        isRunning.value = false
        break
      case 'agent-failed':
        messages.value.push({ role: 'assistant', content: `Error: ${msg.error}` })
        isRunning.value = false
        break
      // 透传 tool-executing / tool-result 事件
      case 'tool-executing':
        steps.value[steps.value.length - 1]?.tools?.push(msg.tool)
        break
    }
  }

  return {
    selectedTemplate, files, isRunning, steps, messages, result,
    selectTemplate, reset, execute,
  }
})
```

---

## 六、CLI-Anything 开源工具集成

### 6.1 核心理念：开源工具优先

**CLI-Anything** (https://github.com/HKUDS/CLI-Anything) 能为任意 CLI 软件生成 Agent 原生的自然语言包装器。这意味着：

- 用户说"提取视频音频"，`cli-anything-ffmpeg` 自动生成正确的 `ffmpeg -i video.mp4 -vn audio.mp3` 命令
- Agent **不需要记住任何 CLI 参数语法**，由 cli-anything 的 LLM 层负责翻译
- 任何有 CLI 接口的开源软件都能一键接入

**开源工具优先级链**：

```
用户需求: "压缩这个视频"

优先级 1: cli-anything 已注册的工具
  └─ run_skill cli-anything-ffmpeg "compress video.mp4 to 50MB"
     (自然语言 → cli-anything 翻译 → 正确的 ffmpeg 命令)

优先级 2: 直接调用开源工具 CLI
  └─ run_shell: ffmpeg -i video.mp4 -crf 28 output.mp4
     (Agent 自己构造命令，需要了解参数)

优先级 3: Python/Node 开源库
  └─ run_code(python): from moviepy.editor import VideoFileClip; ...
     (用代码库实现，更灵活但更慢)

优先级 4: 在线 API / 告知用户
  └─ 最后手段
```

### 6.2 开源工具全景图

以下开源工具覆盖 Cowork 十大场景，均可通过 cli-anything 注册为 Agent 技能：

| 场景 | 开源工具 | CLI 命令 | cli-anything 注册名 | 用途 |
|------|---------|---------|-------------------|------|
| **文档处理** | Pandoc | `pandoc` | `cli-anything-pandoc` | 万能文档格式转换 |
| | LibreOffice | `soffice` | `cli-anything-soffice` | Office 文档处理 |
| | wkhtmltopdf | `wkhtmltopdf` | `cli-anything-wkhtmltopdf` | HTML→PDF |
| | Ghostscript | `gs` | `cli-anything-gs` | PDF 合并/压缩/OCR |
| **音视频** | FFmpeg | `ffmpeg` | `cli-anything-ffmpeg` | 音视频全能处理 |
| | yt-dlp | `yt-dlp` | `cli-anything-yt-dlp` | 视频下载 |
| | SoX | `sox` | `cli-anything-sox` | 音频处理/降噪 |
| **图片处理** | ImageMagick | `magick` | `cli-anything-magick` | 图片编辑/转换/批处理 |
| | Tesseract | `tesseract` | `cli-anything-tesseract` | OCR 文字识别 |
| | ExifTool | `exiftool` | `cli-anything-exiftool` | 图片元数据管理 |
| | OptiPNG | `optipng` | `cli-anything-optipng` | PNG 无损压缩 |
| **数据分析** | csvkit | `csvstat` | `cli-anything-csvkit` | CSV 命令行分析 |
| | jq | `jq` | `cli-anything-jq` | JSON 处理 |
| | SQLite | `sqlite3` | `cli-anything-sqlite3` | 轻量数据库查询 |
| | gnuplot | `gnuplot` | `cli-anything-gnuplot` | 命令行图表生成 |
| **网络工具** | curl | `curl` | `cli-anything-curl` | HTTP 请求调试 |
| | httpie | `http` | `cli-anything-httpie` | 更友好的 API 调试 |
| | nmap | `nmap` | `cli-anything-nmap` | 网络扫描/诊断 |
| **代码辅助** | Git | `git` | (已有 git 工具) | 版本控制 |
| | ripgrep | `rg` | `cli-anything-rg` | 代码搜索 |
| | shellcheck | `shellcheck` | `cli-anything-shellcheck` | Shell 脚本检查 |
| **系统运维** | htop/btop | `btop` | `cli-anything-btop` | 进程监控 |
| | ncdu | `ncdu` | `cli-anything-ncdu` | 磁盘分析 |
| | rclone | `rclone` | `cli-anything-rclone` | 云存储同步 |
| **文件管理** | 7-Zip | `7z` | `cli-anything-7z` | 压缩/解压 |
| | rsync | `rsync` | `cli-anything-rsync` | 文件同步 |
| | fd | `fd` | `cli-anything-fd` | 快速文件查找 |
| **学习辅助** | Poppler | `pdftotext` | `cli-anything-pdftotext` | PDF 文本提取 |
| | translate-shell | `trans` | `cli-anything-trans` | 命令行翻译 |

### 6.3 自动发现 → 注册 → 使用 流程

```
┌──────────────────────────────────────────────────────────────────┐
│ Cowork Agent 执行任务前的工具准备阶段                              │
│                                                                  │
│ Step 0: 环境检查                                                  │
│                                                                  │
│   ① list_skills → 看已有哪些 cli-anything-* 技能                  │
│      已注册: [cli-anything-ffmpeg, cli-anything-pandoc, ...]      │
│                                                                  │
│   ② 判断当前任务需要哪些工具                                       │
│      任务: "压缩视频" → 需要 ffmpeg                                │
│                                                                  │
│   ③ cli-anything-ffmpeg 已注册?                                   │
│      ├─ YES → 直接 run_skill cli-anything-ffmpeg "compress ..."   │
│      └─ NO  → 进入自动安装流程                                     │
│                                                                  │
│ Step 1: 安装底层开源工具                                           │
│   run_shell: winget install Gyan.FFmpeg                           │
│   验证: run_shell: ffmpeg -version → OK                          │
│                                                                  │
│ Step 2: 安装 cli-anything (如果未安装)                             │
│   run_shell: pip install cli-anything                             │
│                                                                  │
│ Step 3: 生成 cli-anything 包装器                                  │
│   run_shell: cli-anything generate ffmpeg                         │
│   (cli-anything 为 ffmpeg 生成自然语言包装器)                      │
│                                                                  │
│ Step 4: 注册为 ChainlessChain 技能                                │
│   run_shell: chainlesschain cli-anything register ffmpeg           │
│   (生成 SKILL.md + handler.js → 4 层技能系统自动加载)              │
│                                                                  │
│ Step 5: 使用                                                      │
│   run_skill cli-anything-ffmpeg "compress video.mp4 to 50MB"      │
│   (自然语言输入 → cli-anything 翻译 → ffmpeg 执行 → 返回结果)     │
│                                                                  │
│ 整个过程对用户透明，Agent 自动完成                                  │
└──────────────────────────────────────────────────────────────────┘
```

### 6.4 已注册工具的使用优势

**对比: 直接 run_shell vs cli-anything skill**

```
方式 A: run_shell (Agent 需要知道 ffmpeg 参数)
  Agent: run_shell("ffmpeg -i video.mp4 -vn -acodec libmp3lame -ab 192k audio.mp3")
  → Agent 需要记住/推理正确的 ffmpeg 参数组合
  → 参数错了就失败，需要多轮重试

方式 B: run_skill cli-anything-ffmpeg (自然语言)
  Agent: run_skill("cli-anything-ffmpeg", "extract audio from video.mp4 as mp3")
  → cli-anything 的 LLM 层负责翻译为正确命令
  → 更高的一次成功率，更少的 token 消耗
```

**方式 B 的好处**:
- Agent 的 prompt 更简洁（不用塞 ffmpeg 参数手册）
- 容错性更好（cli-anything 内置纠错）
- 可组合性更强（同样的自然语言接口适用于所有工具）

### 6.5 与 Cowork 模板的集成

每个 Cowork 模板的 `systemPromptExtension` 中优先推荐 cli-anything：

```
// 模板 system prompt 注入（以音视频为例）:

## 工具使用优先级
1. 先 list_skills 查看是否已有 cli-anything-ffmpeg 技能
   → 如果有: run_skill cli-anything-ffmpeg "用户的自然语言描述"
2. 如果没有 cli-anything 技能但 ffmpeg 已安装
   → 直接 run_shell 调用 ffmpeg（需要自己构造参数）
3. 如果 ffmpeg 未安装
   → 先安装 ffmpeg，然后尝试安装 cli-anything 并注册
   → 如果 cli-anything 安装失败，直接 run_shell 使用 ffmpeg
4. 如果底层工具完全不可用
   → 使用 Python 库替代（如 moviepy、pydub）
```

### 6.6 批量工具预注册

首次使用 Cowork 时，Agent 可以一次性注册用户系统上已有的所有工具：

```
Agent 在首次 Cowork session 中:
  ① run_shell: chainlesschain cli-anything doctor --json
     → 检查 Python + cli-anything 是否安装
  
  ② run_shell: chainlesschain cli-anything scan --json
     → 发现系统已安装的所有可包装工具
     → [ffmpeg, pandoc, magick, tesseract, 7z, curl, ...]
  
  ③ 对每个发现的工具:
     run_shell: chainlesschain cli-anything register <tool> --force --json
     → 批量注册为 ChainlessChain 技能
  
  ④ 后续所有 Cowork 任务都可以直接 run_skill 调用
```

---

## 七、工具自动安装机制

### 6.1 设计原则

- **Agent 检测到缺少工具时自动安装，不中断用户流程**
- 仅在 Agent 无法完成任务或确实需要人为确认时才询问用户
- 安装范围限于公开的包管理器（pip、npm、winget、brew、choco）
- 安装前后自动验证工具可用性

### 6.2 自动安装决策树 (含 cli-anything 注册)

```
Agent 执行任务
  │
  ├─ Step 0: 检查 cli-anything 已注册技能
  │   list_skills category=integration → 有无 cli-anything-<tool>?
  │   ├─ 已注册 → run_skill cli-anything-<tool> "自然语言需求" → 完成
  │   └─ 未注册 → 继续
  │
  ├─ Step 1: 检查底层工具是否已安装
  │   run_shell: <tool> --version
  │   ├─ 已安装 → 直接用 run_shell 调用，同时后台注册 cli-anything
  │   └─ 未安装 → 自动安装
  │
  ├─ Step 2: 自动安装底层开源工具
  │   ├─ Python 包 → run_code auto-install (无需确认)
  │   ├─ npm 包    → run_shell: npm install -g <pkg> (无需确认)
  │   ├─ 系统工具:
  │   │   ├─ Windows: winget install <id> --accept-package-agreements --accept-source-agreements
  │   │   ├─ 备选:   choco install <pkg> -y
  │   │   ├─ macOS:  brew install <pkg>
  │   │   └─ Linux:  apt-get install -y <pkg>
  │   └─ 安装后验证: <tool> --version
  │       ├─ 成功 → 继续
  │       └─ 失败 → 唯一需要告知用户的场景
  │
  ├─ Step 3: 注册 cli-anything 包装器 (最佳实践，非阻塞)
  │   run_shell: chainlesschain cli-anything register <tool> --force --json
  │   ├─ 成功 → 后续同类任务可用 run_skill 自然语言调用
  │   └─ 失败 → 无影响，继续用 run_shell 直接调用
  │
  └─ Step 4: 执行任务
      ├─ 优先: run_skill cli-anything-<tool> "自然语言需求"
      └─ 备选: run_shell: <tool> <Agent 构造的参数>
```

### 6.3 系统工具安装映射表

| 工具 | winget ID | choco ID | brew ID | 用途 |
|------|----------|---------|--------|------|
| ffmpeg | `Gyan.FFmpeg` | `ffmpeg` | `ffmpeg` | 音视频处理 |
| pandoc | `JohnMacFarlane.Pandoc` | `pandoc` | `pandoc` | 文档转换 |
| LibreOffice | `TheDocumentFoundation.LibreOffice` | `libreoffice-fresh` | `libreoffice` | Office 文档 |
| Tesseract | `UB-Mannheim.TesseractOCR` | `tesseract` | `tesseract` | OCR 识别 |
| ImageMagick | `ImageMagick.ImageMagick` | `imagemagick` | `imagemagick` | 图片处理 |
| wkhtmltopdf | — | `wkhtmltopdf` | `wkhtmltopdf` | HTML→PDF |
| GraphViz | `Graphviz.Graphviz` | `graphviz` | `graphviz` | 图表生成 |

### 6.4 System Prompt 注入

每个模板的 `systemPromptExtension` 中包含自动安装指令：

```
通用安装规则 (注入到所有 cowork agent 的 system prompt):

## 工具自动安装
当你发现所需的命令行工具未安装时，按以下规则自动安装:
1. Python 包: 直接用 run_code 执行，auto-install 会自动处理 pip install
2. npm 包: run_shell: npm install -g <package>
3. 系统工具 (ffmpeg/pandoc/tesseract/imagemagick/soffice):
   - Windows: 先尝试 winget install <id> --accept-package-agreements --accept-source-agreements
   - 如果 winget 不可用，尝试 choco install <pkg> -y
   - 如果都不可用，告诉用户下载链接
   - macOS: brew install <pkg>
4. 安装后立即验证: <tool> --version
5. 只有在安装失败或需要管理员权限时才告知用户

绝对不要因为工具未安装就放弃任务。先尝试安装，安装失败再寻找替代方案。
替代方案优先级: Python 库 > Node.js 库 > 在线 API > 告知用户手动安装。
```

### 6.5 run_code auto-install 已有能力

`agent-core.js` 中的 `_executeRunCode` 已实现 Python 包自动安装:

```javascript
// 检测 ImportError → 自动 pip install → 重试
if (error.classification === 'import_error') {
  const missingModule = extractModuleName(error.stderr);
  await run_shell(`pip install ${missingModule}`);
  // 自动重试执行
}
```

Node.js 同理，通过 `npm install` 安装缺失模块后重试。

---

## 七、安全设计

### 6.1 权限分级

| 操作类型 | 风险等级 | 处理方式 |
|---------|---------|---------|
| 读取文件内容 | LOW | 直接执行 |
| 生成/写入新文件 | LOW | 直接执行 |
| 安装 pip/npm 包 | MEDIUM | run_code auto-install，限制来源 |
| 执行 shell 命令 | MEDIUM | shell-policy 过滤危险命令 |
| 删除/覆盖文件 | HIGH | 需用户 approval（WebSocket question 事件）|
| 杀进程/改系统配置 | HIGH | 需用户 approval |
| 网络请求外部 URL | MEDIUM | 展示目标 URL，允许执行 |

### 6.2 已有安全机制复用

- **Shell Policy** (`coding-agent-shell-policy.cjs`): 已有的命令黑名单过滤
- **Plan Mode**: 高风险操作自动进入 approval flow
- **Hook Pipeline**: PreToolUse 可拦截危险操作
- **SubAgentContext**: 工具白名单 + iteration budget 限制

### 6.3 数据隐私

- 所有处理在本机执行，文件不上传第三方
- LLM 只接收文件的文本内容摘要，不接收二进制数据
- 实时数据抓取只访问用户指定的 URL

---

## 七、实施计划

### Phase 1: 核心管线 (P0, 2 天)

| 任务 | 文件 | 预计行数 |
|------|------|---------|
| 任务模板定义 | `packages/cli/src/lib/cowork-task-templates.js` | ~400 |
| 流水线控制器 | `packages/cli/src/lib/cowork-task-runner.js` | ~300 |
| WS 消息处理 | `packages/cli/src/gateways/ws/action-protocol.js` (修改) | ~40 |
| Web 页面 | `packages/web-panel/src/views/Cowork.vue` | ~400 |
| 前端状态 | `packages/web-panel/src/stores/cowork.js` | ~200 |
| 路由+侧边栏 | router/index.js + AppLayout.vue (修改) | ~10 |

### Phase 2: 增强体验 (P1, 1 天)

| 任务 | 说明 |
|------|------|
| 文件拖拽区 | 拖入文件获取本机路径 |
| 步骤时间线可视化 | 展示每步的工具调用和结果 |
| 结果预览 | 图片/PDF/CSV 在线预览 + 下载 |

### Phase 3: 扩展能力 (P2, 1-2 天)

| 任务 | 说明 |
|------|------|
| HTTP 文件上传 | 真正的文件上传到临时目录 |
| 自定义模板 | 用户创建/编辑自己的任务模板 |
| 历史记录 | 保存执行历史，可重放 |

### Phase 4: 测试 (P0, 1 天)

| 测试类型 | 范围 |
|---------|------|
| 单元测试 | cowork-task-runner, cowork-task-templates |
| 集成测试 | WS 消息 → runner → SubAgent 全链路 |
| E2E 测试 | Web 页面交互 → 任务执行 → 结果展示 |

---

## 八、依赖工具安装指南

用户机器上需要安装以下工具才能使用对应场景（Agent 会自动检测可用性并给出安装提示）：

| 场景 | 必需工具 | 安装命令 (Windows) | 安装命令 (macOS) |
|------|---------|-------------------|-----------------|
| 文档处理 | pandoc | `winget install pandoc` | `brew install pandoc` |
| 文档处理 | LibreOffice | `winget install LibreOffice` | `brew install --cask libreoffice` |
| 音视频 | ffmpeg | `winget install ffmpeg` | `brew install ffmpeg` |
| 数据分析 | Python + pandas | `pip install pandas matplotlib` | 同左 |
| 图片处理 | Python Pillow | `pip install Pillow` | 同左 |
| 图片 OCR | Tesseract | `winget install tesseract` | `brew install tesseract` |
| 网页抓取 | Node.js (已有) | — | — |

---

## 九、与竞品的差异

| 维度 | ChatGPT / 通用聊天 | 在线工具 (smallpdf等) | **Web Cowork** |
|------|-------------------|---------------------|---------------|
| 能否执行 | 只能给建议 | 只能做单一操作 | **实际执行，产出文件** |
| 数据隐私 | 上传到云端 | 上传到第三方 | **本机处理，不出境** |
| 灵活性 | 通用但不精 | 单一功能 | **LLM 动态生成代码** |
| 多步任务 | 需手动串联 | 不支持 | **自动流水线** |
| 实时数据 | 有网络能力 | 不支持 | **网页抓取+API调用** |
| 成本 | 付费 API | 部分收费 | **本地 LLM 免费** |

---

## 十、未来演进

### 10.1 短期 (v5.0.3.x)

- 支持 Orchestrator 多 Agent 并行模式（适合大型调研任务）
- 支持 Cowork Debate 模式（多视角审查方案）
- 模板市场 — 社区共享任务模板

### 10.2 中期 (v5.1.x)

- 定时任务集成 — 定期执行 cowork 任务（如每日报告）
- 移动端入口 — Android App 的 Cowork 页面
- MCP 工具集成 — 模板可声明所需的 MCP 服务器（复用 Skill-Embedded MCP 模式）

### 10.3 长期

- 工作流编排 — 可视化拖拽构建复杂流水线
- 多用户协作 — P2P 共享任务模板和执行结果
- 学习进化 — Agent 从历史执行中学习优化策略

---

## 实施记录

### 2026-04-13 — 初版实现

**已完成模块**:

| 层 | 文件 | 说明 |
|---|------|------|
| 后端模板 | `packages/cli/src/lib/cowork-task-templates.js` | 10 任务模板 + OPEN_SOURCE_FIRST_PROMPT + 自动安装规则 |
| 后端运行器 | `packages/cli/src/lib/cowork-task-runner.js` | runCoworkTask() → SubAgentContext.create() → run() |
| WS 处理器 | `packages/cli/src/gateways/ws/action-protocol.js` | handleCoworkTask() — cowork:started / cowork:done |
| WS 路由 | `packages/cli/src/gateways/ws/message-dispatcher.js` | "cowork-task" 路由注册 |
| WS 服务器 | `packages/cli/src/gateways/ws/ws-server.js` | _handleCoworkTask() 委托 |
| 前端页面 | `packages/web-panel/src/views/Cowork.vue` | 模板选择 + 消息展示 + 文件拖放 |
| 前端 Store | `packages/web-panel/src/stores/cowork.js` | execute() + executeDirectWs() 双通道 |
| 前端路由 | `packages/web-panel/src/router/index.js` | /cowork 路由 |
| 侧边栏 | `packages/web-panel/src/components/AppLayout.vue` | "日常协作"菜单项 |

**测试覆盖**:

| 文件 | 测试数 | 类型 |
|------|--------|------|
| `__tests__/unit/cowork-task-templates.test.js` | 32 | 单元 |
| `__tests__/unit/cowork-task-runner.test.js` | 36 | 单元 |
| `__tests__/unit/cowork-action-protocol.test.js` | 16 | 单元 |
| `__tests__/unit/cowork-session-extension.test.js` | 5 | 单元 |
| `__tests__/integration/cowork-task-workflow.test.js` | 17 | 集成 |
| `__tests__/e2e/cowork-task-e2e.test.js` | 21 | E2E |
| **合计** | **127** | |

**用户文档**: `docs-site/docs/chainlesschain/web-cowork.md`

### 2026-04-13 — Bug 修复: 系统提示词泄露到用户消息

**问题**: Cowork 页面执行任务时，`AUTO_INSTALL_PROMPT` (开源工具优先规则) 被拼入用户消息 `fullMessage`，导致:
1. 蓝色聊天气泡中显示大段系统提示词文本，UI 非常不友好
2. 模板指令作为 user content 发送，而非 system prompt

**修复**:

| 层 | 文件 | 变更 |
|---|------|------|
| 后端会话网关 | `ws-session-gateway.js` | `createSession()` 支持 `options.systemPromptExtension` 追加到系统提示 |
| 后端协议层 | `session-protocol.js` | `handleSessionCreate()` 透传 `message.systemPromptExtension` |
| 前端 WS | `ws.js` | `createSession()` 第三参数 `options.systemPromptExtension` |
| 前端 Chat | `chat.js` | `createSession()` 透传 options |
| 前端 Cowork | `cowork.js` | `execute()` 将模板提示词通过 `systemPromptExtension` 注入，用户消息保持干净 |

**新增测试**: `cowork-session-extension.test.js` (5 tests)

### 2026-04-14 — 10 项优化

| # | 优先级 | 优化项 | 变更摘要 |
|---|--------|--------|----------|
| 1 | P0 | XSS 修复 | Cowork.vue 引入 DOMPurify 对 marked 输出做 sanitize |
| 2 | P3d | Emoji → Icon | 替换 🔧 为 `<ToolOutlined />` 组件 |
| 3 | P2c | isRunning 同步 | cowork.js 增加 `watch(chatStore.isLoading)` 重置 isRunning |
| 4 | P3c | 文件路径验证 | cowork-task-runner.js 在启动前校验 files 是否存在 |
| 5 | P3b | Token 统计 | cowork:done 增加 tokenCount；Cowork.vue 显示统计标签 |
| 6 | P1a | 实时进度 | SubAgentContext 增加 onProgress 回调；action-protocol 发送 cowork:progress |
| 7 | P1b | 任务取消 | AbortController + cowork-cancel WS 消息；signal 透传到 SubAgentContext |
| 8 | P2a | 模板去重 | 后端新增 `getTemplatesForUI()` + cowork-templates WS 消息；前端改为 `loadTemplates()` |
| 9 | P3a | 重试机制 | cowork.js 增加 `lastRequest` ref + `retry()` action；错误消息显示重试按钮 |
| 10 | P2b | 任务历史 | JSONL 持久化到 `.chainlesschain/cowork/history.jsonl`；cowork-history WS API；侧边栏历史面板 |

**新增 WS 消息类型**:

| 消息类型 | 方向 | 说明 |
|----------|------|------|
| `cowork:progress` | Server → Client | 实时进度事件 (tool-executing 等) |
| `cowork:cancelled` | Server → Client | 任务已取消确认 |
| `cowork-cancel` | Client → Server | 取消运行中的 cowork 任务 |
| `cowork-templates` | Client → Server | 请求模板列表 |
| `cowork:templates` | Server → Client | 返回 UI 模板数组 |
| `cowork-history` | Client → Server | 请求任务历史 |
| `cowork:history` | Server → Client | 返回 JSONL 历史条目 |

**测试更新**:

| 文件 | 新测试数 | 总测试数 |
|------|----------|----------|
| `cowork-task-templates.test.js` | +5 (getTemplatesForUI) | 32 |
| `cowork-task-runner.test.js` | +3 (history persistence) | 36 |
| `cowork-action-protocol.test.js` | +7 (cancel, signal, trackingId, progress, tokenCount) | 16 |
| `cowork-task-workflow.test.js` | +6 (cancel, progress, templates, history, persistence, tokenCount) | 17 |
| `cowork-task-e2e.test.js` | +10 (dispatcher routes, export verification) | 21 |
| **合计** | **+31** | **122 (84 unit + 17 integration + 21 E2E)** |
