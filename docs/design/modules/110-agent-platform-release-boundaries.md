# 110. Agent Platform 0.166.68 发布与运行时边界设计

> 状态：2026-09-20 核对，CLI、发生变化的子 npm 包与双 IDE 已按顺序发布并完成公共注册表回读
>
> - CLI 精确源码：`815fdbc0c49f843c2df1c39ec5937d99d144b970`
> - CLI 不可变标签：`v-npm-0-166-68`
> - 文档核对源码：`5da428687f38cf2d47da959c46f1d73a43901b60`
> - IDE 精确源码：`5860f1e4a4c7579bc648f9fb665949b8dafc3362`
> - IDE 源码标签：`ide-vscode-v0.37.110` / `ide-jetbrains-v0.4.131`

## 1. 目标

本设计记录 Agent Platform `0.166.68` 的公共制品、子包先发规则、运行时安全、浏览器动作与下载隔离、受治理演化和后续主线边界，避免以下身份被错误合并：

1. Git tag、npm/PyPI/Open VSX/JetBrains 制品与 Desktop/native 资格证据分别判断；
2. npm `latest` 与 GitHub `main` 即使版本字段相同，也保留各自 exact SHA；
3. candidate、Wiki、Memory、Eval 和 human review 证据不等于 active mutation；
4. 仓库持久 adapter/composition 不等于目标环境已经部署生产 KMS/PKI/witness；
5. IDE 公共 listing 与源码/tag 分别回读，上传或 workflow 成功不能替代 Marketplace 可见性；
6. Workbench/Knowledge UI 是有界审阅面，不等于客户端拥有 mutation/merge authority。
7. 完整 exact-SHA CI 可以由不可变发布标签复用，但本地、部分矩阵、旧提交或超时结果不能成为发布证明。
8. failed-job rerun 的聚合必须为每个矩阵单元选择最新 attempt，同时保留未重跑单元在早先 attempt 的成功证据。

## 2. 发布身份矩阵

| 表面                          | 源码/标签                               | 公共状态                     | 结论                       |
| ----------------------------- | --------------------------------------- | ---------------------------- | -------------------------- |
| CLI                           | `v-npm-0-166-68` → `815fdbc0c4`         | npm `latest=0.166.68`        | 生产推荐                   |
| Context/Memory Kernel         | 包版本 `0.1.5`                          | npm 已回读并带 provenance    | 公开；本轮先于 CLI 发布    |
| Session Core                  | 包版本 `0.3.13`                         | npm 已回读并带 provenance    | 公开；本轮先于 CLI 发布    |
| Personal Data Hub             | 包版本 `0.4.62`                         | npm 已回读并带 provenance    | 公开；本轮先于 CLI 发布    |
| Agent Protocol                | 包版本 `0.1.11`                         | npm 已回读                   | 公开；本轮字节复核后复用   |
| TypeScript Agent SDK          | 包版本 `0.2.11`                         | npm 已回读                   | 公开；重建生成物后字节复核 |
| Python Agent SDK              | `0.2.9`                                 | PyPI 已回读                  | 公开                       |
| VS Code                       | `ide-vscode-v0.37.110` → `5860f1e4a4`   | Open VSX `0.37.110` 已回读   | 公开                       |
| JetBrains                     | `ide-jetbrains-v0.4.131` → `5860f1e4a4` | Marketplace `0.4.131` 已回读 | 公开                       |
| Microsoft VS Code Marketplace | 同一扩展                                | 未发现公共记录               | 不作为安装渠道             |
| Desktop/native                | 仓库源码与 exact-SHA qualification      | 历史资格证据存在             | 不等于当前公共安装包发行   |
| 源码核对基线                  | `5da428687f`                            | 晚于 npm/IDE release SHA     | 后续 Desktop 安全增量      |

所有安装口径以公共 registry/Marketplace 实际回读为准。共用源码 SHA 或版本号不表示 npm tarball、VSIX、JetBrains ZIP 与 Desktop 安装包是同一制品。

## 3. 运行时分层

