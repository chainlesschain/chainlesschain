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

- **10 类任务模板**: 文档格式转换、音视频处理、数据分析、信息检索、图片处理、代码辅助、系统运维、文件整理、网络工具、学习辅助
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
│    Agent Session (agentLoop + 13 Tools)           │
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

## 10 类任务模板

| 模板 ID | 名称 | 分类 | 支持文件 | 核心工具 |
|---------|------|------|----------|---------|
| `doc-convert` | 文档格式转换 | document | 是 | pandoc, LibreOffice, Ghostscript |
| `media-process` | 音视频处理 | media | 是 | ffmpeg, yt-dlp |
| `data-analysis` | 数据分析 | data | 是 | pandas, matplotlib, jq |
| `web-research` | 信息检索与调研 | research | 否 | curl, requests, BeautifulSoup |
| `image-process` | 图片处理 | media | 是 | ImageMagick, Tesseract, Pillow |
| `code-helper` | 代码辅助 | development | 是 | Python, Node.js, Bash |
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
| `__tests__/e2e/cowork-task-e2e.test.js` | 21 | E2E 测试 |
| **合计** | **139** | |

## 当前验证

- 单元测试: `101/101` 通过
- 集成测试: `17/17` 通过
- E2E 测试: `21/21` 通过
- 回归测试 (agent-core + action-protocol): `127/127` 通过
- Web Panel 构建: 通过

## 演进路线图

### 短期 (v5.0.3.x)

| 功能 | 说明 |
|------|------|
| **F1: Orchestrator 并行模式** | 大型调研任务可选多 Agent 并行执行，自动拆分子任务分配给不同 AI 后端 |
| **F2: Debate 方案审查** | 提交代码/方案后，多个 Agent 从性能/安全/可维护性等视角并行审查，输出综合评审报告 |
| **F3: 模板市场** | 通过 EvoMap Hub 搜索、下载、发布社区共享的 Cowork 任务模板 |

### 中期 (v5.1.x)

| 功能 | 说明 |
|------|------|
| **F4: 定时任务** | 配置 cron 表达式定期自动执行 Cowork 任务（如每日报告、每周清理） |
| **F5: 移动端入口** | Android App 增加"日常协作"页面，通过 P2P Bridge 连接 CLI 后端执行任务 |
| **F6: MCP 工具集成** | 模板可声明所需 MCP 服务器（如 SQLite、GitHub），任务执行时自动挂载 |

### 长期 (v5.2.x)

| 功能 | 说明 |
|------|------|
| **F7: 工作流编排** | 可视化拖拽构建多步骤 DAG 流水线，stage 间自动传递数据 |
| **F8: P2P 多用户协作** | 通过 P2P 加密网络与团队成员共享模板和执行结果 |
| **F9: 学习进化** | 系统自动分析执行历史，优化模板提示词和工具选择策略 |

详细实施计划见 [设计文档 §十](/design/modules/86-web-cowork#十、未来演进-—-9-项详细实施计划)。

## 相关文档

- [多智能体协作](/chainlesschain/cowork)
- [协作高级功能](/chainlesschain/cowork-advanced)
- [Web 管理界面](/chainlesschain/cli-ui)
- [WebSocket 服务](/chainlesschain/cli-serve)
- [技能系统](/chainlesschain/skills)
- [CLI-Anything](/chainlesschain/cli-cli-anything)
- [设计文档: Web Cowork 日常任务协作](/design/modules/86-web-cowork)
