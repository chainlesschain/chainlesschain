# v3 共享预算与付费准备状态

全部 45 个样本改用火山引擎，原共享预算上限仍为 **$99**：36 × $2 + 9 × $3。首批 Linux CLI 上限 $11 已包含在此数额内。v1、v2、v3 继承同一预算根：

`sha256:665a5254c32a9a267cec5e5c85ccb52f938cd0884470546a92f58fae5dcf87a0`

修订不能清空已消费金额、未结算调用、进行中的 reservation 或失败后的补救费用。实际剩余额度仍为 `null`，不能用 99 或 0 代替未知数。后续正式控制必须先对账并把历史负债纳入同一 lineage。

## 当前实现与缺口

仓库已加入正式预算 contract、authority、transport 及回归测试，具备共享预留和调用结算的工程实现。此进展仍未证明全部生产模型出口均强制经过 authority，也未提供实际账户硬上限、价格/计费维度、汇率上界和跨版本旧负债对账回执。公开 CLI 0.166.99 的 `--max-budget-usd` 使用返回 usage 的费用估算，不能单独担任跨 45 样本的账户硬额度。

创建本快照时，`packages/cli/src/lib/formal-budget-contract.js` 仍检查“18 Volcengine + 18 OpenAI”。该检查需要另行根据外部锁定的 planDigest 和真实 comparison 绑定，验证 v3 的 36 Volcengine 任务与九次首次旅程；同时保留旧计划的原分配约束。不能仅删除数量断言并接受任意 provider，不能因为方案已修订便把不完整 gate 标为 ready。生产 `validateVerify01Bundle` 自身已经支持九个火山分组。

## 正式执行前的必要材料

- 新 v3 精确脚本包、实际镜像和 Astra 审阅记录，绑定新 planDigest、reviewDigest、image ID 和源码。
- 精确火山模型/端点和实际请求回执；默认 thinking 保持，不启用 fallback。
- 覆盖重试、认证、工具阶段及全部样本的可靠共享预算控制与调用前预留；未知结算必须保留负债并停止后续调用。
- 有效 provider 计费合同、可信用量/账户额度或实时计量，包含全部计费项和美元换算上界。
- v1/v2/v3 共享原 $99 的历史消费及未决 reservation 对账；受控凭据只能经实际验证的付费出口使用。
- 实际目标宿主、公开安装身份及剩余完整时间预算；记录首次安装独立旅程及全部费用。

这些材料尚未齐备，`required-inputs.json` 和 `execution-readiness.json` 保持付费未就绪、无正式 observations。历史诊断可支持工程排查，费用估算不能改写为正式账单或零费用。