```text
Canonical authority
  ├─ Graph / Context / Memory / Scheduler
  ├─ EvolutionRun / Wiki / Candidate / Eval
  ├─ Workbench / Retrieval / Governed knowledge
  ├─ Human review / Registry transition / Trust ledger
  └─ ArtifactPorts + EvolutionLedger + witness

Execution boundary
  ├─ fixed renderer/main IPC capability manifest
  ├─ approval policy + durable redacted process admission
  ├─ workspace-write / strict sandbox
  └─ Process Broker + credential transport

Product projection
  ├─ CLI / Desktop / Web / Android / iOS
  └─ VS Code / JetBrains

Release evidence
  ├─ CLI CI + Strict Sandbox + npm provenance/readback
  ├─ IDE host matrices + Marketplace readback
  └─ separately scoped Desktop / Record Replay / production evidence
```

上层投影只能消费带 revision、attempt、operation、lease/fence 或 evidence digest 的数据并提交有界决定，不能从按钮状态、客户端 payload、环境变量或本地时间重建 authority。

## 4. 0.166.20–0.166.68 的运行时变化

### 4.1 公共安装启动

`0.166.18` 引用了当时未进入公共 Session Core `0.3.9` 包字节的 `./structured-evolution-memory` export，导致全新安装可能把 `agent` 误报为 unknown command。`0.166.20` 先发布 Session Core `0.3.10`，再发布 pin 住该依赖的 CLI，并在发布工作流中执行公共安装与 `cc agent --capabilities` 检查。

`0.166.24` 继续承接该修复，并把 Session Core 更新到 `0.3.12`。

### 4.2 Evolution composition

`createAgentEvolutionRuntimeComposition()` 把 encrypted Raw、evidence projector/verifier、ArtifactPorts、`EvolutionRunLedgerAdapter`、真实文件 Ledger 与 durable witness 组成 branded root。artifact envelope、encryptor、source verifier、storage policy、attestation、ledger 与 witness authority 都由部署方显式注入；命令参数、环境变量和测试密钥不能隐式启用。

交互 REPL、单轮 headless、stream headless 与 `AgentRuntime` 共用该 ingress。UserPrompt、tool requested/completed/failed、response 和 run end 必须在继续消费模型/工具生成器前持久确认。canonical Graph App Server 与 legacy WebSocket Agent 提供同类宿主 factory 接线缝并拒绝客户端替换。

### 4.3 Wiki、Memory 与 Registry

- Wiki revision 进入有限 `wiki-revision` Artifact 类型和 `wiki.revision.committed` Ledger 事件；head CAS、响应丢失幂等和新实例恢复已形成。
- Agent completion 从重放认证的 `EvolutionRun` 生成 session/goal trigger；ScheduledBatch 从真实 `SchedulerStore` 成功 occurrence 经独立 authority 生成 trigger。
- structured Memory 明确 episodic/semantic/procedural/policy 四层；critic/evaluator/promotion/policy receipt、CLI/Desktop PostCompact 和 pending reconciliation 通过同一 Artifact/Ledger 体系恢复。
- Candidate/Eval/HumanTask 的 durable request/attempt/settlement 经 registry transition adapter 接到 evaluated + human-reviewed control plane，commit 与 settlement crash 保持可恢复。

### 4.4 迁移与旧壳退役

legacy candidate、inactive release、state ledger 和 journal 使用 tenant-scoped 计划、baseline/current projection、认证处置和启动 reconciliation 迁移。四阶段故障矩阵覆盖 planning、commit、retirement 与 recovery；无法证明身份或映射唯一性时保留旧文件并失败关闭。

旧 Phase 100 simulator、未注册 evolution IPC 与不可达 desktop simulator 已退役；公式学习路径只记录真实 metrics，不再产生“训练完成”或 active mutation 幻影成功。

### 4.5 Workbench、Retrieval 与受治理知识

- `EvolutionWorkbenchCliHost` 只接受 branded source/projection/transition/metrics authority，提供候选列表、packet digest 比较、逐项 review 和精确 from→to rollback 请求。
- `cc skill search`、Agent runtime 与 Desktop/IDE 共用 canonical router；BM25、可选独立向量和 verified invocation outcome 的 source/query/index/result digest 必须一致。
- 加密知识同步先持久 local/remote/conflict，冲突只输出删节投影；人工 merge 绑定 baseline/vector clock、认证 receipt、trust ledger 与 dependency settlement，并支持 crash/response-loss 恢复。

### 4.6 长任务执行与文件读取（0.166.24）

交互式流式 Agent 不再因默认 50 次模型调用上限中断长任务；显式轮次、费用和会话预算继续生效，无人值守任务仍保留默认上限。大文件读取按字节/行游标分页，压缩后保留最新读取位置，未变化页避免重复注入；慢命令期间 IDE 会话继续保活。

