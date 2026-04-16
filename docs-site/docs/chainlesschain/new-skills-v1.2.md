# v1.2.0~v1.2.1 新增 28 个实用技能

> **版本: v5.0.1 | 总计 138 个桌面内置技能 | 100% Handler 覆盖**

## 概述

v1.2.0~v1.2.1 版本新增 28 个实用技能，将桌面内置技能总数提升至 138 个，实现 100% Handler 覆盖。新增技能包括 10 个外部标准转化（Tavily 搜索、主动代理、浏览器自动化等）、12 个实用开发运维技能（深度研究、Docker Compose、Terraform IaC 等）以及 6 个社区生态补充技能（头脑风暴、调试策略、API 设计等）。

## 核心特性

- 🔍 **10 大外部标准转化**: Tavily/Find-Skills/Proactive-Agent 等顶级技能标准内化为内置能力
- 🛠️ **12 个实用流行技能**: 深度研究、Git Worktree、Docker Compose、Terraform IaC 等开发运维利器
- 🧠 **6 个社区生态补充**: 头脑风暴、调试策略、API 设计、前端设计、PR 创建、文档协作
- 🎯 **100% Handler 覆盖**: 所有 138 个技能均有对应的 JavaScript Handler 实现
- ⚡ **即插即用**: 通过 `/skill-name` 命令直接调用，支持 Agent 模式自动选择

## 系统架构

```
┌──────────────────────────────────────────────┐
│           技能系统 (138 Skills)                │
│                                              │
│  ┌──────────┐ ┌──────────┐ ┌──────────────┐ │
│  │ 外部标准 │ │ 实用技能 │ │ 社区生态     │ │
│  │ 转化(10) │ │ (12个)   │ │ 补充(6个)    │ │
│  └────┬─────┘ └────┬─────┘ └──────┬───────┘ │
│       │            │              │          │
│       ▼            ▼              ▼          │
│  ┌──────────────────────────────────────┐    │
│  │  Skill Registry + Skill Executor    │    │
│  │  SKILL.md 定义 + Handler.js 实现    │    │
│  └──────────────────┬───────────────────┘    │
│                     ▼                        │
│  ┌──────────────────────────────────────┐    │
│  │  Agent REPL / Chat REPL / IPC       │    │
│  │  /skill-name → Handler → Result     │    │
│  └──────────────────────────────────────┘    │
└──────────────────────────────────────────────┘
```

## 关键文件

| 文件 | 职责 |
|------|------|
| `desktop-app-vue/src/main/ai-engine/cowork/skills/` | 技能 SKILL.md 定义目录 |
| `desktop-app-vue/src/main/ai-engine/cowork/skill-handlers/` | 技能 Handler 实现目录 |
| `desktop-app-vue/src/main/ai-engine/cowork/skill-registry.js` | 技能注册表 |
| `desktop-app-vue/src/main/ai-engine/cowork/skill-executor.js` | 技能执行器 |
| `packages/cli/src/repl/agent-repl.js` | CLI Agent 技能集成 |

## 相关文档

- [Skills 系统](/chainlesschain/skills) — 技能系统完整文档
- [Cowork 系统](/chainlesschain/cowork) — 多智能体协作
- [Agent 模式](/chainlesschain/cli-agent) — CLI Agent 技能使用
- [更新日志](/changelog) — 完整版本历史

v1.2.0 研究了 10 大外部技能标准并转化为内置技能，新增 12 个当前最实用的开发/运维/知识管理技能。v1.2.1 研究社区技能生态补充 6 个高频缺失技能。

---

## 外部技能标准转化 (10 个)

研究 Tavily-search、Find-Skills、Proactive-Agent、Agent-Browser、remotion-best-practices、cron、planning-with-files、baoyu-skills、anthropics/skills、百度官方 skills 等 10 大外部技能标准，提炼核心模式转化为 ChainlessChain 内置技能。

### 联网搜索 - tavily-search

```bash
/tavily-search search "latest AI developments" --depth advanced
/tavily-search news "OpenAI GPT-5"
/tavily-search extract https://example.com/article
```

通过 Tavily API 实现深度网络搜索、新闻搜索和内容提取。支持搜索深度配置(basic/advanced)，结果包含可信度评分和摘要。

