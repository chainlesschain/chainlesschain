# CLI Runtime 当前实现（0.162.197）

> 更新时间：2026-08-05。仓库源码与 npm `latest` 当前均为 `0.162.197`；生产推荐基线仍为完成 exact-SHA 三平台发布门的 `0.162.189`。在 `0.162.197` 的 CLI CI、CLI Strict Sandbox、发布来源和不可变制品证据全部核验前，不把 registry 版本号本身等同于权威发布结论。

## 概述

本文是当前 CLI 运行时的实现快照，适合部署、排障和集成方阅读。设计取舍详见[运行时设计核对](/design/cli-runtime-current)。

## 安装版本怎么选

| 用途                | 版本        | 说明                                                                                                                      |
| ------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------- |
| 生产 / 日常稳定使用 | `0.162.189` | 最近在同一 exact SHA 完成 Linux、Windows、macOS 的 `CLI CI`、`CLI Strict Sandbox`、长期 Agent Team soak 与专用 npm 发布门 |
| npm `latest`        | `0.162.197` | registry 当前返回版本；仍需把包来源、tag、attestation、不可变 tarball/SBOM 和同 SHA CI 作为独立证据核验                   |
| 源码开发 / 候选验证 | `0.162.197` | 与 `packages/cli/package.json` 一致；是否可作为生产基线取决于准确提交的完整发布门，而不是版本号                           |

生产安装建议显式固定：

```bash
npm i -g chainlesschain@0.162.189
```

已安装 `0.162.197` 的用户无需改写或伪造 tag；需要已核验权威发布基线时可固定 `0.162.189`，待 `0.162.197` 对应准确提交的完整发布门证据确认后再调整生产基线。

## 核心特性

- `cc agent --bg`：后台启动长任务，返回可持久化的会话 ID。
- `cc attach <id>`：通过本机控制通道继续提问、停止或查看后台 Agent；通道不可用时自动改为日志跟随。
- `cc logs <id>`、`cc daemon status|view|resume|stop`：查看和管理后台会话。
- 后台提问、审批与副作用确认：重连后继续等待原问题，并按会话/回合/操作指纹校验，避免重复执行。
- `Setup` / `Notification` hooks：在命令开始前注入环境并发送会话通知。
- 安全配置写入：schema secret 必须经 `cc config set-secret` 的隐藏输入与 OS store/owner-only fallback，普通 `config set` 会拒绝敏感字段；显式 `workspace-write` / `strict` sandbox 在不可用时失败闭合。
- MCP `ws/wss`、可信动态 header、timeout notification 与不确定结果恢复：REPL、stream、Cowork/host、WebSocket 使用共享 recovery authority，结果不明确时要求核验或裁决，不盲目 replay。
- Canonical session 与持久预算：REPL、stream、WebSocket、headless 使用可验证 transcript projection 与事务化 summary/compaction；后台/Team adapter 使用 fenced token、USD 与 wall-clock 预算。
- Agent 工作流：plan/todo revision 与 authority ceiling、受控 Skill 子 Agent、后台 launch profile、semantic handoff、`/btw` 临时旁路、manifest-driven help 与 shell completion 已进入当前源码。
- 跨平台 sandbox 与 credential agent：前台、后台、hook、MCP、monitor、LSP、PTY 和插件 bin 都通过统一 broker 执行。
- 强执行路径补齐：插件异步/后台进程、通用后台任务、CLI PTY 与桌面项目 PTY 共用失败闭合边界；未经证明的项目根和远端 metadata 不能获得本机 PTY 权限。
- 技能进程安全：CLI-Anything 与 CLI 指令技能包生成的 handler 通过宿主 Process Broker 执行，不再直接导入 `child_process`。
- 插件治理：按 scope 启停、来源感知升级/回滚、当前会话热重载，并查看签名、SBOM、来源与组织策略摘要；升级在 staging 校验后原子激活，失败时恢复旧版本。
- 用量与重试归因：`cc session usage` 可按插件/版本归因 plugin-bin 与插件 MCP 调用，并显示有界工具耗时、观测重试及脱敏 LLM retry 原因，不记录工具参数、输出或凭据。
- IDE worktree 与协作任务：VS Code / JetBrains 显示 worktree、team 与 batch 的 owner、权限模式、预算、状态和副作用计数；协作单元不会因此获得后台进程 attach/stop 权限。
- P2-14 托管 workspace 回滚：Process Broker 为声明范围内的 managed writer 建立持久 checkpoint，成功时接受，失败、取消或超时时带 fence 恢复，并显式区分 `full`、`partial` 与 `none` 覆盖。
- Checkpoint restore saga：direct/timeline restore 绑定 workspace prestate、生命周期锁、Git/copy 不可变目标、安全 checkpoint 与 hash-chained CAS journal；`cc checkpoint recovery list|show|abort|resume|rollback|release` 只对验证通过的恢复状态开放。
- P2-16 Agent Teams：`cc team run` 使用本地 schema v6 authority；`cc team queue` 使用独立 queue schema v1、fenced lease、四维预算与共享可信本地文件系统协调，恢复和不明确副作用进入显式裁决。
- `cc session export <id>`：默认扫描并脱敏会话中的 API Key、JWT、连接串等秘密；只有显式 `--no-redact` 才保留原文。
- `CHAINLESSCHAIN_HOME=<dir>`：把配置、会话、状态、日志和缓存统一隔离到指定目录，适合 CI、多项目或便携部署。

