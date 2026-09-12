# EVO-P0-4 仓库闭环核验（2026-09-12）

状态：**尚未闭环**。本清单按[原任务 §5.4](../AGENT_SELF_EVOLUTION_GAP_ANALYSIS_2026-09-01.md)核对证据，不以默认拒绝、测试文件存在或旧提交绿灯代替完整验收。最终入口清单见[模型入口审计](EVOLUTION_MODEL_ENTRY_AUDIT_2026-09-08.md)。

## 完成条件与证据边界

| 原要求                                                                               | 仓库中的验证位置                                                                                                                    | 当前判定                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Raw 加密、ACL、tenant、retention；Raw/model/trusted 独立摘要与转换凭据               | `evolution-evidence-projector.test.js`、`evolution-artifact-ports.test.js`、真实 production composition                             | 已有实现和分层测试；不能据测试 authority 声称生产 KMS/PKI 已部署                                                                                                                            |
| 最终模型请求消费认证投影，证据失败不回退 Raw 或报告成功                              | CLI production composition、Desktop workflow/provider/cache、Hub 默认 SDK transport、各客户端拒绝测试                               | 本轮继续核实实际成功链与拒绝链；打包后的模块身份和最终 CI 仍需独立证据                                                                                                                      |
| Wiki 只消费 trusted projection，隔离不可信来源并区分观察、陈述和推断                 | `evidence-backed-wiki-maintainer.test.js`、`evolution-run-wiki-maintenance-source.test.js`                                          | 已有分层测试，不等同 1,000 条完整学习旅程                                                                                                                                                   |
| Candidate schema/name/path/symlink/size/明文控制                                     | `skill-candidate-registry.test.js`                                                                                                  | 已有实际存储边界测试，包含跨租户、路径与秘密明文拒绝                                                                                                                                        |
| Promotion 显示 capability/permission diff，独立验证和真人 quorum，禁止 proposer 自批 | `skill-promotion-review.test.js`、promotion/controller/ledger 测试                                                                  | 已有实现和分层测试；独立审批不能用测试中的恒真 verifier 替代验收                                                                                                                            |
| 1,000 条对抗轨迹：零未经审查 active 修改、零 secret 进入 Wiki/Skill 明文             | 八个 `evolution-adversarial-wiki-journey-shard-*` 入口，真实 Wiki→Candidate→active 边界及存储读回                                   | **尚未通过全量验收**：首轮第 58 批和第二轮第 69 批分别暴露正文摘要与测试引用格式误报；两处均定向修复并通过原批次，第三轮完整 1,000 条重新运行中，不拼接旧批次，也不以 detector 循环替代旅程 |
| 删除/撤销后定位并处置全部派生 pattern/candidate；默认 60 秒窗口                      | `evolution-raw-deletion-cross-process.test.js`、`skill-revocation-cross-process.test.js`、candidate admission/quarantine 跨进程测试 | 已有实际跨进程恢复用例；Raw crypto-shred 单例不能单独证明全部派生对象传播。最终提交需取得相关组的完整结果                                                                                   |
| 所有实际运行入口及自动门禁有最终源码身份对应的结果                                   | CLI CI、CLI Strict Sandbox、CI Tests、Android Tests、iOS App Remote Session Recovery                                                | **未取得最终提交完整 CI**；本机没有 Swift/Xcode，iOS 静态断言不等同编译/行为测试                                                                                                            |

表中 JS 测试位于 `packages/cli/__tests__/unit` 或 `integration`，不是只凭名称判定通过。§9 指明样本量和时延需按风险写入版本化 policy；本清单仍保留 §5.4 的默认 1,000/60 秒验收，不将其悄悄删除或替换成更容易的目标。

## 本轮已取得的直接证据

