# CLI .130 与 IDE 配套升级（2026-10-29）

## 概述

CLI **0.166.130**、Open VSX **0.37.168**、JetBrains **0.4.185** 已公开，两个 IDE 均推荐 CLI `.130`。准确发行源码为 `f3015e799624b81af564aaaa1b7701c0a5c70e26`；CLI 使用已公开的 Kernel **0.1.10**。Microsoft Marketplace 暂缓，官方 VS Code 使用版本化 VSIX。PC / 移动端继续独立使用 **v5.0.3.143**。

[公开发布回执](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli/evidence/release130-public/publication.json)及[独立新回读](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli/evidence/release130-reconcile-2026-10-29/review.json)分别记录准确来源、门禁和公开归档。旧 [.129 升级页](./cli-ide-update-2026-10-29)保留历史范围。

## 核心特性

| 范围            | `.130` 已公开的行为                                                                                   |
| --------------- | ----------------------------------------------------------------------------------------------------- |
| Goal 模型评审   | 与作者任务共用回合、费用预算、取消信号与输出上限；未知用量或传输失败阻止继续。                        |
| Goal 工作区证据 | 工具和模型评审前后绑定当前源码 / 产物的摘要与文件身份；外部改写、删除或覆盖不足不能沿用先前成功。     |
| 既有交付复查    | 继承 `.129` 上下文隔离；`--review-changes` 默认关闭，继续使用原权限和剩余预算。                       |
| IDE 与模型配置  | 保留配置三态、会话 `/model` 覆盖和原有会话；CLI 执行权限与持久化仍由宿主管理。                        |
| 默认与限制      | 实验性 Codex 路由、紧凑 MCP 目录及 Skill 自进化仍按各自显式开关使用；真实任务验收不由发布门自动完成。 |

独立 `verify:` checker、新 Memory 磁盘 / recall / 缓存、Kernel `0.1.11`、临时 worktree 生命周期修复和 Terra 能力 / 计费改动仍属于后续主线，未包含在 `.130`。

## 系统架构

公开 CLI 与两个 IDE 均冻结在 f301；不可变 CLI 标签为 `v-npm-0-166-130`。该标签和版本不能重定位或重复发布。后续主线虽可能保留相同版本字段，源码和子包已不同，不能据字段相同推断已公开。

所需子 npm 包先公开并核验，随后 CLI 通过准确提交的完整三系统门禁与 OIDC 发布，公开回读完成后才发布 IDE，客户端最后。新的主线发行需要新的未占用版本与自己的门禁。详见[本版运行时设计](/design/release-runtime-update-2026-10-29-130)。

## 使用示例

使用 Node.js **22.12.0+**、npm **10+**：

```bash
npm i -g chainlesschain@0.166.130 --registry https://registry.npmjs.org
cc --version
cc doctor
```

| 编辑器              | 安装方式                                                                                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Open VSX 兼容编辑器 | 安装 `chainlesschain.chainlesschain-ide`，核对 **0.37.168**。                                                                                                                               |
| Microsoft VS Code   | 下载 [0.37.168 VSIX](https://open-vsx.org/api/chainlesschain/chainlesschain-ide/0.37.168/file/chainlesschain.chainlesschain-ide-0.37.168.vsix)，使用 **Extensions: Install from VSIX...**。 |
| JetBrains 2024.2+   | 搜索 **ChainlessChain IDE**，核对 **0.4.185**，或安装[公开 ZIP](https://plugins.jetbrains.com/files/32208/1205656/chainlesschain-ide-bridge-0.4.185.zip)。                                  |

升级后重启聊天宿主，在 Doctor 核对实际 CLI 路径。恢复待处理会话前，先核对既有工具副作用、用量与持久记录，再手动继续。

## 配置参考

`/model <model-id>` 仅覆盖当前会话，`/model --default` 恢复共享默认。配置读取失败需要先修复读取。连接测试会发送真实推理请求，可能产生费用；选择模型预设不代表账户已连通。

Goal 工作区绑定有读取范围与资源上限：Git 源码范围不包含被忽略的构建目录、外部环境和远端资源；具体产物可由 `read_file` 独立绑定。摘要证明范围内的新鲜度，产物质量仍需独立检查。

## 性能指标

本次不承诺新增端到端延迟、模型费用或任务成功率。Goal 绑定增加有界文件读取；主线 Memory 仍有查询 SLO 未达标项，后续无模型进程恢复测试也不能证明语义质量或完整 IDE 性能。

## 测试覆盖

| 证据      | 已核验范围                                                                                                                                                                 |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CLI 门禁  | 准确 f301 的 Linux / Windows / macOS CLI CI **72/72** 与 Strict Sandbox 全部通过。                                                                                         |
| npm       | GitHub Actions OIDC 发布及独立公开回读成功；重新下载 9,573,550 字节，SHA-256 `1078914f6fba61f0ca6644926c9f044be2b808fa084fbe8408c14b21fc1cd4f5`，registry integrity 匹配。 |
| Open VSX  | 742,054 字节，SHA-256 `00da15be7656736cf6b9542a73e2b0c6263220aa9319616fc8882a10cc44f8c9`，与原发布回执一致。                                                               |
| JetBrains | 更新 `1205656` 已批准、列出且未隐藏；1,561,088 字节，SHA-256 `28724dd6d05401acea944a8fc1cfb8c7cc894b3fa8c0c29215db21fafd95f3f6`，与原回执一致。                            |
| 真实交付  | 跨版本累计 **34/45**，普通 **27/36**、首次入口 **7/9**，剩余 **11** 项。不是 `.130` 单轮成功率，也不是完整原生旅程通过率。                                                 |

本轮公开回读没有新增模型任务验收；原 `.129 verify-11` 派发仍待核对，不能重发不确定请求。**NOT_PAID_READY / NOT_ADMITTED / HOLD** 保留。

## 安全考虑

Goal 的工具证据、文件摘要和模型结论分别核对。取消、未知用量、预算耗尽或检查点写入失败时，不接受完成声明或借下一轮隐式追加请求。该实现不承诺恶意文件系统 ABA 防护，也不保证最后核对之后文件永不变化。

## 故障排查

| 现象                             | 处理                                                                        |
| -------------------------------- | --------------------------------------------------------------------------- |
| 升级后仍显示旧 CLI               | 运行 `cc --version`、`cc doctor`，检查 IDE 指定的实际可执行路径并重启宿主。 |
| Microsoft 商店未找到扩展         | 使用上方 Open VSX 版本化 VSIX；此渠道本轮暂缓。                             |
| Goal 不接受之前通过的检查        | 核对工作区 / 产物是否变化、读取范围是否完整，并重新执行所需检查。           |
| 未找到 `verify:` 或 Terra 新能力 | 属于后续主线尚未发行的能力，安装 `.130` 不会获得。                          |
| 恢复请求被拦截                   | 核对原副作用、费用与持久回执，不通过重发判断旧请求是否执行。                |

## 关键文件

- [公开发行回执](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli/evidence/release130-public/publication.json)
- [CLI README](https://github.com/chainlesschain/chainlesschain/blob/main/packages/cli/README.md)
- [当前任务表](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli-ide-codex-claude-gap-review-2026-10-27.md)

## 相关文档

- [Agent](./cli-agent) · [IDE](./ide-plugin) · [Memory](./cli-memory)
- [.129 升级说明（历史）](./cli-ide-update-2026-10-29)
- [输入与恢复](./agent-input-and-recovery) · [自进化开关](./self-evolution-configuration)
