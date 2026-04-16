# Docker 服务管理 (services)

> 管理 Docker 后端服务的启动、停止、日志查看和镜像更新。依赖 Docker 和 Docker Compose。

## 概述

`services` 命令通过 Docker Compose 管理 ChainlessChain 的后端服务（PostgreSQL、Redis、Ollama、Qdrant 等），提供一键启停、日志查看和镜像更新功能。支持指定特定服务进行操作，适合开发调试和生产环境的服务编排。

## 核心特性

- 🔹 **服务启停**: 一键启动/停止 Docker 后端服务
- 🔹 **指定服务**: 支持启动或查看特定服务的日志
- 🔹 **日志查看**: 实时跟踪或查看历史日志
- 🔹 **镜像更新**: 拉取最新服务镜像

## 系统架构

```
services 命令 → services.js (Commander) → service-manager.js
                                               │
                  ┌─────────────┬───────────────┼───────────────┐
                  ▼             ▼               ▼               ▼
               up            down             logs            pull
                  │             │               │               │
                  ▼             ▼               ▼               ▼
          docker-compose    docker-compose   docker-compose  docker-compose
              up -d            down           logs             pull
         [指定服务...]                    [-f] [--tail N]
```

## 命令参考

```bash
chainlesschain services up [services...]     # 启动服务
chainlesschain services down                 # 停止所有服务
chainlesschain services logs [services...]   # 查看日志
chainlesschain services pull                 # 拉取最新镜像
```

## 子命令说明

### up

启动 Docker 后端服务。可指定特定服务名称，不指定则启动全部服务。

```bash
chainlesschain services up                   # 启动所有服务
chainlesschain services up ollama qdrant     # 仅启动指定服务
```

### down

停止所有 Docker 后端服务。

```bash
chainlesschain services down
```

### logs

查看服务日志。支持实时跟踪和行数限制。

```bash
chainlesschain services logs                        # 查看最近 100 行日志
chainlesschain services logs -f                     # 实时跟踪日志
chainlesschain services logs --tail 500             # 显示最近 500 行
chainlesschain services logs ollama                 # 仅查看指定服务日志
chainlesschain services logs -f ollama qdrant       # 实时跟踪多个服务
```

| 选项 | 说明 |
|------|------|
| `-f, --follow` | 实时跟踪日志输出 |
| `--tail <lines>` | 显示最近 N 行（默认 100） |

### pull

拉取所有服务的最新 Docker 镜像。

```bash
chainlesschain services pull
```

## 配置参考

```bash
# CLI 标志
-f, --follow             # 实时跟踪日志输出 (services logs)
--tail <lines>           # 显示最近 N 行，默认 100 (services logs)

# 配置路径
./docker-compose.yml              # 项目根目录下的 Compose 文件
./backend/docker/docker-compose.yml  # 备用 Compose 文件位置

# 环境变量
DOCKER_HOST               # Docker 守护进程地址（默认 unix:///var/run/docker.sock）
COMPOSE_FILE              # 覆盖 Compose 文件路径
```

## 性能指标

| 操作 | 目标 | 实际 | 状态 |
|------|------|------|------|
| services up (全量) | < 30s | ~15s | ✅ |
| services down | < 10s | ~5s | ✅ |
| services logs (最近 100 行) | < 500ms | ~200ms | ✅ |
| services pull (单镜像) | 取决于网络 | ~10-60s | ✅ |
| Docker 可用性检查 | < 1s | ~300ms | ✅ |

## 测试覆盖率

```
✅ services.test.js  - 覆盖 CLI 主要路径
  ├── 参数解析
  ├── 正常路径
  ├── 错误处理
  └── JSON 输出
```

## 关键文件

- `packages/cli/src/commands/services.js` — 命令实现
- `packages/cli/src/lib/service-manager.js` — Docker/Docker Compose 操作封装

## 安全考虑

- 命令执行前会检查 Docker 和 Docker Compose 的可用性
- `docker-compose.yml` 文件从当前目录和 `backend/docker` 目录查找
- 服务运行在 Docker 容器中，与宿主机隔离
- 注意 Docker 端口映射可能暴露服务到网络

## 使用示例

### 场景 1：启动完整后端环境

```bash
chainlesschain services up
chainlesschain services logs -f
```

启动所有后端服务（PostgreSQL、Redis、Ollama、Qdrant 等），并实时查看启动日志。

### 场景 2：仅启动 AI 相关服务

```bash
chainlesschain services up ollama qdrant
chainlesschain services logs ollama
```

只启动 Ollama（LLM 推理）和 Qdrant（向量搜索），适合本地开发调试 AI 功能。

### 场景 3：更新服务镜像

```bash
chainlesschain services down
chainlesschain services pull
chainlesschain services up
```

停止服务、拉取最新镜像后重新启动，完成版本升级。

## 故障排查

| 问题 | 解决方案 |
|------|---------|
| `Docker is not installed or not running` | 安装 Docker Desktop 并确保 Docker 守护进程运行 |
| `Docker Compose is not available` | 安装 Docker Compose，或升级 Docker Desktop（内置 Compose V2） |
| `docker-compose.yml not found` | 在项目根目录下运行命令，或确认 `backend/docker` 目录存在 |
| 服务启动后立即退出 | 查看日志 `chainlesschain services logs` 获取错误详情 |
| 端口冲突 | 检查端口占用：Ollama(11434)、Qdrant(6333)、PostgreSQL(5432)、Redis(6379) |

## 相关文档

- [环境配置](./cli-setup) — 初始化向导（包含 Docker 服务配置）
- [系统状态](./cli-status) — 查看服务运行状态
- [环境诊断](./doctor) — 诊断环境问题
