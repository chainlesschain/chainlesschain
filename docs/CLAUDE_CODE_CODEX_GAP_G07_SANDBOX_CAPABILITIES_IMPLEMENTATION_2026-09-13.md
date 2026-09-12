# Claude Code / Codex 差距优化：G07 沙箱能力矩阵实施记录

> 日期：2026-09-13（Asia/Shanghai）<br>
> 对应审计：[最新版本差距报告](./CLAUDE_CODE_CODEX_LATEST_GAP_ANALYSIS_2026-09-12.md)<br>
> 范围：为 Agent shell 的 Docker/bubblewrap 路径增加版本化能力报告、配置前失败关闭和运行后实际应用证据。本批没有实现域名级不可绕过 egress，也没有把一个平台上的探测结果外推到其他 OS。

## 1. 交付结果

新增只读入口：

```powershell
# 探测当前 Docker 后端，并以稳定 JSON 输出能力状态
cc sandbox capabilities --engine docker --mode workspace-write --json

# 只做静态组合检查，不把后端标记为“可用”或“已应用”
cc sandbox capabilities --engine docker --mode strict --no-probe --json

# 在 Linux 上检查 bubblewrap 细粒度文件策略
cc sandbox capabilities --engine bubblewrap --deny-read .secrets --json

# 明确返回 unsupported；当前代理/HTTP 代理不是不可绕过的网络边界
cc sandbox capabilities --network --allowed-domains registry.npmjs.org --json
```

主要实现：

- [Agent shell 沙箱能力评估](../packages/cli/src/lib/agent-sandbox.js)
- [沙箱命令入口](../packages/cli/src/commands/sandbox.js)
- [Agent 会话前置检查](../packages/cli/src/commands/agent.js)
- [App Server Agent Kernel 前置检查](../packages/cli/src/lib/app-server/cli-agent-kernel-adapter.js)
- [run_shell 实际应用证据](../packages/cli/src/runtime/agent-core.js)

`cc sandbox capabilities` 不启动容器或任务。默认只执行 `docker version` 或 `bwrap --version` 可用性探测；`--no-probe` 连该探测也不执行。若请求含不支持的组合或已探测后端不可用，命令保留完整 JSON/人类可读报告并返回非零状态。

## 2. requested / enforceable / applied / unsupported 合同

报告 schema 为 `chainlesschain.agent-sandbox-capabilities/v1`，包含：

| 字段          | 含义                                                                              |
| ------------- | --------------------------------------------------------------------------------- |
| `host`        | 当前 `platform`、OS `release` 和 `arch`                                           |
| `backend`     | 选定 engine、隔离层级、是否做过 availability probe 及探测结果                     |
| `requested`   | 用户配置实际提出的隔离、工作区、网络与细粒度文件能力                              |
| `enforceable` | 所选后端在当前平台具备的静态强制机制；不表示本次已有子进程执行                    |
| `applied`     | 仅当子进程已成功经后端启动时填充；只查询能力或启动失败时必须为空                  |
| `unsupported` | 后端不能兑现的请求、稳定 reason、说明及建议                                       |
| `execution`   | 是否观测过执行、是否尝试启动、是否真正启动                                        |
| `status`      | `disabled`、`ready`、`unsupported`、`unavailable`、`failed-to-start` 或 `applied` |

这里刻意把“后端理论可强制”与“本次已经应用”分开。`--no-probe` 的正常组合状态可以是 `ready`，但 `backend.available` 仍为 `null`，`applied` 仍为空。反过来，命令本身退出非零不表示隔离失败：只要子进程已经通过后端成功启动，即使任务随后以非零码退出，运行报告仍把隔离能力记为 `applied`。

## 3. 前置失败关闭

Agent CLI 与 App Server Agent Kernel 在会话启动前执行同一能力评估，再做后端 availability probe。以下组合不再等到第一条 shell 命令才暴露问题：

