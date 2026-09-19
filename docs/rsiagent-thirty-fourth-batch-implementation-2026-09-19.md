# RSIAgent 第三十四次工程实施：子进程监督证据耐久回读与 Manifest 绑定

> 日期：2026-09-19（Asia/Shanghai）<br>
> 前置实施：[第三十三次工程实施：PM Merger/Evaluator 进程隔离与签名监督证据](./rsiagent-thirty-third-batch-implementation-2026-09-19.md)<br>
> 状态：受监督子进程的 invocation、revocation 与最终 supervision receipt 现可在返回 PM 结果前全部写入 Ledger-backed child evidence store 并精确回读；PM 签名回执中的监督摘要与耐久记录使用同一 signed-evidence digest。隔离描述同时绑定 child evidence store descriptor，不能以同名但无耐久存储的 supervisor 替换。该能力已进入签名 Desktop deployment 工厂，但当前机器仍没有 operator 配置的生产 store、外部网络隔离或真实 Electron PM E2E，因此相关任务继续为“部分完成”。

## 1. 最终 supervision receipt 耐久化

`EvolutionEvalChildEvidenceLedgerAdapter` 的耐久证据种类从原有的：

- Gate receipt；
- target invocation evidence；
- target revocation evidence；

扩展为同时支持 supervisor enforcement receipt。无论 target 正常完成还是因 deadline 被硬终止，supervisor 都会在向调用方返回前：

1. 由 supervisor attestor 签发最终 receipt；
2. 按 supervisor purpose 计算 signed-evidence digest；
3. 调用品牌化 child evidence store 的 `retain()`；
4. 要求 authenticated、durable 的确认；
5. 立即按 tenant、kind、digest 调用 `resolve()`；
6. 比对 authority、revision、handler digest、stream、kind、digest 与完整规范字节。

任一步失败都阻止监督结果返回。非耐久确认、缺失记录、跨 tenant 请求、重复歧义、Ledger/artifact 绑定错误或回读字节替换均失败关闭。

## 2. PM 回执与耐久记录共用摘要

process runner、grader、merger、evaluator 不再为 supervision receipt 计算各自私有的平行摘要，而是统一使用 `computeEvolutionEvalSignedEvidenceDigest(..., supervisorPurpose)`。

因此：

- execution receipt v2 的 `runnerIsolationEvidenceDigest` 可直接定位耐久 supervision 原文；
- grader 的最终 `resultDigest` 折叠同一耐久 supervision 摘要；
- merge receipt v2 的 `mergerIsolationEvidenceDigest` 可直接定位耐久 supervision 原文；
- evaluator receipt v2 的 `evaluatorIsolationEvidenceDigest` 可直接定位耐久 supervision 原文。

签名 PM receipt、supervisor attestation 与 Ledger/artifact 记录不再依赖三个不同的摘要口径。篡改任一层都会在摘要、签名或精确字节回读处失败。

## 3. 耐久能力进入隔离绑定

process supervisor 现在公开只读的 `childEvidenceStoreDescriptor`；未配置时为 `null`。PM 各角色隔离描述中的 `supervisorAuthorityDigest` 同时覆盖：

- supervisor authority descriptor；
- child evidence store descriptor 或明确的 `null`。

因此，manifest 捕获了该角色究竟由“带哪一个耐久证据 authority 的 supervisor”执行。即使 target、supervisor handler、revision 和 signer 全部相同，用未配置 child evidence store 的 supervisor 替换已声明的耐久 supervisor，也会因隔离描述不同而在 host 创建阶段被拒绝。

store descriptor 固定 tenant、stream、authority ID、revision 和 handler artifact digest；它不把 Ledger、artifact store 或写入闭包暴露给子进程。

## 4. 签名 Desktop deployment 装配

允许 `desktop` 的签名 deployment 新增 `createEvolutionEvalChildEvidenceLedgerAdapter()` 工厂。该工厂的 `descriptor.handlerArtifactDigest` 必须等于已验签 deployment 模块摘要，不能由部署模块替换为其他 handler。

deployment 可使用已有的：

- `createEvolutionArtifactPorts()`；
- `createEvolutionLedgerDurableArtifactResolver()`；
- `createEvolutionEvalChildEvidenceLedgerAdapter()`；
- `createEvolutionEvalProcessSupervisor()`；

组装真实 Ledger-backed child evidence store，再把它注入四角色 process supervisor。该接线不自动创建生产 Ledger/密钥，不新增 renderer/IPC 写入口，也不放宽 Desktop readiness。

## 5. 失败和恢复语义

正常 target 的耐久顺序为 invocation → revocation → supervision；硬终止 target 没有成功 invocation evidence，但仍耐久 revocation → terminated supervision。最终 supervision 持久化失败时，PM 层只会得到基础设施失败，不会签发带非空监督摘要的成功回执。

Ledger adapter 以 receipt digest 生成幂等 event ID。重复 retain 必须解析到完全相同的 kind 和 evidence；重启后 resolve 会重新验证 Ledger witness、artifact ref、durable record scope 与 signed-evidence digest。该机制提供可重开证据链，但不替代 operator 的备份、复制、密钥托管和灾难恢复策略。

## 6. 验证与保留边界

Eval、PM、监督和部署相关回归为 **22 files、360 tests passed**。新增或更新的覆盖包括：

- invocation、revocation、supervision 三类证据均在返回前耐久保留并新鲜回读；
- 正常完成与硬终止的 supervision receipt 均进入 store；
- supervisor 回读替换、非耐久确认和未品牌化 store 失败关闭；
- 真实文件 Ledger、artifact store 与 witness 可在重开后解析 supervision 原文；
- 四角色完整 PM 生命周期产生 6 组 invocation/revocation/supervision 耐久记录；
- merge/evaluator 签名回执中的监督摘要可直接命中对应耐久 supervision 记录；
- 带耐久 store 的 manifest 拒绝无 store supervisor 替换；
- 签名 Desktop deployment 暴露 adapter 工厂并拒绝 handler digest 替换；
- 既有 v2–v5 manifest、v1/v2 receipt、超时硬终止和进程内兼容路径继续通过。

仍未完成：

- 当前验证使用合成 authority 与测试 Ledger；尚未由 operator 配置生产 child evidence store、复制/备份、密钥和保留策略；
- Node 22 permission model 不限制网络访问，仍需外部 sandbox、network namespace 或 firewall；
- Curriculum/任务选择、Memory 检索和模型出口尚未全部隔离；
- 未运行独立未见隐藏集、污染/泄漏负例和真实 Electron DID/RBAC PM E2E；
- 未执行目标环境的等预算 baseline/candidate 重复采样。

因此，本批消除了签名监督摘要缺少耐久原文和 manifest 未区分耐久 supervisor 的合同缺口，但不能替代生产 authority 与目标环境验收。
