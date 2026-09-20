# 第一百六十三次工程实施：Desktop Volcengine v7 进程回执接线

## 本批目标

把 CLI 已完成的 Volcengine 函数进程隔离与监督证据合同接入 Desktop 消费边界，使 Desktop 只接受签名 deployment 提供的 v7 authority，并在函数结果进入模型前核对 v7 进程回执。

## 实施结果

- Desktop function capability 仅接受 `chainlesschain.volcengine-function-authority/v7`；v1–v6 descriptor 均失败关闭。v7 descriptor 必须精确声明 `process-hard-termination`、process target digest、target authority digest 与 supervisor authority digest，字段缺失、额外字段、错误隔离模式或非 SHA-256 摘要都不能创建 opaque host。
- 业务请求继续使用 v6 合同。进程 target 与 supervisor 由已验签 authority descriptor 固定，不开放 renderer 请求级目标选择，因此本批没有扩大 renderer 输入面。
- Desktop 只接受 `chainlesschain.volcengine-function-receipt/v7`。最终回执必须把隔离模式及三项 descriptor 摘要原样回绑，并携带合法的 supervision receipt digest 与 process evidence digest；target、target authority、supervisor 或隔离模式替换都会在工具结果进入模型前被拒绝。
- 签名 Desktop deployment loader 的 opaque capture 测试已升级为 v7 descriptor，证明 loader 仍只暴露收窄后的执行 host，而不把原始 authority 或 process executor 交给 renderer。

## 回归与门禁

- Desktop Volcengine capability 与 deployment 定向回归：2 files、75 tests passed。
- 完整 LLM 回归：39 files、580 tests passed、15 skipped。
- Electron 主进程构建通过：`npm.cmd run build:main`。
- 相关 ESLint：0 errors；29 个既有 `curly` warnings。
- `git diff --check` 通过。

## 未完成边界

- 当前仓库合同能拒绝旧协议和字段替换，但 production deployment 仍需实际配置 process target、sandbox、child evidence store 与函数 audit writer。
- Node 子进程的独立网络出口隔离、真实 operator/RBAC 配置、外部证据原始字节核验、跨主机传播和不可逆操作补偿仍需目标环境完成。
- 尚未执行真实 Electron、火山引擎 provider 与工具循环端到端验收。