## 系统架构

```text
cc
 ├─ lazy command dispatch (manifest + help/alias)
 ├─ agent runtime (foreground / background)
 │    ├─ local attach (NDJSON/TCP)
 │    └─ canonical transcript / compaction / resource budget
 ├─ process-execution-broker
 │    ├─ platform sandbox + native attestation
 │    ├─ credential agent
 │    └─ managed workspace transaction + restore saga/recovery
 ├─ agent-team runtime
 │    ├─ local authority schema v6
 │    └─ shared-filesystem queue schema v1
 ├─ plugin runtime (policy + lifecycle + provenance)
 ├─ skill-process-broker
 │    └─ frozen host facade → process-execution-broker
 ├─ durable event / interaction journal
 ├─ MCP ws/wss + uncertain-outcome recovery authority
 ├─ bounded usage / retry attribution
 ├─ async-hook supervisor (timeout + process-tree reap)
 └─ Hooks v2 + session hooks (Setup/Notification)
```

## 关键文件

主要入口位于：

- `packages/cli/src/cli.js`：启动与注册。
- `packages/cli/src/lazy-dispatch.js`：命令延迟分发。
- `packages/cli/src/lib/background-agent-supervisor.js`：后台会话监督。
- `packages/cli/src/lib/session-host-runtime.js`、`session-resource-budget.js`：canonical host 与持久资源预算。
- `packages/cli/src/lib/process-execution-broker/`：子进程安全执行。
- `packages/cli/src/lib/checkpoint-restore-saga.js`、`checkpoint-restore-recovery*.js`：持久 restore saga、投影与恢复控制器。
- `packages/cli/src/commands/checkpoint-restore-recovery.js`：保守的 `cc checkpoint recovery` 命令面。
- `packages/cli/src/lib/mcp-call-recovery*.js`：MCP 不确定结果记录、核验与裁决。
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

Open VSX 当前公开 VS Code `0.37.38`，JetBrains Marketplace 当前公开 `0.4.76`；源码分别为 `0.37.40` / `0.4.78`。生产仍建议搭配 CLI `0.162.189`：

