# CLI 命令行工具

ChainlessChain 提供轻量级 npm CLI 工具，让开发者通过一条命令即可安装、配置和管理整个系统。

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
| `note`             | 笔记增删改查、全文搜索                      | [笔记/知识库管理](./cli-note) |
| `chat` / `ask`     | 交互式 AI 对话 / 单次问答                   | [AI 对话](./cli-chat)         |
| `llm`              | 模型列表、连通性测试                        | [LLM 管理](./cli-llm)         |
| `agent` (别名 `a`) | Claude Code 风格代理会话，8 工具 + 138 技能 | [代理模式](./cli-agent)       |
| `skill`            | 技能列表、搜索、运行                        | [技能系统](./cli-skill)       |

---

## 核心包架构

Headless 命令依赖 5 个独立核心包（118 个测试全部通过）：

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

## 卸载

```bash
npm uninstall -g chainlesschain
rm -rf ~/.chainlesschain
```
