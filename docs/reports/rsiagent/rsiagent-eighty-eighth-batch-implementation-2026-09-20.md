# 第八十八次工程实施：Remote IPC 异常详情最小披露

日期：2026-09-20

## 本批结论

本批关闭 `remote-ipc` 向 renderer 直接返回捕获异常 `error.message` 的旁路。57 条 catch 分支现在统一返回稳定错误信息与 `REMOTE_IPC_OPERATION_FAILED` 代码；原始 Error 仍进入上一批接好的严格日志投影，便于通过摘要关联诊断而不向 IPC 调用方泄露路径、provider、数据库或内部状态详情。

已存在的稳定业务状态（例如 handler 不可用、远程网关未初始化、本地剪贴板为空）保持原合同。本批不改变成功 payload，也不处理 Command Logger 数据库中主动记录的 params/result/error 业务审计内容。

## 主要实现

- 新增内部 `createRemoteIpcFailureResult()`，每次返回新的稳定失败对象：`success: false`、固定 message 与固定 code。
- 统一替换基础设备、command log、文件传输、远程桌面、剪贴板、通知和 workflow IPC 的 57 条动态异常返回。
- 增加真实 handler 注册级负例，分别覆盖同步 gateway throw 和异步 command rejection，验证 secret 不进入返回值。
- 增加源码合同，禁止 `error/message: error.message` 一类动态 caught-error payload 回归。

## 验证结果

```text
Remote IPC error boundary and strict logger:
  Test Files  2 passed (2)
  Tests      8 passed (8)

ESLint:
  0 errors (6 pre-existing warnings)

Static inventory:
  dynamic caught error.message returns in remote-ipc: 0
```

## 仍未完成

- Command Logger 与 Batched Command Logger 数据库中的 params/result/error 仍需字段级投影、调用方/角色授权与 tenant 隔离。
- 其他稳定业务拒绝原因、审计/history/event payload 仍需按信任边界逐项判断最小披露。
- plugin/provider、Electron/Chromium 原生日志、崩溃转储和 tenant-scoped HMAC 仍待治理。
- 生产保留/删除、读取审计、访问告警与真实 Electron 多角色 E2E 未完成。
