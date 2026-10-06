# 审计字段、受限诊断和保留规则

更新：2026-10-06。范围：CLI `audit-logger` 与桌面 remote 同步、批量命令日志；本地实现，未发布。

## 默认元数据审计

两个宿主复用 `@chainlesschain/session-core/audit-data-policy`。`classifyAuditField` 将字段分为 metadata、identifier、secret、content、unknown。字段名忽略大小写及下划线、点、横线；凭据别名优先分类。策略版本为 `audit-metadata/v1`。

| 类别     | 默认处理                                       | 示例                                                                                 |
| -------- | ---------------------------------------------- | ------------------------------------------------------------------------------------ |
| 元数据   | 仅保留规定的有限数值、布尔值、短代码与固定容器 | count、durationMs、retryable、errorCode、metrics                                     |
| 关联标识 | 最多 160 字符、限定字符集                      | requestId、taskId、actor、target                                                     |
| 秘密     | `[REDACTED]`                                   | password、accessToken、privateKey、credentials                                       |
| 正文     | `[Content omitted]`；不保留正文摘要            | description、sourceSnapshot、prompt、message、stack、URL、设备名称、IP 和 User-Agent |
| 未分类   | 删除字段名及值                                 | 自由扩展字段、用户内容作为对象键                                                     |

标识与代码必须由业务宿主提供真实 ID/机器代码，不能把秘密放入允许的 ID 字段。该策略不是任意秘密检测器。对象投影最多 8 层、512 个递归节点、每容器 100 项；不执行 getter、代理或 `toJSON`。允许的字符串最多 160 字符。

CLI 的持久写入、V2 内存事件、读取与 JSON/CSV 导出均应用投影。原 `sanitizeDetails` 保留为有界凭据脱敏兼容工具，但普通日志不再用它保留自由文本。旧数据库正文在读取/导出时隐藏，磁盘上的旧值不会因此被原地重写，仍按保留规则清理。

桌面 remote 原有 payload 摘要保留兼容，新增策略版本及允许的元数据；同步与批量日志在持久化、缓冲、事件通知之前隐藏设备名称等内容，并限制事件通知的额外字段。旧记录读取也应用相同规则。原有摘要仅用于本地关联，不构成跨服务签名或不可更改证明。

## 受限诊断入口

CLI 主机 API：`createAuditDiagnostics(db, options)`，返回持久 `RestrictedAuditStore`。桌面主进程 `CommandLogger` / `BatchedCommandLogger` 提供 `captureDiagnostic(requestId, details, context)` 和 `readDiagnostic(id, context)`，通过构造参数 `diagnostics` 传递同一策略。

```js
const diagnostics = createAuditDiagnostics(db, {
  retentionDays: 1,
  authorize: async ({ permission, context, resource }) => {
    // 宿主查询当前可信身份、权限与事件范围；不能直接相信请求中的 admin。
    return hostPermissionService.checkCurrentIdentity({
      permission,
      context,
      resource,
    });
  },
});
const receipt = await diagnostics.capture(
  auditEventId,
  {
    phase: "projection",
    metrics: { durationMs: 52, retryCount: 2 },
    error: { code: "ECONNRESET", retryable: true },
  },
  trustedContext,
);
```

示例中的 `hostPermissionService` 是调用宿主自己的授权实现，并非新建的全局权限服务。未注入授权函数时默认拒绝；来自 renderer/网络的 JSON 参数不能提供该函数。当前没有新开的 renderer IPC、WebSocket 或 CLI 子命令，可由主进程代码使用这些入口；全产品 RBAC 界面接入不属于本次完成范围。

每次写入检查 `audit.diagnostics.write`，每次读取检查 `audit.diagnostics.read`，且读取记录后再次带 `eventId` 检查事件范围。只接受明确 `true`；拒绝、异步权限撤销、授权异常均不退化为允许。读取不沿用写入权限。授权异常返回固定错误，不回显可能含秘密的异常文本。

诊断记录使用同一 SQLite 连接中的独立 `restricted_audit_diagnostics` 表，不出现在普通查询或导出中。诊断也只保存允许的结构化元数据，不支持原始 prompt、正文、stack 或秘密转储。直接持有数据库文件的用户仍受既有文件/数据库访问边界约束；独立表不是额外的数据库加密或 OS 隔离。

## 保留与清理

- CLI 普通审计继续显式 `audit purge --days N`，默认 90 天；现在严格限制为整数 1–365 天。V2 内存生命周期不是持久删除证据。
- 桌面 remote 默认保留 30 天、最多 100,000 条、每 24 小时清理一次；拒绝无效、无限或负数配置。配置上限分别为 365 天、1,000,000 条、24 小时清理间隔。清理依据宿主写入的 `created_at`，调用者提交的未来 `timestamp` 不能延长保留。
- 受限诊断默认 1 天，允许整数 1–7 天。写入时固定 `expires_at`，重启不延长。获授权的读取、写入及桌面既有清理周期删除过期行；读取在异步授权完成后再次检查到期时间。即使清理尚未运行也不能通过受限读取 API 取得过期行。
- CLI 主机可在自己的既有维护周期调用 `purgeExpired()`；无后台维护的离线数据库将在下次获授权访问时清理。SQLite 删除不等于磁盘、WAL、备份的安全擦除；本次不自动重写旧备份。

## 验证和边界

本次回归使用真实内存 SQLite，覆盖默认拒绝、读写分权、撤权、事件范围、授权异常、重启/到期、异步授权期间到期、CLI 实际写入/历史导出，以及桌面同步和批量实际入库、通知与清理。既有 CLI 凭据脱敏测试继续覆盖 URL、Header、异常、循环引用等。

Windows / Node 22.22.2、Vitest 4.1.10、better-sqlite3 12.11.1：CLI 四文件 148 项、桌面一文件 5 项全部通过，0 失败、0 跳过。执行方式：

```powershell
# cwd: packages/cli
node ../../node_modules/vitest/vitest.mjs run __tests__/unit/audit-data-policy.test.js __tests__/unit/audit-sanitization.test.js __tests__/unit/audit-logger.test.js __tests__/unit/lib/audit-logger-v2.test.js
# cwd: desktop-app-vue
node ../node_modules/vitest/vitest.mjs run --config vitest.audit-policy.config.mjs
```

共享策略已接上述实际入口，不代表 Spring/FastAPI、所有桌面 logger、所有浏览器日志或第三方导出均已迁移。生产日志采集器、跨服务身份映射、保留合规策略、外部备份删除和真实部署验收仍需对应环境验证。
