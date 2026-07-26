# CLI 差距任务跟踪表

> 来源：`CLAUDE_CODE_CLI_CURRENT_GAPS_AND_OPTIMIZATIONS_2026-07-18.md`
> 创建日期：2026-07-19
> 当前 CLI 版本：`0.162.180`
> 状态：P0-2 当前 turn、持久化与跨宿主 authority/binding 核心已完成；P0-1 Broker/凭据/macOS 核心已落地，
> 静态进程清单与 Windows 原生标准进程边界已收口，Windows Node IPC/detached 语义和真实三平台 CI 仍在进行；P1-12 双语言 SDK 已完成，
> Python SDK 0.1.0 已发布 PyPI
> 最后更新：2026-07-26（按当前源码、跨宿主交互协议、认证凭据 transport 与生成清单复核）

---

## 执行优先级

| 优先级    | 任务数 | 说明                                          |
| --------- | ------ | --------------------------------------------- |
| 🔴 **P0** | **2**  | P0-2 余三平台全链 E2E；P0-1 余 Windows 特殊进程语义与三平台严格隔离 CI |
| 🟠 P0/P1  | 1      | 权限控制面统一                                |
| 🟡 P1     | 10     | 高优先级体验/安全能力                         |
| 🟢 P2     | 4      | 差异化方向（不抢占 P0/P1）                    |

---

## 🔴 P0 任务（优先执行）

### P0-1: 进程隔离（ProcessExecutionBroker 生产化）

**状态**: 🟡 **Broker/凭据 transport/三平台执行计划与进程清单审计已落地**；
Windows Node IPC/detached 语义及真实三平台 CI 尚未完成

**目标**:

- macOS: Seatbelt sandbox（`sandbox-exec` profile）
- Windows: 原生 Win32 Job Object + Restricted Token 强边界
- Linux: seccomp-bpf + Landlock（当前使用 bwrap namespace 隔离，landlock 后续增强）
- 所有 spawn 入口统一 Broker 审计
- 凭据代理 default-on（secrets 永远不裸传给子进程）

**验收标准**:

- [x] macOS Seatbelt wrapper 与 strict/default/network-only profile 生成、注入式测试
- [x] Linux bubblewrap 显式 Agent sandbox 与 Broker `prlimit` 执行计划
- [x] Windows Job Object + Restricted Token 原生 adapter
- [x] Broker `spawn`/`spawnSync`/PTY 接入 CredentialAgent，敏感 env/argv 默认过滤且审计不含值
- [x] Broker 签发的 credential ref 通过认证 transport 向目标进程按需解析
- [x] 生成清单中的 runtime 匹配全部迁移或记录审计豁免（2026-07-26：206 项，0 unreviewed）
- [x] `CC_SANDBOX_STRICT` 在平台边界不可用时 fail-closed
- [ ] Windows 原生 adapter 保真 Node IPC fd3 与 detached 目标 PID/handle 语义
- [ ] macOS/Linux/Windows 严格隔离真实 CI 矩阵全部通过

**实现说明（2026-07-26 复核）**:

1. **`platform-sandbox.js` 平台执行计划**：
   - macOS：生成 Seatbelt profile，通过 `/usr/bin/sandbox-exec -f` 包装目标进程
   - Windows：Broker 控制的 Windows PowerShell/Win32 adapter 以 restricted primary token
     挂起创建目标，先加入 kill-on-close Job Object 并施加 CPU/内存/进程数限制，再恢复执行
   - Windows adapter 首次使用通过系统 Windows PowerShell 编译内容寻址的托管 Win32 helper；
     后续直接执行缓存 helper，npm 与 `pkg` 构建均携带同一受控源文件
   - Windows 真实测试验证受限 privilege 集、`cmd.exe /s /c` 内嵌引号与 2 MiB 输出语义，
     以及父进程退出后 detached grandchild 被 Job Object 清理；adapter/PowerShell 缺失时仍返回
     unavailable 并由 strict 模式 fail-closed
   - 该托管 helper 目前不能跨中间 wrapper 复制 Node/libuv 的 fd3 IPC 描述符表，也不能让
     `spawn().pid` 保持 detached 目标进程身份；这两类执行计划显式返回
     `windows_node_ipc_descriptor_unsupported` / `windows_detached_process_identity_unsupported`，
     非严格模式审计降级为原生 spawn，严格模式在目标启动前 fail-closed
   - Linux：Broker 可用 `prlimit` 施加资源限制；文件/网络边界继续复用显式 bubblewrap sandbox

