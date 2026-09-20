# 第七十三次工程实施：Browser Extension Server 日志脱敏

日期：2026-09-20

## 本批结论

本批把 Desktop 主进程的 `browser-extension-server.js` 接入 Browser fail-closed 日志 redactor。服务器生命周期、连接、注册、消息解析、断开和心跳日志不再把监听地址、客户端 IP/ID、消息类型、扩展注册信息或 Error 原文直接交给通用 logger。

日志消息统一为固定事件文本，运行时字段只作为第二参数进入有界脱敏投影。WebSocket 业务帧、事件 payload、客户端查询结果与命令返回值保持原有语义；本批治理的是日志 sink，不把脱敏误当成命令通道授权。

## 主要实现

### 1. Server logger 强制包装

- 通用 logger 改以 `browserLogSink` 名义导入，模块内唯一可用 logger 由 `createBrowserLogRedactor` 创建。
- 服务器启动和 listening 日志使用固定消息，host 进入脱敏投影，port 作为有限数字保留。
- 新连接、客户端错误、注册、未知消息、解析失败、断开和心跳超时统一使用固定消息；client ID、IP、message type、registration data 与 Error 只进入 redactor。
- 生命周期固定事件继续保留，便于在不暴露连接身份和内容的情况下诊断启动、停止与容量拒绝。

### 2. 防回退合同

新增源码级测试，要求模块显式包装 Browser redactor、禁止重新直接解构通用 logger，并验证全部 `debug/info/warn/error` 调用的首参数都是固定双引号字符串。动态模板字符串因此不能绕过结构化脱敏通道。

### 3. 兼容边界

连接事件、registered/browserEvent/disconnection payload、`getClients()`、`sendCommand()` 与 pending request 状态机均未改动。调用方仍可按既有合同获得业务信息；这些接口后续仍需用 DID/RBAC、短期 grant、重放保护和访问审计独立治理。

## 验证结果

```text
Browser extension server / browser log redaction / static boundary:
  Test Files  3 passed (3)
  Tests      497 passed (497)

ESLint:
  0 errors (2 pre-existing curly warnings)
```

回归覆盖 server 构造、启停、客户端状态、命令路由、pending/backpressure 边界及全部 ExtensionBrowserHandler action；共享 redactor 的字符串、Error、Proxy/accessor、循环、深度和数量限制也同步通过。

## 仍未完成

- `remote-gateway`、`p2p-command-adapter`、`permission-gate` 和 remote handlers 仍存在动态 ID、DID、命令、路径、内容及 Error 日志。
- integration example、其他 plugin/provider、Electron/Chromium 原生日志和崩溃转储尚未纳入统一边界。
- WebSocket 注册和命令通道仍需生产 DID/RBAC、一次性授权、重放保护、读取审计与真实端到端验收。
- 当前摘要是通用 domain-separated SHA-256，不是 tenant-scoped HMAC；生产保留/删除、访问控制和告警策略仍待配置。
