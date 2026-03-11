# 模块66: CLI 分发系统

## 1. 模块概述

### 1.1 设计目标

提供轻量级 npm CLI 工具，让开发者通过 `npm install -g chainlesschain && chainlesschain setup` 一条命令即可安装、配置和管理 ChainlessChain 系统，替代传统的平台特定安装包下载流程。

### 1.2 核心定位

| 维度         | 说明                                                                                      |
| ------------ | ----------------------------------------------------------------------------------------- |
| **角色**     | 薄编排层（~2MB 纯 JS），不包含原生模块                                                    |
| **职责**     | 下载预构建二进制、管理配置、编排 Docker 服务、管理桌面应用进程                            |
| **关键差异** | 与 OpenClaw 等无头网关不同，ChainlessChain 是 GUI Electron 应用，CLI 是辅助工具而非运行时 |

### 1.3 设计约束

- **纯 JS 依赖**：不使用 better-sqlite3、sharp 等原生模块（npm 全局安装无法编译）
- **ES Module**：`"type": "module"`，Node 22 原生 ESM；chalk v5/ora v8 需要 ESM
- **独立配置目录**：CLI 使用 `~/.chainlesschain/`，与 Electron userData 分离
- **无 daemon**：ChainlessChain 是 GUI 应用，Docker 处理后端持久化

## 2. 架构设计

### 2.1 目录结构

```
packages/cli/
├── bin/chainlesschain.js          # 入口 (#!/usr/bin/env node)
├── src/
│   ├── index.js                   # Commander 程序，注册所有命令
│   ├── constants.js               # Release URL、端口、版本、默认配置
│   ├── commands/                  # 8 个命令模块
│   │   ├── setup.js               # 交互式安装向导
│   │   ├── start.js               # 启动应用 (--headless)
│   │   ├── stop.js                # 停止应用 (--services, --all)
│   │   ├── status.js              # 状态报告
│   │   ├── services.js            # Docker Compose 管理
│   │   ├── config.js              # 配置 CRUD
│   │   ├── update.js              # 更新管理
│   │   └── doctor.js              # 环境诊断
│   └── lib/                       # 10 个库模块
│       ├── platform.js            # OS/arch 检测，二进制名称映射
│       ├── paths.js               # ~/.chainlesschain/ 路径解析
│       ├── downloader.js          # GitHub Release 下载 + SHA256 校验
│       ├── process-manager.js     # 通过 PID 文件管理 Electron 进程
│       ├── service-manager.js     # Docker Compose 编排
│       ├── config-manager.js      # config.json 读写（兼容 InitialSetupConfig）
│       ├── version-checker.js     # GitHub API 版本比较
│       ├── logger.js              # 控制台日志 (--verbose/--quiet)
│       ├── prompts.js             # 交互式提示封装
│       └── checksum.js            # SHA256 校验
├── __tests__/
│   ├── unit/                      # 8 个单元测试文件
│   ├── integration/               # 3 个集成测试文件
│   └── e2e/                       # 2 个端到端测试文件
├── vitest.config.js
├── package.json
└── README.md
```

### 2.2 依赖关系

```
bin/chainlesschain.js
  └─ src/index.js (Commander)
       ├─ commands/setup.js ──┐
       ├─ commands/start.js   │
       ├─ commands/stop.js    │
       ├─ commands/status.js  ├─► lib/platform.js
       ├─ commands/services.js│   lib/paths.js
       ├─ commands/config.js  │   lib/config-manager.js
       ├─ commands/update.js  │   lib/downloader.js
       └─ commands/doctor.js ─┘   lib/process-manager.js
                                  lib/service-manager.js
                                  lib/version-checker.js
                                  lib/checksum.js
                                  lib/logger.js
                                  lib/prompts.js
```

### 2.3 技术栈

| 组件     | 选型              | 版本 | 理由                   |
| -------- | ----------------- | ---- | ---------------------- |
| CLI 框架 | commander         | ^12  | 成熟、轻量、零原生依赖 |
| 交互提示 | @inquirer/prompts | ^7   | ESM 原生、类型友好     |
| 颜色输出 | chalk             | ^5   | ESM only、零依赖       |
| 进度指示 | ora               | ^8   | spinner + 进度条       |
| 版本比较 | semver            | ^7   | npm 标准               |