2. **`credential-agent.js` 凭据过滤代理（default-on）**：
   - 30+ 正则模式识别敏感 env（API_KEY/TOKEN/PASSWORD/SECRET/PRIVATE_KEY/BEARER/AUTH 等）
   - 40+ 安全 env 白名单（PATH/HOME/USER/SHELL/LANG/TZ/NODE_ENV 等直接放行）
   - 命令行参数密钥自动重写：
     - `--token=xxx` → `--token=***REDACTED***`
     - `-H "Authorization: Bearer xxx"` → `-H "Authorization: ***REDACTED***"`
     - 内嵌 `sk-xxx` / `ghp_xxx` / `xoxb-xxx` 模式自动打码
   - 敏感值替换为目标/审批绑定的短期 refId，明文不直接传入子进程
   - ref 签发、解析、撤销与审计已有核心 API；生产单例默认启用
     `local-ipc-v1`（Windows named pipe / POSIX Unix socket）
   - 每次 Broker 放行以 `executionId + decision` 生成不可伪造的审批绑定，并为该次启动签发
     256-bit capability；ref 同时绑定 agent、进程、目标 host、TTL 与最大使用次数
   - transport 服务运行于 Broker worker thread，`spawnSync()` 阻塞主线程时目标进程仍可按需解析；
     POSIX socket 权限收紧为 `0600`，错误鉴权、跨进程/跨 host、过期与超额使用均 fail-closed
   - transport/agent 审计仅记录 ref/审批指纹与计数，不记录 capability、ref 原文或凭据值

3. **Broker `index.js` 集成完成**：
   - 修复构造函数错误（移除错误的 `new PlatformSandbox()`，改为函数式 API）
   - `spawn()` / `spawnSync()` / PTY 路径统一执行凭据过滤、平台执行计划和脱敏审计
   - `getInfo()` 对外暴露沙箱状态（平台/启用/严格模式）和凭据代理状态（default-on/过滤计数）
   - STRICT 模式下平台边界不可用直接拒绝执行（fail-closed），非严格模式显式记录降级原因

4. **2026-07-24 入口收口**：
   - Agent `run_skill` 仅向声明 `shell-exec` 的 Skill 注入受限 Broker 门面
   - Desktop 语音、量化、CodeExecutor、Control Panel、Data Science、Project Automation 与
     Plugin Loader 已迁移到显式 Broker origin；Plugin Loader 的安装/解压链已去 shell
   - 生成清单由 317/236 项（total/runtime）降至 285/204；剩余 runtime 匹配继续逐项迁移或
     记录审计豁免

5. **2026-07-26 清单 fail-closed 收口**：
   - 生成器为每个 runtime 匹配输出 `brokered` / `audited-exemption` / `non-executable` /
     `unreviewed` disposition 与证据
   - 当前源码共 290 个词法匹配（runtime 206、tooling 56、test 28）；runtime 中
     157 项已路由 Broker、16 项有显式审计豁免、33 项为声明/注释/类型/安全正则噪声，
     `unreviewed` 为 0
   - `process-spawn-audit-policy.json` 记录 Broker 原生边界、Agent SDK 外部宿主与
     goal checker fail-closed 注入规则的 owner、复核日期和原因
   - `docs:spawn-inventory:check` 同时校验生成文档无漂移并在出现任意 unreviewed runtime
     匹配时失败

**涉及文件**:

- `packages/cli/src/lib/process-execution-broker/index.js` (Broker 主逻辑，已完成集成)
- `packages/cli/src/lib/process-execution-broker/platform-sandbox.js` (✅ 新增完成)
- `packages/cli/src/lib/process-execution-broker/windows-sandbox.ps1` (✅ Win32 原生 adapter)
- `packages/cli/src/lib/process-execution-broker/credential-agent.js` (✅ 新增完成)
- `packages/cli/src/lib/process-execution-broker/credential-transport.js` (✅ 认证客户端/父端控制)
- `packages/cli/src/lib/process-execution-broker/credential-transport-worker.js` (✅ 本地 transport 服务)
- `packages/cli/__tests__/unit/credential-transport.test.js` (✅ 认证拒绝、绑定与真实 `spawnSync`)
- `packages/cli/scripts/gen-process-spawn-inventory.mjs` (✅ disposition 与 fail-closed gate)
- `packages/cli/scripts/process-spawn-audit-policy.json` (✅ 显式审计豁免)
- `.github/workflows/cli-strict-sandbox.yml` (✅ 三平台 strict 边界矩阵定义；当前运行结果待验收)
- `docs/cli/PROCESS_SPAWN_INVENTORY.generated.md` (✅ 206/206 runtime 已归类)
- 详细进度记录：`packages/cli/P0_CLI_SECURITY_PROGRESS.md`

