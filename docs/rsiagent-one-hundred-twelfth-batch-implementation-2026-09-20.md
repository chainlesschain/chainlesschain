# 第一百一十二次工程实施：Plugin 查询与安装成功回执最小披露

日期：2026-09-20

## 本批结论

本批收窄 Plugin/Marketplace 查询和安装成功回执。Core Plugin 的普通与 lazy IPC 现在只返回明确允许的身份、展示和状态字段；Marketplace 已安装列表/详情不再返回本地安装路径、数据库行 ID 或任意 metadata。

Plugin Manager、Installer 以及两类 Plugin IPC 的安装成功结果不再携带安装路径；打开插件目录仍由主进程执行，但成功回执只确认完成。插件页面、工具、设置、扩展与 Marketplace 远端业务对象等其他成功 payload 仍未纳入本批。

## 主要实现

- 新增 Plugin renderer 记录与 Marketplace 安装状态的显式字段投影。
- 兼容 `pluginId/plugin_id`、`installedAt/installed_at` 和 `autoUpdate/auto_update`，不透传原对象。
- Core Plugin 普通/lazy 列表和详情 IPC 接入同一投影。
- Marketplace installed list/detail 删除 `installPath`、原始 metadata 与数据库行 ID。
- Plugin Manager 与 Marketplace Installer 安装/更新成功结果删除本地路径。
- “打开插件目录”成功结果删除路径，renderer 详情页同步移除安装路径展示。

## 验证结果

```text
Plugin public payload boundaries:
  Test Files  6 passed (6)
  Tests      104 passed (104)

Source gate:
  known installation-path success projections: 0

ESLint:
  0 errors
  16 pre-existing warnings
```

## 仍未完成

- 插件页面、工具调用、设置、扩展配置和 Marketplace 远端成功对象仍需字段级治理。
- 真实 OS/network sandbox、第三方 SDK/provider 原生日志和 Chromium 崩溃转储治理尚未完成。
- tenant HMAC、跨 tenant 读取授权、生产 authority/deployment 与真实 Electron E2E 仍待完成。