- 核心安全分层回归：`evolution-evidence-projector`、`skill-candidate-registry`、`skill-promotion-review` 三文件 **132/132** 通过（43.13 秒）。包含两个已有 1,000 样本循环，但仍不将其解释为完整学习旅程。
- Desktop `34de841dc1`：无宿主时在读取旧缓存、压缩、工具回调之前拒绝；4 个定向文件 **88/88** 通过。真实 composition 首轮 **14 通过、5 失败**；补齐并发测试的 `calculateCacheKey` 导入后，原失败集 **4 通过、1 超时**。最后一项拆为缓存并发/跨 Run 篡改、普通摘要和流式摘要三例，保留全部 29 处断言与原 120 秒单例上限，三例 **3/3** 通过（总 186.93 秒）。按最终用例名称去重，这组 Desktop 行为有 **21 项分批通过**，不是同一次完整 CLI suite 全绿。
- Android `af2ec8bed3`：未使用服务的 `close()` 不构造 ML Kit；实际 Gradle/Kotlin/Hilt 与 JUnit **8/8** 通过。不是设备 UI/E2E 矩阵结果。
- iOS `e9077296c8`：实际 LLM 源文件接入条件 SwiftPM 测试目标；注入 URLSession 验证零请求，保留 `/models` 健康控制面；VisionAction 不再吞治理拒绝。Node 静态 **6/6**、既有 workflow 契约 **2/2** 通过；新增 Swift XCTest 尚未执行。另 13 个 legacy Vision/Speech 等源文件不在 app Sources phase，只能标为 source-only。
- Backend `15b1cd0b82`：已复现并修复 `import main` 在模块级代码助手构造处失败。真实 main/ASGI 生命周期、非模型路由、七个代码路由和流式拒绝、应用网络零连接及 Whisper 组合 **65 passed、4 subtests passed**（Python 3.12）。模型入口仍明确返回 `503 / CC_AGENT_EVOLUTION_INGRESS_FAILED`，不宣称已提供受治理推理能力。
- CI `15b1cd0b82`：`CI Tests` 新增 UniApp 两文件与独立 backend job；后者 checkout/校验 source SHA 并以同 SHA 上传 JUnit。UniApp **16/16**、完整 CI 契约 **41/41** 通过（含新增 2 条，不重复计数）。workflow 写入不代表 Actions 已执行。
- Hub 默认 adapter 与双物理副本接线：最终三个文件 **60/60** 通过（254.56 秒），包括原 33 项、9 项双 SDK copy 和 18 项 Desktop 客户端实际地址/身份用例。默认 chat/embedding 仅在认证 Run 投影后使用私有 transport；SDK 公开原始入口仍拒绝。Desktop 使用宿主私有 SDK ports 保留各副本 WeakSet，不共享全局品牌；远端 Ollama 不再因 provider 名称绕过同意，resolver 默认远端 embedding 仍拒绝。SDK `bridges-cc-llm` 独立回归 **14 通过、8 既有跳过**。双副本测试使用真实复制的 SDK 文件和 Desktop 入口，但不等同完整安装包验收或最终 SHA 的 CI。首轮 60 项曾有测试断言范围错误、共享未提交模块导入错误及超时，修正后才取得上述完整全绿结果。
- 删除/撤销复验：Raw crypto-shred 与 Skill revocation 两个跨进程文件 **2/2** 通过（87.53 秒）；四个故障恢复窗口分别为 release pointer **15,542ms**、Wiki commit **3,874ms**、dependencies **13,976ms**、checkpoint **10,162ms**，均小于 60 秒。这不是整个 suite 必须小于 60 秒，也不替代 candidate 专项或目标部署演练。
- Candidate admission/quarantine 跨进程组合首轮 **8 通过、1 失败**；失败为 `after-dependency-prepare (wiki)` 子进程 `ETIMEDOUT`，该次运行记录有约三小时墙钟跳变。保留原超时设置定向重跑该例 **1/1** 通过（65.76 秒）；按用例去重为 **9 项分批通过**，不是同一次组合全绿，也不能用整例耗时推定撤销传播窗口。

