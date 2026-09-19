# 第一百零八次工程实施：Plugin Permission Dialog 异常最小披露

日期：2026-09-20

## 本批结论

本批关闭 `permission-dialog-manager.js` 把 `webContents.send` 动态 Error 原样 reject 给权限请求调用方的路径。发送失败时，原始 Error 只进入严格日志；timer 仍被清除、pending request 仍被删除，调用方只收到固定 `PLUGIN_OPERATION_FAILED`。

队列满是本地稳定 backpressure 信号，本批改为专用构造器但继续保留 `OVERLOADED` code 和 `retryAfterMs:100`，不把容量保护退化为通用错误。

## 主要实现

- 新增固定 permission queue overload Error 构造器。
- renderer send catch 不再 `reject(error)`。
- 发送失败先进入严格日志，再 reject 稳定 Plugin operation Error。
- 失败清理顺序保持 `clearTimeout` → 删除 pending request → reject。
- 回归注入 renderer send secret，验证 rejection 固定且 pendingRequests 归零。
- 源码门禁覆盖原样 caught-error throw/reject。

## 验证结果

```text
Permission Dialog and shared boundaries:
  Test Files  3 passed (3)
  Tests      18 passed (18)

Source gate:
  raw caught-error throw/reject in permission-dialog-manager.js: 0

ESLint:
  0 errors (1 pre-existing warning)
```

## 仍未完成

- Plugin Loader 与 Plugin IPC fallback 仍有原样内部 rethrow。
- 旧错误数据库行、成功业务 payload 和跨 tenant 读取治理尚未完成。
- 真实 OS/network sandbox、第三方 SDK/provider 原生日志、tenant HMAC 与生产 Electron E2E 仍待完成。