---

### P0-2: 后台人机回路（Real-time Interruption）

**状态**: ✅ **CLI 当前 turn、pending/settlement 持久化与跨宿主 authority/binding 核心完成**；三平台 E2E 待验收

**目标**:

- 后台 Agent 运行时遇到 `AskUserQuestion` 立即暂停当前 turn
- 通过 IPC 总线发送问题到 UI/终端
- 用户回答后**原地恢复**执行（非结束后另起一轮）
- Resume 带相同 turn context、tool_call_id、消息序号

**验收标准**:

- [x] Agent 遇到提问 → pause → IPC 通知 → 等待 response
- [x] 用户回答 → resume → 同一 turn 继续执行
- [x] `backgroundAgentId/sessionId/turnId/toolUseId/sequence` 绑定不匹配时拒绝解析
- [x] 超时、取消、重复 request 与重连重放有显式处理
- [x] 单元/集成测试覆盖同 turn 解析和真实子进程链
- [x] Desktop/VS Code/JetBrains/Remote Control 共用 authority/binding resolver
- [x] worker/child 崩溃后的 pending request 持久恢复与 settlement exactly-once
- [ ] 三平台真实 E2E：提问→断线→重连→回答→同 turn 完成

**实现说明（2026-07-26 复核）**：

1. **turn child ↔ worker Node IPC**：
   - `background-agent-worker.js` 以 `stdio: [..., "ipc"]` 启动 turn child
   - `background-interaction-resolver.js` 实现版本化
     `interaction-request` / `interaction-response`
   - request/response 保留同一 turn、tool call 和单调 sequence 绑定

2. **worker ↔ attach 宿主 transport**：
   - `background-session-transport.js` 使用 Unix socket / Windows named pipe
   - worker 广播 `interaction_request`，attach 发送 `interaction_response`
   - attach 重连后重放当前 pending request；response 必须携带完整 binding，重复的相同
     settlement 返回幂等确认，冲突的第二次回答被拒绝

3. **持久 pending/settlement journal**：
   - `background-interaction-journal.js` 在请求向宿主可见前，先把完整绑定与 payload 指纹作为
     tamper-evident session JSONL 快照持久化
   - worker 在向 child 交付结果前先持久化 terminal settlement；相同 settlement 重试不重复生效，
     不同答案、跨 session/turn/tool 的迟到回答 fail-closed
   - UI/attach 断线只触发重放，不结束当前请求；worker 重启或监管器确认 worker 已死时，
     遗留 pending 会确定性写成一次 rejected settlement，状态文件同步清除 `pendingQuestion`

4. **Headless 与状态接线**：
   - `headless-runner.js` 将 `ask_user_question` 接到 `backgroundInteractionClient`
   - 回答返回同一个 child，不写入下一 turn 的 `promptQueue`
   - session 状态在等待期间为 `needs_input`，settle 后回到当前 turn

5. **跨宿主 authority/binding 收口**：
   - `interaction-binding.js` 是 CLI runtime 的规范化与逐字段比较事实源；宿主只回传 request
     携带的 opaque binding，最终解析权仍在 runtime，不接受 UI 自报的 session/turn/tool 身份
   - Desktop trusted main、VS Code、JetBrains、Web Panel 与 Remote Control 均保留并回传完整
     binding；Remote Control 的回答操作要求认证的人类 actor 和 `prompt` scope，observe-only、
     未认证与非人类 actor 均 fail-closed
   - TypeScript/Python SDK 的自动 question/MCP elicitation callback 会原样回传 binding；
     WebSocket `session-answer`、后台 `bg-answer` 与 Remote Control `question.answer` 共用这一约束
   - Agent SDK 的 `interaction.ndjson` 提供共享 Golden 向量；CLI、SDK、VS Code 和 JetBrains
     对缺字段、跨 turn/tool/session 与 stale binding 做一致拒绝验证