### 技能发现 - find-skills

```bash
/find-skills search "docker deployment"
/find-skills recommend
/find-skills category development
/find-skills info code-review
```

从技能注册表搜索、推荐和分类浏览技能。支持关键词匹配、上下文感知推荐和分类浏览。

### 主动代理 - proactive-agent

```bash
/proactive-agent watch src/ --pattern "*.js"
/proactive-agent threshold cpu 80
/proactive-agent periodic "check disk space" --interval 300
/proactive-agent pattern /var/log/app.log "ERROR|FATAL"
```

4 种自主触发器:

- **文件监控** (file-watch): 通过 fs.watch 监控文件变更
- **阈值监控** (threshold): 通过 os.cpus/freemem 监控系统资源
- **周期执行** (periodic): 通过 setInterval 定期执行任务
- **模式匹配** (pattern): 通过正则匹配日志模式

### Agent 浏览器 - agent-browser

```bash
/agent-browser navigate "https://example.com"
/agent-browser click @e1
/agent-browser type @e3 "hello world"
/agent-browser snapshot
```

快照引用模式 (@e1/@e2) 浏览器自动化，集成 browser-engine.js 和 computer-use-agent.js。维护浏览器会话，支持导航/点击/输入/快照操作。

### 视频生成 - remotion-video

```bash
/remotion-video create intro --title "My Video" --subtitle "Welcome"
/remotion-video create explainer --topic "How AI Works"
/remotion-video template slideshow --images "img1.png,img2.png"
/remotion-video render my-composition --output video.mp4
```

React/Remotion 视频创作，6 种模板: intro(标题动画)、explainer(教学视频)、slideshow(幻灯片)、social(社交媒体)、caption(字幕覆盖)、chart(数据图表)。

### 定时调度 - cron-scheduler

```bash
/cron-scheduler schedule "0 9 * * 1-5" "generate daily report"
/cron-scheduler at "tomorrow 3pm" "run backup"
/cron-scheduler list
/cron-scheduler cancel job_123
```

Cron 表达式 + 自然语言时间调度。支持循环任务和一次性任务，进程内 setInterval/setTimeout 实现。

### 规划工作流 - planning-with-files

```bash
/planning-with-files start "build user authentication system"
/planning-with-files update "completed database schema"
/planning-with-files status
/planning-with-files resume session_abc
```

Manus 3 文件模式:

- `task_plan.md` - 任务规划和步骤
- `findings.md` - 研究发现和笔记
- `progress.md` - 进度追踪和状态

支持会话恢复和 2-Action Rule(每次最多 2 个操作)。

### 内容发布 - content-publisher

```bash
/content-publisher create infographic "AI Market Trends 2026"
/content-publisher create slides "Quarterly Review"
/content-publisher format twitter "New feature announcement"
```

支持 5 种内容类型: 信息图(infographic)、幻灯片(slides)、封面图(cover)、漫画(comic)、社交媒体(social)。自动适配平台格式。

### 技能创建器 - skill-creator

```bash
/skill-creator create "my-awesome-skill"
/skill-creator validate my-awesome-skill
/skill-creator test my-awesome-skill "sample input"
/skill-creator optimize my-awesome-skill
```

元技能：创建/测试/验证/优化其他技能。自动脚手架 SKILL.md + handler.js，验证 YAML frontmatter 结构。

### Web 测试 - webapp-testing

```bash
/webapp-testing recon https://example.com
/webapp-testing accessibility https://example.com
/webapp-testing e2e "login flow" --url https://example.com
/webapp-testing security https://example.com
```

侦察-执行模式的 Web 应用测试。支持可访问性检查(WCAG)、E2E 场景生成和安全扫描。

---

## 实用流行技能 (12 个)

### 深度研究 - deep-research

```bash
/deep-research research "comparison of vector databases for RAG"
/deep-research quick "what is RLHF"
/deep-research analyze "microservices vs monolith tradeoffs"
```

8 阶段研究流水线: 查询分解 → 搜索策略 → 多源收集 → 可信度评分 → 交叉验证 → 综合分析 → 结论生成 → 引用格式化。

### Git Worktree 管理 - git-worktree-manager

