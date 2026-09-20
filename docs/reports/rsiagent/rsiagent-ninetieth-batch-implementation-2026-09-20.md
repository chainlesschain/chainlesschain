# 第九十次工程实施：Plugin 与 Marketplace 普通日志脱敏

日期：2026-09-20

## 本批结论

本批新增严格 `createPluginLogRedactor`，并接入 `src/main/plugins` 与 `src/main/marketplace` 中 22 个直接使用通用 logger 的生产模块。完整 legacy message 及所有 variadic data 参数只保留 domain-separated 摘要、字节数和有界投影；plugin ID/version/source/path、manifest/config/permission、marketplace URL/request/response、skill metadata、安装/更新状态和 Error 不再明文进入通用 sink。

递归源码门禁现禁止 plugin 与 marketplace 生产树重新直接解构通用 logger。插件/市场业务返回、数据库正文、安装子进程 stdout/stderr、下载包和 sandbox 权限合同未改变，不能据此视为插件数据治理或执行隔离已经完成。

## 主要实现

- `plugin-log-redaction.js` 要求固定组件名与完整四级 sink，sink message 固定为 `[Plugin:<component>] redacted event`。
- wrapper 对 message 整体摘要；一个或多个 data 参数均进入 Error、Proxy/accessor、循环、深度、数组和字段数量受限的统一投影。
- Plugins 侧覆盖 permission dialog/checker、marketplace API/IPC、semver、sandbox、plugin API/IPC/registry/loader/lazy IPC、UI extension、update manager 与 plugin manager。
- Marketplace 侧覆盖 plugin installer/updater/ecosystem、marketplace client/IPC、skill marketplace client/IPC 与 skill packager。
- 源码测试递归扫描两个生产树并排除测试 fixture，阻止未别名的通用 logger 导入回归。

## 验证结果

```text
Plugin/marketplace focused regression:
  Test Files  14 passed (14)
  Tests      294 passed (294)

ESLint:
  0 errors (39 pre-existing warnings)

Static inventory:
  direct generic logger imports in production plugin/marketplace trees: 0
```

## 仍未完成

- 插件 IPC/HTTP/数据库业务 payload、安装/更新错误返回和 audit/history 仍需字段级最小披露与角色/tenant 读取授权。
- Plugin Loader 收集的安装子进程 stdout/stderr 仍可能进入异常或调用结果；需要容量、脱敏与稳定错误边界。
- sandbox 的实际进程/网络/文件能力、插件自有日志及第三方 SDK/provider 原生日志未由本批治理。
- 摘要不是 tenant-scoped HMAC；Electron/Chromium 原生日志、崩溃转储、生产保留/删除与访问告警仍待完成。