6. **验证证据**：
   - `headless-side-effect-ledger-resume.test.js` 验证同 turn question resolve
   - `background-interaction-journal.test.js` 覆盖持久化失败、绑定冲突、重复 settlement 和
     崩溃恢复 exactly-once
   - `background-stability-realspawn.test.js` 在真实 worker/child 链上覆盖
     提问→attach 断线→重连重放→回答→同 turn 完成（本地 Windows 已通过）
   - 仓库现有 `cli-ci.yml` 会在 Ubuntu/macOS/Windows 运行全部 integration 分片，该真实用例
     无平台跳过条件；当前改动尚无远端运行结果，因此三平台验收保持未勾选
   - 本次定向回归：CLI 23 个文件 319 passed/2 skipped；Agent SDK 47 passed + TypeScript
     typecheck；Python SDK 13 passed；Web Panel 48 passed + production build；JetBrains 定向
     tests/build 通过；Desktop 新增 authority 流程用例通过

**涉及文件**:

- `packages/cli/src/lib/background-interaction-resolver.js`
- `packages/cli/src/lib/interaction-binding.js`
- `packages/cli/src/lib/background-interaction-journal.js`
- `packages/cli/src/workers/background-agent-worker.js`
- `packages/cli/src/runtime/headless-runner.js`
- `packages/cli/src/commands/background-session.js`
- `packages/cli/src/lib/background-session-transport.js`
- `packages/cli/__tests__/integration/headless-side-effect-ledger-resume.test.js`
- `packages/cli/__tests__/unit/background-interaction-journal.test.js`
- `packages/cli/__tests__/unit/interaction-binding.test.js`
- `packages/cli/__tests__/unit/background-agent-supervisor.test.js`
- `packages/cli/__tests__/integration/background-stability-realspawn.test.js`
- `packages/agent-sdk/__fixtures__/protocol/interaction.ndjson`
- `packages/agent-sdk/src/protocol.ts`
- `packages/agent-sdk-python/src/chainlesschain_agent_sdk/protocol.py`
- `packages/cli/src/gateways/ws/remote-session-protocol.js`
- `packages/cli/src/gateways/ws/background-agent-protocol.js`

---

## 🟠 P0/P1 任务

### P0/P1-3: 权限控制面统一

**状态**: 运行时规则、CLI 管理面和 Desktop 请求/刷新同步已完成；统一 parity 已验证

**目标**:

- `cc permissions` CLI 直接 gate Agent 工具运行时
- 统一规则来源：CLI 配置 + Desktop 策略
- 规则变更实时生效（无需重启）
- 决策审计日志

**验收标准**:

- [x] `cc permissions allow/ask/deny/list` 命令完整
- [x] Agent tool 调用前查 settings permission rules（Agent Core、Headless、REPL）
- [x] Deny 规则立即阻断，Allow 规则持久化
- [x] Desktop coding-agent store 与 CLI settings rules 同步（读取、写入后刷新确认）

**2026-07-22 进度**：新增 `cc permissions allow <rule>`、`ask <rule>`、`deny <rule>`
快捷命令，继续保留 `add <decision> <rule>` 兼容入口；新增单元测试覆盖三种快捷命令。
权限命令专项测试已通过：`permissions-command.test.js` 共 13 个用例全部通过。
同日补齐 CLI WebSocket → Electron IPC → Pinia store 的规则读取/写入链，Desktop store 回归测试
30 个用例全部通过；补充协议/Bridge 回归后，CLI 路由相关测试 81 个、Desktop Bridge/store 测试
64 个均通过。

---

## 🟡 P1 任务（P0 完成后执行）