## Run→Wiki 正式接线基础批次（仍非闭环）

正式 `wikiMaintenance` opt-in composition 已连接真实 Run membership→认证 manifest 重读→`EvolutionEvidenceReader.readTrusted()`→typed Wiki evidence→持久化 Wiki revision。默认仍为 `null`；宿主必须提供当前 evidence state、principal、access policy 和固定 schema allowlist，不接受调用方手工 `trustedProjection: true` 或替换 resolver。宿主获得维护/读 Wiki 的窄接口，不获得 Raw 或 active 写权限。

- Resolver、composition、旧 Run adapter 三文件冻结后 **35/35** 通过（306.87 秒）：包含 17 项桥接、8 项正式接线、10 项兼容回归。另有旧 composition **4/4** 定向通过，其余 222 项未执行。原生 Node import、格式与差异检查通过。
- 修复 Run checkpoint 将 `verify().verifiedAt` 观察时间误当账本变化的问题；仅时间前进可以继续，真实 head/witness/身份变化仍拒绝。来源摘要采用稳定 source commitment，不能用新 Raw nonce 制造独立来源。
- 已真实复现并修复：推导期间单条证据撤销仍可落 Wiki，以及相同内容换 principal 被误算独立佐证。Maintainer 提交前重读证据；corroboration 按内容摘要与 trust domain 的最大匹配计数，不是分别计两个集合大小。单个真实 grader receipt 的既有语义不变。
- 推导输出另有秘密明文缺口：7 项先行反例均曾错误写入。现完整 outgoing Wiki state 复用 Raw/Skill plaintext guard，覆盖 pattern、index、理由、log 与 metadata 值；只在对应元数据字段豁免精确协议 digest/revision ID，不豁免相同形式的正文。最新 Maintainer 单元 **30/30** 与真实存储 **6/6** 分批通过；后者含提交期间 revoke/delete/TTL/ACL、重复签名、derive 新增 secret 时零 artifact/ledger 写入。
- 相关 projector/Wiki adapter/Proposer 三文件 **113/113** 通过；加入明文 guard 后 Maintainer/Wiki adapter/Proposer **47/47** 阶段性通过。上述有重叠，不相加为独立用例总数。
- 最新删除/撤销两个跨进程文件 **2/2** 通过（103.95 秒），四个恢复窗口为 **20,782 / 7,584 / 12,468 / 12,594ms**，仍保持 60 秒上限。

基础批次还真实复现了整组授权缺口：复读 A 成功后、等待复读 B 时撤销 A，仍可提交旧 A。Reader 的短期 read decision 不是不可撤销的 commit lease；现有同账本 Knowledge admission fence 也不覆盖外部 evidenceState/ACL。下一节记录对此缺口的独立修复，不把串行重读解释为原子提交授权。

完整 1,000 旅程测试已在工作区实现并开始全量验证，使用真实签名 Raw/Run/Reader/Wiki/Candidate、既存 active 文件及真实 Review/Controller/Registry 拒绝边界。50 样本长账本 pilot 已实测超线性成本，改为 **100×10，总量不变**；试跑与未完成长测均不计作 1,000 验收通过。既存 active 的测试 bootstrap 不代表真实外部人工批准或候选效果 Eval。

## 整组证据提交保护（独立批次）

`wikiMaintenance` 现在还必须显式提供 `commitCoordinator.acquireCurrentEvidence(request)`。缺失或异步 coordinator 在创建存储之前拒绝；默认关闭行为不变。`wiki-evidence-commit-guard.js` 将完整待发布 revision、tenant/Run/principal、前态和输出证据绑定交给同步 coordinator。授权方只收到数据，不获得 publish 回调或 Wiki 写入能力。

