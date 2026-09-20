# 第一百六十二次工程实施：CLI Volcengine 进程监督回执绑定

## 本批目标

继续完成 CLI 函数进程隔离的证据闭环：让签名 function authority 直接绑定唯一 process target 与 supervisor，并把已验证的 supervision receipt 摘要写入最终函数回执，避免审阅者只能按业务请求摘要扫描 child evidence ledger。

## 实施结果

- 新增 `chainlesschain.volcengine-function-authority/v7` 严格 descriptor 与专用 `createVolcengineFunctionProcessExecutionAuthority`。v7 在 v6 的 tenant、模块、policy、replay、revocation 和逐函数策略之外，新增固定 `process-hard-termination` 模式、process target digest、target authority digest 与 supervisor authority digest。
- 严格 authority 只接受品牌化 `VolcengineFunctionProcessExecutor`；executor 的 target、target authority、supervisor authority 与 handler artifact 必须逐项等于 v7 descriptor。普通 async function、替换 target、foreign supervisor 或不同模块摘要都会在 authority 创建阶段失败，不能进入 replay reservation 或业务执行。
- process executor 完成并复验签名 supervision receipt 后，会为原始 response 建立私有 WeakMap process evidence，且该关联捕获一次后立即删除。evidence 绑定原函数 request digest、target、supervisor、supervision receipt、target invocation、revocation、完成时间、process isolation、硬 deadline 与迟到副作用阻断，并生成 domain-separated evidence digest；调用方复制、重建、重复捕获或附加字段都不能伪造品牌关联。
- 严格 authority 在解析工具结果前捕获并独立校验 process evidence 的字段集合、请求/descriptor 绑定、全部证据摘要、完成时间和 evidence digest。普通 v6 authority 保持原合同；只有严格入口能够签发新的 v7 process receipt。
- v7 最终 receipt 直接新增 `executionIsolation`、`processTargetDigest`、`processTargetAuthorityDigest`、`processSupervisorAuthorityDigest`、`processSupervisionReceiptDigest` 与 `processEvidenceDigest`。审阅者可从函数回执精确定位耐久 supervision evidence，并验证执行结果属于 descriptor 声明的目标和监督者。
- 签名 Desktop deployment loader 已同时提供严格 authority 工厂与 process executor 工厂。前者继续要求 authority handler artifact 等于已认证 deployment 模块摘要，后者要求 process target artifact 等于同一摘要，从组合边界阻断模块替换。

## 回归与门禁

- 严格组合测试使用真实子进程、耐久 child evidence store 与 replay store，验证 capture port 暴露 v7 descriptor，最终 receipt 精确回绑 target/supervisor/supervision/evidence 摘要，工具 PID 不等于父进程。
- 覆盖 process target digest 替换、普通未品牌函数替换和签名 deployment 模块摘要替换的创建阶段拒绝。
- 进程执行器、函数 authority、签名 deployment loader 与通用 process supervisor 定向回归：4 test files、109 tests passed。
- 相关 CLI ESLint 与 `git diff --check` 通过。

## 未完成边界

- Desktop capability 当前只接受 v6 authority/receipt，尚未选择并验证 v7 严格协议；生产 deployment 也尚未实际配置 target、sandbox policy、child evidence store 与函数 audit writer。
- v7 函数请求沿用 v6 业务请求合同；process 绑定来自已验签 authority descriptor，并在最终 v7 receipt 回绑。若未来需要 renderer 在请求级选择不同 target，应另行升级请求合同，而不是放宽本 authority。
- Node 22 独立网络隔离、生产 attestation/密钥轮换、跨主机副本、真实 Electron/provider E2E 和不可逆外部操作补偿仍需目标环境完成。
