# CLI 0.166.103 预算边界、模型分层与 IDE 设计增量（2026-10-16）

## 源码与公开制品

本页核对主线至 `920f263e3f`。公开 CLI **0.166.103** 的不可变标签 `v-npm-0-166-103` 指向 `b235ac80687fe31a45db18388ffc0f2424a26fb2`；该提交已完成三系统 CLI CI、CLI Strict Sandbox、[OIDC 发布](https://github.com/chainlesschain/chainlesschain/actions/runs/38854237037)与[独立 npm 回读](https://github.com/chainlesschain/chainlesschain/actions/runs/38855697795)。

公开 Open VSX **0.37.148** 和 JetBrains **0.4.165** 均推荐 CLI `.103`。VS Code 发行提交为 `c8a64caa928ff0d46007bf594cd92808b707abba`，[标签工作流](https://github.com/chainlesschain/chainlesschain/actions/runs/38861905795)完成三系统宿主检查、上传和公开 VSIX 回读，草稿容量修复已包含在 `.148`。JetBrains 发行提交为 `fa6484021670a09afb46aa46f0e17e2c707ec539`，[标签工作流](https://github.com/chainlesschain/chainlesschain/actions/runs/38860748741)完成宿主检查、上传和市场回读。两者发行 SHA 分别记录；Microsoft Marketplace 尚未发行。

| 层                                   | 当前版本              | 范围                                                     |
| ------------------------------------ | --------------------- | -------------------------------------------------------- |
| CLI                                  | 0.166.103             | 预算 scope、谱系和出口拒绝；承接 `.102` 模型与运行时修复 |
| Session Core / Context Memory Kernel | 0.3.19 / 0.1.10       | 沿用独立公开子包                                         |
| Personal Data Hub                    | 0.4.65                | 回答引用附带来源快照证据                                 |
| Open VSX / JetBrains                 | 0.37.148 / 0.4.165    | 已公开，均配对 CLI 0.166.103                             |
| VS Code 草稿容量修复                 | 已包含于公开 0.37.148 | 容量到限时回收空草稿与已接受输入的恢复副本               |
| Desktop / Android / iOS              | v5.0.3.140            | 独立产品安装包，来源仍为 `f733f92cb9`                    |

## 正式预算 scope 与谱系

`5d4f675e24`、`c939e4cced` 和 `ace6b3e0c1` 将正式预算传输、谱系登记和受限出口收口。`formal-budget-provider-scope.js` 使用 `AsyncLocalStorage` 绑定可信宿主注入的 transport 和 run ID；模型生成器与响应体必须在 scope 内消费，退出时取消未完成请求，拒绝嵌套替换以及 scope 关闭后的请求。

`formal-budget-lineage-registry.js` 将运行绑定到已有预算谱系；`formal-budget-authority.js` 与 transport 保存预留、结算和检查点状态。历史 v1/v2/v3 共享 **$99**，新运行或新版本不能重置历史费用，也不能将未知余额当作全额可用。

正式 scope 下，未接入治理传输的模型适配器、Agent 工具、外部网页/浏览器、进程与 worker、凭据代理、后台控制、搜索及云服务入口在执行前拒绝；并行工具执行必须传播预算拒绝。普通 scope 外仍沿用已有运行时行为。这些进程内守卫不证明任意 SDK、现存服务、子进程及操作系统网络均已隔离。

正式 transport 保持 **`paidReady:false`** / **NOT_PAID_READY**，付费评测仍拒绝启动。尚缺账户级有效价格、全部输入和默认 thinking 总计费输出上界、历史及取消请求对账、独立单调生产检查点和可信宿主物理出口隔离证明。冻结的 36 项任务和 9 次首次安装仍为 **NOT_RUN（0/36、0/9）**，完整 native review **NOT_ADMITTED**，自动晋升 **HOLD**。发行门成功不改变这些结论。

## 模型服务层级与用量

`15f249bb4a` 增加 `llm.serviceTier` 与 `cc agent --service-tier`，根据 provider、精确 model 和 endpoint 检查可用层级；不支持的组合在发送前拒绝。`standard` 不强行发送非默认服务层级，其他取值只在模型能力合同支持时传递。静态目录支持不代表真实账户已经开通该层级，也不代表性能已验证。

`.102` 的 `cc2b762dc9` 修复已审阅 Priority / Ultrafast 价格条款的校验，使 Session、预算与 Eval 投影可以读取合法价格；未知层级及无效乘数仍拒绝。`context-source-ledger.js` 区分 `estimated` 与 `observed`，按会话或轮次统计来源 token，但报告明确保留 `currentRequestVerified:false`、`billingVerified:false`。来源估算不能作为 provider 账单或正式预算结算依据。IDE 在缺少 input/output 明细时可展示 aggregate token 用量。

## 上下文、记忆与引用

运行时补齐上下文来源账本、目标绑定、MCP 工具检索和压缩后的恢复提示；记忆查询按已验证索引和权限边界读取。此前 `.101` 的拒绝保护仍生效：不能清空非空上下文或丢弃新摘要，已完成模型请求的用量即使摘要未采纳也要结算。

`db0f662c00` 与 Personal Data Hub `.65` 为回答引用增加 `citationEvidence`，记录来源元数据和紧凑事实摘要的 SHA-256。引用附着于生成时的来源快照，避免将后续变化的库状态当作原回答证据；摘要哈希本身不保证模型结论正确。

## VS Code 草稿容量回收

公开 `.148` 对应 `c8a64caa92`：128 个会话记录到限时，优先回收空记录及仅含已接受输入的恢复副本。未发送文字、附件、已保存问题答案、接受状态未知或被拒绝的提交及不可读取记录保留。旧库即使超过上限，仍允许更新、清空或丢弃已有草稿；若全部记录均含需保存的输入，提示用户恢复后释放空间。公开 VSIX 为 718,465 字节，SHA-256 为 `a6fb1fcc9e7dec381d63e02aba6f96dc8d93eb54f6c571f9dd217dc2bcd4c2ca`。

## 验证与证据

版本发布与公共可获取状态依据[准入及回读记录](https://github.com/chainlesschain/chainlesschain/blob/fe85d501ea4235d8bcd2aac2eda78dd39e269525/docs/research/cli/evidence/implementation-plan-2026-10-15/formal-paid-release-gate/README.md)。源码与公开状态分别记录；Windows 启动时间、临时目录及跨进程原子读取测试修复不构成新的性能承诺。安装、模型层级和草稿故障处理见[用户指南](https://docs.chainlesschain.com/chainlesschain/cli-ide-update-2026-10-16.html)，此前上下文拒绝见[10 月 15 日设计](release-runtime-update-2026-10-15.md)。
