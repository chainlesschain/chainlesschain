# 第六十九次工程实施：Recording 与 Workflow 日志脱敏

日期：2026-09-20

## 本批结论

本批把 Browser recording 与 workflow 兼容链的 10 个模块统一接入 `createBrowserLogRedactor()`。录制事件、回放结果、workflow/execution/variable/control-flow 数据、数据库标识、名称和异常不再直接交给主进程 logger；所有动态字符串在进入既有 sink 前转换为摘要与字节数。

本批只改变诊断副本，不改变 recording/workflow 的数据库正文、IPC 业务返回、事件执行参数或页面操作语义。它完成的是兼容链日志泄漏面的收敛，不代表旧 recording/workflow IPC 已获得签名 ingress、DID/RBAC 或一次性授权。

## 主要实现

### 1. Recording 链统一 redactor

- `recorder.js`、`player.js`、`recording-storage.js`、`recording-ipc.js` 的 logger 均改为专用 Browser redactor。
- recording started/stopped/event、playback started/completed/failed、recording/baseline/diff 持久化状态及错误数据不再明文进入 sink。
- JSON 列解析失败不再把 `JSON.parse` 的动态异常插入 message，而是使用固定消息加脱敏 Error 数据。
- `RecordingStorage` 支持注入底层 log sink，但无论默认或注入路径都强制经过 redactor，不能借测试/组合参数绕开脱敏。

### 2. Workflow 链统一 redactor

- `control-flow.js`、`workflow-engine.js`、`workflow-builder.js`、`workflow-storage.js`、`workflow-variables.js`、`workflow-ipc.js` 全部使用相同 Browser redactor。
- condition/items/operator、variable name/value、workflow/execution ID、事件结果、重试上下文和异常数据只以有限结构与摘要输出。
- workflow JSON 列解析失败改为固定消息加脱敏 Error；`WorkflowStorage` 的可注入 sink 同样只能位于 redactor 之后。
- 页面 `evaluate()` 回调使用的 `window/document/history` 已准确声明为 browser globals，消除定向 ESLint 的环境误报，不改变回调代码。

### 3. 验证边界

新增 wiring 回归向 recording/workflow storage 注入可观测 sink，覆盖成功 ID/name、失败异常/本地路径和损坏 JSON 原文；sink 调用不包含 sentinel，但保留 `valueDigest`。现有 workflow variable、storage、cancellation、control-flow 及真实 SQLite tag escape 回归同步通过。

## 验证结果

```text
Recording / workflow redaction and behavior:
  Test Files  7 passed (7)
  Tests      53 passed (53)

ESLint:
  0 errors (20 pre-existing warnings)
```

## 仍未完成

- OCR、smart diagnostics、screenshot diff、SPA/shadow/iframe observer、element locator 及部分 action/plugin 模块仍有独立 logger/console 输出。
- recording/workflow IPC 仍是兼容入口，尚未完成与签名 Browser ingress 等价的 DID、RBAC、一次性授权、预算、取消与耐久审计验收。
- Electron/Chromium、provider SDK、崩溃转储与系统审计日志仍未纳入；摘要仍需 tenant-scoped HMAC/secret salt。
- 生产日志保留、访问/导出、删除证明、SIEM 管道及真实 Electron E2E 尚未完成。
