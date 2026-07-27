# CLI 差距任务跟踪表

> 来源：`CLAUDE_CODE_CLI_CURRENT_GAPS_AND_OPTIMIZATIONS_2026-07-18.md`
> 创建日期：2026-07-19
> 当前 CLI 版本：`0.162.182`
> 状态：P0-1 Broker/凭据、静态进程清单、Windows 原生进程边界、Node IPC/detached 语义与
> 真实三平台 strict CI 已完成；P0-2 当前 turn、持久化、跨宿主 authority/binding 与真实三平台
> 断线重连 E2E 已完成；P0/P1-3 权限控制面统一已完成；stdio MCP、LSP、Monitor 与 command
> Hook 的 sandbox policy 已贯穿；Plugin bin/native 直接执行身份绑定与 Windows Broker 强
> filesystem/network backend 已完成；Linux 已完成直接、前台、同步、policy-bearing Plugin Node bin
> 与静态 ELF native bin 的窄型 bwrap 强 backend。当前剩余 Linux 通用 Hook/MCP/LSP/Monitor backend、
> 动态链接/PIE 等其余 Plugin native、
> background、`run_code`/REPL bang/PTY 等非直接或非同步执行面及 handle-atomic 收口；P1-12 双语言 SDK 已完成，
> Python SDK 0.1.0 已发布 PyPI
> 最后更新：2026-07-27（按当前源码、真实三平台 strict CI 与生成清单复核）

---

## 执行优先级

| 优先级    | 任务数 | 说明                                                     |
| --------- | ------ | -------------------------------------------------------- |
| 🔴 **P0** | **0**  | P0-1、P0-2 已完成                                        |
| 🟠 P0/P1  | 0      | P0/P1-3 权限控制面统一已完成                             |
| 🟡 P1     | 2      | P1-4、P1-9 仍在收口                                     |
| 🟢 P2     | 4      | 差异化方向（不抢占 P0/P1）                               |

---

## 🔴 P0 任务（优先执行）

### P0-1: 进程隔离（ProcessExecutionBroker 生产化）

**状态**: ✅ **Broker/凭据 transport/三平台执行计划、进程清单、Windows 特殊进程语义与真实三平台 CI 已完成**

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
- [x] 生成清单中的 runtime 匹配全部迁移或记录审计豁免（2026-07-26：207 项，0 unreviewed）
- [x] `CC_SANDBOX_STRICT` 在平台边界不可用时 fail-closed
- [x] Windows 原生 adapter 保真 Node IPC fd3 与 detached 目标 PID/handle 语义
- [x] macOS/Linux/Windows 严格隔离真实 CI 矩阵全部通过

**实现说明（2026-07-26 复核）**:

