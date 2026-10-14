# CLI 0.166.101 上下文压缩与 IDE 恢复设计增量（2026-10-15）

## 源码、制品与验收边界

本页核对至 `main@6752b49e1e`。不可变标签 `v-npm-0-166-101` 指向同一提交；该提交的 [CLI CI](https://github.com/chainlesschain/chainlesschain/actions/runs/38559229180) 和 [CLI Strict Sandbox](https://github.com/chainlesschain/chainlesschain/actions/runs/38559228915) 均成功。npm `chainlesschain@0.166.101`、Context/Memory Kernel `0.1.10` 与 Open VSX `0.37.145` 已可公开获取。JetBrains Marketplace API 已列出 `0.4.162`；源码中的 `0.4.163` 推荐 CLI `.101`，但尚未作为公开版本核验。桌面和移动端产品继续使用独立的 `v5.0.3.140` 安装包，不能从 CLI 发行推断原生包已更新。

| 层 | 本轮变化 | 边界 |
| --- | --- | --- |
| Kernel 0.1.10 | 压缩规划拒绝清空非空上下文或丢弃新生成摘要 | 返回 `context_over_budget`；不提交破坏性新 head |
| CLI 0.166.101 | 结算已发生的 provider 用量，保存工作流结果与恢复上下文 | 用量未知或结算失败时停止，不能凭失败压缩重发付费请求 |
| Open VSX 0.37.145 | 草稿在重置、恢复会话和关闭最后标签后仍可加载；失败可重试 | 草稿加载不取得 CLI 的执行权限 |
| JetBrains 0.4.163 | 配对 CLI `.101` 的源码候选 | Marketplace 当前公开列出 `.162` |

正式 36+9 评测仍为 **NOT_RUN**，完整 native review 为 **NOT_ADMITTED**，自动晋升继续 **HOLD**。本次包含耐久正式预算 authority 的存储和受守护传输代码，但其 `NOT_PAID_READY` 状态不变：跨数据库谱系唯一性、防回滚、账号价格与输入上界证据以及完整运行时隔离尚未闭环，交互式流式路径也未接入该传输。因此不能把本次发布视为真实付费评测的启动许可或费用保证。

## 压缩拒绝与结算顺序

`aa13cb2451` 与后续 Kernel `.10` 修复要求压缩后的计划仍保留恢复所需的上下文；即使摘要器回退，也不能把非空上下文压成空集或丢失刚生成的摘要。拒绝时原会话上下文与 head 保持原样，摘要可信级别和选择预算不被悄悄提高。

`688268fc40`、`13c9fcce7b` 和 `1139fb802d` 将 provider 用量回执、请求准入及压缩结算顺序对齐。已经完成的压缩请求即使最终规划被拒绝，也只记账一次；未知用量或持久结算失败必须停下。工作流压缩被拒绝标为失败，提交结果不确定标为需要对账，普通任务中断标为未完成。恢复端据此区分“模型已计费但摘要未采纳”和“任务已完成”，避免把失败压缩当作免费重试。

## IDE 草稿与连接测试

`6a71a1147b` 修复 VS Code composer 在重置、会话恢复及关闭最后标签后的草稿加载，并为失败的加载保留重试控制。LLM 连接测试与聊天 CLI 的连接判定对齐，区分缺少本地依赖和 provider 返回的错误。CLI 仍负责模型请求和执行；IDE 只展示其实际宿主状态。`ef9553f0d2` 修正 JetBrains 候选版的发布期版本期望，不构成 Marketplace 上架证明。

## 发行与后续验证

准确源码的 CI 成功、npm 公开版本和 Open VSX API 版本分别核验；它们不替代正式模型评测、原生持久恢复或 JetBrains `.163` 的公开下载回读。安装与故障排查见[用户指南](https://docs.chainlesschain.com/chainlesschain/cli-ide-update-2026-10-15.html)，此前 `.100` 的流式重试及工作树保护见[10 月 13 日设计](release-runtime-update-2026-10-13.md)。