`IterationBudget.forRun` 区分持续交互与无人值守运行；`read-file-page.js` 返回精确 continuation，Agent loop 使用有界页缓存并在文件版本变化后失效；`micro-compact` 与 `prompt-compressor` 保存最新 cursor。`headless-stream-long-task.test.js` 覆盖超过 50 次调用、80 页读取及多次压缩，不能将该回归解释为无限时间或费用保证。

### 4.7 持久治理与受信部署（0.166.23–0.166.24）

受治理演进补齐持久 Workbench 审核/回滚与启动恢复、知识候选独立隔离/拒绝、跨 Wiki 多级来源撤销和 tombstone 恢复、Skill/Prompt/Hook 制品发布与受控市场候选安装。启动仅补记已发生的效果，未执行计划保持待处理；候选安装不会直接激活 Skill。真实身份、签名、策略、KMS/PKI、witness、grader 和目标环境验收仍由部署方提供。

签名部署 loader 提供文件资源、控制端口和异步 Workbench runtime 工厂。CLI 的 `{ workbenchHost }` 与 App Server 的 `{ evolutionWorkbenchHost: workbenchHost }` 显式映射；人工 Review、rollback 和当前 Registry 读取分别认证，重启不自动执行未完成授权。详细来源、跨 Wiki 撤销和市场候选边界见[模块 112](112-governed-skill-evolution-design.md)。

### 4.8 自定义连接、原生探测与 Desktop 源码边界（0.166.30 / main）

`0.166.30` 公开 `cc llm configure` 的有界 stdin JSON 与原子保存路径。provider、model、base URL、vision model 和密钥作为同一事务提交，密钥不进入 argv；端点改变时拒绝沿用旧密钥。OpenAI-compatible、Anthropic、Gemini 与 Ollama 的探测使用各自原生协议、拒绝重定向并设置 20 秒超时。

同一公开版本加入页面化 Workbench/只读 Skill Library、读取游标与重复输出抑制、聚焦恢复和可靠 Stop。更晚的 `main@5db62db246` 将 Desktop 普通、流式、工具、多模态请求接入统一受治理模型入口，并阻断 embedding、reranker、媒体、项目、文档与 legacy RAG 的旧直连；这部分仅是源码状态，详见[模块 113](113-governed-desktop-model-ingress-design.md)。

### 4.9 浏览器 authority、下载隔离与协调发布（0.166.68）

浏览器 observation、navigation、tab creation、history traversal、keyboard action 与 download 不再由隐式自动化能力直接触发。调用方必须提交绑定动作类别、目标与上下文的 action authority；运行时在副作用前复核 scope 和 binding，拒绝把只读观察授权扩写为导航、按键或下载权限。

下载响应以流方式写入耐久 filesystem quarantine。隔离记录绑定字节摘要、来源、创建/到期时间和 custody 状态；跨进程锁串行化 retain、revoke、recover、expire 与 dispose，崩溃恢复只能继续已认证事务。未完成或未裁决字节不能作为可信 workspace 文件进入后续工具。PM exploration runner、reviewer 与 grader 也被移入有界子进程，证据、恢复快照、egress 决定和 benchmark receipt 绑定同一 governed execution context。

npm 发布采用显式依赖顺序：先审计 13 个子包，再发布有变化且已递增版本的子包，完成公共 registry/provenance 回读后才允许 CLI 发布。复用版本必须先构建确定性生成物，再把待发布 tarball 与公共 tarball 做逐字节归一化比较，并验证对应标签、Git tree 与 provenance；源码变化但版本未递增、生成物缺失或公共字节漂移均在 CLI publish 前失败关闭。本轮因此先发布 Session Core `0.3.13`、Context/Memory Kernel `0.1.5` 与 Personal Data Hub `0.4.62`，再发布 CLI `0.166.68`。

发布标签不重复执行已经通过的完整套件，而是验证并复用 `815fdbc0c4` 的三平台 CLI CI 与 Strict Sandbox。复用键包含 exact SHA、完整 matrix 和成功结论；本地结果、旧 SHA、部分矩阵、超时或取消均不满足条件。IDE 只能在 CLI 公共回读后发布，`0.37.110/0.4.131@5860f1e4a4` 因而位于 CLI 之后。

