# 第一百二十四次工程实施：Plugin Sandbox Console 源头脱敏

## 本批目标

将插件可控的 `console.log/warn/error` 内容在离开 sandbox 前收窄，避免原始参数先进入 Plugin API 或依赖后续通用日志 redactor 才完成脱敏。

## 实施结果

- Sandbox console 现在只向 Plugin API 发送固定 `plugin-console` 事件、受控级别、最多 32 的参数数量和 `redacted` 标记。
- 原始字符串、对象、Error 和嵌套内容不会从 sandbox console 转发到宿主日志接口。
- Plugin API 的 `utils.log/warn/error` 同样不再把调用方参数传给 logger，只记录固定事件、级别、参数数量和脱敏状态。
- 现有严格 Plugin logger 继续作为第二层边界，对固定事件信封再次执行统一投影。

## 回归与门禁

- Sandbox 回归向三种 console 方法注入字符串、嵌套对象与 Error secret，并确认 Plugin API mock 只收到固定信封。
- Plugin API 源码门禁禁止 logger 调用重新展开 `...args`。
- 针对性回归：3 test files、16 tests passed。
- ESLint：0 errors（5 条既有 `curly` warnings）。

## 未完成边界

- 插件第三方依赖仍可经宿主 CommonJS `require` 执行，其自有日志需要在隔离加载边界继续治理。
- Chromium/provider/崩溃转储日志和 tenant HMAC 仍未完成。
- G03 仍为部分完成，不能据此解除生产 authority、隐私审批或验收要求。
