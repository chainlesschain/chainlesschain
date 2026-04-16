# CLI 命令行工具

> **版本: v5.0.2.2 | 状态: ✅ 生产就绪 | 2063 测试通过 | 63 命令 | 纯 JS 无原生依赖**

## 概述

ChainlessChain CLI 是一个纯 JavaScript 实现的轻量级命令行工具，提供 63 个命令覆盖 AI 对话、笔记管理、DID 身份、加密解密、多智能体协作等全部核心功能。通过 `npm install -g` 即可全平台安装，支持 Agent 模式、四层技能系统和完整的系统生命周期管理。

## 核心特性

- 📦 **纯 JS 轻量包**: 约 2MB，无原生依赖，全平台 `npm install -g` 即装即用
- 🤖 **63 个命令**: AI 对话、笔记管理、DID 身份、加密解密、项目初始化、多智能体协作、EvoMap基因交换、DAO治理、安全合规、通信桥接、社交平台、CLI-Anything集成、WebSocket Server、Web管理界面等
- 🧠 **Agent 模式**: Claude Code 风格代理会话，8 工具 + 138 技能 + Plan Mode + /cowork
- 🎯 **多层技能系统**: 4 层优先级（bundled < marketplace < managed < workspace），自定义技能管理
- 🤝 **多智能体协作**: 多视角辩论审查 + A/B 方案对比 + 代码知识图谱分析
- 🔧 **完整系统管理**: setup/start/stop/status/services/config/update/doctor 全链路
- 🧪 **2063 测试通过**: 118 核心包测试 + 1945 CLI 测试，92 个测试文件

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

## 配置参考

CLI 主配置文件位于 `~/.chainlesschain/config.json`，支持通过 `chainlesschain config set <key> <value>` 修改。

```json
{
  "setupCompleted": true,
  "edition": "personal",
  "llm": {
    "provider": "ollama",
    "model": "qwen2:7b",
    "apiKey": null,
    "baseUrl": "http://localhost:11434",
    "timeout": 30000,
    "streaming": true
  },
  "agent": {
    "planMode": false,
    "maxTools": 8,
    "recallLimit": 5,
    "parkOnExit": true,
    "noStream": false
  },
  "services": {
    "autoStart": false,
    "dockerComposePath": null
  },
  "update": {
    "channel": "stable",
    "autoCheck": true
  },
  "logging": {
    "level": "info",
    "file": "~/.chainlesschain/logs/cli.log",
    "maxSize": "10m",
    "maxFiles": 5
  }
}
```

| 配置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `edition` | string | `"personal"` | 版本：`personal` / `enterprise` |
| `llm.provider` | string | `"ollama"` | LLM 提供商：`ollama` / `openai` / `dashscope` / `deepseek` / `custom` |
| `llm.streaming` | boolean | `true` | 是否启用流式输出 |
| `agent.planMode` | boolean | `false` | 默认是否启用 Plan Mode |
| `agent.recallLimit` | number | `5` | 启动时注入的历史记忆条数上限 |
| `agent.parkOnExit` | boolean | `true` | 退出 Agent 时自动 Park 会话 |
| `update.channel` | string | `"stable"` | 更新通道：`stable` / `beta` / `dev` |
| `logging.level` | string | `"info"` | 日志级别：`debug` / `info` / `warn` / `error` |

## 性能指标

| 操作 | 目标 | 实际 | 状态 |
| --- | --- | --- | --- |
| CLI 冷启动时间 | <300ms | ~200ms | ✅ |
| `cc doctor` 全项检查 | <2s | ~1.5s | ✅ |
| `cc note search` BM25 查询 | <100ms | ~60ms | ✅ |
| `cc agent` 首次响应（流式） | <3s | ~2.2s | ✅ |
| `cc skill list` 四层加载 | <500ms | ~350ms | ✅ |
| `cc serve` WebSocket 启动 | <1s | ~700ms | ✅ |
| 全部 2063 测试执行时间 | <120s | ~95s | ✅ |

## 相关文档

