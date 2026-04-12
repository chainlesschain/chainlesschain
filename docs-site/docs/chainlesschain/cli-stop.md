# 停止应用 (stop)

> 停止 ChainlessChain 桌面应用和/或 Docker 后端服务。

## 概述

`stop` 命令用于优雅停止 ChainlessChain 桌面应用和/或 Docker 后端服务。默认仅停止桌面应用，通过 `--services` 仅停止 Docker 服务，通过 `--all` 同时停止两者。停止前会自动检测运行状态，未运行时给出友好提示。

## 核心特性

- 🔹 **停止应用**: 停止桌面 Electron 应用进程
- 🔹 **停止服务**: 仅停止 Docker 后端服务
- 🔹 **全部停止**: 同时停止应用和 Docker 服务
- 🔹 **状态检测**: 自动检测应用运行状态，未运行时友好提示

## 系统架构

```
stop 命令 → stop.js (Commander) → process-manager + service-manager
                                        │
                   ┌────────────────────┼────────────────────┐
                   ▼                    ▼                    ▼
              默认模式            --services 模式        --all 模式
                   │                    │                    │
                   ▼                    ▼                    ▼
            停止桌面应用          停止 Docker 服务     停止应用 + Docker
            stopApp()            servicesDown()       两者均执行
```

## 命令参考

```bash
chainlesschain stop                # 停止桌面应用
chainlesschain stop --services     # 仅停止 Docker 服务
chainlesschain stop --all          # 停止应用 + Docker 服务
```

## 选项说明

| 选项 | 说明 |
|------|------|
| `--services` | 仅停止 Docker 后端服务，不停止桌面应用 |
| `--all` | 同时停止桌面应用和 Docker 后端服务 |

## 行为说明

| 选项组合 | 停止桌面应用 | 停止 Docker 服务 |
|----------|:----------:|:---------------:|
| (无选项) | 是 | 否 |
| `--services` | 否 | 是 |
| `--all` | 是 | 是 |

## 关键文件

- `packages/cli/src/commands/stop.js` — 命令实现
- `packages/cli/src/lib/process-manager.js` — 进程管理（停止、检测）
- `packages/cli/src/lib/service-manager.js` — Docker 服务管理

## 安全考虑

- 停止操作为优雅停止（graceful shutdown），不会强制杀死进程
- Docker 服务停止通过 `docker-compose down`，容器数据卷保留
- 停止前自动检查运行状态，未运行时不执行操作

## 使用示例

### 场景 1：停止桌面应用

```bash
chainlesschain stop
```

仅停止桌面 Electron 应用进程，Docker 后端服务继续运行。

### 场景 2：仅停止后端服务

```bash
chainlesschain stop --services
```

停止 Docker 后端服务（PostgreSQL、Redis、Ollama 等），桌面应用继续运行。适合释放系统资源。

### 场景 3：完全停止所有组件

```bash
chainlesschain stop --all
```

同时停止桌面应用和所有 Docker 后端服务，完全释放资源。

## 故障排查

| 问题 | 解决方案 |
|------|---------|
| `ChainlessChain is not running` | 应用未运行，无需停止 |
| `Docker not available` | Docker Desktop 未运行，无法停止 Docker 服务 |
| `docker-compose.yml not found` | 在项目根目录下运行，或确认 `backend/docker` 目录存在 |
| 停止后端口仍被占用 | 可能有其他进程占用端口，使用 `chainlesschain status` 检查 |

## 相关文档

- [启动应用](./cli-start) — 启动桌面应用
- [系统状态](./cli-status) — 查看运行状态
- [Docker 服务](./cli-services) — 服务管理
