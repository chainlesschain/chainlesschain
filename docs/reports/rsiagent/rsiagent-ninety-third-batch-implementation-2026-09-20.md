# 第九十三次工程实施：Plugin 非 IPC 失败结果、事件与记录最小披露

日期：2026-09-20

## 本批结论

本批把稳定 Plugin failure descriptor 扩展到非 IPC 消费者。Plugin Installer/Updater 的 25 条 catch 结果、Plugin Manager 五类失败事件、Plugin Registry 新写入的 `last_error`/event data，以及两套批量更新的失败列表、事件和历史记录不再保存或传播动态 `error.message/stack`。

受控输入/状态校验文案（例如缺少 `filePath`、插件未安装或已启用）保持原合同；只有捕获到的任意内部异常进入固定 descriptor。内部方法继续抛出原 Error 的路径未在本批全局改写，但外层 IPC 已由上一批稳定化，普通日志也已严格脱敏。

## 主要实现

- `createPluginFailureDescriptor(kind)` 返回无 `success` 字段的固定 error/code，供事件、记录和组合结果复用；IPC helper 在其上增加 `success: false`。
- Plugin Installer 与 Plugin Updater 的 catch 结果统一使用 `PLUGIN_MARKETPLACE_OPERATION_FAILED`。
- Plugin Manager 的 install/load/enable/disable/uninstall failure event 保留 source 或 pluginId，但 Error 改为 `PLUGIN_OPERATION_FAILED` descriptor。
- Plugin Registry 的新 `last_error` 只存固定 message，event JSON 只存固定 message/code，不再写 stack。
- Plugin/Marketplace 两套批量更新失败列表、update-failed event 与 update history 使用固定 descriptor/message。
- 源码门禁禁止指定结果、事件和记录模块重新构造动态 error/message/stack 字段。

## 验证结果

```text
Plugin result/event/record boundary regression:
  Test Files  5 passed (5)
  Tests      119 passed (119)

ESLint:
  0 errors (12 pre-existing warnings)

Persisted registry negative case:
  last_error plaintext absent
  plugin_event_logs event_data plaintext/stack absent
```

## 仍未完成

- 旧 Plugin Registry/更新历史数据库行可能仍保留原错误明文，需可恢复迁移和物理删除证明。
- 成功业务 payload、列表/详情、manifest/config、审核/评分、token/skill 数据仍需字段级用途授权、tenant 隔离和读取审计。
- 内部直接调用者仍可能收到被重新抛出的原 Error；必须逐入口证明最终信任边界均稳定化。
- sandbox/第三方 SDK/provider 原生日志、tenant HMAC、生产保留/删除与访问告警仍待完成。
