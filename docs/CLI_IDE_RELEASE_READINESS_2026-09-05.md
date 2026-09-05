# CLI 与 IDE 下一轮发布检查表

当前只做本地准备，不代表已经获准推送 GitHub、打 tag 或发布 npm / IDE 插件。IDE 可随后发布，更新说明应包含它实际配套的 CLI 版本和变更。

## 启动里程碑与发布边界

本地 CLI 入口不需要等待整份演化路线图完成。2026-09-05 实测 `node packages/cli/bin/chainlesschain.js --version` 返回 `0.166.22`，`agent --help` 正常退出。这只证明当前工作区的命令入口可加载，不等于干净环境安装、真实模型会话、IDE 宿主联动或三平台发布验收通过。

用户截图中的“演化工作台不可用”是另一项启动条件：IDE 在能力协商时未得到 `evolutionWorkbench.available=true`，尚未发送工作台 RPC，审核和回滚继续禁用。它不是等完本轮测试或只升级版本就会自动消失。公开 CLI 的部署 loader 需要同时提供绝对路径的 `CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_DESCRIPTOR` 和 `CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_TRUST_ROOT`，认证签名、模块摘要及 `serve` / `evolution` 命令许可；真实部署模块还须构造并返回受治理的 `workbenchHost`，接入同租户投影、持久化、身份、active state 及审核/回滚执行器，不能用空对象或测试回执冒充可用宿主。2026-09-06 本轮只读检查发现当前终端的两项变量均未配置；IDE 子进程实际环境仍需独立核对。

下一个面向截图的里程碑应集中在 **真实宿主部署配置 → CLI / App Server 能力暴露与候选列表 → IDE 连接和权限验收**。该最小可用链不要求先完成全部演化路线项，但也不等于默认启用自动晋升；真实审核和回滚必须另有受信身份、权限与持久效果证明。当前批次测试收尾的时间估计不能当作工作台正式启用时间，仍需先明确目标部署和凭据提供方式。

本轮实际执行 `node packages/cli/bin/chainlesschain.js evolution workbench list --limit 1` 返回退出码 1：`Evolution Workbench is unavailable: a trusted deployment host is required`。这是当前命令环境的真实未配置状态，不是启动验收通过；没有为消除提示而注入假宿主或启用审核/回滚。

2026-09-06 的启动接线批次已补上实际 Workbench Review Ledger 适配器与签名部署工厂：逐项人工响应采用独立签名外层，原 canonical Review decision 不增删字段；投影/preparation/真实决策/settlement 均有持久认证与跨进程恢复。CLI 13 文件最终 149 通过、1 项既有平台跳过。该结果只证明审核运行时这一段，真实身份、active-state/Registry 回滚、完整宿主和 IDE 环境联调仍未完成。详见 [接线合同与恢复边界](EVOLUTION_WORKBENCH_REVIEW_RUNTIME.md)。

批处理成功回执现为 v2，JetBrains 新源码兼容 v1/v2 的终态显示；旧已安装插件不随本地源码自动更新。后续 CLI/IDE 发布应明确该合同变化，插件推荐版本仍等 CLI 真正发布后再调整。

JetBrains 使用本机完整 JDK 21 运行 Gradle 定向任务，完成插件源码编译并通过 `EvolutionWorkbenchTest` **6/6**。最初默认工具链和另一不完整 JDK 目录均未被 Gradle 识别，未将这些失败计为通过；最终成功使用 `chainlesschain-temurin21/jdk-21.0.12+8`。没有修改系统 Java 配置或已安装插件。

## 子 npm 包必须先核对

2026-09-05 在本地提交 `db473898ab` 上，对 13 个 CLI 子包逐一比较 npm 已发布 tarball 与仓库声明的发布文件（文本比较只归一化 CRLF）。结果不能用“本地版本号已经存在”代替：

