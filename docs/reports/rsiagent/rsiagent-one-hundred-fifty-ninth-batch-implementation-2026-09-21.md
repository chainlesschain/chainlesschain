# 第一百五十九次工程实施：CLI Volcengine 撤销授权与耐久决策

## 本批目标

继续优先完成 CLI 函数执行缺口：禁止签名 deployment 直接提交调用方自述的耐久撤销证据，要求撤销先经过与目标 authority 精确绑定的独立授权端口，并取得认证、耐久、精确回读的决策回执。

## 实施结果

- 新增品牌化 `createVolcengineFunctionRevocationAuthority`。descriptor 固定绑定撤销 authority、tenant、已验签 handler artifact、撤销 policy revision、目标 execution authority、目标 replay store、目标 execution policy、最大 grant TTL、`operator-signed` 审批模式和 `authenticated-durable-readback` 审计模式；任一目标绑定不一致都会在调用授权端口前失败。
- 签名 deployment 的内建依赖面不再暴露直接耐久撤销函数，只提供绑定模块摘要的撤销 authority 工厂。实际持久化函数降为模块私有路径，只有品牌化撤销 authority 在完成授权验证后才能调用；本地内存撤销入口继续保留用于当前进程的立即 fail-closed。
- 撤销请求严格绑定 request ID、actor DID、tenant、固定 `revoke-model-tool-execution` 用途、原因摘要、规范 UTC 请求时间及有界 plain JSON 授权材料摘要。原始授权材料只交给受信授权端口，不进入最终结果；跨 tenant、过期/未来请求、Proxy、accessor、额外字段和超限 JSON 均被拒绝。
- allow 决策必须精确回绑 request digest，并提供 authorization evidence、audit event 与 durability receipt 三个摘要、规范 `authorizedAt/validUntil` 时间窗，以及同时为真的 `authenticated/durable/readbackVerified`。deny 使用固定 `CC_VOLCENGINE_FUNCTION_REVOCATION_DENIED`；未认证、未耐久、未回读、摘要替换、越界 TTL 或执行前过期都不会写入撤销记录。
- 授权成功后，authority 才把经过验证的证据摘要交给第 158 批耐久撤销路径，先锁定本地目标并取消在途执行，再执行跨进程锁、文件与目录 fsync、精确回读。结果只返回撤销 authority/目标绑定、request/revocation/授权/审计/耐久摘要、时间和固定状态，并用独立 result digest 封装。

## 回归与门禁

- CLI function authority、replay store 与签名 deployment loader 定向回归：3 test files、102 tests passed。
- 完整 LLM 主进程回归：39 test files、567 tests passed、15 tests skipped；仅出现既有 Node `punycode` 弃用提示。
- 覆盖授权 allow 后耐久撤销与重启恢复、deny 后目标继续可用、未回读决策拒绝、目标 authority/store/policy 错配、伪造撤销 authority、在途 sibling 撤销、真实子进程记录可见性，以及替换 handler artifact 时在打开 state root 前失败。
- 相关 JavaScript 语法、Prettier、`git diff --check` 与 CLI ESLint 通过。

## 未完成边界

- 仓库测试使用合成授权端口；production 仍需接入独立 operator 签名/RBAC 服务及其耐久审计存储，并由该端口真实签发三个证据摘要和成功状态。
- 当前函数模块校验授权决策的严格合同与目标绑定，但不会自行解析 authorization evidence 或 audit artifact 的外部字节、证书链和撤销列表；这些验证属于独立授权端口的信任边界。
- 撤销传播仍受 50 ms 轮询、单机文件系统和协作式 `AbortSignal` 限制；轮询窗口内外部副作用、忽略信号代码的硬终止、跨主机传播和不可逆操作补偿仍待完成。
- 企业身份切换/profile 热重载联动、目标操作系统与网络文件系统故障矩阵，以及真实 Electron/preload/renderer/Volcengine 工具循环 E2E 仍待目标环境完成。
