# ChainlessChain CLI 安装指南

## 快速开始

```bash
npm install -g chainlesschain
chainlesschain setup
```

## 前置要求

- **Node.js** >= 22.12.0 ([下载](https://nodejs.org/))
- **Docker** (可选，用于后端服务)

## 安装步骤

### 1. 安装 CLI

```bash
npm install -g chainlesschain
```

验证安装：

```bash
chainlesschain --version
```

### 2. 运行设置向导

```bash
chainlesschain setup
```

设置向导会引导你完成以下步骤：

1. 检查 Node.js 版本
2. 检查 Docker 是否可用（可选）
3. 选择版本（个人版/企业版）
4. 配置 LLM 提供商（Ollama/OpenAI/DashScope/DeepSeek/自定义）
5. 如使用云端 LLM：输入 API Key
6. 下载桌面应用二进制文件
7. 保存配置到 `~/.chainlesschain/config.json`
8. 可选：启动 Docker 后端服务

### 3. 启动应用

```bash
chainlesschain start
```

### 4. 检查环境

```bash
chainlesschain doctor
```

## 各平台说明

### Windows

```powershell
# 使用 nvm-windows 安装 Node.js
nvm install 22.12.0
nvm use 22.12.0

# 安装 CLI
npm install -g chainlesschain
chainlesschain setup
```

### macOS

```bash
# 使用 nvm 安装 Node.js
nvm install 22.12.0
nvm use 22.12.0

# 安装 CLI
npm install -g chainlesschain
chainlesschain setup
```

### Linux

```bash
# 使用 nvm 安装 Node.js
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
nvm install 22.12.0

# 安装 CLI
npm install -g chainlesschain
chainlesschain setup
```

## 日常使用

```bash
# 启动/停止
chainlesschain start              # 启动桌面应用
chainlesschain stop               # 停止应用
chainlesschain stop --all         # 停止应用和所有服务

# Docker 服务管理
chainlesschain services up        # 启动后端服务
chainlesschain services down      # 停止后端服务
chainlesschain services logs -f   # 查看服务日志

# 配置管理
chainlesschain config list        # 查看配置
chainlesschain config set llm.provider openai
chainlesschain config set llm.apiKey sk-xxx

# 更新
chainlesschain update             # 检查并更新
chainlesschain update --check     # 仅检查更新

# 诊断
chainlesschain doctor             # 环境诊断
chainlesschain status             # 查看运行状态
```

## 配置文件

配置存储在 `~/.chainlesschain/config.json`。可以通过 CLI 命令或直接编辑文件来修改。

```bash
chainlesschain config edit        # 用编辑器打开
```

## 常见问题

### 安装后找不到命令

确保 npm 全局安装目录在 PATH 中：

```bash
npm config get prefix
# 将输出的路径/bin 添加到 PATH
```

### 下载二进制文件失败

手动下载后放到 `~/.chainlesschain/bin/` 目录。或使用代理：

```bash
HTTPS_PROXY=http://proxy:port chainlesschain setup
```

### Docker 服务无法启动

1. 确保 Docker Desktop 正在运行
2. 检查端口是否被占用：`chainlesschain doctor`
3. 查看日志：`chainlesschain services logs`

## 卸载

```bash
npm uninstall -g chainlesschain
rm -rf ~/.chainlesschain
```
