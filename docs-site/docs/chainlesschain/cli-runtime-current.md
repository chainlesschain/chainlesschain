# CLI Runtime 当前实现（0.162.189）

> 更新时间：2026-08-01。npm `latest` 已发布 `0.162.189`。

本文是当前 CLI 运行时的实现快照，适合部署、排障和集成方阅读。设计取舍详见[运行时设计核对](/design/cli-runtime-current)。

## 现在可以使用什么

- `cc agent --bg`：后台启动长任务，返回可持久化的会话 ID。
- `cc attach <id>`：通过本机控制通道继续提问、停止或查看后台 Agent；通道不可用时自动改为日志跟随。
- `cc logs <id>`、`cc daemon status|view|resume|stop`：查看和管理后台会话。
- 后台提问、审批与副作用确认：重连后继续等待原问题，并按会话/回合/操作指纹校验，避免重复执行。
- `Setup` / `Notification` hooks：在命令开始前注入环境并发送会话通知。
- 跨平台 sandbox 与 credential agent：前台、后台、hook、MCP、monitor、LSP、PTY 和插件 bin 都通过统一 broker 执行。
- 强执行路径补齐：插件异步/后台进程、通用后台任务、CLI PTY 与桌面项目 PTY 共用失败闭合边界；未经证明的项目根和远端 metadata 不能获得本机 PTY 权限。
- 技能进程安全：CLI-Anything 与 CLI 指令技能包生成的 handler 通过宿主 Process Broker 执行，不再直接导入 `child_process`。
- 插件治理：按 scope 启停、来源感知升级/回滚、当前会话热重载，并查看签名、SBOM、来源与组织策略摘要；升级在 staging 校验后原子激活，失败时恢复旧版本。
- 用量与重试归因：`cc session usage` 可按插件/版本归因 plugin-bin 与插件 MCP 调用，并显示有界工具耗时、观测重试及脱敏 LLM retry 原因，不记录工具参数、输出或凭据。
- IDE worktree 与协作任务：VS Code / JetBrains 显示 worktree、team 与 batch 的 owner、权限模式、预算、状态和副作用计数；协作单元不会因此获得后台进程 attach/stop 权限。
- P2-14 托管 workspace 回滚：Process Broker 为声明范围内的 managed writer 建立持久 checkpoint，成功时接受，失败、取消或超时时带 fence 恢复，并显式区分 `full`、`partial` 与 `none` 覆盖。
- P2-16 Agent Teams：`cc team run` 使用本地 schema v6 authority；`cc team queue` 使用独立 queue schema v1、fenced lease、四维预算与共享可信本地文件系统协调，恢复和不明确副作用进入显式裁决。
- `cc session export <id>`：默认扫描并脱敏会话中的 API Key、JWT、连接串等秘密；只有显式 `--no-redact` 才保留原文。
- `CHAINLESSCHAIN_HOME=<dir>`：把配置、会话、状态、日志和缓存统一隔离到指定目录，适合 CI、多项目或便携部署。

## 运行结构

```text
cc
 ├─ lazy command dispatch (manifest + help/alias)
 ├─ agent runtime (foreground / background)
 │    └─ local attach (NDJSON/TCP)
 ├─ process-execution-broker
 │    ├─ platform sandbox + native attestation
 │    ├─ credential agent
 │    └─ managed workspace transaction (checkpoint / fenced rollback)
 ├─ agent-team runtime
 │    ├─ local authority schema v6
 │    └─ shared-filesystem queue schema v1
 ├─ plugin runtime (policy + lifecycle + provenance)
 ├─ skill-process-broker
 │    └─ frozen host facade → process-execution-broker
 ├─ durable event / interaction journal
 ├─ bounded usage / retry attribution
 ├─ async-hook supervisor (timeout + process-tree reap)
 └─ Hooks v2 + session hooks (Setup/Notification)
```

## 命令入口

主要入口位于：

