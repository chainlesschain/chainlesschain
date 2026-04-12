# Skills 技能系统

> **版本: v5.0.1 | 138内置技能 | Agent Skills开放标准 | 统一工具注册表**

Skills 系统提供 138 个内置技能，使用 Markdown 定义技能(SKILL.md)，支持四层加载、Agent Skills 开放标准(13扩展字段)、门控检查和自定义命令。v1.2.1 研究社区技能生态补充6个高频技能(brainstorming/debugging-strategies/api-design/frontend-design/create-pr/doc-coauthoring)，Handler 覆盖率 138/138 (100%)。

## 概述

Skills 技能系统是 ChainlessChain AI 引擎的核心能力扩展框架，通过 SKILL.md Markdown 格式定义技能的提示词、工具集、参数和门控检查。系统内置 138 个技能覆盖开发、测试、安全、DevOps 等 18 个类别，采用四层加载机制（workspace > managed > marketplace > bundled）支持优先级覆盖，并通过统一工具注册表聚合 FunctionCaller、MCP 和 Skills 三大工具系统。

## 核心特性

- 🛠️ **138 内置技能**: 覆盖开发、测试、自动化、知识、安全、DevOps 等 18 个类别，100% Handler 覆盖
- 📄 **Markdown 技能定义**: 使用 SKILL.md 格式声明提示词、工具集、参数和门控检查
- 📦 **四层加载机制**: workspace > managed > marketplace > bundled 优先级覆盖
- 🔌 **统一工具注册表**: 聚合 FunctionCaller (60+)、MCP (8 servers)、Skills (50) 三大工具系统
- 🔒 **门控检查**: 平台、二进制依赖、环境变量和自定义检查，确保安全执行
- 🧩 **Agent Skills 标准**: 13 个扩展字段，支持技能发现、组合和远程调用

## 系统架构

```
┌──────────────────────────────────────────┐
│              Skill System                │
│  ┌─────────┐  ┌───────────┐  ┌────────┐ │
│  │ Loader  │  │ Executor  │  │ Parser │ │
│  │ (4层)   │  │ (Handler) │  │ (YAML) │ │
│  └────┬────┘  └─────┬─────┘  └───┬────┘ │
│       │             │            │       │
│  ┌────▼─────────────▼────────────▼────┐  │
│  │       Skill Registry (138)         │  │
│  └────────────────┬───────────────────┘  │
│                   │                      │
│  ┌────────────────▼───────────────────┐  │
│  │     Unified Tool Registry          │  │
│  │  FunctionCaller + MCP + Skills     │  │
│  └────────────────┬───────────────────┘  │
└───────────────────┼──────────────────────┘
                    │
       ┌────────────┼────────────┐
       │            │            │
  ┌────▼────┐ ┌────▼────┐ ┌────▼────┐
  │ Gate    │ │ IPC     │ │ Agent   │
  │ Checks  │ │ (17ch)  │ │ Skills  │
  └─────────┘ └─────────┘ └─────────┘
```

## 系统概述

### 技能是什么

技能是预定义的 AI 能力模板，封装了特定任务的：

- **提示词** - AI 的行为指导
- **工具集** - 允许使用的工具 (通过 `tools` 字段声明)
- **参数** - 可配置的选项 (通过 `input-schema` 定义)
- **门控** - 执行条件检查
- **指南** - 使用说明 (通过 `instructions` 字段)
- **示例** - 使用示例 (通过 `examples` 字段)

### 基础技能 (30)

| 类别       | 技能                     | Handler | 说明           |
| ---------- | ------------------------ | ------- | -------------- |
| **开发**   | `/code-review`           | ✅      | 代码审查       |
| **开发**   | `/git-commit`            | ✅      | 智能提交       |
| **开发**   | `/test-generator`        | ✅      | 测试生成       |
| **开发**   | `/performance-optimizer` | ✅      | 性能优化       |
| **学习**   | `/explain-code`          | ✅      | 代码解释       |
| **自动化** | `/browser-automation`    | ✅      | 浏览器自动化   |
| **自动化** | `/computer-use`          | ✅      | 桌面操作       |
| **自动化** | `/workflow-automation`   | ✅      | 工作流自动化   |
| **数据**   | `/web-scraping`          | ✅      | 网页数据抓取   |
| **数据**   | `/data-analysis`         | ✅      | 数据分析       |
| **知识**   | `/memory-management`     | ✅      | 记忆管理       |
| **知识**   | `/smart-search`          | ✅      | 智能搜索       |
| **远程**   | `/remote-control`        | ✅      | 远程控制       |
| **安全**   | `/security-audit`        | ✅      | 安全审计       |
| **DevOps** | `/devops-automation`     | ✅      | DevOps自动化   |
| **开发**   | `/repo-map`              | ✅      | 代码库结构映射 |
| **开发**   | `/refactor`              | ✅      | 多文件代码重构 |
| **文档**   | `/doc-generator`         | ✅      | 文档自动生成   |
| **测试**   | `/api-tester`            | ✅      | API/IPC测试    |
| **开发**   | `/onboard-project`       | ✅      | 项目入门分析   |
| **开发**   | `/lint-and-fix`          | ✅      | Lint自动修复   |
| **测试**   | `/test-and-fix`          | ✅      | 测试自动修复   |
| **分析**   | `/dependency-analyzer`   | ✅      | 依赖分析       |
| **数据库** | `/db-migration`          | ✅      | 数据库迁移     |
| **开发**   | `/project-scaffold`      | ✅      | 项目脚手架     |
| **DevOps** | `/env-doctor`            | ✅      | 环境诊断       |
| **知识**   | `/context-loader`        | ✅      | 智能上下文     |
| **安全**   | `/vulnerability-scanner` | ✅      | 漏洞扫描       |
| **DevOps** | `/release-manager`       | ✅      | 发布管理       |
| **开发**   | `/mcp-server-generator`  | ✅      | MCP服务器生成  |

