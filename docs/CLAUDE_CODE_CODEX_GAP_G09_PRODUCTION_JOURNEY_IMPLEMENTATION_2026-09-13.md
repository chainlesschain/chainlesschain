# G09 目标环境生产旅程证据闭合（2026-09-13）

## 1. 本批交付

本批新增一条不接触真实凭据、也不自行调用付费 provider 的生产证据消费路径：

- `packages/cli/scripts/verify-g09-production-journey.mjs` 校验目标环境生成的单 Skill 纵向旅程证据，并输出最小化验证回执；
- `.github/workflows/g09-production-journey-attestation.yml` 在受保护的 `g09-production-journey` Environment 中，下载指定 producer run/attempt 的证据，验证 GitHub artifact attestation，执行结构校验，再对验证回执签发 GitHub provenance；
- `packages/cli/__tests__/unit/verify-g09-production-journey.test.js` 覆盖正向合同及关键失败关闭反例。

这条路径复用现有底座，而不把它们的合同能力冒充为本次真实运行结果：

- IDE live-provider aggregate 提供真实 provider/model 调用证据摘要；
- Desktop signed Skill matrix 提供正式安装包、三平台签名、干净安装、打包态启动与真实 Skill authority 证据摘要；
- Skill target-matrix eval 提供 baseline/candidate、固定 corpus 与独立 grader 的矩阵回执摘要；
- controlled Skill production pilot 提供显式 opt-in、shadow/canary/active 及 rollback 回执。

## 2. 证据合同

输入 schema 为 `chainlesschain.g09-production-journey-evidence/v1`。校验器要求所有关键对象字段精确，并绑定：

| 范围      | 强制证据                                                                                                                                      |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 发布      | 40 位提交 SHA、发布摘要、Desktop matrix、安装和启动回执                                                                                       |
| 模型      | provider、model、live-provider aggregate、完成调用数、`fallbackUsed:false`                                                                    |
| Skill     | 单一 Skill ID、不同的 baseline/candidate digest、corpus 与权限摘要                                                                            |
| 评测      | `pass`、target-matrix receipt、唯一目标环境 cell、独立 grader                                                                                 |
| 部署      | 正数 revision、配置摘要、回滚前后均绑定精确 baseline、全局 `autoPromotion:"hold"`                                                             |
| 产品旅程  | IDE/产品任务、人工审阅、中断重连、证据导出回执                                                                                                |
| 试点      | 显式 opt-in、有界 cohort、candidate→shadow→canary→active→rolled-back 的完整顺序                                                               |
| authority | model/evaluation/review/deployment/storage/witness 六种不同身份；全部 authenticated、durable；grader 与 model、witness 与 deployment 跨故障域 |

整个输入使用 domain-separated SHA-256 摘要。校验器拒绝额外字段、摘要篡改、符号链接、超过 1 MiB 的输入，以及键名看起来可能承载 API key、token、password、private key 或 credential 的内容。证据只能记录 secret/identity 的受信摘要和 authority ID，不能记录 secret 值。

成功输出 `chainlesschain.g09-production-journey-verification/v1`，仅投影晋升决策所需的提交、产物、模型、Skill、corpus、权限、deployment revision、authority evidence digests 和最终 rollback 状态。

## 3. 本地合同验证

```powershell
node_modules\.bin\vitest.cmd run packages/cli/__tests__/unit/verify-g09-production-journey.test.js
```

本地运行只验证协议与失败关闭行为，不产生“真实部署验证通过”。

## 4. 目标环境 CI 使用

管理员需要先完成以下外部配置：

1. 创建受保护的 GitHub Environment `g09-production-journey`，设置 required reviewers，并限制为 protected `main`；
2. 在该 Environment 中设置变量 `G09_TARGET_PRODUCER_WORKFLOW`，值为同仓库受信 producer 的规范路径，例如 `.github/workflows/company-g09-target-producer.yml`；
3. 由该 producer 在目标环境完成真实旅程，生成一个无 secret 的 schema v1 JSON，使用 `actions/attest-build-provenance` 对它签名，并上传名称严格为 `g09-production-journey-evidence-<attempt>-<commit>` 的 artifact；
4. 从 protected `main` 手动运行 `G09 Production Journey Attestation`，输入同一完整 SHA、producer run ID 和 attempt。

consumer 会验证：事件提交就是受保护的 live main；producer 是配置的 workflow；producer run/attempt 已成功完成且绑定相同 SHA；下载的 JSON 具有该 workflow、该 SHA、GitHub-hosted runner 和 GitHub OIDC 的有效 attestation；结构合同和摘要全部通过。最后一次 live-main 复核成功后，才上传并 attest 验证回执。

## 5. 尚需外部权限的验收门

代码提交本身不会配置或解除下列门：

- 真实 provider/model 账户、目标 corpus 和付费调用；
- Windows/macOS 正式签名与 notarization 身份；
- 生产 PKI/KMS/HSM、持久 authority store 和独立 witness；
- protected Environment、required reviewers 及受信 producer workflow；
- 真实用户 opt-in cohort、shadow/canary 观察期和人工晋升审批；
- 在真实 deployment revision 上执行 rollback 并核验精确 baseline 恢复。

因此，本批把 G09 从“已有分散底座”推进到“可消费、可失败关闭、可 attest 的目标环境证据合同”，但在上述外部门实际跑出合格回执前，仍不能标为生产完全完成，也不能解除全局 `autoPromotion:"hold"`。
