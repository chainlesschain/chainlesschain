# CLI Runtime 当前实现（0.162.198）

> 更新时间：2026-08-07。npm `latest` 与生产推荐基线当前均为 `0.162.198`。当前源码包元数据仍为 `0.162.198`，但 HEAD 已含发布后的可靠性加固；稳定能力以 `v-npm-0-162-198` 的精确 SHA 为准。该 SHA 的 CLI CI、CLI Strict Sandbox、专用发布、不可变制品、SBOM 与 provenance 已完成核验；后续版本仍不能只凭 registry 或 package.json 版本号判断发布权威。

## 概述

本文是当前 CLI 运行时的实现快照，适合部署、排障和集成方阅读。设计取舍详见[运行时设计核对](/design/cli-runtime-current)。

## 安装版本怎么选

| 用途                | 版本        | 说明                                                                                                                        |
| ------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------- |
| 生产 / 日常稳定使用 | `0.162.198` | `v-npm-0-162-198` 的同一 exact SHA 已完成 Linux、Windows、macOS CLI CI、Strict Sandbox、不可变制品、SBOM、provenance 与发布 |
| npm `latest`        | `0.162.198` | registry、tag、attestation、tarball bytes 与授权 workflow 已交叉回读                                                        |
| 源码开发 / 调试     | `0.162.198` | 包元数据与公开版相同，但 HEAD 含发布后加固；运行时能力仍以发布 SHA 为稳定契约                                               |

生产安装建议显式固定：

```bash
npm i -g chainlesschain@0.162.198
```

已安装 `0.162.198` 的用户就是当前生产推荐版。`0.162.197` 是上一完整门禁基线；`0.162.193` 是已被正式版本取代的历史非权威记录，失败的 `0.162.194`、`0.162.195`、`0.162.196` tag 保持不可变，不移动或复用。

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
- `0.162.198` 交互可靠性：REPL、headless streaming、provider pacing 与 TTY writer 在输出饱和时等待 drain，并在完成、中断和会话切换时清理监听器；canonical session action/reply route 支持公开 IDE Workbench 与 rewind journey。
- 发布后源码加固：session host lease 与 anti-rollback witness、持久化失败分类和有界 cleanup、未受信 MCP 副作用审批、MCP 可执行身份 trust generation 与 npm 依赖闭包固定、POSIX/Windows installer/OTA 代际恢复和跨平台 reliability soak 已进入 HEAD，但尚未由新版本的 exact-SHA 发布门授权。
- 跨平台 sandbox 与 credential agent：前台、后台、hook、MCP、monitor、LSP、PTY 和插件 bin 都通过统一 broker 执行。
- 强执行路径补齐：插件异步/后台进程、通用后台任务、CLI PTY 与桌面项目 PTY 共用失败闭合边界；未经证明的项目根和远端 metadata 不能获得本机 PTY 权限。
- 技能执行边界：production `skill run` 不在 CLI 主进程导入生成的 `handler.js`，也不向 Skill 注入 MCP client、Process Broker 或 `child_process`；隔离 Skill 只获得与父级 ceiling 相交后的 `read_file`、`search_files`、`list_dir`。历史 `shell-exec` metadata 与 legacy handler 不产生当前运行权限。
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
 ├─ controlled Skill boundary
 │    └─ isolated child → read_file / search_files / list_dir only
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
- `packages/cli/src/lib/skill-execution-authority.js`、`skill-execution-identity.js`：Skill 执行权威、外部 owner-private 状态与身份校验。
- `packages/cli/src/lib/session-host-lease.js`、`session-anti-rollback-anchor.js`：发布后源码中的单宿主租约与会话 anti-rollback witness。
- `packages/cli/src/lib/mcp-stdio-executable-identity.js`、`mcp-stdio-package-materialization.js`：MCP 可执行信任代际与 npm 依赖闭包物化。
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

Open VSX 当前公开 VS Code `0.37.44`，JetBrains Marketplace 当前公开 `0.4.81`；IDE 源码与公开版本一致。生产建议搭配 CLI `0.162.198`：