### 高级技能 v0.36.1 (10)

| 类别     | 技能                  | Handler | 说明           |
| -------- | --------------------- | ------- | -------------- |
| **开发** | `/architect-mode`     | ✅      | 双阶段架构模式 |
| **测试** | `/bugbot`             | ✅      | 主动Bug检测    |
| **开发** | `/commit-splitter`    | ✅      | 智能提交拆分   |
| **开发** | `/diff-previewer`     | ✅      | 差异预览器     |
| **测试** | `/fault-localizer`    | ✅      | 故障定位器     |
| **分析** | `/impact-analyzer`    | ✅      | 变更影响分析   |
| **知识** | `/research-agent`     | ✅      | 技术研究代理   |
| **开发** | `/rules-engine`       | ✅      | 规则引擎       |
| **开发** | `/screenshot-to-code` | ✅      | 截图转代码     |
| **开发** | `/task-decomposer`    | ✅      | 任务分解器     |

### AI 会话增强 + 开发效率 v0.36.2 (10)

| 类别     | 技能                    | Handler | 说明           |
| -------- | ----------------------- | ------- | -------------- |
| **AI**   | `/prompt-enhancer`      | ✅      | 提示词增强     |
| **知识** | `/codebase-qa`          | ✅      | 代码库语义问答 |
| **AI**   | `/auto-context`         | ✅      | 智能上下文检测 |
| **AI**   | `/multi-model-router`   | ✅      | 多模型路由     |
| **开发** | `/code-translator`      | ✅      | 跨语言转换     |
| **开发** | `/dead-code-eliminator` | ✅      | 死代码检测     |
| **开发** | `/changelog-generator`  | ✅      | Changelog生成  |
| **开发** | `/mock-data-generator`  | ✅      | 模拟数据生成   |
| **分析** | `/git-history-analyzer` | ✅      | Git历史分析    |
| **开发** | `/i18n-manager`         | ✅      | 国际化管理     |

### Office文档 + 音视频 v0.37.3 (10)

| 类别     | 技能                  | Handler | 说明           |
| -------- | --------------------- | ------- | -------------- |
| **文档** | `/pdf-toolkit`        | ✅      | PDF处理工具箱  |
| **文档** | `/doc-converter`      | ✅      | 万能格式转换   |
| **文档** | `/excel-analyzer`     | ✅      | Excel深度分析  |
| **文档** | `/pptx-creator`       | ✅      | 演示文稿生成   |
| **文档** | `/doc-comparator`     | ✅      | 文档对比       |
| **媒体** | `/audio-transcriber`  | ✅      | 语音转文字     |
| **媒体** | `/video-toolkit`      | ✅      | 视频操作工具箱 |
| **媒体** | `/subtitle-generator` | ✅      | 字幕生成       |
| **媒体** | `/tts-synthesizer`    | ✅      | 文本转语音     |
| **媒体** | `/media-metadata`     | ✅      | 媒体元数据     |

### 图像+数据+工具 v0.37.4 (10)

| 类别       | 技能                 | Handler | 说明           |
| ---------- | -------------------- | ------- | -------------- |
| **媒体**   | `/image-editor`      | ✅      | 图片编辑处理   |
| **媒体**   | `/ocr-scanner`       | ✅      | OCR文字识别    |
| **AI**     | `/image-generator`   | ✅      | AI图像生成     |
| **数据**   | `/chart-creator`     | ✅      | 数据可视化图表 |
| **文档**   | `/word-generator`    | ✅      | Word文档生成   |
| **数据**   | `/csv-processor`     | ✅      | CSV数据处理    |
| **开发**   | `/template-renderer` | ✅      | 模板渲染引擎   |
| **开发**   | `/code-runner`       | ✅      | 安全代码执行   |
| **自动化** | `/voice-commander`   | ✅      | 语音命令管理   |
| **工具**   | `/file-compressor`   | ✅      | 文件压缩解压   |

### 开发效率+系统工具 v0.37.5 (10)

| 类别     | 技能                 | Handler | 说明           |
| -------- | -------------------- | ------- | -------------- |
| **开发** | `/json-yaml-toolkit` | ✅      | JSON/YAML处理  |
| **开发** | `/regex-playground`  | ✅      | 正则表达式工具 |
| **运维** | `/log-analyzer`      | ✅      | 日志分析       |
| **运维** | `/system-monitor`    | ✅      | 系统监控       |
| **开发** | `/http-client`       | ✅      | HTTP客户端     |
| **文档** | `/markdown-enhancer` | ✅      | Markdown增强   |
| **开发** | `/snippet-library`   | ✅      | 代码片段库     |
| **知识** | `/knowledge-graph`   | ✅      | 知识图谱       |
| **工具** | `/clipboard-manager` | ✅      | 剪贴板管理     |
| **运维** | `/env-file-manager`  | ✅      | 环境变量管理   |

### 系统+安全+设计+分析 v0.37.6 (10)

| 类别     | 技能                    | Handler | 说明           |
| -------- | ----------------------- | ------- | -------------- |
| **系统** | `/backup-manager`       | ✅      | 数据备份恢复   |
| **知识** | `/query-enhancer`       | ✅      | RAG查询优化    |
| **知识** | `/memory-insights`      | ✅      | 知识库分析     |
| **数据** | `/data-exporter`        | ✅      | 多格式数据导出 |
| **安全** | `/crypto-toolkit`       | ✅      | 加密哈希编码   |
| **运维** | `/network-diagnostics`  | ✅      | 网络诊断工具   |
| **安全** | `/password-generator`   | ✅      | 密码Token生成  |
| **工具** | `/text-transformer`     | ✅      | 文本编解码转换 |
| **设计** | `/color-picker`         | ✅      | 颜色调色板工具 |
| **运维** | `/performance-profiler` | ✅      | 性能分析基准   |

