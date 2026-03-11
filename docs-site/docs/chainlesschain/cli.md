# CLI 命令行工具

> **版本: v0.37.9 | 状态: ✅ 生产就绪 | 743 测试通过 | 30+ Headless 命令 | 纯 JS 无原生依赖**

ChainlessChain 提供轻量级 npm CLI 工具，让开发者通过一条命令即可安装、配置和管理整个系统。

## 核心特性

- 📦 **纯 JS 轻量包**: 约 2MB，无原生依赖，全平台 `npm install -g` 即装即用
- 🤖 **30+ Headless 命令**: AI 对话、笔记管理、DID 身份、加密解密等无 GUI 运行
- 🧠 **Agent 模式**: Claude Code 风格代理会话，8 工具 + 138 技能 + Plan Mode
- 🔧 **完整系统管理**: setup/start/stop/status/services/config/update/doctor 全链路
- 🧪 **743 测试通过**: 118 核心包测试 + 625 CLI 测试，质量可靠

## 系统架构

```
┌──────────────────────────────────────────────┐
│            CLI 命令行工具架构                   │
│                                              │
│  ┌──────────────────────────────────────┐    │
│  │  bin/chainlesschain.js (入口)        │    │
│  └──────────────────┬───────────────────┘    │
│                     ▼                        │
│  ┌──────────────────────────────────────┐    │
│  │  src/index.js (Commander 注册)       │    │
│  └──────────────────┬───────────────────┘    │
│       ┌─────────────┼─────────────┐          │
│       ▼             ▼             ▼          │
│  ┌─────────┐  ┌──────────┐  ┌─────────┐    │
│  │系统管理 │  │Headless  │  │ REPL    │    │
│  │setup    │  │db/note   │  │chat/    │    │
│  │start    │  │did/auth  │  │agent    │    │
│  │services │  │encrypt   │  │(138技能)│    │
│  └─────────┘  └────┬─────┘  └─────────┘    │
│                     ▼                        │
│  ┌──────────────────────────────────────┐    │
│  │  5 个核心包 (@chainlesschain/core-*) │    │
│  │  core-env | shared-logger | core-db │    │
│  │  core-infra | core-config           │    │
│  └──────────────────────────────────────┘    │
└──────────────────────────────────────────────┘
```

## 相关文档

- [CLI 分发系统](/chainlesschain/cli-distribution) — 分发架构与 CI/CD
- [DID 身份 (CLI)](/chainlesschain/cli-did) — Ed25519 签名/验证
- [文件加密 (CLI)](/chainlesschain/cli-encrypt) — AES-256-GCM 加密/解密
- [RBAC 权限 (CLI)](/chainlesschain/cli-auth) — 角色与权限管理

## 快速开始

```bash
npm install -g chainlesschain
chainlesschain setup
chainlesschain start
```

## 系统要求

- **Node.js** >= 22.12.0
- **Docker** (可选，用于后端服务)

## 安装

### 全局安装

```bash
npm install -g chainlesschain
```

### 验证安装

```bash
chainlesschain --version
chainlesschain doctor
```

## 命令参考

### setup — 交互式设置向导

首次使用的交互式引导流程。

```bash
chainlesschain setup
chainlesschain setup --skip-download    # 跳过二进制下载
chainlesschain setup --skip-services    # 跳过Docker设置
```

**设置流程：**

1. 检查 Node.js 版本 (>= 22.12.0)
2. 检查 Docker 可用性（可选）
3. 选择版本：个人版 / 企业版
4. 选择 LLM 提供商：Ollama / OpenAI / DashScope / DeepSeek / 自定义
5. 配置 API Key（云端提供商）
6. 下载平台二进制文件
7. 保存配置
8. 可选启动 Docker 后端服务

### start — 启动应用

```bash
chainlesschain start                # 启动桌面应用
chainlesschain start --headless     # 仅启动后端服务（无GUI）
chainlesschain start --services     # 同时启动Docker服务
```

### stop — 停止应用

```bash
chainlesschain stop                 # 停止桌面应用
chainlesschain stop --services      # 仅停止Docker服务
chainlesschain stop --all           # 停止所有（应用 + 服务）
```

### status — 查看状态

显示桌面应用、Docker 服务和端口可用性状态。

```bash
chainlesschain status
```

**输出示例：**

```
  App Status

  ● Desktop app running (PID: 12345)
  ● Setup completed (2026-03-11T00:00:00.000Z)
    Edition: personal
    LLM: ollama (qwen2:7b)

  Docker Services

  ● ollama: running
  ● qdrant: running
  ● postgres: running

  Ports

  ● vite: 5173
  ○ signaling: 9001
  ● ollama: 11434
```

