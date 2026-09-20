# 第一百五十一次工程实施：LLM 聚合 Token IPC 成功回执投影

## 本批目标

补齐 `llm-ipc-token` 中 usage、time-series、cost、budget、cache、export 与服务控制直接返回 tracker/cache/manager 对象的缺口：保留性能页面实际消费的统计字段，同时阻止用户标识、数据库扩展、配置对象、本地导出路径和动态原因跨 IPC。

## 实施结果

- 新增独立 `llm-ipc-token-projection`，复用 Core 成功投影的 plain data、Proxy/accessor、有界字符串和非负有限数字规则；时序点最多 10000 条，provider/model 成本行各最多 1000 条。
- usage 只返回调用、输入/输出/总 token、成本、缓存/压缩、命中率和响应时间等固定数值；查询起止时间、用户字段及 tracker 任意扩展不再返回。
- time-series 与 cost breakdown 统一投影为现有两个性能页面消费的兼容字段；缺少合法 timestamp/provider 的记录被丢弃，任意数据库列和 provider 扩展不会被展开。
- budget 将 SQLite snake_case 行转换为 renderer 使用的 camelCase 限额、花费、阈值、行为与重置时间，删除行 ID、user_id 和创建/更新时间；cache 将 runtime/database/config 组合对象展平为七个统计数值，缓存配置不再返回。
- set-budget、export、pause/resume 只返回固定 `success`；clear-cache 额外返回有界 `deletedCount`。成本导出不再把临时绝对路径交给 renderer，两个页面改为固定完成提示。
- cost estimate 只保留 USD/CNY 成本及 input/output/cache 三项定价；预算判断只返回 `allowed` 和固定 `budget-limit` 原因码，manager 的动态原因不再返回。

## 回归与门禁

- Token 成功回执、辅助失败隐私、通用 LLM IPC 与 renderer performance store 定向回归：4 test files、70 tests passed。
- 完整 LLM 主进程回归：38 test files、553 tests passed、15 tests skipped。
- 覆盖 tracker/database/config/path/manager 任意扩展、嵌套 cache 统计、兼容成本字段和固定写操作回执，验证私有值不会进入序列化结果。
- 相关模块 ESLint：0 errors、0 warnings；Prettier、JavaScript 语法检查与 `git diff --check` 通过。
- Desktop `build:main` 通过。测试仅出现 Node `punycode` 弃用提示。

## 未完成边界

- 独立注册的 `tracker:*` Token Tracker IPC 仍包含原始统计、pricing、record、conversation/export 成功对象、路径和动态失败信息，未纳入本批。
- stream controller 的 chunk/pause/resume/cancel/complete 事件和 stats 仍展开控制器数据；测试数据生成回执、selector/manager 成功事件也未纳入本批。
- token 成本与预算是性能 UI 的预期业务数据，本批只限定字段和规模；renderer sender、DID tenant、用途和字段级读取授权仍未接入这些 handler。
- tenant HMAC、身份切换撤销、真实 Electron/preload E2E 与生产日志保留/访问控制仍未完成。