## 3. 核心模块设计

### 3.1 平台检测 (platform.js)

```js
getPlatform(); // → 'win32' | 'darwin' | 'linux'
getArch(); // → 'x64' | 'arm64'
getBinaryName(v); // → 'chainlesschain-desktop-vue-{v}-win-x64.exe'
```

二进制命名映射表：

| 平台   | 架构  | 文件名模板                                     |
| ------ | ----- | ---------------------------------------------- |
| win32  | x64   | `chainlesschain-desktop-vue-{v}-win-x64.exe`   |
| darwin | x64   | `chainlesschain-desktop-vue-{v}-mac-x64.dmg`   |
| darwin | arm64 | `chainlesschain-desktop-vue-{v}-mac-arm64.dmg` |
| linux  | x64   | `chainlesschain-desktop-vue-{v}-linux-x64.deb` |

### 3.2 路径管理 (paths.js)

```
~/.chainlesschain/
├── config.json        # 配置文件
├── bin/               # 下载的二进制
├── state/             # 运行状态
│   └── app.pid        # 桌面应用 PID
├── services/          # 服务配置
├── logs/              # CLI 日志
└── cache/             # 下载缓存
```

与 Electron userData 的路径映射：

| 路径 | CLI                             | Electron (Win)                                                     | Electron (Mac)                                                                         |
| ---- | ------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| 配置 | `~/.chainlesschain/config.json` | `%APPDATA%/chainlesschain-desktop-vue/.chainlesschain/config.json` | `~/Library/Application Support/chainlesschain-desktop-vue/.chainlesschain/config.json` |

### 3.3 配置管理 (config-manager.js)

配置结构与 `desktop-app-vue/src/main/config/initial-setup-config.js` 兼容：

```json
{
  "setupCompleted": true,
  "completedAt": "2026-03-11T00:00:00.000Z",
  "edition": "personal | enterprise",
  "llm": {
    "provider": "ollama | openai | dashscope | deepseek | custom",
    "apiKey": "string | null",
    "baseUrl": "string",
    "model": "string"
  },
  "enterprise": {
    "serverUrl": "string | null",
    "apiKey": "string | null",
    "tenantId": "string | null"
  },
  "services": {
    "autoStart": false,
    "dockerComposePath": "string | null"
  },
  "update": {
    "channel": "stable | beta | dev",
    "autoCheck": true
  }
}
```

**配置优先级**：环境变量 > config.json > 默认值

**API**：

- `loadConfig()` — 读取并合并默认值
- `saveConfig(config)` — 写入 JSON
- `getConfigValue(key)` — 点号路径读取（如 `llm.provider`）
- `setConfigValue(key, value)` — 点号路径写入，自动类型转换

### 3.4 下载管理 (downloader.js)

```
GitHub Release API → 解析 asset URL → fetch 下载 → 流式写入 → SHA256 校验
```

**流程**：

1. 通过 `GITHUB_RELEASES_URL/tags/v{version}` 获取 release 信息
2. 匹配平台对应的 asset（`getBinaryName()` 生成文件名）
3. 使用 `fetch()` 流式下载，实时显示进度
4. 可选 SHA256 校验（`verifySha256()`）
5. 写入 `~/.chainlesschain/bin/`

### 3.5 进程管理 (process-manager.js)

```
startApp() → spawn(detached) → 写 PID 文件
stopApp()  → 读 PID → SIGTERM (Unix) / taskkill (Windows) → 删 PID 文件
isAppRunning() → 读 PID → process.kill(pid, 0) 探测
```

### 3.6 服务管理 (service-manager.js)

封装 `docker compose` / `docker-compose` 命令：

- `servicesUp(composePath)` — `docker compose -f {path} up -d`
- `servicesDown(composePath)` — `docker compose -f {path} down`
- `servicesLogs(composePath, opts)` — 流式日志
- `getServiceStatus(composePath)` — JSON 格式服务状态

自动检测 `docker compose` v2 或 `docker-compose` v1。

## 4. 命令设计

### 4.1 setup — 安装向导

```
chainlesschain setup [--skip-download] [--skip-services]
```