### v1.2.0 外部标准 + 实用技能 (22)

| 类别         | 技能                        | Handler | 说明                        |
| ------------ | --------------------------- | ------- | --------------------------- |
| **搜索**     | `/tavily-search`            | ✅      | Tavily API联网搜索          |
| **搜索**     | `/find-skills`              | ✅      | 技能注册表搜索发现          |
| **自动化**   | `/proactive-agent`          | ✅      | 4种自主触发器               |
| **浏览器**   | `/agent-browser`            | ✅      | 快照引用模式浏览器自动化    |
| **媒体**     | `/remotion-video`           | ✅      | React/Remotion视频创作      |
| **自动化**   | `/cron-scheduler`           | ✅      | Cron+自然语言定时调度       |
| **协作**     | `/planning-with-files`      | ✅      | Manus 3文件规划工作流       |
| **协作**     | `/content-publisher`        | ✅      | 5种内容类型发布             |
| **协作**     | `/skill-creator`            | ✅      | 元技能：创建/测试/验证技能  |
| **测试**     | `/webapp-testing`           | ✅      | 侦察-执行模式Web测试        |
| **知识**     | `/deep-research`            | ✅      | 8阶段深度研究流水线         |
| **开发**     | `/git-worktree-manager`     | ✅      | Git Worktree管理            |
| **代码审查** | `/pr-reviewer`              | ✅      | gh CLI PR审查分析           |
| **DevOps**   | `/docker-compose-generator` | ✅      | 10种服务模板Docker Compose  |
| **DevOps**   | `/terraform-iac`            | ✅      | AWS/GCP/Azure HCL生成       |
| **文档**     | `/api-docs-generator`       | ✅      | OpenAPI 3.0自动生成         |
| **知识**     | `/news-monitor`             | ✅      | HackerNews API趋势检测      |
| **知识**     | `/ultrathink`               | ✅      | 7步扩展推理框架             |
| **知识**     | `/youtube-summarizer`       | ✅      | YouTube字幕摘要+章节分段    |
| **数据库**   | `/database-query`           | ✅      | SQL生成/优化/Schema内省     |
| **DevOps**   | `/k8s-deployer`             | ✅      | K8s清单+Helm Chart+安全检查 |
| **DevOps**   | `/cursor-rules-generator`   | ✅      | 5种AI编码助手配置           |

### v1.2.0 集成与生产力技能 (10)

| 类别       | 技能                    | Handler | 说明                           |
| ---------- | ----------------------- | ------- | ------------------------------ |
| **自动化** | `/api-gateway`          | ✅      | 100+ API统一接口/链式调用      |
| **系统**   | `/free-model-manager`   | ✅      | Ollama/HuggingFace免费模型管理 |
| **开发**   | `/github-manager`       | ✅      | Issues/PR/仓库/Workflows管理   |
| **工具**   | `/google-workspace`     | ✅      | Gmail/Calendar/Drive集成       |
| **工具**   | `/humanizer`            | ✅      | 去除AI写作痕迹/语气调整        |
| **工具**   | `/notion`               | ✅      | Notion页面/数据库/内容管理     |
| **知识**   | `/obsidian`             | ✅      | Obsidian笔记/搜索/标签/双链    |
| **系统**   | `/self-improving-agent` | ✅      | 错误追踪/模式分析/自我改进     |
| **知识**   | `/summarizer`           | ✅      | URL/PDF/YouTube/文本万能摘要   |
| **工具**   | `/weather`              | ✅      | 全球天气/预报/告警             |

### v1.2.1 社区生态补充技能 (6)

| 类别     | 技能                    | Handler | 说明                                                           |
| -------- | ----------------------- | ------- | -------------------------------------------------------------- |
| **通用** | `/brainstorming`        | ✅      | 创意头脑风暴(自由思考/思维导图/SWOT/六顶帽/SCAMPER)            |
| **开发** | `/debugging-strategies` | ✅      | 系统调试策略(诊断/二分法/追踪/假设/小黄鸭/根因/红旗/防御/会话) |
| **开发** | `/api-design`           | ✅      | API设计(RESTful设计/审查/OpenAPI/版本策略/错误码)              |
| **设计** | `/frontend-design`      | ✅      | 前端设计(组件/布局/响应式/无障碍/主题)                         |
| **开发** | `/create-pr`            | ✅      | PR创建(创建/草稿/模板/Changelog)                               |
| **文档** | `/doc-coauthoring`      | ✅      | 文档协作(初稿/扩展/审查/结构重组/术语表)                       |

### Cowork协作演化 v1.0.0 (5)

| 类别     | 技能                 | Handler | 说明                                                      |
| -------- | -------------------- | ------- | --------------------------------------------------------- |
| **协作** | `/debate-review`     | ✅      | 多视角代码评审（性能/安全/可维护性）                      |
| **协作** | `/ab-compare`        | ✅      | 多智能体方案A/B对比与基准测试                             |
| **协作** | `/orchestrate`       | ✅      | 工作流编排（feature/bugfix/refactor/security-audit）      |
| **协作** | `/verification-loop` | ✅      | 验证循环（Build→TypeCheck→Lint→Test→Security→DiffReview） |
| **协作** | `/stream-processor`  | ✅      | 流式数据处理（log/csv/json逐行处理）                      |

### 安全/系统/示例技能 (4)

