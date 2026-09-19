# 第七十四次工程实施：Remote Gateway 日志脱敏

日期：2026-09-20

## 本批结论

本批把 Desktop 的中心远程入口 `remote-gateway.js` 接入 Browser fail-closed 日志 redactor。网关初始化、Mobile approval transport、扩展连接、命令接收/发送/广播、设备断开和错误日志不再把 peer ID、client ID、method 或 Error 原文直接交给通用 logger。

全部 logger 首参数均为固定事件文本，运行时字段作为第二参数进入有界脱敏投影。命令路由、权限校验、事件 payload、历史记录和业务响应保持原有合同；日志脱敏不替代这些通道仍需完成的授权与错误返回治理。

## 主要实现

### 1. Gateway logger 强制包装

- 通用 logger 改以 `browserLogSink` 导入，模块只使用 `createBrowserLogRedactor` 生成的 logger。
- 扩展服务器启停失败、client 连接/断开和 handler 数量改为固定消息加结构化数据。
- 入向命令、认证信息缺失、命令历史失败、出向命令、事件广播和设备断开不再将 method、peer ID 或 Error 拼入消息。
- Mobile approval transport 的 unwire 异常只通过 redactor 处理，不再直接记录 `err.message`。

### 2. 防回退合同

新增源码级测试，要求 gateway 显式包装 redactor、禁止直接解构通用 logger，并保证每一个 `debug/info/warn/error` 调用都以固定双引号字符串开头，阻止动态模板重新进入日志消息。

### 3. 保留的业务边界

本批没有改变 `handleCommand`、`sendCommand`、`broadcastEvent`、`disconnectDevice` 或 EventEmitter payload。命令失败响应当前仍可能包含业务层 `error.message`，P2P 注册、权限和 handler 自有日志也有独立边界，需要后续分别收紧和验证。

## 验证结果

```text
Remote gateway / browser log redaction / static boundary:
  Test Files  3 passed (3)
  Tests      42 passed, 2 skipped (44)

ESLint:
  0 errors
```

回归覆盖 gateway 初始化与停止、处理器注册、Mobile approval 桥接、命令成功/拒绝/异常路径和共享 redactor 的 Error、Proxy/accessor、循环、深度及数量限制。

## 仍未完成

- `p2p-command-adapter`、`permission-gate`、`command-router` 与 remote handlers 仍存在动态身份、命令、路径、内容及 Error 日志。
- 网关异常响应的动态错误内容、命令历史存储和事件消费者仍需按最小披露与权限边界审计。
- integration example、其他 plugin/provider、Electron/Chromium 原生日志和崩溃转储尚未纳入统一治理。
- tenant-scoped HMAC、生产保留/删除策略、访问审计、告警与真实 P2P/Electron 端到端验收仍待完成。