```bash
/git-worktree-manager create feature/new-ui
/git-worktree-manager list
/git-worktree-manager status
/git-worktree-manager remove feature/old-branch
/git-worktree-manager prune
```

Git 工作树管理，支持创建/列表/删除/状态查看/清理。通过 execSync 调用 git worktree 命令。

### PR 审查 - pr-reviewer

```bash
/pr-reviewer review 123
/pr-reviewer diff 123
/pr-reviewer check 123
/pr-reviewer summary 123
```

通过 `gh` CLI 分析 PR 差异。自动检测密钥泄露、eval() 使用、console.log 残留、TODO 标记等常见问题。

### Docker Compose 生成 - docker-compose-generator

```bash
/docker-compose-generator generate "node app with postgres and redis"
/docker-compose-generator add-service mongodb
/docker-compose-generator template fullstack
/docker-compose-generator validate
```

10 种服务模板: PostgreSQL、MySQL、Redis、MongoDB、Elasticsearch、RabbitMQ、Nginx、Qdrant、Ollama、MinIO。支持堆栈自动检测和 YAML 生成。

### Terraform IaC - terraform-iac

```bash
/terraform-iac generate "AWS ECS with RDS and Redis"
/terraform-iac module vpc
/terraform-iac template aws-ecs
/terraform-iac validate
```

AWS/GCP/Azure HCL 配置生成。8 种云模板: aws-vpc、aws-ecs、aws-rds、aws-lambda、gcp-gke、gcp-cloudsql、azure-aks、azure-cosmosdb。

### API 文档生成 - api-docs-generator

```bash
/api-docs-generator scan src/routes/
/api-docs-generator openapi src/routes/ --title "My API"
/api-docs-generator endpoint "POST /users Create a new user"
/api-docs-generator validate openapi.yaml
```

扫描 Express.js/FastAPI/Spring Boot 路由模式，自动生成 OpenAPI 3.0 规范。

### 新闻监控 - news-monitor

```bash
/news-monitor watch AI blockchain --sources hackernews,reddit
/news-monitor digest --period weekly --topic "machine learning"
/news-monitor trends --category tech
/news-monitor fetch AI
```

HackerNews API 集成 + 关键词追踪 + 词频趋势检测 + 定期摘要生成。支持自定义 RSS 源。

### 深度思考 - ultrathink

```bash
/ultrathink analyze "should we migrate to microservices"
/ultrathink decompose "redesign the authentication system"
/ultrathink evaluate "Redis vs Memcached vs DragonflyDB"
```

7 步扩展推理框架:

- **分析模式**: 问题重述 → 约束映射 → 假设识别 → 根因分析 → 方案探索 → 多视角检查 → 推荐综合
- **分解模式**: 范围定义 → 组件识别 → 依赖映射 → 子任务分解 → 关键路径 → 风险评估 → 执行计划
- **评估模式**: 选项枚举 → 标准定义 → 权重分配 → 逐项评分 → 权衡矩阵 → 敏感性分析 → 最终裁决

### YouTube 摘要 - youtube-summarizer

```bash
/youtube-summarizer summarize https://youtube.com/watch?v=abc123
/youtube-summarizer transcript https://youtu.be/abc123
/youtube-summarizer chapters https://youtube.com/watch?v=abc123
```

YouTube 视频字幕提取 + 结构化摘要生成 + 基于时间的章节分段。支持多种 YouTube URL 格式。

### 数据库助手 - database-query

```bash
/database-query generate "find users who logged in this week"
/database-query optimize "SELECT * FROM orders WHERE status = 'pending'"
/database-query schema notes
/database-query migrate "add email column to users"
```

SQL 生成/优化/Schema 内省/迁移脚本。支持 SQLite(默认)、PostgreSQL、MySQL 方言。可直接内省应用数据库 Schema。

### K8s 部署 - k8s-deployer

```bash
/k8s-deployer manifest "node app with 3 replicas" --port 3000
/k8s-deployer helm my-service
/k8s-deployer status my-app
/k8s-deployer rollout restart my-app
/k8s-deployer security my-app
```

K8s 清单生成(Deployment + Service + PDB)、Helm Chart 脚手架、安全最佳实践检查(非 root、只读文件系统、资源限制、网络策略)。

