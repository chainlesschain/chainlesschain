# 第一百一十六次工程实施：Plugin 工具与技能列表最小披露

## 本批目标

关闭普通/lazy Plugin IPC 对 manifest `tools/skills` 原对象的成功透传，只向 renderer 返回有界的公开描述字段。

## 实施结果

- 新增 `projectPluginToolDefinitions`，只保留工具 ID、名称、展示名、描述、类别、类型、受限风险级别和字符串权限名。
- 工具 handler、参数 schema、返回 schema、默认值和任意附加 metadata 不再跨 IPC。
- 新增 `projectPluginSkillDefinitions`，只保留技能 ID、名称、展示名、描述、类别、图标及字符串 tags/tools 关联。
- 技能 config、prompt/instructions、handler 和任意附加对象不再跨 IPC。
- 两类列表均限制条目数、字符串长度和嵌套字符串数组规模；非对象定义和非字符串数组项失败关闭。
- 普通 IPC 与生产 lazy IPC 共用同一投影，避免两条路径出现披露差异。

## 回归与门禁

- 投影单测注入 handler、参数默认值、返回 schema、skill config 和 prompt secret，确认结果不包含原值。
- 普通/lazy IPC 成功路径均验证工具与技能字段白名单。
- 针对性回归：3 test files、29 tests passed。
- ESLint：0 errors。

## 未完成边界

- `plugin:execute-tool` 的成功结果仍可携带任意插件返回值，需独立设计类型化结果或 opaque artifact 回执。
- 数据导入导出与运行时注册扩展的查询/执行成功 payload 仍需字段级治理。
- 真实 sandbox/第三方日志、Chromium/provider/崩溃转储日志和 tenant HMAC 仍未完成。
- G03 仍为部分完成，不能据此解除生产 authority、隐私审批或验收要求。