- 质量上下文只发送有界的测试结果、覆盖率与调试器快照，并标注新鲜度；VS Code Notebook 使用当前 notebook 的真实执行上下文。
- Installation Doctor 会同时检查 Node/Java、managed CLI 与插件 registry 离线恢复状态，不从工作区目录探测可执行文件。
- Plugin Manager 的 enable/disable、upgrade、reload、签名/SBOM 与策略来源都由 CLI runtime 执行；IDE 只在收到 `activated` 后重载会话，扩大 capability 前必须显式确认。
- Worktree Tasks 和 team/batch 协作记录显示 durable owner/session、权限、预算、生命周期与副作用摘要；team/batch 仍不暴露后台进程控制按钮。
- Team Monitor 只读观察本地 v6 或 queue v1 原始状态；takeover、managed checkpoint recovery 与 side-effect adjudication 通过解析出的 CLI 执行，并绑定精确 authority digest、lease 和 evidence fence。IDE 不直接改写权威 JSON。
- 用量视图显示真实工具耗时、观测重试与实际 provider/model 的脱敏 retry 原因。
- Sessions Workbench 只消费 CLI-owned session projection，并按 exact revision 决定 resume、attach、delivery 与 remote-control 动作；可恢复 delivery 覆盖 GitHub、Gitee、configured remote 与 manual handoff，rewind/branch timeline 绑定 session、workspace、repository head、checkpoint revision 与 manifest digest。
- VS Code `0.37.40` 源码增加编辑器内联聊天、选区上下文、流式回复和代码块复制/插入/替换；重复命令注册与 activation logger 错误已修复。该源码版本未公开发布。Open VSX `0.37.38` 虽可下载，但 tagged workflow 最终失败，不能写成完整发布门通过。

## 托管回滚与 Agent Team 边界

- `--managed-checkpoint` 只覆盖 Process Broker 管理且位于声明 workspace 范围内的 writer；未托管进程、其他本地进程与范围外路径不在保证内。
- `coverageTarget=full` 仍要求 `writerIsolation=exclusive-workspace`；Agent Team 当前 checkpoint authority 为 `partial`、`writerIsolation=unknown`、`externalSideEffects=true`。
- 网络、数据库、消息、部署、支付和其他外部系统操作不能由 workspace checkpoint 回滚；需要业务幂等键、事务日志与结果核验。
- queue v1 依赖共享可信本地文件系统和文件锁，不提供复制、仲裁、BFT 或网络分区容错。状态是未签名的可信控制面，父目录与祖先必须可信。
- 10,000 task / 64 worker 结果来自单进程内 TeamRunner 异步 worker；三平台长期 soak 使用 2 个真实 OS worker 验证跨进程 DAG、故障与恢复，不等价于 64 个分布式进程或 live-model 质量保证。

## 配置参考

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
npm i -g chainlesschain@0.162.189
chainlesschain skill sync-cli --force
chainlesschain cli-anything register <name> --force
```

## 使用示例

```bash
# 后台启动 Agent，并用返回的会话 ID 接管或查看日志
cc agent --bg -p "重构 auth 模块并补测试"
cc attach <session-id>
cc logs <session-id>

# 使用隔离运行目录验证配置与会话
CHAINLESSCHAIN_HOME=/tmp/cc-ci cc session list

# 只预览 Agent Team DAG，不执行任务
cc team plan --tasks team-shell.json --json

