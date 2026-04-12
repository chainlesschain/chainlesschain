# 系统状态 (status)

> 查看 ChainlessChain 桌面应用、Docker 服务和端口的运行状态，提供系统全局健康概览。

## 概述

`status` 命令提供系统全局健康概览，同时检查桌面应用运行状态、Docker 容器服务状态和关键服务端口的连通性。输出包含应用 PID、配置信息、各容器运行情况以及 Ollama、Qdrant、PostgreSQL 等服务端口的可达性检测结果。

## 核心特性

- 🔹 **应用状态**: 检测桌面应用是否运行及其 PID
- 🔹 **配置信息**: 显示 setup 完成状态、版本选择和 LLM 配置
- 🔹 **Docker 服务**: 显示各 Docker 容器的运行状态
- 🔹 **端口检测**: 检查关键服务端口的可用性

## 系统架构

```
status 命令 → status.js (Commander) → 多维状态检查
                                          │
               ┌──────────────────────────┼──────────────────────────┐
               ▼                          ▼                          ▼
          App 状态                   Docker 服务                  端口检测
               │                          │                          │
               ▼                          ▼                          ▼
        process-manager             docker-compose ps          TCP 连接测试
        isAppRunning()             getServiceStatus()          checkPort()
        getAppPid()                                         DEFAULT_PORTS 遍历
               │
               ▼
        config-manager
        setupCompleted / edition / llm
```

## 命令参考

```bash
chainlesschain status    # 显示完整系统状态
```

## 输出说明

状态命令输出分为三个部分：

### App Status（应用状态）

- 桌面应用运行状态及 PID
- Setup 完成状态及完成时间
- Edition（版本）和 LLM 配置信息

### Docker Services（Docker 服务）

- 各容器的名称和运行状态（running/stopped）
- Docker 不可用时显示提示信息

### Ports（端口检测）

检查以下默认端口的连通性：

| 服务 | 端口 |
|------|------|
| Vite Dev | 5173 |
| Signaling | 9001 |
| Ollama | 11434 |
| Qdrant | 6333 |
| PostgreSQL | 5432 |
| Redis | 6379 |

状态图标：`●` (绿色=运行/可达) `●` (红色=异常) `○` (灰色=未运行/不可达) `●` (黄色=警告)

## 关键文件

- `packages/cli/src/commands/status.js` — 命令实现
- `packages/cli/src/lib/process-manager.js` — 进程状态检测
- `packages/cli/src/lib/service-manager.js` — Docker 服务状态查询
- `packages/cli/src/lib/config-manager.js` — 配置信息读取
- `packages/cli/src/constants.js` — DEFAULT_PORTS 端口定义

## 安全考虑

- 端口检测通过本地 TCP 连接（127.0.0.1），超时时间 1 秒
- 仅读取本地状态信息，不发送任何数据到外部
- 配置中的 API 密钥不会在状态输出中显示

## 使用示例

### 场景 1：日常状态检查

```bash
chainlesschain status
```

查看应用运行状态、Docker 服务健康度和端口可用性，快速定位问题。

### 场景 2：启动前环境确认

```bash
chainlesschain status
chainlesschain start --services
```

在启动应用前先检查状态，确认服务是否已经在运行。

### 场景 3：排查连接问题

```bash
chainlesschain status
```

通过端口检测部分确认 Ollama、Qdrant、PostgreSQL 等服务是否可达，定位连接失败原因。

## 故障排查

| 问题 | 解决方案 |
|------|---------|
| 端口显示不可达但服务已启动 | 检查服务是否绑定了正确的端口和地址 |
| Docker 服务状态不显示 | 确认 Docker Desktop 运行中且 `docker-compose.yml` 可找到 |
| `Setup not completed` | 运行 `chainlesschain setup` 完成配置 |
| 所有端口均不可达 | 检查防火墙设置，确认服务已启动 |

## 相关文档

- [启动应用](./cli-start) — 启动桌面应用
- [Docker 服务](./cli-services) — 管理后端服务
- [环境诊断](./doctor) — 深度环境诊断
- [配置向导](./cli-setup) — 初始配置