1. **`platform-sandbox.js` 平台执行计划**：
   - macOS：生成 Seatbelt profile，通过 `/usr/bin/sandbox-exec -f` 包装目标进程
   - Windows：Broker 控制的 Windows PowerShell/Win32 adapter 以 restricted primary token
     挂起创建目标，先加入 kill-on-close Job Object 并施加 CPU/内存/进程数限制，再恢复执行
   - Windows adapter 首次使用通过系统 Windows PowerShell 同步编译内容寻址的托管 Win32 helper；
     目标始终由缓存 helper 直接启动，避免 bootstrap wrapper 改写扩展描述符，npm 与 `pkg`
     构建均携带同一受控源文件
   - Windows 真实测试验证受限 privilege 集、`cmd.exe /s /c` 内嵌引号与 2 MiB 输出语义，
     父进程退出后 detached grandchild 被 Job Object 清理、Node fd3 双向 IPC/断连语义，
     以及 detached `spawn().pid` 对齐真实目标并由 wrapper handle 监督整棵 Job；adapter/PowerShell
     缺失或额外非 IPC 描述符无法保真时仍返回 unavailable 并由 strict 模式 fail-closed
   - helper 从自身 CRT fd 映射重建 libuv `cbReserved2/lpReserved2` 描述符表，在
     `CreateProcessAsUser` 前恢复可继承句柄；目标继承成功后关闭 helper 侧 fd，避免延迟
     `disconnect`/EOF。detached 路径在 Job 绑定且目标恢复后通过随机控制文件同步返回
     `targetPid`，Broker 对外暴露目标 PID，同时保留 `sandboxWrapperPid` 用于 Job 生命周期
   - Linux：Broker 可用 `prlimit` 施加通用资源限制；显式 Agent sandbox 继续复用既有 bubblewrap；
     Broker 强 filesystem/network backend 目前仅覆盖直接、前台、同步且 policy-bearing 的
     Plugin Node bin 与静态 ELF native bin，通用 Hook/MCP/LSP/Monitor backend 尚未完成

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
   - 当前源码共 291 个词法匹配（runtime 207、tooling 56、test 28）；runtime 中
     157 项已路由 Broker、17 项有显式审计豁免、33 项为声明/注释/类型/安全正则噪声，
     `unreviewed` 为 0
   - `process-spawn-audit-policy.json` 记录 Broker 原生边界、Agent SDK 外部宿主与
     goal checker fail-closed 注入规则的 owner、复核日期和原因
   - `docs:spawn-inventory:check` 同时校验生成文档无漂移并在出现任意 unreviewed runtime
     匹配时失败