租约必须覆盖状态、principal、ACL/policy 的整组锁，或覆盖实际写入窗口的不可撤销授权；普通 read receipt/过期时间不能冒充该契约。guard 检查不可变、一次性、完全匹配的租约，随后同步执行 `assertCurrent → 真实 Wiki commit → finally release`。绑定覆盖所有非终态输出 pattern 的正反证据（包括旧 state 被重新使用的依赖），加上本次读取的 active 证据；超过 256 项直接拒绝，不截断。终态清理不重新暴露旧证据，可以继续执行。

- 边界单元 `wiki-evidence-commit-guard.test.js` **24/24** 通过（93.80 秒）：拒绝时真实文件逐字节不变、跨 guard 重放拒绝、真实 CAS 冲突释放，以及同步提交一次。提交后 release 抛错或返回 Promise 时明确报告 `committed: true`，不谎称已撤销落盘。
- 最终 lint 等价整理后，边界 24 项和真实存储旅程 3 项两文件 **27/27** 再验通过（174.68 秒）。真实旅程验证 A 在 B 复读期间撤销时零 Wiki 写入、持锁跨实际落盘后再允许撤销，以及旧 state 的 A 被新请求复用时拒绝但仍可提交终态清理。
- 最终 coordinator 前置捕获接线的 composition **9/9** 通过（101.26 秒）；冻结 fixture 的 resolver 与 current-evidence 两文件 **23/23** 通过（367.50 秒），包含原单证据撤销/删除/过期/ACL、重复内容和派生 secret 回归。
- 测试 fixture 使用拥有同一状态的进程内 authority，锁内 revoke/ACL/时钟修改要求释放后重试。这不等同部署了跨进程锁服务；生产 host coordinator 的跨进程语义仍属于部署验收。

新 guard 接入的 **10 条完整对抗试跑**通过（单批 354.49 秒，总 362.36 秒）；16 个攻击族、1,000 个不同 ID/payload 与 8 个真实 CI 测试入口的 catalog 断言单独通过。真实 release guard 专项 **1/1** 再验通过（27.51 秒）。这些试跑仍不是 1,000 条执行结果，相关测试代码将待全量验证后独立提交；此批次不包含全量验收，也不意味着最终 CI 已通过。

本提交保护批次按最终用例去重为 **59 项分组通过**（27 + 9 + 23），不是整个 CLI suite 或多系统 CI 全绿。六个相关代码/测试文件的原生 import、ESLint、Prettier 和差异检查通过。

## 完整旅程暴露的 Candidate 摘要误报（2026-09-13）

首轮完整 1,000 条运行实际失败，不能计为验收通过。第 58 批在合法正控的 Candidate 创建前报 `SKILL_CANDIDATE_SECRET_LEAK`：真实 pattern 的证据摘要 `sha256:032ffbec8d945b6de7babb263fce8438d4f0e92c73e14229029435cd894531a4` 被重复序列化到候选正文，数字片段 `14229029435` 命中手机号规则。使用原批次、原输入单独重跑也失败（94.08 秒），排除只在全量负载下出现的猜测；不是攻击进入了 Wiki。

确认缺陷后停止原运行以避免修复前后源码混用。终止时有 **45 批 / 450 条**完成全部 final phase，第 58 批完成 0 条；原 session `97872` 最终 exit 1，主进程和两个所属 worker 均确认退出。原输出及终止摘要分别保留在临时目录的 `cc-adversarial-wiki-1000-20260912-terminated.log`、`cc-adversarial-wiki-1000-20260912-termination.json`；原 Vitest 完整 JSON 未生成，没有补造通过报告。原失败现场和独立复现现场均保留。

修复仅调整 Proposer 的候选正文表示：使用独立 `chainlesschain.wiki-informed-skill-candidate-content/v1` schema，移除根 `sourceEvidenceRefs` 的重复副本。完整证据列表仍由候选顶层元数据及 candidateId 绑定；原完整 proposal 和 proposalDigest 不变。PURPOSE 引用、machineDiff 和其余正文全部保留；没有修改 Registry 或共享秘密检测规则，也没有因 schema 名称、摘要外观或自算 hash 添加豁免。

