# 第一百二十次工程实施：Plugin 运行时核心 UI 查询最小披露

## 本批目标

关闭普通 Plugin IPC 对内存态 page/menu/component 注册对象的原样返回，防止动态组件、动作、props 和任意 metadata 经运行时查询跨 IPC。

## 实施结果

- 新增 `projectPluginRuntimeUiEntries`，分别对 runtime page/menu/component 使用专用字段白名单。
- page 只保留身份、受限路由、标题、图标和认证标志；删除 component、componentPath、originalPath、meta 和注册时间。
- menu 只保留身份、展示、受限路由、位置、顺序、父项、可见性及无 action 的子项。
- component 只保留身份、名称、slot 和顺序；删除组件对象、动态路径、props 和注册时间。
- `get-registered-pages/menus/components` 均使用同一投影。
- `get-all-registered-ui` 只聚合已治理的三类核心 UI，不再夹带尚未治理的 v6 注册对象。

## 回归与门禁

- 投影测试注入 component、componentPath、meta、action 和 props secret，确认结果不包含原值。
- 普通 IPC 四个运行时查询均执行真实投影断言，聚合结果键固定为 pages/menus/components。
- 针对性回归：3 test files、33 tests passed。
- ESLint：0 errors。

## 未完成边界

- v6 shell、品牌、LLM/Auth Provider、数据存储/加密和合规注册扩展的独立查询仍需类型化投影。
- Plugin 权限查询/更新和部分生命周期成功回执仍需字段级治理。
- 真实 sandbox/第三方日志、Chromium/provider/崩溃转储日志和 tenant HMAC 仍未完成。
- G03 仍为部分完成，不能据此解除生产 authority、隐私审批或验收要求。