### IDE 规则生成 - cursor-rules-generator

```bash
/cursor-rules-generator generate cursor
/cursor-rules-generator detect src/
/cursor-rules-generator export claude --output CLAUDE.md
```

分析项目结构和约定，自动生成 AI 编码助手配置文件。支持 5 种格式:

- `.cursorrules` (Cursor AI)
- `.clinerules` (Cline)
- `CLAUDE.md` (Claude Code)
- `.windsurfrules` (Windsurf)
- `.github/copilot-instructions.md` (GitHub Copilot)

自动检测: 包管理器、框架、语言、测试框架、代码风格、提交规范、目录结构。

---

## 技能统计

| 版本       | 技能数  | 说明                                                                                                               |
| ---------- | ------- | ------------------------------------------------------------------------------------------------------------------ |
| v0.36.0    | 30      | 基础技能                                                                                                           |
| v0.36.1    | 40      | +10 高级技能                                                                                                       |
| v0.36.2    | 50      | +10 AI会话/开发效率                                                                                                |
| v0.37.3    | 60      | +10 Office/音视频                                                                                                  |
| v0.37.4    | 70      | +10 图像/数据/工具                                                                                                 |
| v0.37.5    | 80      | +10 开发效率/系统工具                                                                                              |
| v0.37.6    | 90      | +10 系统/安全/设计                                                                                                 |
| v1.0.0     | 96      | +6 Cowork协作演化(含zkp-toolkit)                                                                                   |
| v1.2.0     | 128     | +22 外部标准转化(10) + 实用技能(12) + 集成/生产力(10)                                                              |
| v1.2.1     | 131     | +3 系统/示例技能 (handler-test-skill, my-custom-skill, test-skill)                                                 |
| **v1.2.1** | **137** | **+6 社区生态补充 (brainstorming, debugging-strategies, api-design, frontend-design, create-pr, doc-coauthoring)** |
| **v5.0.1** | **138** | **+1 find-skills v2 (技能发现增强)**                                                                               |

---

## v1.2.1 社区生态补充技能 (6 个)

研究社区技能生态 (OpenClaw、awesome-skills 等)，分析排行榜 Top 20 工具与已有 131 个内置技能的差异，补充 6 个高频缺失技能。

### 创意头脑风暴 - brainstorming

```bash
/brainstorming ideate "How to improve developer experience"
/brainstorming mindmap "Microservices architecture"
/brainstorming swot "Migrating to cloud"
/brainstorming sixhats "New product launch"
/brainstorming scamper "Improve onboarding flow"
```

5 种创意方法: 自由思考(ideate)、思维导图(mindmap)、SWOT 分析(swot)、六顶帽(sixhats)、SCAMPER 替代法(scamper)。

### 系统调试策略 - debugging-strategies

```bash
/debugging-strategies diagnose "TypeError: Cannot read property of undefined"
/debugging-strategies bisect "Feature broke between v1.0 and v2.0"
/debugging-strategies trace src/auth/login.js
/debugging-strategies hypothesis "Memory leak in worker"
/debugging-strategies rubber-duck "Why does login fail?"
/debugging-strategies root-cause "ECONNREFUSED on database"
/debugging-strategies red-flags "just try changing the port"
/debugging-strategies defense "TypeError in user input"
/debugging-strategies session start "Login crashes on submit"
```

9 种调试模式: 系统诊断(diagnose)、二分法(bisect)、执行追踪(trace)、假设驱动(hypothesis)、小黄鸭(rubber-duck)、根因分析(root-cause)、红旗检测(red-flags)、防御加固(defense)、会话追踪(session)。包含 13 种错误分类、5 种红旗模式、4 层防御验证。

### API 设计 - api-design

```bash
/api-design design "User management API with CRUD"
/api-design review src/routes/
/api-design openapi "Payment service API"
/api-design versioning "API v1 to v2 migration"
/api-design errors "Payment service error handling"
```

5 种模式: RESTful 设计(design)、现有 API 审查(review)、OpenAPI 规范生成(openapi)、版本策略(versioning)、错误码设计(errors)。Review 模式自动检测 Express/Spring/FastAPI 路由模式。