proposalDigest 与 contentDigest 现在分别表示完整提案与候选正文，不能再假设两者相等。历史已保存候选继续按原字节验证读取；旧 pending plan 的 candidateId/contentDigest 若与新格式不同则拒绝，需重新生成计划并重新评估、审批，不能静默改绑旧凭据。引用 URI、wikiRevision 和生成器提供的 machineDiff 摘要仍接受原扫描，本修复不声称消除了所有可能的摘要误报。

提案 / 提案账本 / Wiki 协调三文件 **28/28** 通过（10.46 秒）；原 Candidate Registry / release-train domain stages 两文件 **35/35** 通过（19.87 秒）。后者补齐摘要拒绝用例的正确 candidateId，确保实际覆盖 contentDigest 不匹配分支。

使用未修改语料重跑原第 58 批，session `70326` 最终 **exit 0**：**1 个批次 / 10 条攻击轨迹**及全部 final phase 通过，单例 143.25 秒、总 149.69 秒；12 个其他用例因显式批次诊断过滤未执行。正控 Wiki、真实 Candidate 创建、负向 Reader/Maintainer、未审批发布拒绝和最终账本/Wiki 读回均实际完成。这不是完整 1,000 条验收；修复后将从头执行全部 8 个 wrapper，不将已通过的旧批次拼接为新全量成功。

新增独立 `wiki-skill-candidate-content.test.js` **14/14** 通过（8.80 秒）：固化原 batch 58 的真实 pattern preimage 并重算精确摘要，使用真实 Registry 写入、新实例打开和磁盘读回；同时确认旧完整正文仍复现误报、正文与 machineDiff 中的相同数字仍拒绝、调用方伪造新 schema 不获得豁免、完整外层证据变化仍改变 candidateId。测试也实际保留旧候选字节并运行 Candidate stage，拒绝旧计划与新正文身份不匹配；不将测试用 typed evidence/admission 端口称为外部认证部署。

最终将上述六个相关文件同次运行，session `55597` **exit 0，77/77、零跳过**（39.71 秒）；四个变更代码/测试文件的 ESLint、Prettier 与差异检查通过。该组结果包含前述分组回归，不重复相加；不等同完整 CLI suite、1,000 条旅程或多系统 Actions。

编码能力边界另有真实存储诊断：字面反斜杠 `\u...` 形式的手机号与 secret 文本可以保存并原样读回，解码后的对应明文则被拒绝。新回归中的 JSON 解码、转义引号及全角数字用例不等于任意编码 secret 检测；本次没有新增共享 guard 的解码能力。独立诊断结果及现场保留于临时目录 `cc-candidate-escaped-diagnostic-96c900684ec04f808571a15f586730a9`，不计为安全拒绝通过用例。

第二轮从头执行全部 8 个 wrapper，session `68309` 自然结束为 **exit 1**：8 个文件中 7 个通过、1 个失败，101 个测试中 **100 通过、1 失败、零跳过**。全部 100 个批次均实际启动，其中 99 批完成 990 条轨迹及 final phase；第 69 批在合法 Candidate 创建前完成 0 条。失败的认证 Wiki state digest 为 `sha256:652490e195f44f34d5040ec16088111606ee28a7b0b483618732434179c8e444`，其中数字片段 `16088111606` 命中手机号规则。测试 helper 自选的自由文本引用把该 digest 同时写入 pattern 和 wiki-index ref，随后进入 Candidate purpose 与顶层 `sourceEvidenceRefs`；真实 Registry 按既有策略正确扫描并拒绝这些引用。没有 Candidate 文件落盘，失败现场仅存在租户元数据。该轮耗时 7,784.83 秒；完整 JSON、日志、phase 审计和身份审计分别保留为临时目录中的 `cc-adversarial-wiki-1000-20260913-repaired.json`、同名前缀 `.log`、`-phases.json` 与 `-audit.json`。13 个执行源哈希在该轮前后完全一致，仍不能把 990 条与后续定向结果拼成 1,000 条通过。

