# 110. Agent Platform 0.166.15 发布与运行时边界设计

> 状态：2026-09-01 核对，已发布并完成公共注册表回读
>
> - CLI 精确源码：`22db04f55974d2e5823772c4bae5e87171fa51db`
> - CLI 不可变标签：`v-npm-0-166-15`
> - IDE 精确源码：`22db04f55974d2e5823772c4bae5e87171fa51db`
> 当前 GitHub 主线：`458b342f5f11f2ee82c0e6a91ee485d4309485fb`（晚于公开制品；P2-3 经显式风险接受关闭，不继承发布授权）

## 1. 目标

本设计记录 Agent Platform `0.166.15` 的公共制品、运行时安全和后续主线边界，重点避免五类错误合并：

1. Git tag、npm/PyPI/Open VSX/JetBrains 制品与 Desktop/native 资格证据必须分别判断；
2. Context/Memory、Hooks、App Server 与 CLI rollout store 共享持久 authority，但 UI 投影不能成为 writer；
3. renderer IPC、审批、sandbox 与进程审计必须在不可用或漂移时失败闭合；
4. Windows 普通启动不依赖 Docker，显式选择的隔离模式仍不得静默降级；
5. `0.166.15` 之后的 Windows formal Graph quality 隔离、平台阈值与局部运行结果只能作为主线源码和门禁证据；P2-3 的风险接受关闭不能倒灌进已发布 tarball，也不能把失败 run、未发生的最终 SHA aggregate/OIDC 改写为成功。

## 2. 发布身份矩阵

| 表面 | 源码/标签 | 公共状态 | 结论 |
| --- | --- | --- | --- |
| CLI | `v-npm-0-166-15` → `22db04f559` | npm `latest=0.166.15` | 生产推荐 |
| Context/Memory Kernel | 包版本 `0.1.0` | npm 已回读 | 公开 |
| Session Core | 包版本 `0.3.8` | npm 已回读 | 公开 |
| Agent Protocol | `0.1.7`，发布源码 `e93dc817ae` | npm 已回读 | 公开 |
| TypeScript Agent SDK | `0.2.7`，发布源码 `e93dc817ae` | npm 已回读 | 公开 |
| Python Agent SDK | `python-agent-sdk-v0.2.7` → `e93dc817ae` | PyPI `0.2.7` 已回读 | 公开 |
| VS Code | `ide-vscode-v0.37.77` → `22db04f559` | Open VSX `0.37.77` 已回读 | 公开 |
| JetBrains | `ide-jetbrains-v0.4.107` → `22db04f559` | Marketplace `0.4.107` 已回读 | 公开 |
| Microsoft VS Code Marketplace | 同一扩展候选 | 未发现 `0.37.77` 公共记录 | 不作为安装渠道 |
| Desktop/native | 仓库源码与 exact-SHA qualification | 资格门成功 | 不等于公共安装包发行 |
| GitHub `main` | `458b342f5f` | P2-3 风险接受记录已合入；未完成独立发布闭环 | 源码候选，不是新公共版本 |
| 本地功能分支 | 本轮冻结 `233e1bdc`（晚于 GitHub `main`） | 未合并、未发布；不是永久 current-head 声明 | source-only 合同快照，不继承任何制品或门禁授权 |

所有安装口径以公共 registry/Marketplace 实际回读为准。Git tag、构建成功、上传成功或同仓库版本号都不能单独推导“用户已经可以安装”。

## 3. 运行时分层

```text
Canonical authority
  ├─ Graph event/snapshot + revision/lease/fence
  ├─ Context/Memory budget + compaction + purge receipt
  ├─ rollout store + migration/recovery/corruption handling
  └─ Hooks v2 trust/order/timeout/audit decision

Execution boundary
  ├─ fixed renderer/main IPC capability manifest
  ├─ approval policy + durable redacted process admission
  ├─ workspace-write / strict sandbox
  └─ Process Broker + credential transport

Product projection
  ├─ Desktop / Web / Android / iOS
  └─ VS Code / JetBrains

Release evidence
  ├─ CLI CI + Strict Sandbox + npm provenance/readback
  ├─ Record Replay UI Journey
  ├─ Desktop Signed Skill Qualification
  └─ IDE host matrices + Marketplace readback
```

上层投影只能消费带 revision、attempt、operation、lease/fence 或 evidence digest 的数据并提交决定，不能从按钮状态、Webview 缓存、环境变量或本地时间重建 authority。

## 4. Context/Memory、rollout store 与 Hooks v2

`0.166.12` 的平台收敛由公开 `0.166.14` 首次完整承接，并继续包含在当前 `0.166.15`：

