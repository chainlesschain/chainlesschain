# 第七十五次工程实施：Command Router 日志脱敏

日期：2026-09-20

## 本批结论

本批把 `command-router.js` 接入 Browser fail-closed 日志 redactor。处理器注册、命令路由、Mobile whitelist/approval 拒绝、handler 缺失、执行成功与失败日志不再把 namespace、request ID、method、审批拒绝原因、耗时或 Error 拼入日志消息或直接交给通用 sink。

全部日志使用固定事件文本，运行时字段仅以第二参数进入有界脱敏投影。路由、统计、Mobile approval、handler 调用和 JSON-RPC 响应合同保持不变；动态错误响应仍需后续按最小披露原则单独治理。

## 主要实现

### 1. Router logger 强制包装

- 通用 logger 改以 `browserLogSink` 导入，模块内 logger 统一由 `createBrowserLogRedactor` 创建。
- handler 注册/取消、命令接收和成功日志改为固定消息；namespace、method、request ID 与 duration 进入结构化数据。
- Mobile method 拒绝、approval channel 缺失和用户拒绝不再将 method/reason 拼进消息。
- handler 缺失与执行异常同样使用固定消息，Error 只经 redactor 投影。

### 2. 防回退合同

新增源码级测试，锁定 redactor 接线、禁止直接解构通用 logger，并要求全部 logger 调用以固定双引号字符串作为首参数，防止模板字符串或拼接重新承载动态命令数据。

### 3. 保留的响应边界

本批不改变既有 JSON-RPC 兼容合同。invalid method、Mobile 拒绝、handler error 的响应仍可能带 method、reason、`error.message` 或 `error.data`；这些内容虽不再明文落日志，仍需依据调用方信任级别收窄为稳定错误码和受控详情。

## 验证结果

```text
Command router / mobile bridge / browser log redaction / static boundary:
  Test Files  5 passed (5)
  Tests      67 passed, 5 skipped (72)

ESLint:
  0 errors
```

回归覆盖常规路由、统计、异常、Mobile whitelist 与强审批分支，以及共享 redactor 对字符串、Error、Proxy/accessor、循环、深度和数量上限的处理。

## 仍未完成

- `p2p-command-adapter`、`permission-gate` 与 remote handlers 仍存在动态身份、命令、路径、内容及 Error 日志。
- Command Router 与 Remote Gateway 的动态错误响应、命令历史和事件消费者需要继续执行最小披露审计。
- integration example、其他 plugin/provider、Electron/Chromium 原生日志和崩溃转储尚未纳入统一治理。
- tenant-scoped HMAC、生产保留/删除、访问审计、告警与真实 Mobile/P2P/Electron 验收仍待完成。