生产契约对证据引用的要求是稳定身份、独立 `digest=hash(data)`、认证 Wiki revision 与持续的明文扫描，不要求把 state digest 再嵌入自由文本 ref。测试 helper 因而改用结构化不透明引用 `wiki-evidence://<tenant>/<run>/revision/<revision>/<kind>[/<subject>]`；tenant、Run、认证 revision、证据类型及可选 pattern 身份仍绑定，实际 envelope digest、Raw/Run/Wiki、lineage、攻击 payload/ID、发布边界和所有断言不变。生产 Proposer、Candidate Registry 及共享秘密检测规则均未放宽；旧的含手机号形数字引用仍按原策略拒绝。反向应用这一小段 helper 差异可精确恢复原文件哈希，证明没有夹带其他语料变化。

修复后只重跑原第 69 批，session `29238` 最终 **exit 0**：**1 个批次 / 10 条攻击轨迹**及全部 final phase 通过，单例 165.67 秒、总 169.55 秒；其余 11 个批次用例因显式名称过滤未执行。修复后的 helper SHA-256 为 `7C631C714A61A35AE23D96AD50B32E9F07392923186DD5270F0BD6E4EF5CA3ED`，其余 12 个执行源保持不变。该结果仍只是失败复现的定向关闭；第三轮已从头启动全部 8 个 wrapper，只有其自然终态满足 100 批、1,000 条、零失败/零跳过且 13 个哈希稳定时，才能接受完整旅程门禁。

## CLI CI 的真实恢复冒烟修复

远端 `verify-cli` 的原冒烟脚本直接注入 `chatFn` 与未绑定的 `_autoCompactor`，不再符合正式模型入口的认证要求。现脚本从目标 runtime 加载真实 composition 和 Agent core，由仓库 fixture 提供明确的测试 authority；每种场景有独立 Run，实际请求通过认证投影发送到本机 Ollama 协议服务。没有增加生产绕过或测试专用 ingress 标志，用户配置、安全锚点和临时状态均隔离。

真实接线另外复现出宿主提示文案误判：两种恢复提示中的“bypass policy”即使处在否定告诫中，仍被现有注入检测规则隔离，使模型收不到恢复提示。仅将这两句改成正向的遵守权限、拒绝时停止并报告阻塞的说明；不放宽投影规则、不豁免 system 文本、不降低恢复断言。

- `remote-read-loop-guard.test.js` **43/43** 通过（3.29 秒），新增两种真实提示的注入风险检查及权限限制语义断言。
- 最终源 `pr-recovery-smoke.mjs` **exit 0**（约 4 分钟）：原三种场景、原停止调用次数和拒绝命令零执行断言保留；另验证真实 canonical kernel 已提交压缩、消息减少且节省 token。实际 **18 次本地 provider 请求、0 次摘要请求、0 次 GitHub 请求**；压缩正控是确定性压缩，不声称执行了模型摘要。
- 三个相关源/测试文件的 ESLint、Prettier、差异检查通过。该证据仅针对源脚本，未将其解释为已安装 payload 或最终三系统 Actions 通过。

## 实际安装后的治理运行时门禁

补充核验发现，原 `CLI Global Install Smoke` 仅在 Linux/Windows 执行真实 tarball 全局安装和 `--version`，PR checkout 仍是 merge ref；它不能证明新模型入口在安装后的私有模块身份下可运行。该既有 job 现扩到三系统，并固定、验证完整 PR head SHA；保留真实 postinstall、无 Python/强制 native 源构建的可选依赖测试和原 20 分钟上限，不使用源码依赖安装或忽略脚本来替代全局安装。

全局安装后先从 `npm root -g` 定位 CLI，检查 CLI evolution/runtime/harness、Hub/恢复 guard 与从该 CLI **实际解析**的 SDK 三个治理模块逐文件身份，再将同一个安装目录交给真实认证入口的 PR 恢复冒烟。检查拒绝源码目录、软/硬链接、同版本字节漂移以及被全局同级新 SDK 掩盖的旧嵌套 SDK。其范围是这些治理运行时，不声称验证所有发布资源或生成完整 SBOM。