### 前端设计 - frontend-design

```bash
/frontend-design component "Modal dialog with animations"
/frontend-design layout "Dashboard page"
/frontend-design responsive "E-commerce product page"
/frontend-design a11y "Registration form accessibility"
/frontend-design theme "Design system tokens"
```

5 种模式: Vue 组件设计(component)、页面布局(layout)、响应式设计(responsive)、WCAG 无障碍审计(a11y)、主题系统(theme)。包含 4 种断点定义、5 类无障碍检查清单。

### PR 创建 - create-pr

```bash
/create-pr create feature/add-dark-mode
/create-pr draft "work in progress authentication"
/create-pr template
/create-pr changelog v1.0.0..v1.1.0
```

4 种模式: 从 Git 变更创建 PR(create)、草稿 PR(draft)、PR 模板生成(template)、Changelog 生成(changelog)。自动从分支名生成标题，按 Conventional Commits 分类提交。

### 文档协作 - doc-coauthoring

```bash
/doc-coauthoring draft "API integration guide"
/doc-coauthoring expand README.md#Getting-Started
/doc-coauthoring review docs/api.md
/doc-coauthoring structure docs/guide.md
/doc-coauthoring glossary docs/architecture.md
```

5 种模式: 初稿生成(draft)、章节扩展(expand)、质量审查(review)、结构分析(structure)、术语表生成(glossary)。Review 模式检查 TODO/FIXME、空白标题、断链等问题。

---

## 使用示例

以下场景展示如何组合多个技能完成复杂工作流。

### 场景一：深度研究 + 文档协作 — 技术调研报告

```bash
# 1. 深度研究收集资料
/deep-research research "comparison of vector databases: Qdrant vs Milvus vs Weaviate"

# 2. 用文档协作生成初稿
/doc-coauthoring draft "Vector Database Selection Report"

# 3. 扩展关键章节
/doc-coauthoring expand docs/vector-db-report.md#Performance-Benchmarks

# 4. 质量审查，检查断链和遗漏
/doc-coauthoring review docs/vector-db-report.md
```

### 场景二：主动代理 + 定时调度 — 生产监控

```bash
# 1. 设置日志模式监控，检测错误日志
/proactive-agent pattern /var/log/app.log "ERROR|FATAL|OOM"

# 2. 设置 CPU 阈值告警
/proactive-agent threshold cpu 85

# 3. 定时生成每日健康报告
/cron-scheduler schedule "0 9 * * *" "generate system health report"

# 4. 每周五下午生成周报摘要
/cron-scheduler schedule "0 17 * * 5" "generate weekly incident digest"
```

### 场景三：技能创建器 + 技能发现 — 自定义技能开发

```bash
# 1. 搜索现有技能，避免重复开发
/find-skills search "code coverage"

# 2. 确认无匹配后创建新技能
/skill-creator create "coverage-reporter"

# 3. 验证技能定义格式
/skill-creator validate coverage-reporter

# 4. 测试技能执行
/skill-creator test coverage-reporter "analyze src/ directory"
```

---

## 故障排查

### 常见问题

| 症状 | 可能原因 | 解决方案 |
|------|----------|----------|
| `/skill-name` 提示 "skill not found" | 技能名称拼写错误或未注册 | 运行 `/find-skills search "关键词"` 确认正确名称 |
| Handler 执行报错 "handler returned error" | Handler 依赖缺失或参数格式不对 | 检查 `skill-handlers/` 下对应 handler 日志，确认入参格式 |
| tavily-search 返回 "API key missing" | 未配置 Tavily API Key | 运行 `chainlesschain config set TAVILY_API_KEY <your-key>` |
| deep-research 超时无响应 | 网络延迟或搜索阶段过多 | 使用 `/deep-research quick "问题"` 快速模式，或检查网络连通性 |
| 两个技能输出冲突覆盖 | 同名输出文件或并发写入同一资源 | 为每个技能指定不同的 `--output` 路径，避免并行写同一文件 |

### 常用排查命令

```bash
# 查看所有已注册技能及状态
chainlesschain skill list

# 检查技能系统健康状态
chainlesschain doctor

# 查看技能执行日志（最近 50 条）
chainlesschain skill sources
```