| #     | 任务                 | 状态                                        | 说明                                                                                                                                                                                                                                                                                                                       |
| ----- | -------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1-4  | Hooks v2 完整实现    | 🟡 producer 与 managed policy 已完成          | 40事件注册/执行、5种公共 executor + trusted JS、并行去重、11 项高价值 producer、M5 E2E、最小环境交集、command/workspace/MCP/agent/skill allowlist、MCP 共享授权与独立 delegated budget 已有；跨平台强文件写沙箱仍依赖 P0 原生隔离收口                                                          |
| P1-5  | MCP Elicitation 路由 | ✅ form/URL/defer 已完成                    | 基于 MCP `2025-11-25`：声明 form/URL capability；`elicitation/create`、`notifications/elicitation/complete` 与 `URLElicitationRequiredError (-32042)` 已接入；URL 仅允许无凭证 HTTPS，所有交互宿主展示完整 URL 并在明确同意后打开；Headless 结构化 defer、完成关联及原工具调用 exactly-once retry 已覆盖，URL 敏感输入不回传 `content` |
| P1-6  | Event Runtime 常驻化 | ✅ 宿主托管、观测与恢复闭环                 | 发布二进制的 lazy-dispatch 真实入口统一启动/停止 process-level host：长驻命令持续 drain，短命命令退出前有界 final drain；durable inbox/outbox、lease fence/续租/过期接管、重试/死信/背压、producer 自动接线均已有；Webhook/Telegram 使用 required-handler 恢复路由；`cc status --json` 暴露队列及跨进程 host 心跳/stale 状态，`npm run runtime:event-recovery` 用两个真实进程验证崩溃接管与副作用只应用一次 |
| P1-7  | Context 来源归因     | ✅ 双层 Skill 缓存与交互式快照已完成        | `cc context --sources` 已对 instruction 文件、实际注入 persona Skill、admitted MCP schema、普通 Skill descriptor/body 按需读取、缓存命中及实际 prompt 注入分别计费；Headless 与交互 REPL 共用单一 Skill loader，并持续写入无正文 `context_sources` 快照                                                                 |
| P1-8  | Checkpoint REPL 统一 | ✅ 统一 producer 与归因闭环                 | Agent Core 输出 provider 原始 `tool_use_id`/turn id/permission decision/checkpoint；Headless 与 REPL 共用 `createTurnBindingFeed`，交互 turn 逐次 fail-closed 持久化；child trace/checkpoint/tool/worktree、IDE user edit 与顶层 `--worktree` branch 均进入父 turn，shell/外部副作用诚实标为 partial                         |
| P1-9  | Plugin 安全强化      | 🟡 OS secret + Broker provenance 已补       | 签名/manifest SHA-256、trusted key、安装后 SBOM 文件摘要、capability consent、managed allow/deny、DPAPI/Keychain/Secret Service、插件 MCP/LSP/Hook/Monitor/Bin 与 Agent `run_skill` Broker 门面已有；Desktop Plugin Loader 的依赖探测/安装/解压已去 shell 并携带 plugin source；原生模块和外部宿主全路径仍待补             |
| P1-10 | 并发状态 fail-closed | 🟡 关键调度/会话状态已补                    | `withFileLock(failIfUnavailable)` + Agenda claim lease、Event Runtime 与 JSONL session append 已 fail-closed；approval/部分 ledger/IDE session 状态仍待统一迁移                                                                                                                                                            |
| P1-11 | JSON Schema 完整支持 | 🟡 常用 vocabulary + external registry 已补 | Draft 2020-12 常用关键字、dependent/pattern/contains/propertyNames、local `$ref`、显式 external schema registry、组合/条件、format、structured_result 已有；完整 meta-vocabulary、自动远程 ref 与复杂互操作仍待补                                                                                                          |
| P1-12 | SDK/CI 事件透传      | ✅ 源码完成；Python 0.1.0 基线已发布        | 当前 TypeScript + Python 源码覆盖契约中的 24 类 typed stream 事件（含 defer/complete）、approval/question/MCP elicitation callback、resume 与未知事件无损透传；共享 protocol fixture、穷举 CI consumer、GitHub Actions 模板及 22 项 hermetic 测试已补；已发布的 Python 0.1.0 是此前 22 类事件基线并通过 3.10/3.12/3.13 公网 wheel 烟测，本轮两个新增事件尚未发布新版本 |
| P1-13 | 验收门与文档清理     | ✅ 已完成                                   | 统一 parity 10/10；旧文档持续维护                                                                                                                                                                                                                                                                                          |

**2026-07-24 P1-5 进度**：三端表单已覆盖 MCP form elicitation 规定的受限 schema：
`title`/`description`/`default`、字符串长度与 `email`/`uri`/`date`/`date-time`、
数值上下界、`enum`/`enumNames`/带标题 `oneOf`，以及
`items.enum`/`items.anyOf` 多选与 `minItems`/`maxItems`。Desktop 和 VS Code
运行同一共享 normalize/coerce/validate 核心；JetBrains 原生适配器消费同一
conformance fixture。该完成口径不包含嵌套 object、任意 array、`$ref`、自动远程
schema 解析或完整 JSON Schema Draft 2020-12。

