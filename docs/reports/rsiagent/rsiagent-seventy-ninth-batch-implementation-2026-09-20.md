# 第七十九次工程实施：Remote System Handler 日志脱敏

日期：2026-09-20

## 本批结论

本批把 `system-handler.js` 与 `system-handler-enhanced.js` 接入 Browser fail-closed 日志 redactor。action、截图参数、通知标题、shell command、调用 DID、黑/白名单匹配和运行时 Error 不再拼入日志消息或直接交给通用 sink。

全部日志使用固定事件文本，运行时字段仅作为第二参数进入有界脱敏投影。系统信息、截图、通知、命令执行及返回值合同保持不变；尤其 shell stdout/stderr 和命令回显仍是受治理业务结果，不因日志脱敏自动获得对远端披露的授权。

## 主要实现

### 1. 两套 System logger 强制包装

- 通用 logger 改以 `browserLogSink` 导入，两套 handler 都只使用 `createBrowserLogRedactor` 生成的 logger。
- action、display/format/quality、截图尺寸和通知 title 改为固定消息加结构化数据。
- shell command、调用 DID、拒绝命令、blacklist pattern 和 whitelist miss 不再进入日志消息。
- 可选依赖、Electron/systeminformation、截图/通知/命令执行异常继续保留事件类别，但 Error 只经 redactor 投影。

### 2. 防回退合同

新增源码级测试，同时锁定两个 handler 的 redactor 接线、禁止直接解构通用 logger，并要求全部 logger 调用以固定字符串作为首参数。增强版按仓库 Prettier 规则做了机械格式归一。

### 3. 保留的执行边界

本批没有改变 `execCommand` 的授权、命令 allow/deny 逻辑或返回结构。command、stdout、stderr、hostname/network/system info、截图与通知 payload 仍需由 DID/RBAC、最小字段投影、结果大小限制和调用审计约束。

## 验证结果

```text
System handler log boundary / browser redaction / gateway integration:
  Test Files  3 passed (3)
  Tests      42 passed, 2 skipped (44)

Prettier:
  All matched files use Prettier code style

ESLint:
  0 errors (13 pre-existing warnings)
```

## 仍未完成

- storage、user-browser、knowledge、workflow 及其他 remote handlers 仍存在路径、URL、标题、内容、命令和 Error 日志。
- shell command/stdout/stderr、系统/网络信息、截图和通知结果仍需字段级最小披露、容量、审批与审计治理。
- integration example、plugin/provider、Electron/Chromium 原生日志和崩溃转储尚未完成统一治理。
- tenant-scoped HMAC、生产保留/删除、访问告警及真实系统命令/Mobile/P2P/Electron 端到端验收仍待完成。