- `packages/cli/src/cli.js`：启动与注册。
- `packages/cli/src/lazy-dispatch.js`：命令延迟分发。
- `packages/cli/src/lib/background-agent-supervisor.js`：后台会话监督。
- `packages/cli/src/lib/process-execution-broker/`：子进程安全执行。
- `packages/cli/src/lib/agent-team/`、`packages/cli/src/commands/team.js`：Agent Team、本地 authority、分布式 queue 与人工裁决。
- `packages/cli/src/lib/plugin-runtime/`：插件安装、scope、来源与 sandbox 策略。
- `packages/cli/src/lib/plugin-usage-attribution.js`：插件调用归因。
- `packages/cli/src/lib/skill-process-broker.js`：为声明 `shell-exec` 的技能创建冻结、带权威来源的进程 facade。
- `packages/cli/src/lib/cli-anything-bridge.js`、`lib/skill-packs/generator.js`：生成使用 Broker 的技能 handler。
- `packages/cli/src/lib/async-hook-supervisor.cjs`：异步 hook 并发、超时与进程树回收。
- `packages/cli/src/lib/paths.js`：`CHAINLESSCHAIN_HOME` 与运行目录解析。
- `packages/cli/src/lib/session-hooks.js`：通知与会话钩子。

## 平台注意

- Linux 严格原生插件路径只接受受支持的当前架构静态 ELF，并把解析、探测和启动绑定到同一插件树/文件描述符；动态 loader、可执行栈、畸形 segment、复制或过期 contract 会在启动前拒绝。
- Linux 上每个实际 bind source 都必须证明 private mount propagation；证明不足时拒绝启动。父进程 pinned descriptor 在 spawn 后关闭，避免 authority 泄漏。
- Windows AppContainer 路径绑定目标句柄、受信环境与策略摘要；跨 probe、spawn、IPC 和 detached 启动边界都会复核目标及插件身份。
- Windows 上 `.cmd` 启动、hook 输出清理、后台 attach 路径已修复。
- Windows 异步 hook 优先使用 `taskkill /T /F` 回收整棵进程树；当系统允许枚举但拒绝 `taskkill` 时，会先快照后代 PID 并从叶子向上兜底终止。受限沙箱若同时禁止枚举和终止，只能回收当前可控子进程并显式跳过真实树终止测试。
- raw PTY 在 close/error 后立即失效；attached session 停止时回收完整 POSIX process group 或 Windows process tree。
- Hooks v2 以 generation-aware opaque identity 绑定可信宿主根。晚到的 stdin `EPIPE` 不会吞掉已完成 hook 的 status 0 输出或 status 2 block；其它 spawn error 仍失败闭合。
- Hooks 与 Broker 共享单一 runtime graph，避免重复 CredentialTransport worker/listener 与稳态 FD。
- 本地控制通道优先使用 NDJSON/TCP fallback，需要本地会话凭据。
- 停止后台 Agent 时，supervisor 会校验 PID 与会话绑定关系，避免误杀。

## 在 IDE 中查看质量、插件、Worktree 与 Agent Teams

VS Code `0.37.37` 和 JetBrains `0.4.76` 推荐搭配 CLI `0.162.189`，两个插件版本均已在各自公开市场上架：

- 质量上下文只发送有界的测试结果、覆盖率与调试器快照，并标注新鲜度；VS Code Notebook 使用当前 notebook 的真实执行上下文。
- Installation Doctor 会同时检查 Node/Java、managed CLI 与插件 registry 离线恢复状态，不从工作区目录探测可执行文件。
- Plugin Manager 的 enable/disable、upgrade、reload、签名/SBOM 与策略来源都由 CLI runtime 执行；IDE 只在收到 `activated` 后重载会话，扩大 capability 前必须显式确认。
- Worktree Tasks 和 team/batch 协作记录显示 durable owner/session、权限、预算、生命周期与副作用摘要；team/batch 仍不暴露后台进程控制按钮。
- Team Monitor 只读观察本地 v6 或 queue v1 原始状态；takeover、managed checkpoint recovery 与 side-effect adjudication 通过解析出的 CLI 执行，并绑定精确 authority digest、lease 和 evidence fence。IDE 不直接改写权威 JSON。
- 用量视图显示真实工具耗时、观测重试与实际 provider/model 的脱敏 retry 原因。

