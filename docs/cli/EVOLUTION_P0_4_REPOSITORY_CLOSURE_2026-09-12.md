# EVO-P0-4 仓库闭环核验（2026-09-12）

状态：**尚未闭环**。本清单按[原任务 §5.4](../AGENT_SELF_EVOLUTION_GAP_ANALYSIS_2026-09-01.md)核对证据，不以默认拒绝、测试文件存在或旧提交绿灯代替完整验收。最终入口清单见[模型入口审计](EVOLUTION_MODEL_ENTRY_AUDIT_2026-09-08.md)。

## 完成条件与证据边界

| 原要求                                                                               | 仓库中的验证位置                                                                                                                    | 当前判定                                                                                                                                            |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Raw 加密、ACL、tenant、retention；Raw/model/trusted 独立摘要与转换凭据               | `evolution-evidence-projector.test.js`、`evolution-artifact-ports.test.js`、真实 production composition                             | 已有实现和分层测试；不能据测试 authority 声称生产 KMS/PKI 已部署                                                                                    |
| 最终模型请求消费认证投影，证据失败不回退 Raw 或报告成功                              | CLI production composition、Desktop workflow/provider/cache、Hub 默认 SDK transport、各客户端拒绝测试                               | 本轮继续核实实际成功链与拒绝链；打包后的模块身份和最终 CI 仍需独立证据                                                                              |
| Wiki 只消费 trusted projection，隔离不可信来源并区分观察、陈述和推断                 | `evidence-backed-wiki-maintainer.test.js`、`evolution-run-wiki-maintenance-source.test.js`                                          | 已有分层测试，不等同 1,000 条完整学习旅程                                                                                                           |
| Candidate schema/name/path/symlink/size/明文控制                                     | `skill-candidate-registry.test.js`                                                                                                  | 已有实际存储边界测试，包含跨租户、路径与秘密明文拒绝                                                                                                |
| Promotion 显示 capability/permission diff，独立验证和真人 quorum，禁止 proposer 自批 | `skill-promotion-review.test.js`、promotion/controller/ledger 测试                                                                  | 已有实现和分层测试；独立审批不能用测试中的恒真 verifier 替代验收                                                                                    |
| 1,000 条对抗轨迹：零未经审查 active 修改、零 secret 进入 Wiki/Skill 明文             | 当前 projector 的两个 1,000 样本循环                                                                                                | **证据不足**：一个仅调用 injection detector，另一个仅投影并检查 quarantine；未运行完整 Wiki→Candidate→active 链。须补带合法正控、实际存储读回的旅程 |
| 删除/撤销后定位并处置全部派生 pattern/candidate；默认 60 秒窗口                      | `evolution-raw-deletion-cross-process.test.js`、`skill-revocation-cross-process.test.js`、candidate admission/quarantine 跨进程测试 | 已有实际跨进程恢复用例；Raw crypto-shred 单例不能单独证明全部派生对象传播。最终提交需取得相关组的完整结果                                           |
| 所有实际运行入口及自动门禁有最终源码身份对应的结果                                   | CLI CI、CLI Strict Sandbox、CI Tests、Android Tests、iOS App Remote Session Recovery                                                | **未取得最终提交完整 CI**；本机没有 Swift/Xcode，iOS 静态断言不等同编译/行为测试                                                                    |

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

**尚有已复现的整组授权缺口**：复读 A 成功后、等待复读 B 时撤销 A，仍可提交旧 A。Reader 的短期 read decision 不是不可撤销的 commit lease；现有同账本 Knowledge admission fence 也不覆盖外部 evidenceState/ACL。串行重读不能声称原子提交授权。下一批需宿主整组当前授权 lease/fence 覆盖实际发布窗口，再跑全部正式接线回归。

完整 1,000 旅程测试正在实现，使用真实签名 Raw/Run/Reader/Wiki/Candidate、既存 active 文件及真实 Review/Controller/Registry 拒绝边界。50 样本长账本 pilot 已实测超线性成本，改为 **100×10，总量不变**；试跑与未完成长测均不计作 1,000 验收通过。既存 active 的测试 bootstrap 不代表真实外部人工批准或候选效果 Eval。

## 远端身份快照

2026-09-12 17:56（上海）查询时，本地 `af2ec8bed3a033ae5b87ee50185ad96e732a3af8` 和 iOS 变更提交 `e9077296c84f7690fadc6361689627fb945b5c7b` 均无 Actions run。GitHub `main` 为 `13fe45afd66e3538e4c33c8e5309c253e3d1e3de`。

旧 SHA 的 Strict Sandbox、Android 和 iOS 已成功，CLI CI 与 CI Tests 当时仍在运行。这些结果不能继承给后续提交；后续提交/推送后须重新按实际 source SHA 查询完整结果，不发布 npm 或用旧绿灯标记仓库闭环。

## 与部署验收分开

生产 KMS/HSM、PKI/身份、policy/witness authority、目标部署的删除/灾备演练、真实攻击分布与误报校准仍需部署方验收。它们不能替代仓库测试，也不应被用作无限扩展仓库改造范围的理由。当前仍需完成的仓库证据，优先是完整 1,000 样本旅程、实际打包入口身份，以及最终提交自动门禁。
