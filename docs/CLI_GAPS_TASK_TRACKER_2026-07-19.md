# CLI 差距任务跟踪表

> 来源：`CLAUDE_CODE_CLI_CURRENT_GAPS_AND_OPTIMIZATIONS_2026-07-18.md`
> 创建日期：2026-07-19
> 当前 CLI 版本：`0.162.177`
> 状态：P0-2 当前 turn 交互核心已完成；P0-1 Broker/凭据/macOS 核心已落地，
> Windows 原生强边界与静态进程清单收口仍在进行；P1-12 双语言 SDK 已完成
> 最后更新：2026-07-24（按当前源码与生成清单复核）

---

## 执行优先级

| 优先级    | 任务数 | 说明                                                                           |
| --------- | ------ | ------------------------------------------------------------------------------ |
| 🔴 **P0** | **2**  | P0-2 核心完成；P0-1 的 Windows 强边界、凭据解析 transport 与剩余进程入口待收口 |
| 🟠 P0/P1  | 1      | 权限控制面统一                                                                 |
| 🟡 P1     | 10     | 高优先级体验/安全能力                                                          |
| 🟢 P2     | 4      | 差异化方向（不抢占 P0/P1）                                                     |

---

## 🔴 P0 任务（优先执行）

### P0-1: 进程隔离（ProcessExecutionBroker 生产化）

**状态**: 🟡 **Broker/凭据/macOS 核心已落地**；Windows 原生强边界、凭据解析 transport 与
静态进程入口审计尚未完成

**目标**:

- macOS: Seatbelt sandbox（`sandbox-exec` profile）
- Windows: 原生 Win32 Job Object + Restricted Token 强边界
- Linux: seccomp-bpf + Landlock（当前使用 bwrap namespace 隔离，landlock 后续增强）
- 所有 spawn 入口统一 Broker 审计
- 凭据代理 default-on（secrets 永远不裸传给子进程）

**验收标准**:

- [x] macOS Seatbelt wrapper 与 strict/default/network-only profile 生成、注入式测试
- [x] Linux bubblewrap 显式 Agent sandbox 与 Broker `prlimit` 执行计划
- [ ] Windows Job Object + Restricted Token 原生 adapter（当前明确返回
  `windows_native_job_object_unavailable`）
- [x] Broker `spawn`/`spawnSync`/PTY 接入 CredentialAgent，敏感 env/argv 默认过滤且审计不含值
- [ ] Broker 签发的 credential ref 通过认证 transport 向目标进程按需解析
- [ ] 生成清单中的 runtime 匹配全部迁移或记录审计豁免（2026-07-24：204 项）
- [x] `CC_SANDBOX_STRICT` 在平台边界不可用时 fail-closed
- [ ] macOS/Linux/Windows 严格隔离真实 CI 矩阵全部通过

**实现说明（2026-07-24 复核）**:

1. **`platform-sandbox.js` 平台执行计划**：
   - macOS：生成 Seatbelt profile，通过 `/usr/bin/sandbox-exec -f` 包装目标进程
   - Windows：当前如实报告原生 Job Object/Restricted Token 不可用；严格模式拒绝降级执行
   - Linux：Broker 可用 `prlimit` 施加资源限制；文件/网络边界继续复用显式 bubblewrap sandbox

2. **`credential-agent.js` 凭据过滤代理（default-on）**：
   - 30+ 正则模式识别敏感 env（API_KEY/TOKEN/PASSWORD/SECRET/PRIVATE_KEY/BEARER/AUTH 等）
   - 40+ 安全 env 白名单（PATH/HOME/USER/SHELL/LANG/TZ/NODE_ENV 等直接放行）
   - 命令行参数密钥自动重写：
     - `--token=xxx` → `--token=***REDACTED***`
     - `-H "Authorization: Bearer xxx"` → `-H "Authorization: ***REDACTED***"`
     - 内嵌 `sk-xxx` / `ghp_xxx` / `xoxb-xxx` 模式自动打码
   - 敏感值替换为目标/审批绑定的短期 refId，明文不直接传入子进程
   - ref 签发、解析、撤销与审计已有核心 API；认证 IPC/本地 transport 尚待接入

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

**涉及文件**:

- `packages/cli/src/lib/process-execution-broker/index.js` (Broker 主逻辑，已完成集成)
- `packages/cli/src/lib/process-execution-broker/platform-sandbox.js` (✅ 新增完成)
- `packages/cli/src/lib/process-execution-broker/credential-agent.js` (✅ 新增完成)
- 详细进度记录：`packages/cli/P0_CLI_SECURITY_PROGRESS.md`

---

### P0-2: 后台人机回路（Real-time Interruption）

**状态**: ✅ **CLI 当前 turn 核心完成**；跨宿主接管、pending 持久恢复和三平台 E2E 待补

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
- [ ] Desktop/VS Code/JetBrains/Remote Control 共用 authority/binding resolver
- [ ] worker/child 崩溃后的 pending request 持久恢复与 settlement exactly-once
- [ ] 三平台真实 E2E：提问→断线→重连→回答→同 turn 完成

