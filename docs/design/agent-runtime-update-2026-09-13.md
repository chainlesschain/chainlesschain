# Agent 运行时增量设计（2026-09-13）

本次更新按 `main@25fbc7d24104a97c1532334de3d3fe0c05c358f9` 核对。公开 CLI `0.166.48` 的标签 `v-npm-0-166-48` 指向 `43c6bba51a643c1a0d6e5a05da5cb97177fe1f86`；Open VSX `0.37.98` 对应提交 `7168d2f02b`，JetBrains Marketplace `0.4.123` 仍对应 `e9c514a1be`。主线已准备 CLI `0.166.49` / VS Code `0.37.99` 源码候选，但它们尚未继承公开制品证据。CLI、VSIX、JetBrains ZIP、Desktop 原生安装包和 SDK 始终是独立制品。

## 0.166.49 源码候选：请求级上下文窗口权威

`bdee42358d` 不再让 planner、自动压缩器、会话报表、REPL 与 IDE 各自只按静态模型目录推导窗口。每次主模型请求在发起前以实际 `provider`、`model`、`baseUrl` 和 `contextMemoryModelWindowTokens` 解析唯一 `requestContextWindow`；目录选择的 canonical provider profile 优先，其他路径通过同一 `resolveModelCapabilityProfile()` 合同解析。该值随 `token_usage` 事件进入 headless stream 和会话 ledger，只有 `1024..16777216` 范围内的安全整数可以持久化。

```text
request config / canonical provider profile
  -> requestContextWindow
     -> planner + PromptCompressor
     -> primary token_usage event
        -> runtime usage ledger
        -> REPL / cc context --json
        -> VS Code context indicator
```

消费端只选最后一个无 `attribution` 且 `source` 为空或为 `model` 的主请求用量；子 Agent 和 semantic-compaction 调用不能覆盖主窗口指示。`cc context` 在没有显式 `--model` / `--provider` 冲突时优先使用 ledger 记录的窗口，消息分桶 token 仍是启发式估算。VS Code 有 provider 用量时展示该请求的 uncached input、cache read、cache write 与 output；只能从 transcript 回退时明确标注 `estimated`，并说明 tool schema 可能未计入。

大窗口会话的自动压缩改为以 token 压力为主，不再仅因 50 条短消息触发；小窗口仍保留消息数保护。以上实现已由 `25fbc7d241` 准备为 CLI `0.166.49` / VS Code `0.37.99`，但当前公开安装仍应使用 CLI `0.166.48` / Open VSX `0.37.98`，直到新候选完成自身精确提交门禁和公共回读。

## 0.166.48 发布收口

`0.166.48` 在下述 `0.166.47` 基线上加入可重复平衡插件评测、95% 区间与 reviewer holdout，持久化 Headless deferred question 恢复，文件身份绑定的后台会话只读索引，以及 revision/digest 绑定、受生命周期/作用域/到期和 sink 治理的语义候选。Agent Protocol `0.1.10`、Context Memory Kernel `0.1.3` 与 Agent SDK `0.2.10` 先于 CLI 公开；VS Code `0.37.98` 同步消费这些 CLI-owned 投影。

## 0.166.47 设计收口

`0.166.47` 将此前的主分支增量纳入公开 CLI：版本化模型能力 profile、精确官方目标的原生 OpenAI Responses 传输、模型出口清单、可延后回答的问题、受治理中文记忆召回、插件 control/candidate 绑定评测、沙箱能力报告与持久路径容量测量均已进入发布祖先链。静态 profile 的 `runtimeVerified:false` 仍只表示目录事实，不证明账号、配额或网络可用。

后台会话列表新增 `--limit` / `--offset` 有界分页，supervisor 不再为列出全部历史记录而一次加载完整结果集。Keeper、worker 与 supervisor 的心跳/所有者探测改为非阻塞锁路径，避免周期任务持有状态锁时互相等待；owner lock 忙时保留上一轮健康状态，后续周期重试，而不是误判进程死亡。所有 Git 调用明确使用参数数组和 `shell: false`，不把仓库内容解释为 shell 语法。

Evolution ledger v2、证据绑定 Wiki 维护与运行时 revalidation 形成耐久闭环：candidate digest、evidence digest 与发布校验分别绑定，缺失、陈旧或不一致的证据失败闭合。该闭环仍不产生生产身份、KMS/PKI、独立 witness/grader 或 automatic active promotion authority；自动晋升继续为 `HOLD`。

## 普通 Agent 与受治理部署

`673e15dab4` 恢复没有 evolution deployment 的普通 Agent 聊天：不存在认证 ingress 时沿用普通 provider 路径；存在 ingress 时必须调用 `prepareModelRequest()`，配置或认证失败不回退普通路径。`b15104ebbe` 修复缓存标识绑定的隐私误报。普通聊天可用不意味着取得候选审核、Wiki 写入或 Skill 发布权限。

