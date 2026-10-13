# CLI / IDE 有界重试与发行设计增量（2026-10-13）

## 源码与发行身份

2026-10-13 核对：CLI **0.166.100** 与 Open VSX **0.37.144** 已公开并完成回读，发行源码为 `6a8db627c87f33ce4f8e5d3db704868957aa685e`，推荐 CLI `0.166.100`。JetBrains **0.4.162** 六宿主验证与上传通过，公开上架与下载待核验。设计源码核对至已合并 `main@283634169a`（PR #435）。产品 **v5.0.3.140** 保持独立发行；Agent SDK **0.2.14**、Session Core **0.3.19**、Context/Memory Kernel **0.1.9**、PDH **0.4.64** 保持各自版本。预算 PR #436 不在本次发行内，仍为 **NOT_PAID_READY**；正式 36+9 **NOT_RUN**，完整 native review **NOT_ADMITTED**，自动晋升 **HOLD**。

本页核对 10 月 10 日以来的 Git 增量。发行提交与当前主线分别记录；后续文档或测试变更不能借用旧提交的发布门。安装与排查见[本轮用户指南](https://docs.chainlesschain.com/chainlesschain/cli-ide-update-2026-10-13.html)。

| 制品                                              | 状态与边界                                            |
| ------------------------------------------------- | ----------------------------------------------------- |
| npm CLI 0.166.100                                 | 已公开并完成包回读，发行源码 `6a8db627c8`             |
| Open VSX 0.37.144                                 | 已公开并完成回读，推荐 CLI 0.166.100                  |
| JetBrains 0.4.162                                 | 六宿主验证与上传通过，公开上架与下载待核验 |
| Session Core 0.3.19 / Context/Memory Kernel 0.1.9 | CLI 清单固定的子包版本，独立于 IDE 和产品版本         |
| Agent SDK 0.2.14 / PDH 0.4.64                     | 保持独立版本，不因 CLI 升级自动改号                   |
| 桌面 / Android / iOS v5.0.3.140                   | 独立产品发行 `f733f92cb9`；不能推定包含本轮 CLI 源码  |

## 流式连接重试与终止边界

`ceb2d6f596` 与 `4e6ae449a5` 将连接中断和提供商终止结果分开处理。只有符合条件且尚未产生可见输出的连接失败可以有限重试；HTTP 4xx/5xx、Responses 失败、用户取消、输出背压错误和已可见输出均不能触发响应重放。错误正文即使包含 timeout、reset 等词，也不会把提供商的失败判定改成连接故障。

`stream-retry.js` 在收到响应头时记录 Retry-After 截止，支持整数秒和合法 HTTP 日期；等待可取消且上限为 60 秒。默认连接重试预算为 2，配置上限为 15。Retry-After 只决定已获准重试时的等待，不授予 HTTP 错误新的重试权限。Chat 的 token 回调保持与实际流输出一致。这些保护减少重复请求风险，不构成账单金额或全局费用上限保证。

## Worktree 注册表与任务交付

`6a8db627c8` 修复并发 worktree 创建时临时 `locked` 标记消失导致的只读注册表快照失败。仅当 `git worktree list --porcelain` 返回精确匹配的标记缺失错误时，最多读取三次；不接受部分输出，不重放创建、删除或其他写操作。权限错误、其他 Git 错误和重试耗尽继续失败。

此前 `b015687d2b`、`a21913df8b` 调整有限模型预算下的任务交付与缓存前缀处理；`861e9bcac9` 拒绝空搜索并保留暂停工具请求的关联身份。`fdead28689` 在文本编辑前验证 UTF-8，遇到其他编码返回 `CC_EDIT_INVALID_UTF8` 并保留原字节，避免解码替换后写坏文件。模型能力与价格目录同步 Haiku 5.5、修正 Sonnet 5.5 缓存读取费率；目录值不是具体账号价格、模型可用性或真实成本回执。

## IDE 刷新和检查点弹窗

`20f4a4bfe3` 在动作执行期间延后周期刷新，丢弃过期投影；`0d20671dc6` 将刷新和动作状态限定到每个面板，关闭再打开不会继承旧操作或压制新定时器。动作仍使用新鲜 authority/revision 核对，并在变更后重新读取 CLI 权威状态。

`1e0272fb49` 把 JetBrains 检查点时间线的第二级动作弹窗延后到下一次 EDT 派发，并核对视图、项目和会话是否仍有效。可选诊断记录选择、关闭、焦点与 handoff。源码和宿主门支持该实现已交付到候选制品的结论；它们不能独自证明此前每个 ARM64 弹窗失败的根因均已复现并修复，也不能代替真实交互性能验收。

## 正式评测与预算开发边界

`e32e75e2b4` 固定正式 36+9 计划、任务执行窗口和采集身份；计划或离线验收存在不代表正式样本已经运行。正式 36+9 仍为 **NOT_RUN**。

[PR #436](https://github.com/chainlesschain/chainlesschain/pull/436) 的耐久预算 authority 是独立开发，不包含在本次 `6a8db627c8` 发行中。它保留单库预留、结算冲突保护、严格 JSON/SSE 与正式启动拒绝，但跨数据库的同谱系唯一性、防回滚、真实账号价格/汇率/输入上界证据、完整运行时 IPC 与出站隔离仍未闭环，状态为 **NOT_PAID_READY**。不能把普通模型 token 预算、合成账单测试或发布成功解释为 $99 的真实费用保证。

完整 native review 仍为 **NOT_ADMITTED**，自动晋升仍为 **HOLD**。Windows/macOS 持久任务恢复、独立信任根和生产灾备继续按专项证据验收。

## 关联记录

- [PR #435：流式重试与 worktree 注册表读取](https://github.com/chainlesschain/chainlesschain/pull/435)。
- [10 月 10 日设计快照](release-runtime-update-2026-10-10.md)：保留当时版本与验证结果。
- [CLI 当前架构](cli-runtime-current.md)与[发行升级指南](https://docs.chainlesschain.com/chainlesschain/agent-platform-release.html)。
