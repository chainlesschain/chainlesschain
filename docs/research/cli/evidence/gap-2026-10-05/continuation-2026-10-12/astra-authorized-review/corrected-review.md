# VERIFY-01 corrected package: user-authorized Astra AI review

**Approved for the declared evaluator scope: 36 task evaluators / 72 actual scripts.** The user-authorized AI review step is satisfied for the new exact pins below. This is static design/provenance approval, not a task-result PASS, human approval or release-gate result.

User authorization quoted exactly: `astra代替人工审阅`. Reviewer: AI / Astra; `independentHumanReview:false`. This reviewer also prepared the baseline correction.

| Identity | Approved pin |
| --- | --- |
| planDigest | `sha256:9c3db6e9b49da0c152b9e5cfba56ade64da50e727591b75d2dc9203ba6ae53cd` |
| reviewDigest | `sha256:d333e5826d9ca77b3e635fdf686716519ae2431528b625ac92389667ae10c22f` |
| imageId | `sha256:344dbe71e1c47a59db0e94bebdcc94ef3a7bc8bd828393c820168993539048da` |
| sourceCommit | `07f050be901dd806f68ccb3ddb8eee12ad7a5254` |
| projectCommit | `b2aa3aba082873570e85dce39b00754e5504ff37` |
| runtimeDigest | `sha256:dc34539305ce48372d9848c5fcc61f1336d116623e5a4b997f9cd13069baf267` |
| specsDigest | `sha256:46f712ece8bf4d03dd7d700304aa4acd6296cee86dc11e6382bc3e947536e21f` |

Actual artifacts: `.work/formal-keyless-extracted-38272128731-07f050`; Actions run `38272128731`. The raw run record reports this exact source SHA and completed/success. The artifact ZIP matches the API digest `sha256:e8f941aec159b3cf92690baae9b95d3863d3ddcab3b15264813f086929fa96f1`.

The original `70bf7783...` package remains CHANGES_REQUIRED. Its JSON and Markdown review records were not changed; their byte hashes are retained in this new JSON.

## Correction and checks

`verify-34` now reruns the declared original baseline after document smoke checks. Successful fingerprint and empty-report responses cannot hide a failing baseline. Moving NUL rejection from regex character classes into String.includes is equivalent: direct pinned-runtime probes rejected NUL in the candidate relative path and both mount paths; a valid-file positive passed. Both predicates matched the old behavior over all 128 ASCII characters (256 comparisons).

All 72 artifact hashes and runtime prefixes match the new pinned source. All 72 suffixes/specs are byte-identical to the old package after excluding runtime changes. The 42 frozen-source mutation anchors still match uniquely and produce syntactically valid code. All 45 sample comparison digests match. These checks executed locally; no actual Docker setup/check or formal task was run by this review.

| Archived regression evidence | Result | Artifact |
| --- | --- | --- |
| Isolated original-runtime reproduction | 2/2 failed: baseline not invoked | `.work/formal-review-document-before-isolated.json` |
| Corrected Windows suite | 2 files, 11/11 passed | `.work/formal-review-document-windows.json` |
| Corrected WSL Linux suite | 2 files, 11/11 passed | `.work/formal-review-document-linux-final.json` |

The archived original-runtime reproduction is a later isolated rerun, distinct from the initial terminal-only failure. The document controller tests use deterministic Docker responses; they do not claim actual container execution. The JSON records report hashes and this evidence boundary.

## Scope and remaining work

Docker isolation, exact changed-path/dependency boundaries, locked original tests, setup dependency policy and bounded deadlines retain the reviewed design. No further blocking evaluator defect was found. Candidate assertions and raw output must still be inspected against every acceptance clause, including positives and requirements not directly targeted by a mutant. Document keyword checks alone do not guarantee correct commands.

The runtime supports Linux Docker only. It does not validate native Windows/macOS or IDE host execution. The frozen mapping remains 18 Volcengine + 18 OpenAI tasks, two per host/provider; the 9 separate first-runs all use Volcengine and refer to verify-01 through verify-09. They cannot be inferred from installation/preflight or counted as additional task completions.

`authorizedAiReviewAccepted:true`; `independentHumanReview:false`; `paidExecutionReady:false`; `taskOutcomeApproved:false`; `releaseGateSatisfied:false`. Hard quota/metering, OpenAI ingress credentials, actual host/IDE evidence and formal observations remain outside this approval. Release CI gates still apply separately.

