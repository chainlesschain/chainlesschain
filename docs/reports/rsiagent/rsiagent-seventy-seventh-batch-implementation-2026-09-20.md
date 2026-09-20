# 第七十七次工程实施：Permission Gate 日志脱敏

日期：2026-09-20

## 本批结论

本批把 `permission-gate.js` 接入 Browser fail-closed 日志 redactor。DID 签名验证、nonce 防重放、权限级别、频率限制、设备授权/过期/自动降级/撤销和数据库异常日志不再把 DID、method、原因或 Error 拼入日志消息或直接交给通用 sink。

全部日志使用固定事件文本，运行时字段仅作为第二参数进入有界脱敏投影。权限判断、nonce 持久化、审计表、设备权限 API 和定时清理语义保持原有合同；日志脱敏不改变审计数据本身的访问控制需求。

## 主要实现

### 1. Permission logger 强制包装

- 通用 logger 改以 `browserLogSink` 导入，模块内 logger 统一由 `createBrowserLogRedactor` 创建。
- timestamp、nonce memory/database 来源、DID、method、required/current permission、rate limit 和验证耗时改为固定消息加结构化数据。
- 默认权限、设备过期、权限设置、命令权限注册、自动撤销/降级和手动 revoke 不再把 DID 或 reason 拼入消息。
- 数据库、签名、U-Key、审计读写和清理 Error 继续保留事件类别，但动态 Error 内容只经 redactor 投影。

### 2. 防回退合同

新增源码级测试，锁定 redactor 接线、禁止直接解构通用 logger，并要求全部 logger 调用以固定双引号字符串作为首参数，阻止模板字符串重新暴露身份和授权数据。

### 3. 保留的数据边界

`permission_audit_log`、`getAuditLogs()`、设备权限管理和 P2P/Router 错误响应没有在本批改变。它们是受治理业务数据而不是普通日志，仍需 DID/RBAC、tenant 隔离、查询审计、保留/删除与最小披露策略。

## 验证结果

```text
Permission gate / replay prevention / browser redaction / static boundary:
  Test Files  5 passed (5)
  Tests      62 passed, 2 skipped (64)

ESLint:
  0 errors (3 pre-existing warnings)
```

回归覆盖基础认证、DID 签名、nonce 重放、权限/频率/U-Key、设备管理、定时清理和共享 redactor 的 Error、Proxy/accessor、循环、深度及数量边界。

## 仍未完成

- remote handlers 仍存在路径、命令、内容、设备信息与 Error 日志，需要按模块拆批收紧。
- permission audit 查询、P2P/Router/Gateway 动态错误响应、命令历史和事件消费者仍需最小披露与访问控制审计。
- integration example、其他 plugin/provider、Electron/Chromium 原生日志和崩溃转储尚未纳入统一治理。
- tenant-scoped HMAC、生产保留/删除、访问审计、告警及真实 DID/U-Key/P2P/Electron 验收仍待完成。