ARM64 证据聚合从所有 run attempt 下载 artifact，按矩阵 key 分组并选择该 key 的最新 attempt。这样 failed-job rerun 只重跑失败单元时，未重跑单元仍使用早先成功证据，而重跑单元使用新证据；重复 key、缺格、SHA/架构/版本不符或 digest 漂移继续失败关闭。`45557d27dc` 的 11 单元真机矩阵证明这一聚合路径。

### 4.10 发布后 Desktop IPC 与安全配置边界（`5da428687f`）

`ad7567214f` 为 Volcengine 与 Secure Storage IPC 增加主进程授权层。每个操作在读取敏感配置、选择 provider、执行函数、访问文件或打开系统对话框前，绑定实际主窗口、main frame、可信来源、当前 DID actor/tenant 与固定用途。Secure Storage 写入只接受声明过的敏感字段路径，状态读取只返回布尔值和公开 provider 名称。Volcengine 模型目录只投影有界公开字段，renderer 不能提交 actor、tenant、purpose 或任意扩展配置。

同一提交移除 Volcengine Function Calling 的本地数据库、文件系统、P2P 与系统信息直连实现。工具执行只能消费签名 evolution deployment 提供的 opaque capability；请求和回执绑定 actor、tenant、sender、用途、函数白名单、参数摘要、handler artifact digest 与 policy revision，且只有认证、耐久、已回读的结果才能进入模型循环。没有生产 authority 时固定失败关闭，不回退旧本地 switch。

`96d7cbc294` 将加密配置、密码导入导出、safeStorage 迁移和备份接入同一原子文件提交器：目标同目录内使用私有排他临时文件，完成文件 flush、原子 rename 与目录同步后才报告成功；加载时只提升能通过当前解密认证的完整临时文件。`fe6157d58f` 再把备份限制为默认 10 份、可配置 1–100 份，只接纳严格 UTC 命名、位于真实备份目录内、非符号链接且不超过 16 MiB 的普通文件。恢复只能选择服务端清单内路径，保留裁剪失败会撤销本次新备份。

`89e180f700` 为每个原子目标增加跨进程 owner 记录，绑定 PID、进程启动时间、随机 nonce 与目标路径摘要。活跃 owner 阻止其他进程写入；死亡 owner 只能在独立 recovery fence 下回收，回收前再次比较完整 owner 字节并复核进程存活。owner 被替换、恢复者仍存活、并发恢复或记录格式异常时均失败关闭；释放时再次验证所有权并同步目录。

`5da428687f` 将核心 LLM IPC 的成功返回统一经过显式投影器。query/chat/stream/status/model list/embedding 只返回 renderer 需要的有界 plain data；provider/Agent/cache 内部对象、额外字段、Proxy、accessor、非有限数值、超限文本、模型清单、引用文档或向量不会跨 IPC 边界。流式事件不再回传调用方提供的 conversation metadata，integration 状态只保留固定布尔值与有界 session 标识。

这些提交位于公开 CLI/IDE SHA 之后，也没有公开 Desktop native 制品证明。真实 Windows Credential Manager、macOS Keychain、Linux Secret Service、物理断电、目录 ACL、身份切换、多租户撤销及 operator 签名销毁策略仍需目标环境 E2E 与故障矩阵。

## 5. 生产未关闭边界

仓库内 adapter 和文件恢复测试不等于生产环境完成。以下条件仍是 active automation 的发布阻断：

- 仓库已实现 process Eval supervisor、隔离 target、progressive canary traffic worker 与外部 watchdog；目标部署仍须配置真实 runner/grader、终止能力和生产流量，并验证统计门；
- 生产 KMS/HSM、PKI、用户身份、review policy、撤销/轮换、独立 witness 和 scheduler/transition authority；
- Desktop 默认 launcher、其他最终入口和部署 worker 注入唯一 branded composition；
- Workbench/Knowledge 审阅面之外的 active/LKG、kill switch 与 canary 完整运营控制；
- 跨主机灾备、长账本容量、authority/witness 故障和生产流量误报校准。

这些条件关闭前，candidate、Wiki 或 Memory 可以作为受治理证据进入系统，但 unattended active promotion 保持关闭。

## 6. IDE 与公共渠道

