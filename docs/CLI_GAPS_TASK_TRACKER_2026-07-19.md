# CLI 差距任务跟踪表

> 来源：`CLAUDE_CODE_CLI_CURRENT_GAPS_AND_OPTIMIZATIONS_2026-07-18.md`
> 创建日期：2026-07-19
> 当前 CLI 版本：`0.162.175`
> 状态：P0 核心实现完成，主仓 CI 已通过，CLI CI 发布前验证中
> 最后更新：2026-07-21 (P0-1/P0-2 核心代码及主仓 CI 验证完成)

---

## 执行优先级

| 优先级    | 任务数 | 说明                                                                           |
| --------- | ------ | ------------------------------------------------------------------------------ |
| 🔴 **P0** | **2**  | **P0-1 沙箱 + P0-2 人机回路核心代码完成**，主仓 CI 已通过，CLI CI 发布前验证中 |
| 🟠 P0/P1  | 1      | 权限控制面统一                                                                 |
| 🟡 P1     | 10     | 高优先级体验/安全能力                                                          |
| 🟢 P2     | 4      | 差异化方向（不抢占 P0/P1）                                                     |

---

## 🔴 P0 任务（优先执行）

### P0-1: 进程隔离（ProcessExecutionBroker 生产化）

**状态**: ✅ **核心代码完成 (2026-07-21)**；主仓 Code Quality、CI、E2E（Ubuntu/macOS/Windows）及全量自动化均已通过

**目标**:

- macOS: Seatbelt sandbox（`sandbox-exec` profile）
- Windows: 原生 Win32 Job Object + Restricted Token 强边界
- Linux: seccomp-bpf + Landlock（当前使用 bwrap namespace 隔离，landlock 后续增强）
- 所有 spawn 入口统一 Broker 审计
- 凭据代理 default-on（secrets 永远不裸传给子进程）

**验收标准**:

- [x] macOS sandbox profile 覆盖文件/网络/信号（strict/default/network-only 三种 profile）
- [x] Windows Job Object 限制子进程 + kill on close（postSpawn 自动关联作业）
- [x] 所有 `child_process.spawn` 走 Broker，无绕过（spawn/spawnSync 双路径集成）
- [x] 凭据通过 CredentialAgent 代理注入（default-on，敏感 env/args 自动过滤打码）
- [x] 主仓三平台构建与 E2E 验证通过（2026-07-21）
- [ ] CLI 专项 parity 测试（发布前 CLI CI 验证中）
- [x] 语法校验通过（node --check platform-sandbox.js / credential-agent.js / index.js 全 OK）
- [x] CC_SANDBOX_STRICT 模式 fail-closed 支持
- [x] 环境变量控制开关（CC_SANDBOX_DISABLE / CC_SANDBOX_STRICT / CC_CRED_AGENT_DISABLE）

**完成说明 (2026-07-21)**:

1. **`platform-sandbox.js` 三平台原生沙箱实现**：
   - macOS: 生成 Seatbelt `.sb` profile，通过 `sandbox-exec -f` 启动子进程，支持文件读写/网络/信号/sysctl 限制
   - Windows: 创建 Job Object + Restricted Token + Kill-on-Close，子进程退出/父进程退出自动清理，无孤儿进程
   - Linux: bubblewrap (bwrap) namespace 隔离（mount/pid/net/ipc/uts），支持 --unshare-net 禁网、只读系统绑定

2. **`credential-agent.js` 凭据过滤代理（default-on）**：
   - 30+ 正则模式识别敏感 env（API_KEY/TOKEN/PASSWORD/SECRET/PRIVATE_KEY/BEARER/AUTH 等）
   - 40+ 安全 env 白名单（PATH/HOME/USER/SHELL/LANG/TZ/NODE_ENV 等直接放行）
   - 命令行参数密钥自动重写：
     - `--token=xxx` → `--token=***REDACTED***`
     - `-H "Authorization: Bearer xxx"` → `-H "Authorization: ***REDACTED***"`
     - 内嵌 `sk-xxx` / `ghp_xxx` / `xoxb-xxx` 模式自动打码
   - 敏感值替换为 refId，明文不直接传入子进程，子进程按需 IPC 请求（有审计）