**交互流程**：

```
1. [检查] Node.js >= 22.12.0
2. [检查] Docker 可用性
3. [选择] 版本：个人版 / 企业版
4. [选择] LLM 提供商
5. [输入] API Key（云端提供商）
6. [下载] 平台二进制文件
7. [保存] ~/.chainlesschain/config.json
8. [可选] 启动 Docker 服务
```

### 4.2 doctor — 环境诊断

检查项：Node.js、npm、Docker、Docker Compose、Git、配置目录、配置文件、二进制文件、Setup 状态、端口占用、磁盘空间。

### 4.3 命令总览

| 命令       | 说明        | 关键选项                              |
| ---------- | ----------- | ------------------------------------- |
| `setup`    | 交互式安装  | `--skip-download`, `--skip-services`  |
| `start`    | 启动应用    | `--headless`, `--services`            |
| `stop`     | 停止应用    | `--services`, `--all`                 |
| `status`   | 状态报告    | —                                     |
| `services` | Docker 管理 | `up`, `down`, `logs`, `pull`          |
| `config`   | 配置管理    | `list`, `get`, `set`, `edit`, `reset` |
| `update`   | 更新管理    | `--check`, `--channel`, `--force`     |
| `doctor`   | 环境诊断    | —                                     |

## 5. CI/CD 集成

### 5.1 npm 自动发布

在 `.github/workflows/release.yml` 的 `create-release` 后执行 `publish-cli` job：

```yaml
publish-cli:
  needs: [create-release]
  steps:
    - Setup Node.js + registry-url: npmjs.org
    - npm ci + vitest run (测试通过)
    - 从 git tag 同步 package.json 版本
    - 检查版本是否已发布（避免重复）
    - npm publish --provenance --access public
```

**安全措施**：

- `--provenance` 启用 npm 供应链安全证明
- 版本重复检查防止发布冲突
- 兼容 tag push 和 `workflow_dispatch` 两种触发方式

### 5.2 CI 测试

`.github/workflows/cli-ci.yml`：

- **触发**：`packages/cli/**` 路径变更时
- **矩阵**：Ubuntu + Windows + macOS
- **测试**：unit → integration → E2E
- **PR 检查**：`npm publish --dry-run` 验证包结构

## 6. 测试策略

### 6.1 测试分层

| 层次     | 文件数 | 测试数 | 覆盖范围                                                                                                 |
| -------- | ------ | ------ | -------------------------------------------------------------------------------------------------------- |
| 单元测试 | 8      | 51     | platform, paths, config-manager, checksum, downloader, version-checker, process-manager, service-manager |
| 集成测试 | 3      | 7      | setup-flow, update-flow, service-lifecycle                                                               |
| E2E 测试 | 2      | 8      | install-and-run, cross-platform                                                                          |
| **合计** | **13** | **66** | —                                                                                                        |

### 6.2 测试工具

- **Vitest** — ES module 原生支持
- `vi.doMock()` — 延迟模块 mock（避免 ESM 提升问题）
- `vi.stubGlobal('fetch', ...)` — mock 网络请求
- 临时目录 (`mkdtempSync`) — 隔离文件系统操作

## 7. 版本策略

CLI 版本与主项目版本同步（当前 `0.37.6`）。Release workflow 自动从 git tag 提取版本号写入 `package.json`。

更新通道：

- **stable** — 仅正式版
- **beta** — 包含预发布版
- **dev** — 包含所有版本（含草稿）

## 8. 设计决策记录

| 决策                                          | 理由                                               |
| --------------------------------------------- | -------------------------------------------------- |
| 纯 JS CLI，二进制延迟到 setup 下载            | npm 全局安装无法编译原生模块                       |
| 不引入 daemon/launchd/systemd                 | ChainlessChain 是 GUI 应用，Docker 处理后端持久化  |
| `~/.chainlesschain/` 独立于 Electron userData | CLI 无需 Electron 即可工作；setup 可种子化两个位置 |
| ES Modules (`"type": "module"`)               | Node 22 原生 ESM，chalk v5/ora v8 要求             |
| GitHub Releases 作为二进制源                  | 已使用 electron-builder + GitHub publishing        |
