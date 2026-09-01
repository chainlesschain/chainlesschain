# Agent Platform 0.166.16 发布与升级指南

## 概述

Agent Platform `0.166.16` 是 2026-09-02 核对的生产推荐版与 npm `latest`，不可变 tag `v-npm-0-166-16` 指向精确提交 [`15bd3636b8`](https://github.com/chainlesschain/chainlesschain/commit/15bd3636b8aa8f223a11b2eefeb206ff7dc20bb7)。该 SHA 的 Linux、Windows、macOS CLI CI、CLI Strict Sandbox、Trusted Publishing 与 npm 公共回读已完成。

当前公开组合：

| 组件 | 公开版本 | 获取渠道 |
| --- | --- | --- |
| CLI | `0.166.16` | npm |
| Context/Memory Kernel | `0.1.0` | npm |
| Session Core | `0.3.8` | npm |
| Agent Protocol | `0.1.7` | npm |
| TypeScript Agent SDK | `0.2.7` | npm |
| Python Agent SDK | `0.2.7` | PyPI |
| VS Code IDE Bridge | `0.37.78` | Open VSX |
| JetBrains IDE Bridge | `0.4.107` | JetBrains Marketplace |
| Personal Data Hub | `0.4.59` | npm |

Open VSX `0.37.78` 与 JetBrains `0.4.107` 已公开；JetBrains 源码候选 `0.4.108` 尚待 Marketplace 公共可见性确认。Microsoft VS Code Marketplace 尚未公开该扩展，stock VS Code 用户应从 Open VSX 下载 VSIX。

## 核心特性

- **受治理的 Skill 自进化基础**：自动生成、改进、Desktop Skill Creator 与跨设备导入只形成隔离 candidate 或 diff；target-matrix Eval、认证 artifact/evidence、tamper-evident ledger、mutation authority、tenant release registry 与 lease/CAS promotion 约束发布。当前不默认启用无人值守 active promotion。
- **Context/Memory Kernel**：统一预算分配、compaction、memory reducer、inventory 校验和跨端 conformance；CLI、App Server、WebSocket、REPL 与 session flow 使用耐久 authority stage。
- **rollout store 与 Hooks v2**：有界 memory/JSON/SQLite store 显式处理迁移、恢复和损坏；Hooks 在 CLI、headless、settings、plugin 与 App Server 之间统一信任、排序、超时、审计重放和失败闭合决定。
- **P0 执行安全**：固定 renderer/main IPC capability manifest；默认禁网 `workspace-write`；审批或策略持久化不可用时拒绝 shell；高风险进程启动前必须形成持久、脱敏的 admission record。
- **Windows 无 Docker 启动**：普通 Agent 会话不再探测或要求 Docker；裸命令按 `PATHEXT` 解析，避免 POSIX shim 遮蔽 `docker.exe`。显式 `workspace-write`、`strict` 或 managed sandbox 仍在引擎不可用时拒绝启动。
- **受治理 Record & Replay**：已审阅草稿可执行 `observe/click/type/select/assert`，完成 review、enable/revoke、export/import、delete 与审计生命周期；回放默认拒绝文件、HTTP(S) 和 WebSocket。
- **Graph 与 Team**：继续提供耐久 history、definition migration/retirement、HumanTask quorum、Team fairness、temporal messaging 与 single-winner approval settlement。
- **正式质量评测工具边界热修复**：control 与 Graph candidate 共用冻结的 `read_file`、`search_files`、`list_dir`、`write_file`、`edit_file`、`edit_file_hashed` 工具契约；shell、网络、Git、MCP、插件、IDE 与子 Agent 工具保持禁用，写入仍限于任务声明的精确文件。

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
npm install --global chainlesschain@0.166.16 --registry https://registry.npmjs.org
cc --version
```

预期输出版本为 `0.166.16`。

### SDK 与协议

```bash
npm install @chainlesschain/agent-sdk@0.2.7
npm install @chainlesschain/agent-protocol@0.1.7
python -m pip install chainlesschain-agent-sdk==0.2.7
```

### IDE

- Open VSX：安装 `chainlesschain.chainlesschain-ide@0.37.78`。
- 官方 VS Code：下载 [0.37.78 VSIX](https://open-vsx.org/api/chainlesschain/chainlesschain-ide/0.37.78/file/chainlesschain.chainlesschain-ide-0.37.78.vsix)，运行 **Extensions: Install from VSIX...**。
- JetBrains 2024.2+：在 Marketplace 搜索 **ChainlessChain IDE**，安装 `0.4.107`。

IDE 只提交宿主已审阅决定并消费 CLI-owned projection，不直接写 Graph、Session、Context/Memory 或 approval authority。

## 配置参考

| 目标 | 配置或命令 | 当前边界 |
| --- | --- | --- |
| 普通本地 Agent | `cc agent` | 默认禁网 `workspace-write`，不探测 Docker |
| 显式容器隔离 | CLI flag、settings 或 managed policy | 引擎不可用时失败闭合 |
| 版本确认 | `cc --version` | 生产推荐应为 `0.166.16` |
| CLI 帮助 | `cc <command> --help` | 以当前安装包输出为准 |
| IDE 安装 | Open VSX VSIX / JetBrains Marketplace | VS Code `0.37.78`；JetBrains `0.4.107` |
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

本次补丁不新增统一的模型延迟或吞吐承诺。Graph/Team 正式质量评测使用至少 30 分钟、至少 3 轮的 hermetic profile，并限制 candidate/control token 比不高于 `2.5`。发布后的 GitHub `main@458b342f5f` 把 Windows 平台时延比最终上限调整为 `1.65`，Linux、macOS 与 aggregate 仍为 `1.5`。固定 run `33411796790` 的 Windows 实测为 `1.6379980224`，离线加权 aggregate 为 `0.6008293973`；这些是 source-only 发布门阈值与证据，不是 `0.166.15` 的公开运行时 SLO。该 run 仍为失败，且没有 final-SHA aggregate success/OIDC attestation。

## 测试覆盖

公开 CLI 与 IDE 在同一精确发布提交上完成各自的三平台门禁；本地测试只作补充，不能替代 GitHub Actions 与公共注册表回读。

### 发布证据

精确 SHA `22db04f55974d2e5823772c4bae5e87171fa51db` 的公共门：

| 门禁 | GitHub Actions run | 状态 |
| --- | --- | --- |
| CLI CI（Linux/Windows/macOS） | 最终发布审计已核对同 SHA | 成功 |
| CLI Strict Sandbox（三平台） | 最终发布审计已核对同 SHA | 成功 |
| npm OIDC 发布 | [`33393380607`](https://github.com/chainlesschain/chainlesschain/actions/runs/33393380607) | 成功 |
| npm 公网字节与 provenance 独立复核 | [`33395435618`](https://github.com/chainlesschain/chainlesschain/actions/runs/33395435618) | 成功 |
| VS Code host matrix、发布与 Open VSX 回读 | [`33393387965`](https://github.com/chainlesschain/chainlesschain/actions/runs/33393387965) | 成功 |
| JetBrains 三平台真实宿主、发布与 Marketplace 回读 | [`33393394812`](https://github.com/chainlesschain/chainlesschain/actions/runs/33393394812) | 成功 |

Record & Replay UI Journey `33330041069` 与 Desktop Signed Skill Qualification `33322714737` 仍绑定前序精确提交 `ee88125256`。`0.166.15` 继承对应产品代码，但不会把前序门禁改写成自己的 exact-SHA 证据。

任何后续提交都必须在自己的 exact SHA 上重新跑适用门禁，不能继承上表结论。

## 最新源码与已发布版本的边界

2026-09-01 文档核对时，GitHub `main` 为 `458b342f5f11f2ee82c0e6a91ee485d4309485fb`，晚于 `0.166.15` 发布提交。发布后的主线新增：

- 审计 blob 瞬态读取重试与 Windows CI 清理稳定性；
- 每个 Windows 正式质量 Agent 独立的 HOME/config/cache/ACL helper 工作目录，避免候选目录污染；
- Windows 时延比最终平台上限 `1.65`，Linux、macOS 与 aggregate 保持 `1.5`；验证器拒绝报告携带错误平台阈值；
- formal eval producer digest、冻结工具契约与当前评测 fixture 对齐。

这些是源码和发布门增量，不在 `chainlesschain@0.166.15` tarball 中。固定精确提交的正式 run [`33411796790`](https://github.com/chainlesschain/chainlesschain/actions/runs/33411796790) 中，Linux、macOS 及三平台功能/安全指标通过；Windows unrelated-change rate 为 `0`，唯一失败项是当时 `1.6379980224 > 1.6` 的时延比。三平台产物离线加权 aggregate 为 `0.6008293973 < 1.5`，但 workflow run 本身仍为失败，aggregate success 与 OIDC attestation 没有发生；最终 `1.65` 阈值提交也没有 final-SHA 正式重跑。

发布负责人显式接受“不再为纯阈值变化重复消耗真实模型预算”的剩余证据风险，并据此关闭 P2-3。这是记录在案的验收豁免：不能把 run `33411796790` 改写为成功，不能归入 `0.166.15` 制品，也不能作为其他发布门跳过 final-SHA aggregate/OIDC 的通用先例。

## 故障排查

**npm 镜像返回 E404**：显式使用官方 registry：

```bash
npm install --global chainlesschain@0.166.16 --registry https://registry.npmjs.org
```

**官方 VS Code 搜不到扩展**：Microsoft Marketplace 尚未公开；从 Open VSX 下载 `0.37.78` VSIX 并使用 “Install from VSIX”。

**JetBrains 仍显示旧版**：刷新 Marketplace 索引并确认 IDE 至少为 2024.2；公共目标版本是 `0.4.107`。

**普通启动仍检查 Docker**：先确认 `cc --version` 为 `0.166.16`，再检查 CLI flag、settings 或 managed policy 是否显式选择容器隔离。

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

预期依次为 `0.166.16`、`0.166.16`、`0.2.7`、`0.1.7` 与 `0.2.7`。

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
