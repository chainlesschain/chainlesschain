# 第一百零三次工程实施：Plugin Sandbox 异常与事件最小披露

日期：2026-09-20

## 本批结论

本批关闭 `plugin-sandbox.js` 的 8 条原样 rethrow，并移除 load、hook 和 method 三类失败事件中的原始 Error。插件入口读取、代码执行、生命周期、方法调用和超时仍会失败关闭，但直接调用者只收到固定 `PLUGIN_OPERATION_FAILED`。

原始文件系统、VM 和插件代码异常只进入严格日志。该变更是错误披露边界，不等于完成真实 OS/network 进程隔离、第三方原生日志治理或恶意插件安全验收。

## 主要实现

- Plugin Sandbox 接入共享固定 descriptor 和 operation Error。
- 非 `ENOENT` 入口读取错误与 VM 执行错误先记录严格日志，再转为稳定 Error。
- load、hook、enable、disable、unload 和 method 终止路径不再原样 rethrow。
- `error`、`hook-error`、`method-error` 事件改为固定 error/code，不再携带 Error 对象。
- 回归注入入口读取 secret，验证 rejection 与事件均不含原文。
- 源码门禁覆盖原样 rethrow 和动态 Error 事件。

## 验证结果

```text
Plugin sandbox and shared boundaries:
  Test Files  3 passed (3)
  Tests      17 passed (17)

Source gates:
  raw caught-error rethrows in plugin-sandbox.js: 0
  dynamic Error event payloads: 0

ESLint:
  0 errors
```

## 仍未完成

- Plugin Installer、API facade 与部分 Marketplace 模块仍有内部 rethrow。
- 真实 OS/network sandbox、第三方 SDK/provider 原生日志和恶意插件隔离验证未完成。
- 旧错误数据库行、成功业务 payload、跨 tenant 读取治理、tenant HMAC 与生产 Electron E2E 仍待完成。
