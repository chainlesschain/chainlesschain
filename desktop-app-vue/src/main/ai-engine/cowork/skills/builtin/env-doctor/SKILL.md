---
name: env-doctor
display-name: Environment Doctor
description: 环境诊断技能 - 运行时检测、端口检查、服务健康、一键修复
version: 1.0.0
category: devops
user-invocable: true
tags: [environment, doctor, diagnostics, port, docker, health, setup]
capabilities:
  [runtime-detection, port-check, service-health, config-validation, auto-fix]
tools:
  - file_reader
  - command_executor
instructions: |
  Use this skill when the user needs to diagnose their development environment,
  check if all required services are running, or troubleshoot setup issues.
  Verify Node.js, Java, Python, Docker, Ollama, Qdrant, PostgreSQL, and Redis
  availability. Check all 8 required ports. Validate .env configuration against
  requirements. Generate fix commands for common issues.
examples:
  - input: "/env-doctor"
    output: "Environment check: 6/8 services OK. Issues: Ollama not running (port 11434), Redis not found."
  - input: "/env-doctor --check docker"
    output: "Docker: ✅ Running. Containers: ollama(healthy), qdrant(healthy), postgres(healthy), redis(stopped)"
  - input: "/env-doctor --fix"
    output: "Auto-fix: Starting Redis container... Starting Ollama service... All services running."
os: [win32, darwin, linux]
author: ChainlessChain
handler: ./handler.js
---

# 环境诊断技能

## 描述

全面诊断开发环境，检查运行时、端口、服务健康状态和配置完整性。生成修复命令帮助快速解决环境问题。

## 使用方法

```
/env-doctor [选项]
```

## 选项

- `--check <category>` - 检查特定类别: runtimes, ports, docker, env, disk
- `--fix` - 自动生成并执行修复命令
- `--preflight` - 启动前预检（在 `npm run dev` 前运行）
- `--verbose` - 详细输出模式

## 检查项目

### 运行时检测

| 运行时  | 要求    | 检测方式           |
| ------- | ------- | ------------------ |
| Node.js | ≥18.0.0 | `node --version`   |
| npm     | ≥9.0.0  | `npm --version`    |
| Java    | 17      | `java --version`   |
| Python  | ≥3.9    | `python --version` |
| Docker  | ≥24.0   | `docker --version` |
| Git     | ≥2.30   | `git --version`    |

### 端口检查

| 端口  | 服务             |
| ----- | ---------------- |
| 5173  | Vite Dev Server  |
| 9001  | Signaling Server |
| 11434 | Ollama           |
| 6333  | Qdrant           |
| 5432  | PostgreSQL       |
| 6379  | Redis            |
| 9090  | Project Service  |
| 8001  | AI Service       |

### Docker 服务

- 容器运行状态
- 健康检查结果
- 资源使用（CPU/内存）
- 镜像版本

### 配置验证

- `.env` 与 `.env.example` 对比
- 必需环境变量检查
- 数据库连接测试
- API 密钥格式验证

### 磁盘空间

- 可用空间检查（最低 20GB）
- AI 模型存储空间
- 数据库文件大小
- 日志清理建议

## 输出格式

```
Environment Doctor Report
=========================
✅ Node.js 20.11.0 (required: ≥18.0.0)
✅ npm 10.2.0
✅ Java 17.0.9
✅ Python 3.11.6
✅ Docker 24.0.7
✅ Git 2.43.0

Ports:
✅ 5173 - Available
✅ 9001 - Available
❌ 11434 - Ollama not running
✅ 6333 - Qdrant active
✅ 5432 - PostgreSQL active
❌ 6379 - Redis not running

Docker:
✅ ollama - healthy
✅ qdrant - healthy
✅ postgres - healthy
❌ redis - stopped

Fix commands:
  docker start chainlesschain-redis
  docker start chainlesschain-ollama
```

## 示例

完整环境检查:

```
/env-doctor
```

启动前预检:

```
/env-doctor --preflight
```

自动修复:

```
/env-doctor --fix
```