| 子包                           | 审计时 npm 版本 | 下一轮处理                                                                                          |
| ------------------------------ | --------------- | --------------------------------------------------------------------------------------------------- |
| `@chainlesschain/session-core` | `0.3.11`        | 必须发布新版本：已发布包缺少 CLI 使用的 `evolvable-artifact` 文件及出口，另有结构化演化 Memory 变更 |
| `@chainlesschain/core-db`      | `0.1.4`         | 必须发布新版本：实际发布的数据库参数绑定实现落后于仓库，缺少未带前缀命名参数的规范化                |
| 其他 11 个子包                 | 各自审计时版本  | 当时发布文件一致；最终候选形成后再核对，不机械重发                                                  |

现有 `npm-publish.yml` 会跳过 registry 中已存在的版本，因此这两个子包需要升版，并同步 CLI 依赖及 lockfile。不能只升 CLI 版本，也不能覆盖已存在版本。`agent-sdk` 和 `context-memory-kernel` 的受保护发布入口仍遵循现有工作流。

## 发布顺序与门禁

1. 完成当前代码批次、本地验证和子包 tarball 复核，确定候选版本；只提交本地 Git。
2. 获得推送授权后，把候选提交送到 GitHub。CLI 必须在**完全相同的 release commit** 上通过 `CLI CI` 与 `CLI Strict Sandbox` 的全部已配置 Linux、Windows、macOS 检查；相关子包也必须通过对应工作流矩阵。
3. 按工作流依赖顺序先发布必需子包，确认 registry 中的新版本、文件和出口可用。
4. 验证仅从 registry 安装、不依靠 monorepo workspace 链接的 CLI，然后发布 CLI。
5. CLI 确认可公开安装后，更新 VS Code 与 JetBrains 的 CLI 推荐版本、各自 changelog / release notes，并跑完相应构建、安装和兼容性测试，再安排插件发布。

本地定向测试通过、部分矩阵通过、旧提交检查通过或超时退出，均不能替代发布门禁。IDE 推荐版本不要提前指向尚未公开发布的 CLI。

## 已知检查风险（审计快照，不是当前候选结论）

审计时 CLI npm 最新版为 `0.166.22`；VS Code 插件为 `0.37.83`，VS Code 与 JetBrains 均推荐 CLI `0.166.22`。最新远端 main 当时为 `93bd25a1f8c7b282e9a834c00de5349ab1a3a07b`，其工作流仍有失败：

- [CLI CI](https://github.com/chainlesschain/chainlesschain/actions/runs/33935598426)：推荐版本与最低版本的测试预期不一致（本地复现 3 项失败）；另有 Windows 队列超时和 macOS 跨进程用例失败。
- [CLI Strict Sandbox](https://github.com/chainlesschain/chainlesschain/actions/runs/33935598279)：Windows 出现语法 / worker 错误。

后续本地修正不等于这些门禁已通过；必须以最终候选 SHA 的完整新结果复核。不要把此快照当作持续更新的 GitHub 状态。

## IDE 更新说明草案

版本号在 CLI 公开发布后填入，不提前写入当前已发布版本的历史说明。

> 配套 CLI：`待发布版本`。本轮 CLI 完善受控 Knowledge 撤销：真实 Skill 回滚、候选拒绝及持久准入阻断；基于已知直接 / Wiki 来源的晋升、回滚和迁移防复活；指定 Wiki 原始状态的定点 tombstone、独立效果回读和联合结算；真实账本提交处的后续 Wiki 写入阻断及多级 Wiki 来源追踪；已有多级 Wiki 派生 Skill 的原始来源复核、安全回滚及候选拒绝，覆盖负面证据和来源摘要别名；并发写入保护与进程退出后的幂等恢复。
>
> 这些是受控演化后端能力。IDE 只展示实际宿主提供的能力，未配置 authority 的功能仍保持 unavailable，不代表默认启用了无人值守晋升、完整跨设备知识治理或隐私物理删除。

> Workbench 审核新增真实账本持久化及重启恢复：人工请求绑定与原审核决策分别验签，过期且未执行的审批拒绝执行，已经落账的项不重复要求人工或重复记账；JetBrains 配套支持新的 v2 批审完成回执。该项不代表默认部署已启用审核或回滚。

最终说明应结合实际发布差异删减，明确哪些是 CLI 后端变更、哪些是 IDE 自身变更，不将未接通的产品入口标为可用。
