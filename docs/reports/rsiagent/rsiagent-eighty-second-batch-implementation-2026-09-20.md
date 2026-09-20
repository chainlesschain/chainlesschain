# 第八十二次工程实施：Remote Knowledge 与 Workflow Handler 日志脱敏

日期：2026-09-20

## 本批结论

本批把 `knowledge-handler.js` 与 remote `workflow-handler.js` 接入 Browser fail-closed 日志 redactor。JSON 列解析异常、笔记标题/query/tag/ID/folder、workflow name/ID/execution/import-export 名称及运行时 Error 不再拼入日志消息或直接交给通用 sink。

全部日志使用固定事件文本，运行时字段仅作为第二参数进入有界脱敏投影。知识库 CRUD/vector sync、workflow CRUD/execute/history/clone/import/export 业务合同保持不变；正文、定义和执行历史仍是受治理业务数据。

## 主要实现

### 1. Knowledge logger 强制包装

- 通用 logger 改以 `browserLogSink` 导入，模块内只使用 `createBrowserLogRedactor` 生成的 logger。
- bad JSON、schema/snapshot 错误、action、note title/query/tag/ID 和 folder ID/name 改为固定消息加脱敏数据。
- 笔记创建、搜索、更新、删除和 vector sync 不再把用户内容或标识写入消息。

### 2. Workflow logger 强制包装

- bad JSON、action、workflow name/ID、execution ID、clone name、import effective name 和 load Error 均进入结构化投影。
- create/list/update/delete/history/clone/export/import 的固定事件类别保留，动态定义和错误不直接落 sink。

### 3. 防回退合同

新增源码级测试，同时锁定两个 handler 的 redactor 接线、禁止直接解构通用 logger，并要求全部 logger 调用以固定双引号字符串作为首参数，阻止模板或字符串拼接恢复敏感内容。

## 验证结果

```text
Knowledge/workflow handler regressions and log boundary:
  Test Files  8 passed, 1 skipped (9)
  Tests      138 passed, 1 skipped (139)

ESLint:
  0 errors (18 pre-existing warnings)
```

回归覆盖 knowledge Phase 6.3 schema/folder/version 行为、workflow CRUD/execute/clone/import/export、JSON 容错和共享 redactor 边界。

## 仍未完成

- file/process/application/network/device 等其他 remote handlers 仍有路径、命令、设备标识、内容和 Error 日志。
- knowledge/workflow 正文、定义、变量、执行历史、导入导出和 vector sync 结果仍需字段级授权、容量、保留与审计。
- integration example、plugin/provider、Electron/Chromium 原生日志和崩溃转储尚未完成统一治理。
- tenant-scoped HMAC、生产保留/删除、访问告警及真实 Knowledge/Workflow/Mobile/P2P/Electron 验收仍待完成。