3. **Broker `index.js` 集成完成**：
   - 修复构造函数错误（移除错误的 `new PlatformSandbox()`，改为函数式 API）
   - `spawn()` 异步路径：权限检查 → 凭据过滤 → 沙箱应用 → native spawn → postSpawn Job Object 关联
   - `spawnSync()` 同步路径：同等处理（同步阻塞不需要 postSpawn）
   - `getInfo()` 对外暴露沙箱状态（平台/启用/严格模式）和凭据代理状态（default-on/过滤计数）
   - STRICT 模式下沙箱初始化失败直接拒绝执行（fail-closed），非严格模式仅警告继续

**涉及文件**:

- `packages/cli/src/lib/process-execution-broker/index.js` (Broker 主逻辑，已完成集成)
- `packages/cli/src/lib/process-execution-broker/platform-sandbox.js` (✅ 新增完成)
- `packages/cli/src/lib/process-execution-broker/credential-agent.js` (✅ 新增完成)
- 详细进度记录：`packages/cli/P0_CLI_SECURITY_PROGRESS.md`

---

### P0-2: 后台人机回路（Real-time Interruption）

**状态**: ✅ **核心代码完成 (2026-07-21)**；主仓 CI 与全量自动化已通过，CLI 专项 CI 发布前验证中

**目标**:

- 后台 Agent 运行时遇到 `AskUserQuestion` 立即暂停当前 turn
- 通过 IPC 总线发送问题到 UI/终端
- 用户回答后**原地恢复**执行（非结束后另起一轮）
- Resume 带相同 turn context、tool_call_id、消息序号

**验收标准**:

- [x] Agent 遇到提问 → pause → IPC 通知 → 等待 response
- [x] 用户回答 → resume → 同一 turn 继续执行
- [x] 超时/拒绝 → 按 `onTimeout`/`onReject` 策略处理
- [x] ESLint 通过（零错误零警告）
- [ ] Desktop 端集成 `AskUserQuestion` 渲染（后续）
- [ ] E2E 测试：后台 agent 提问→回答→完成（CLI 专项 CI 验证中）

**完成说明 (2026-07-21)**（CLI Headless 端实现）：

1. **`ipc-attach-protocol.js` IPC 消息协议（新增）**：
   - 8 种消息类型：`HELLO`/`QUESTION`/`ANSWER`/`RESUME`/`CANCEL`/`LIST_QUESTIONS`/`LIST_RESPONSE`/`BYE`
   - 换行安全编码：`\n` → `\x1f`，`\r` → `\x1e`（避免 JSON 与 stdout 交错）
   - 固定 `__IPC__:` 前缀过滤，stdout/stderr 分离
   - 完整单元测试覆盖（编码/解码/换行安全/前缀过滤）

2. **`background-interaction-resolver.js` 父进程侧交互解析器（新增）**：
   - 附加到 Worker 子进程 stdio，过滤 IPC 消息
   - 接收 QUESTION → 调用 resolver 获取答案 → 发回 ANSWER
   - 支持超时跳过（默认 60s）、CANCEL 处理、多问题排队
   - 错误安全：IPC 失败时不影响 agent 继续执行
   - 完整单元测试覆盖（13 个测试用例）

3. **`background-agent-worker.js` Worker 侧 AskUserQuestion 拦截**：
   - Worker 启动后立即发送 HELLO，报告 pending questions
   - 拦截 `ask_user_question` tool，暂停 turn，通过 IPC 发送 QUESTION
   - 用户回答后自动 resume（带相同 turn context、tool_call_id）
   - 支持 ANSWER/RESUME（文本/对象多格式）/CANCEL/LIST_QUESTIONS 命令
   - 错误安全：IPC 失败时 fallback 到默认答案继续执行
   - Worker 退出前发送 BYE

4. **`background-session.js` attach 命令交互集成**：
   - `cc cowork background attach <id>` TCP 连接到后台会话服务器
   - 收到 QUESTION 时弹出 readline 提示，显示问题 + 选项
   - 用户回答后编码为 ANSWER 消息发回 worker，原地恢复执行
   - Ctrl-C 断开时发送 BYE，不中断后台 worker 执行
   - 支持 `/detach` 命令主动脱离，旧版无 TCP 服务器 fallback 到日志流
   - 支持 `pendingQuestion` 状态显示在列表中（`(1 pending question)`）

**涉及文件**:

