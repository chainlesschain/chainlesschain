# 版本更新 (update)

> 2026-10-18：当前公开版本为 CLI **0.166.105**、Open VSX **0.37.150**、JetBrains **0.4.167**。下一候选为 CLI **0.166.106**、VS Code **0.37.151**、JetBrains **0.4.168**，候选插件均推荐 CLI `.106`；候选尚未发布，须通过最终提交完整矩阵、CLI OIDC 发布及公开制品回读，再发行 IDE 并补测未合格项。公开 `.105` 轮已严格完成生成 **20/20**、验收 **20/20**，新增候选合格 **6** 项、全流程通过 **6** 项；累计合格 **31/45**（普通任务 **26/36**、首次使用 **5/9**），剩余 **14** 项。原 25 份合格产物按字节复用；跨版本累计结果不等于单轮 **45/45** 全部成功。候选 `.106/.151/.168` 尚未发布、尚未补测。Microsoft Marketplace 未发布。

CLI npm 包升级使用：

```bash
npm i -g chainlesschain@0.166.105 --registry https://registry.npmjs.org
cc --version
cc doctor
```

配套 IDE 仍在发布，公开核验后再升级。`cc update` 的其他下载渠道与 CLI npm 版本分别核验。详见[本轮升级指南](./cli-ide-update-2026-10-18)。

> 检查 ChainlessChain 新版本并下载更新。支持多发布渠道和仅检查模式。

## 概述

`update` 命令用于检查 ChainlessChain 是否有新版本并下载更新，支持 stable、beta、dev 三个发布渠道。检测到新版本后会显示版本信息并经用户确认后下载，也可通过 `--check` 仅检查而不下载，适合 CI/CD 中的版本监控。

## 核心特性

- 🔹 **版本检查**: 对比当前版本与远程最新版本
- 🔹 **多渠道支持**: 支持 stable、beta、dev 三个发布渠道
- 🔹 **交互式下载**: 检测到新版本后确认下载
- 🔹 **强制重下载**: 支持重新下载已存在的二进制文件
- 🔹 **仅检查模式**: 只检查是否有更新，不下载
- 🔹 **启动被动提醒**（v0.162.41+）: 任意 `cc` 命令启动时同步读一次缓存（`~/.chainlesschain/update-check.json`），有新版则向 stderr 打一行灰字提示（仅 TTY，不污染管道/JSON 输出）；缓存超过 24h 由 detached 子进程后台刷新供下次启动用——热路径零网络。`CC_UPDATE_NOTICE=0` 关闭。

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

| 选项                  | 说明                        | 默认值 |
| --------------------- | --------------------------- | ------ |
| `--check`             | 仅检查是否有更新，不下载    | -      |
| `--channel <channel>` | 发布渠道：stable、beta、dev | stable |
| `--force`             | 即使二进制已存在也重新下载  | -      |

## 关键文件

- `packages/cli/src/commands/update.js` — 命令实现
- `packages/cli/src/lib/version-checker.js` — 远程版本检查
- `packages/cli/src/lib/downloader.js` — 二进制下载
- `packages/cli/src/lib/prompts.js` — 交互式确认
- `packages/cli/src/constants.js` — 当前版本号 (VERSION)

## 配置参考

```bash
# 命令选项
chainlesschain update                          # 检查并下载更新
chainlesschain update --check                  # 仅检查（不下载）
chainlesschain update --channel stable|beta|dev
chainlesschain update --force                  # 强制重新下载

# 相关环境变量
export CHAINLESSCHAIN_UPDATE_CHANNEL=stable    # 默认渠道
export CHAINLESSCHAIN_UPDATE_URL=https://...   # 自定义更新服务器
export HTTPS_PROXY=http://proxy:port           # 通过代理下载
```

## 性能指标

| 操作                | 目标     | 实际       | 状态 |
| ------------------- | -------- | ---------- | ---- |
| 版本检查请求        | < 3s     | 500–2000ms | ✅   |
| 版本号对比          | < 10ms   | 1–5ms      | ✅   |
| 二进制下载（~50MB） | 依赖带宽 | 5–30s      | ✅   |
| 校验和验证          | < 500ms  | 100–300ms  | ✅   |
| 总更新耗时          | 依赖带宽 | 10–60s     | ✅   |

## 测试覆盖率

```
✅ update.test.js  - 覆盖 CLI 主要路径
  ├── 参数解析
  ├── 正常路径
  ├── 错误处理
  └── JSON 输出
```

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

| 问题                  | 解决方案                                      |
| --------------------- | --------------------------------------------- |
| `Update check failed` | 检查网络连接，确认能访问 GitHub/发布服务器    |
| 下载速度慢            | 可配置代理，或手动从 Release 页面下载         |
| 下载后启动失败        | 尝试 `chainlesschain update --force` 重新下载 |
| `ExitPromptError`     | 用户按 Ctrl+C 取消更新，正常退出              |

## 相关文档

- [配置向导](./cli-setup) — 首次配置（包含下载步骤）
- [启动应用](./cli-start) — 启动桌面应用
- [系统状态](./cli-status) — 查看当前版本状态