- [CLI 分发系统](/chainlesschain/cli-distribution) — 分发架构与 CI/CD
- [项目初始化 (init)](/chainlesschain/cli-init) — 项目结构初始化与模板
- [多智能体协作 (cowork)](/chainlesschain/cli-cowork) — 多视角辩论、A/B 对比、代码分析
- [DID 身份 (CLI)](/chainlesschain/cli-did) — Ed25519 签名/验证
- [文件加密 (CLI)](/chainlesschain/cli-encrypt) — AES-256-GCM 加密/解密
- [RBAC 权限 (CLI)](/chainlesschain/cli-auth) — 角色与权限管理
- [DAO 治理 (CLI)](/chainlesschain/cli-dao) — 二次方投票与国库管理
- [合规管理 (CLI)](/chainlesschain/cli-compliance) — GDPR/SOC2/HIPAA/ISO27001
- [数据防泄漏 (CLI)](/chainlesschain/cli-dlp) — DLP 扫描与策略管理
- [SIEM 集成 (CLI)](/chainlesschain/cli-siem) — Splunk/ES/Azure 日志导出
- [后量子密码 (CLI)](/chainlesschain/cli-pqc) — ML-KEM/ML-DSA 密钥管理
- [Nostr 桥接 (CLI)](/chainlesschain/cli-nostr) — NIP-01 事件/密钥生成
- [Matrix 桥接 (CLI)](/chainlesschain/cli-matrix) — E2EE 消息/房间管理
- [SCIM 配置 (CLI)](/chainlesschain/cli-scim) — SCIM 2.0 用户配置
- [Terraform (CLI)](/chainlesschain/cli-terraform) — 基础设施编排
- [安全加固 (CLI)](/chainlesschain/cli-hardening) — 性能基线与审计
- [社交平台 (CLI)](/chainlesschain/cli-social) — 联系人/好友/动态/聊天
- [WebSocket 服务器 (CLI)](/chainlesschain/cli-serve) — WebSocket 远程调用全部 CLI 命令

## 快速开始

```bash
npm install -g chainlesschain
chainlesschain setup
chainlesschain start
```

> **短命令别名**: 安装后可使用 `cc`、`clc` 或 `clchain` 代替 `chainlesschain`，例如 `cc setup`、`clchain start`。四个命令完全等价。

## 系统要求

- **Node.js** >= 22.12.0
- **Docker** (可选，用于后端服务)

## 安装

### 全局安装

```bash
npm install -g chainlesschain
```

安装后提供 3 个等价命令：

| 命令             | 说明                                  |
| ---------------- | ------------------------------------- |
| `chainlesschain` | 完整名称                              |
| `cc`             | 最短别名，日常使用推荐                |
| `clc`            | ChainLessChain 缩写，避免与 C 编译器冲突 |
| `clchain`        | chainlesschain 缩写，较易辨识         |

### 验证安装

```bash
chainlesschain --version   # 或 cc --version / clc --version / clchain --version
chainlesschain doctor      # 或 cc doctor
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

全面检查运行环境，识别潜在问题。

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
| `dao`              | DAO 治理 v2 (二次方投票/委托/国库)           | [DAO治理](./cli-dao)         |
| `compliance`       | 合规管理 (GDPR/SOC2/HIPAA/ISO27001)         | [合规管理](./cli-compliance) |
| `dlp`              | 数据防泄漏 (正则扫描/策略管理)               | [数据防泄漏](./cli-dlp)     |
| `siem`             | SIEM 日志导出 (Splunk/ES/Azure)              | [SIEM集成](./cli-siem)      |
| `pqc`              | 后量子密码 (ML-KEM/ML-DSA/混合模式)          | [后量子密码](./cli-pqc)     |
| `nostr`            | Nostr 桥接 (NIP-01/密钥生成/DID映射)        | [Nostr桥接](./cli-nostr)    |
| `matrix`           | Matrix 桥接 (E2EE/房间管理)                  | [Matrix桥接](./cli-matrix)  |
| `scim`             | SCIM 2.0 用户配置/连接器管理                 | [SCIM配置](./cli-scim)      |
| `terraform`        | 基础设施编排 (工作区/Plan/Apply)             | [Terraform](./cli-terraform) |
| `hardening`        | 安全加固 (性能基线/回归检测/审计)            | [安全加固](./cli-hardening)  |
| `social`           | 社交平台 (联系人/好友/动态/即时聊天)         | [社交平台](./cli-social)     |
| `serve`            | WebSocket 服务器 (远程CLI调用/流式/认证)     | [WebSocket服务器](./cli-serve) |
| `ui`               | Web 管理界面 (浏览器端/项目&全局模式)        | [Web管理界面](./cli-ui)       |

---

## 核心包架构

Headless 命令依赖 5 个独立核心包（118 个核心包测试 + 1945 个 CLI 测试 = 2063 个测试全部通过）：

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

CLI 包包含 2009 个测试（118 核心包测试 + 1842 CLI 测试），全部通过：

| 测试类型 | 文件数 | 测试数 | 说明 |
|---------|--------|--------|------|
| 单元测试 | 55+ | 1500+ | 各模块功能测试 |
| 集成测试 | 5+ | 80+ | 模块间协作测试 |
| E2E 测试 | 14 | 200+ | 端到端命令测试 |

```bash
cd packages/cli
npm test                   # 运行全部 2063 测试
npm run test:unit          # 仅单元测试
npm run test:integration   # 仅集成测试
npm run test:e2e           # 仅端到端测试
```

## 使用示例

### 全新安装与首次配置

```bash
# 安装 CLI 工具
npm install -g chainlesschain