### services — Docker 服务管理

```bash
chainlesschain services up              # 启动所有服务
chainlesschain services up ollama redis  # 启动指定服务
chainlesschain services down            # 停止所有服务
chainlesschain services logs            # 查看日志
chainlesschain services logs -f         # 跟踪日志
chainlesschain services pull            # 拉取最新镜像
```

### config — 配置管理

```bash
chainlesschain config list              # 查看所有配置
chainlesschain config get llm.provider  # 获取指定值
chainlesschain config set llm.provider openai  # 设置值
chainlesschain config set llm.apiKey sk-xxx
chainlesschain config edit              # 用编辑器打开
chainlesschain config reset             # 重置为默认值
```

### update — 更新管理

```bash
chainlesschain update                   # 检查并安装更新
chainlesschain update --check           # 仅检查（不下载）
chainlesschain update --channel beta    # 使用beta通道
chainlesschain update --channel dev     # 使用dev通道
chainlesschain update --force           # 强制重新下载
```

### doctor — 环境诊断

全面检查运行环境，识���潜在问题。

```bash
chainlesschain doctor
```

**检查项：**

| 检查项         | 说明                    |
| -------------- | ----------------------- |
| Node.js        | 版本 >= 22.12.0         |
| npm            | 已安装                  |
| Docker         | 已安装（可选）          |
| Docker Compose | 已安装（可选）          |
| Git            | 已安装                  |
| 配置目录       | ~/.chainlesschain/ 存在 |
| 配置文件       | config.json 存在        |
| 桌面二进制     | 已下载                  |
| Setup 状态     | 已完成初始设置          |
| 端口状态       | 各服务端口可用性        |
| 磁盘空间       | 剩余空间充足            |

## 全局选项

```bash
chainlesschain --version    # 显示版本号
chainlesschain --help       # 显示帮助
chainlesschain --verbose    # 启用详细输出
chainlesschain --quiet      # 静默模式
```

## 配置

### 配置文件位置

```
~/.chainlesschain/config.json
```

### 配置结构

```json
{
  "setupCompleted": true,
  "completedAt": "2026-03-11T00:00:00.000Z",
  "edition": "personal",
  "llm": {
    "provider": "ollama",
    "apiKey": null,
    "baseUrl": "http://localhost:11434",
    "model": "qwen2:7b"
  },
  "enterprise": {
    "serverUrl": null,
    "apiKey": null,
    "tenantId": null
  },
  "services": {
    "autoStart": false,
    "dockerComposePath": null
  },
  "update": {
    "channel": "stable",
    "autoCheck": true
  }
}
```

### 支持的 LLM 提供商

| 提供商           | 默认模型      | 需要API Key |
| ---------------- | ------------- | ----------- |
| Ollama (本地)    | qwen2:7b      | 否          |
| OpenAI           | gpt-4o        | 是          |
| DashScope (阿里) | qwen-max      | 是          |
| DeepSeek         | deepseek-chat | 是          |
| 自定义           | —             | 是          |

## 文件结构

```
~/.chainlesschain/
├── config.json        # 配置文件
├── bin/               # 下载的二进制文件
├── state/             # 运行状态（PID文件）
├── services/          # 服务配置
├── logs/              # CLI日志
└── cache/             # 下载缓存
```

---

## Headless 模式命令

以下命令不依赖桌面 GUI，直接使用核心包运行。适用于服务器、CI/CD、容器化等无桌面环境。

| 命令               | 说明                                        | 详情                          |
| ------------------ | ------------------------------------------- | ----------------------------- |
| `db`               | 数据库初始化、信息、备份、恢复              | [数据库管理](./cli-db)        |
| `note`             | 笔记增删改查、版本控制、全文搜索            | [笔记/知识库管理](./cli-note) |
| `chat` / `ask`     | 交互式 AI 对话 / 单次问答                   | [AI 对话](./cli-chat)         |
| `llm`              | 模型列表、7 Provider 管理、连通性测试       | [LLM 管理](./cli-llm)         |
| `agent` (别名 `a`) | Claude Code 风格代理会话，8 工具 + 138 技能 + Plan Mode | [代理模式](./cli-agent)       |
| `skill`            | 技能列表、搜索、运行                        | [技能系统](./cli-skill)       |
| `search`           | BM25 混合搜索                               | [混合搜索](./cli-search)      |
| `tokens`           | Token 用量追踪、成本分析                    | [Token追踪](./cli-tokens)     |
| `memory`           | 持久记忆管理、每日笔记                      | [持久记忆](./cli-memory)      |
| `session`          | 会话持久化、恢复、导出                      | [会话管理](./cli-session)     |
| `import`           | 知识导入 (Markdown/Evernote/Notion/PDF)     | Phase 2                       |
| `export`           | 知识导出 (Markdown/静态HTML站点)            | Phase 2                       |
| `git`              | Git 集成（状态/初始化/自动提交/历史分析）   | Phase 2                       |
| `mcp`              | MCP 服务器管理 (JSON-RPC 2.0 over stdio)    | Phase 3                       |
| `browse`           | 浏览器自动化（页面抓取/CSS选择器/截图）     | Phase 3                       |
| `instinct`         | 本能学习（偏好追踪/衰减/系统提示生成）      | Phase 3                       |
| `did`              | DID 身份管理 (Ed25519 签名/验证)             | [DID身份](./cli-did)          |
| `encrypt`/`decrypt`| AES-256-GCM 文件加密/解密                    | [文件加密](./cli-encrypt)     |
| `auth`             | RBAC 权限引擎 (4角色/26权限范围)             | [RBAC权限](./cli-auth)        |
| `audit`            | 审计日志 (8事件类型/4风险级别)               | [审计日志](./cli-audit)       |