身份检查器的纯 Node 正反例直接进入上述三系统 job；工作流契约还要求身份检查先成功，再执行带安装目录参数的冒烟，不能无参数回退源码。当前另已取得下述 Windows 实际安装证据，但真实三系统 tarball 安装与目标运行仍须取得最终 SHA 的 Actions 结果。

独立复核还真实复现了检查器自身的解析原点遗漏：根目录 SDK 正确，但 `src/lib/node_modules` 中的旧 SDK 被实际 Hub 消费者选中，初版检查仍通过。已改为从实际 `governed-hub-llm.js` 路径解析，新增该反例和正常全局同级 SDK 正控。最终身份检查 **12 项**与 CI 契约 **45 项**同次 **57/57、零跳过**通过（5.35 秒），不是 57 项实际安装旅程；该工作流 YAML/actionlint 及相关代码格式、ESLint 检查通过。

### Windows 真实 tarball 安装复验

受测源为干净隔离分支的 **`9a1d747c761775565ea0d9201c52fc64f92769e9`**，Node **22.22.2**；已整合远端 help index，并保留本地完整认证/压缩恢复脚本。验证前后 HEAD 与干净状态一致，未在源码目录安装依赖。

- CLI 与十个精确内部依赖共 **11 个真实 tarball** 打包成功（66.92 秒）；临时全局 prefix 的真实安装 **exit 0**（163.20 秒，446 个依赖），未使用 `--ignore-scripts`。保留强制 native 源构建和无效 Python 路径，可选原生模块确实尝试构建并失败，但不阻断便携 CLI。
- 身份检查 **exit 0**（11.27 秒）：CLI **242 个**相关文件与实际解析到的 SDK **3 个**治理模块均匹配受测源；SDK 是实际临时全局同级物理目录，不是工作区链接。
- 显式安装目录的认证恢复冒烟 **exit 0**（185.48 秒），原三种 PR/拒绝恢复场景及真实 canonical compaction 正控全部通过。实际 **18 次本地 provider 请求、0 次模型摘要请求、0 次 GitHub 请求**；不是外部模型或真实 GitHub PR 操作。
- 临时 prefix 的 `cc`、`chainlesschain` 两个真实 shim 都返回 **0.166.45**。真实 postinstall 在隔离 APPDATA 下产生 **9 个技能包、18 个非空文件**并读回；npm 配置/cache、应用 home、anchor 和 transaction 目录全部隔离，未改用户全局安装。

同一执行 session `93105` 最终 **exit 0**。完整报告和日志保留于临时证据目录 `cc-evo-installed-probe-c085969a52794995a57a34d3f8546274` 的 `report-escalated.json`、`probe-escalated.log`；日志 SHA-256 为 `ec387077f4d2b4cbfafc21fb3739d8130525790240bf61d2aee863f3476b67d8`，CLI tarball SHA-256 为 `0a35c25c23cc15795fd10c9caec5722972911236ba6739ed6a944f957b1885bf`。首次执行在打包前被沙盒目录权限拒绝，保留失败记录；按权限流程授权后才得到上述完整终态。该结果仅证明本地 Windows 的精确受测提交，不替代最终提交的 Linux/macOS/Windows Actions，也未发布 npm。

## 最终源码身份与 CI 结果门

Android Tests 新增指定 `commit_sha` 的手动入口，并将 workflow 自身路径加入 push/PR 触发。五个实际 checkout job 都从同一个 `SOURCE_SHA` 取源码，在构建前校验完整 SHA 与 `git rev-parse HEAD` 一致；可控输入通过环境变量传入 shell，不直接拼入命令。既有测试矩阵和任务不减少。

