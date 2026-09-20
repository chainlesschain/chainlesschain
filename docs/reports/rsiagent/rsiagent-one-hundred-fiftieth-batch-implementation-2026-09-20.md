# 第一百五十次工程实施：LLM 辅助数据库行成功回执投影

## 本批目标

补齐 LLM 辅助 IPC 中告警、模型预算和数据保留读取直接展开 SQLite 整行的缺口：保留现有性能页面实际消费的业务字段，同时阻止数据库主键、用户 ID、内部时间戳、处理人、关联 provider 和任意 JSON 扩展跨 IPC。

## 实施结果

- 新增独立 `llm-ipc-record-projection`，复用 Core 成功投影的 plain data、Proxy/accessor 和有界字符串/数字规则。
- 告警历史只返回 id、type、level、可选 title、message、dismissed、统一 timestamp，以及 details 中的 budgetType、percentage、spent、limit。`user_id`、`dismissed_by`、关联 provider/model、原始 created/updated 字段和任意 details 扩展不再返回。
- 告警详情损坏 JSON 继续按既有固定事件降级为 null；投影缺少必需 id/type/level/message 的行会被丢弃，不会将不完整数据库对象交给 renderer。
- 模型预算只返回 provider/model、日/周/月限额、当前花费、总调用/token/成本与三个行为布尔值。数据库行 ID、user_id、created/updated 和未知列不再返回。
- 数据保留配置只返回三类保留天数、自动清理状态与最后清理时间；数据库行身份、user_id 与创建/更新时间不再返回。
- 所有数值均要求非负有限安全数，所有字符串均有上限；Proxy、accessor、类实例和未知字段不会被展开。

## 回归与门禁

- 辅助数据库成功回执、辅助失败隐私与通用 LLM IPC 定向回归：3 test files、58 tests passed。
- 完整 LLM 主进程回归：37 test files、549 tests passed、15 tests skipped。
- 覆盖告警 JSON 扩展、数据库身份列、模型预算统计和保留配置，验证私有列不会进入序列化结果。
- 相关模块 ESLint：0 errors、0 warnings；Prettier、JavaScript 语法检查与 `git diff --check` 通过。
- Desktop `build:main` 通过。测试仅出现 Node `punycode` 弃用提示。

## 未完成边界

- Token Tracker adapter 的 usage/time-series/cost/budget/cache/export 成功对象仍由外部实现直接返回，尚未统一投影。
- stream controller 的 chunk/pause/resume/cancel/complete 事件和 stats 仍展开控制器数据；测试数据生成回执和 selector 成功结果也未纳入本批。
- 告警正文和预算/成本是性能 UI 的预期业务数据，本批只限定字段和规模；renderer sender、DID tenant、用途和字段级读取授权仍未接入这些辅助 IPC。
- tenant HMAC、身份切换撤销、真实 Electron/preload E2E 与生产日志保留/访问控制仍未完成。
