# Web Cowork 日常任务协作

> `/#/cowork` 页面 — Web Panel 内置的日常任务协作入口，基于 Code Agent 循环调用模式，优先使用开源工具自动完成文档处理、音视频处理、数据分析等 10 类日常任务。

## 概述

Web Cowork 是 ChainlessChain Web Panel 的日常任务协作模块。它的目标是让普通用户通过简单描述需求，由 AI Agent 自动选择工具、安装缺失依赖、执行多步操作，完成各类日常任务。

它适合以下场景：

- 把 Word 文档批量转换为 PDF
- 压缩视频到指定大小、提取音频
- 分析 CSV/Excel 数据并生成图表
- 批量压缩图片、OCR 文字识别
- 编写自动化脚本
- 查看系统磁盘使用、进程排查
- 抓取网页内容、调试 API 接口

## 核心特性

- **11 类任务模板**: 文档格式转换、音视频处理、数据分析、信息检索、图片处理、代码辅助、**代码评审**（v0.46.0 新增）、系统运维、文件整理、网络工具、学习辅助
- **自由模式**: 不选模板也能处理任意任务
- **开源工具优先**: 优先使用 ffmpeg、pandoc、ImageMagick、Tesseract 等开源 CLI 工具
- **cli-anything 桥接**: 已注册的 cli-anything 技能可通过自然语言调用
- **自动安装**: 缺失工具自动通过 winget/choco/pip/npm 安装，无需用户手动操作
- **文件拖放**: 支持拖放文件到任务区域
- **实时进度**: 通过 WebSocket 实时展示 Agent 执行过程 (cowork:progress)
- **任务取消**: 支持取消运行中的 Direct WS 任务 (AbortSignal)
- **Token 统计**: 任务完成后显示 iteration/token/tools 统计
- **任务重试**: 失败任务可一键重试
- **任务历史**: JSONL 持久化已完成任务，侧边栏可展开查看
- **模板去重**: 前端模板由后端 `getTemplatesForUI()` 提供，单一数据源
- **XSS 防护**: v-html 输出经 DOMPurify 过滤

## 系统架构

```
浏览器 (/#/cowork)
    │
    ├── Cowork.vue (任务模板 + 消息展示 + 文件拖放)
    ├── cowork.js store (状态管理, 双通道执行)
    │
    ▼ WebSocket
┌──────────────────────────────────────────────────┐
│  通道 A: Agent 会话模式 (推荐, 流式输出)         │
│    session-create + systemPromptExtension         │
│         │  (模板提示词注入系统提示，不污染用户消息) │
│         ▼                                        │
│    ws-session-gateway.js                          │
│      buildSystemPrompt() + extension              │
│         │                                        │
│         ▼                                        │
│    Agent Session (agentLoop + 16 Tools)           │
│                                                  │
│  通道 B: 直接 WS 模式 (一次性任务)              │
│    type: "cowork-task" → action-protocol.js       │
│         → cowork-task-runner.js                   │
│           → SubAgentContext + agentLoop            │
└──────────────────────────────────────────────────┘
```

### 工具优先级

```
cli-anything 已注册技能 (run_skill)
        ↓ 不存在
直接调用开源工具 CLI (run_shell)
        ↓ 未安装 → 自动安装 → 注册 cli-anything
Python/Node 开源库 (run_code)
        ↓ 无法解决
告知用户
```

### 自动安装链

```
winget install <id> --accept-package-agreements (Windows)
        ↓ 失败
choco install <pkg> -y (Windows 备选)
        ↓ 失败
brew install <pkg> (macOS)
        ↓ 失败
pip install <pkg> / npm install -g <pkg>
        ↓ 失败
告知用户手动安装
```

## 使用示例

### 启动 Web Cowork

```bash
chainlesschain ui
# 浏览器访问 http://localhost:18810/#/cowork
```

### 文档格式转换

1. 点击"文档格式转换"模板
2. 拖放文件到文件区域（或直接输入文件路径）
3. 输入: `把 report.docx 转成 PDF`
4. Agent 自动: 检查 pandoc → 调用 pandoc → 返回输出文件路径

