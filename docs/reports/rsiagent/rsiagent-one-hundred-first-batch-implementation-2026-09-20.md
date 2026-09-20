# 第一百零一次工程实施：Plugin Manager 内部异常最小披露

日期：2026-09-20

## 本批结论

本批关闭 `plugin-manager.js` 的 7 条原样 rethrow。初始化、安装、加载、启用、禁用、卸载和 AI 工具扩展处理失败时，原有错误记录、事件、日志和回滚顺序保持不变，但直接调用者只收到固定 `PLUGIN_OPERATION_FAILED` Error。

共享 Plugin 错误边界新增稳定 Error 构造器，使内部方法仍以 rejection/throw 表达失败，不会吞异常或误报成功；动态第三方 message/stack 不再跨越 Manager 公开方法边界。

## 主要实现

- 新增 `createPluginOperationError(kind)`，由既有固定 descriptor 创建带稳定 code 的 Error。
- Plugin Manager 7 条 `throw error` 统一改为稳定 operation Error。
- 安装、加载、启停和卸载的失败事件保持原有固定 descriptor。
- Registry 错误记录与日志投影继续在抛出稳定 Error 前执行。
- 源码门禁断言 Manager 原样 caught-error rethrow 为 0。

## 验证结果

```text
Plugin manager and shared boundaries:
  Test Files  3 passed (3)
  Tests      75 passed (75)

Source gate:
  raw caught-error rethrows in plugin-manager.js: 0

ESLint:
  0 errors (1 pre-existing warning)
```

## 仍未完成

- Plugin Installer、Registry、Sandbox、API facade 与部分 Marketplace 模块仍有内部 rethrow。
- 旧错误数据库行、成功业务 payload 和跨 tenant 读取治理尚未完成。
- sandbox/第三方 SDK/provider 原生日志、tenant HMAC 与生产 Electron E2E 仍待完成。
