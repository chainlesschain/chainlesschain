# 版本更新 (update)

> 检查 ChainlessChain 新版本并下载更新。支持多发布渠道和仅检查模式。

## 概述

`update` 命令用于检查 ChainlessChain 是否有新版本并下载更新，支持 stable、beta、dev 三个发布渠道。检测到新版本后会显示版本信息并经用户确认后下载，也可通过 `--check` 仅检查而不下载，适合 CI/CD 中的版本监控。

## 核心特性

- 🔹 **版本检查**: 对比当前版本与远程最新版本
- 🔹 **多渠道支持**: 支持 stable、beta、dev 三个发布渠道
- 🔹 **交互式下载**: 检测到新版本后确认下载
- 🔹 **强制重下载**: 支持重新下载已存在的二进制文件
- 🔹 **仅检查模式**: 只检查是否有更新，不下载

## 系统架构

```
update 命令 → update.js (Commander) → version-checker + downloader
                                            │
                   ┌────────────────────────┼───────────────────┐
                   ▼                        ▼                   ▼
            检查远程版本              显示更新信息          下载新版本
            checkForUpdates()        版本号 / 日期        downloadRelease()
            (channel: stable         发布链接              (force 可选)
             / beta / dev)
```

## 命令参考

```bash
chainlesschain update                      # 检查并下载更新
chainlesschain update --check              # 仅检查（不下载）
chainlesschain update --channel beta       # 使用 beta 渠道
chainlesschain update --force              # 强制重新下载
```

## 选项说明

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `--check` | 仅检查是否有更新，不下载 | - |
| `--channel <channel>` | 发布渠道：stable、beta、dev | stable |
| `--force` | 即使二进制已存在也重新下载 | - |

## 关键文件

- `packages/cli/src/commands/update.js` — 命令实现
- `packages/cli/src/lib/version-checker.js` — 远程版本检查
- `packages/cli/src/lib/downloader.js` — 二进制下载
- `packages/cli/src/lib/prompts.js` — 交互式确认
- `packages/cli/src/constants.js` — 当前版本号 (VERSION)

## 安全考虑

- 版本检查通过 HTTPS 请求远程服务器
- 下载前显示版本信息和发布日期，用户确认后才执行
- 下载的二进制文件支持校验（checksum 验证）
- 用户按 Ctrl+C 可随时取消更新流程

## 使用示例

### 场景 1：日常检查更新

```bash
chainlesschain update
```

检查是否有新版本。如果有更新，显示版本号和发布日期，确认后下载。已是最新版时提示无需更新。

### 场景 2：CI/CD 中检查版本

```bash
chainlesschain update --check
```

仅检查是否有可用更新，不触发下载。适用于自动化脚本中的版本监控。

### 场景 3：使用 beta 渠道

```bash
chainlesschain update --channel beta
```

切换到 beta 渠道获取预发布版本，体验最新功能。

### 场景 4：重新下载当前版本

```bash
chainlesschain update --force
```

强制重新下载二进制文件，适用于文件损坏或需要修复安装的场景。

## 故障排查

| 问题 | 解决方案 |
|------|---------|
| `Update check failed` | 检查网络连接，确认能访问 GitHub/发布服务器 |
| 下载速度慢 | 可配置代理，或手动从 Release 页面下载 |
| 下载后启动失败 | 尝试 `chainlesschain update --force` 重新下载 |
| `ExitPromptError` | 用户按 Ctrl+C 取消更新，正常退出 |

## 相关文档

- [配置向导](./cli-setup) — 首次配置（包含下载步骤）
- [启动应用](./cli-start) — 启动桌面应用
- [系统状态](./cli-status) — 查看当前版本状态
