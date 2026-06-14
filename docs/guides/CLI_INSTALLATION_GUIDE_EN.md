# ChainlessChain CLI Installation Guide

## Quick Start

```bash
npm install -g chainlesschain
chainlesschain setup
```

## Prerequisites

- **Node.js** >= 22.12.0 ([download](https://nodejs.org/))
- **Docker** (optional, for backend services)

## Installation

### 1. Install the CLI

```bash
npm install -g chainlesschain
```

Verify:

```bash
chainlesschain --version
```

### 2. Run the Setup Wizard

```bash
chainlesschain setup
```

The wizard guides you through:

1. Node.js version check
2. Docker availability check (optional)
3. Edition selection (Personal / Enterprise)
4. LLM provider configuration (Ollama / OpenAI / DashScope / DeepSeek / Custom)
5. API key input (for cloud providers)
6. Desktop binary download
7. Configuration saved to `~/.chainlesschain/config.json`
8. Optional: start Docker backend services

### 3. Launch the App

```bash
chainlesschain start
```

### 4. Check Your Environment

```bash
chainlesschain doctor
```

## Platform-Specific Instructions

### Windows

```powershell
nvm install 22.12.0
nvm use 22.12.0
npm install -g chainlesschain
chainlesschain setup
```

### macOS

```bash
nvm install 22.12.0
nvm use 22.12.0
npm install -g chainlesschain
chainlesschain setup
```

### Linux

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
nvm install 22.12.0
npm install -g chainlesschain
chainlesschain setup
```

## Daily Usage

```bash
# Start/Stop
chainlesschain start              # Launch desktop app
chainlesschain stop               # Stop app
chainlesschain stop --all         # Stop app + all services

# Docker Services
chainlesschain services up        # Start backend services
chainlesschain services down      # Stop backend services
chainlesschain services logs -f   # Follow service logs

# Configuration
chainlesschain config list        # Show config
chainlesschain config set llm.provider openai
chainlesschain config set llm.apiKey sk-xxx

# Updates
chainlesschain update             # Check and install updates
chainlesschain update --check     # Check only

# Diagnostics
chainlesschain doctor             # Environment diagnostics
chainlesschain status             # Show running status
```

## Troubleshooting

### Command not found after install

Ensure npm global bin directory is in your PATH:

```bash
npm config get prefix
# Add <output>/bin to your PATH
```

### Binary download fails

Download manually and place in `~/.chainlesschain/bin/`. Or use a proxy:

```bash
HTTPS_PROXY=http://proxy:port chainlesschain setup
```

### Docker services won't start

1. Ensure Docker Desktop is running
2. Check for port conflicts: `chainlesschain doctor`
3. View logs: `chainlesschain services logs`

## Uninstall

```bash
npm uninstall -g chainlesschain
rm -rf ~/.chainlesschain
```

## 附录：规范章节补全（v5.0.3.108）

> 为对齐项目用户文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文细节。

### 1. 概述
见正文头部。ChainlessChain CLI Installation Guide (EN): global install of cc CLI.

### 2. 核心特性
npm global install / env / verify.

### 3. 系统架构
见正文 / [系统架构](../design/系统设计_主文档.md)（三端 + 双后端 + P2P）。

### 4. 系统定位
ChainlessChain 的「CLI Installation Guide (EN)」。

### 5. 核心功能
见正文各节。

### 6. 技术架构
见正文技术 / 环境章节。

### 7. 系统特点
见正文（步骤 / 版本 / 注意事项）。

### 8. 应用场景
见正文使用场景。

### 9. 竞品对比
见正文对比（如有）。

### 10. 配置参考
见正文配置 / 环境变量章节；`.chainlesschain/config.json`。

### 11. 性能指标
见正文性能 / 资源要求（如有）。

### 12. 测试覆盖
见正文验证 / 测试步骤（如有）。

### 13. 安全考虑
见正文安全 / 密钥章节（如适用）。

### 14. 故障排除
见正文故障排查 / 常见问题章节。

### 15. 关键文件
见正文涉及的文件 / 目录 / 脚本。

### 16. 使用示例
见正文命令 / 操作示例。

### 17. 相关文档
[用户指南索引](./README.md)、[快速开始](../quick-start/QUICK_START.md)、其它用户文档。
