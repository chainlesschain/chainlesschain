# 第一百次工程实施：Plugin Lazy IPC 异常最小披露

日期：2026-09-20

## 本批结论

本批关闭 `plugin-lazy-ipc.js` 的 18 条 catch-and-rethrow IPC 旁路。插件初始化、列表、详情、安装、卸载、启停、权限、扩展、设置、导入导出、工具和技能失败时，renderer 现在统一收到 `PLUGIN_LAZY_OPERATION_FAILED`，不再收到 Electron 序列化的原始 Error。

注册函数增加可选 IPC 端口注入，生产默认仍使用 Electron `ipcMain`；测试可直接捕获 handler 并注入初始化 secret，无需依赖全局 Electron CJS mock。该注入口不改变 channel 或生产注册行为。

## 主要实现

- 18 个 catch 从 `throw error` 改为 `createPluginIpcFailureResult("pluginLazy")`。
- 受控的管理器未初始化、插件不存在/未启用和 sandbox 缺失判断仍保留，但内部详情不再逸出。
- 19 个 channel 注册统一通过可注入 `ipc` 端口，默认值保持 `ipcMain`。
- 运行时回归验证初始化 Error 中的 secret 不进入 IPC 结果。
- 源码门禁断言 lazy IPC 原样 caught-error rethrow 为 0。

## 验证结果

```text
Plugin Lazy IPC and shared boundaries:
  Test Files  3 passed (3)
  Tests      15 passed (15)

Source gates:
  raw caught-error rethrows in plugin-lazy-ipc.js: 0
  fixed ipcMain.handle calls in register function: 0

ESLint:
  0 errors
```

## 仍未完成

- Plugin Installer、Manager、Registry、Sandbox、API facade 与部分 Marketplace 模块仍有内部 rethrow。
- 旧错误数据库行、成功业务 payload 和跨 tenant 读取治理尚未完成。
- sandbox/第三方 SDK/provider 原生日志、tenant HMAC 与生产 Electron E2E 仍待完成。