| 类别     | 技能                  | Handler | 说明                                                          |
| -------- | --------------------- | ------- | ------------------------------------------------------------- |
| **安全** | `/zkp-toolkit`        | ✅      | 零知识证明工具（证明生成/验证/选择性披露/ZK-Rollup/基准测试） |
| **系统** | `/handler-test-skill` | ✅      | Handler测试技能（内置开发调试/Handler契约验证用）             |
| **示例** | `/my-custom-skill`    | ✅      | 自定义技能示例（用户自定义技能参考模板）                      |
| **开发** | `/test-skill`         | ✅      | 测试技能（单元测试示例/技能框架测试用途）                     |

---

## 四层加载

### 加载优先级

```
workspace/     # 工作区技能（最高优先级）
    ↓
managed/       # 用户管理的技能
    ↓
marketplace/   # 插件市场安装的技能 (v0.34.0新增)
    ↓
bundled/       # 内置技能（138个，100% Handler覆盖，最低优先级）
```

高层技能可以覆盖低层同名技能。

### 技能目录

```
.chainlesschain/skills/          # 工作区技能
~/.chainlesschain/skills/        # 用户技能
<marketplace>/skills/            # 插件市场技能
<app>/skills/builtin/            # 内置技能 (138个)
```

---

## 技能定义格式

### Markdown 技能文件

```markdown
---
name: code-review
description: 执行代码审查，提供改进建议
version: 1.0.0
author: ChainlessChain Team
---

# Code Review 代码审查

## 门控检查

- platform: ["darwin", "linux", "win32"]
- binary: git
- env: GITHUB_TOKEN (optional)

## 参数

- `file` (required): 要审查的文件路径
- `focus` (optional): 审查重点 (security|performance|style)
- `severity` (optional): 最低报告级别 (info|warning|error)

## 工具

- Read
- Glob
- Grep

## 提示词

你是一个专业的代码审查员。请审查提供的代码，关注以下方面：

1. **代码质量** - 可读性、可维护性、命名规范
2. **潜在问题** - bug、边界情况、错误处理
3. **性能** - 算法效率、资源使用
4. **安全** - 常见漏洞、敏感信息处理
5. **最佳实践** - 设计模式、代码组织

请提供具体的改进建议，包括代码示例。
```

---

## 内置技能 CLI 执行参考

所有 138 个内置技能均可通过命令行执行，无需启动桌面应用（Headless 模式）。少数依赖桌面功能的技能会优雅降级并返回提示信息。

### 执行方式

```bash
# 方式一：通过 skill run 命令
chainlesschain skill run <技能名> "提示文本"

# 方式二：在 Agent/Chat REPL 中使用 / 前缀
chainlesschain agent
> /code-review src/index.js

# 方式三：AI 自动选择技能（Agent 模式）
chainlesschain agent
> 帮我审查 src/auth 目录的安全性   # → 自动匹配 security-audit
```

### 按分类执行示例

#### 开发 (Development)

```bash
chainlesschain skill run code-review "审查 src/auth/login.js 的安全性"
chainlesschain skill run git-commit "分析当前 diff 并生成提交消息"
chainlesschain skill run explain-code "解释 src/utils/crypto.js 的加密流程"
chainlesschain skill run test-generator "为 src/services/user.js 生成单元测试"
chainlesschain skill run refactor "重构 src/api/handler.js 提取公共方法"
chainlesschain skill run performance-optimizer "分析 src/api/ 目录的性能瓶颈"
chainlesschain skill run lint-and-fix "修复 src/ 目录的 ESLint 错误"
chainlesschain skill run test-and-fix "运行测试并自动修复失败用例"
chainlesschain skill run code-translator "将 src/utils.py 转换为 TypeScript"
chainlesschain skill run dead-code-eliminator "检测 src/ 中的未使用代码"
chainlesschain skill run changelog-generator "根据 Git 提交生成 CHANGELOG"
chainlesschain skill run mock-data-generator "根据 User 类型生成测试数据"
chainlesschain skill run i18n-manager "提取 src/ 中的硬编码中文字符串"
chainlesschain skill run repo-map "生成项目代码结构映射"
chainlesschain skill run project-scaffold "创建新的 Vue 模块脚手架"
chainlesschain skill run onboard-project "分析项目架构，生成入门指南"
chainlesschain skill run mcp-server-generator "生成天气查询 MCP 服务器"
chainlesschain skill run snippet-library "保存代码片段到本地库"
chainlesschain skill run template-renderer "使用 Handlebars 渲染邮件模板"
chainlesschain skill run code-runner "执行 Python 脚本并捕获输出"
chainlesschain skill run json-yaml-toolkit "将 config.yaml 转换为 JSON"
chainlesschain skill run regex-playground "测试正则表达式匹配结果"
chainlesschain skill run http-client "发送 GET 请求到 API 端点"
```

#### 测试与质量 (Testing & Quality)

```bash
chainlesschain skill run bugbot "扫描 src/ 中的潜在 Bug"
chainlesschain skill run fault-localizer "定位错误堆栈对应的代码位置"
chainlesschain skill run api-tester "测试 IPC 处理器的健康状态"
chainlesschain skill run webapp-testing "对 http://localhost:5173 执行 E2E 测试"
chainlesschain skill run verification-loop "执行 Build→Lint→Test→Security 验证流水线"
```

#### 架构与分析 (Architecture & Analysis)

```bash
chainlesschain skill run architect-mode "设计用户认证模块的架构方案"
chainlesschain skill run task-decomposer "将'实现支付系统'分解为子任务"
chainlesschain skill run impact-analyzer "分析修改 database.js 的影响范围"
chainlesschain skill run dependency-analyzer "分析项目的依赖关系图"
chainlesschain skill run git-history-analyzer "分析代码热点和贡献者统计"
chainlesschain skill run diff-previewer "对比 main 分支和当前分支的差异"
chainlesschain skill run commit-splitter "将大提交拆分为原子提交"
```

