# CLI .131 与 IDE 配套升级（2026-10-29）

## 概述

CLI **0.166.131**、Context/Memory Kernel **0.1.11**、Open VSX **0.37.169** 和 JetBrains **0.4.186** 均已公开并完成制品核验，两个 IDE 都推荐 CLI `.131`。本次准确发行源码为 `c9d0bab231850697df38f2d476c2dd974cbcb6c0`；安装顺序是子 npm 包、CLI、IDE。PC / 移动端仍使用独立发行的 **v5.0.3.143**，不能据本次 CLI 发行推断客户端已经包含全部改动。

Microsoft Marketplace 按本轮安排暂缓。官方 VS Code 用户可以安装下方版本化 VSIX。[完整公开回执](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli/evidence/release131-public/publication.json)记录各渠道、准确来源、签名和官方候选比对；[.130 升级页](./cli-ide-update-2026-10-29-130)保留当时的历史范围。

## 核心特性

| 范围                | `.131` 已公开的改动                                                                    | 使用边界                                                                    |
| ------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 独立 Goal 检查      | 显式 `verify:` 条件在作者调用前冻结操作者提供的验收定义，由宿主执行检查并核对本次回执  | 默认自然语言 `model:` 没有因此变成独立验收；需要可信 checker 和完整输入声明 |
| Memory 一致性与取消 | 加强目录身份、索引读取和取消处理，包含 bundle 查询及压缩 / 恢复的一致性修复            | 不自动迁移 legacy/shadow/canonical 模式；完整性能与语义质量仍单独验收       |
| MCP 与 Skills       | 修复子任务发现与缓存隔离、晚连接目录刷新及下载取消                                     | 发现工具不等于获得工具权限，任意远端服务器仍有自己的授权边界                |
| 压缩与恢复          | 刷新压缩前后的项目规则和文件 Memory，保留非持久会话的宿主基础规则                      | 不将历史文本当作新的执行证据，崩溃窗口及真实 IDE 旅程有各自验收范围         |
| 临时 worktree       | 将异步消费者的实际生命周期纳入目录保留与清理                                           | 不能据此保证任意自行脱离的后代进程已被操作系统接管                          |
| 模型配置            | 更新 Terra 能力与缓存计费合同，保留真实响应证据不足时的未知状态                        | 模型预设、API 支持和账户连通性分别判断；连接测试可能产生推理费用            |
| 启动与 Web Panel    | 冷会话读取不再提前加载不需要的部署配置；Web Panel 使用可复现生产构建并在 CI 先构建审计 | 支持的 Agent 命令仍走原部署配置与权限检查；没有放宽 RSS 或来源审查门槛      |

`--review-changes`、实验性 Codex 路由、紧凑 MCP 目录和 Skill 自进化继续按各自显式开关使用。该发行没有把它们全部改为默认开启。

## 系统架构

CLI、两个 IDE 的本次发行标签都指向同一准确源码 `c9d0bab231`。CLI 精确依赖已先行公开的 Kernel `0.1.11`；IDE 在核验公开 CLI 与子包后才上传。公共 CLI 归档与不可变 CI 制品逐字节一致，并通过 npm provenance 验证；Open VSX 的公开 VSIX 与官方候选逐字节一致；JetBrains 的公开 ZIP 容器可以不同，但全部 **2** 个原始 payload 文件与官方候选一致，没有新增成员。

主分支后续的文档提交不是另一份生产发行。发布成功不代表真实模型任务、完整 Memory SLO 或所有入口恢复均已验收。实现关系和数据边界见[本版运行时设计](/design/release-runtime-update-2026-10-29-131)。

## 使用示例

使用 Node.js **22.12.0+**、npm **10+**：

```bash
npm i -g chainlesschain@0.166.131 --registry https://registry.npmjs.org
cc --version
cc doctor
```

`cc --version` 应输出 `0.166.131`。升级后重启 IDE 聊天宿主，在 Doctor 中核对实际 CLI 路径，避免继续使用另一份旧全局安装。