**2026-07-26 P1-5 完成**：MCP client 升级到
[MCP Elicitation 稳定协议版本 `2025-11-25`](https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation)，同时声明
`elicitation.form` 与 `elicitation.url`。URL 请求必须携带 `elicitationId`、非空说明和
无用户名/密码的 HTTPS URL；CLI、Desktop、VS Code、JetBrains 与 SDK 都透传
mode/id/完整 URL/host，并只在用户明确同意后调用系统浏览器。URL 应答只含 action，
不把浏览器中的敏感输入带回 MCP。客户端关联
`notifications/elicitation/complete`，忽略未知、跨 server 和重复完成通知；工具返回
`-32042` 时最多处理 16 个有界 URL 请求，全部完成后只重试原调用一次；普通 elicitation
并发默认上限 32，超限 fail-closed decline。无交互宿主会发
typed `elicitation_deferred`，同时在 MCP wire 上 fail-closed `decline`，不会挂死。
TypeScript/Python SDK 还新增 typed `elicitation_deferred` /
`elicitation_complete` 事件。Streamable HTTP 同步补齐协商后的
`MCP-Protocol-Version` header、POST SSE 内嵌 server message 分派，以及带 session id、
`Last-Event-ID`/`retry` 恢复语义的 GET SSE 接收器；HTTP 上的
`elicitation/create` 与异步 complete 不再静默丢失。

本轮定向验收：CLI P1-5/VS Code 4 文件 39/39、MCP client 全组 12 文件
112/112、TypeScript SDK 全组 49/49 + strict typecheck、Python SDK 22 tests +
5 subtests、Desktop URL/form UI 5/5、JetBrains `ChatEvents` /
`ProtocolFixtures` 强制重编译测试通过；共享 NDJSON fixture 也已覆盖 form/URL、
deferred/complete 与完整 interaction binding。上述是本地 Windows 结果，不替代远端三平台 CI。

**2026-07-26 P1-6 完成**：此前 lifecycle 只放在 `src/index.js` 的 direct-run
分支，而实际发布 binary 走 `bin/chainlesschain.js → lazy-dispatch.js`，因此 durable
producer 虽已接线，真实入口并不稳定托管 worker。本轮把统一 lifecycle 包到 lazy
入口：先启动但延后首次 claim，待所选命令注册 handler；长驻命令按单一、非重叠 timer
持续 drain，短命命令在 `finally` 中执行最多 10 tick 的有界 final drain，并在退出时
等待 in-flight work。`EventRuntimeStore` 新增同锁域、100 条上限的 `hosts.json`
registry；每个 host 发布 pid/role/heartbeat/lastStats/lastError，`cc status --json`
的 `chainlesschain.event-runtime-health.v1` 可跨进程区分 running/stale/stopped host。
Webhook/Telegram durable 事件标记为 `requiresHandler`，由 Channel Manager 按
queue/type/origin 注册恢复 handler，停止时注销，避免 worker 无 handler 时把待恢复
事件误当成功。

新增 `npm run runtime:event-recovery` 恢复演练：进程 A claim 后硬退出，不 ack；
lease 过期后进程 B 以更高 fence 接管，通过真实 `EventRuntimeHost` 执行带幂等 marker
的副作用并结算。Windows 本地结果为 attempts 2、fence `1 → 2`、副作用应用 1 次，
同时观测到 1 个 stale claimant 与 1 个 stopped successor。Event Runtime/diagnostics
定向测试 53/53、Channels 16/16 通过。

**2026-07-26 P1-7 完成**：Skill discovery 只读取 YAML descriptor，正文按 persona
注入或 `run_skill` 首次使用才 materialize，并按 mtime/size 失效。cache ledger 现在分别
记录 descriptor prompt return、body 磁盘读取、cache hit、正文大小等价量以及真正进入
prompt 的 `contextLoads/contextTokens`；普通 `run_skill` 的 handler 正文不会被误计为
模型上下文。Headless 与交互 REPL 使用同一个 session-scoped loader，REPL 在 MCP 启动、
每轮完成、`/reload-skills` 和退出时持续写入 content-free `context_sources` 快照。
`cc context --sources` 的文本与 JSON 输出都能展示 resident/lazy、逐 Skill 来源、磁盘/
缓存读取和 prompt 注入成本；定向 Context/REPL 测试 82/82 通过。

