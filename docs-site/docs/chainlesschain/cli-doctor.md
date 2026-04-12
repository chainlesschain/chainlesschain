# doctor 命令

> 诊断 ChainlessChain 运行环境 — 检查依赖、配置、端口和磁盘状态

## 概述

`doctor` 命令对 ChainlessChain 的运行环境进行全面诊断，自动检查 Node.js、Docker、Git 等依赖是否就绪，验证配置目录和文件状态，扫描关键服务端口的运行情况。检查完成后会汇总关键问题和可选组件缺失，并给出对应的修复建议。

## 核心特性

- 🔹 **环境检测**: 检查 Node.js、npm、Git、Docker 等依赖是否就绪
- 🔹 **配置验证**: 验证配置目录、配置文件和桌面应用二进制文件
- 🔹 **端口扫描**: 检测所有服务端口的运行状态
- 🔹 **磁盘检查**: 显示可用磁盘空间（Node.js 22+ 支持）
- 🔹 **问题汇总**: 区分关键问题和可选组件缺失，给出修复建议

## 系统架构

```
chainlesschain doctor
    │
    ├── 环境检查
    │   ├── Node.js 版本 ≥ MIN_NODE_VERSION?
    │   ├── npm 是否可用?
    │   ├── Docker / Docker Compose 是否安装?  (可选)
    │   └── Git 是否可用?
    │
    ├── 配置检查
    │   ├── 配置目录是否存在?       (~/.chainlesschain/)
    │   ├── 配置文件是否存在?       (config.json)
    │   ├── 桌面应用二进制是否存在?
    │   └── setup 是否已完成?
    │
    ├── 端口扫描
    │   └── TCP connect 探测每个 DEFAULT_PORTS
    │       ● 运行中  ○ 未运行
    │
    ├── 磁盘检查  (Node.js 22+)
    │   └── statfsSync() → 可用空间 > 2GB?
    │
    └── 汇总报告
        ├── ✔ All checks passed!
        ├── ⚠ N optional component(s) missing
        └── ✖ N issue(s) found
```

## 用法

```bash
chainlesschain doctor
```

此命令没有子命令或选项，运行后自动执行全部检查。

## 检查项目

### 环境依赖

| 检查项 | 说明 | 必需 |
|--------|------|------|
| Node.js | 版本需满足最低要求 | 是 |
| npm | 包管理器 | 是 |
| Docker | 容器运行时 | 否（可选） |
| Docker Compose | 容器编排 | 否（可选） |
| Git | 版本控制 | 是 |

### 配置状态

| 检查项 | 说明 |
|--------|------|
| Config dir | `~/.chainlesschain/` 是否存在 |
| Config file | `config.json` 是否存在 |
| Desktop binary | 桌面应用可执行文件是否已下载 |
| Setup completed | `config.setupCompleted` 是否为 true |

### 默认端口

| 服务 | 端口 |
|------|------|
| Vite Dev | 5173 |
| Signaling | 9001 |
| Ollama | 11434 |
| Qdrant | 6333 |
| PostgreSQL | 5432 |
| Redis | 6379 |

## 关键文件

- `packages/cli/src/commands/doctor.js` — 命令实现，包含所有检查逻辑
- `packages/cli/src/constants.js` — `MIN_NODE_VERSION`、`DEFAULT_PORTS`、`VERSION` 常量
- `packages/cli/src/lib/paths.js` — `getHomeDir()`、`getConfigPath()`、`getBinDir()` 路径工具
- `packages/cli/src/lib/service-manager.js` — `isDockerAvailable()`、`isDockerComposeAvailable()` 检测
- `packages/cli/src/lib/config-manager.js` — `loadConfig()` 读取配置

## 安全考虑

- 端口扫描仅连接 `127.0.0.1`（本地回环），不会扫描远程主机
- 不会读取或显示配置文件的具体内容，仅检查文件是否存在
- 使用 `execSync` 执行 `npm --version` 和 `git --version`，均指定 `encoding: "utf-8"`

## 使用示例

### 场景 1：快速环境诊断

```bash
chainlesschain doctor
```

输出示例：
```
  ChainlessChain Doctor

  ✔ Node.js 20.11.0
  ✔ npm 10.2.4
  ✖ Docker (Not installed (optional))
  ✖ Docker Compose (Not installed (optional))
  ✔ git version 2.43.0
  ✔ Config dir: /home/user/.chainlesschain
  ✔ Config file
  ✖ Desktop binary (Run "chainlesschain setup" or "chainlesschain update")
  ✔ Setup completed

  Port Status

  ○ vite: 5173
  ○ signaling: 9001
  ● ollama: 11434
  ○ qdrant: 6333
  ○ postgres: 5432
  ○ redis: 6379

  2 optional component(s) missing.
```

### 场景 2：首次安装后检查

```bash
chainlesschain setup
chainlesschain doctor
```

### 场景 3：服务启动前验证

```bash
chainlesschain doctor && chainlesschain start
```

## 故障排查

| 问题 | 解决方案 |
|------|---------|
| Node.js 版本不满足 | 使用 nvm 安装更高版本：`nvm install 20` |
| Config dir 不存在 | 运行 `chainlesschain setup` |
| Desktop binary 缺失 | 运行 `chainlesschain setup` 或 `chainlesschain update` |
| 端口显示未运行 | 启动对应服务：`chainlesschain services up` |
| 磁盘空间不足（< 2GB） | 清理不需要的文件，LLM 模型占用较大空间 |

## 相关文档

- [setup 命令](./cli-setup) — 交互式安装向导
- [status 命令](./cli-status) — 查看运行状态
- [config 命令](./cli-config) — 配置管理
