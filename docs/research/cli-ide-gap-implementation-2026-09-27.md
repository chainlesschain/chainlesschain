# CLI / IDE 差距实施状态（2026-09-27）

对应 [CLI 审计](./cli/cli-claude-code-codex-gap-analysis-2026-09-27.md) 与 [IDE 审计](./ide/ide-claude-code-codex-gap-analysis-2026-09-27.md)。审计描述修改前快照；本表记录后续实现，避免重复开工或将局部测试当成全部验收。

实现分支：`feature/cli-ide-gap-closure-2026-09-27`。基线 SHA：`24911a536c9e9800c1e2e6b1d72e610841be4f5c`。按已验证范围分批提交，提交记录见下文；本地结果不代表 GitHub Actions 发布验收。

| ID                      | 当前状态         | 实现与有效证据                                                                                                                                                               | 剩余条件                                                                         |
| ----------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| MODEL-01                | 本地合同验证通过 | GPT-6 Astra/Sol/Luna、Opus 5.5 精确 profile；官方 endpoint 与自定义网关隔离；三个 GPT-6 型号的 Responses stream/tool/reasoning 回归                                          | 目标账号真实调用；未更改用户默认模型                                             |
| MODEL-02                | 本地合同验证通过 | tracker、预算、durable usage、恢复结算和 Eval 统一定价；逐请求长上下文/缓存/服务层级；未知价为 NULL/unpriced。已纳入 45 文件 822 项回归                                      | 目标账号与账单对照；旧聚合缺逐请求信息时保持 unpriced                            |
| READY-01                | 本地验证通过     | CLI-only 在 Run/付费分解/通知前拒绝；help、detect JSON、status 区分安装与准入；API 标为 text-only；`--cli-tool` 真正选后端。router/orchestrator 73 项通过，实际命令 4 项通过 | 精确提交 CI；保留逐请求治理门                                                    |
| CODEX-01                | 局部实现并验证   | camelCase item、文本/工具 delta、tokenUsage；thread/turn 关联；早到通知有界缓冲；RPC 超时；未知提交不 fallback。12 项通过                                                    | 官方生成 schema 校验、最新固定版本真实 turn；未扩大生产白名单                    |
| BRIDGE-01               | 局部实现并验证   | finalize-once；abort/timeout 共用 TERM/KILL；同步 spawn 拒绝；存活 child 的 error 等待 close；task:start 内取消不会 spawn。32 项通过                                         | 各平台真实进程树退出证明；主路由继续拒绝未 attested CLI                          |
| IDE-REPLAY / SESSION-01 | 局部实现并验证   | 后台有界正文缓存；重建读取经 canonical 完整性验证的 page；cursor/generation；双会话与 stale/reset 回归；真实 store 篡改拒绝                                                  | 当前是 active saved context，非完整压缩前档案；完整历史与 durable 增量去重仍待补 |
| IDE-DRAFT               | 局部实施         | VS Code 同一 Webview 的 composer/附件按 tab 隔离；CLI canonical 输入回执、原始提交 ID 去重及只读查询；SDK 可显式传入 ID                                                     | host/reload 持久草稿、question/request 草稿、双 IDE 回执接线仍待实现              |
| IDE-STREAM              | 本地验证通过     | 稳定文本节点增量 append，结束解析一次；选择区延迟格式化；follow-bottom；10K/100K/200K 与生成 Webview 滚动测试                                                                | 真实宿主 frame p95/最长 task 基准与验收                                          |
| IDE-MODE                | 局部实现并验证   | VS Code requested/effective/pending/failed；CLI init 的关联 ID、实际模式与 policy digest；退出确认阻止并存新 child；137 项回归及 4 项停止测试（含真实子进程）                | JetBrains 状态对应、真实组织策略/宿主旅程与全平台进程树证明                      |
| IDE-IMAGE               | 局部实现并验证   | 双 IDE 4 张/20 MiB turn/40MP 单图；异步处理、逐项错误；CLI 保留 8 张上限，并补齐 20 MiB turn/40MP/header/有界同句柄读取；CLI 图片相关 4 文件 61 项通过                         | 真实宿主测量；完整 codec/动画帧与读取延迟不在 header 准入证明内                  |
| NET-01                  | 待实施           | 当前受限域名执行继续 fail-closed                                                                                                                                             | Linux 不可绕过出口后端及真实绕过探针                                             |
| NET-02                  | 待实施           | 不宣称已有 HTTP/WS 撤销已覆盖                                                                                                                                                | 依赖 NET-01；revision 收紧终止存量连接                                           |
| VERIFY-01               | 待实施/验收      | 保留历史真实模型试点及其范围                                                                                                                                                 | 冻结 30–50 任务、干净安装、实际项目、双 IDE、成本/维护窗口                       |
| PLATFORM-01             | 待实施/验收      | 保留 Strict Sandbox 与 unsupported 分支                                                                                                                                      | OS/架构/后端/stdio 矩阵及最新系统真进程探针                                      |
| PERF-01                 | 待实施           | 复用容量工具与分页实现                                                                                                                                                       | 全扫/冷热分页/失效重建对比及冻结 SLO                                             |
| PERF-02                 | 待实施/验收      | 复用压缩与工具配对保护                                                                                                                                                       | 真实 usage 校准；中文/代码/emoji/schema 与事实保真                               |
| MCP-01                  | 本地验证通过     | 真实 loopback HTTP 验证 stateless 404、过期 session、并发单次重建、重建失败；只恢复连接，不重放结果未知的工具调用。相关 57 项回归通过                                        | 目标 MCP 服务端互操作与最终提交 CI                                               |
| MAINT-01                | 待实施           | 以已有不变量为前提，不按行数拆分                                                                                                                                             | runtime 与平台职责抽取、保行为验证                                               |
| DOC-01                  | 实现中           | 本表为两份报告共享状态入口                                                                                                                                                   | 随实现更新证据、最终 SHA 与验收条件                                              |
| UX-01                   | 按现有入口改进   | READY-01 改进 help/status；MODEL-02 改进费用未知值                                                                                                                           | 复用 doctor/instructions/cost；语音/主题不自动立项                               |

