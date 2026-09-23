# Agent Platform 0.166.72 发布与升级指南

> 核对日期：2026-09-24。公开安装版本、源码和历史资格证据分别记录，不能相互继承发布授权。

## 概述

npm 官方 registry 的 `latest` 为 `0.166.72`，标签 `v-npm-0-166-72` 对应提交 `5f411309b261dea5d8cadb801902f7cf526e3068`。本版修复本地 Skill 决策截止的失败闭合语义，并收紧离线质量统计。TypeSafe、Laya 本地模型与兼容 System One 服务继续保持默认关闭，且仅限耐久、单 prompt、headless Agent。`shadow` 不改变既有路由，`suggest` 只附加有界建议且不执行 Skill。

普通聊天只需要有效模型配置。candidate、Eval、Workbench、知识合并和 Skill 发布仍需管理员配置受信治理宿主；已配置治理链发生验证错误时不会降级。automatic active promotion 继续保持 HOLD。

精确发布提交的 [CLI CI](https://github.com/chainlesschain/chainlesschain/actions/runs/35831862379) 和 [CLI Strict Sandbox](https://github.com/chainlesschain/chainlesschain/actions/runs/35831862038) 已通过 Linux、Windows、macOS 全部配置任务。[npm OIDC 发布](https://github.com/chainlesschain/chainlesschain/actions/runs/35844120633)与[独立公共回读](https://github.com/chainlesschain/chainlesschain/actions/runs/35848098440)成功，并验证 `latest=0.166.72`、tarball integrity、签名 provenance 与全新安装。Session Core `0.3.13`、Context/Memory Kernel `0.1.5`、Personal Data Hub `0.4.62`、Agent Protocol `0.1.11` 与 Agent SDK TS/Python `0.2.11/0.2.9` 保持独立发布身份。

CLI 制品源码边界为 `5f411309b2`。IDE 配套源码边界为 `94c4c5a634`：[Open VSX `0.37.114`](https://open-vsx.org/extension/chainlesschain/chainlesschain-ide) 与 [JetBrains `0.4.135`](https://plugins.jetbrains.com/plugin/32208-chainlesschain-ide-bridge) 均已公开并推荐 CLI `0.166.72`；JetBrains 已完成 Windows/Linux/macOS × 2024.2/2025.2 真实宿主门、上传及后续公共 API 批准/上架回读。[IDE 精确提交门](https://github.com/chainlesschain/chainlesschain/actions/runs/35852117555)、[Open VSX 发行工作流](https://github.com/chainlesschain/chainlesschain/actions/runs/35857926921)与 [JetBrains 发行工作流](https://github.com/chainlesschain/chainlesschain/actions/runs/35857955631)均成功。微软 VS Code Marketplace 因未配置 `VSCE_PAT` 仍未发行；Desktop 原生安装包由下述产品标签独立发行。

## v5.0.3.138 桌面与移动端产品发行

[GitHub Release v5.0.3.138](https://github.com/chainlesschain/chainlesschain/releases/tag/v5.0.3.138) 已公开，标签对应 `eb48ffa31139a826796f4e292135493cd93d88d0`。[产品发行工作流](https://github.com/chainlesschain/chainlesschain/actions/runs/35891791525)完成 Windows Setup/Portable、macOS Intel/Apple Silicon DMG、Linux AppImage/deb/rpm、Android release 签名的三种 APK 与 AAB，以及签名 iOS ad-hoc IPA，共 18 个资产。Windows、macOS、Linux 的公开自动更新清单已回读为 `5.0.3-alpha.138`。产品工作流还重新验证了 CLI `0.166.72` 的 npm provenance、标签及精确提交 CI 门禁，但产品标签不能替代独立 npm/IDE 发行身份。

Android 用户应从 GitHub Release 选择对应架构的 APK；AAB 仅供开发者提交 Google Play，本次没有商店上架证明。iOS IPA 通过 ad-hoc 证书导出，只能安装到 provisioning profile 已登记的设备；未通过 App Store 或 TestFlight 分发。Android 应用版本为 `5.0.3.138`，内置 `cc-cli.tgz` 仍固定到 `binariesVersion=20260711` 的内部二进制清单，不等同于独立安装的 npm CLI `0.166.72`。桌面安装包公开也不意味着生产 KMS/PKI、独立 witness/grader 或 automatic active Skill 晋升已具备。

## 0.166.72 本次增量

### 本地 Skill 决策截止与离线评测

本地决策请求达到配置的截止时间时，CLI 记录 `provider-timeout`、未知用量和观察事件，并保留原有 Skill 路由。用户取消和账本结算失败仍会终止请求。离线评测对误建议率使用单侧 95% 精确二项上界，缺少有效分母不能通过质量门。上述工程修复不等于模型效果合格，`--decision-mode` 默认仍为 `off`。

[Laya 本地真实权重联调记录](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/agents/jev-laya-local-probe-2026-09-23.md)显示，完整 CLI 请求的英文候选元数据会让短中文任务路由到英文权重；该 CPU 环境热请求约需 7–11 秒，超过默认 800 ms 截止。TypeSafe 真实 API、冻结数据集质量、目标环境延迟与费用评测仍未完成。

## 0.166.71 历史增量

### 可选择的 Skill 决策提供方

`cc agent` 支持 `--decision-provider typesafe|laya|system-one`、`--decision-mode off|shadow|suggest`、`--decision-model`、`--decision-base-url` 与 `--decision-timeout-ms`。非 `off` 模式只接受耐久、单 prompt、headless 会话，不能与 `--ephemeral`、交互 REPL 或 `--input-format stream-json` 组合。

现有 Skill 检索与准入先执行，再将最多五个已准入候选的有界摘要交给所选 `/v1/systemone` provider。`shadow` 只持久记录对照观察；`suggest` 仅附加 `routing.decisionSuggestion`，不替换原 `selectedDigest`，也不加载或执行 Skill。TypeSafe 从 `TYPESAFE_API_KEY` 或受管 credential transport 读取凭据；Laya 与通用 System One 服务需要认证时可使用 `DECISION_API_KEY`，不会读取 TypeSafe 凭据。Laya 仅接受 loopback 地址，其他提供方只接受 HTTPS 或 loopback。

当前维护环境尚未完成真实 TypeSafe API 联调，也未完成任何模型在冻结数据集上的质量、目标环境延迟或费用评测，因此默认继续为 `off`。Laya 单题本地联调只验证真实权重路径，并暴露中文路由与 CPU 截止问题。先按[Skill 决策层用户指南](/chainlesschain/jev-decision-layer)使用 `shadow` 收集证据；拟议放量门和 IDE 不扩权边界见[模块 114](/design/modules/114-jev-decision-layer-design)。

## 0.166.68 历史增量

### 浏览器动作与下载隔离

浏览器 observation、navigation、tab creation、history traversal、keyboard action 和 download 分别通过显式 action authority。只读观察授权不能自动升级为导航、按键或下载权限，恢复轮次也不能从旧结果推导新授权。

下载内容以流方式进入耐久 filesystem quarantine，不会直接落入可信工作区。隔离记录绑定来源、摘要、创建/到期时间与 custody 状态；跨进程锁、认证 retain/revoke、崩溃恢复、到期 sweep 和可审计 dispose 防止同一下载被重复裁决或在结果未知时误用。管理员应先审查并明确保留，之后再把文件移动到项目目录。

### PM 隔离与发布顺序

PM exploration runner、reviewer 与 grader 运行在有界子进程中，输入摘要、预算、egress decision、recovery snapshot、benchmark receipt 和退出状态都绑定本轮 governed execution context。该变化不把本地/合成证据升级为生产 authority，Desktop readiness 与 automatic promotion `HOLD` 不变。

发布工作流先构建确定性生成物，再逐一审计 13 个子 npm 包。源码变化但版本未递增、公共 tarball 漂移、标签/Git tree/provenance 不闭合时会在 CLI publish 前停止。本轮先发布 Session Core `0.3.13`、Context/Memory Kernel `0.1.5`、Personal Data Hub `0.4.62`，完成公共回读后再发布 CLI `0.166.68`。

精确 SHA 的完整 CLI CI 与 Strict Sandbox 可由发布标签复用，因此不重复执行整套测试；本地、部分矩阵、超时、取消或旧提交结果不能满足发布门。IDE 必须在 CLI 公共回读后发布。ARM64 failed-job rerun 聚合会按矩阵单元选择最新 attempt，同时保留其他单元在早先 attempt 的成功证据。

## 0.166.64–0.166.65 本次增量

`0.166.64` 允许恢复中的 `read_file` 对已知目标使用显式 offset 与最多 80 行的 limit，避免恢复指引要求“定位后读取”却又被全局恢复暂停拦截。它不允许重新整文件转储，也不开放未知目标。

`0.166.65` 将 `CC_TOOL_RECOVERY_PAUSED` 等合成控制结果与真实工具观察分开：暂停轮次不会推进重复文件读取、远端相同大输出或失败重试计数；下一次模型请求可按恢复建议继续。全局无进展上限与六次真实尝试上限保留，已知远端目标只能在自身较窄 guard 下继续，无关发现继续暂停。

### 0.166.63 受治理 PM 证据与恢复链

PM 场景现在具备训练分区投影、Broad 分支与 Deep 串行轮次、宿主强制 token/tool/墙钟预算，以及 execution/grader/merge/evaluator 四角色 Ed25519 回执。Volcengine adapter 以供应商返回 usage 计量并生成脱敏费用 settlement；settlement 必须经外部 durability retain/resolve 后才能进入签名 execution receipt、evidence bundle 与 PM Ledger。独立业务 grader 回读本轮新建文件或品牌化 Desktop outcome source，不接受模型自评。

Desktop outcome reader 只执行绑定 plan/environment/task、签名数据库路径与 source digest 的固定参数化 `SELECT`。每轮先核对 SQLite backup seal，成功后绑定 execution/grader receipt 与 post-run seal，失败后捕获 failure seal 并永久 taint 当前 host。窄化 transition committer 要求认证、耐久、回读确认；重启时固定 recovery 端口重建最后链头。snapshot-backed 路径先保留并精确回读成功 post-run 或失败 pre-run SQLite backup，再提交绑定快照确认的迁移。

公开 Desktop readiness 继续固定 `readyForExecution:false`、`runtimeVerified:false`、`authenticated:false`、`qualifiesForPromotion:false`。测试使用本地或合成 durability authority，不能替代生产 PKI/KMS、远端故障域、workspace snapshot、原子 restore、真实 Electron DID/RBAC PM E2E 或物理断电验收。详见[受治理 Skill 演进](/chainlesschain/governed-skill-evolution)。

Windows 运行时规范化恢复临时路径、保留存活状态锁，并对 ACL 查询/设置的瞬态超时做有界重试；调度 soak lease 改为有界窗口，避免慢平台因租约提前失效产生误报。这些可靠性修复不扩大 sandbox、promotion 或 Desktop 安装包的发布范围。

Context/Memory Kernel 将任务目标、文件证据、失败、修改、计划和压缩边界写入带 session、revision 与 digest 的权威检查点。CLI 将已验证状态投影为 `.chainlesschain/sessions/<session-id>/WORKLOG.md`；Markdown 缺失或被修改时可以重建，不能通过手工编辑获得权限或覆盖权威状态。

VS Code 标签栏 `↗` / 命令 **Continue in New Conversation with Task Notes** 与 JetBrains **Continue in new chat** 会先等待完整工具边界并保存记录，再打开独立会话。接力只传递已校验记录引用，不复制完整聊天、不继承临时权限或未完成工具；加载失败时不调用模型。使用步骤见[IDE 任务记录与新会话接力](/chainlesschain/ide-task-worklog)。

`TaskCheckpoint` 已同步到 Agent Protocol `0.1.11`、TypeScript Agent SDK `0.2.11`、Python Agent SDK `0.2.9` 及生成的 Kotlin/Swift 投影。

## 0.166.51–0.166.56 历史增量

请求级容量按实际 provider、model、endpoint 与 `contextMemoryModelWindowTokens` 覆盖解析，并让 planner、自动压缩器、会话 ledger、REPL、`cc context --json` 与 IDE 指示条复用同一上下文窗口。主指示只消费主模型调用；子 Agent 或语义压缩调用不会覆盖它。IDE 有真实请求用量时显示 input/output/cache read/cache write，没有时明确标记 transcript `estimated`。大窗口主要按 token 压力压缩，小窗口仍保留消息数保护。

Evolution 部署新增 `init-test` 和 `replace-test`，可在正式 PKI/KMS 未到位时创建明确标记的本机 TEST 环境，再用受限 root-rotation proof 原子切换为正式 descriptor/trust root。macOS 凭据目录使用实体路径，不受 `/var`/`/private/var` 别名影响。TEST 部署不提供审核、发布、witness 或 grader authority；完整命令和替换步骤见[受治理 Skill 演进](/chainlesschain/governed-skill-evolution)。

升级或固定安装：

```bash
npm i -g chainlesschain@0.166.72 --registry https://registry.npmjs.org
cc --version
cc evolution deployment status --json
```

## 2026-09-13 主分支新增能力与使用方式

以下增量已经进入 `v-npm-0-166-47` 的提交祖先链。CLI、IDE 与 Desktop 仍按各自制品验证，不能把 npm 发布证明外推到原生客户端。

| 能力           | 操作与行为                                                         | 保留边界                                                                        |
| -------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| 模型能力诊断   | `cc llm capabilities --json` 显示窗口、输出预算、目录版本与 digest | 不访问凭据、不联网、不写配置；`runtimeVerified:false` 是静态诊断的预期状态      |
| 原生 Responses | 精确官方 endpoint 与目录明确标记的模型由 profile 选择协议          | 第三方兼容网关保留 Chat Completions；不代表真实账号认证                         |
| 延后回答       | 偏好和补充信息问题可保持 pending，Agent 继续独立工作               | 独立 Headless 问题可跨进程重启恢复；决定/授权仍需等待，答案一次消费且过期不授权 |
| 中文记忆召回   | Context Memory Kernel 新增受治理中文词法检索                       | 召回仍按作用域和治理状态过滤                                                    |
| 沙箱能力报告   | `cc sandbox capabilities --no-probe --json`                        | 查询时 applied 为空；成功启动子进程后才报告实际应用                             |
| 插件评测与容量 | control/candidate 绑定评测；持久 Memory/后台状态基准               | 已有有界分页索引与权威全扫回退；不自动激活插件，不构成性能 SLO                  |

新建 Volcengine 文本配置延续 DeepSeek V4 Flash GA 默认值；已有配置不迁移。Responses 使用 `store:false`，不完整工具调用不会进入执行器，加密 reasoning item 仅用于协议连续性。

普通聊天报 `CC_AGENT_EVOLUTION_INGRESS_FAILED` 时先确认已升级 `0.166.72`；若配置了治理部署，应检查描述符、trust root、摘要及授权范围。不要为普通聊天部署测试 authority。Agent shell 的 Docker/bubblewrap 不支持域名级 allow/deny；Docker 也不支持细粒度文件规则，不支持组合在启动前拒绝。

完整源码边界见[运行时增量设计](/design/agent-runtime-update-2026-09-13)。

## 核心特性

- 统一 Agent ingress 持久化 UserPrompt、工具调用和真实终态。
- Skill 变更坚持 candidate-first，并以评估、证据、人工复核、lease/CAS 与 release registry 约束晋升。
- Wiki Maintainer、四层结构化 Memory、PostCompact 与 policy/semantic receipt 共用耐久账本。
- 旧 candidate/release/state/ledger 可迁移、可对账，异常身份或不完整证据会失败闭合。
- Workbench 可列出候选、比较版本并提交 approve/reject/rollback 请求；客户端没有 mutation authority。
- `cc skill search` 使用 canonical digest、索引 witness、可选独立向量和 verified outcome evidence 排序。
- 加密知识冲突只暴露删节投影，认证 merge plan 经 trust ledger、撤销依赖结算和持久发布恢复后生效。
- `cc llm configure` 从有界 stdin JSON 原子保存模型连接，凭据不进入 argv；`cc llm test` 按 OpenAI-compatible、Anthropic、Gemini 与 Ollama 原生协议探测。
- Workbench 默认打开状态总览与版本列表，Skill Library 提供只读筛选与分页；长任务在持续探索无交付时进入聚焦恢复。
- CLI direct stream、意图识别、WebSocket chat、Hub 分析/Skill/实体解析共享宿主注入的治理 Run；模型身份漂移、不完整 stream 或治理失败均失败闭合。
- Evolution witness 使用不可变 256 条分段和有界 tail，authority trust epoch 改变时 verified summary 失效。
- VS Code/JetBrains 在显示保存成功前重新读取脱敏配置；推理模型连接测试使用有界 1,024-token 输出预算。

## 系统架构

```text
REPL / headless / stream / AgentRuntime
                  │
                  ▼
       EvolutionRun composition
        ├─ Candidate + Eval
        ├─ Evidence + Ledger
        ├─ Human review registry
        ├─ Wiki + Memory producers
        ├─ Workbench + Skill Retrieval
        ├─ Governed knowledge merge
        └─ Release / LKG / rollback
                  │
                  ▼
       host-owned policy and authority
```

客户端只能提交有界意图。candidate、证据或 capability 都不能自行成为 active writer；最终状态转换必须由宿主拥有的 policy 与 authority 完成。

## 历史公开组合（2026-09-09）

下表保留 0.166.38 发布时点记录；当前 CLI 安装使用 0.166.72，IDE 与其他组件的商店版本需按各自发布渠道核对。

| 组件                  | 公开版本   | 获取渠道              |
| --------------------- | ---------- | --------------------- |
| CLI                   | `0.166.38` | npm                   |
| Core DB               | `0.1.5`    | npm                   |
| Context/Memory Kernel | `0.1.1`    | npm                   |
| Session Core          | `0.3.12`   | npm                   |
| Agent Protocol        | `0.1.9`    | npm                   |
| TypeScript Agent SDK  | `0.2.9`    | npm                   |
| Python Agent SDK      | `0.2.8`    | PyPI                  |
| VS Code IDE Bridge    | `0.37.92`  | Open VSX              |
| JetBrains IDE Bridge  | `0.4.119`  | JetBrains Marketplace |
| Personal Data Hub     | `0.4.60`   | npm                   |

Open VSX `0.37.92` 与 JetBrains Marketplace `0.4.119` 已公开并推荐 CLI `0.166.38`。Microsoft VS Code Marketplace 尚未公开该扩展，stock VS Code 用户应从 Open VSX 下载 VSIX。

## 历史增量（0.166.38）

- **模型入口治理**：direct stream、intent、legacy/canonical WebSocket 与 Hub 模型调用在 provider I/O 前绑定认证 Run、provider 和 model；终态与证据持久化完成后才报告成功。
- **Desktop Hub IPC**：源码 `8c1772ba6c` 将 resolver drain 与分析 Skill 绑定到主进程 opaque host；每次调用创建 scoped wrapper，不向 renderer 暴露 composition factory，也不改写缓存 Hub 的全局模型 client。
- **Desktop Web Shell 与后台入口**：源码 `1fd9e684f2` 把内嵌 Web Shell 的 WebSocket server 绑定到同一 main-process-only factory；`5e3ee29808` / `4f61109dcf` 完成并记录后台入口审计；`22b23a0335` 固定 Desktop Coding Agent bridge 对部署环境的继承测试。CLI-owned background、Agenda、Routine、detached worker 和该 `cc serve` bridge 均经 canonical CLI 入口，但不外推到第三方命令或自行直连 provider 的 SDK worker。
- **Legacy ImageGen 入口**：源码 `a238e6c245` 使 15 个 Desktop ImageGen IPC 的内容调用在缓存、provider 选择和 fallback 前失败闭合；管理器、Stable Diffusion 与 DALL·E client 不会在拒绝后继续发起内容请求。
- **失败不降级**：不完整 provider stream、模型身份变化和治理错误不会被 Skill commentary、intent fallback 或 Hub fallback 吞掉。
- **witness 分段**：历史 witness 前缀固化为 256 条不可变 segment，只重写有界 tail；读取重验 segment hash，trust epoch 改变时清除已验证摘要。
- **可靠模型配置**：IDE 原子提交连接并用脱敏 readback 比对 provider、endpoint 与 text/vision model；连接测试给 reasoning model 足够但有界的输出预算。
- **子包协调发布**：Agent Protocol `0.1.9` 增加知识撤销 prepare/publish schema 与 Kotlin/Swift binding；Context Memory Kernel `0.1.1` 把 LLM selector 纳入 writer inventory。

- **大网页只下载一次**：`web_fetch` 将 10 MB 原始下载预算与默认 20,000 字符返回预算分离；完整但过长的提取文本写入有界本地快照，可按 `snapshotId`、`nextOffset` 继续读取。
- **长文本检索**：`web_search` 负责关键词发现；已保存网页和本地长文本由隔离 worker 流式搜索，返回位置、上下文和续读游标，正则、并发与输出均有上限。
- **结构化失败**：HTTP、超时、响应超限、验证挑战和不完整下载明确标记，IDE 保留错误码与恢复建议，不把前缀或部分下载称为完整页面。
- **最低 Node 兼容**：恢复 Node.js `22.12.0` 下使用项目自带 SQLite 驱动的完整发布套件，并保留并发恢复失败诊断。

- **原子模型连接**：`cc llm configure` 同一把锁内绑定 provider、Base URL、模型与 credential，切换目标地址时不复用旧密钥；stdin 最大 32 KiB，远程 HTTP 需显式确认，URL 不接受内嵌凭据、query 或 fragment。
- **原生协议探测**：`cc llm test` 对 OpenAI-compatible、Anthropic、Gemini、Ollama 构造各自协议请求，拒绝 redirect，20 秒超时且必须取得非空模型文本。
- **页面化 IDE**：VS Code `0.37.87` 的 Workbench 先展示状态与版本列表，Skill Library 支持筛选/分页；决定仍要求 capability 与 fresh-state 复核。自定义连接页面不回显密钥，先保存再测试。
- **任务恢复**：`0.166.25–0.166.29` 保留跨压缩读取位置，避免重复整页/整段输出，在长期探索没有实现进展时收敛到搜索、编辑和验证；IDE Stop 先中断，5 秒无响应后终止，再次 Stop 立即终止。

- **长任务聊天**：交互式流式 Agent 不再因默认 50 次模型调用上限中断长任务；显式轮次、费用和会话预算继续生效，无人值守任务仍保留默认上限。大文件读取按字节/行游标分页，压缩后保留最新读取位置，未变化页避免重复注入；慢命令期间 IDE 会话继续保活。
- **治理恢复**：受治理演进补齐持久 Workbench 审核/回滚与启动恢复、知识候选独立隔离/拒绝、跨 Wiki 多级来源撤销和 tombstone 恢复、Skill/Prompt/Hook 制品发布与受控市场候选安装。启动仅补记已发生的效果，未执行计划保持待处理；候选安装不会直接激活 Skill。真实身份、签名、策略、KMS/PKI、witness、grader 和目标环境验收仍由部署方提供。
- **依赖安装**：Session Core `0.3.12` 补齐 `evolvable-artifact` 出口，Core DB `0.1.5` 修复命名参数绑定；CLI 固定对应依赖。
- **Node 兼容**：沙箱与独立 Eval 子进程按 Node 22.12 支持的权限标志启动。

- **公共安装启动修复**：`cc`、`cc agent` 和 `cc agent --capabilities` 可从官方 npm 的全新安装加载完整命令图。
- **持久 Agent ingress**：交互 REPL、单轮 headless、stream headless 与 `AgentRuntime` 可由可信宿主注入 `EvolutionRun` composition；UserPrompt、tool request/result 和真实终态在继续执行前持久确认。
- **受治理 Skill 生命周期**：candidate、目标矩阵 Eval、认证 evidence、human-review quorum、tenant release、lease/CAS promotion、LKG 与 rollback 共同约束 active 变化。
- **Wiki 与 Memory**：Wiki revision、四层结构化 Memory、PostCompact、promotion/policy/semantic receipt 使用 ArtifactPorts + Ledger，支持响应丢失幂等和新实例恢复。
- **旧状态迁移**：legacy candidate/release/state ledger 通过计划、journal、baseline/current projection 和启动 reconciliation 迁移；歧义或认证失败时保留现场并失败关闭。
- **registry transition**：Candidate/Eval/HumanTask request/attempt/settlement 事件驱动 evaluated + human-reviewed control plane；capability 不进入持久状态，commit/settlement crash 可恢复。
- **Evolution Workbench**：`list`、`compare`、`review` 与精确 from→to `rollback` 只通过 branded trusted deployment host 执行；Desktop 和 IDE 消费同一有界投影。
- **Skill Retrieval**：四类来源统一进入 canonical router；digest、索引 witness、向量 authority 与 invocation outcome 证据不一致时 abstain。
- **加密知识治理**：持久冲突、认证人工 merge、AES-256-GCM/Ed25519、RBAC、trust ledger、撤销依赖处置和 response-loss/crash recovery 组成完整事务链。
- **旧壳退役**：不可达 Phase 100 simulator 和未注册 IPC 已移除；公式训练路径只保留 metrics。

上述能力不代表默认开启无人值守 active promotion。Workbench/Knowledge UI 是受信宿主的有界审阅面，不是 authority 本身；目标环境 KMS/HSM/PKI/identity/policy/witness/scheduler/transition authority、真实跨平台 grader、kill-switch/canary 运营和生产灾备演练仍是部署条件。

## 使用示例

全新安装后先核对版本与能力面，再按需进入交互 Agent：

```bash
npm install --global chainlesschain@0.166.72 --registry https://registry.npmjs.org
cc --version
cc agent --capabilities
cc agent
```

## 安装与升级

### CLI

```bash
npm install --global chainlesschain@0.166.72 --registry https://registry.npmjs.org
cc --version
cc agent --capabilities
```

`cc --version` 预期输出 `0.166.72`。`cc agent --capabilities` 应能执行，但其中某项显示 disabled/unavailable 可能只是当前宿主没有注入生产 authority，不应以测试密钥或环境变量绕过。

### SDK 与协议

```bash
npm install @chainlesschain/agent-sdk@0.2.11
npm install @chainlesschain/agent-protocol@0.1.11
python -m pip install chainlesschain-agent-sdk==0.2.9
```

### IDE

- Open VSX：在扩展页选择当前公开的 `chainlesschain.chainlesschain-ide` 版本。
- 官方 VS Code：从 [Open VSX 扩展页](https://open-vsx.org/extension/chainlesschain/chainlesschain-ide) 下载 VSIX，运行 **Extensions: Install from VSIX...**。
- JetBrains 2024.2+：在 Marketplace 搜索 **ChainlessChain IDE**，按公开版本安装。不要把源码版本当作商店已发布版本。

## 配置参考

| 目标           | 配置或命令                           | 当前边界                                                       |
| -------------- | ------------------------------------ | -------------------------------------------------------------- |
| 普通本地 Agent | `cc agent`                           | 默认禁网 `workspace-write`，不探测 Docker                      |
| 显式容器隔离   | CLI flag、settings 或 managed policy | 引擎不可用时失败关闭                                           |
| Skill 候选合成 | `cc learning synthesize --json`      | 缺可信 LLM/store/evaluator/active roots 时 unavailable         |
| Workbench      | `cc evolution workbench ...`         | 缺 trusted deployment host 时 unavailable                      |
| 知识冲突审核   | `cc evolution knowledge ...`         | 只返回删节投影；merge 由宿主复核                               |
| Skill 检索     | `cc skill search ...`                | 命中不等于安装或晋升                                           |
| Jev 决策试点   | `cc agent --session <id> --decision-mode shadow -p ...` | 默认关闭；需要 TypeSafe 凭据；shadow 不改变路由       |
| Agent 能力     | `cc agent --capabilities`            | 显示能力不等于 production composition 已启用                   |
| IDE 安装       | Open VSX / JetBrains Marketplace     | Open VSX `0.37.114` 与 JetBrains `0.4.135` 均已公开   |
| 更新检查       | `npm view chainlesschain version`    | 应从官方 npm registry 回读                                     |

- candidate 创建、Wiki 更新或 Memory 接受都不授予 active 写权限。
- 客户端 option、环境变量和本地测试密钥不能创建 production composition。
- Ledger 断链、witness 不一致、receipt substitution、陈旧 revision 或跨 tenant 输入会阻止 mutation。
- npm CLI 包不包含 Electron Desktop 字节；历史 Desktop qualification 不等于当前 native fresh-install/upgrade/rollback 已发行。

## 性能指标

本版本不把本地单测耗时或 CI wall time 承诺为用户 SLA。运行时保持有界队列、容量限制、超时、lease/fence 和恢复语义；生产部署应按目标 provider、存储、网络与 grader 重新建立延迟、吞吐和恢复时间基线。

## 测试覆盖

当前 `0.166.72` 与配套 IDE 的精确提交、三平台门和公共渠道状态如下：

| 门禁                                            | GitHub Actions run                                                                         | 状态                                                    |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| CLI CI（Linux/Windows/macOS）                   | [`35831862379`](https://github.com/chainlesschain/chainlesschain/actions/runs/35831862379) | 成功                                                    |
| CLI Strict Sandbox（三平台）                    | [`35831862038`](https://github.com/chainlesschain/chainlesschain/actions/runs/35831862038) | 成功                                                    |
| npm Trusted Publishing / provenance             | [`35844120633`](https://github.com/chainlesschain/chainlesschain/actions/runs/35844120633) | 成功                                                    |
| npm 公共安装与 provenance 独立回读              | [`35848098440`](https://github.com/chainlesschain/chainlesschain/actions/runs/35848098440) | 成功                                                    |
| IDE `main@94c4c5a634` 精确提交门                 | [`35852117555`](https://github.com/chainlesschain/chainlesschain/actions/runs/35852117555) | 成功                                                    |
| Open VSX `0.37.114` 发布与公开 VSIX 回读        | [`35857926921`](https://github.com/chainlesschain/chainlesschain/actions/runs/35857926921) | 成功；公开可下载                                       |
| JetBrains `0.4.135` 构建、上传与发布后核验      | [`35857955631`](https://github.com/chainlesschain/chainlesschain/actions/runs/35857955631) | 成功；后续公共 API 确认批准/上架                     |

npm `0.166.72` 与 Open VSX `0.37.114` 已完成公共 listing/制品回读。JetBrains `0.4.135` 的 `publishPlugin` 上传成功，后续公开 updates API 返回 `approve=true`、`listed=true`、`hidden=false`，因此已公开。Microsoft Marketplace 因未配置 `VSCE_PAT` 在上传前跳过，因此不计为已发布。npm tarball、VSIX、JetBrains ZIP、Desktop native 仍是独立制品身份。历史门禁不代替当前或下一版发布验收。

## 安全考虑

- 保持默认禁网 `workspace-write`；不要以测试密钥、环境变量或 UI 输入伪造生产 authority。
- promotion、rollback、kill-switch 与 canary 必须复核 tenant、candidate、active revision、policy 和 evidence binding。
- Ledger 断链、witness 分歧、陈旧 lease、receipt substitution 或迁移歧义都应中止状态变更并保留现场。
- Desktop、IDE、SDK 和 CLI 是不同发布制品；一个渠道的成功证据不能授权另一个渠道。

## 故障排查

**`unknown command 'agent'`**：这通常是旧版公共安装与 Session Core 导出不匹配。升级到 `0.166.72`，再运行 `cc agent --capabilities`。

**npm 镜像返回 E404**：显式使用官方 registry：

```bash
npm install --global chainlesschain@0.166.72 --registry https://registry.npmjs.org
```

**官方 VS Code 搜不到扩展**：Microsoft Marketplace 尚未公开；从 Open VSX 下载 `0.37.114` VSIX。

**JetBrains 版本过旧**：Marketplace 当前公开 `0.4.135`；若本机搜索仍显示旧版，刷新插件列表并确认 IDE 版本至少为 2024.2。

**普通启动仍检查 Docker**：确认 `cc --version` 为 `0.166.72`，再检查 CLI flag、settings 或 managed policy 是否显式选择容器隔离。

**Workbench/Knowledge 提示 trusted deployment host required**：当前进程未接入部署治理宿主。保持失败闭合，由管理员配置 identity/policy/ledger/KMS authority；不要回退到本地直写。

**能力显示 unavailable**：这通常表示宿主没有配置可信 adapter 或 authority。保持失败关闭，由管理员按部署设计补齐，不要复制 candidate 到 active 目录。

## 关键文件

- `packages/cli/package.json`：CLI 公共版本与打包入口。
- `packages/session-core/package.json`：Session Core 版本与导出边界。
- `packages/cli/src/lib/agent-evolution-runtime-composition.js`：受治理进化的组合入口。
- `packages/cli/src/lib/evolution-run-store.js`：耐久 EvolutionRun 状态。
- `packages/cli/src/lib/evolution-ledger.js`：防篡改事件账本。
- `packages/cli/src/lib/decision-layer/`：Jev 类型化请求、provider、runtime 与 benchmark。
- `docs/design/modules/114-jev-decision-layer-design.md`：Jev 决策层架构、评测门和 IDE 边界。
- `docs/design/modules/112-governed-skill-evolution-design.md`：完整设计与生产缺口。
- `docs/design/modules/113-governed-desktop-model-ingress-design.md`：Desktop 模型入口、失败闭合和缓存/witness 设计。

## 相关文档

- [受治理的 Skill 自进化](/chainlesschain/governed-skill-evolution)
- [CLI Runtime 当前实现](/chainlesschain/cli-runtime-current)
- [自进化 CLI 命令](/chainlesschain/cli-evolution)
- [Context/Memory Kernel](/chainlesschain/context-memory)
- [IDE 插件完整指南](/chainlesschain/ide-plugin)
- [IDE 任务记录与新会话接力](/chainlesschain/ide-task-worklog)
- [Desktop 模型治理与失败闭合](/chainlesschain/desktop-model-governance)
- [设计文档：受治理的 Skill 自进化](/design/modules/112-governed-skill-evolution-design)
- [设计文档：Agent Platform 发布与运行时边界](/design/modules/110-agent-platform-release-boundaries)