#### 安全 (Security)

```bash
chainlesschain skill run security-audit "审计 src/ 目录的 OWASP Top 10 漏洞"
chainlesschain skill run vulnerability-scanner "扫描 package.json 的依赖漏洞"
chainlesschain skill run crypto-toolkit "使用 AES-256-GCM 加密文件"
chainlesschain skill run password-generator "生成 32 位强密码"
chainlesschain skill run zkp-toolkit "生成零知识证明并验证"
```

#### 文档 (Documentation)

```bash
chainlesschain skill run doc-generator "为 src/main/database.js 生成 JSDoc 文档"
chainlesschain skill run api-docs-generator "生成 OpenAPI 3.0 规范文档"
chainlesschain skill run markdown-enhancer "为 README.md 添加目录和链接检查"
chainlesschain skill run doc-comparator "对比两个文档的差异"
chainlesschain skill run doc-coauthoring "扩展并审查技术文档初稿"
chainlesschain skill run doc-converter "将 report.docx 转换为 Markdown"
```

#### Office 文档与数据 (Office & Data)

```bash
chainlesschain skill run pdf-toolkit "提取 document.pdf 的文本内容"
chainlesschain skill run excel-analyzer "分析 sales.xlsx 的数据趋势"
chainlesschain skill run pptx-creator "根据大纲生成 PPTX 演示文稿"
chainlesschain skill run word-generator "将 Markdown 转换为 DOCX"
chainlesschain skill run csv-processor "过滤 data.csv 中满足条件的行"
chainlesschain skill run data-analysis "分析 data.json 的统计分布"
chainlesschain skill run chart-creator "生成销售数据的柱状图"
chainlesschain skill run data-exporter "将 JSON 数据导出为 CSV 格式"
```

#### 音视频与媒体 (Media)

```bash
chainlesschain skill run audio-transcriber "将 meeting.mp3 转为文字"
chainlesschain skill run video-toolkit "提取视频的缩略图和元信息"
chainlesschain skill run subtitle-generator "为视频生成 SRT 字幕"
chainlesschain skill run tts-synthesizer "将文本转换为语音文件"
chainlesschain skill run media-metadata "提取图片的 EXIF 元数据"
chainlesschain skill run image-editor "将图片压缩为 WebP 格式"
chainlesschain skill run ocr-scanner "识别图片中的文字内容"
chainlesschain skill run image-generator "根据描述生成 AI 图像"
chainlesschain skill run remotion-video "使用 React 创作动画视频"
```

#### 知识与搜索 (Knowledge & Search)

```bash
chainlesschain skill run smart-search "搜索项目中与认证相关的代码"
chainlesschain skill run memory-management "保存今天的学习笔记"
chainlesschain skill run deep-research "深入研究 WebAssembly 技术方案"
chainlesschain skill run codebase-qa "这个项目的数据库 Schema 是怎么设计的？"
chainlesschain skill run knowledge-graph "提取项目实体关系图"
chainlesschain skill run memory-insights "分析知识库的健康状态"
chainlesschain skill run query-enhancer "优化 RAG 查询效果"
chainlesschain skill run context-loader "预加载与当前任务相关的上下文文件"
chainlesschain skill run research-agent "对比 React vs Vue 技术选型"
chainlesschain skill run tavily-search "搜索最新的 Node.js 安全公告"
chainlesschain skill run summarizer "摘要 https://example.com 的内容"
chainlesschain skill run youtube-summarizer "摘要 YouTube 视频的关键内容"
chainlesschain skill run news-monitor "监控 HackerNews 的 AI 相关趋势"
chainlesschain skill run obsidian "在 Obsidian Vault 中创建笔记"
```

#### 自动化与工作流 (Automation & Workflow)

```bash
chainlesschain skill run workflow-automation "创建文件备份的自动化流程"
chainlesschain skill run orchestrate "编排 feature 开发工作流"
chainlesschain skill run proactive-agent "监控 src/ 目录变更并自动检测错误"
chainlesschain skill run cron-scheduler "每天 9 点自动运行测试"
chainlesschain skill run stream-processor "逐行处理 access.log 日志文件"
chainlesschain skill run planning-with-files "创建持久化的任务计划文件"
chainlesschain skill run voice-commander "注册语音命令快捷方式"
```

#### DevOps 与运维 (DevOps)

```bash
chainlesschain skill run devops-automation "配置 CI/CD 流水线"
chainlesschain skill run docker-compose-generator "自动生成 Docker Compose 配置"
chainlesschain skill run k8s-deployer "生成 Kubernetes 部署清单"
chainlesschain skill run terraform-iac "生成 AWS EC2 的 Terraform 配置"
chainlesschain skill run env-doctor "诊断开发环境的运行状态"
chainlesschain skill run release-manager "计算下一版本号并生成 Tag"
chainlesschain skill run log-analyzer "分析 app.log 中的错误模式"
chainlesschain skill run system-monitor "检查 CPU/内存/磁盘使用率"
chainlesschain skill run network-diagnostics "检测端口 8080 是否可用"
chainlesschain skill run env-file-manager "对比 .env 和 .env.example 的差异"
chainlesschain skill run performance-profiler "执行应用启动性能基准测试"
chainlesschain skill run backup-manager "创建项目数据的 ZIP 备份"
chainlesschain skill run cursor-rules-generator "生成 .cursorrules 编码规则"
```

#### AI 增强 (AI Enhancement)

```bash
chainlesschain skill run prompt-enhancer "增强提示词：帮我写一个排序算法"
chainlesschain skill run auto-context "检测当前任务所需的上下文文件"
chainlesschain skill run multi-model-router "根据复杂度自动选择最佳 LLM 模型"
chainlesschain skill run ultrathink "深度分析分布式系统的一致性问题"
chainlesschain skill run self-improving-agent "分析最近的错误模式并自我优化"
```