- `packages/cli/src/lib/ipc-attach-protocol.js` (✅ 新增完成)
- `packages/cli/src/lib/background-interaction-resolver.js` (✅ 新增完成)
- `packages/cli/src/workers/background-agent-worker.js` (✅ AskUserQuestion 拦截完成)
- `packages/cli/src/commands/background-session.js` (✅ attach IPC 集成完成)
- `packages/cli/src/lib/background-session-transport.js` (✅ TCP 会话服务器集成)
- `packages/cli/__tests__/unit/ipc-attach-protocol.test.js` (✅ 单元测试)
- `packages/cli/src/agent/agent-ipc-bus.js`（现有总线，Desktop 集成后续）
- `desktop-app-vue/src/main/ipc/agent-ipc-handler.js`（Desktop 端集成后续）

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

| #     | 任务                 | 状态        | 说明                                      |
| ----- | -------------------- | ----------- | ----------------------------------------- |
| P1-4  | Hooks v2 完整实现    | 🟡 运行时完成 | 18事件注册/执行、5种 executor、并行去重、JS handler、M5 E2E；真实 producer/沙箱仍待补 |
| P1-5  | MCP Elicitation 路由 | 🟡 Desktop/IDE 核心完成 | `elicitation/create` handler/事件驱动应答/超时取消、REPL/stream headless、WS question channel、Desktop/VS Code/JetBrains common schema 表单、Agent SDK callback 已接入；完整 schema vocabulary 仍待补 |
| P1-6  | Event Runtime 常驻化 | 🟡 producer 迁移进行中 | `cc agenda run --watch <seconds>`、claim lease/过期回收、`EventRuntimeStore` durable inbox/outbox、失败重试/死信、可停止 `EventRuntimeWorker`、`EventRuntimeProducer`、Agent IPC interaction 与 durable MCP resolver 接线已完成；Monitor/Webhook/MCP 长运行调用方全量迁移仍待补 |
| P1-7  | Context 来源归因     | M4 完成     | Skill 按需加载归因、MCP schema 统计       |
| P1-8  | Checkpoint REPL 统一 | 部分        | turn-binding 生产者、tool_use_id 完整浮出 |
| P1-9  | Plugin 安全强化      | 🟡 OS secret + 部分 Broker 已补 | 签名/manifest SHA-256、trusted key、安装后 SBOM 文件摘要、capability consent、managed allow/deny、DPAPI/Keychain/Secret Service 与插件 MCP/LSP/Hook Broker provenance 已有；Plugin Bin/Monitor 及 Desktop 全路径 Broker 强制仍待补 |
| P1-10 | 并发状态 fail-closed | 🟡 关键调度状态已补 | `withFileLock(failIfUnavailable)` + Agenda claim lease 已 fail-closed；approval/ledger/session 等关键状态仍待迁移 |
| P1-11 | JSON Schema 完整支持 | 🟡 常用 vocabulary 已补 | Draft 2020-12 常用关键字、dependent/pattern/contains/propertyNames、local `$ref`、组合/条件、format、structured_result 已有；完整 meta-vocabulary/外部 ref 仍待补 |
| P1-12 | SDK/CI 事件透传      | 🟡 M5+elicitation 部分 | goal/approval/turn、question/MCP elicitation 已有 TypeScript SDK；Python/CI 模板及全量事件仍待补 |
| P1-13 | 验收门与文档清理     | ✅ 已完成 | 统一 parity 10/10；旧文档持续维护 |

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

## ✅ 已完成（M0-M6 + P0-1/P0-2 核心，2026-07-19/20/21 落地）

- [x] **P0-1 三平台沙箱 + 凭据代理核心代码 (2026-07-21)**
- [x] **主仓 CI 验证 (2026-07-21)**：Code Quality、CI Tests、E2E Tests（Ubuntu/macOS/Windows）、Full Test Automation 全部通过
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

| 日期       | 目标                                            |
| ---------- | ----------------------------------------------- |
| **本周**   | P0-2 后台人机回路 turn 内暂停/恢复完成          |
| **下周**   | P0/P1-3 权限控制面统一 + P1-4 Hooks producer 接入与沙箱 |
| **两周后** | P1-5 ~ P1-8 完成                                |
| **三周后** | 9项 parity 验收门全绿，文档清理完成             |

---

## 参考文档

- 差距分析：`docs/CLAUDE_CODE_CLI_CURRENT_GAPS_AND_OPTIMIZATIONS_2026-07-18.md`
- 架构收敛：`docs/architecture/CLI_ARCHITECTURE_CONVERGENCE_2026-07-19.md`
- Parity 验证：`packages/cli/scripts/verify-agent-runtime-parity.js`
- P0-1 沙箱详细进度：`packages/cli/P0_CLI_SECURITY_PROGRESS.md`