### 音视频处理

1. 选择"音视频处理"模板
2. 输入: `压缩 video.mp4 到 50MB 以内`
3. Agent 自动: 检查 ffmpeg → 计算目标码率 → 执行压缩 → 返回结果

### 数据分析

1. 选择"数据分析"模板
2. 拖放 `sales.csv`
3. 输入: `分析月度趋势并生成图表`
4. Agent 自动: 安装 pandas/matplotlib → 读取数据 → 生成图表 → 保存为 PNG

### 批量图片处理

1. 选择"图片处理"模板
2. 输入: `批量压缩当前目录所有 jpg 到 500KB 以内`
3. Agent 自动: 检查 ImageMagick → 批量执行 mogrify → 报告处理结果

### 自由模式

不选择任何模板，直接输入任意任务描述：

```
帮我查看 C 盘哪些文件最大，列出前 20 个
```

Agent 会根据任务内容自动选择合适的工具和方法。

## 11 类任务模板

| 模板 ID | 名称 | 分类 | 支持文件 | 核心工具 |
|---------|------|------|----------|---------|
| `doc-convert` | 文档格式转换 | document | 是 | pandoc, LibreOffice, Ghostscript |
| `media-process` | 音视频处理 | media | 是 | ffmpeg, yt-dlp |
| `data-analysis` | 数据分析 | data | 是 | pandas, matplotlib, jq |
| `web-research` | 信息检索与调研 | research | 否 | curl, requests, BeautifulSoup |
| `image-process` | 图片处理 | media | 是 | ImageMagick, Tesseract, Pillow |
| `code-helper` | 代码辅助 | development | 是 | Python, Node.js, Bash |
| `code_review` | 代码评审（v0.46.0） | development | 是 | read_file, search_files, git |
| `system-admin` | 系统运维 | system | 否 | 系统命令 |
| `file-organize` | 文件整理 | file | 否 | Python pathlib, 7-Zip |
| `network-tools` | 网络工具 | network | 否 | curl, ping, nslookup |
| `learning-assist` | 学习辅助 | learning | 是 | pandoc, pdfplumber, Tesseract |

## 常用开源工具速查

| 工具 | winget ID | 用途 |
|------|-----------|------|
| ffmpeg | Gyan.FFmpeg | 音视频处理 |
| pandoc | JohnMacFarlane.Pandoc | 文档格式转换 |
| LibreOffice | TheDocumentFoundation.LibreOffice | Office 文档 |
| Tesseract | UB-Mannheim.TesseractOCR | OCR 文字识别 |
| ImageMagick | ImageMagick.ImageMagick | 图片处理 |
| Ghostscript | ArtifexSoftware.GhostScript | PDF 处理 |
| 7-Zip | 7zip.7zip | 压缩解压 |
| GraphViz | Graphviz.Graphviz | 图表生成 |
| yt-dlp | yt-dlp.yt-dlp | 视频下载 |
| jq | jqlang.jq | JSON 处理 |

## WebSocket 协议

### 请求

```json
{
  "type": "cowork-task",
  "id": "req-1",
  "templateId": "doc-convert",
  "userMessage": "把 report.docx 转成 PDF",
  "files": ["/path/to/report.docx"]
}
```

### 响应

