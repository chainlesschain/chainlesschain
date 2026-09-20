# 第一百八十四次工程实施：独立 Response Cache IPC 授权与数据边界

## 本批目标

关闭启动阶段另行注册的 11 个 `cache:*` handler 未验证 renderer/身份/用途，可绕过聚合 Token IPC 直接读取、配置和清理全局响应缓存，且输入、成功结果、日志和失败结果缺少统一边界的问题。

## 实施结果

- 统计、provider 统计、命中趋势、配置读写、全量/过期清理、缓存检查、健康状态和自动清理控制 11 个入口在访问 cache 前统一复用 LLM Core authorization，验证实际 Desktop 主窗口、main frame、主进程当前 DID/tenant，并携带固定 operation、purpose 与冻结字段集；Phase 1 已完成生产装配。
- 授权失败、cache 未初始化和操作失败分别只返回固定 code/message；模块直接 logger/console、caught Error/message 和带配置/计数的动态日志已删除。未初始化路径同样必须先通过授权。
- 配置只接受 `enableAutoCleanup`、1–3,650 天 TTL 和 1–100,000 maxSize；未知字段、renderer 身份、Proxy/accessor 和空配置失败关闭。无参数操作拒绝附加参数。
- cache check 只接受长度受限的 provider/model 与最多 200 条 role/content plain message，总正文上限 256 KiB；稀疏/扩展数组、getter、未知消息字段和非法控制字符不会进入 cache。成功结果只返回 hit、cacheAge 与 tokensSaved，不再携带缓存响应正文或扩展字段。
- 聚合统计、provider rows、命中率、健康状态和配置结果均使用数字/布尔/枚举白名单与数量上限；动态 hitRate/recommendation 文本、任意 config/database/provider 扩展被删除。清理和自动清理只返回冻结计数或 active 回执。
- 固定 preload capability 清单仍未暴露这些通道，验证保持 1,227 exact、156 denied；未来若显式开放，主进程授权和输入/输出边界仍会生效。

## 回归与门禁

- Response Cache IPC、cache 实现、Core authorization 与 Phase 定向回归：4 test files、84 tests passed。
- 完整主 LLM 回归：48 test files、633 tests passed、15 skipped。
- 固定 renderer IPC capability 验证通过：1,227 exact、156 denied。
- 相关 ESLint：0 errors、0 warnings。
- Desktop 主进程构建通过；`git diff --check` 通过。

## 未完成边界

- `llm_cache` schema 仍无 actor/tenant owner，授权身份不能把统计、检查、配置、清理或自动任务按 tenant 分区；尤其 `cache:clear-all` 仍是显式授权后的进程级删除。生产多租户前需要 owner schema、迁移和复合索引。
- `authorizeResponseCachePurpose` 是可选部署策略，企业组织 RBAC、全量删除独立审批、身份切换撤销与耐久 audit writer 尚未接线。
- `response-cache.js` 内部仍含动态普通日志，并在若干数据库失败上降级为空/零/未命中；本批只关闭 renderer IPC 边界，manager 内部失败真实性、日志和 tenant 存储语义仍需继续治理。
- 通道当前未进入 preload 白名单；若恢复对应 UI，需要同时增加最小 preload API、界面验收与真实 Electron/SQLite 多身份 E2E。