## 托管回滚与 Agent Team 边界

- `--managed-checkpoint` 只覆盖 Process Broker 管理且位于声明 workspace 范围内的 writer；未托管进程、其他本地进程与范围外路径不在保证内。
- `coverageTarget=full` 仍要求 `writerIsolation=exclusive-workspace`；Agent Team 当前 checkpoint authority 为 `partial`、`writerIsolation=unknown`、`externalSideEffects=true`。
- 网络、数据库、消息、部署、支付和其他外部系统操作不能由 workspace checkpoint 回滚；需要业务幂等键、事务日志与结果核验。
- queue v1 依赖共享可信本地文件系统和文件锁，不提供复制、仲裁、BFT 或网络分区容错。状态是未签名的可信控制面，父目录与祖先必须可信。
- 10,000 task / 64 worker 结果来自单进程内 TeamRunner 异步 worker；三平台长期 soak 使用 2 个真实 OS worker 验证跨进程 DAG、故障与恢复，不等价于 64 个分布式进程或 live-model 质量保证。

## 配置目录约定

默认运行目录是 `~/.chainlesschain`。设置 `CHAINLESSCHAIN_HOME` 时，该值就是运行目录本身，不会再追加一层 `.chainlesschain`：

```bash
CHAINLESSCHAIN_HOME=/tmp/cc-ci cc session list
# 会话文件：/tmp/cc-ci/sessions/<id>.jsonl
# 主配置：  /tmp/cc-ci/config.json
```

credential agent 会保留运行所需的非秘密会话标识（如 `CC_SESSION_ID`、`CLAUDE_CODE_SESSION_ID`），但仍过滤未知的 `*_SESSION` 变量与长效凭据，避免把无关宿主环境透传给子进程。

## 生成技能的进程边界

- 只有声明 `capabilities: [shell-exec]` 的技能会获得 `context.processBroker`。
- facade 只暴露 `run`、`runSync`、`runFileSync`，并由宿主冻结；`origin=skill:<id>`、`scope=skill` 和插件来源由宿主写入。
- CLI-Anything 把用户输入解析为字面 argv，并使用 `shell:false`；危险 shell 字符和未闭合引号会被拒绝。
- CLI 指令技能包先校验域内命令白名单与 shell 元字符，再通过 Broker 调用 `chainlesschain`。
- 报错 `Process Broker unavailable for skill execution` 时，应升级 CLI 并重新生成/注册技能，不要修改 handler 绕过检查：

```bash
npm i -g chainlesschain@latest
chainlesschain skill sync-cli --force
chainlesschain cli-anything register <name> --force
```

## 验证

在发布或本地验证前，建议执行：

```bash
cd packages/cli
npm run test:unit
npm run test:integration
npm run test:e2e
```

`0.162.189` 的权威发布提交为 [`2607af0dadeb951583139942e5f2add3e95e1208`](https://github.com/chainlesschain/chainlesschain/commit/2607af0dadeb951583139942e5f2add3e95e1208)。同一 `head_sha` 的 [CLI CI](https://github.com/chainlesschain/chainlesschain/actions/runs/30586603353)、[CLI Strict Sandbox](https://github.com/chainlesschain/chainlesschain/actions/runs/30586603019)、[Agent Team 长期 soak](https://github.com/chainlesschain/chainlesschain/actions/runs/30564377629) 与 [npm 发布](https://github.com/chainlesschain/chainlesschain/actions/runs/30588174291) 均已成功。Linux、Windows、macOS 的权威矩阵必须绑定精确提交；本地结果只能补充，不能替代发布门。