---

## 核心包架构

Headless 命令依赖 5 个独立核心包（118 个核心包测试 + 625 个 CLI 测试 = 743 个测试全部通过）：

| 包名                            | 说明                 | 模块类型 | 测试数 |
| ------------------------------- | -------------------- | -------- | ------ |
| `@chainlesschain/core-env`      | 平台抽象、路径解析   | ESM      | 17     |
| `@chainlesschain/shared-logger` | 共享日志（文件轮转） | ESM      | 11     |
| `@chainlesschain/core-infra`    | DI容器、事件总线     | CJS      | 26     |
| `@chainlesschain/core-config`   | 配置管理             | CJS      | 16     |
| `@chainlesschain/core-db`       | 数据库管理           | CJS      | 48     |

---

## 与桌面应用的关系

CLI 是一个纯 JS 的轻量编排工具（约2MB），不包含原生模块。它的职责是：

- **下载管理**：从 GitHub Releases 下载平台对应的预构建二进制文件
- **配置管理**：管理 `~/.chainlesschain/config.json`，与桌面应用的配置系统兼容
- **进程管理**：通过 PID 文件管理桌面应用的启动和停止
- **服务编排**：封装 Docker Compose 命令管理后端服务

桌面应用启动后使用自己的 Electron userData 目录，CLI 的配置会被桌面应用的首次设置向导读取。

## 常见问题

### 安装后命令找不到

确保 npm 全局目录在 PATH 中：

```bash
npm config get prefix
# 将输出路径/bin 添加到 PATH
```

### 下载二进制失败

使用代理或手动下载：

```bash
# 使用代理
HTTPS_PROXY=http://proxy:port chainlesschain setup

# 手动下载后放到 ~/.chainlesschain/bin/
```

### Docker 服务启动失败

```bash
# 检查环境
chainlesschain doctor

# 查看日志
chainlesschain services logs
```

## 测试覆盖率

CLI 包包含 743 个测试（118 核心包测试 + 625 CLI 测试），全部通过：

| 测试类型 | 文件数 | 测试数 | 说明 |
|---------|--------|--------|------|
| 单元测试 | 30+ | 500+ | 各模块功能测试 |
| 集成测试 | 5+ | 80+ | 模块间协作测试 |
| E2E 测试 | 5 | 120+ | 端到端命令测试 |

```bash
cd packages/cli
npm test                   # 运行全部 743 测试
npm run test:unit          # 仅单元测试
npm run test:integration   # 仅集成测试
npm run test:e2e           # 仅端到端测试
```

## 安全考虑

- API Key 存储在本地 `~/.chainlesschain/config.json`，建议设置文件权限 600
- 数据库支持 SQLCipher AES-256 加密（`chainlesschain encrypt db`）
- 所有操作记录审计日志，支持敏感数据自动脱敏
- 二进制下载通过 HTTPS + SHA-256 校验和验证
- 使用 Ollama 本地模型时数据完全离线

## 关键文件

- `packages/cli/bin/chainlesschain.js` — npm bin 入口
- `packages/cli/src/index.js` — Commander 命令注册（主入口）
- `packages/cli/src/commands/` — 所有命令实现
- `packages/cli/src/lib/` — 共享库（30+ 模块）
- `packages/cli/src/repl/` — 交互式 REPL（chat/agent）
- `packages/cli/src/runtime/bootstrap.js` — 7 阶段 Headless 初始化

## 卸载

```bash
npm uninstall -g chainlesschain
rm -rf ~/.chainlesschain
```