# 查看 checkpoint 恢复状态；执行 resume/rollback 前先核验证据
cc checkpoint recovery list --json
```

## 性能指标

当前 Runtime 不承诺跨机器固定延迟。模型响应时间取决于 provider、上下文和网络；本地性能主要受 CLI 冷启动、JSONL 会话大小、工具进程数量、Git/worktree 操作和磁盘性能影响。

| 指标/边界           | 当前口径                                                                         |
| ------------------- | -------------------------------------------------------------------------------- |
| 命令加载            | manifest + lazy dispatch，未使用命令不在启动阶段加载                             |
| TeamRunner 容量验证 | 单进程异步 worker 场景覆盖 10,000 task / 64 worker；不等价于 64 个 OS 进程       |
| 跨进程长期验证      | Linux、Windows、macOS 各使用 2 个真实 OS worker 运行 120 分钟 soak               |
| 资源预算            | token、USD、wall-clock 预算持久化并带 fencing；未知计量不会在启用 cap 时按零处理 |
| Hook 回收           | 受 timeout 管理；退出时回收已知子进程或进程树，并显式报告平台限制                |

性能回归应记录 CLI 版本、准确提交、操作系统、Node 版本、provider/model、输入规模和 sandbox 模式；不能把 fake-LLM 或单进程压力结果外推为线上模型质量或分布式吞吐保证。

## 安全考虑

- 所有前台、后台、Hook、MCP、PTY、插件和技能子进程应经统一 Process Broker；不要在生成的 handler 中直接绕过 Broker。
- 显式 `workspace-write` / `strict` sandbox 无法建立时失败闭合。配置值不等于隔离已经生效，应结合 `cc doctor` 和平台证明检查。
- secret 使用 `cc config set-secret` 或受支持的环境/OS store；普通 `config set`、argv、日志和会话导出不应用于保存明文凭据。
- 后台控制通道凭据、checkpoint authority、Team lease/fence 和恢复 evidence 都是本机能力边界，状态目录及其祖先必须可信。
- managed checkpoint 只回滚声明 workspace 内由 Broker 管理的 writer，不能撤销网络、数据库、部署、消息或支付等外部副作用。
- `cc session export` 默认脱敏；只有理解泄露风险时才使用 `--no-redact`。

更细的平台约束见“平台注意”，回滚与队列限制见“托管回滚与 Agent Team 边界”。

## 故障排查

| 症状                                             | 排查与处理                                                                                                        |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `cc` 命令或帮助与源码不一致                      | 比较 `cc --version` 与 `packages/cli/package.json`；源码运行使用 `node packages/cli/bin/chainlesschain.js --help` |
| 后台 `attach` 只能跟随日志                       | 检查 session 状态与本地控制通道；worker 已退出或通道不可用时降级为日志跟随是预期行为                              |
| strict sandbox 启动即拒绝                        | 运行 `cc doctor`，检查 Docker/bubblewrap/AppContainer 与平台证明；不要通过降低策略掩盖生产配置错误                |
| checkpoint 显示 `partial` / `none`               | 检查 writer 是否由 Broker 管理、是否位于声明 workspace，以及是否存在外部副作用                                    |
| Team task 停在 adjudication                      | 重新读取 status、authority digest、attempt 和 evidence，再显式 retry、accept 或 cancel                            |
| `Process Broker unavailable for skill execution` | 升级 CLI 后重新生成/注册技能，不要修改 handler 绕过检查                                                           |
| 会话或预算状态异常                               | 在同一 `CHAINLESSCHAIN_HOME` 下检查 session JSONL、状态日志和目录权限，避免混用多个运行目录                       |

## 测试覆盖

在发布或本地验证前，建议执行：

```bash
cd packages/cli
npm run test:unit
npm run test:integration
npm run test:e2e
```

`0.162.189` 的权威发布提交为 [`2607af0dadeb951583139942e5f2add3e95e1208`](https://github.com/chainlesschain/chainlesschain/commit/2607af0dadeb951583139942e5f2add3e95e1208)。同一 `head_sha` 的 [CLI CI](https://github.com/chainlesschain/chainlesschain/actions/runs/30586603353)、[CLI Strict Sandbox](https://github.com/chainlesschain/chainlesschain/actions/runs/30586603019)、[Agent Team 长期 soak](https://github.com/chainlesschain/chainlesschain/actions/runs/30564377629) 与 [npm 发布](https://github.com/chainlesschain/chainlesschain/actions/runs/30588174291) 均已成功。Linux、Windows、macOS 的权威矩阵必须绑定精确提交；本地结果只能补充，不能替代发布门。

## 相关文档

- [CLI 命令行工具](./cli.md)
- [后台 Agent 与 attach](./cli-background-agents.md)
- [Agent Team 用户指南](./cli-team.md)
- [CLI 安全沙箱](./cli-sandbox.md)
- [Checkpoint 与回滚](./checkpoint.md)
- [配置管理](./cli-config.md)
- [Cowork 多智能体协作](./cowork.md)
- [运行时设计核对](/design/cli-runtime-current)
