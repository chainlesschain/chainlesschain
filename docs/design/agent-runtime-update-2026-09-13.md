# Agent 运行时增量设计（2026-09-13）

本次按源码 `a1db1f98aadb120626d48da65cb4809479b88799` 核对。公开 CLI `0.166.46` 的标签 `v-npm-0-166-46` 指向 `b15104ebbe100e72b366d452f0c6f779564197d3`；源码合并不等于 Desktop、IDE 或 SDK 制品同步发布。

## 普通 Agent 与受治理部署

`673e15dab4` 恢复没有 evolution deployment 的普通 Agent 聊天：不存在认证 ingress 时沿用普通 provider 路径；存在 ingress 时必须调用 `prepareModelRequest()`，配置或认证失败不回退普通路径。`b15104ebbe` 修复缓存标识绑定的隐私误报。普通聊天可用不意味着取得候选审核、Wiki 写入或 Skill 发布权限。

`a1db1f98aa` 合入演进闭环相关实现与测试，包括持久 Run 证据到 Wiki 维护的连接、提交前 evidence lease 校验及候选正文与 evidence digest 分离。仓库闭环清单仍记录未完成项；生产 KMS/PKI、独立 witness、真实 grader 与 automatic active promotion 的 HOLD 边界继续保留。

## 模型能力与 Responses 传输

本节及后续模型能力、延后问题、沙箱能力、中文召回、插件评测与容量测量增量来自合入主分支的开发线，不在 `v-npm-0-166-46` 的祖先链中。使用时需该主分支源码构建，不能仅凭 package.json 同为 `0.166.46` 就认为公共 npm 包包含这些能力。

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
| `d856e5b3eb` | 持久 Memory 与后台 Agent 状态容量测量                                    | 测量入口不构成性能 SLO；后台列表索引与分页尚未交付      |

Agent shell 的 Docker/bubblewrap 当前不能兑现域名级 allow/deny；Docker 也不支持细粒度文件规则。能力不支持时启动前拒绝。该报告不替代另一条 ProcessExecutionBroker 的平台执行证据。

## 发布与验证证据

2026-09-13 npm 官方 registry 回读 `latest=0.166.46`。精确发布提交的 [CLI CI](https://github.com/chainlesschain/chainlesschain/actions/runs/34728599936) 和 [CLI Strict Sandbox](https://github.com/chainlesschain/chainlesschain/actions/runs/34728599741) 已通过 Linux、Windows、macOS 配置任务；[npm 发布工作流](https://github.com/chainlesschain/chainlesschain/actions/runs/34728731616) 成功。后续同 SHA 的取消运行不替代这些已完成证据，也不能把本次证据继承给下一次发布。

本页记录源码行为与已有验证，不声称执行了真实付费模型、生产治理部署或全部平台 UI 验收。

## 相关文档

- [受治理 Skill 自进化设计](modules/112-governed-skill-evolution-design.md)
- [用户升级指南](https://docs.chainlesschain.com/chainlesschain/agent-platform-release.html)
- [仓库闭环核验](https://github.com/chainlesschain/chainlesschain/blob/a1db1f98aadb120626d48da65cb4809479b88799/docs/cli/EVOLUTION_P0_4_REPOSITORY_CLOSURE_2026-09-12.md)
