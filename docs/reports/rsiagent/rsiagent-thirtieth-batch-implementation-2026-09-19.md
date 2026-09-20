# RSIAgent 第三十次工程实施：视觉点击结果的认证耐久审计合同

> 日期：2026-09-19（Asia/Shanghai）<br>
> 前置实施：[第二十九次工程实施：交互审批绑定的视觉点击双能力门](./rsiagent-twenty-ninth-batch-implementation-2026-09-19.md)<br>
> 状态：视觉 action authority 已从“只签发点击许可”升级为“交互审批 + 执行结果认证耐久回读”合同。点击成功和浏览器点击失败都必须取得与原 action receipt 精确绑定的耐久审计确认后才返回；页面已发生变更但审计状态不明时显式返回专用不确定错误。生产审计 writer、真实 operator 部署和不可逆副作用恢复仍未完成。

## 1. action authority v2

action authority descriptor 升级为 v2，并同时强制：

- `approvalMode: interactive`；
- `auditMode: authenticated-durable-readback`；
- handler artifact digest 等于已经验签的 deployment 模块摘要；
- action grant 最长有效期不超过 30 秒。

创建 authority 时，签名部署必须同时提供 `authorize` 和 `recordOutcome` 两个 direct function。缺少结果写入端口的 action authority 无法被 Desktop loader 接受，避免只保存审批、遗漏实际副作用结果。

## 2. 审计结果与原许可精确绑定

authority 在内存中保留自己签发且尚未结算的 action receipt 绑定。结果请求包含：

- action receipt digest 与原 authorization request digest；
- target、operation、action input digest；
- 关联的 observation receipt digest；
- `succeeded`/`failed` 状态；
- 脱敏结果 digest 与记录时间。

只有上述字段与尚未结算的原许可完全一致，结果才会进入私有 `recordOutcome` 端口。不同 target、输入、截图回执、请求或伪造 receipt 均失败关闭；成功确认后该 receipt 从待结算集合移除，不能记录第二个结果。

结果 acknowledgement 必须回显 authority、tenant、已验签 handler、action receipt 与 outcome request digest，并同时声明：

- `authenticated: true`；
- `durable: true`；
- `readbackVerified: true`；
- `qualifiesForPromotion: false`；
- 有效的 audit event digest 与 durability receipt digest。

原始交互审批材料、模型响应和页面内容不会写入该结果请求；审计合同保留绑定摘要和最小点击结果。

## 3. 点击后的返回语义

`VisionAction.visualClick()` 在 action grant 紧邻鼠标事件消费后：

1. 执行鼠标点击及可选页面等待；
2. 以最终坐标、按钮、点击次数和固定失败分类生成结果 digest；
3. 等待签名 action authority 返回认证、耐久、精确回读的审计确认；
4. 成功时返回 authorization、audit event 和 durability receipt 三类摘要；
5. 浏览器点击或等待失败时，也先记录耐久失败结果，再返回 `success: false`。

如果页面操作已经执行、但 writer 抛错或回执不完整，调用不会降格为普通点击失败或宣称成功，而是抛出 `CC_AGENT_ACTION_AUDIT_UNCERTAIN`。Desktop 不自动重放点击，也不把结果不明的 grant 恢复为可用状态。

## 4. 保留边界

本批交付的是签名部署可实现的耐久审计协议和 Desktop 强制门，不是生产审计存储本身。仍需：

- operator deployment 提供真实、独立、可断电回读的 action audit writer；
- 将 approval evidence、执行结果、用户/任务/tenant/DID/RBAC 和页面敏感级别纳入生产审计策略；
- 对 writer 超时、写入成功但回包丢失、进程崩溃和重启后的未结算 action 执行故障注入；
- 对页面不可逆副作用定义补偿或人工恢复流程；审计确认本身不是回滚；
- 完成真实 Electron/browser/provider E2E、日志脱敏和隐私审查。

因此 G03 继续为“部分完成”。输入、导航和多步页面任务仍没有 action authority，继续失败关闭。

## 5. 验证口径

扩展后的视觉相关回归为 17 files、243 tests passed、15 skipped。新增覆盖包括 authority v2 的强制结果端口、签发 receipt 与 outcome 精确绑定、一次性结果结算、成功点击耐久审计、浏览器点击失败耐久审计，以及点击已发生但审计 writer 不确定时拒绝返回成功。

本批未启动 Electron、未访问真实网页、未执行真实账号操作、未调用付费视觉模型，也未创建生产签名 deployment 或生产审计副本。
