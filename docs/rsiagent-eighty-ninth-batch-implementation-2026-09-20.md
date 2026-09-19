# 第八十九次工程实施：Remote Command Audit Payload 持久化脱敏

日期：2026-09-20

## 本批结论

本批为 Command Logger 与 Batched Command Logger 增加版本化、域分离的审计 payload 投影。新记录的 `params`、`result`、`error` 在进入内存 buffer、事件或 SQLite 前即转换为 `remote-command-audit-redaction/v1` 摘要、标签和字节数，不再持久化正文、prompt、路径、provider 错误或任意业务对象。

查询、详情与导出也统一经过读取边界：合法 v1 投影会被规范重建，旧 JSON、纯文本和损坏内容只返回新投影，不再向调用方回放旧明文。真实内存 SQLite 已验证入库原始列、详情读取和 JSON 导出均不包含注入 secret。

## 主要实现

- 新增 `remote-command-audit-redaction.js`，只接受 `params/result/error` 三个固定域，生成固定 schema、domain-separated SHA-256、字节数和 `redacted: true`。
- 严格验证已存投影的 schema、label、digest 与 byteLength；伪造或旧格式按原值重新投影，不能借“看似已脱敏”对象绕过。
- 同步 Command Logger 在 SQLite 写入和 `log` 事件前投影 payload；`null` 保持为空。
- Batched Command Logger 在进入 buffer 前投影，批量落库不再接触原始 payload。
- 两套查询路径均对 params/result/error 走同一反序列化边界，JSON/CSV 导出继承该投影。

## 验证结果

```text
Remote command audit redaction, strict logger, and IPC error boundary:
  Test Files  3 passed (3)
  Tests      13 passed (13)

ESLint:
  0 errors, 0 warnings

Real SQLite coverage:
  new row raw params/result/error: plaintext absent
  getLogById: plaintext absent
  JSON export: plaintext absent
```

## 仍未完成

- 旧数据库行在读取/导出时已失败关闭，但原磁盘列仍可能保留历史明文；需要可恢复、可审计的生产数据迁移与删除证明。
- request/device ID、device name、namespace/action 等索引字段仍为兼容查询而明文保存，尚未完成 tenant-scoped pseudonym、访问角色和跨 tenant 隔离。
- Command log 查询/详情/导出 IPC 仍需当前 DID/RBAC、字段级用途授权、容量、保留/删除和读取审计。
- 摘要不是 tenant-scoped HMAC；plugin/provider、Electron/Chromium 原生日志、崩溃转储与生产密钥仍待治理。
