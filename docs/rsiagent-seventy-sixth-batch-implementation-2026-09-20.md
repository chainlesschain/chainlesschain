# 第七十六次工程实施：P2P Command Adapter 日志脱敏

日期：2026-09-20

## 本批结论

本批把 `p2p-command-adapter.js` 接入 Browser fail-closed 日志 redactor。P2P 连接、消息分发、命令、认证、取消、响应匹配、广播、设备注册、心跳、重试与清理日志不再把 peer ID、DID、request/command ID、method/type/reason 或 Error 拼入日志消息或直接交给通用 sink。

全部日志使用固定事件文本，运行时字段仅作为第二参数进入有界脱敏投影。P2P 消息、EventEmitter payload、命令响应、设备状态和取消语义保持原有合同；日志边界不代表协议响应和权限治理已经完成。

## 主要实现

### 1. Adapter logger 强制包装

- 通用 logger 改以 `browserLogSink` 导入，模块内 logger 统一由 `createBrowserLogRedactor` 创建。
- peer 连接/断开、消息 type、命令 method/request ID、认证结果和响应匹配改为固定消息加结构化数据。
- 取消请求的 reason、来源 peer、command ID，以及设备注册的 peer/DID 不再拼入消息。
- 广播 method/目标数、发送失败、心跳超时、重试次数/延迟/Error 和 pending 清理统计均经同一投影。

### 2. 防回退合同

新增源码级测试，锁定 redactor 接线、禁止直接解构通用 logger，并要求全部 logger 调用以固定双引号字符串作为首参数，阻止模板字符串恢复动态 P2P 数据。

### 3. 保留的协议边界

本批没有修改命令请求、取消确认、permission denial、internal error 或 EventEmitter payload。若这些数据发往不同信任级别的 peer，仍需用稳定错误码、受控详情、DID/RBAC、nonce 和短期授权独立约束。

## 验证结果

```text
P2P backpressure / gateway integration / browser redaction / static boundary:
  Test Files  4 passed (4)
  Tests      44 passed, 2 skipped (46)

ESLint:
  0 errors (6 pre-existing warnings)
```

回归覆盖入向/出向容量、payload 限制、命令 handoff/cleanup、gateway 组合与共享 redactor 的 Error、Proxy/accessor、循环、深度及数量边界。

## 仍未完成

- `permission-gate` 与 remote handlers 仍存在动态 DID、命令、路径、内容及 Error 日志。
- P2P/Router/Gateway 的动态错误响应、命令历史、注册信息和事件消费者仍需最小披露审计。
- integration example、其他 plugin/provider、Electron/Chromium 原生日志和崩溃转储尚未纳入统一治理。
- tenant-scoped HMAC、生产保留/删除、访问审计、告警及真实 P2P/Mobile/Electron 端到端验收仍待完成。