**2026-07-26 P1-8 完成**：`createTurnBindingFeed` 已成为 Headless 与交互 REPL
共享的事件归因核心；REPL 会 rehydrate 旧表、在 rewind/clear/compact 后剪除被替代
timeline，并在每个 settled turn（包括无工具问答）以 fail-closed 锁定快照。Agent Core
的 checkpoint/tool-executing/tool-result 全程携带 provider 原始 `tool_use_id` 和
`turn_id`，决策事件携带稳定 permission decision id；父 turn 同时保存 child agent 的
trace、checkpoint、tool id 和 worktree lineage，IDE 修改标记会把 coverage 降为
partial。本轮补齐交互 `cc agent --worktree` 的 branch id 通过 runtime policy 进入
每条 REPL binding；shell/外部进程副作用仍明确为 partial，不承诺不可逆恢复。定向
7 个测试文件 111/111 通过。

### Hooks v2 producer 验收结果（40 项事件 registry）

Hooks v2 当前注册 40 个生命周期事件、5 种公共 executor 和 trusted JS executor。运行时支持 programmatic
`registerHook`/`executeHooks`，默认并行执行、按 hook id 去重，并保留
`parallel: false` 的顺序兼容模式；JS handler、Broker `spawnSync`、IPC agent
注册状态和 Context Source Ledger 兼容适配均已纳入 M5 E2E。

2026-07-22 实测：`npm run runtime:test` 的 convergence 11/11、M5 E2E 22/22
全部通过；新增 Vitest 回归 3/3。该结果证明运行时兼容层和端到端链路可用，
不代表 40 个事件均已有真实 producer，也不代表跨平台强文件写沙箱已完成。

2026-07-26 producer 复核：此前 `PostToolUseFailure`/`FileChanged` 只有未调用 helper，
现已接入真实顺序与并行 tool loop；每批只发一次 `PostToolBatch`。`FileChanged`
支持 `glob`/`globs`/`paths`/`if` 的跨平台路径过滤。手动与自动压缩会发
`PostCompact`；Desktop/WS 与 headless MCP 通道会成对发
`Elicitation`/`ElicitationResult`（并保留 `MCPElicitation` 兼容事件）。
Setup 已接到 stream 与一次性 headless 启动门并 fail-closed；UserPromptExpansion
会在模型调用前合并唯一 prompt 更新与附加上下文，冲突时拒绝本轮。停止 hook 的执行错误、
畸形决策和断路器打开会发 `StopFailure`；团队调度器在成员从运行态真实回到空闲态时发
`TeammateIdle`，初始化空闲与重复空闲不会误报。

同日 managed policy 复核：Hooks v2 的 command、HTTP、MCP、prompt、agent 与 trusted JS
统一进入 executor policy gate；shell mode 默认拒绝，支持 command/workspace/MCP tool/
agent/skill managed allowlist，MCP tool 默认要求共享权限 authorizer，prompt/agent/MCP
delegated executor 受独立硬超时。Hooks v2、旧 settings Hook、CLI Hook Manager 与 Desktop
Hook 现在只继承 PATH/临时目录/系统定位等最小环境；额外变量必须同时出现在管理员 allowlist
和 Hook 自身请求中。平台级“不可写出工作区”仍取决于 P0 在三平台提供真实文件系统强隔离，
因此 P1-4 仍保持进行中。

- [x] Setup（启动前依赖检查）
- [x] UserPromptExpansion（输入预处理）
- [x] PostToolUseFailure（工具失败）
- [x] PostToolBatch（工具批量完成）
- [x] PermissionDenied（权限拒绝）
- [x] StopFailure（停止失败）
- [x] FileChanged（文件修改，支持 glob）
- [x] PostCompact（上下文压缩后）
- [x] TaskCreated / TaskCompleted（子任务生命周期）
- [x] Elicitation / ElicitationResult（问答交互）
- [x] TeammateIdle（多 agent 协作空闲）

### Parity 验收门子项（9项）

- [x] CLI contract/policy/unit 测试
- [x] CLI real envelope E2E 测试
- [x] Desktop hosted-tools integration
- [x] Desktop lifecycle integration
- [x] Desktop ↔ real CLI bridge
- [x] Renderer store 集成
- [x] SDK protocol fixtures
- [x] `docs:cli-reference:check`
- [x] `docs:protocol:check`

