# 第六十次工程实施：专用 Operator 隔离工件撤销权威

日期：2026-09-20

## 本批结论

本批新增不经 renderer、也不复用用户交互式 discard grant 的专用 operator revoke authority。每次撤销精确绑定 artifact、内容 digest、源下载回执、operator 身份摘要、策略授权摘要和短期 operator 证据；允许后直接调用品牌化文件系统 custody 的 `reason:revoked` 删除端口。

策略端口和 audit writer 只接收 artifact ref digest，不接收原始 `quarantine:` 引用。成功结果只有在真实字节删除与耐久 outcome 回读均完成后返回；scanner 仍持有字节等失败会记录脱敏 failure digest 后返回分类错误。

## 主要实现

### 1. 独立 Operator 权限域

- descriptor 使用 `approvalMode:operator-signed` 和 `effectMode:irreversible-byte-revocation`，不能替代普通交互式 disposal descriptor；
- tenant、handler artifact digest、policy revision、授权 TTL 与 authenticated-durable-readback 审计模式全部固定；
- operator 请求必须包含有限 request ID、精确 artifact 三元组、operator ID digest、普通有限 JSON 授权上下文和请求时间；
- 策略允许决定必须携带 operator evidence ref 与有限 `validUntil`，执行前再次检查授权未过期；
- 策略拒绝返回专用错误码且不调用 custody 或 outcome writer。

### 2. 真实 Custody 撤销

- custody 新增独立 `bindOperatorRevocationAuthority`，只接受 operator descriptor；
- 底层输入固定为 `reason:revoked`，不能借 operator 权限执行 user-discard、expired 或 delivery-failed；
- 删除继续复用排他 intent、字节/元数据不存在回读、tombstone、重启幂等以及 scanner/completion 互斥；
- 结果不返回原始 artifact ref，只返回引用摘要、内容 digest、operator digest 和删除/审计回执摘要。

### 3. 成功与失败耐久审计

- 成功 outcome 绑定 operator receipt、请求、artifact/operator digest 与 deletion receipt；
- 执行失败记录 `status:failed`、空 deletion receipt 和由错误类型/代码派生的 failure digest；
- audit acknowledgement 必须证明 authenticated、durable、readback-verified，且明确不能用于 promotion；
- audit 回读失败时不会向上层报告撤销成功。

## 签名 Deployment 接线

`createBrowserQuarantineOperatorRevocationAuthority` 已进入 desktop deployment 内建 factories 和 module-digest guard。handler digest 替换会在 capture custody 或策略调用前失败关闭。

## 验证结果

```text
Operator revocation / filesystem custody / signed deployment loader:
  Test Files  3 passed (3)
  Tests      76 passed (76)

ESLint:
  0 errors
```

覆盖真实撤销删除、策略与审计投影脱敏、策略拒绝、活动 scanner 失败审计、tenant/custody 替换以及签名 loader digest 替换。

## 仍未完成

- 尚未提供面向真实 operator 的管理 CLI/UI/API，也未接入生产 DID/RBAC、双人审批或硬件签名；
- 当前机器没有签发并配置该 authority、policy 与 audit writer 的生产 Desktop deployment；
- 跨进程全生命周期锁、批次/撤销恢复对账、目录 fsync 和断电验收仍待完成；
- 真实 Electron/operator/download provider/custody E2E 尚未完成。
