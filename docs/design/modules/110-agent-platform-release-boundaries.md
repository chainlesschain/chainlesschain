# 110. Agent Platform 0.166.21 发布与运行时边界设计

> 状态：2026-09-04 核对，CLI、协调 SDK/Protocol 与双 IDE 已发布并完成公共注册表回读
>
> - CLI 精确源码：`1ff70b785629e2967dc69677f73cf00190f30a71`
> - CLI 不可变标签：`v-npm-0-166-21`
> - 当前 GitHub 主线：`1ff70b785629e2967dc69677f73cf00190f30a71`
> - IDE 源码标签：`ide-vscode-v0.37.81` / `ide-jetbrains-v0.4.110`

## 1. 目标

本设计记录 Agent Platform `0.166.21` 的公共制品、运行时安全、Evolution Workbench、Skill Retrieval、受治理知识演化和后续主线边界，避免以下身份被错误合并：

1. Git tag、npm/PyPI/Open VSX/JetBrains 制品与 Desktop/native 资格证据分别判断；
2. npm `latest` 与 GitHub `main` 即使版本字段相同，也保留各自 exact SHA；
3. candidate、Wiki、Memory、Eval 和 human review 证据不等于 active mutation；
4. 仓库持久 adapter/composition 不等于目标环境已经部署生产 KMS/PKI/witness；
5. IDE 公共 listing 与源码/tag 分别回读，上传或 workflow 成功不能替代 Marketplace 可见性；
6. Workbench/Knowledge UI 是有界审阅面，不等于客户端拥有 mutation/merge authority。

## 2. 发布身份矩阵

| 表面                          | 源码/标签                               | 公共状态                     | 结论                            |
| ----------------------------- | --------------------------------------- | ---------------------------- | ------------------------------- |
| CLI                           | `v-npm-0-166-21` → `1ff70b7856`         | npm `latest=0.166.21`        | 生产推荐                        |
| Context/Memory Kernel         | 包版本 `0.1.0`                          | npm 已回读                   | 公开                            |
| Session Core                  | 包版本 `0.3.11`                         | npm 已回读                   | 公开                            |
| Agent Protocol                | 包版本 `0.1.8`                          | npm 已回读                   | 公开                            |
| TypeScript Agent SDK          | 包版本 `0.2.8`                          | npm 已回读                   | 公开                            |
| Python Agent SDK              | `0.2.8`                                 | PyPI 已回读                  | 公开                            |
| VS Code                       | `ide-vscode-v0.37.81` → `1ff70b7856`    | Open VSX `0.37.81` 已回读    | 公开                            |
| JetBrains                     | `ide-jetbrains-v0.4.110` → `1ff70b7856` | Marketplace `0.4.110` 已回读 | 公开                            |
| Microsoft VS Code Marketplace | 同一扩展                                | 未发现公共记录               | 不作为安装渠道                  |
| Desktop/native                | 仓库源码与 exact-SHA qualification      | 历史资格证据存在             | 不等于当前公共安装包发行        |
| GitHub `main`                 | `1ff70b7856`                            | 与本次 tag 同 SHA            | 源码 head；仍不合并独立制品身份 |

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

## 4. 0.166.21 的运行时变化

### 4.1 公共安装启动

`0.166.18` 引用了当时未进入公共 Session Core `0.3.9` 包字节的 `./structured-evolution-memory` export，导致全新安装可能把 `agent` 误报为 unknown command。`0.166.20` 先发布 Session Core `0.3.10`，再发布 pin 住该依赖的 CLI，并在发布工作流中执行公共安装与 `cc agent --capabilities` 检查。

`0.166.21` 继续承接该修复，并把 Session Core 更新到 `0.3.11`。

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

## 5. 生产未关闭边界

仓库内 adapter 和文件恢复测试不等于生产环境完成。以下条件仍是 active automation 的发布阻断：

- 真实跨平台 target runner/grader、进程级 hard kill、shadow/canary 与分布级 anti-gaming；
- 生产 KMS/HSM、PKI、用户身份、review policy、撤销/轮换、独立 witness 和 scheduler/transition authority；
- Desktop 默认 launcher、其他最终入口和部署 worker 注入唯一 branded composition；
- Workbench/Knowledge 审阅面之外的 active/LKG、kill switch 与 canary 完整运营控制；
- 跨主机灾备、长账本容量、authority/witness 故障和生产流量误报校准。

这些条件关闭前，candidate、Wiki 或 Memory 可以作为受治理证据进入系统，但 unattended active promotion 保持关闭。

## 6. IDE 与公共渠道

Open VSX `0.37.81` 与 JetBrains Marketplace `0.4.110` 已公开并推荐 CLI `0.166.21`。双端提供 CLI-owned Evolution Workbench 与 Skill Retrieval 投影。

IDE 继续只提交宿主已审阅决定并消费 CLI-owned projection。Marketplace 可见性不会授予 IDE Graph、Session、approval、evolution 或 Skill active writer 权限。Microsoft VS Code Marketplace 未公开时，stock VS Code 用户从 Open VSX 下载 VSIX。

## 7. 权威验证记录

| 证据                                          | 精确提交       | GitHub Actions run                                                                         | 状态                       |
| --------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------ | -------------------------- |
| CLI CI（Linux/Windows/macOS）                 | `1ff70b7856`   | [`33834470492`](https://github.com/chainlesschain/chainlesschain/actions/runs/33834470492) | 成功                       |
| CLI Strict Sandbox（三平台）                  | `1ff70b7856`   | [`33834470272`](https://github.com/chainlesschain/chainlesschain/actions/runs/33834470272) | 成功                       |
| npm Trusted Publishing / public-install check | `1ff70b7856`   | [`33837198632`](https://github.com/chainlesschain/chainlesschain/actions/runs/33837198632) | 成功                       |
| IDE 公共 listing                              | `1ff70b7856`   | Open VSX / JetBrains Marketplace API 回读                                                  | `0.37.81` / `0.4.110` 公开 |
| Record Replay UI Journey                      | 历史 exact SHA | 历史记录                                                                                   | 不被本版改写               |
| Desktop Signed Skill Qualification            | 历史 exact SHA | 历史记录                                                                                   | 不等于当前 native 发行     |

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