- `@chainlesschain/context-memory-kernel@0.1.0` 提供确定性预算分配、compaction、memory reducer、inventory 校验和跨端 conformance；
- CLI context、hierarchical memory、App Server、WebSocket、REPL 与 session flow 通过持久 authority stage，legacy writer 被 write guard fencing；
- App Server、WebSocket 和 CLI 入口使用有界 memory/JSON/SQLite rollout store，显式处理选择、迁移、恢复与损坏；
- Hooks v2 统一 CLI、REPL、headless、settings、plugins 与 App Server 的信任、排序、审计重放、超时监督和失败闭合决定语义；
- Protocol/SDK/IDE 只投影有界 Context/Memory 消息，不获得独立写 authority。

持久 store 写入失败、损坏或 authority 不匹配时必须停止 mutation。不能以“内存中已经成功”覆盖持久结算失败。

## 5. P0 执行安全收口

`0.166.13` 与 Session Core `0.3.8` 修复以下边界：

- Desktop preload 使用固定 renderer/main capability manifest，移除环境控制的 generic bridge bypass；生成清单与代码漂移时构建失败；
- CLI 默认使用禁网 `workspace-write`，审批 gate 不存在、策略加载失败或审批持久化失败时拒绝 shell；
- 高风险进程创建前必须先提交持久、脱敏的 admission record；记录 actor、session、authorization、policy、sandbox 与有界结果上下文；
- Session Core 的 approval gate 和 file adapter 在 binding、持久化或恢复不确定时失败闭合；
- 凭据不进入 prompt、普通 stdout 或未脱敏审计，只有 host-owned Broker 在核验后的进程边界恢复。

安全关闭不等于所有 Desktop/native 制品已经公共发行；它只描述对应源码与已通过的精确门禁。

## 6. Windows Docker-optional 启动

`0.166.14` 将普通 Agent 会话与容器隔离选择解耦，当前 `0.166.15` 继续保持该边界：

- 没有 CLI flag、settings 或 managed policy 明确选择容器隔离时，不探测也不要求 Docker；
- Windows 裸命令按 `PATHEXT` 解析可执行文件，避免 Docker Desktop 的 POSIX `docker` 脚本遮蔽 `docker.exe` 并触发错误 193；
- `workspace-write`、`strict` 或 managed sandbox 明确要求隔离时，缺少引擎仍拒绝启动，不回退到无隔离执行。

这里的“Docker optional”只描述默认普通启动；不能扩写为显式 sandbox 要求也可忽略。

## 7. Graph、Team 与终态证据

公开 `0.166.15` 继续承接 `0.166.9` 的 Graph history、definition migration/retirement、HumanTask quorum、Team fairness、temporal message custody 与 single-winner settlement。成功必须绑定 immutable output、Artifact、commit 或 test receipt，不能只看状态字符串。

`0.166.15` 发布提交还纳入：

- worktree cleanup/result 保留 commit 与 output digest，供 canonical Team task 结算；
- `cc team` 在状态写入时持久化 canonical Graph trace projection，而不是仅在进程内生成；
- formal quality candidate 绑定独立 worktree、GraphRun identity、projection digest、消息可见率、handoff 完成率和 unrelated-change evidence；
- control/candidate 共用冻结的 hermetic 文件工具上限，允许 read/list/search/write/edit 与 hashed edit，但不开放 shell、网络、Git、MCP、插件、IDE 或子 Agent 工具；
- 失败的质量评测仍保留有界证据，soak 可以达到正式持续时长。

发布后的 `458b342f5f` 主线包含 Windows Agent 独立 HOME/config/cache/ACL helper 工作目录、瞬态审计读取重试、CI 清理稳定性、最终 Windows `1.65` 平台时延比上限和 P2-3 风险接受记录。这些后续变化不在 `v-npm-0-166-15` tarball 中。

## 8. 正式 Graph 协作质量评测边界

主线 formal profile 固定至少 1,800 秒、至少 3 轮和 6 个任务，比较 single-agent control 与 Graph candidate 的通过率、行为等价、无关改动、死锁/对账、消息/handoff、token、时延和成本。

评测运行时还必须满足：

