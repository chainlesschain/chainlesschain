# Agent Platform 0.166.46 发布与升级指南

> 核对日期：2026-09-13。公开安装版本、源码和历史资格证据分别记录，不能相互继承发布授权。

## 概述

npm 官方 registry 的 `latest` 为 `0.166.46`，标签 `v-npm-0-166-46` 对应提交 `b15104ebbe100e72b366d452f0c6f779564197d3`。此版本恢复没有配置 evolution deployment 时的普通 Agent 聊天，并修复缓存标识绑定的隐私误报。

普通聊天只需要有效模型配置。candidate、Eval、Workbench、知识合并和 Skill 发布仍需管理员配置受信治理宿主；已配置治理链发生验证错误时不会降级。automatic active promotion 继续保持 HOLD。

精确发布提交的 [CLI CI](https://github.com/chainlesschain/chainlesschain/actions/runs/34728599936) 和 [CLI Strict Sandbox](https://github.com/chainlesschain/chainlesschain/actions/runs/34728599741) 已通过 Linux、Windows、macOS 配置任务，[npm 发布](https://github.com/chainlesschain/chainlesschain/actions/runs/34728731616)成功；2026-09-13 回读公共 registry 为 `0.166.46`。

本文按源码 `a1db1f98aa` 核对。VS Code 源码为 `0.37.96`，推荐 CLI `0.166.46`；源码变化不作为商店或 Desktop 安装包发布证明。

## 2026-09-13 主分支新增能力与使用方式

以下增量位于 `main@a1db1f98aa`，尚未进入 `v-npm-0-166-46` 的提交祖先链。命令示例面向该源码构建，安装公开 `0.166.46` 不保证具备这些命令。公开版的主要修复是普通聊天与缓存标识绑定；不要把主分支的协议或模型能力当作 npm 制品已发布功能。

| 能力           | 操作与行为                                                         | 保留边界                                                                   |
| -------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| 模型能力诊断   | `cc llm capabilities --json` 显示窗口、输出预算、目录版本与 digest | 不访问凭据、不联网、不写配置；`runtimeVerified:false` 是静态诊断的预期状态 |
| 原生 Responses | 精确官方 endpoint 与目录明确标记的模型由 profile 选择协议          | 第三方兼容网关保留 Chat Completions；不代表真实账号认证                    |
| 延后回答       | 偏好和补充信息问题可保持 pending，Agent 继续独立工作               | 决定和授权仍需等待；过期答案不授予权限；不承诺未回答问题跨断线恢复         |
| 中文记忆召回   | Context Memory Kernel 新增受治理中文词法检索                       | 召回仍按作用域和治理状态过滤                                               |
| 沙箱能力报告   | `cc sandbox capabilities --no-probe --json`                        | 查询时 applied 为空；成功启动子进程后才报告实际应用                        |
| 插件评测与容量 | control/candidate 绑定评测；持久 Memory/后台状态基准               | 不自动激活插件，不构成性能 SLO；后台列表索引与分页尚未交付                 |

新建 Volcengine 文本配置延续 DeepSeek V4 Flash GA 默认值；已有配置不迁移。Responses 使用 `store:false`，不完整工具调用不会进入执行器，加密 reasoning item 仅用于协议连续性。

普通聊天报 `CC_AGENT_EVOLUTION_INGRESS_FAILED` 时先确认已升级 `0.166.46`；若配置了治理部署，应检查描述符、trust root、摘要及授权范围。不要为普通聊天部署测试 authority。Agent shell 的 Docker/bubblewrap 不支持域名级 allow/deny；Docker 也不支持细粒度文件规则，不支持组合在启动前拒绝。

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

下表保留 0.166.38 发布时点记录；当前 CLI 安装使用 0.166.46，IDE 与其他组件的商店版本需按各自发布渠道核对。

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
npm install --global chainlesschain@0.166.46 --registry https://registry.npmjs.org
cc --version
cc agent --capabilities
cc agent
```

## 安装与升级

### CLI

```bash
npm install --global chainlesschain@0.166.46 --registry https://registry.npmjs.org
cc --version
cc agent --capabilities
```

`cc --version` 预期输出 `0.166.46`。`cc agent --capabilities` 应能执行，但其中某项显示 disabled/unavailable 可能只是当前宿主没有注入生产 authority，不应以测试密钥或环境变量绕过。

### SDK 与协议

```bash
npm install @chainlesschain/agent-sdk@0.2.9
npm install @chainlesschain/agent-protocol@0.1.9
python -m pip install chainlesschain-agent-sdk==0.2.8
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
| Agent 能力     | `cc agent --capabilities`            | 显示能力不等于 production composition 已启用                   |
| IDE 安装       | Open VSX / JetBrains Marketplace     | 按商店公开版本安装；源码 VS Code `0.37.96` 推荐 CLI `0.166.46` |
| 更新检查       | `npm view chainlesschain version`    | 应从官方 npm registry 回读                                     |

- candidate 创建、Wiki 更新或 Memory 接受都不授予 active 写权限。
- 客户端 option、环境变量和本地测试密钥不能创建 production composition。
- Ledger 断链、witness 不一致、receipt substitution、陈旧 revision 或跨 tenant 输入会阻止 mutation。
- npm CLI 包不包含 Electron Desktop 字节；历史 Desktop qualification 不等于当前 native fresh-install/upgrade/rollback 已发行。

## 性能指标

本版本不把本地单测耗时或 CI wall time 承诺为用户 SLA。运行时保持有界队列、容量限制、超时、lease/fence 和恢复语义；生产部署应按目标 provider、存储、网络与 grader 重新建立延迟、吞吐和恢复时间基线。

## 测试覆盖

当前 `0.166.46` 的精确提交与三平台门见本页概述。下表保留历史 `0.166.38`、SHA `de8ec4e5c8234087d1fb86a062371b7000931790` 的公共门，不能代替当前或下一版发布验收：

| 门禁                                  | GitHub Actions run                                                                         | 状态 |
| ------------------------------------- | ------------------------------------------------------------------------------------------ | ---- |
| CLI CI（Linux/Windows/macOS）         | [`34290643410`](https://github.com/chainlesschain/chainlesschain/actions/runs/34290643410) | 成功 |
| CLI Strict Sandbox（三平台）          | [`34290648161`](https://github.com/chainlesschain/chainlesschain/actions/runs/34290648161) | 成功 |
| IDE Extensions                        | [`34300419533`](https://github.com/chainlesschain/chainlesschain/actions/runs/34300419533) | 成功 |
| npm Trusted Publishing 与公共安装检查 | [`34295661756`](https://github.com/chainlesschain/chainlesschain/actions/runs/34295661756) | 成功 |

Open VSX `0.37.92` 和 JetBrains Marketplace `0.4.119` 已分别完成公共 listing 回读。npm tarball、VSIX、JetBrains ZIP、Desktop native 仍是独立制品身份。

## 安全考虑

- 保持默认禁网 `workspace-write`；不要以测试密钥、环境变量或 UI 输入伪造生产 authority。
- promotion、rollback、kill-switch 与 canary 必须复核 tenant、candidate、active revision、policy 和 evidence binding。
- Ledger 断链、witness 分歧、陈旧 lease、receipt substitution 或迁移歧义都应中止状态变更并保留现场。
- Desktop、IDE、SDK 和 CLI 是不同发布制品；一个渠道的成功证据不能授权另一个渠道。

## 故障排查

**`unknown command 'agent'`**：这通常是旧版公共安装与 Session Core 导出不匹配。升级到 `0.166.46`，再运行 `cc agent --capabilities`。

**npm 镜像返回 E404**：显式使用官方 registry：

```bash
npm install --global chainlesschain@0.166.46 --registry https://registry.npmjs.org
```

**官方 VS Code 搜不到扩展**：Microsoft Marketplace 尚未公开；从 Open VSX 下载 `0.37.92` VSIX。

**JetBrains 版本过旧**：刷新 Marketplace 元数据并确认当前公开版为 `0.4.119`。

**普通启动仍检查 Docker**：确认 `cc --version` 为 `0.166.46`，再检查 CLI flag、settings 或 managed policy 是否显式选择容器隔离。

**Workbench/Knowledge 提示 trusted deployment host required**：当前进程未接入部署治理宿主。保持失败闭合，由管理员配置 identity/policy/ledger/KMS authority；不要回退到本地直写。

**能力显示 unavailable**：这通常表示宿主没有配置可信 adapter 或 authority。保持失败关闭，由管理员按部署设计补齐，不要复制 candidate 到 active 目录。

## 关键文件

- `packages/cli/package.json`：CLI 公共版本与打包入口。
- `packages/session-core/package.json`：Session Core 版本与导出边界。
- `packages/cli/src/lib/agent-evolution-runtime-composition.js`：受治理进化的组合入口。
- `packages/cli/src/lib/evolution-run-store.js`：耐久 EvolutionRun 状态。
- `packages/cli/src/lib/evolution-ledger.js`：防篡改事件账本。
- `docs/design/modules/112-governed-skill-evolution-design.md`：完整设计与生产缺口。
- `docs/design/modules/113-governed-desktop-model-ingress-design.md`：Desktop 模型入口、失败闭合和缓存/witness 设计。

## 相关文档

- [受治理的 Skill 自进化](/chainlesschain/governed-skill-evolution)
- [CLI Runtime 当前实现](/chainlesschain/cli-runtime-current)
- [自进化 CLI 命令](/chainlesschain/cli-evolution)
- [Context/Memory Kernel](/chainlesschain/context-memory)
- [IDE 插件完整指南](/chainlesschain/ide-plugin)
- [Desktop 模型治理与失败闭合](/chainlesschain/desktop-model-governance)
- [设计文档：受治理的 Skill 自进化](/design/modules/112-governed-skill-evolution-design)
- [设计文档：Agent Platform 发布与运行时边界](/design/modules/110-agent-platform-release-boundaries)