`a1db1f98aa` 合入演进闭环相关实现与测试，包括持久 Run 证据到 Wiki 维护的连接、提交前 evidence lease 校验及候选正文与 evidence digest 分离。仓库闭环清单仍记录未完成项；生产 KMS/PKI、独立 witness、真实 grader 与 automatic active promotion 的 HOLD 边界继续保留。

## 模型能力与 Responses 传输

本节及后续模型能力、延后问题、沙箱能力、中文召回、插件评测与容量测量已随 `v-npm-0-166-47` 公开。更晚的源码变化仍不能自动继承此次发布证据。

`2ed27fa29e` 新增版本化 `chainlesschain.model-capability-profile/v1`，绑定 provider/model、窗口、输出预算、目录版本与 digest。`cc llm capabilities` 只读查询不访问凭据或模型，`runtimeVerified:false` 表示静态能力信息，不证明目标账号可运行。

`16b99bdf7f` 让 profile 的 `runtimeProtocol` 参与实际请求选择。只有精确官方 OpenAI endpoint 与目录明确标记的精确模型使用 Responses；第三方兼容网关保持 Chat Completions。实现位于 `packages/cli/src/lib/openai-responses.js` 和 `packages/cli/src/runtime/agent-core.js`。

Responses 使用 `store:false`、显式 input item 回放与相同 `call_id` 的工具结果，保留受限加密 reasoning item 供下一回合使用。流式失败或取消不能变成成功；不完整工具调用不进入执行器。缓存输入与普通输入分开计量，reasoning 消耗仍包含在输出 token 中。真实账号认证及独立 reasoning usage 明细仍是后续工作。

## 延后回答与 App Server 绑定

`8eda8414f5` 为 `ask_user_question` 增加 `deferred` 模式，仅允许偏好与信息问题，立即返回 pending；决定和授权继续阻塞。回答以临时 user context 消费，不提升为 system 权限。旧 revision 的回答标记 stale，依赖它的决定需重新确认。

App Server 通过 `deferred_questions` 协商并校验 questionId、sessionId、turnId、toolUseId 与 sequence，防止跨回合错配。Headless、WebSocket、VS Code 与 Desktop pilot 有对应接线；未回答问题不承诺断线恢复。`fb19cb572a` 对歧义 app-server turn 失败关闭；`fff2e8fe81` 分离 IDE 聊天输入控制区，源码 UI 变化不作为商店发布证据。

## 记忆、评测与沙箱

| 提交         | 变化                                                                     | 约束                                                    |
| ------------ | ------------------------------------------------------------------------ | ------------------------------------------------------- |
| `1ecf2ffdd9` | Context Memory Kernel 中文词法召回与多语言评测                           | 召回仍受治理状态和作用域过滤，不把词法命中当作写入权限  |
| `c7b53c6b24` | 插件 control/candidate 绑定评测                                          | 评测结果不自动授予插件激活权限                          |
| `7fa21b99b7` | `cc sandbox capabilities` 输出 requested/enforceable/applied/unsupported | 查询时 applied 为空；仅成功启动的子进程可以报告实际应用 |
| `d856e5b3eb` | 持久 Memory 与后台 Agent 状态容量测量                                    | 测量入口不构成性能 SLO                                  |

后台列表分页已在 `5ebe18f1bd` 交付；它限制单次投影大小，但不把容量测量升级为生产性能 SLO。

Agent shell 的 Docker/bubblewrap 当前不能兑现域名级 allow/deny；Docker 也不支持细粒度文件规则。能力不支持时启动前拒绝。该报告不替代另一条 ProcessExecutionBroker 的平台执行证据。

## 发布与验证证据

2026-09-14 npm 官方 registry 回读 `latest=0.166.48`。精确发布提交 `43c6bba51a` 的 [CLI CI](https://github.com/chainlesschain/chainlesschain/actions/runs/34836323064) 和 [CLI Strict Sandbox](https://github.com/chainlesschain/chainlesschain/actions/runs/34836322816) 已通过 Linux、Windows、macOS 配置任务；[npm OIDC 发布工作流](https://github.com/chainlesschain/chainlesschain/actions/runs/34842104210)在核验全部 13 个子包后成功。IDE 配对提交 `7168d2f02b` 的 [Open VSX 发布](https://github.com/chainlesschain/chainlesschain/actions/runs/34851317943)完成三系统浏览器、三系统宿主、Remote-SSH 真容器和公共制品回读；JetBrains Marketplace `0.4.123` 的[既有发布](https://github.com/chainlesschain/chainlesschain/actions/runs/34766112823)继续有效。后续源码候选不能继承这些精确提交证据。

本页记录源码行为与已有验证，不声称执行了真实付费模型、生产治理部署或全部平台 UI 验收。

## 相关文档

- [受治理 Skill 自进化设计](modules/112-governed-skill-evolution-design.md)
- [用户升级指南](https://docs.chainlesschain.com/chainlesschain/agent-platform-release.html)
- [仓库闭环核验](https://github.com/chainlesschain/chainlesschain/blob/a1db1f98aadb120626d48da65cb4809479b88799/docs/cli/EVOLUTION_P0_4_REPOSITORY_CLOSURE_2026-09-12.md)
