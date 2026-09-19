# 第一百一十九次工程实施：Plugin 通用调用成功回执最小披露

## 本批目标

关闭普通 Plugin IPC 的任意方法调用和通用扩展触发结果透传，避免 sandbox 或扩展点任意返回对象直接进入 renderer。

## 实施结果

- 新增 `projectPluginInvocationReceipt`，通用方法和扩展触发成功时只返回固定 `executed/invocation` 回执。
- `plugin:call-method` 仍等待 sandbox 方法实际完成，但不再返回 `result`。
- `plugin:trigger-extension-point` 仍等待扩展点执行完成，但不再返回 `results`。
- 回执不包含方法名、扩展点名、参数、context、结果摘要或插件返回内容。
- 生产 lazy IPC 原本未注册这两条通用能力；本批不新增 handler，避免为路径对称扩大生产攻击面。

## 回归与门禁

- 普通 IPC 以包含 secret 的参数/context 和 sandbox/扩展结果执行两条路径，确认调用发生且结果仅为固定回执。
- 投影单测固定 method/extension 两类回执结构。
- 针对性回归：3 test files、32 tests passed。
- ESLint：0 errors。

## 未完成边界

- 普通 IPC 的运行时注册 UI/v6/品牌/Provider/存储/合规扩展查询仍有原对象返回路径。
- Plugin 权限查询/更新和部分生命周期成功回执仍需字段级治理。
- 真实 sandbox/第三方日志、Chromium/provider/崩溃转储日志和 tenant HMAC 仍未完成。
- G03 仍为部分完成，不能据此解除生产 authority、隐私审批或验收要求。
