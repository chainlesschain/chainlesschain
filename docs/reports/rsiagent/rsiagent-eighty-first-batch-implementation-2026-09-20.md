# 第八十一次工程实施：Remote User Browser Handler 日志脱敏

日期：2026-09-20

## 本批结论

本批把 `user-browser-handler.js` 接入 Browser fail-closed 日志 redactor。命令 params、浏览器类型/名称/版本、可执行文件路径、页面 URL、tab/target ID、书签统计以及 CDP/WebSocket Error 不再拼入日志消息或直接交给通用 sink。

全部日志使用固定事件文本，运行时字段仅作为第二参数进入有界脱敏投影。CDP 连接、tab/navigation/script/content/screenshot/bookmark/history 业务合同保持不变；真实浏览器数据仍需独立的读取/操作授权和结果最小披露。

## 主要实现

### 1. User Browser logger 强制包装

- 通用 logger 改以 `browserLogSink` 导入，模块内只使用 `createBrowserLogRedactor` 生成的 logger。
- action/params、浏览器发现数量、browser type/name/version 与 executable path 改为固定消息加结构化数据。
- create/close/focus/navigate/refresh/screenshot 的 URL/tab/target ID 不再进入消息。
- 连接失败、CDP parse、WebSocket、tab/bookmark 操作 Error 只经 redactor 投影。

### 2. 防回退合同

新增源码级测试，锁定 redactor 接线、禁止直接解构通用 logger，并要求全部 logger 调用以固定双引号字符串作为首参数，防止 URL、路径和页面标识重新落入日志消息。

### 3. 保留的浏览器数据边界

本批不改变 handler 业务返回。tab URL/title、页面 content、script result、截图、bookmarks/history 和浏览器路径仍可能返回授权调用方，需要一次性 grant、敏感级别、容量限制、读取审计和不可绕过的兼容通道治理。

## 验证结果

```text
User browser handler / browser redaction / static boundary:
  Test Files  3 passed (3)
  Tests      30 passed (30)

ESLint:
  0 errors (1 pre-existing warning)
```

回归覆盖浏览器发现/连接、tab 操作、导航、脚本/内容、截图、书签/历史、CDP session 与共享 redactor 边界。

## 仍未完成

- knowledge、workflow 及其他 remote handlers 仍存在标题、查询、ID、内容、路径和 Error 日志。
- user-browser 业务结果与 executeScript/navigation 等动作仍需生产 authority、最小字段投影、预算和耐久审计。
- integration example、plugin/provider、Electron/Chromium 原生日志和崩溃转储尚未完成统一治理。
- tenant-scoped HMAC、生产保留/删除、访问告警及真实 CDP/Mobile/P2P/Electron 端到端验收仍待完成。
