# CLI 分发系统

> v5.0.1 新增

## 核心特性

- 📦 **纯 JS 无原生依赖**: 约 2MB 轻量包，所有平台 `npm install -g` 即可安装，无需编译工具链
- 🔽 **按需下载二进制**: 从 GitHub Releases 按平台自动下载 Electron 预构建包
- ⚙️ **配置兼容**: `~/.chainlesschain/config.json` 与桌面应用 `unified-config-manager.js` 完全兼容
- 🔒 **安全机制**: SHA-256 校验和验证 + HTTPS 传输 + PID 文件防重复启动
- 🚀 **CI/CD 自动发布**: Git tag 触发自动测试和 npm publish

## 系统架构

```
┌──────────────────────────────────────────────┐
│           CLI 分发系统                         │
│                                              │
│  npm registry (chainlesschain ~2MB)          │
│       │                                      │
│       ▼                                      │
│  ┌──────────────────────────────────────┐    │
│  │  CLI 纯 JS 包                        │    │
│  │  commander | inquirer | chalk | ora  │    │
│  └──────────────────┬───────────────────┘    │
│       ┌─────────────┼─────────────┐          │
│       ▼             ▼             ▼          │
│  ┌─────────┐  ┌──────────┐  ┌─────────┐    │
│  │ setup   │  │ start/   │  │ config  │    │
│  │ 向导    │  │ stop     │  │ doctor  │    │
│  └────┬────┘  └──────────┘  └─────────┘    │
│       │                                      │
│       ▼                                      │
│  GitHub Releases (平台二进制 100MB+)         │
│  Win(.zip) | Mac(.dmg) | Linux(.AppImage)   │
└──────────────────────────────────────────────┘
```

ChainlessChain CLI 分发系统是一个轻量级的 npm 包（约2MB），用于在全平台分发、安装和管理 ChainlessChain 桌面应用。

## 架构概览

```
npm registry (chainlesschain)
       │
       ▼
  CLI 包 (~2MB, 纯 JS)
       │
       ├── setup 向导
       │     └── 下载平台二进制 ← GitHub Releases
       │
       ├── 进程管理 (start/stop/status)
       ├── Docker 服务编排 (services)
       ├── 配置管理 (config)
       └── 环境诊断 (doctor)
```

## 核心设计

### 纯 JS 无原生依赖

CLI 包不包含任何原生 Node.js 模块，确保在所有平台上通过 `npm install -g` 即可安装，无需编译工具链。

**依赖清单：**

| 包名              | 用途       | 纯 JS |
| ----------------- | ---------- | ----- |
| commander         | 命令行解析 | ✅    |
| @inquirer/prompts | 交互式提示 | ✅    |
| chalk             | 终端着色   | ✅    |
| ora               | 加载动画   | ✅    |
| semver            | 版本比较   | ✅    |

### 按需下载二进制

桌面应用的 Electron 打包体积较大（100MB+），CLI 不内嵌二进制文件，而是在 `setup` 或 `update` 时从 GitHub Releases 按平台下载：

| 平台    | 资产匹配模式                           |
| ------- | -------------------------------------- |
| Windows | `*win*` → `.zip`                       |
| macOS   | `*mac*` / `*darwin*` → `.zip` / `.dmg` |
| Linux   | `*linux*` → `.tar.gz` / `.AppImage`    |

### 配置兼容

CLI 的配置保存在 `~/.chainlesschain/config.json`，与桌面应用的 `unified-config-manager.js` 完全兼容。桌面应用启动时会读取 CLI 写入的配置。

## 包结构

```
packages/cli/
├── bin/
│   └── chainlesschain.js      # npm bin 入口
├── src/
│   ├── index.js                # Commander 注册
│   ├── commands/               # 8 个子命令
│   │   ├── setup.js
│   │   ├── start.js
│   │   ├── stop.js
│   │   ├── status.js
│   │   ├── services.js
│   │   ├── config.js
│   │   ├── update.js
│   │   └── doctor.js
│   └── lib/                    # 共享库
│       ├── platform.js         # 平台检测
│       ├── paths.js            # 路径管理
│       ├── downloader.js       # 下载与解压
│       ├── process-manager.js  # PID 进程管理
│       ├── service-manager.js  # Docker 编排
│       ├── config-manager.js   # 配置读写
│       ├── version-checker.js  # 版本检查
│       ├── logger.js           # 日志
│       ├── prompts.js          # 交互提示
│       └── checksum.js         # 完整性校验
├── package.json
└── tests/
    ├── unit/
    ├── integration/
    └── e2e/
```

## CI/CD 自动发布

```yaml
# .github/workflows/publish-cli.yml
# 触发: push tag v* 或手动
# 步骤:
#   1. npm ci (packages/cli)
#   2. npm test
#   3. npm publish --access public
```

发布后用户只需 `npm install -g chainlesschain` 即可获取最新版本。

## 安全机制

- **校验和验证**: 下载的二进制文件通过 SHA-256 校验和验证完整性
- **HTTPS 传输**: 所有下载通过 HTTPS 进行
- **代理支持**: 支持 `HTTPS_PROXY` 环境变量
- **PID 文件**: 进程管理使用 PID 文件防止重复启动

## 使用流程

```bash
# 1. 安装
npm install -g chainlesschain

# 2. 首次设置（交互式）
chainlesschain setup

# 3. 启动
chainlesschain start

# 4. 检查状态
chainlesschain status

# 5. 更新
chainlesschain update
```

详细命令参考请查看 [CLI 命令行工具](/chainlesschain/cli)。

## 关键文件

- `packages/cli/bin/chainlesschain.js` — npm bin 入口
- `packages/cli/src/index.js` — Commander 命令注册
- `packages/cli/src/lib/downloader.js` — 平台二进制下载与解压
- `packages/cli/src/lib/checksum.js` — SHA-256 完整性校验
- `.github/workflows/publish-cli.yml` — CI/CD 发布流水线

## 故障排查

| 问题 | 解决方案 |
|------|---------|
| `npm install -g` 权限不足 | Linux/macOS: `sudo npm install -g chainlesschain` 或使用 nvm |
| 安装后命令找不到 | 确认 `npm config get prefix` 路径在 PATH 中 |
| 下载二进制文件失败 | 使用代理：`HTTPS_PROXY=http://proxy:port chainlesschain setup` |
| 校验和验证失败 | 网络传输可能损坏，删除缓存重新下载 |

## 相关文档

- [CLI 命令行工具](./cli) — 完整命令参考
- [配置说明](./configuration) — 配置文件��式