**实现说明（2026-07-24 复核）**：

1. **turn child ↔ worker Node IPC**：
   - `background-agent-worker.js` 以 `stdio: [..., "ipc"]` 启动 turn child
   - `background-interaction-resolver.js` 实现版本化
     `interaction-request` / `interaction-response`
   - request/response 保留同一 turn、tool call 和单调 sequence 绑定

2. **worker ↔ attach 宿主 transport**：
   - `background-session-transport.js` 使用 Unix socket / Windows named pipe
   - worker 广播 `interaction_request`，attach 发送 `interaction_response`
   - attach 重连后可重放当前 worker 内存中的 pending request

3. **Headless 与状态接线**：
   - `headless-runner.js` 将 `ask_user_question` 接到 `backgroundInteractionClient`
   - 回答返回同一个 child，不写入下一 turn 的 `promptQueue`
   - session 状态在等待期间为 `needs_input`，settle 后回到当前 turn

4. **验证证据**：
   - `headless-side-effect-ledger-resume.test.js` 验证同 turn question resolve
   - `background-stability-realspawn.test.js` 覆盖真实 child/worker 交互链

**涉及文件**:

- `packages/cli/src/lib/background-interaction-resolver.js`
- `packages/cli/src/workers/background-agent-worker.js`
- `packages/cli/src/runtime/headless-runner.js`
- `packages/cli/src/commands/background-session.js`
- `packages/cli/src/lib/background-session-transport.js`
- `packages/cli/__tests__/integration/headless-side-effect-ledger-resume.test.js`
- `packages/cli/__tests__/integration/background-stability-realspawn.test.js`

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

| #     | 任务                 | 状态                                        | 说明                                                                                                                                                                                                                                                                                             |
| ----- | -------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P1-4  | Hooks v2 完整实现    | 🟡 producer 部分接线                        | 31事件注册/执行、5种 executor、并行去重、JS handler、Subagent Task、MCP elicitation 与 settings lifecycle producer、M5 E2E；其余 producer/沙箱仍待补                                                                                                                                             |
| P1-5  | MCP Elicitation 路由 | 🟡 form-mode 完成                           | `elicitation/create` handler/事件驱动应答/超时取消、REPL/stream headless、WS question channel、Agent SDK callback 已接入；Desktop/VS Code 复用共享 schema core，JetBrains 以同一 fixture 对拍，已覆盖 MCP 受限 flat form vocabulary 与提交前校验；URL-mode/defer 仍待补                          |
| P1-6  | Event Runtime 常驻化 | 🟡 producer 已接线、宿主托管待补            | `cc agenda run --watch <seconds>`、claim lease/过期回收、`EventRuntimeStore` durable inbox/outbox、失败重试/死信、可停止 `EventRuntimeWorker`、有界背压、`EventRuntimeProducer`、Agent IPC/MCP/Webhook/Telegram/Monitor 自动接线已完成；所有宿主统一 worker 生命周期、跨进程观测与恢复演练仍待补 |
| P1-7  | Context 来源归因     | 🟡 MCP schema、实际注入 persona Skill 已补  | `cc context --sources` 已对 instruction 文件、实际注入 persona Skill 和 admitted MCP schema 逐来源计费；普通 Skill 按需加载/缓存命中成本仍待接入                                                                                                                                                 |
| P1-8  | Checkpoint REPL 统一 | 部分                                        | turn-binding 生产者、tool_use_id 完整浮出                                                                                                                                                                                                                                                        |
| P1-9  | Plugin 安全强化      | 🟡 OS secret + Broker provenance 已补       | 签名/manifest SHA-256、trusted key、安装后 SBOM 文件摘要、capability consent、managed allow/deny、DPAPI/Keychain/Secret Service、插件 MCP/LSP/Hook/Monitor/Bin 与 Agent `run_skill` Broker 门面已有；Desktop Plugin Loader 的依赖探测/安装/解压已去 shell 并携带 plugin source；原生模块和外部宿主全路径仍待补 |
| P1-10 | 并发状态 fail-closed | 🟡 关键调度/会话状态已补                    | `withFileLock(failIfUnavailable)` + Agenda claim lease、Event Runtime 与 JSONL session append 已 fail-closed；approval/部分 ledger/IDE session 状态仍待统一迁移                                                                                                                                  |
| P1-11 | JSON Schema 完整支持 | 🟡 常用 vocabulary + external registry 已补 | Draft 2020-12 常用关键字、dependent/pattern/contains/propertyNames、local `$ref`、显式 external schema registry、组合/条件、format、structured_result 已有；完整 meta-vocabulary、自动远程 ref 与复杂互操作仍待补                                                                                |
| P1-12 | SDK/CI 事件透传      | ✅ 已完成                                   | TypeScript + Python SDK 已覆盖契约中的 22 类 typed stream 事件、approval/question/MCP elicitation callback、resume 与未知事件无损透传；共享 protocol fixture、穷举 CI consumer、GitHub Actions 模板及 21 项 hermetic 测试已补                                                                    |
| P1-13 | 验收门与文档清理     | ✅ 已完成                                   | 统一 parity 10/10；旧文档持续维护                                                                                                                                                                                                                                                                |