```json
// 任务开始
{
  "id": "req-1",
  "type": "cowork:started",
  "templateId": "doc-convert",
  "trackingId": "cowork-req-1"
}

// 实时进度 (可多次)
{
  "id": "req-1",
  "type": "cowork:progress",
  "event": "tool-executing",
  "tool": "run_shell",
  "iterationCount": 2,
  "tokenCount": 500
}

// 任务完成
{
  "id": "req-1",
  "type": "cowork:done",
  "taskId": "sub-abc123",
  "status": "completed",
  "templateId": "doc-convert",
  "templateName": "文档格式转换",
  "summary": "文件已转换为 PDF，输出路径: /path/to/report.pdf",
  "artifacts": [],
  "toolsUsed": ["run_shell", "read_file"],
  "iterationCount": 5,
  "tokenCount": 1200
}

// 取消请求
{ "type": "cowork-cancel", "id": "req-c", "trackingId": "cowork-req-1" }
// 取消确认
{ "id": "req-c", "type": "cowork:cancelled", "trackingId": "cowork-req-1" }

// 获取模板列表
{ "type": "cowork-templates", "id": "req-t" }
// 模板列表响应
{ "id": "req-t", "type": "cowork:templates", "templates": [...] }

// 获取历史记录
{ "type": "cowork-history", "id": "req-h", "limit": 50 }
// 历史记录响应
{ "id": "req-h", "type": "cowork:history", "entries": [...] }
```

### 双通道执行

前端支持两种执行路径：

1. **Session 模式** (`execute()`, 推荐): 创建 Agent 会话，模板提示词通过 `systemPromptExtension` 注入系统提示，用户消息保持干净。支持流式输出、工具调用可视化、追问
2. **Direct WS 模式** (`executeDirectWs()`): 直接发送 `cowork-task` 消息，后端一次性返回结果

### Session 模式 systemPromptExtension

Session 模式在创建会话时通过 `session-create` 消息的 `systemPromptExtension` 字段注入模板提示词：

```json
{
  "type": "session-create",
  "sessionType": "agent",
  "systemPromptExtension": "## 开源工具优先 + 自动安装规则\n..."
}
```

这样模板指令成为系统提示的一部分，不会显示在用户聊天气泡中。

## 故障排查

### 1. 工具自动安装失败

**症状**: Agent 报告 "winget install failed" 或类似错误

**排查步骤**:
- 检查 winget 是否已安装: `winget --version`
- 检查网络连接是否正常
- 尝试手动安装: `winget install Gyan.FFmpeg --accept-package-agreements`
- 备选: 使用 choco 安装 `choco install ffmpeg -y`

### 2. Agent 执行超时

**症状**: 任务长时间无响应

**排查步骤**:
- 检查 LLM Provider 是否正常: `chainlesschain llm test`
- 检查 Ollama 服务: `curl http://localhost:11434/api/tags`
- 增大 token budget 或 iteration limit

### 3. 文件路径无法识别

**症状**: Agent 报告文件不存在

**排查步骤**:
- 确认使用绝对路径
- Windows 路径使用正斜杠 `/` 或双反斜杠 `\\`
- 检查文件权限

### 4. WebSocket 连接失败

**症状**: 页面显示 "WebSocket 未连接"

**排查步骤**:
- 确认 `chainlesschain serve` 正在运行
- 检查端口 18800 是否被占用: `netstat -ano | findstr :18800`
- 检查防火墙设置

### 5. OCR 识别结果不准确

**症状**: Tesseract 输出乱码或缺字

**排查步骤**:
- 确认安装了中文语言包: `tesseract --list-langs`
- 安装中文包: 下载 `chi_sim.traineddata` 到 tessdata 目录
- 图片预处理: 提高分辨率、增强对比度

## 安全考虑

- **工具安装**: 仅从官方源安装工具（winget/choco/pip/npm），不执行来源不明的安装脚本
- **文件访问**: Agent 通过 SubAgentContext 隔离执行，不会访问任务范围外的文件
- **网络请求**: 信息检索类任务仅访问用户指定的 URL，遵守 robots.txt
- **命令执行**: run_shell 工具受 coding-agent-policy 约束，禁止危险命令（rm -rf /、格式化磁盘等）
- **自动安装**: 安装命令使用 `--accept-package-agreements` 避免交互式提示，但不会安装来源不明的软件
- **Token 预算**: 每个任务有 token budget 限制（默认 100K），防止失控消耗

## 关键文件

### 后端

