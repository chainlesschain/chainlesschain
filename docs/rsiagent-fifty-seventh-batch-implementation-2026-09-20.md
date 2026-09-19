# 第五十七次工程实施：策略授权的隔离工件到期清理

日期：2026-09-20

## 本批结论

本批把文件系统 custody 中已有的 `expiresAt` 从静态元数据变成可执行的受治理 expiry sweep。新增的 retention authority 会让 custody 从真实 metadata 目录生成有界、确定排序的到期计划；只有独立策略端口批准该精确计划后，才逐个调用第 55 批的 intent/tombstone 删除事务。

审批请求只包含 artifact ref digest、内容 digest 和到期时间，不暴露原始 `quarantine:` 引用。sweep 的成功或部分失败结果必须经 authenticated、durable、readback-verified audit writer 确认后才返回或抛出受分类错误。

## 主要实现

### 1. Custody 到期计划

- retention descriptor 精确绑定 authority、tenant、handler artifact digest、policy revision、批量上限、授权 TTL、审计模式与不可逆到期处置模式；
- custody 只读取规范 `.json` metadata 文件，拒绝同名非普通文件；
- 每个候选必须通过 metadata 结构校验以及最终 blob 的长度/SHA-256 回读；
- 只有 `expiresAt <= cutoffAt <= 当前 custody 时间` 的工件进入计划，未到期工件不会交给策略端口；
- 计划按 artifact ID 确定排序、受 `maxBatchSize` 限制并由 `planDigest` 完整绑定；
- 删除端口只接受当前活动计划中的精确 artifact，替换引用、digest、源下载回执或到期时间均失败关闭。

### 2. 独立策略授权

retention authority 为每次 sweep 生成唯一 ID，以当前时间为 cutoff，请 custody 生成计划，再将脱敏计划投影交给 `authorizeSweep`。允许决定必须提供 policy evidence ref 和有限 `validUntil`；执行每个删除前重新检查授权尚未过期。

拒绝决定不会触碰 artifact。审批超时、计划替换、重复 sweep 或删除回执不完整均失败关闭。

### 3. 耐久结果审计

- 成功结果记录计划数、删除数和每个 deletion receipt digest；
- 活动 scanner 阻止删除等执行失败会记录 `status:failed`、已完成删除数与脱敏 failure digest；
- audit writer 的回执必须绑定 sweep receipt 与 outcome request digest，并证明 authenticated、durable 和 readback-verified；
- 只有完整成功且审计回读通过时，调用方才收到脱敏 sweep result。

## 签名 Deployment 接线

`createBrowserQuarantineRetentionAuthority` 已进入 desktop deployment 内建 factories 和 module-digest guard。替换 handler artifact digest 会在 capture custody 或读取 metadata 前被拒绝。

## 验证结果

```text
Retention authority / filesystem custody / signed deployment loader:
  Test Files  3 passed (3)
  Tests      77 passed (77)

ESLint:
  0 errors
```

覆盖真实到期/未到期工件并存、策略允许后只删除到期工件、审批投影脱敏、策略拒绝、tenant/custody 替换、活动 scanner 导致的失败 outcome 耐久审计，以及签名 loader 摘要替换负例。

## 仍未完成

- 本批提供受治理的单次 `runExpirySweep`；尚未接入 Desktop 进程启动/停止与周期 timer，因此不能宣称自动调度已经完成；
- operator 尚未提供生产 retention policy 与真实耐久 audit writer；
- 专用 operator revoke 控制面、跨进程全生命周期锁和 sweep 中断后的批次级恢复/对账仍待完成；
- 目录 fsync、断电/进程崩溃演练与真实 Electron/preload/download provider/custody E2E 仍待完成。