如果问题持续，可查看 `desktop-app-vue/src/main/ai-engine/cowork/skill-executor.js` 中的错误处理逻辑，或在 Agent 模式下运行 `chainlesschain agent` 获取详细调试输出。

---

## 配置参考

下表列出技能系统在 `.chainlesschain/config.json` 中的可配置项及其默认值：

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `skills.enabled` | boolean | `true` | 是否启用技能系统 |
| `skills.autoDiscover` | boolean | `true` | 是否自动发现工作区 SKILL.md 文件 |
| `skills.layers.bundled` | boolean | `true` | 加载内置技能层（138 个） |
| `skills.layers.marketplace` | boolean | `true` | 加载 EvoMap 市场技能层 |
| `skills.layers.managed` | boolean | `true` | 加载用户托管技能层 |
| `skills.layers.workspace` | boolean | `true` | 加载工作区技能层（最高优先级） |
| `skills.lazyLoad` | boolean | `true` | 启用懒加载（仅解析 frontmatter，body 按需读取） |
| `skills.executionTimeout` | integer | `30000` | 单次技能执行超时（ms） |
| `skills.maxConcurrent` | integer | `3` | 最大并发执行技能数 |
| `skills.tavilyApiKey` | string | `""` | Tavily 搜索 API Key（tavily-search 技能必需） |
| `skills.proactiveAgent.maxWatchers` | integer | `10` | proactive-agent 最大同时监控目标数 |
| `skills.proactiveAgent.pollInterval` | integer | `5000` | 阈值监控轮询间隔（ms） |
| `skills.cronScheduler.maxJobs` | integer | `50` | cron-scheduler 最大任务数 |
| `skills.deepResearch.maxSources` | integer | `20` | deep-research 单次最大搜索来源数 |
| `skills.deepResearch.timeoutMs` | integer | `60000` | deep-research 总超时（ms） |
| `skills.sandbox.enabled` | boolean | `true` | 是否在 Sandbox v2 中执行自定义技能 |
| `skills.sandbox.allowedNetworkHosts` | string[] | `[]` | 自定义技能允许访问的外部主机白名单 |

---

## 性能指标

以下为 v5.0.1 版本技能系统在标准开发机（Intel Core i7-12700 / 16 GB RAM）上的典型性能数据：

| 操作 | 典型耗时 | 说明 |
|------|----------|------|
| 技能注册表初始化（138 个，懒加载） | 80–150 ms | 仅解析 YAML frontmatter，跳过 Markdown body |
| 技能注册表初始化（138 个，全量加载） | 400–700 ms | 完整解析所有 SKILL.md 文件 |
| 单个技能 body 按需加载 | 1–5 ms | 首次调用时触发，后续缓存命中 < 0.1 ms |
| `/find-skills search` | < 50 ms | 本地注册表关键词检索 |
| `/tavily-search search`（advanced） | 2–6 秒 | 依赖外部 Tavily API 网络延迟 |
| `/deep-research research`（8 阶段） | 30–90 秒 | 含多源搜索与 LLM 综合分析 |
| `/ultrathink analyze`（7 步推理） | 8–25 秒 | 依赖本地 LLM 推理速度 |
| `/docker-compose-generator generate` | 1–3 秒 | 本地模板渲染 + LLM 参数填充 |
| `/k8s-deployer manifest` | 2–5 秒 | 含安全最佳实践检查 |
| `/pr-reviewer review`（diff < 500 行） | 5–15 秒 | 通过 `gh` CLI 拉取 diff + LLM 分析 |
| `/skill-creator create`（脚手架生成） | 3–8 秒 | 生成 SKILL.md + handler.js + 测试文件 |
| `/agent-browser navigate` | 1–3 秒 | Chromium 页面加载（含网络） |
| proactive-agent 文件变更响应延迟 | < 100 ms | fs.watch 事件到技能触发的端到端延迟 |

**并发处理能力**：

- Agent 模式下最多同时执行 3 个技能（`maxConcurrent` 默认值）
- proactive-agent 最多同时维护 10 个监控目标
- cron-scheduler 最多调度 50 个任务（内存调度，重启后需重新注册）

---

## 测试覆盖率

