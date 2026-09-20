# 第一百一十八次工程实施：Plugin 数据扩展成功回执最小披露

## 本批目标

关闭 Plugin 数据导入/导出列表和执行路径的任意成功 payload 透传，防止 handler、路径、options、结果内容或内部 metadata 直接跨 IPC。

## 实施结果

- 新增 `projectPluginDataExtensions`，导入器/导出器只保留扩展身份、插件展示名、类型、优先级和受限展示配置。
- 配置只允许 ID、名称、标签、描述、图标以及字符串 formats/extensions/MIME 列表。
- handler、path、options、schema 和任意嵌套 metadata 不再返回。
- 新增 `projectPluginDataExecutionReceipt`；import/export 仍等待扩展点执行完成，但只返回固定 `executed/operation` 回执。
- 普通 IPC 与生产 lazy IPC 共用同一投影和执行回执，不返回插件结果、路径、参数或摘要。

## 回归与门禁

- 投影测试注入 handler、path、options 和非字符串列表项，确认结果只含白名单字段。
- 普通/lazy IPC 同时验证 importer/exporter 查询与 import/export 执行回执，扩展返回 secret 不进入 IPC。
- 针对性回归：3 test files、31 tests passed。
- ESLint：0 errors。

## 未完成边界

- `plugin:call-method` 与通用 `plugin:trigger-extension-point` 仍可能返回任意 sandbox/扩展结果。
- 运行时注册的其他扩展查询、权限成功 payload 和生命周期回执仍需继续盘点及字段级治理。
- 真实 sandbox/第三方日志、Chromium/provider/崩溃转储日志和 tenant HMAC 仍未完成。
- G03 仍为部分完成，不能据此解除生产 authority、隐私审批或验收要求。
