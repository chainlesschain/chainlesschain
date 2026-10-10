# CLI / IDE 0.166.96 升级与诊断指南

## 概述

2026-10-10 公开回读：CLI **0.166.96**、Agent SDK **0.2.14**、Open VSX **0.37.140**、JetBrains **0.4.158** 已公开，两个 IDE 均推荐 CLI `0.166.96`，准确发行提交 `da91e730d8`。Session Core **0.3.18**、Context/Memory Kernel **0.1.8**、PDH **0.4.64** 保持独立版本；产品 **v5.0.3.140** 仍来自 `f733f92cb9`。源码核对至 `main@2650447476`。本轮改善并发权限设置、JetBrains 审批卡片布局与失败诊断，补齐 Windows 私有工具链和清理取证；正式 36+9 评测保持 NOT_RUN，完整 native review 保持 NOT_ADMITTED，自动晋升 HOLD。

## 核心特性

- 多个进程写权限规则时减少磁盘竞争，并在每次写入后给等待者重试机会。
- JetBrains 审批卡片增删/恢复时重新分配视图高度；失败诊断保留布局与菜单信息。
- 模型目录审查核对官方稳定发行身份，版本漂移需审查后决定是否采用。
- Windows 工具链与清理诊断保留真实身份和失败证据，仍按实验范围使用。

## 系统架构

CLI 管理会话、权限、执行与诊断；IDE 是聊天与审批界面。SDK、CLI、VSIX/ZIP 和原生产品安装包有独立版本与发行来源。IDE 推荐版本需与实际 CLI 路径一致，升级 CLI 不会更新桌面或手机安装包。

## 配置参考

| 项目                 | 本轮值                                  |
| -------------------- | --------------------------------------- |
| Node.js / npm        | ≥22.12.0 / ≥10.0.0                      |
| CLI / JavaScript SDK | 0.166.96 / 0.2.14                       |
| Open VSX / JetBrains | 0.37.140 / 0.4.158；均推荐 CLI 0.166.96 |
| 产品安装包           | v5.0.3.140，单独下载升级                |

已有 provider、模型与权限配置按原指引维护。不要因诊断结果改变审批或沙箱设置。

## 性能指标

常规同步权限规则文件锁路径保留两秒获取截止，成功释放后让出 32ms；注入 settings authority 的分支独立处理。这里的让出窗口是公平性实现参数，不是用户任务 SLO。完整宿主功能测试采用有界预算，不能将测试期限或局部成功推断为生产延迟保证。正式评测和长时 SLO 尚未完成。

## 测试覆盖

发行提交 `da91e730d8` 的 CLI CI 71/71、Strict 5/5、IDE 18 成功/1 条件跳过、ARM64 10/10 已归档。SDK 启动失败、权限竞争、审批布局与弹窗收据有专项回归。本文档任务核对发布凭据与公开版本，未重新执行上述产品矩阵。正式 36+9 保持 NOT_RUN，完整 native review 保持 NOT_ADMITTED。

## 安全考虑

保持当前权限、人工审批和 CLI 执行约束。锁 owner 丢失、目录替换或写入状态未知仍拒绝。Windows 私有诊断成功不表示生产准入；RRSI 自动晋升继续 HOLD。升级原生产品前关闭客户端，备份 SQLite 数据库及 WAL/SHM；iOS ad hoc IPA 仅适用于授权设备。

## 故障排查

| 现象                                | 操作                                                                                 |
| ----------------------------------- | ------------------------------------------------------------------------------------ |
| 升级后 IDE 仍报告旧 CLI             | 重启聊天宿主，运行 Doctor，核对其实际可执行文件路径；终端用 `cc --version` 比对      |
| npm 镜像 E404                       | 用下方官方 registry 命令安装；镜像元数据可能先于 tarball 同步                        |
| 并发写入提示 STATE_LOCK_UNAVAILABLE | 等待现有写者完成后重试；不要删除活跃 owner 的锁，也不要将未知状态当成功              |
| JetBrains 审批卡片没有显示          | 升级至 0.4.158 并重启 IDE；保留 Doctor 和宿主诊断，核查是否仍有待处理审批            |
| Windows 清理/恢复未确认             | 保留 execution ID、Job/worker 身份与清理证据，按未确认状态处理；重启本身不能证明清理 |
| 模型目录版本漂移                    | 审查稳定发行来源与本地配置后再决定，审查不会自动启用新模型                           |

## 关键文件

安装版通过 `cc --version` 与 `cc doctor` 查看实际身份。源码诊断入口为 `settings-loader.cjs`、`with-file-lock.js`、`model-catalog-review.js` 与 JetBrains `ChatCardsLayout.java`。不要直接修改已安装 helper 或 vendored SDK。

## 使用示例

1. 结束正在执行的任务，记录当前 CLI 路径与版本。
2. 安装公开 CLI 并核对实际版本：

```bash
npm i -g chainlesschain@0.166.96 --registry https://registry.npmjs.org
cc --version
cc doctor
```

3. 从 [Open VSX](https://open-vsx.org/extension/chainlesschain/chainlesschain-ide) 安装 0.37.140；JetBrains 用户从 [Marketplace](https://plugins.jetbrains.com/plugin/32208) 安装 0.4.158。
4. 重启聊天宿主，在 IDE 运行 Doctor，确认推荐 CLI 与实际 CLI 均为 0.166.96。
5. 桌面/移动端按[独立产品下载](https://github.com/chainlesschain/chainlesschain/releases/tag/v5.0.3.140)选择安装包。

Linux 持久进程的只读状态可用 `cc agent process-ownership status --json` 检查。其 recover 只清理旧 cgroup，不恢复原任务；Windows/macOS 当前不支持该 durable 恢复命令。

## 相关文档

- [安装与部署](./installation)、[发布与升级](./agent-platform-release)、[IDE 安装与诊断](./ide-plugin)。
- [CLI 当前运行时](./cli-runtime-current)、[项目目标](./project-goals-current)、[RRSI 证据与边界](./rrsi-current)。
- [本轮设计与验收范围](/design/release-runtime-update-2026-10-10)。
