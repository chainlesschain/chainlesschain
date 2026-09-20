# 第一百一十一次工程实施：Plugin 遗留错误记录迁移与读取最小披露

日期：2026-09-20

## 本批结论

本批关闭 Plugin Registry 与 Marketplace update history 中旧错误数据库行的明文披露边界。初始化会幂等重写既有动态错误内容；所有已知读取路径同时执行稳定投影，避免初始化被绕过或迁移后再次出现旧格式时向调用方返回原文。

迁移只改写错误详情字段，不改变插件 ID、版本、时间、成功状态和其他业务列。Registry 错误统一为 `Plugin operation failed / PLUGIN_OPERATION_FAILED`，Marketplace 更新错误统一为 `Plugin marketplace operation failed`。

## 主要实现

- Registry 初始化迁移 `plugins.last_error` 和 error event 的 `event_data`。
- Registry 单项与列表读取均对 `last_error` 做二次稳定投影。
- Installer 初始化迁移 `plugin_update_history.error_message`。
- Installer detail/history、Updater history 与 Marketplace detail IPC 均对遗留错误做二次投影。
- 共享边界新增按失败种类投影持久化错误的用途单一 helper。
- 两条真实 SQLite 回归验证物理迁移和迁移后的防回退读取。

## 验证结果

```text
Plugin persisted-error boundaries:
  Test Files  6 passed (6)
  Tests      98 passed (98)

Read-path scan:
  known raw last_error/error_message projections: 0

ESLint:
  0 errors
  15 pre-existing warnings
```

## 仍未完成

- Plugin/Marketplace 成功业务 payload 的字段级最小披露尚未完成。
- 真实 OS/network sandbox、第三方 SDK/provider 原生日志和 Chromium 崩溃转储治理尚未完成。
- tenant HMAC、跨 tenant 读取授权、生产 authority/deployment 与真实 Electron E2E 仍待完成。