**2026-07-24 P1-5 进度**：三端表单已覆盖 MCP form elicitation 规定的受限 schema：
`title`/`description`/`default`、字符串长度与 `email`/`uri`/`date`/`date-time`、
数值上下界、`enum`/`enumNames`/带标题 `oneOf`，以及
`items.enum`/`items.anyOf` 多选与 `minItems`/`maxItems`。Desktop 和 VS Code
运行同一共享 normalize/coerce/validate 核心；JetBrains 原生适配器消费同一
conformance fixture。该完成口径不包含嵌套 object、任意 array、`$ref`、自动远程
schema 解析或完整 JSON Schema Draft 2020-12。

### Hooks v2 验收结果（18项事件）

Hooks v2 当前已覆盖 18 个生命周期事件和 5 种 executor。运行时支持 programmatic
`registerHook`/`executeHooks`，默认并行执行、按 hook id 去重，并保留
`parallel: false` 的顺序兼容模式；JS handler、Broker `spawnSync`、IPC agent
注册状态和 Context Source Ledger 兼容适配均已纳入 M5 E2E。

2026-07-22 实测：`npm run runtime:test` 的 convergence 11/11、M5 E2E 22/22
全部通过；新增 Vitest 回归 3/3。该结果证明运行时兼容层和端到端链路可用，
不代表 18 个事件均已有真实 producer，也不代表统一 sandbox/managed allowlist 已完成。

<!-- 历史记录：此处原列出的 11 项待补事件已由上述实现覆盖。 -->

- [ ] Setup（启动前依赖检查）
- [ ] UserPromptExpansion（输入预处理）
- [ ] PostToolUseFailure（工具失败）
- [ ] PostToolBatch（工具批量完成）
- [ ] PermissionDenied（权限拒绝）
- [ ] StopFailure（停止失败）
- [ ] FileChanged（文件修改，支持 glob）
- [ ] PostCompact（上下文压缩后）
- [ ] TaskCreated / TaskCompleted（子任务生命周期）
- [ ] Elicitation / ElicitationResult（问答交互）
- [ ] TeammateIdle（多 agent 协作空闲）

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
- [x] **P1-12 TypeScript/Python SDK、共享 fixture 与 GitHub Actions 示例**
- [x] **2026-07-21 历史主仓验证**：当时的 Code Quality、CI Tests、E2E Tests 与 Full Test Automation 通过；不替代当前剩余严格隔离验收
- [x] Notification Hook 事件（2026-07-20）
- [x] M0: `process-execution-broker` 单例 + spawn 审计清单
- [x] M0: parity 验证脚本 + `npm run runtime:convergence`
- [x] M1: Broker 支持所有 origin 类型
- [x] M1: 现有入口接入审计（hook-manager）
- [x] M2: `agent-ipc-bus` 后台 Agent 实时 IPC 总线
- [x] M3-1: Hooks v2 框架（18 个生命周期事件 + 5 种 executor 类型）
- [x] M3-2: Event Runtime 常驻框架（emit/subscribe）
- [x] M4-1: Context Source Ledger 来源记账
- [x] M4-2: Turn binding schema 全透传
- [x] M5: `--jsii-runtime` + `--otlp-endpoint` 全局参数
- [x] M5: 端到端 parity 验证脚本
- [x] M6: 收敛设计文档 `CLI_ARCHITECTURE_CONVERGENCE_2026-07-19.md`
- [x] M6: 四层模块边界严格定义

---

## 近期里程碑

| 顺序       | 目标                                                                 |
| ---------- | -------------------------------------------------------------------- |
| **当前**   | P0-1 Windows 原生强边界、credential transport、204 项 runtime 清单审计 |
| **随后**   | P0-2 跨宿主 resolver、pending 持久恢复与三平台断线重连 E2E           |
| **并行**   | P1-4 剩余 producer/沙箱、P1-5 URL-mode/defer、P1-6 宿主托管          |
| **发布前** | 双语言 SDK 兼容门、真实环境 parity 与文档事实源漂移检查              |

---

## 参考文档

- 差距分析：`docs/CLAUDE_CODE_CLI_CURRENT_GAPS_AND_OPTIMIZATIONS_2026-07-18.md`
- 架构收敛：`docs/architecture/CLI_ARCHITECTURE_CONVERGENCE_2026-07-19.md`
- Parity 验证：`packages/cli/scripts/verify-agent-runtime-parity.js`
- P0-1 沙箱详细进度：`packages/cli/P0_CLI_SECURITY_PROGRESS.md`