**统一运行入口**：仓库根目录执行 `npm run test:coding-agent:parity`。
2026-07-22 实测 10/10 steps passed（约 166 秒）；CLI runtime units 658 个、CLI envelope E2E 10 个、
Desktop coding-agent core 134 个、Desktop lifecycle 24 个、SDK protocol/agent-session 27 个等均通过。

---

## 🟢 P2 任务（差异化方向，按需执行）

| #     | 任务                     | 说明                                                  |
| ----- | ------------------------ | ----------------------------------------------------- |
| P2-14 | 全工具文件回滚           | Process Broker 捕获所有文件写入，支持 checkpoint 回滚 |
| P2-15 | Auto mode 安全分类器     | 危险操作自动识别评测集                                |
| P2-16 | 大规模 Agent Teams       | 多 agent 协作扩展                                     |
| P2-17 | 标准 OTel Collector 出口 | 兼容生态可观测性工具                                  |

---

## ✅ 已完成（M0-M6 + P0-2 核心及 P0-1 已落地子项）

- [x] **P0-1 Broker async/sync/PTY 凭据边界 + macOS Seatbelt/Linux 执行计划**
- [x] **P0-2 CLI 当前 turn 提问/回答/继续核心链**
- [x] **P0-2 pending/settlement 持久 journal、断线重放与 worker 丢失 exactly-once 拒绝**
- [x] **P0-2 Desktop/VS Code/JetBrains/Web Panel/Remote Control/SDK authority/binding 收口**
- [x] **P1-5 MCP Elicitation form/URL/defer、完成通知与 `-32042` exactly-once retry**
- [x] **P1-6 Event Runtime 真实 binary lifecycle、跨进程 host health 与崩溃恢复演练**
- [x] **P1-7 Context 双层 Skill cache、交互式快照与按需/命中/注入成本归因**
- [x] **P1-8 Headless/REPL 统一 turn binding、provider id 与 child/worktree/user-edit 归因**
- [x] **P1-12 TypeScript/Python SDK、共享 fixture、GitHub Actions 示例与 Python 0.1.0 基线 PyPI 发布**
- [x] **2026-07-21 历史主仓验证**：当时的 Code Quality、CI Tests、E2E Tests 与 Full Test Automation 通过；不替代当前剩余严格隔离验收
- [x] Notification Hook 事件（2026-07-20）
- [x] M0: `process-execution-broker` 单例 + spawn 审计清单
- [x] M0: parity 验证脚本 + `npm run runtime:convergence`
- [x] M1: Broker 支持所有 origin 类型
- [x] M1: 现有入口接入审计（hook-manager）
- [x] M2: `agent-ipc-bus` 后台 Agent 实时 IPC 总线
- [x] M3-1: Hooks v2 框架（40 个生命周期事件 + 5 种公共 executor + trusted JS）
- [x] M3-2: Event Runtime 常驻框架（emit/subscribe）
- [x] M4-1: Context Source Ledger 来源记账
- [x] M4-2: Turn binding schema 全透传
- [x] M5: `--jsii-runtime` + `--otlp-endpoint` 全局参数
- [x] M5: 端到端 parity 验证脚本
- [x] M6: 收敛设计文档 `CLI_ARCHITECTURE_CONVERGENCE_2026-07-19.md`
- [x] M6: 四层模块边界严格定义

---

## 近期里程碑

| 顺序       | 目标                                                        |
| ---------- | ----------------------------------------------------------- |
| **当前**   | P0-1 Windows IPC/detached 语义与真实三平台严格隔离 CI       |
| **随后**   | P0-2 三平台断线重连 E2E 远端验收                            |
| **并行**   | P1-4 跨平台强文件写沙箱、P1-9 Plugin 外部宿主与 P1-10 状态锁收口 |
| **发布前** | 双语言 SDK 兼容门、真实环境 parity 与文档事实源漂移检查     |

---

## 参考文档

- 差距分析：`docs/CLAUDE_CODE_CLI_CURRENT_GAPS_AND_OPTIMIZATIONS_2026-07-18.md`
- 架构收敛：`docs/architecture/CLI_ARCHITECTURE_CONVERGENCE_2026-07-19.md`
- Parity 验证：`packages/cli/scripts/verify-agent-runtime-parity.js`
- P0-1 沙箱详细进度：`packages/cli/P0_CLI_SECURITY_PROGRESS.md`
