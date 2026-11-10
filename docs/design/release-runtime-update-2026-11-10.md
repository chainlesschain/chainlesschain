# CLI .146 / IDE 公开发行与运行时边界（2026-11-10）

本轮按 `main@6338e6a1b` 核对代码与 Git 记录。主线提交、npm 发行来源、IDE 发行来源和客户端安装包分别记录；文档更新不产生新的模型任务验收。

## 公开组合与源码身份

| 组件                                               | 当前公开版本                 | 来源与边界                                                                                                                       |
| -------------------------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| CLI                                                | **0.166.146**                | 不可变来源 `daafda2cf7790580467dae8ce006ceaa1285d3b4`，标签 `v-npm-0-166-146`；官方 OIDC 发布及公开安装核验完成                  |
| Agent Protocol / Context-Memory Kernel / Agent SDK | **0.1.13 / 0.1.12 / 0.2.18** | 先于 CLI 发布并验证其依赖；Session Core 保持 **0.3.27**                                                                          |
| VS Code / Open VSX                                 | **0.37.185**                 | 来源 `2ae832f90`，官方工作流 `42819326161` 成功并公开；推荐 CLI .146。旧 .184 标签与失败记录保留                                 |
| JetBrains                                          | **0.4.199**                  | 来源与 CLI 同为 `daafda2cf`；官方工作流 `42761723143` 成功，Marketplace 已批准并列出（`approve/listed=true`）；推荐 CLI .146     |
| PC / mobile                                        | **v5.0.3.145**               | **v5.0.3.146 尚未公开**；当前 Android bundle 仍携带 CLI .145，需修复后完成构建与公开资产回读。其他平台构建成功不等于整批发布完成 |

JetBrains 曾获得“成功上传后可在审核期间进入客户端阶段”的限定授权；本次 .199 已有批准及公开列出状态，不再把它写成待审。该授权不替代 CLI、Open VSX 或客户端制品的公开核验。

## Memory 显式修正与保留策略

Canonical Memory 修正通过权威记录的 revision 校验与 compare-and-swap（CAS）提交。CLI、App Server 及 IDE 投影沿同一修正语义更新；旧 revision 发生冲突时拒绝覆盖，避免并发编辑静默替换较新的记录。修正不会自动授予 Memory 使用权，也不会代替实际模型派发前的授权核验。

当前允许 inline 内容修正；带外部 `contentRef` 的修正仍以 `memory_correction_content_ref_unsupported` 拒绝，并保留原记录、revision 和内容引用。这样后续授权删除仍能找到原始外部内容的清理目标，避免先丢失引用再误报已清除。直接 native 提交同样受保护，App Server 返回冲突且不发送成功修正通知。完整的外部内容替换与持久清理对账尚未实现，legal hold 策略和自动重放范围没有放宽。

## 原生请求、MCP 续接与输出预算

原生请求类型兼容沿现有协议和宿主入口处理，避免合法原生请求在接入层被错误分类；它不改变授权主体，也不证明旧公开桌面已具备新入口。新桌面能力仍需匹配的构建、当前预览和独立确认。

持久 MCP Tasks 的结果交付与模型续接绑定原会话、delivery authority 和持久状态；恢复时保留用户草稿，并按已有交付记录决定续接。工具结果已到达、模型已继续、用户已接收是不同状态，不能由单一成功信号相互推定。

显式 agent 输出上限跨入口传递到模型请求边界，避免入口切换丢失用户指定的预算。输出上限不等于上下文窗口，也不保证供应商计费、费用归因或完整生命周期验收。第三方 MCP 服务、真实模型和多宿主完整旅程仍按各自证据判断。

## 诊断恢复与发布测试

模型输入诊断保留来源、实际发送复核与用量归因的有界投影，IDE 流式会话可读取持久诊断状态；provider 失败归因保持不含内容。恢复时不能把“已读取文件”当作“正文已发送”，不能用后续成功改写第一次失败观察。

VS Code .185 的 RemoteSSH 修复针对容器依赖安装：update、install 与用户初始化分段执行，共享有界总截止时间，并限制 APT 网络重试。它保留官方源、签名校验、真实 RemoteSSH 宿主、准确源码及候选 VSIX 字节绑定；没有通过跳过门禁来发布旧 .184 候选。新 .185 使用新的发行来源，npm 与 JetBrains 不可变标签不移动。

PR #591 已进入本轮主线，只收紧 Codex history probe：先保存原始响应，再拒绝超过显式正整数分页上限的数据，失败时保留已接受前缀和被拒响应。四项回归覆盖首个终止页超限、后续页超限、恰好等于上限及无显式上限。它未修复官方 Codex 第一次冷扫描遗漏身份的问题；[#572](https://github.com/chainlesschain/chainlesschain/issues/572) 与 [上游 #60529](https://github.com/openai/codex/issues/60529) 保持独立跟踪，原失败证据、严格扫描和生产准入不变。

PR #593 已进入主线，修复 rewind 弹窗与当前可见会话的锚定。已公开 JetBrains .199 仍来自 `daafda2cf`，不包含这项后续源码修复；合并状态不能当作新插件已发布，也不重新认证旧产品。

## 验收范围与证据

保留各自历史来源与轮次：Sol 原冻结 **41/45**、跨修订 **45/45**、独立四项 **2/4**；火山累计 **36/45** 与 .140 严格 **24/45** 分别记录。它们不合并为 .146 的新成绩。本轮文档没有新增真实模型验收，也没有解除多语言质量、完整生命周期、费用对账或原生准入限制；**NOT_PAID_READY / NOT_ADMITTED / HOLD** 保留。

- [CLI .146 官方 OIDC 发布](https://github.com/chainlesschain/chainlesschain/actions/runs/42758119265) · [当时的 npm 公开回执](https://github.com/chainlesschain/chainlesschain/blob/71d392c0b/docs/research/cli/evidence/release146-public/publication.json)。该回执中的 IDE 进行中状态属于较早时点，不追改历史。
- [VS Code .185 官方发行](https://github.com/chainlesschain/chainlesschain/actions/runs/42819326161) · [JetBrains .199 官方发行](https://github.com/chainlesschain/chainlesschain/actions/runs/42761723143)。
- [Memory 修正与外部引用拒绝的候选审查记录](https://github.com/chainlesschain/chainlesschain/blob/71d392c0b/docs/research/cli/evidence/release146-candidate/receipt.json)；其中的本地测试及候选状态按原时点保留，不能代替后续准确提交的发行门禁。
- [PR #591 诊断保护](https://github.com/chainlesschain/chainlesschain/pull/591) · [本轮冷扫描失败记录](https://github.com/chainlesschain/chainlesschain/actions/runs/42832133372)。
- [当前 Runtime 架构](./cli-runtime-current.md) · [发布与运行时边界](./modules/110-agent-platform-release-boundaries.md) · [前一轮历史设计](./release-runtime-update-2026-11-09.md)。