| 文件 | 说明 |
|------|------|
| `packages/cli/src/lib/cowork-task-templates.js` | 10 任务模板定义 + 共享提示词 |
| `packages/cli/src/lib/cowork-task-runner.js` | Pipeline 控制器，创建 SubAgentContext 执行任务 |
| `packages/cli/src/gateways/ws/action-protocol.js` | WS 消息处理器 `handleCoworkTask()` |
| `packages/cli/src/gateways/ws/message-dispatcher.js` | 路由 `cowork-task` 消息类型 |
| `packages/cli/src/gateways/ws/ws-server.js` | WS 服务器 `_handleCoworkTask()` 方法 |
| `packages/cli/src/gateways/ws/session-protocol.js` | `systemPromptExtension` 透传 |
| `packages/cli/src/gateways/ws/ws-session-gateway.js` | 系统提示拼接 `systemPromptExtension` |
| `packages/cli/src/lib/sub-agent-context.js` | SubAgentContext 隔离执行上下文 |

### 前端

| 文件 | 说明 |
|------|------|
| `packages/web-panel/src/views/Cowork.vue` | 任务协作页面组件 |
| `packages/web-panel/src/stores/cowork.js` | Pinia 状态管理 + loadTemplates/loadHistory |
| `packages/web-panel/src/router/index.js` | `/cowork` 路由 |
| `packages/web-panel/src/components/AppLayout.vue` | 侧边栏"日常协作"入口 |

### 测试

| 文件 | 测试数 | 类型 |
|------|--------|------|
| `__tests__/unit/cowork-task-templates.test.js` | 32 | 单元测试 |
| `__tests__/unit/cowork-task-runner.test.js` | 36 | 单元测试 |
| `__tests__/unit/cowork-action-protocol.test.js` | 16 | 单元测试 |
| `__tests__/unit/cowork-session-extension.test.js` | 7 | 单元测试 |
| `__tests__/unit/coding-agent-shell-policy.test.js` | 10 | 单元测试 (含 overrides) |
| `__tests__/integration/cowork-task-workflow.test.js` | 17 | 集成测试 |
| `__tests__/integration/cowork-workflow-ws-integration.test.js` | 5 | 集成测试 (N1) |
| `__tests__/e2e/cowork-task-e2e.test.js` | 21 | E2E 测试 |
| `__tests__/e2e/cowork-workflow-ws-e2e.test.js` | 8 | E2E 测试 (N1) |
| `__tests__/unit/cowork-workflow-ws.test.js` | 10 | 单元测试 (N1 后端) |
| `web-panel/__tests__/unit/workflow-store.test.js` | 16 | 单元测试 (N1 前端) |
| **合计** | **178** | |

## 当前验证

- 单元测试: `127/127` 通过 (含 N1 后端 10 + 前端 16)
- 集成测试: `22/22` 通过 (含 N1 5)
- E2E 测试: `29/29` 通过 (含 N1 8)
- 回归测试 (agent-core + action-protocol): `127/127` 通过
- Web Panel 构建: 通过

## N1: Workflow 可视化编辑器（v0.47.0）

Web Panel 新增 `/#/workflow` 页面，提供基于表单的 Cowork Workflow CRUD + 运行 UI。

### 核心能力

- **列表 + 编辑表单** — 左列工作流列表，右列 ID/名称/描述 + 步骤编辑器（dependsOn 标签、`${step.<id>.summary}` 占位、`when` 条件）
- **本地环检测** — `validateLocal()` 通过 DFS 三色标记复核 dependsOn，与后端 `validateWorkflow` 同步
- **运行日志流** — 订阅 `workflow:started` / `workflow:step-start` / `workflow:step-complete` / `workflow:done` 并实时渲染
- **导出 JSON** — 一键下载当前工作流定义

### WebSocket 协议

| 请求 type | 响应 type | 说明 |
|-----------|-----------|------|
| `workflow-list` | `workflow:list` | 返回所有 `workflows[]` |
| `workflow-get` (id) | `workflow:get` | 返回 `workflow` 对象，未找到为 `null` |
| `workflow-save` (workflow) | `workflow:save` | `saved: true, workflowId`；校验失败返回 `error` + `WORKFLOW_INVALID` |
| `workflow-remove` (id) | `workflow:remove` | `removed: true/false` |
| `workflow-run` (id) | `workflow:started` → `step-start` → `step-complete` → `workflow:done` | 流式事件；未找到返回 `error` + `WORKFLOW_NOT_FOUND` |

