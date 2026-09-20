# 第一百一十次工程实施：Plugin IPC 页面回退异常最小披露

日期：2026-09-20

## 本批结论

本批关闭 `plugin-ipc.js` 页面内容 fallback 的最后一条原样 caught-error rethrow，并修复可选 `getPageContent` 方法缺失时依赖英文错误文本、无法可靠进入默认组件回退的问题。

Sandbox 现在用固定 `PLUGIN_METHOD_UNAVAILABLE` code 表达可选方法不存在，不携带方法名。Plugin IPC 只对该 code 执行兼容回退；其他插件执行异常统一转换为 `PLUGIN_OPERATION_FAILED`，不向 renderer 传播原始 Error。

## 主要实现

- 共享边界新增固定 optional-method signal 与 code。
- Sandbox 的方法缺失错误不再拼接调用方提供的方法名。
- 页面 fallback 从动态 `error.message` 匹配改为固定 code 判定。
- 非方法缺失异常在 IPC 内部即转换为稳定 operation Error。
- 运行时回归覆盖默认组件回退和 secret 执行失败。
- 源码门禁覆盖原样 rethrow 与动态错误消息匹配。

## 验证结果

```text
Plugin IPC and Sandbox boundaries:
  Test Files  2 passed (2)
  Tests      19 passed (19)

Source gate:
  raw caught-error rethrows in plugin/marketplace production trees: 0

ESLint:
  0 errors
```

## 仍未完成

- 旧错误数据库行、成功业务 payload 和跨 tenant 读取治理尚未完成。
- 真实 OS/network sandbox、第三方 SDK/provider 原生日志和 Chromium 崩溃转储治理尚未完成。
- tenant HMAC、生产 authority/deployment 与真实 Electron E2E 仍待完成。
