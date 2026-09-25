# RSIAgent 第二百一十五次工程实施：Eval 启动前签名准入与耐久回读

> 日期：2026-09-25（Asia/Shanghai）<br>
> 对应差距：G08<br>
> 状态：新增可选的单槽启动准入边界；G08 仍为部分完成（待实测）。

## 实施内容

可信宿主可为 `EvolutionEvalGate` 配置 `launchAdmission`。Gate 为每次 `run`、`runWithEvidence` 或 `runWithFailureEvidence` 生成独立 `runId` 和 `runNonce` 后，先核对冻结计划摘要，再将规范化请求摘要、租户、策略、评测 authority root 和截止时间交给准入 authority。只有签名事件写入 Ledger 且耐久 artifact 经精确回读后，Gate 才调用 suite resolver。准入失败、计划不符、同槽重复启动或准入跨越截止时间，均在下游 suite 调用前关闭。未配置准入的既有 Gate 保持原行为，但不能据此宣称启动覆盖已认证。

准入 authority 使用固定 Ed25519 公钥验证启动证据，要求真实 `EvolutionLedger`、`EvolutionArtifactPorts` 和品牌化 Ledger artifact resolver。同一租户、stream、cohort、slot 的事件 ID 固定；写入前捕获 Ledger head，通过 CAS 排斥并发占槽。即使相同请求也不能再次获得启动许可。签名事件与独立保存的 artifact 必须精确回读；恢复接口只允许审计已提交的事件，不重新授权执行。返回的 `cohortCompletenessAuthenticated` 和 `promotionAuthority` 始终为 `false`。

## 验证和剩余边界

聚焦测试使用真实 Ed25519、文件 Ledger/witness 和 artifact 回读，覆盖并发 CAS、签名或信任替换、存储字节篡改、写入完成但应答丢失后的恢复，以及三个 Gate 入口共用准入与失败关闭。测试中的存储 authority 和 Windows 目录 fsync shim 仅用于工程验证，不代表目标环境的断电耐久验收。

本次没有目标部署把所有实际评测启动强制接到准入 Gate；配置入口仍为可选。同步 signer 的进程级超时隔离、冻结清单签发与实际启动全集对账、完整准备成本及真实 provider 账单、真实 PM 对照和 Pilot 证据均未完成。因此不能从本次单槽准入推断 cohort 完整、整份效果报告可信或达到晋级条件，G08 及总差距结论维持部分完成。
