# Agent Platform 0.166.14 发布与升级指南

## 概述

Agent Platform `0.166.14` 是 2026-08-31 的完整门禁生产推荐版与 npm `latest`。不可变 tag `v-npm-0-166-14` 指向精确提交 [`ee88125256`](https://github.com/chainlesschain/chainlesschain/commit/ee88125256b5de8281be0a8e57157811bb80c105)。

当前公开组合：

| 组件 | 公开版本 | 获取渠道 |
| --- | --- | --- |
| CLI | `0.166.14` | npm |
| Context/Memory Kernel | `0.1.0` | npm |
| Session Core | `0.3.8` | npm |
| Agent Protocol | `0.1.7` | npm |
| TypeScript Agent SDK | `0.2.7` | npm |
| Python Agent SDK | `0.2.7` | PyPI |
| VS Code IDE Bridge | `0.37.76` | Open VSX |
| JetBrains IDE Bridge | `0.4.106` | JetBrains Marketplace |
| Personal Data Hub | `0.4.59` | npm |

Open VSX `0.37.76` 已公开并累计超过 3.3 万下载；JetBrains `0.4.106` 已由 Marketplace API 回读为 approved/listed。Microsoft VS Code Marketplace 尚未公开该扩展，stock VS Code 用户应从 Open VSX 下载 VSIX。

## 核心特性

- **Context/Memory Kernel**：统一预算分配、compaction、memory reducer、inventory 校验和跨端 conformance；CLI、App Server、WebSocket、REPL 与 session flow 使用耐久 authority stage。
- **rollout store 与 Hooks v2**：有界 memory/JSON/SQLite store 显式处理迁移、恢复和损坏；Hooks 在 CLI、headless、settings、plugin 与 App Server 之间统一信任、排序、超时、审计重放和失败闭合决定。
- **P0 执行安全**：固定 renderer/main IPC capability manifest；默认禁网 `workspace-write`；审批或策略持久化不可用时拒绝 shell；高风险进程启动前必须形成持久、脱敏的 admission record。
- **Windows 无 Docker 启动**：普通 Agent 会话不再探测或要求 Docker；裸命令按 `PATHEXT` 解析，避免 POSIX shim 遮蔽 `docker.exe`。显式 `workspace-write`、`strict` 或 managed sandbox 仍在引擎不可用时拒绝启动。
- **受治理 Record & Replay**：已审阅草稿可执行 `observe/click/type/select/assert`，完成 review、enable/revoke、export/import、delete 与审计生命周期；回放默认拒绝文件、HTTP(S) 和 WebSocket。
- **Graph 与 Team**：继续提供耐久 history、definition migration/retirement、HumanTask quorum、Team fairness、temporal messaging 与 single-winner approval settlement。

## 系统架构

```text
CLI / Desktop / VS Code / JetBrains / Agent SDK
                         │
                         ▼
             Agent Protocol + App Server
                         │
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
    Agent Kernel    Graph Kernel   Context/Memory Kernel
          │              │              │
          └──────────────┴──────────────┘
                         ▼
       policy / approval / sandbox / durable audit
```

CLI 拥有执行、Graph、Session 与 Context/Memory 的权威状态；Desktop 和 IDE 负责提交有界意图与展示只读投影。SDK 只使用 Agent Protocol 的固定契约，不获得绕过宿主策略的写权限。

## 安装与升级

### CLI

```bash
npm install --global chainlesschain@0.166.14 --registry https://registry.npmjs.org
cc --version
```

预期输出版本为 `0.166.14`。

### SDK 与协议

```bash
npm install @chainlesschain/agent-sdk@0.2.7
npm install @chainlesschain/agent-protocol@0.1.7
python -m pip install chainlesschain-agent-sdk==0.2.7
```

### IDE

- Open VSX：安装 `chainlesschain.chainlesschain-ide@0.37.76`。
- 官方 VS Code：下载 [0.37.76 VSIX](https://open-vsx.org/api/chainlesschain/chainlesschain-ide/0.37.76/file/chainlesschain.chainlesschain-ide-0.37.76.vsix)，运行 **Extensions: Install from VSIX...**。
- JetBrains 2024.2+：在 Marketplace 搜索 **ChainlessChain IDE**，安装 `0.4.106`。

IDE 只提交宿主已审阅决定并消费 CLI-owned projection，不直接写 Graph、Session、Context/Memory 或 approval authority。

## 配置参考

| 目标 | 配置或命令 | 当前边界 |
| --- | --- | --- |
| 普通本地 Agent | `cc agent` | 默认禁网 `workspace-write`，不探测 Docker |
| 显式容器隔离 | CLI flag、settings 或 managed policy | 引擎不可用时失败闭合 |
| 版本确认 | `cc --version` | 生产推荐应为 `0.166.14` |
| CLI 帮助 | `cc <command> --help` | 以当前安装包输出为准 |
| IDE 安装 | Open VSX VSIX / JetBrains Marketplace | VS Code `0.37.76`；JetBrains `0.4.106` |
| 更新检查 | `npm view chainlesschain version` | 应从官方 npm registry 回读 |

## 安全考虑

- 默认 sandbox 为禁网 `workspace-write`；显式严格隔离不可用时失败闭合。
- approval gate 缺失、policy 加载失败或授权持久化失败时，shell 不会继续执行。
- 高风险 process admission 必须先持久化脱敏记录；凭据不进入 prompt、普通 stdout 或未脱敏审计。
- Record & Replay receipt 不保存 selector、输入值、页面正文、URL 或截图本体，只保存 domain-separated digest 与有界结构元数据。
- grant 只复用请求携带的 exact capability、scope、binding 与有效期，UI 不能扩权。
- npm CLI 包不包含 Electron Desktop 字节；Desktop qualification 也不等于公共 native 分发完成。

## Windows 与 Docker

普通用法不需要 Docker：

```powershell
cc agent -p "解释当前项目结构"
```

只有显式选择容器/严格隔离时才要求对应引擎。如果此时环境不满足，CLI 会拒绝启动，不会静默切到无隔离执行。

遇到 `CreateProcessAsUser error 193` 时先确认版本：

```powershell
cc --version
Get-Command docker.exe -ErrorAction SilentlyContinue
```

`0.166.14` 已避免 Docker Desktop 的 POSIX `docker` 脚本遮蔽 `docker.exe`。

## 性能指标

本次补丁不新增统一的模型延迟或吞吐承诺。Graph/Team 正式质量评测在后续 `main` 源码中使用至少 30 分钟、至少 3 轮的 hermetic profile，并限制 candidate/control token 比不高于 `2.5`、延迟比不高于 `1.5`；这些是 source-only 门禁阈值，不是 `0.166.14` 的公开运行时 SLO。

## 测试覆盖

公开 CLI 与 IDE 分别在自己的精确提交上完成三平台门禁；本地测试只作补充，不能替代下列 GitHub Actions 与公共注册表回读。

### 发布证据

精确 SHA `ee88125256b5de8281be0a8e57157811bb80c105` 的公共门：

| 门禁 | GitHub Actions run | 状态 |
| --- | --- | --- |
| CLI CI（Linux/Windows/macOS） | [`33322714911`](https://github.com/chainlesschain/chainlesschain/actions/runs/33322714911) | 成功 |
| CLI Strict Sandbox（三平台） | [`33322714747`](https://github.com/chainlesschain/chainlesschain/actions/runs/33322714747) | 成功 |
| npm 发布、provenance 与公网回读 | [`33322714744`](https://github.com/chainlesschain/chainlesschain/actions/runs/33322714744) | 成功 |
| Record Replay UI Journey | [`33330041069`](https://github.com/chainlesschain/chainlesschain/actions/runs/33330041069) | 成功 |
| Desktop Signed Skill Qualification | [`33322714737`](https://github.com/chainlesschain/chainlesschain/actions/runs/33322714737) | 成功 |

IDE 使用独立发布 SHA `0f0b9f7c8c6c59556fdf29bd8c4c15cd704b0653`：

| 门禁 | GitHub Actions run | 状态 |
| --- | --- | --- |
| VS Code host matrix、发布与 Open VSX 回读 | [`33327049581`](https://github.com/chainlesschain/chainlesschain/actions/runs/33327049581) | 成功 |
| JetBrains 三平台真实宿主、发布与 Marketplace 回读 | [`33327049302`](https://github.com/chainlesschain/chainlesschain/actions/runs/33327049302) | 成功 |

任何后续提交都必须在自己的 exact SHA 上重新跑适用门禁，不能继承上表结论。

## 最新源码与已发布版本的边界

2026-08-31 文档核对时，GitHub `main` 为 `0761d4d2976c0ff7ccafc469fe877e685812c456`，晚于 `0.166.14` 发布提交。主线新增：

- Team worktree commit/output terminal evidence；
- canonical Graph trace 随 Team state 持久化；
- 正式 Graph 协作质量评测的 hermetic home、Windows ACL preflight、收窄文件工具、timeout 下限和 P2 provider 凭据隔离。
- formal eval producer digest 与当前评测 fixture 对齐。

这些是源码和发布门增量，不在 `chainlesschain@0.166.14` tarball 中。需要这些变化时应等待它们形成新的不可变版本并完成独立发布回读。

## 故障排查

**npm 镜像返回 E404**：显式使用官方 registry：

```bash
npm install --global chainlesschain@0.166.14 --registry https://registry.npmjs.org
```

**官方 VS Code 搜不到扩展**：Microsoft Marketplace 尚未公开；从 Open VSX 下载 `0.37.76` VSIX 并使用 “Install from VSIX”。

**JetBrains 仍显示旧版**：刷新 Marketplace 索引并确认 IDE 至少为 2024.2；公共目标版本是 `0.4.106`。

**普通启动仍检查 Docker**：先确认 `cc --version` 为 `0.166.14`，再检查 CLI flag、settings 或 managed policy 是否显式选择容器隔离。

**UI 回放报告缺少页面内容**：这是隐私设计。报告只提供 digest 和结构状态；需要人工诊断时应在受控环境重新执行并直接观察页面。

## 关键文件

| 文件 | 作用 |
| --- | --- |
| `packages/cli/package.json` | CLI 公开版本与打包入口 |
| `packages/context-memory-kernel/` | canonical Context/Memory 契约与 runtime |
| `packages/agent-protocol/` | 跨端协议 Schema 与生成物 |
| `packages/cli/src/lib/process-execution-broker/` | 高风险进程 admission、sandbox 与审计边界 |
| `desktop-app-vue/src/preload/renderer-ipc-capabilities.json` | renderer/main 固定 IPC 能力清单 |
| `.github/workflows/cli-ci.yml` | CLI 三平台发布门 |
| `.github/workflows/cli-strict-sandbox.yml` | 严格沙箱三平台门 |
| `docs/design/modules/110-agent-platform-release-boundaries.md` | 公开制品与后续主线的设计边界 |

## 使用示例

确认公共版本：

```bash
cc --version
npm view chainlesschain version
npm view @chainlesschain/agent-sdk version
npm view @chainlesschain/agent-protocol version
python -c "import chainlesschain_agent_sdk as sdk; print(sdk.__version__)"
```

预期依次为 `0.166.14`、`0.166.14`、`0.2.7`、`0.1.7` 与 `0.2.7`。

## 相关文档

- [CLI Runtime 当前实现](/chainlesschain/cli-runtime-current)
- [Graph Kernel 使用与运维](/chainlesschain/cli-graph-kernel)
- [GraphRun 观测与评估](/chainlesschain/cli-team-graph)
- [Record & Replay → Skill](/chainlesschain/record-replay-skill)
- [Context/Memory Kernel](/chainlesschain/context-memory)
- [Agent SDK](/chainlesschain/agent-sdk)
- [Agent Protocol](/chainlesschain/agent-protocol)
- [IDE 插件完整指南](/chainlesschain/ide-plugin)
- [设计文档：Agent Platform 发布与运行时边界](/design/modules/110-agent-platform-release-boundaries)