#### 协作 (Collaboration)

```bash
chainlesschain skill run debate-review "多视角审查 src/auth/login.js"
chainlesschain skill run ab-compare "对比两种缓存方案的优劣"
chainlesschain skill run create-pr "为当前分支创建 Pull Request"
chainlesschain skill run pr-reviewer "审查 PR #42 的代码变更"
chainlesschain skill run github-manager "列出仓库的 open Issues"
```

#### 集成与工具 (Integration & Tools)

```bash
chainlesschain skill run web-scraping "提取网页中的表格数据"
chainlesschain skill run agent-browser "使用快照模式自动化浏览网页"
chainlesschain skill run api-gateway "通过统一接口调用外部 API"
chainlesschain skill run notion "在 Notion 中创建新页面"
chainlesschain skill run google-workspace "查询 Google Calendar 日程"
chainlesschain skill run weather "查询北京今天的天气"
chainlesschain skill run find-skills "搜索与数据处理相关的技能"
chainlesschain skill run skill-creator "创建一个新的自定义技能"
chainlesschain skill run free-model-manager "列出本地 Ollama 可用模型"
chainlesschain skill run humanizer "将 AI 生成的文本改写为自然风格"
chainlesschain skill run content-publisher "生成社交媒体帖子内容"
chainlesschain skill run brainstorming "用六顶帽方法分析产品方案"
chainlesschain skill run debugging-strategies "使用二分法定位 Bug"
chainlesschain skill run api-design "设计 RESTful 用户管理 API"
chainlesschain skill run frontend-design "设计登录页面的 UI 组件"
chainlesschain skill run color-picker "生成蓝色系配色方案"
chainlesschain skill run text-transformer "Base64 编码文本内容"
chainlesschain skill run clipboard-manager "查看剪贴板历史记录"
chainlesschain skill run file-compressor "将 dist/ 目录打包为 ZIP"
chainlesschain skill run db-migration "生成数据库迁移脚本"
chainlesschain skill run database-query "生成用户查询的 SQL 语句"
chainlesschain skill run git-worktree-manager "创建并行开发的 Worktree"
```

#### 桌面专属技能 (需要桌面应用运行)

以下技能依赖 Electron 桌面功能，在 CLI Headless 模式下会优雅降级并返回提示：

```bash
# 需要桌面应用的技能
chainlesschain skill run browser-automation "自动化浏览器操作"  # → 需要 Electron 浏览器
chainlesschain skill run computer-use "桌面截图并操作"          # → 需要 DesktopAction 模块
chainlesschain skill run remote-control "远程控制设备"          # → 需要 P2P/WebRTC 连接
chainlesschain skill run screenshot-to-code "截图转代码"        # → 需要桌面截图能力
```

> **注意**: 以上技能在无桌面环境时不会崩溃，而是返回 `{ success: false, error: "Desktop action module not available." }` 等友好提示。

---

## 统一工具注册表 (v0.36.0新增)

### 概述

统一工具注册表 (UnifiedToolRegistry) 聚合三大工具系统：

| 工具系统       | 工具数    | 说明                              |
| -------------- | --------- | --------------------------------- |
| FunctionCaller | 60+       | 内置工具 (文件/代码/Git/Office等) |
| MCP            | 8 servers | 社区MCP服务器                     |
| Skills         | 50        | 内置技能Handler注册的工具         |

### 自动技能映射

- **SkillMdParser**: 解析SKILL.md中的`tools`字段，关联工具到技能
- **ToolSkillMapper**: 未覆盖工具自动分组到10个默认类别
- **MCPSkillGenerator**: MCP服务器连接时自动生成技能

### 工具浏览器

访问 `#/tools/explorer` 可以按技能分组浏览所有工具。

### IPC接口

| 处理器                      | 功能                    |
| --------------------------- | ----------------------- |
| `tools:get-all-with-skills` | 获取所有工具+技能元数据 |
| `tools:get-skill-manifest`  | 获取所有技能清单        |
| `tools:get-by-skill`        | 按技能获取工具          |
| `tools:search-unified`      | 搜索工具                |
| `tools:get-tool-context`    | 获取工具上下文          |
| `tools:refresh-unified`     | 刷新注册表              |

---

## 演示模板 (v0.36.0新增)

10个演示模板展示技能组合能力：

| 类别     | 模板            | 使用技能                                      | 难度 |
| -------- | --------------- | --------------------------------------------- | ---- |
| 自动化   | Web表单自动填充 | browser-automation, workflow-automation       | 入门 |
| 自动化   | 批量截图        | browser-automation, workflow-automation       | 入门 |
| 自动化   | 数据提取流水线  | web-scraping, workflow-automation             | 中级 |
| AI工作流 | AI研究助手      | smart-search, memory-management, web-scraping | 中级 |
| AI工作流 | 日报生成器      | memory-management, smart-search               | 入门 |
| AI工作流 | 代码审查流水线  | code-review, workflow-automation              | 中级 |
| 知识     | 个人知识库      | memory-management, smart-search               | 入门 |
| 知识     | 会议记录管理    | memory-management                             | 入门 |
| 远程     | 多设备同步      | remote-control, workflow-automation           | 中级 |
| 远程     | 远程桌面监控    | remote-control, computer-use                  | 高级 |

访问 `#/demo-templates` 浏览和运行演示模板。

---

## 门控检查

### 平台检查

```yaml
# 仅在 macOS 和 Linux 可用
- platform: ["darwin", "linux"]
```

### 二进制依赖

```yaml
# 需要安装 git
- binary: git

# 需要安装 node 和 npm
- binary: [node, npm]
```