## Per-task final static review

| Task | Host/provider | Verdict | Assessment and limits |
| --- | --- | --- | --- |
| verify-01 官方 endpoint 与同名自定义网关隔离 | win32-cli-volcengine | STATIC_REVIEW_APPROVED | Endpoint isolation is mutated in the model-profile consumer, outside catalog edit permission; the documented mutation-only mapping is consistent. Unknown-window and positive official-endpoint assertions still require candidate review. |
| verify-02 精确模型能力查找 | win32-vscode-volcengine | STATIC_REVIEW_APPROVED | Exact lookup is changed to prefix lookup; this targets unknown suffix certification. Candidate assertions must name the frozen identifiers and include known positives. |
| verify-03 新家族未知计价 | win32-jetbrains-volcengine | STATIC_REVIEW_APPROVED | Unknown Opus inherits legacy pricing under the mutant; exactly one source-version anchor applies. Known-price controls remain required. |
| verify-04 请求级缓存与阶梯费用 | linux-cli-volcengine | STATIC_REVIEW_APPROVED | Two separate mutants cover price-bucket merging and omission of cached tokens from the long-context threshold; candidate distribution assertions must remain request-level. |
| verify-05 安装与准入分离 | linux-vscode-volcengine | STATIC_REVIEW_APPROVED | The installed-but-unattested backend admission gate is bypassed by the mutant. Candidate must also preserve an available API backend. |
| verify-06 付费分解前预检 | linux-jetbrains-volcengine | STATIC_REVIEW_APPROVED | Removing orchestrator preflight targets paid decomposition ordering. Owner is outside the command edit allowlist, with explicit mutation-only rationale. Both decomposition and notification spy assertions need output review. |
| verify-07 持久正文分页边界 | darwin-cli-volcengine | STATIC_REVIEW_APPROVED | Two opposite cursor off-by-one mutants cover duplicate and omitted boundaries; inspect final-body assertions as well. |
| verify-08 fork 历史归属 | darwin-vscode-volcengine | STATIC_REVIEW_APPROVED | Mutant removes parent-session binding; ancestor and independent branch-body positives remain part of candidate review. |
| verify-09 历史来源篡改拒绝 | darwin-jetbrains-volcengine | STATIC_REVIEW_APPROVED | Mutant trusts a mismatched source digest; inspect session mismatch and valid-source controls too. |
| verify-10 分页索引失效回归 | win32-cli-openai | STATIC_REVIEW_APPROVED | Mutant allows a stale inventory digest. Candidate needs both write/delete cases and a final-page comparison. |
| verify-11 问题持久记录归属 | win32-vscode-openai | STATIC_REVIEW_APPROVED | Separate mutants cover wrong-session recovery and terminal records reappearing as pending. |
| verify-12 含空格参数完整性 | win32-jetbrains-openai | STATIC_REVIEW_APPROVED | Join/split mutation destroys spaces and empty argument boundaries. Quotes and lack of shell expansion also need explicit assertions. |
| verify-13 附件同句柄读取边界 | linux-cli-openai | STATIC_REVIEW_APPROVED | Separate mutants ignore opened-handle identity changes and pixel caps. Normal small-image and close-resource controls must remain. |
| verify-14 图片逐项错误 | linux-vscode-openai | STATIC_REVIEW_APPROVED | One-based error index becomes zero-based, testing item attribution. Mixed success and damaged-input assertions still need review. |
| verify-15 权限修订溢出拒绝 | linux-jetbrains-openai | STATIC_REVIEW_APPROVED | Counter exhaustion wraps instead of rejecting. Verify candidate asserts old permission is not widened as well as the error. |
| verify-16 无效设置来源保守失败 | darwin-cli-openai | STATIC_REVIEW_APPROVED | Source stat-field equality is forced true. Candidate must explicitly exercise deletion, corruption and ABA, beyond this single mutant. |
| verify-17 持久进程所有权记录 | darwin-vscode-openai | STATIC_REVIEW_APPROVED | Corrupt JSON becomes an empty pending list. Candidate must include valid pending recovery across instances. |
| verify-18 所有权未知保持阻断 | darwin-jetbrains-openai | STATIC_REVIEW_APPROVED | Unresolved-owner admission check is forced true. Candidate must demonstrate root disappearance is insufficient for tree cleanup. |
| verify-19 取消审批迟到回调 | win32-cli-volcengine | STATIC_REVIEW_APPROVED | Cancellation resolves an approval true. Runtime stream owner differs from the catalog module, with explicit mutation-only rationale; delayed callback/request binding needs candidate review. |
| verify-20 deny 决策不降级 | win32-vscode-volcengine | STATIC_REVIEW_APPROVED | Approval precedence bypasses policy deny. Unknown policy and normal decisions remain required candidate controls. |
| verify-21 Memory 影子读取无写入 | win32-jetbrains-volcengine | STATIC_REVIEW_APPROVED | Shadow read performs collection unconditionally. Verify complete byte/inventory equality for both v1 and v2 fixtures. |
| verify-22 Memory 发布后故障语义 | linux-cli-volcengine | STATIC_REVIEW_APPROVED | Post-publication failure reports committed false. Reopen/read-new-state assertion is necessary alongside error metadata. |
| verify-23 缺失样本固定分母 | linux-vscode-volcengine | STATIC_REVIEW_APPROVED | Two mutants cover omitted unobserved samples and unknown cost becoming zero; directly aligned with denominator/cost requirements. |
| verify-24 比较身份严格隔离 | linux-jetbrains-volcengine | STATIC_REVIEW_APPROVED | Mutant removes comparison identity inequality rejection. Candidate must cover model, permission and runtime dimensions. |
| verify-25 草稿写失败保留旧记录 | darwin-cli-volcengine | STATIC_REVIEW_APPROVED | Mutant removes the previous draft before atomic publish. Early clearing on send is a separate assertion requirement. |
| verify-26 敏感问题字段排除 | darwin-vscode-volcengine | STATIC_REVIEW_APPROVED | Separate mutants persist writeOnly fields and unknown-schema fallback; password controls should remain explicit. |
| verify-27 重载问题精确绑定 | darwin-jetbrains-volcengine | STATIC_REVIEW_APPROVED | Mutant bypasses session/request/schema identity conjunction. Exact retransmission positive is also required. |
| verify-28 迟到加载不覆盖编辑 | win32-cli-openai | STATIC_REVIEW_APPROVED | Mutant drops the dirty-field guard and tests delayed overwrite. Select/checkbox declaration order is not directly mutated and needs candidate review. |
| verify-29 模式 ACK 关联 | win32-vscode-openai | STATIC_REVIEW_APPROVED | Mutant targets cross-session ACK, narrower than generation/correlation acceptance. Frozen baseline explicitly tests wrong correlation, old child ACK and failed/pending display; new candidate coverage must still match the prompt. |
| verify-30 累计动画帧预算 | win32-jetbrains-openai | STATIC_REVIEW_APPROVED | Two mutants collapse frame count and omit fallback pixels. Candidate must show rejection before expensive decoding and valid-boundary success. |
| verify-31 快照失败资源清理 | linux-cli-openai | STATIC_REVIEW_APPROVED | Mutant leaks a read handle; temporary cleanup and preservation of successful references are separate assertions requiring review. |
| verify-32 预览取消失效 | linux-vscode-openai | STATIC_REVIEW_APPROVED | Canceled active preview resolves as successful. Candidate must also exercise page switching and current-page success. |
| verify-33 快速多图添加预算 | linux-jetbrains-openai | STATIC_REVIEW_APPROVED | Cumulative bytes reset per image. Candidate needs rejected-item attribution and continued usability of accepted attachments. |
| verify-34 冻结计划操作说明 | darwin-cli-openai | STATIC_REVIEW_APPROVED | The fixed doc branch validates required document content, executes the real fingerprint/empty-report smoke commands and then reruns the declared original baseline. Controlled regression proves successful document smoke cannot override baseline failure. Actual runbook instructions still need semantic review; keyword matching is not proof of correct runnable commands. |
| verify-35 模型失败分类回归 | darwin-vscode-openai | STATIC_REVIEW_APPROVED | Mutant allows governance ingress rejection into retry classification. Retryable outage, explicit refusal and protocol-error behavior require broader candidate assertions. |
| verify-36 启动配置身份保真 | darwin-jetbrains-openai | STATIC_REVIEW_APPROVED | Mutant restores bypassPermissions regardless of saved mode. Invalid-configuration rejection and full permission identity roundtrip need explicit controls. |

The JSON companion preserves all frozen prompts, acceptance clauses, expected files, allowed paths, baseline hashes, mutation details and the new setup/check hashes for every task.