新增 JUnit 结果门读取实际 Gradle XML，要求 file-browser 的 8 项、feature-ai 的 3 项、app PDH 的 1 项已有治理测试全部执行、零失败且零跳过；缺文件、空报告或不完整结果均失败，不能以 `NO-SOURCE` 代替原生测试。上传的单元报告名绑定源码 SHA。CI Tests 的 Desktop 三系统 Unit Tests（含 Linux UniApp）也固定并校验 PR head SHA；Backend 已有相同约束，无需重复改写。

三个 workflow/契约文件的最终本地验证为 **44/44、零跳过**（9.44 秒），包含实际执行 Python XML 判定器的 8 种正反例；YAML、actionlint、ESLint、Prettier、差异检查通过。这是门禁实现的验证，不是新的 Android 构建或 Actions 运行结果。

最终验收需要逐项检查下表，不只看分支保护的既有 required contexts：

| 工作流                          | 必须取得的结果与身份                                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| CLI CI                          | 三系统 52 个 unit/integration/e2e shards、三系统 verify-cli、两个 PR dry-run；精确 head SHA                               |
| CLI Strict Sandbox              | Linux、macOS、Windows 三个实际内核边界任务；精确 head SHA                                                                 |
| CI Tests                        | Backend 真实启动/拒绝、Desktop Unit Tests 三系统及 Linux UniApp、三系统 CLI 实际全局安装/治理身份/认证冒烟；精确 head SHA |
| Android Tests                   | 保留全部既有单元、API 28/30 instrumentation、coverage、lint、汇总门；同一源码 SHA，12 项实际治理 JUnit 齐全               |
| iOS App Remote Session Recovery | 实际 SwiftPM 源码测试、静态契约、unsigned simulator build 和产物检查；精确 `commit_sha`                                   |

PDH 两系统及 Full Test Automation 两系统仍提供补充回归；其既有 PR checkout 为 merge ref，不冒称精确 head SHA。本次 Android workflow 改动会自行触发 PR 验证；iOS 不在本次源码 diff 内，需获授权后用既有手动入口测试最终 SHA。手动触发的默认分支要求见 [GitHub 官方说明](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)。未修改分支保护，也未执行 push、PR 创建或 workflow dispatch。

## 远端身份快照

2026-09-12 17:56（上海）查询时，本地 `af2ec8bed3a033ae5b87ee50185ad96e732a3af8` 和 iOS 变更提交 `e9077296c84f7690fadc6361689627fb945b5c7b` 均无 Actions run。GitHub `main` 为 `13fe45afd66e3538e4c33c8e5309c253e3d1e3de`。

旧 SHA 的 Strict Sandbox、Android 和 iOS 已成功，CLI CI 与 CI Tests 当时仍在运行。这些结果不能继承给后续提交；后续提交/推送后须重新按实际 source SHA 查询完整结果，不发布 npm 或用旧绿灯标记仓库闭环。

22:36（上海）复核：GitHub `main` 已为 `3bd3101657c66e799ce3ab98092ef1b1bf8b5044`，与本地 `3d16e8ec2c3a3a6f9feaa0db23e5955653017df3` 分叉；远端独有修改是 command help index。后者仍无 Actions run。远端 CLI CI `34697066837` 的单元/集成/E2E shard 均成功，但三个系统的 `verify-cli` 失败；已取得 Ubuntu 直接错误：`pr-recovery-smoke.mjs` 调用 Agent loop 未提供认证 evolution ingress。该旧 SHA 的结果既不是最终全绿，也不能继承给本地新增提交。本地提交不等于推送或创建 PR。

## 与部署验收分开

生产 KMS/HSM、PKI/身份、policy/witness authority、目标部署的删除/灾备演练、真实攻击分布与误报校准仍需部署方验收。它们不能替代仓库测试，也不应被用作无限扩展仓库改造范围的理由。当前仍需完成的仓库证据，优先是完整 1,000 样本旅程、实际打包入口身份，以及最终提交自动门禁。