### 环境变量

```yaml
# 必需的环境变量
- env: OPENAI_API_KEY

# 可选的环境变量
- env: GITHUB_TOKEN (optional)
```

### 自定义检查

```yaml
# 自定义检查脚本
- check: scripts/check-prerequisites.js
```

---

## 使用技能

### 命令行调用

```bash
# 基本调用
/skill-name

# 带参数
/skill-name file.js --option=value

# 多参数
/code-review src/index.js --focus=security --severity=error
```

### API 调用

```javascript
// 执行技能
const result = await skillSystem.execute("code-review", {
  file: "src/auth/login.js",
  focus: "security",
});

// 获取技能信息
const skill = await skillSystem.get("code-review");
console.log(skill.description);
console.log(skill.parameters);
```

---

## 创建自定义技能

### 1. 创建技能文件

```bash
# 在工作区创建
mkdir -p .chainlesschain/skills
touch .chainlesschain/skills/my-skill.md
```

### 2. 编写技能定义

```markdown
---
name: my-skill
description: 我的自定义技能
version: 1.0.0
---

# My Custom Skill

## 门控检查

- platform: ["darwin", "linux", "win32"]

## 参数

- `input` (required): 输入参数

## 工具

- Read
- Write
- Bash

## 提示词

你是一个专业的助手。请根据用户输入执行以下任务...
```

### 3. 测试技能

```bash
# 列出可用技能
/skills

# 执行技能
/my-skill input="test"
```

---

## 技能模板

### 文档生成技能

```markdown
---
name: generate-docs
description: 为代码生成文档
---

# Generate Documentation

## 工具

- Read
- Glob
- Write

## 提示词

分析提供的代码文件，生成详细的文档：

1. 模块概述
2. 函数/类说明
3. 参数和返回值
4. 使用示例
5. 注意事项

使用 JSDoc/TSDoc 格式生成注释。
```

### API 测试技能

```markdown
---
name: test-api
description: 测试 API 端点
---

# Test API

## 门控检查

- binary: curl

## 参数

- `url` (required): API URL
- `method` (optional): HTTP 方法 (GET|POST|PUT|DELETE)

## 工具

- Bash
- WebFetch

## 提示词

测试提供的 API 端点：

1. 发送请求
2. 分析响应
3. 验证状态码
4. 检查响应格式
5. 报告问题
```

---

## 技能管理

### 列出技能

```javascript
// 获取所有技能
const skills = await skillSystem.list();

// 按来源筛选
const bundled = await skillSystem.list({ source: "bundled" });
const workspace = await skillSystem.list({ source: "workspace" });
```

### 安装技能

```javascript
// 从 URL 安装
await skillSystem.install({
  url: "https://example.com/skills/my-skill.md",
  location: "managed", // 或 'workspace'
});

// 从本地文件安装
await skillSystem.install({
  path: "/path/to/skill.md",
  location: "workspace",
});
```

### 卸载技能

```javascript
// 卸载技能
await skillSystem.uninstall("my-skill");
```

### 更新技能

```javascript
// 更新技能
await skillSystem.update("my-skill");
```

---

## IPC 处理器

Skills 系统提供 17 个 IPC 处理器：

| 处理器              | 功能         |
| ------------------- | ------------ |
| `skills:list`       | 列出技能     |
| `skills:get`        | 获取技能详情 |
| `skills:execute`    | 执行技能     |
| `skills:install`    | 安装技能     |
| `skills:uninstall`  | 卸载技能     |
| `skills:update`     | 更新技能     |
| `skills:validate`   | 验证技能定义 |
| `skills:enable`     | 启用技能     |
| `skills:disable`    | 禁用技能     |
| `skills:getHistory` | 获取执行历史 |
| `skills:search`     | 搜索技能     |
| `skills:reload`     | 重新加载     |
| ...                 | ...          |

---

## 配置选项

```javascript
{
  "skills": {
    // 技能目录
    "directories": {
      "workspace": ".chainlesschain/skills",
      "managed": "~/.chainlesschain/skills"
    },

    // 自动加载
    "autoLoad": true,

    // 门控检查
    "gateChecks": {
      "enabled": true,
      "strict": false  // 严格模式下失败则禁用技能
    },

    // 执行限制
    "execution": {
      "timeout": 60000,  // 60秒超时
      "maxConcurrent": 3
    }
  }
}
```

---

## 最佳实践

### 1. 清晰的技能描述

```yaml
---
name: optimize-imports
description: 优化 JavaScript/TypeScript 文件的 import 语句，移除未使用的导入，排序并分组
---
```

### 2. 合理的工具限制

```markdown
## 工具

<!-- 只授予必要的工具权限 -->

- Read
- Glob
<!-- 不需要 Write，只分析不修改 -->
```

### 3. 详细的参数说明

```markdown
## 参数

- `file` (required): 要处理的文件路径
  - 支持 glob 模式
  - 示例: `src/**/*.ts`

- `style` (optional): 排序风格
  - `alphabetical`: 按字母排序（默认）
  - `grouped`: 按类型分组
```

---

## 下一步

- [Hooks系统](/chainlesschain/hooks) - 钩子扩展
- [Plan Mode](/chainlesschain/plan-mode) - 规划模式
- [Cowork系统](/chainlesschain/cowork) - 多智能体协作
- [Computer Use](/chainlesschain/computer-use) - 电脑操作能力
- [Remote Control](/chainlesschain/remote-control) - 远程控制系统

---

**138个内置技能 (100% Handler覆盖) + Agent Skills标准 + 统一工具注册表** 🛠️

## 关键文件

