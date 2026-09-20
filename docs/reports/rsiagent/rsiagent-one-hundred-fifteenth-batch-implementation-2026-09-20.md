# 第一百一十五次工程实施：Plugin 页面内容成功回执最小披露

## 本批目标

关闭 Plugin 页面内容读取中的主动内容注入路径，避免插件 sandbox 或扩展配置把 HTML、iframe URL、动态组件路径和任意属性作为成功 payload 送入 renderer 执行。

## 实施结果

- 新增统一的 `projectPluginPageContent` 投影，成功结果固定为 `component` 类型和有界 `pluginId/pageId` 回执。
- 普通 `plugin:get-page-content` 不再查找原始页面配置，也不再调用 sandbox `getPageContent`。
- 生产接线使用的 lazy IPC 新增同名 handler，并在确认插件存在且已启用后返回同一固定回执。
- `PluginPageWrapper.vue` 删除 iframe、`v-html`、DOMPurify 内容分支和 `@vite-ignore` 动态 import，不再消费 `src/html/componentPath`。
- iframe `postMessage` 导航、通知和事件转发一并删除；页面只展示内建占位内容。
- 页面加载异常仅显示和记录固定错误，不再把动态 Error 送入 UI 或日志。

## 回归与门禁

- 普通 IPC 验证 sandbox 页面内容提供器不会被调用。
- lazy IPC 验证生产 handler 返回固定页面回执。
- 投影测试验证回执不含 `html`、`src` 或 `componentPath`。
- renderer 源码门禁禁止重新引入 iframe、`v-html`、`@vite-ignore`、DOMPurify 或页面结果主动内容字段。
- 针对性回归：3 test files、28 tests passed。
- ESLint：0 errors。

## 未完成边界

- Plugin 工具/技能、数据导入导出与运行时注册扩展的成功 payload 仍需字段级投影。
- 真实 sandbox/第三方日志、Chromium/provider/崩溃转储日志和 tenant HMAC 仍未完成。
- 本批未执行真实 Electron/preload E2E；插件页面现采取失败关闭的内建占位策略，不宣称任意第三方 UI 已可安全渲染。
- G03 仍为部分完成，不能据此解除生产 authority、隐私审批或验收要求。