真人 NVDA/VoiceOver/Orca 听测、8h/24h 生产观察、真实模型账号与真实 IDE 宿主验收分开记录，目前没有新增结果。云恢复与新交互产品仍为报告中的条件性产品决策。

### IDE-DRAFT 输入回执边界

新增可选 `client_message_id`，CLI 仅在 canonical 持久化可用时声明 `input_receipts.version=1`。原始输入摘要与 user event 一同写入已有 writer authority，完整验证 chain/anchor 后才返回接受回执；重复 ID 不再调用模型，冲突/校验异常/存储失败不能降级为普通发送。`session show --json --input-receipt <id>` 只读查询，压缩后仍可查询原回执。SDK 已提供可选传参，并同步 VS Code / Desktop vendor。

接受不等于执行完成；落盘后、执行前崩溃可能仅留下已接受输入。丢失 ACK 时应先只读核对，不自动重放。当前查询与去重仍为 O(N) 全历史验证，未宣称索引性能或跨进程外部副作用 exactly-once。双 IDE 尚未消费回执，也尚未完成跨 reload 的持久草稿；不能将此后端合同计为 IDE-DRAFT 全部验收。

本批 CLI 回执/stream/session page/lazy dispatch：4 文件 93 项通过；SDK 发送与共享协议映射：2 文件 33 项通过；SDK 构建及 schema drift check 通过；修改的 CLI 源文件 ESLint 0 errors、3 项既有 unused-variable warnings。

JetBrains `ProtocolFixturesTest` 也已通过，包含同一份新增回执 fixture；这验证旧宿主可忽略新 ACK 并处理重复输入的终止事件，不代表 UI 已实现持久接受状态。

### IDE-IMAGE CLI 最终读取边界

普通 `--image`、REPL 自动识别与 stream-json 共用最终文件读取限制：单条消息合计最多 20 MiB，文件必须为 regular file，扩展名匹配 PNG/JPEG/GIF/WebP header，单图尺寸最多 40MP。先检查句柄上的文件大小，再在最多 1 MiB 内读取尺寸；后续完整读取最多分配原始大小加 1 字节，读取期间文件增长、截短或观察到修改会拒绝。错误指出附件序号；超过 8 张明确报错，不再静默截断。真实临时文件及模拟短读/增长测试覆盖这些条件，另验证无效图片不会进入模型循环且后续文本仍可处理。

图片边界连同 stream 输入回执的扩展回归：5 文件 123 项通过；CLI 修改源文件 ESLint 0 errors、3 项既有 warnings；SDK 构建与 protocol schema drift check 通过。

## 本地验证与提交记录

- 第一轮跨模块回归：45 文件、822 项通过，覆盖模型/费用/ledger/恢复、编排、外部 adapter/bridge、MCP、Chat/replay/streaming。
- 后续权限模式相关回归：5 文件、137 项通过；退出确认另 4 项通过；附件与 Chat 回归 5 文件、110 项通过，附件边界另 6 项通过。这些运行有重叠，不相加作为独立覆盖率。
- 修改的 CLI / VS Code 源文件 ESLint：0 errors；6 项既有 unused-variable warnings。
- 已重新生成命令 manifest、help index、四种 shell completion 和 CLI reference，三个 drift check 全部通过。
- 扩展回归 64 文件：1011 项通过，1 项旧模式测试未等待退出确认而失败；更新该 fixture 后，相关 3 文件 56 项全部通过。模型/计费/bridge/MCP 的最新补充回归 6 文件 111 项通过。
- JetBrains 初次 Gradle 被缺少完整 JDK 21 阻断；下载官方 Temurin JDK 21.0.12.1+1 并核对 SHA-256 后，`compileKotlin`、`compileJava`、`compileTestJava` 与 `ImageAttachmentsTest` 的 8 项测试通过（0 skipped / failures / errors）。未跑真实 GUI。
- 以下为本地提交，没有推送或发布；后续未完成工作继续沿用上表任务 ID。

| 提交         | 已提交范围                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------------ |
| `3571acda0e` | 最新模型 profile、Responses 三型号回归、统一价格与 durable ledger / budget / Eval 计费                       |
| `42010e7148` | 外部 Agent 生命周期与 Codex 事件关联、MCP 404 安全重建、编排准入状态及生成文档                               |
| `025dddcd46` | 有界 canonical context 分页、VS Code 后台正文恢复与流式渲染、CLI mode ACK/退出确认、异步图片与会话内输入隔离 |
| `8e9c6f9d4d` | JetBrains 图片 header/字节/像素限制、异步处理、错误显示与 JUnit                                              |
| `2d5084605c` | CLI canonical 输入接受回执、只读查询与 ID 去重，SDK 可选传参、共享协议 fixture 及 vendor 同步                   |

提交表示这部分实现及其本地回归已经保存，不表示同 ID 下的真实账号、跨平台、完整历史、durable 输入接受、宿主或生产观察验收已完成。