# 运行交互式设置向导（选择版本、LLM 提供商、下载二进制）
chainlesschain setup

# 启动桌面应用
chainlesschain start

# 检查所有服务状态
chainlesschain status
```

### 日常系统诊断

```bash
# 全面环境检查（Node.js、Docker、端口、磁盘等）
chainlesschain doctor

# 查看服务日志排查问题
chainlesschain services logs -f

# 更新到最新版本
chainlesschain update
```

### Headless 模式（无 GUI 服务器场景）

```bash
# 初始化数据库
chainlesschain db init

# 添加笔记并搜索
chainlesschain note add "会议纪要" -c "讨论内容..." -t "工作,会议"
chainlesschain note search "会议"

# AI 对话
chainlesschain chat --agent
```

---

## 故障排查

### 安装后命令找不到

确保 npm 全局 bin 目录在系统 PATH 中：

```bash
npm config get prefix
# 将输出路径下的 bin/ 目录添加到 PATH 环境变量
# Windows: 添加到系统环境变量 Path
# Linux/macOS: export PATH="$(npm config get prefix)/bin:$PATH"
```

### 命令执行权限不足

```bash
# Linux/macOS 权限问题
sudo chown -R $(whoami) $(npm config get prefix)/{lib/node_modules,bin,share}

# Windows 以管理员身份运行终端
```

### 下载二进制文件失败

```bash
# 使用代理下载
HTTPS_PROXY=http://proxy:port chainlesschain setup

# 或手动下载后放到配置目录
# 从 GitHub Releases 下载对应平台的二进制文件
# 放到 ~/.chainlesschain/bin/ 目录下
```

### Docker 服务无法启动

```bash
# 检查 Docker 是否运行
docker info

# 检查端口占用
chainlesschain doctor

# 查看容器日志定位错误
chainlesschain services logs
```

---

## 安全考虑

- API Key 存储在本地 `~/.chainlesschain/config.json`，建议设置文件权限 600
- 数据库支持 SQLCipher AES-256 加密（`chainlesschain encrypt db`）
- 所有操作记录审计日志，支持敏感数据自动脱敏
- 二进制下载通过 HTTPS + SHA-256 校验和验证
- 使用 Ollama 本地模型时数据完全离线

## 关键文件

- `packages/cli/bin/chainlesschain.js` — npm bin 入口（`chainlesschain`、`cc`、`clc`、`clchain` 四个命令共享此入口）
- `packages/cli/src/index.js` — Commander 命令注册（主入口）
- `packages/cli/src/commands/` — 所有命令实现（63 个命令文件）
- `packages/cli/src/lib/` — 共享库（68 个模块）
- `packages/cli/src/lib/cowork/` — 多智能体协作模块（5 个）
- `packages/cli/src/repl/` — 交互式 REPL（chat/agent + /cowork）
- `packages/cli/src/runtime/bootstrap.js` — 7 阶段 Headless 初始化

## 卸载

```bash
npm uninstall -g chainlesschain   # 同时移除 cc、clc、clchain 别名
rm -rf ~/.chainlesschain
```