| 编辑器              | 安装方式                                                                                                                                                                                  |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Open VSX 兼容编辑器 | 安装 `chainlesschain.chainlesschain-ide`，核对 **0.37.169**                                                                                                                               |
| Microsoft VS Code   | 下载 [0.37.169 VSIX](https://open-vsx.org/api/chainlesschain/chainlesschain-ide/0.37.169/file/chainlesschain.chainlesschain-ide-0.37.169.vsix)，使用 **Extensions: Install from VSIX...** |
| JetBrains 2024.2+   | 搜索 **ChainlessChain IDE**，核对 **0.4.186**，或安装[已批准的公开 ZIP](https://plugins.jetbrains.com/files/32208/1206001/chainlesschain-ide-bridge-0.4.186.zip)                          |

需要独立 Goal 验收时，先按 [Agent 文档](./cli-agent)准备操作者信任的 `goal-checks.json`、checker 和声明的输入，再显式指定条件：

```bash
cc agent -p "完成当前项目中约定的修改" --goal-condition "verify:./goal-checks.json"
```

这个示例不会替你生成可信断言。检查需要实际执行成功并返回与本次调用匹配的要求回执；作者声称成功、只输出退出码 0 或复用旧回执都不足以完成。

## 配置参考

- `/model <model-id>` 只覆盖当前会话，`/model --default` 恢复共享默认。配置缺失与配置不可读取是不同状态。
- `--goal-condition "verify:..."` 是显式检查入口；默认 `model:` 保留模型判断语义，两个入口不能互相替代。
- `--review-changes` 继续使用原任务剩余回合、物理请求、输出、费用和取消预算，不产生额外免费额度。
- Skill 自进化保持显式开关，普通升级不会自动启用；详见[自进化配置](./self-evolution-configuration)。

checker 的输入清单、回执格式和恢复步骤见 [Managed Agents](https://github.com/chainlesschain/chainlesschain/blob/main/docs/cli/managed-agents.md)。当前固定 native 生成流程没有传入 `--goal-condition`，因此不会自动使用新的 `verify:` checker。

## 性能指标

本版不承诺新的端到端延迟、模型费用或真实任务成功率。以下是有明确范围的本机测量，不能外推为全产品保证：

| 场景                                  | 已有结果                                                                                       | 未覆盖范围                                                                        |
| ------------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 100K 默认列表查询，类别过滤、limit 20 | Windows / Node 22.22.2，每种场景 100 次；热 p95 **178.866ms**，冷 p95 **2258.233ms**           | 冷目标和完整 Memory SLO 仍未通过；不是语义 recall 或真实 IDE 响应时间             |
| 派生索引重建 / 损坏恢复               | 三种规模、两场景各 100 次，共 **600** 次结果摘要匹配参考；100K p95 **23522.737 / 21330.307ms** | 原测量从 98c4 开始，相关 16 个源码与 c9d0 字节一致；不是在新 SHA 重跑完整依赖闭包 |
| 混合读写补测                          | 1K 的 100 轮完成；10K 最后记录 90 轮后，worker 触发原 **120 秒**上限                           | 进程退出 1，100K 未开始，没有完整 300 轮通过记录，未放宽上限                      |

恢复基准只主动移除或损坏派生索引，没有逐样本独立哈希全部 authority 原始字节。测量方法、原始结果和失败均保留在[查询 / Stop 记录](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli-ide-memory-slo131-progress-2026-10-29.md)及[恢复与混合补测记录](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli-ide-memory-recovery131-progress-2026-10-29.md)。

## 测试覆盖

| 证据             | 已核验范围                                                                                                                                                 |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 准确源码门禁     | CLI CI **72 个成功、1 个预期跳过**；Strict **6/6**；Kernel **3/3**；IDE 验证 **18 个成功、1 个预期跳过**，包括配置的三系统检查                             |
| CLI 公开包       | OIDC `40862685540` attempt 2 和独立回读 `40866417524` 成功；**9,509,449 字节**，SHA-256 `0766b3df57477df22900ce601f9acaf31771b89ed26d042cec4d043fe4227ce1` |
| Open VSX         | 发行 `40866847689` 成功；**743,016 字节**，SHA-256 `a41b5806e67e6fd509bae6463cffbf8bd5e7ea105466ab603684e31a90a90d7d`，与官方候选一致                      |
| JetBrains        | 发行 `40866846685` 成功，更新 **1206001** 已批准、列出且未隐藏；**1,561,032 字节**，全部官方 payload 成员一致                                              |
| Windows 安装补充 | 独立临时目录安装公开 CLI，禁用生命周期脚本，核对归档完整性、Kernel `.11`、真实二进制 `--version` 与 `--help` 通过                                          |
| 真实任务         | 跨版本累计 **34/45**，普通 **27/36**、首次入口 **7/9**，剩余 **11** 项；本版新计划已准备，尚未派发，不是 `.131` 单轮成功率                                 |

本机安装补充不等于完整正常 postinstall、IDE 启动或模型任务验收。源码、公开包和发行门禁证据分别保存在[公开回执](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli/evidence/release131-public/publication.json)。正式付费 / native 生产准入与自动晋升状态继续为 **NOT_PAID_READY / NOT_ADMITTED / HOLD**。

## 安全考虑

独立验收需要操作者信任并冻结 manifest、checker 和完整依赖。checker 由既有进程 broker 启动，但这不会自动把任意检查程序变成隔离沙箱，也不能证明恶意同进程候选代码永远无法伪造状态。

缺失产物、源码变化、取消、未知用量或检查点写入失败都不能沿用先前成功。恢复中断检查前，应核对既有副作用和费用记录；无法确认清理时停止自动续跑。原未知派发保持原责任，不通过重发推测是否执行。

## 故障排查

| 现象                       | 处理                                                                           |
| -------------------------- | ------------------------------------------------------------------------------ |
| 升级后仍显示旧版本         | 核对 `cc --version`、Doctor 的 CLI 路径和 IDE 指定路径，重启宿主               |
| Microsoft 商店搜不到扩展   | 使用上方 Open VSX 版本化 VSIX；Microsoft 渠道本轮暂缓                          |
| `verify:` 定义或回执被拒绝 | 核对 manifest / checker 文件、要求 ID、依赖与必需产物，使用本次实际执行的回执  |
| 恢复时要求人工核对         | 先核对旧操作与用量，再按原条件显式恢复；确认标志不代表状态已修复或副作用已回滚 |
| Memory 冷查询仍较慢        | 参考上方实际测量范围；不要用热查询结果代替冷查询或完整 SLO                     |
| 新版仍未增加任务完成数     | 发布、测试与候选生成分别计数，只有原任务通过独立验收才增加合格交付数           |

## 关键文件

- [完整公开发行回执](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli/evidence/release131-public/publication.json)
- [CLI README](https://github.com/chainlesschain/chainlesschain/blob/main/packages/cli/README.md)
- [当前任务进度表](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli-ide-codex-claude-gap-review-2026-10-27.md)
- [本版运行时设计](/design/release-runtime-update-2026-10-29-131)

## 相关文档

- [Agent](./cli-agent) · [IDE](./ide-plugin) · [Memory](./cli-memory)
- [MCP Tool Search](./cli-tool-search) · [Skills](./cli-skill)
- [.130 升级说明（历史）](./cli-ide-update-2026-10-29-130)
- [输入与恢复](./agent-input-and-recovery) · [自进化开关](./self-evolution-configuration)
