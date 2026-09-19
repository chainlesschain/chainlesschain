# 第一百零二次工程实施：Plugin Registry 初始化异常最小披露

日期：2026-09-20

## 本批结论

本批关闭 `plugin-registry.js` 初始化迁移链的两条原样 rethrow。迁移文件读取出现非 `ENOENT` 错误时仍然失败关闭，原始文件系统 Error 只进入严格日志；Registry 初始化调用方只收到固定 `PLUGIN_OPERATION_FAILED`。

`ENOENT` 仍按既有设计解释为迁移文件缺失并走受控路径。本批不改变 SQL 整体执行失败后的逐语句兼容策略，也不把真实读取失败降级成成功。

## 主要实现

- Registry 接入共享 `createPluginOperationError`。
- 迁移读取失败先记录严格日志，再抛稳定 Plugin Error。
- 初始化最外层 catch 只继续抛稳定 Plugin Error。
- 回归注入含 secret 的 `EACCES` 文件系统异常，验证失败 code/message 固定且不含原文。
- 源码门禁断言 Registry 原样 caught-error rethrow 为 0。

## 验证结果

```text
Plugin registry and shared boundaries:
  Test Files  3 passed (3)
  Tests      20 passed (20)

Source gate:
  raw caught-error rethrows in plugin-registry.js: 0

ESLint:
  0 errors
```

## 仍未完成

- Plugin Installer、Sandbox、API facade 与部分 Marketplace 模块仍有内部 rethrow。
- 旧错误数据库行、成功业务 payload 和跨 tenant 读取治理尚未完成。
- sandbox/第三方 SDK/provider 原生日志、tenant HMAC 与生产 Electron E2E 仍待完成。
