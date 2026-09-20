# 第一百二十一次工程实施：Plugin v6 Shell 扩展查询最小披露

## 本批目标

关闭普通 Plugin IPC 的七类 v6 Shell 注册扩展原对象返回，移除提示词、动态 renderer、handler、source 和组件路径等可执行或敏感内容。

## 实施结果

- 新增 `projectPluginV6UiEntries`，覆盖 Space、Artifact、Slash Command、Mention Source、Status Bar、Home Widget 和 Composer Slot。
- Space 只保留身份、展示、字符串权限名和顺序；`ragPreset/systemPrompt/contactsGroup` 不再返回。
- Artifact 只保留类型、展示字段和无执行内容的 action 描述；`renderer/rendererPath` 不再返回。
- Slash/Mention 删除 `handler/source`，仅保留触发/前缀与展示字段。
- 三类 widget 删除 `component/componentPath`，仅保留位置、尺寸、顺序、标题或 tooltip。
- `get-artifact-renderer` 不再返回实际 renderer，而是返回同一份安全 Artifact 元数据或 `null`。
- renderer TypeScript 接口同步删除不再跨 IPC 的执行字段。

## 回归与门禁

- 投影测试向七类对象注入 secret，逐类确认危险字段缺失且输出不含原值。
- 普通 IPC 八个查询 handler 均覆盖运行时投影；Extension Registry store 原有行为回归保持通过。
- 针对性回归：4 test files、44 tests passed。
- ESLint：0 errors。

## 未完成边界

- 品牌、LLM/Auth Provider、数据存储/加密和合规注册扩展查询仍需类型化投影。
- Plugin 权限查询/更新和部分生命周期成功回执仍需字段级治理。
- 真实 sandbox/第三方日志、Chromium/provider/崩溃转储日志和 tenant HMAC 仍未完成。
- G03 仍为部分完成，不能据此解除生产 authority、隐私审批或验收要求。
