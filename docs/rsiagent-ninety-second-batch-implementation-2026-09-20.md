# 第九十二次工程实施：Plugin/Marketplace IPC 异常详情最小披露

日期：2026-09-20

## 本批结论

本批关闭 Plugin、Plugin Lazy、Plugin Marketplace、Marketplace、Token 与 Skill Service 六类 IPC 把捕获异常 `error.message` 返回 renderer 的旁路。54 条 catch 返回和 1 条 update-error event 现在统一使用固定 error/code；原始 Error 仅进入上一批严格 Plugin logger。

同时修正普通日志盘点遗漏：marketplace 中 6 个 ESM named logger import 已改为 `pluginLogSink` 别名并接入严格 wrapper，源码门禁同时覆盖 CommonJS 直接解构与 ESM 未别名导入。至此 plugin/marketplace 生产树两种直接通用 logger 入口均归零。

## 主要实现

- 新增 `plugin-ipc-error-boundary.js`，仅允许六种固定 failure kind，并每次生成新的稳定失败对象。
- Plugin IPC 使用 `PLUGIN_OPERATION_FAILED`；lazy 路径使用 `PLUGIN_LAZY_OPERATION_FAILED`。
- Plugin marketplace 与主 marketplace 分别使用 `PLUGIN_MARKETPLACE_OPERATION_FAILED`、`MARKETPLACE_OPERATION_FAILED`。
- Token 与 Skill Service 分别使用 `TOKEN_OPERATION_FAILED`、`SKILL_SERVICE_OPERATION_FAILED`。
- update-error event 保留 pluginId，但动态 Error 被固定失败投影替代。
- Contribution Tracker、Skill Invoker/Service Protocol、Token Ledger 及两个 IPC 的 ESM logger 接入严格 wrapper；静态门禁新增 ESM 语法检查。

## 验证结果

```text
Plugin/marketplace IPC, token/skill services, and log boundaries:
  Test Files  8 passed (8)
  Tests      73 passed (73)

ESLint:
  0 errors (10 pre-existing warnings)

Static inventory:
  dynamic caught error.message payloads in six IPC modules: 0
  direct unaliased generic logger imports in plugin/marketplace production trees: 0
```

## 仍未完成

- Plugin Manager/Registry/Updater 等非 IPC event、数据库记录和方法返回仍有动态错误字段，需继续按消费者信任边界收紧。
- 成功业务 payload、列表/详情、安装历史、审核/评分及 token/skill 数据仍需字段级用途授权、tenant 隔离和读取审计。
- sandbox/第三方 SDK/provider 原生日志、tenant-scoped HMAC、生产保留/删除与访问告警仍待完成。
- 真实 Electron sender/DID/RBAC 多角色负例与跨平台故障演练未完成。