6. **2026-07-26 三平台验收完成**：
   - Broker 使用显式 `requiredBoundaries` / `guarantees` / `backend` 合约；平台只声明实际
     强制的边界，需求未满足时在 native spawn 前 fail-closed
   - Windows detached 调用同时把 libuv 等价的
     `DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP` 应用于真实 restricted target，保留 helper
     的 detached/outlive-parent 与 Job 监督语义
   - Windows helper 改用 `STARTUPINFOEX + PROC_THREAD_ATTRIBUTE_HANDLE_LIST`，目标只继承
     stdin/stdout/stderr 与可选 Node IPC fd3；Restricted Token、Job、detached 与 CRT fd3
     语义保持不变
   - [GitHub Actions run 30207776309](https://github.com/chainlesschain/chainlesschain/actions/runs/30207776309)
     的 macOS 15、Ubuntu 与 Windows strict native boundary job 全部通过；Linux 独立
     bubblewrap 文件系统/网络边界也在同一矩阵验收
   - 句柄白名单加固后的
     [GitHub Actions run 30208893336](https://github.com/chainlesschain/chainlesschain/actions/runs/30208893336)
     再次通过 macOS 15、Ubuntu 与 Windows 三个 strict native boundary job

7. **2026-07-27 Windows 强 filesystem/network backend 验收**：
   - 明确要求 filesystem/network 时，Broker 使用零 capability AppContainer、
     Restricted Token、目标进程 token/SID attestation 与 kill-on-close Job Object；
     `STARTUPINFOEX` 句柄白名单继续只传递标准流和受支持的 Node IPC fd
   - 临时 AppContainer profile 在目标退出后有界删除并再次证明不存在；托管 helper
     使用进程内 SHA-256/文件身份缓存，源码、可执行文件或缓存身份漂移时重新编译并 fail-closed
   - [GitHub Actions run 30214672198](https://github.com/chainlesschain/chainlesschain/actions/runs/30214672198)
     的 macOS 15、Ubuntu 与 Windows 三个 job 全部通过；Windows live 用例真实证明宿主
     secret 不可读、宿主 marker 不可写、loopback 不可达、零 capability token 与 profile 清理

8. **2026-07-27 Linux 直接 Plugin Node bin 窄型强 filesystem/network backend 验收**：
   - 仅覆盖 Agent `run_shell` 解析出的单一 literal argv、`shell:false`、前台同步且显式要求
     filesystem/network 边界的 Plugin Node bin；resolver 签发、Broker 单次消费的私有 contract
     将当前 trust/managed policy、plugin root、entry、Node runtime、cwd 与调用 provenance 绑定，
     缺失、伪造、复用或启动前漂移均在 native spawn 前 fail-closed
   - `/usr/bin/bwrap` 构造 empty-root namespace；经打开 FD 固定的 Node/runtime 依赖与 plugin tree
     逐文件只读挂载，环境被清空并重新建立受限 `/proc`、`/dev`、`/tmp`；user/pid/ipc/net/uts/cgroup
     namespace、capability drop 与 seccomp 共同阻止网络创建，包括
     `socket`、`socketpair` 和 `io_uring_setup`
   - [GitHub Actions run 30220657085](https://github.com/chainlesschain/chainlesschain/actions/runs/30220657085)
     的 macOS 15、Ubuntu 与 Windows 三个 job 全部通过；Ubuntu live 用例证明插件依赖和声明文件可读、
     HOME secret 与宿主 `/etc/passwd` 不可读、插件树和宿主 marker 不可写、`/tmp` 仅沙箱内临时可写，
     且宿主 loopback 可达而沙箱创建 socket 返回 `EPERM`；缺少私有 contract 时目标 marker 未启动
   - 该 Node 验收不扩展到 Plugin native、background、Hook/MCP/LSP/Monitor、
     `run_code`、REPL bang 或 PTY。FD pinning 已缩窄路径替换、symlink/mount 注入与身份漂移窗口，
     但 sealed immutable executable snapshot 和 OS spawn 前 handle-atomic 绑定仍未完成

9. **2026-07-27 Linux 静态 Plugin native ELF 窄型强 filesystem/network backend 验收**：
   - 在相同 one-shot contract、empty-root bwrap、逐文件 FD 只读挂载、namespace/capability drop
     与网络 seccomp 边界内，实际目标保持插件 native entry 与 literal argv；attested Node runtime
     只用于 bwrap policy capability probe，不替代或解释执行 native 目标
   - 目标必须是当前架构的 little-endian ELF64 `ET_EXEC`，program-header table 有界，入口位于可执行
     `PT_LOAD`；`PT_INTERP`、`PT_DYNAMIC`、`ET_DYN`/PIE、ELF32、大端、异架构、越界 header、
     executable stack、W+X、setuid/setgid 与 shebang/script 均在 bwrap probe 和目标启动前 fail-closed；
     `ldd` 仍只检查已证明身份的 Node probe runtime，不检查不可信插件 ELF
   - [GitHub Actions run 30232622815](https://github.com/chainlesschain/chainlesschain/actions/runs/30232622815)
     的 macOS 15、Ubuntu 与 Windows 三个 job 全部通过；Ubuntu live 用例现场编译 static/dynamic
     C fixture，证明 static native 的插件文件可读、宿主 secret/`/etc/passwd` 不可读、插件树与宿主
     marker 不可写、沙箱 `/tmp` 可写且 `socket` 返回 `EPERM`，同时 dynamic ELF 与 shebang 的目标均未启动
   - 实现落在 `92ca5dc69f`，ELF segment 边界修正在 `0b2b638b11`，native probe 审计传播修正在
     `c2e4053c87`。审计明确记录 `targetRuntime:native-static-elf`、`contentSnapshot:false` 与
     `handleAtomic:false`；同 inode 内容在最终 hash 后仍可能被另一写入者修改，动态/PIE native、
     background、通用 Hook/MCP/LSP/Monitor、`run_code`/REPL bang/PTY 也仍未覆盖

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
- `.github/workflows/cli-strict-sandbox.yml` (✅ 三平台 strict 边界矩阵及真实运行验收)
- `docs/cli/PROCESS_SPAWN_INVENTORY.generated.md` (✅ 207/207 runtime 已归类)
- 详细进度记录：`packages/cli/P0_CLI_SECURITY_PROGRESS.md`

---

### P0-2: 后台人机回路（Real-time Interruption）

**状态**: ✅ **CLI 当前 turn、pending/settlement 持久化、跨宿主 authority/binding 与三平台 E2E 已完成**

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
- [x] 三平台真实 E2E：提问→断线→重连→回答→同 turn 完成

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
   - `cli-background-interaction-e2e.yml` 在 Ubuntu/macOS/Windows 仅运行真实
     `background-stability-realspawn.test.js`，避免通用 CLI 36+ 分片的无关失败掩盖本验收；
     [GitHub Actions run 30207046775](https://github.com/chainlesschain/chainlesschain/actions/runs/30207046775)
     已在三个宿主全部通过
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
- `.github/workflows/cli-background-interaction-e2e.yml`
- `packages/agent-sdk/__fixtures__/protocol/interaction.ndjson`
- `packages/agent-sdk/src/protocol.ts`
- `packages/agent-sdk-python/src/chainlesschain_agent_sdk/protocol.py`
- `packages/cli/src/gateways/ws/remote-session-protocol.js`
- `packages/cli/src/gateways/ws/background-agent-protocol.js`

---

## 🟠 P0/P1 任务

### P0/P1-3: 权限控制面统一

**状态**: ✅ 运行时规则、CLI 管理面和 Desktop 请求/刷新同步已完成；统一 parity 已验证

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

| #     | 任务                 | 状态                                            | 说明                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----- | -------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1-4  | Hooks v2 完整实现    | 🟡 producer/managed/sandbox contract 已贯穿；Windows backend 已验收 | 40事件注册/执行、5种公共 executor + trusted JS、并行去重、11 项高价值 producer、M5 E2E、最小环境交集、command/workspace/MCP/agent/skill allowlist、MCP 共享授权与独立 delegated budget 已有；Hook managed policy 与 plugin manifest/group/per-hook `sandboxPolicy.requiredBoundaries` 只增不减并贯穿全部 command/delegated process 启动路径；显式要求不可满足时 fail-closed；Windows AppContainer 强 filesystem/network backend 已通过真实 CI，Linux 通用 Hook backend 仍未完成 |
| P1-5  | MCP Elicitation 路由 | ✅ form/URL/defer 已完成                        | 基于 MCP `2025-11-25`：声明 form/URL capability；`elicitation/create`、`notifications/elicitation/complete` 与 `URLElicitationRequiredError (-32042)` 已接入；URL 仅允许无凭证 HTTPS，所有交互宿主展示完整 URL 并在明确同意后打开；Headless 结构化 defer、完成关联及原工具调用 exactly-once retry 已覆盖，URL 敏感输入不回传 `content`                                                                      |
| P1-6  | Event Runtime 常驻化 | ✅ 宿主托管、观测与恢复闭环                     | 发布二进制的 lazy-dispatch 真实入口统一启动/停止 process-level host：长驻命令持续 drain，短命命令退出前有界 final drain；durable inbox/outbox、lease fence/续租/过期接管、重试/死信/背压、producer 自动接线均已有；Webhook/Telegram 使用 required-handler 恢复路由；`cc status --json` 暴露队列及跨进程 host 心跳/stale 状态，`npm run runtime:event-recovery` 用两个真实进程验证崩溃接管与副作用只应用一次 |
| P1-7  | Context 来源归因     | ✅ 双层 Skill 缓存与交互式快照已完成            | `cc context --sources` 已对 instruction 文件、实际注入 persona Skill、admitted MCP schema、普通 Skill descriptor/body 按需读取、缓存命中及实际 prompt 注入分别计费；Headless 与交互 REPL 共用单一 Skill loader，并持续写入无正文 `context_sources` 快照                                                                                                                                                     |
| P1-8  | Checkpoint REPL 统一 | ✅ 统一 producer 与归因闭环                     | Agent Core 输出 provider 原始 `tool_use_id`/turn id/permission decision/checkpoint；Headless 与 REPL 共用 `createTurnBindingFeed`，交互 turn 逐次 fail-closed 持久化；child trace/checkpoint/tool/worktree、IDE user edit 与顶层 `--worktree` branch 均进入父 turn，shell/外部副作用诚实标为 partial                                                                                                        |
| P1-9  | Plugin 安全强化      | 🟡 直接 bin 身份绑定及 Windows/Linux Node/静态 native 窄型 backend 已验收 | 签名/manifest SHA-256、trusted key、SBOM、capability consent、managed allow/deny、OS secret 与插件执行 Broker provenance 已有；manifest/component/descriptor 的窄型 sandbox policy 已贯穿 MCP/LSP/Monitor/Hook；policy-bearing Plugin bin 不再进入 PATH，Node/native 直接执行经 realpath、file-id、SHA-256 二次 attestation 后以 `shell:false` 进入 Broker，wrapper/复合命令 fail-closed，审计记录结构化可执行身份；Windows AppContainer 强 backend，以及 Linux 直接、前台、同步 policy-bearing Plugin Node bin 与静态 ELF64 `ET_EXEC` native bin 的 empty-root bwrap、FD 只读挂载及 seccomp 强 backend 已通过真实 CI；Linux 动态/PIE 等其余 Plugin native、通用 Hook/MCP/LSP/Monitor、background、`run_code`/REPL bang/PTY 等非直接或非同步执行面、内容不可变 snapshot 及 handle-atomic 绑定仍待收口 |
| P1-10 | 并发状态 fail-closed | ✅ 关键状态分级与跨宿主锁已完成                 | Approval CAS、side-effect/turn/session、Agenda/Event Runtime、Cowork delivery lease、goal/config/MTC ledger、plugin/MCP trust/consent/凭据元数据均有界 fail-closed；VS Code/JetBrains 共享同一 `.lock` 目录协议与原子 session-index 写入；仅 Advisory cache 保留 best-effort                                                                                                                                |
| P1-11 | JSON Schema 完整支持 | ✅ 标准引擎、完整 vocabulary 与受限 refs 已完成 | `Ajv2020` + `ajv-formats` 统一执行 Draft 2020-12 meta-schema/动态引用/`unevaluated*`/组合互操作；所有 `--json-schema` 入口在模型调用前编译完整 schema graph；本地 ref 限于根 schema 目录，远程 ref 仅允许无凭证公网 HTTPS，并受 DNS-SSRF、文档数/单文档/总字节/超时上限保护；稳定 digest、错误码、JSON Pointer 与 `structured_result` 保持兼容                                                              |
| P1-12 | SDK/CI 事件透传      | ✅ 源码完成；Python 0.1.0 基线已发布            | 当前 TypeScript + Python 源码覆盖契约中的 24 类 typed stream 事件（含 defer/complete）、approval/question/MCP elicitation callback、resume 与未知事件无损透传；共享 protocol fixture、穷举 CI consumer、GitHub Actions 模板及 22 项 hermetic 测试已补；已发布的 Python 0.1.0 是此前 22 类事件基线并通过 3.10/3.12/3.13 公网 wheel 烟测，本轮两个新增事件尚未发布新版本                                      |
| P1-13 | 验收门与文档清理     | ✅ 已完成                                       | 统一 parity 10/10；旧文档持续维护                                                                                                                                                                                                                                                                                                                                                                           |

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

**2026-07-26 P1-9 安全增量**：关闭 legacy capability bypass。此前管理员开启
`requirePluginCapabilityConsent` 后，插件仍可通过省略 `permissions` 绕过加载 gate；
现在强制 consent 必然隐含强制声明，且可用 managed
`requirePluginCapabilityDeclarations` 或 `CC_REQUIRE_PLUGIN_CAPABILITIES=1`
独立启用。默认仍保留兼容迁移窗口。直接 URL 型 plugin MCP 在进入连接器前会解析目标
hostname，并按声明的精确 domain / `*.subdomain` / `network:*` 执行 fail-closed
校验；stdio MCP 保持可用，其子进程 egress/filesystem 仍由平台 sandbox 边界负责。
定向 5 个测试文件 78/78 通过。P1-9 尚未标记完成，因为 Plugin bin/native 尚未纳入，
Windows/Linux Broker 强 network/filesystem backend 也仍未完成。

**2026-07-26 P1-4/P1-9 sandbox contract 增量**：新增插件可声明的窄型
`sandboxPolicy.requiredBoundaries`，仅接受 filesystem/network。manifest 与
component/descriptor 要求按加法合并，现已贯穿 stdio MCP、LSP、Monitor 和 command
Hook 的启动链到 ProcessExecutionBroker；无效字段、类型或 boundary 均 fail-closed，
显式要求在 backend 不可提供时拒绝启动，未声明时保持兼容。顶层策略与 Plugin bin
共存时整个 manifest 直接判为无效，避免尚未接线的全局 PATH 可执行文件静默绕过。
此次未将 Plugin bin/native 纳入：全局 PATH 暴露的可执行文件身份与 wrapper/TOCTOU
尚无可证明绑定。Windows/Linux Broker 的真实 filesystem/network 强 backend 也仍未完成，
因此 P1-4/P1-9 均保持进行中。聚焦回归 11 文件 183/183、扩展 Hook 回归 5 文件
125/125 通过。

**2026-07-27 P1-9 Plugin bin/native 与 Windows backend 增量**：policy-bearing bin
不再进入 PATH；未声明 policy 的 legacy bin 保留兼容。Agent `run_shell` 解析到的 Node/native
bin 只接受单一 literal argv，并以 `shell:false` 直接进入 Broker；Windows
`.cmd`/`.bat`/`.ps1` wrapper、复合 alias、重复 alias、symlink/hardlink 与越界 realpath
均 fail-closed。manifest 与 per-bin `sandboxPolicy` 按加法合并，同目录 strict/legacy
混用时整个目录不进入 PATH，避免 legacy shell 间接命中 strict bin。入口在解析时和 Broker
启动前按 realpath、dev/ino、size、mtime 与 SHA-256 复验，结构化
`pluginExecutableIdentity` 写入审计但从 native spawn options 剥离；Agent 工作目录内任一
strict bin 的要求还会收紧全部同轮 `run_shell`，关闭 wrapper、动态 shell 和 PATH 注入旁路。
定向 3 文件 63/63、扩展 scopes/bin/Agent Core 46/46 与 background shell 21/21 通过。
后续 `af6ec8f1a6` 在 Windows 上通过第二个 path handle 与已打开主 handle 的
fstat-to-fstat 身份/摘要对照捕获同内容路径替换，进一步缩窄 path TOCTOU，但不宣称
OS spawn 已实现 handle-atomic。
Windows AppContainer backend 的真实文件/网络隔离由 run 30214672198 验收。P1-9 仍保持
进行中：Linux 强 backend、`run_code`/REPL bang/PTY 等非直接 `run_shell` 面，以及
OS spawn 前窄 TOCTOU 的 handle-atomic 绑定尚未完成。

**2026-07-27 P1-9 Linux 直接 Plugin Node bin backend 增量**：`2caef1e2ac` 至
`e0ef465227` 为直接、前台、同步的 policy-bearing Plugin Node bin 加入 one-shot trusted
contract、empty-root bwrap、FD-backed read-only mounts 与网络 namespace/seccomp 强边界，
并由 run 30220657085 的 Ubuntu live 用例验收。该增量只关闭 Linux Plugin Node 的窄型
直接执行面；Plugin native、通用 Hook/MCP/LSP/Monitor、background、
`run_code`/REPL bang/PTY，以及同 inode 内容不可变快照和 OS spawn 前 handle-atomic 绑定
仍是 P1-9 残项，因此状态继续保持 🟡。

**2026-07-27 P1-9 Linux 静态 Plugin native ELF backend 增量**：`92ca5dc69f`、
`0b2b638b11` 与 `c2e4053c87` 把同一窄型强边界扩展到当前架构的 ELF64 little-endian
`ET_EXEC` 静态 native bin。Broker 在调用任何插件目标或 `ldd` 前从 attested FD 严格解析
ELF，拒绝 interpreter/dynamic/PIE/script、异架构和畸形 program header，并在 Node policy
probe 后同时复核路径身份与 pinned entry FD；实际 bwrap target 仍是 native entry，Node
仅是可信 capability probe。run 30232622815 的三平台 strict matrix 全绿，Ubuntu live
现场证明 static ELF 隔离成功且 dynamic ELF/shebang 在目标启动前被拒绝。该增量不宣称
sealed content snapshot 或 handle-atomic：审计固定为 `contentSnapshot:false`、
`handleAtomic:false`；同 inode 写入窗口、动态/PIE native、background、通用
Hook/MCP/LSP/Monitor、`run_code`/REPL bang/PTY 仍是残项，因此 P1-9 继续保持 🟡。

**2026-07-26 P1-10 完成**：对 Critical / Durable / Advisory 状态逐项复核，
并移除关键路径的“锁失败后无锁继续”。既有 `ApprovalAuthorityStore` 已具备锁内
CAS revision、临时文件 fsync/rename 和损坏拒绝；side-effect ledger、turn binding
与 JSONL session append 已默认 fail-closed。Agenda/Event Runtime 的 lease/fence
保持不变，legacy Cowork cron 新增持久 `deliveryId`、owner、lease、续租与 fence
结算，两个 scheduler 对同一 fire 只会有一个 owner，过期 owner 不能续租或覆盖后继
结果。Goal、config、feature flag 与 MTC batch 的读改写也不再在锁不可用时继续。

安全元数据统一采用锁内严格读取和同目录原子替换：plugin trust、capability consent、
plugin option secret-ref、project MCP trust、MCP OAuth token、sync credential vault
与 LAN pairing token 遇到锁失败、损坏文件或持久化失败都会保留旧状态并报错；项目
`.mcp.json` 的 trust service/首次 fingerprint 无法持久化时不再继续加载可执行配置。
VS Code 与 JetBrains 共享的 `ide/session-index.json` 改用完全相同的原子 `.lock`
目录协议，写入前严格解析，锁超时或损坏时均不覆盖；VS Code 8 个真实并发进程写入
回归无丢记录，JetBrains 定向测试通过。本轮 CLI 关键状态/Plugin 组合回归
37 文件 775/775，VS Code 3/3，JetBrains `IdeSessionIndexTest` 通过。

**2026-07-26 P1-11 完成**：结构化输出从自研 Draft 2020-12 子集切换到直接依赖的
`Ajv2020` 与 `ajv-formats`，完整 meta-schema、动态作用域 `$dynamicRef`、嵌套 `$id`、
`unevaluatedProperties`/`unevaluatedItems` 及跨 applicator evaluated-location 语义由标准
引擎统一执行。适配层继续输出既有的 `code`/`keyword`/RFC 6901 `instancePath`/
`schemaPath`，并保持 key-order-independent `sha256:` digest 与终态
`structured_result` 协议；digest 同时绑定已解析外部文档内容，远端契约变化不会继续
冒用旧摘要。无效 schema 或未解析引用会在任何模型调用前编译失败。

`--json-schema` 的文本、单轮 `stream-json` 和输入流三条真实入口现共用预解析 loader。
相对本地引用只允许落在根 schema 目录（含 realpath 检查）；自动远程引用只允许无凭证
公网 HTTPS，复用 DNS pinning/重绑定与 private/metadata SSRF 防护，并限制最多 32 个
文档、单文档 1 MB、总计 4 MB 和 10 秒请求超时。远程文档不能反向跳转到本地文件，
HTTP、私网、凭证 URL、目录逃逸、损坏文档、预算超限与未闭合 graph 均 fail-closed。
复杂 `allOf + unevaluatedProperties`、重叠 properties/patternProperties、
prefixItems/unevaluatedItems、递归 dynamic ref、本地/递归 HTTPS ref、SSRF 与预算回归
已加入；本轮定向 3 文件 90/90 通过。

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
和 Hook 自身请求中。平台级“不可写出工作区”要求 Broker 执行计划声明并实际强制 filesystem
边界；Windows Broker 已由零 capability AppContainer 和真实 CI 提供可证明的强
filesystem/network backend，Linux 通用 Hook backend 尚未完成，因此 P1-4 仍保持进行中。

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

## ✅ 已完成（M0-M6 + P0-1/P0-2）

- [x] **P0-1 Broker async/sync/PTY 凭据边界 + macOS Seatbelt/Linux 执行计划**
- [x] **P0-1 Ubuntu/Windows/macOS strict native boundary 真实 CI 矩阵**
- [x] **P0-1 Windows AppContainer 强 filesystem/network backend 与真实 live CI**
- [x] **P0-2 CLI 当前 turn 提问/回答/继续核心链**
- [x] **P0-2 pending/settlement 持久 journal、断线重放与 worker 丢失 exactly-once 拒绝**
- [x] **P0-2 Desktop/VS Code/JetBrains/Web Panel/Remote Control/SDK authority/binding 收口**
- [x] **P0-2 Ubuntu/Windows/macOS 真实断线→重连→回答→同 turn 完成 E2E**
- [x] **P1-5 MCP Elicitation form/URL/defer、完成通知与 `-32042` exactly-once retry**
- [x] **P1-6 Event Runtime 真实 binary lifecycle、跨进程 host health 与崩溃恢复演练**
- [x] **P1-7 Context 双层 Skill cache、交互式快照与按需/命中/注入成本归因**
- [x] **P1-8 Headless/REPL 统一 turn binding、provider id 与 child/worktree/user-edit 归因**
- [x] **P1-9 policy-bearing Plugin bin/native 直接 Broker 身份绑定与审计**
- [x] **P1-9 Linux 直接、前台、同步 policy-bearing Plugin Node bin 的 bwrap empty-root、FD mounts、seccomp 强 filesystem/network live CI**
- [x] **P1-9 Linux 直接、前台、同步 policy-bearing 静态 Plugin native ELF 的格式验真、bwrap 强边界与 live CI**
- [x] **P1-10 Critical/Durable 状态 fail-closed、Cowork delivery fence 与跨 IDE session lock**
- [x] **P1-11 Draft 2020-12 标准引擎、启动期 graph 编译与受限 local/HTTPS refs**
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

| 顺序       | 目标                                                                 |
| ---------- | -------------------------------------------------------------------- |
| **当前**   | P1-4/P1-9：Linux 通用 Hook/MCP/LSP/Monitor backend、动态/PIE 等其余 Plugin native、非直接或非同步执行面、内容 snapshot 及 handle-atomic 收口 |
| **已完成** | P0-1/P0-2 三平台验收；P0/P1-3 权限控制面统一                           |
| **本轮完成** | stdio MCP/LSP/Monitor/command Hook sandboxPolicy 到 Broker 的完整贯穿；Linux 直接前台同步 policy-bearing Plugin Node 与静态 native ELF bin 窄型强 backend |
| **发布前** | 双语言 SDK 兼容门、真实环境 parity 与文档事实源漂移检查              |

---

## 参考文档

- 差距分析：`docs/CLAUDE_CODE_CLI_CURRENT_GAPS_AND_OPTIMIZATIONS_2026-07-18.md`
- 架构收敛：`docs/architecture/CLI_ARCHITECTURE_CONVERGENCE_2026-07-19.md`
- Parity 验证：`packages/cli/scripts/verify-agent-runtime-parity.js`
- P0-1 沙箱详细进度：`packages/cli/P0_CLI_SECURITY_PROGRESS.md`