1. `CHAINLESSCHAIN_HOME` 位于 OS 临时目录，launcher marker 与 provider 绑定精确匹配；
2. control/candidate 使用隔离 workspace，candidate 并发 Agent 使用独立 worktree；
3. 工具面收窄为任务文件的 `read_file/search_files/list_dir/write_file/edit_file/edit_file_hashed`，评测提示不要求额外 shell 验证；
4. Windows 先执行 ACL/secure-file preflight，环境不能满足时失败闭合；
5. shell timeout 有最低值，不能因用户设置过短而制造假阴性；
6. provider 凭据只注入 P2 quality cell，不进入 P1 control 或通用 workflow 环境；
7. 三平台 evidence 必须绑定 exact SHA、challenge、task population 和 domain-separated digest，缺平台或阈值失败不生成通过结论；
8. 当前主线按报告平台冻结阈值：Windows candidate/control latency ratio 上限为 `1.65`，Linux、macOS 与 aggregate 为 `1.5`；报告携带错误平台阈值时验证失败。

这是一条生产发布前质量门，不是用户命令成功率 SLA，也不是 `0.166.15` 已完成的质量认证。固定 SHA `db53dc2da4` 的正式 run [`33411796790`](https://github.com/chainlesschain/chainlesschain/actions/runs/33411796790) 中，Linux、macOS 与三平台全部功能/安全指标通过；Windows unrelated-change rate 为 `0`，但当时以 `1.6379980224 > 1.6` 失败，workflow 因而没有成功 aggregate 或 OIDC attestation。最终提交 `917d18b055` 把 Windows 上限调整为 `1.65`，离线加权三平台 ratio 为 `0.6008293973 < 1.5`。发布负责人显式接受“不再为纯阈值变更消耗真实模型预算、最终 SHA 无成功 aggregate/OIDC”的剩余风险并关闭 P2-3；该决定不改变 run 状态、不属于 `0.166.15`，也不构成未来发布的通用豁免。

## 9. IDE 与公共渠道

VS Code `0.37.77` 和 JetBrains `0.4.107` 在同一源码提交 `22db04f559` 上把推荐 CLI 对齐到 `0.166.15`。Open VSX 与 JetBrains Marketplace 均已完成正式发布和公共回读。

IDE 继续只提交宿主已审阅决定并消费 CLI-owned projection。Marketplace 公共可见不改变 CLI writer、消息 custody 或 grant authority。Microsoft VS Code Marketplace 未公开该扩展时，stock VS Code 用户仍从 Open VSX 下载 VSIX 并使用 “Install from VSIX”。

## 10. 公共与源码边界

- `0.166.15/0.37.77/0.4.107@22db04f559` 分别只授权与各自 tag、包字节和通过门禁匹配的制品；共用源码 SHA 不表示 npm、VSIX 与 JetBrains ZIP 是同一种制品；
- `458b342f5f` 的 Windows formal quality 隔离、审计重试、`1.65` 平台阈值和 P2-3 风险接受记录不倒灌进 `0.166.15`；
- `0.166.14@ee88125256` 的 Record & Replay 与 Desktop Signed Skill 门继续保留自己的 exact-SHA 证据身份，后继版本不能改写；
- 当前源码的后继 Desktop Signed Skill producer 仅接受受保护 `main` 当前 head，拒绝普通分支与 tag；这项触发面收紧没有重写 `ee88125256` 的历史成功证据，也不等于公共 native 分发；
- npm CLI 包不包含 Electron Desktop 字节；
- Desktop qualification 不是公共 native fresh-install/upgrade/rollback 完成证明；
- 前序 soak、Graph rollout 或真实 provider 结果只为对应 exact SHA 和环境提供证据。

### 10.1 本地 Skill evolution 与 fresh-main 外部证据边界

`233e1bdc3afd031505d7c96964a08b0a7aa8e1fc` 是本轮核对冻结的本地功能分支快照，不是永久 current-head 声明，也不是 GitHub `main@458b342f5f`、release candidate 或 `0.166.15` 后继版本。它保留 `b8490faa` 的 evidence projector、`d073bdf3` 的 EvolutionLedger，并新增 mutation transition subject binding；相关能力必须分成“仓库合同”和“外部验收”两层：

| 范围 | 本地仓库合同 | 尚缺的权威证据 | 状态 |
| --- | --- | --- | --- |
| Skill evolution | candidate-only synthesis/improvement/create/import、writer inventory、host-owned mutation authority、崩溃安全 promotion/release registry、`b8490faa` attested evidence projection、`d073bdf3` tamper-evident EvolutionLedger、`233e1bdc` transition-subject binding | 统一 CLI/Desktop 生产实例化、真实 approval/candidate store、端到端恢复旅程与 final exact-SHA 正式验收 | source-only，未发布 |
| P1-10 外部 conformance | 六物理 host registry、强 containment、签名原始事件与 bounded GitHub API、fresh-main exact-attempt close | 实名部署六台 host、attester/harness/input pins、真实 1,800 秒 producer、aggregate/OIDC 与 close receipt | 部分完成 |
| P1-11 签名 Desktop Skill | producer/aggregate 限制到 live protected `main`、exact run/attempt 和固定 workflow | v2 凭据、当前 head 三平台签名安装/packaged journey、aggregate/OIDC 及公共 fresh install/upgrade/rollback | 部分完成 |
| P1-12 Graph production | authenticated 三源 registry/collector、protected input freeze、host receipt、stale-main 拒绝与 exact artifact/certificate close | 登记真实 source/observer trust root、五 surface staged rollout/rollback、旧 writer 观察、生产 aggregate/OIDC close | 部分完成 |

Candidate、projection、ledger 或测试 fixture 都不能成为 active Skill writer。Mutation 和 promotion 只能由 host-owned authority 在精确 candidate、approval、expected active identity、transition subject、journal/CAS 与 recovery receipt 全部匹配时推进；缺少任一端口或绑定必须失败闭合。`d073bdf3` 的 EvolutionLedger 以签名 append-only segment/HEAD、独立 witness、artifact resolver 和 receipt/query/verify 对篡改、回滚、并发与恢复失败闭合，但没有任何 production import/实例化；`233e1bdc` 只加固 transition subject 绑定。目前这些 evolution 类没有统一生产 wiring/正式验收，不得描述为会自动改写或自动升级 active Skill。

验证记录也必须区分范围并绑定明确快照：EvolutionLedger 定向 Vitest 共 35 项，本机为 34 pass、1 个默认 5 秒 timeout，首项实际约 `18.848s`、整套约 `128.9s`；`233e1bdc` 工作树的另一次六治理文件定向回归为 6/6 files、126/126 tests 通过，耗时 `28.84s`。两组结果不能合并计数；后者全绿也只证明本地治理合同回归，不是 production wiring、qualification、发布授权或 P1 关闭。

## 11. 关键实现

- `packages/cli/src/lib/context-memory/**`
- `packages/cli/src/lib/formal-quality-eval-runtime.js`
- `packages/cli/src/lib/graph-kernel/**`
- `packages/cli/src/lib/agent-team/team-graph-runtime-adapter.js`
- `packages/cli/src/lib/agent-team/team-worktree.js`
- `packages/cli/src/lib/process-execution-broker/**`
- `packages/cli/src/lib/evolution/skill-candidate-registry.js`
- `packages/cli/src/lib/evolution/skill-mutation-authority.js`
- `packages/cli/src/lib/evolution/skill-promotion-controller.js`
- `packages/cli/src/lib/evolution/skill-release-registry.js`
- `packages/cli/src/lib/evolution/evolution-evidence-projector.js`
- `packages/cli/src/lib/evolution/evolution-ledger.js`
- `packages/cli/src/runtime/headless-runner.js`
- `packages/cli/scripts/graph-collaboration-quality-eval.mjs`
- `packages/cli/scripts/graph-collaboration-quality-runtime-preflight.mjs`
- `desktop-app-vue/src/preload/renderer-ipc-capabilities.json`
- `desktop-app-vue/scripts/create-signed-desktop-skill-evidence.mjs`

## 12. 权威验证记录

| 证据 | 精确提交 | GitHub Actions run | 状态 |
| --- | --- | --- | --- |
| CLI CI（Linux/Windows/macOS） | `22db04f559` | 最终发布审计已核对 | 成功 |
| CLI Strict Sandbox（三平台） | `22db04f559` | 最终发布审计已核对 | 成功 |
| npm OIDC 发布 | `22db04f559` | `33393380607` | 成功 |
| npm 公网字节与 provenance 复核 | `22db04f559` | `33395435618` | 成功 |
| VS Code 发布与 Open VSX 回读 | `22db04f559` | `33393387965` | 成功 |
| JetBrains 发布与 Marketplace 回读 | `22db04f559` | `33393394812` | 成功 |
| Record Replay UI Journey（前序证据） | `ee88125256` | `33330041069` | 成功 |
| Desktop Signed Skill Qualification（前序证据） | `ee88125256` | `33322714737` | 成功 |
| Formal Graph quality（P2-3 风险接受依据） | `db53dc2da4` / final policy `917d18b055` | `33411796790` | run 失败；P2-3 经显式风险接受关闭 |

后续版本必须在自己的 final exact SHA 上重新完成适用矩阵。当前主线和未来提交不能引用本表为新制品提供发布授权。

本表没有 `233e1bdc` 的发布或 qualification 成功记录；`b8490faa` 与 `d073bdf3` 仍分别只标识 evidence projector 和 EvolutionLedger 的具体实现提交。上述 source-only 合同以及 P1-10/P1-11/P1-12 的 fresh-main 校验均不构成新的发布或生产关闭证据。
