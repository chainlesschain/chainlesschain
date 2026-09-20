# 第八十次工程实施：Remote Storage Handler 日志脱敏

日期：2026-09-20

## 本批结论

本批把 `storage-handler.js` 接入 Browser fail-closed 日志 redactor。磁盘/分区操作、target/folder/search path、大文件阈值、recent days、dry-run/max-age 和文件系统 Error 不再拼入日志消息或直接交给通用 sink。

全部日志使用固定事件文本，运行时字段仅作为第二参数进入有界脱敏投影。磁盘查询、目录统计、文件搜索、临时文件清理、回收站和健康状态业务合同保持不变；返回的真实路径和文件元数据仍需调用权限与字段级治理。

## 主要实现

### 1. Storage logger 强制包装

- 通用 logger 改以 `browserLogSink` 导入，模块内只使用 `createBrowserLogRedactor` 生成的 logger。
- action、target path、folder path、search path、size threshold 和 recent days 改为固定消息加结构化数据。
- cleanup/empty-trash 的 dry-run、max-age 参数不再拼入消息。
- Windows/macOS/Linux 查询、统计、搜索、清理和健康检查 Error 只经 redactor 投影。

### 2. 防回退合同

新增源码级测试，锁定 redactor 接线、禁止直接解构通用 logger，并要求全部 logger 调用以固定双引号字符串作为首参数，防止本机路径和文件操作参数重新进入日志消息。

### 3. 保留的数据边界

本批不改变 storage handler 的业务返回。磁盘名称、mount、真实路径、文件列表、大小/时间和清理结果仍可能返回授权调用方，需要按 action、DID/tenant、路径根、数量/字节上限和审计策略继续约束。

## 验证结果

```text
Storage handler / browser redaction / static boundary:
  Test Files  3 passed (3)
  Tests      26 passed, 1 skipped (27)

ESLint:
  0 errors (13 pre-existing warnings)
```

回归覆盖 handler 路由、跨平台磁盘查询、容量/分区/目录统计、大文件和 recent file 搜索、cleanup/empty-trash/health，以及共享 redactor 边界。

## 仍未完成

- user-browser、knowledge、workflow 及其他 remote handlers 仍存在 URL、路径、标题、内容、ID 和 Error 日志。
- storage 业务结果仍需受治理根目录、字段投影、分页/容量、敏感级别和读取/清理审计。
- integration example、plugin/provider、Electron/Chromium 原生日志和崩溃转储尚未完成统一治理。
- tenant-scoped HMAC、生产保留/删除、访问告警及真实多平台 storage/Mobile/P2P/Electron 验收仍待完成。