### 关键文件

| 文件 | 说明 |
|------|------|
| `packages/cli/src/gateways/ws/action-protocol.js` | 5 个 handler (`handleWorkflow*`) |
| `packages/cli/src/gateways/ws/message-dispatcher.js` | 路由注册 |
| `packages/cli/src/lib/cowork-workflow.js` | CRUD + 执行引擎（v0.46.0 复用） |
| `packages/web-panel/src/stores/workflow.js` | Pinia store + `validateLocal` |
| `packages/web-panel/src/views/WorkflowEditor.vue` | 表单编辑器视图 |

> **M2 规划**: Vue Flow 可视化画布（drag-to-connect、缩略图、分支渲染）作为独立里程碑跟进，不阻塞 v0.47.0 发布。

## 演进路线（F1–F9 全部落地 · v0.46.0）

> **状态**: ✅ 9 项能力已在 v0.46.0 全部实现并随 v0.47.x 持续打磨
> **落地顺序**: F3 → F4 → F6 → F9 → F7 → F5 → F8 → F1 → F2
> **完整设计溯源**: [设计文档 §十](/design/modules/86-web-cowork#十、历史规划-—-f1f9-详细实施计划已全部落地-v0-46-0)

### 总览

| # | 功能 | 状态 | 落地版本 | 入口 |
|---|------|------|---------|------|
| F1 | Orchestrator 并行模式 | ✅ | v0.46.0 | `cowork-task` WS + `parallel: true` |
| F2 | Debate 方案审查 | ✅ | v0.46.0 | `chainlesschain cowork debate <file>` |
| F3 | 模板市场（EvoMap） | ✅ | v0.46.0 | `chainlesschain cowork template` 子命令 |
| F4 | 定时任务 | ✅ | v0.46.0 | `chainlesschain cowork cron` 子命令 |
| F5 | 移动端入口 | ✅ | v0.46.0 | Android `pc-cowork-daily` / `pc-cowork-workflow` 远端技能 |
| F6 | MCP 工具集成 | ✅ | v0.46.0 | 模板 `mcpServers` 字段自动挂载 |
| F7 | 工作流编排（DAG） | ✅ | v0.46.0 | `chainlesschain cowork workflow` + Web 编辑器（v0.47.0） |
| F8 | P2P 多用户协作 | ✅ | v0.46.0 | `chainlesschain cowork share` 子命令 |
| F9 | 学习进化 | ✅ | v0.46.0 | `chainlesschain cowork learning` 子命令 |

---

### F1: Orchestrator 并行模式

**能力**: 大型调研 / 多文件批处理任务可启用多 Agent 并行执行，Orchestrator 自动拆分子任务、分配给不同 AI 后端、聚合结果。

**启用方式**:

- 模板级开关：`cowork-task-templates.js` 中 `web-research` / `data-analysis` 默认 `parallelStrategy: "auto"`
- 会话级覆盖：WS `cowork-task` 消息追加 `parallel: true`，`agents: 3`（上限 10）

**WebSocket 事件**:

| 事件 | 说明 |
|------|------|
| `cowork:agent-progress` | 单 Agent 的 `{ agentIndex, status, tool, iteration }` |
| `cowork:subtask-done` | 子任务完成 `{ subtaskIndex, summary, artifacts }` |

**关键文件**: `cowork-task-runner.js` (`runCoworkTaskParallel`)、`action-protocol.js` (`handleCoworkTask`)、`web-panel/stores/cowork.js`。

---

### F2: Debate 方案审查

**能力**: 多 Agent 从 `performance / security / maintainability / cost / ux` 等视角并行审查代码或方案，仲裁者 LLM 输出综合裁定（通过 / 有风险 / 建议修改）。

**CLI 入口**:

```bash
chainlesschain cowork debate <file>                  # 默认 5 视角
chainlesschain cowork debate <file> --perspectives security,performance
chainlesschain cowork compare "实现两套方案并对比"    # A/B Compare 子模式
```

**Web 入口**: `/#/cowork` 选择「代码评审（debate-review）」模板 → 审查结果分栏展示各视角评审 + 顶部裁定高亮。

**关键文件**: `cowork/debate-review-cli.js`（含 A/B Compare）、`cowork-task-templates.js` 第 11 号模板。

---

### F3: 模板市场（EvoMap）

**能力**: 发布 / 搜索 / 下载 / 安装 / 卸载社区共享的 Cowork 任务模板；模板作为 EvoMap Gene 的 `category: "cowork-template"` 子类。

**CLI 入口**:

```bash
chainlesschain cowork template search <query>        # 搜索
chainlesschain cowork template install <geneId>      # 安装
chainlesschain cowork template list                  # 已装模板
chainlesschain cowork template remove <id>           # 卸载
chainlesschain cowork template publish <templateId>  # 发布
```

**本地目录**: `~/.chainlesschain/cowork/community-templates/*.json`

**安全**: 社区模板不允许声明 `shellPolicyOverrides`，仅内置模板可放行危险命令。

**关键文件**: `cowork-template-marketplace.js`、`cowork-evomap-adapter.js`、`action-protocol.js` (`handleCoworkMarket`)。

---

### F4: 定时任务（Cron）

**能力**: 通过 cron 表达式周期性执行 Cowork 任务（日报 / 周清理 / 定时同步），持久化 + 重启自动恢复。

**CLI 入口**:

```bash
chainlesschain cowork cron list                      # 列出全部
chainlesschain cowork cron add                       # 交互式添加
chainlesschain cowork cron enable <id>               # 启用
chainlesschain cowork cron disable <id>              # 禁用（保留记录）
chainlesschain cowork cron remove <id>               # 删除
chainlesschain cowork cron run                       # 前台启动调度器
```

**持久化**: `~/.chainlesschain/cowork/cron-jobs.json`；最短间隔 5 分钟。

**事件**: 任务到点执行时广播 `cowork:cron-result` 给在线客户端。

**关键文件**: `cowork-cron.js`、`ws-server.js` (`loadPersisted` 启动钩子)。

---

### F5: 移动端入口（Android 远端技能）

**能力**: Android App 通过 `RemoteSkillProvider` / P2PClient 桥接 CLI 后端，直接执行桌面端的 Cowork 任务与工作流 —— 无需新增 Android 业务代码。

**远端技能**:

| 技能 | 映射桌面端 | 说明 |
|------|-----------|------|
| `pc-cowork-daily` | `cowork-daily` | 选模板 / 自由模式执行单次任务，支持附件 |
| `pc-cowork-workflow` | `cowork-workflow` | 按 id 执行已保存的 DAG 工作流 |

**来源**: `android-app/feature-ai/src/main/assets/skills/pc-cowork-*.md`（SKILL.md 声明 REMOTE，SkillLoader 在 App 启动时加载），Android 内置技能 28 → 30。

---

### F6: MCP 工具集成

**能力**: Cowork 模板可声明所需 MCP 服务器，任务启动时自动 mount、结束自动 unmount；复用技能内嵌 MCP 模式（skill-mcp.js）。

**模板声明**:

```json
{
  "id": "data-analysis",
  "mcpServers": [
    { "name": "sqlite", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-sqlite"] }
  ]
}
```

**默认绑定**: `data-analysis` → sqlite、`web-research` → fetch、`doc-convert` → filesystem。

**安全**: `getTemplatesForUI()` 仅返回 MCP 服务器名称列表，不泄露 `command/args`；mount 失败降级为无 MCP 模式，不阻塞任务。

**关键文件**: `cowork-mcp-tools.js`、`cowork-task-runner.js`（runCoworkTask 的 mount/unmount 包裹）。

---

### F7: 工作流编排（DAG）

**能力**: 将多个 Cowork 模板串联为 DAG 工作流，stage 间通过 `${step.<id>.summary}` / `${step.<id>.artifacts}` 占位符传递数据；支持 `when` 条件与可视化编辑。

**CLI 入口**:

```bash
chainlesschain cowork workflow list                  # 列表
chainlesschain cowork workflow show <id>             # 查看定义
chainlesschain cowork workflow add <file.json>      # 从 JSON 导入
chainlesschain cowork workflow remove <id>           # 删除
chainlesschain cowork workflow run <id>              # 端到端执行
```

**Web 编辑器 (v0.47.0 · N1)**: `/#/workflow` 提供列表 + 表单式编辑器 + 本地环检测（`validateLocal`）+ 运行日志流；详见上文「N1: Workflow 可视化编辑器」。

**关键文件**: `cowork-workflow.js`（引擎）、`web-panel/src/views/WorkflowEditor.vue`、`web-panel/src/stores/workflow.js`。

---

### F8: P2P 多用户协作（签名共享包）

**能力**: 将模板或任务结果导出为带 DID 签名的共享包，通过 P2P/文件方式传递；接收方可校验来源后再安装 / 导入。

**CLI 入口**:

```bash
chainlesschain cowork share export-template <id>          # 导出模板为签名包
chainlesschain cowork share export-result <taskId>        # 导出历史结果
chainlesschain cowork share import <file>                 # 导入（安装前校验）
chainlesschain cowork share verify <file>                 # 仅校验 checksum + 签名
```

**包结构**: `{ type, from (did:key:...), payload, signature, checksum }`；结果包仅含 `summary + artifacts` 元数据，不泄露完整 LLM 对话。

**关键文件**: `cowork-share.js`。

---

### F9: 学习进化

**能力**: 分析 `history.jsonl` 执行记录，按模板聚合成功率 / token / 工具频率 / 失败模式，给出 `systemPromptExtension` 优化补丁，人工确认后应用到 `user-templates` 层（不覆盖内置模板）。

**CLI 入口**:

```bash
chainlesschain cowork learning stats                           # 每模板聚合统计
chainlesschain cowork learning recommend <message...>          # 新消息模板推荐
chainlesschain cowork learning failures                        # 失败分组 + 共性摘要
chainlesschain cowork learning suggest                         # 生成提示词补丁建议
chainlesschain cowork learning apply <templateId>              # 确认后落地到 user-templates
```

**学习维度**: 成功率、Token 效率、工具频率 Top-5、重试 / 取消率、执行耗时。

**隐私**: 学习数据仅本地存储，不上传 EvoMap；最小样本 10 次才产出建议。

**关键文件**: `cowork-learning.js`、`trajectory-store.js`（新增 `cowork` 来源类型）、`reflection-engine.js`。

---

### 观测与报告（v0.46.0 附加）

F1–F9 所依赖的执行轨迹同时驱动观测面板：

```bash
chainlesschain cowork observe report           # 聚合报告（默认）
chainlesschain cowork observe serve            # 只读 HTTP 仪表盘
```

**关键文件**: `cowork-observe.js`、`cowork-observe-html.js`。

---

### 后续演进

v0.46.0 之后的新方向已另行规划为 N1–N7，见上文「[N1: Workflow 可视化编辑器](#n1-workflow-可视化编辑器-v0-47-0)」与 [设计文档 §十一](/design/modules/86-web-cowork#十一、未来演进v0-46-0-之后)。

## 相关文档

- [多智能体协作](/chainlesschain/cowork)
- [协作高级功能](/chainlesschain/cowork-advanced)
- [Web 管理界面](/chainlesschain/cli-ui)
- [WebSocket 服务](/chainlesschain/cli-serve)
- [技能系统](/chainlesschain/skills)
- [CLI-Anything](/chainlesschain/cli-cli-anything)
- [设计文档: Web Cowork 日常任务协作](/design/modules/86-web-cowork)