- 质量上下文只发送有界的测试结果、覆盖率与调试器快照，并标注新鲜度；VS Code Notebook 使用当前 notebook 的真实执行上下文。
- Installation Doctor 会同时检查 Node/Java、managed CLI 与插件 registry 离线恢复状态，不从工作区目录探测可执行文件。
- Plugin Manager 的 enable/disable、upgrade、reload、签名/SBOM 与策略来源都由 CLI runtime 执行；IDE 只在收到 `activated` 后重载会话，扩大 capability 前必须显式确认。
- Worktree Tasks 和 team/batch 协作记录显示 durable owner/session、权限、预算、生命周期与副作用摘要；team/batch 仍不暴露后台进程控制按钮。
- Team Monitor 只读观察本地 v6 或 queue v1 原始状态；takeover、managed checkpoint recovery 与 side-effect adjudication 通过解析出的 CLI 执行，并绑定精确 authority digest、lease 和 evidence fence。IDE 不直接改写权威 JSON。
- 用量视图显示真实工具耗时、观测重试与实际 provider/model 的脱敏 retry 原因。
- Sessions Workbench 只消费 CLI-owned session projection，并按 exact revision 决定 resume、attach、delivery 与 remote-control 动作；可恢复 delivery 覆盖 GitHub、Gitee、configured remote 与 manual handoff，rewind/branch timeline 绑定 session、workspace、repository head、checkpoint revision 与 manifest digest。
- VS Code `0.37.44` / JetBrains `0.4.81` 公开版把 local/background/remote/team/workflow 五类 canonical session 走完 Dispatch → `needs_input` → Reply → done、artifact/PR 回读与独立 IDE 进程重启恢复；VS Code 继续提供编辑器内联聊天、选区上下文、流式回复和代码块复制/插入/替换。两个发布标签均已完成三平台真实宿主、发布与 registry 回读。

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

## Skill 执行边界

- production `skill run` 不导入 `handler.js`；非隔离 direct handler 会返回 `CC_SKILL_DIRECT_HANDLER_BLOCKED`。
- 隔离 Skill 只获得父级权限上限允许的 `read_file`、`search_files`、`list_dir`，没有 MCP client、Process Broker 或 Node.js `child_process`。
- `capabilities: [shell-exec]` 目前只是历史 descriptor/template 元数据，不产生 runtime authority；CLI-Anything、CLI Pack 与 creator 生成的 legacy handler 仅供显式迁移和检查。
- 不要通过修改 handler、恢复已删除 façade 或直接 import 来绕过边界。若未来恢复 handler 执行，必须重新证明 source/digest approval、可执行字节身份、完整进程树、固定 deadline、host-owned dispose 与三平台真实回归。

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
| `CC_SKILL_DIRECT_HANDLER_BLOCKED`                | 当前 production 不执行 direct handler；改用受支持的隔离 Skill 工具，不要修改 handler 绕过检查                    |
| 会话或预算状态异常                               | 在同一 `CHAINLESSCHAIN_HOME` 下检查 session JSONL、状态日志和目录权限，避免混用多个运行目录                       |

## 测试覆盖

在发布或本地验证前，建议执行：

```bash
cd packages/cli
npm run test:unit
npm run test:integration
npm run test:e2e
```

`0.162.198` 的权威发布提交为 [`3c0f62fa17242cfa3123ab502a9bf5d1cbed8481`](https://github.com/chainlesschain/chainlesschain/commit/3c0f62fa17242cfa3123ab502a9bf5d1cbed8481)。同一 `head_sha` 的 [CLI CI](https://github.com/chainlesschain/chainlesschain/actions/runs/31078499968)、[CLI Strict Sandbox](https://github.com/chainlesschain/chainlesschain/actions/runs/31078499270) 与 [npm 发布](https://github.com/chainlesschain/chainlesschain/actions/runs/31081337370) 均成功；发布后的 [registry/provenance 回读](https://github.com/chainlesschain/chainlesschain/actions/runs/31082366544) 进一步核对 artifact bytes、签名 provenance 与授权 workflow identity。Linux、Windows、macOS 的权威矩阵必须绑定精确提交；本地结果只能补充，不能替代发布门。

## 相关文档

- [CLI 命令行工具](./cli.md)
- [后台 Agent 与 attach](./cli-background-agents.md)
- [Agent Team 用户指南](./cli-team.md)
- [CLI 安全沙箱](./cli-sandbox.md)
- [Checkpoint 与回滚](./checkpoint.md)
- [配置管理](./cli-config.md)
- [Cowork 多智能体协作](./cowork.md)
- [运行时设计核对](/design/cli-runtime-current)