v1.2.0~v1.2.1 新增 28 个技能的测试覆盖分布如下，当前总覆盖率 **≥ 95%**（Handler 层 100%）：

| 测试文件 | 测试数 | 覆盖技能 |
|----------|--------|----------|
| `tests/unit/ai-engine/skill-handlers.test.js` | 84 | 全部 28 个新增技能 Handler 的核心逻辑 |
| `tests/unit/ai-engine/cowork/skill-registry.test.js` | 22 | 四层加载、优先级覆盖、懒加载触发 |
| `tests/unit/ai-engine/cowork/skill-executor.test.js` | 18 | 执行超时、并发限制、错误捕获 |
| `tests/unit/ai-engine/cowork/skill-mcp.test.js` | 26 | Skill-Embedded MCP 解析与 mount/unmount |
| `tests/unit/skills/tavily-search.test.js` | 12 | API Key 校验、深度参数、结果格式 |
| `tests/unit/skills/deep-research.test.js` | 15 | 8 阶段流水线、超时降级、引用格式 |
| `tests/unit/skills/proactive-agent.test.js` | 14 | 4 种触发器、并发监控上限、停止清理 |
| `tests/unit/skills/docker-compose-generator.test.js` | 10 | 10 种服务模板、YAML 合法性验证 |
| `tests/unit/skills/k8s-deployer.test.js` | 13 | 清单生成、安全检查项、Helm 脚手架 |
| `tests/unit/skills/skill-creator.test.js` | 16 | 脚手架生成、validate 规则、optimize 循环 |
| `tests/unit/skills/community-skills.test.js` | 30 | 6 个社区技能（brainstorming 等）全模式覆盖 |
| `tests/integration/skills/skill-workflow.test.js` | 8 | 多技能组合工作流端到端验证 |

**运行测试**：

```bash
# 所有技能单元测试
cd desktop-app-vue && npx vitest run tests/unit/ai-engine/skill-handlers.test.js

# 技能注册表与执行器
cd desktop-app-vue && npx vitest run tests/unit/ai-engine/cowork/

# 单个技能测试
cd desktop-app-vue && npx vitest run tests/unit/skills/deep-research.test.js

# CLI 技能集成测试
cd packages/cli && npx vitest run __tests__/skill
```

---

## 安全考虑

### 外部 API 密钥管理

tavily-search、news-monitor 等技能依赖外部 API。密钥通过 `chainlesschain config set` 存储在本地加密配置文件 `.chainlesschain/config.json` 中，不会上传至远程服务器。建议定期轮换密钥，不要将密钥硬编码在脚本或 SKILL.md 中。

### 文件系统访问控制

proactive-agent 的 watch 模式使用 `fs.watch` 监控指定目录。应避免监控系统根目录或敏感路径（如 `~/.ssh/`、`/etc/`）。建议仅监控项目工作目录，并通过 `--pattern` 限制文件类型，防止意外触发大量事件。

### 代码执行安全

skill-creator 在创建和测试技能时会执行用户提供的 Handler 代码。所有 Handler 在 Sandbox v2 沙盒环境中运行，限制了文件系统写入范围和网络访问。自定义技能发布前应通过 `/skill-creator validate` 验证，确保无危险操作（如 `eval()`、`child_process.exec` 无过滤调用）。

### PR 数据隐私

pr-reviewer 和 create-pr 通过本地 `gh` CLI 访问 Git 仓库数据。PR 差异内容仅在本地处理，不会发送到第三方服务。如果启用了 LLM 分析，代码片段会发送至配置的 LLM 提供商，请确保使用的 LLM 提供商符合团队数据隐私政策。

### 网络访问控制

agent-browser、tavily-search、webapp-testing 等技能需要网络访问。建议在企业环境中通过代理服务器统一管控出站流量，并在 `.chainlesschain/config.json` 中配置 `HTTP_PROXY` / `HTTPS_PROXY`。对于离线环境，这些技能会自动降级为本地缓存模式或返回友好错误提示。

---

## 下一步

- [Skills系统](/chainlesschain/skills) - 技能系统完整文档
- [Cowork系统](/chainlesschain/cowork) - 多智能体协作
- [更新日志](/changelog) - 完整版本历史