| 文件 | 职责 | 行数 |
| --- | --- | --- |
| `src/main/ai-engine/cowork/skill-system.js` | 技能系统核心引擎 | ~500 |
| `src/main/ai-engine/cowork/skill-loader.js` | 四层技能加载器 | ~320 |
| `src/main/ai-engine/cowork/skill-executor.js` | 技能执行器 (Handler 分发) | ~380 |
| `src/main/ai-engine/cowork/skill-md-parser.js` | SKILL.md YAML 解析器 | ~250 |
| `src/main/ai-engine/cowork/unified-tool-registry.js` | 统一工具注册表 | ~420 |
| `src/main/ai-engine/cowork/skill-discoverer.js` | 技能发现与搜索 | ~280 |

## 故障排查

### 技能加载失败

- **YAML 解析错误**: 检查 SKILL.md 文件头部的 YAML frontmatter 格式是否正确
- **文件路径错误**: 确认技能文件在正确的目录下（workspace/managed/marketplace/bundled）
- **编码问题**: 技能文件必须使用 UTF-8 编码，Windows 下注意 BOM 头

### 技能执行超时

- **默认超时**: 技能执行默认 60 秒超时，可在配置中调整 `execution.timeout`
- **外部依赖**: 依赖网络请求的技能（如 `web-scraping`）可能因网络问题超时
- **并发限制**: 最大并发执行数为 3，超出后技能会排队等待

### 门控检查失败

- **平台不支持**: 检查技能的 `platform` 门控是否包含当前操作系统
- **二进制缺失**: 技能依赖的二进制工具（如 `git`、`node`）未安装或不在 PATH 中
- **环境变量缺失**: 必需的环境变量未设置，可选变量标记为 `(optional)` 不会阻止执行

### 自定义技能不显示

- **目录错误**: workspace 技能应放在 `.chainlesschain/skills/` 目录下
- **名称冲突**: 同名技能按层级优先级覆盖（workspace > managed > marketplace > bundled）
- **重新加载**: 修改技能文件后需要触发 `skills:reload` 或重启应用

### Handler 执行异常

- **参数格式**: 确认传入参数符合技能定义中的 `input-schema` 要求
- **工具权限**: 技能仅能使用 `tools` 字段中声明的工具，未声明的工具调用会被拒绝
- **日志排查**: 查看应用日志中 `[SkillExecutor]` 标签的错误信息

---

## 安全考虑

### 技能沙箱

- 每个技能仅能访问其 `tools` 字段中声明的工具，遵循 **最小权限原则**
- 门控检查在技能执行前强制运行，不满足条件的技能无法启动
- `strict` 模式下门控失败的技能会被自动禁用，防止误执行

### 代码执行安全

- `code-runner` 技能在 **隔离沙箱** 中执行用户代码，无法访问主进程资源
- 浏览器自动化技能（`browser-automation`、`computer-use`）操作记录在审计日志中
- Bash 命令执行通过 Plan Mode 集成，高风险命令需人工审批

### 技能来源验证

- 内置技能（bundled）由 ChainlessChain 官方维护，经过安全审查
- 插件市场技能安装前显示来源、版本和权限要求，用户确认后安装
- 自定义技能（workspace/managed）由用户自行管理，建议审查后使用

### 数据安全

- 技能执行过程中处理的数据不会自动上传到外部服务
- 需要网络访问的技能（如 `tavily-search`）明确标注外部 API 依赖
- 技能执行历史记录在本地数据库中，支持审计追溯

---

## 使用示例

### 技能发现与执行

```bash
# 列出所有可用技能（按类别分组显示）
chainlesschain skill list

# 搜索与代码审查相关的技能
chainlesschain skill search "code review"

# 执行代码审查技能，指定文件和审查重点
chainlesschain skill run code-review src/main/database.js --focus=security

# 执行测试生成技能，自动为指定文件生成单元测试
chainlesschain skill run test-generator src/services/user.js

# 查看技能的执行历史和性能指标
chainlesschain skill history code-review --limit 10
```

### 自定义技能创建

```bash
# 在工作区创建自定义技能
chainlesschain skill add my-analyzer

# 编辑技能定义（SKILL.md 格式，包含 YAML 元数据 + 提示词 + 工具声明）
# 文件位于 .chainlesschain/skills/my-analyzer.md

# 验证技能定义格式是否正确
chainlesschain skill validate .chainlesschain/skills/my-analyzer.md

# 重新加载技能注册表（修改后立即生效）
chainlesschain skill reload

# 删除自定义技能
chainlesschain skill remove my-analyzer
```

### 技能层级浏览

```bash
# 查看四层技能来源路径和各层技能数量
chainlesschain skill sources
# 输出: workspace(2) > managed(5) > marketplace(12) > bundled(138)

# 仅列出工作区层技能（最高优先级）
chainlesschain skill list --source workspace

# 仅列出内置技能中的安全类别
chainlesschain skill list --source bundled --category security
```

### Agent 模式下技能自动选择

```bash
# 进入 Agent 模式，AI 根据用户意图自动匹配并执行最佳技能
chainlesschain agent
# 输入 "审查 src/auth 目录的安全性" → 自动调用 /security-audit 技能
# 输入 "生成这个项目的 API 文档" → 自动调用 /api-docs-generator 技能

# 在 chat 中使用 /skill 前缀手动触发技能
chainlesschain chat
> /code-review src/index.js
> /explain-code src/utils/crypto.js
```

## 相关文档

- [Skill Marketplace 技能市场](/chainlesschain/skill-marketplace) - 去中心化技能即服务协议
- [Cowork 多智能体协作](/chainlesschain/cowork) - 多智能体协作与编排
- [Plan Mode 规划模式](/chainlesschain/plan-mode) - AI 任务规划与分解
- [Hooks 系统](/chainlesschain/hooks) - 钩子扩展机制