- 未知 Agent shell engine；
- 非 Linux 主机直接选择 bubblewrap；
- Docker 搭配 `allowRead`、`denyRead`、`allowWrite` 或 `denyWrite` 细粒度规则；
- Docker 或 bubblewrap 搭配域名 allow/deny 规则；
- bubblewrap `allowRead` 被当作排他读取边界。当前 agent-shell bwrap 会只读挂载 host root，因此该配置不能被描述成仅允许列出的读取路径。

这些情况抛出 `CONFIG_SANDBOX_CAPABILITY_UNSUPPORTED` 并携带同一份 capability report。现有后端不可用检查继续使用 `failIfUnavailable` 合同；能力不支持与二进制/daemon 不可用是两个不同状态。

实际 `run_shell` 结果新增 `sandboxCapabilities`。只有 spawn 已成功交给 Docker/bubblewrap 时，`execution.started=true` 且 `applied` 非空；ENOENT、daemon 错误和策略前置拒绝都不会产生应用声明。

## 4. 当前可用组合

| Agent shell 后端 | 当前可报告的强制能力                                               | 明确不支持                                                        |
| ---------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------- |
| Docker           | 容器边界、工作区读写 bind mount、`--network none` 或非受控默认网络 | 细粒度文件 allow/deny；域名级受控联网                             |
| bubblewrap/Linux | namespace 隔离、工作区读写、整网禁用/共享、附加写、拒绝读/写 mount | 域名级受控联网；将 `allowRead` 解释为排他的 host 读取边界         |
| bubblewrap/其他  | 无                                                                 | 当前组合整体不支持；报告主机 OS 版本和架构，不外推 Linux 测试结果 |

`ProcessExecutionBroker` 仍有 macOS Seatbelt、Windows Job Object/AppContainer 与窄 Linux attested bwrap 路径；它们按具体 command、stdio、执行合同和 required boundaries 生成真实 plan。这个新命令审计的是 Agent shell 的 Docker/bubblewrap 配置，不把另一条进程代理路径压缩成静态“全平台支持”标记。

## 5. 本地验证

| 检查                                                             | 结果                                                                  |
| ---------------------------------------------------------------- | --------------------------------------------------------------------- |
| Agent sandbox、能力命令、远程 shell 授权与后台 worktree 聚焦回归 | 4 files，63 passed                                                    |
| 命令生命周期/help 与既有 sandbox policy 回归                     | 4 files，153 passed                                                   |
| Windows 真实 CLI `sandbox capabilities --no-probe --json`        | 正常输出 host/backend/requested/enforceable；`applied=[]`             |
| Windows 真实 CLI 不支持组合                                      | 输出 `unsupported` 与稳定 reason，保留报告并以非零状态退出            |
| 目标 ESLint                                                      | 0 errors/warnings                                                     |
| 生成物                                                           | command manifest、help index、shell completions、CLI reference 无漂移 |

单元测试覆盖 ready、unsupported、unavailable、非 Linux bubblewrap、Docker 细粒度文件规则、域名策略、执行启动成功与启动失败。bubblewrap 构造测试通过注入的 Linux host 探针运行，不宣称当前 Windows 主机安装或执行了真实 bwrap。

## 6. 保留边界

- 本批没有交付不可绕过的域名 egress，所以尚不能执行域名、IP 直连、DNS、重定向、清空代理环境和子进程逃逸的完整受控联网验收矩阵。
- availability probe 只证明当前时刻二进制/daemon 对版本查询有响应，不证明后续镜像拉取、mount、namespace、Seatbelt profile 或 AppContainer 启动成功。
- 本地 Windows 输出不是 Linux/macOS 兼容证明；真实平台结果仍必须由对应精确提交的 CI 和 live test 给出。
- `applied` 是单次子进程成功进入后端的运行证据，不是生产发布 attestation，也不取代持久 process audit。
- macOS 新系统兼容、Windows 特殊 `detached + numeric fd stdio`、受控宿主日志转发与进程树强退仍是 G07 后续目标环境工作。

因此，G07 的“能力可见、配置前失败关闭、运行后不虚报 applied”已经落地；真正域名受控联网及所有平台/stdio 组合的实机验收仍未完成。