Open VSX `0.37.110` 与 JetBrains Marketplace `0.4.131` 已公开并推荐 CLI `0.166.68`。两款 IDE 来自同一精确源码 `5860f1e4a4`，但 VSIX、JetBrains ZIP 和 npm CLI 仍分别验签、回读和记录。VS Code 提供页面化 Workbench、分页只读 Skill Library 与自定义模型连接；双端继续只消费 CLI-owned 投影。

IDE 继续只提交宿主已审阅决定并消费 CLI-owned projection。Marketplace 可见性不会授予 IDE Graph、Session、approval、evolution 或 Skill active writer 权限。Microsoft VS Code Marketplace 未公开时，stock VS Code 用户从 Open VSX 下载 VSIX。

## 7. 权威验证记录

| 证据                                     | 精确提交       | GitHub Actions run                                                                                                                                                                      | 状态                        |
| ---------------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| CLI CI（Linux/Windows/macOS）            | `815fdbc0c4`   | [`35507258259`](https://github.com/chainlesschain/chainlesschain/actions/runs/35507258259)                                                                                              | 成功                        |
| CLI Strict Sandbox（三平台）             | `815fdbc0c4`   | [`35507258127`](https://github.com/chainlesschain/chainlesschain/actions/runs/35507258127)                                                                                              | 成功                        |
| 子包先发 + npm Trusted Publishing / 回读 | `815fdbc0c4`   | [`35509552030`](https://github.com/chainlesschain/chainlesschain/actions/runs/35509552030)                                                                                              | 成功                        |
| IDE exact-SHA 主矩阵                     | `5860f1e4a4`   | [`35510430698`](https://github.com/chainlesschain/chainlesschain/actions/runs/35510430698)                                                                                              | 成功                        |
| Open VSX / JetBrains 渠道发布            | `5860f1e4a4`   | [`35511532130`](https://github.com/chainlesschain/chainlesschain/actions/runs/35511532130) / [`35512228012`](https://github.com/chainlesschain/chainlesschain/actions/runs/35512228012) | `0.37.110` / `0.4.131` 公开 |
| 11 单元 IDE ARM64 + rerun 聚合           | `45557d27dc`   | [`35514094545`](https://github.com/chainlesschain/chainlesschain/actions/runs/35514094545)                                                                                              | 成功                        |
| Record Replay UI Journey                 | 历史 exact SHA | 历史记录                                                                                                                                                                                | 不被本版改写                |
| Desktop Signed Skill Qualification       | 历史 exact SHA | 历史记录                                                                                                                                                                                | 不等于当前 native 发行      |

后续版本必须在自己的 final exact SHA 上重新完成适用矩阵。被新 push 自动取消的旧 run、部分矩阵、本地测试或旧 SHA 成功都不能代替本表。

## 8. 关键实现

- `packages/cli/src/lib/evolution/agent-evolution-runtime-composition.js`
- `packages/cli/src/lib/evolution/agent-evolution-ingress.js`
- `packages/cli/src/lib/evolution/evolution-run-ledger-adapter.js`
- `packages/cli/src/lib/evolution/evidence-backed-wiki-maintainer.js`
- `packages/cli/src/lib/evolution/wiki-maintainer-ledger-adapter.js`
- `packages/cli/src/lib/evolution/structured-memory-agent-control-plane.js`
- `packages/cli/src/lib/evolution/skill-promotion-review-ledger-adapter.js`
- `packages/cli/src/lib/evolution/skill-registry-transition-ledger-adapter.js`
- `packages/cli/src/lib/evolution/skill-promotion-controller.js`
- `packages/cli/src/lib/evolution/skill-release-registry.js`
- `packages/cli/src/commands/evolution-workbench.js`
- `packages/cli/src/commands/evolution-knowledge.js`
- `packages/cli/src/lib/evolution/evolution-workbench-projection.js`
- `packages/cli/src/lib/evolution/governed-knowledge-review-host.js`
- `packages/session-core/lib/structured-evolution-memory.js`
- `packages/cli/src/runtime/agent-runtime.js`

## 9. 相关设计

- [模块 112：受治理的 Skill 自进化](./112-governed-skill-evolution-design.md)
- [模块 105：Graph Kernel](./105_Graph_Kernel设计.md)
- [模块 108：Context/Memory Kernel](./108_Context_Memory_Kernel设计.md)
- [模块 109：Desktop Cowork Skill 执行安全](./109_Desktop_Cowork_Skill_Execution_Security.md)
- [CLI Runtime 当前实现](../cli-runtime-current.md)
