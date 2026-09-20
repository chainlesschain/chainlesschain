# 第一百八十一次工程实施：Token IPC 身份作用域与授权边界

## 本批目标

关闭聚合 Token/成本/缓存/服务控制的 12 个 IPC 入口未验证 renderer、DID tenant 与用途授权，统计和导出未按当前身份过滤，预算接口接受 renderer 自报 userId，以及查询/预算/估算参数可任意进入业务层的缺口。

## 实施结果

- 12 个入口在访问 TokenTracker、ResponseCache、LLM Manager 或 fallback 数据库前统一复用 LLM Core authorization，校验实际 Desktop 主窗口/main frame，从主进程当前 identity 绑定 actor DID/tenant，并为统计、成本、预算、导出、缓存、服务控制、估算和预算判断使用固定用途与字段集。
- usage stats、time series、cost breakdown 和 CSV export 的规范化选项强制注入 authorization actor DID；TokenTracker 及 IPC fallback SQL 均新增 `user_id = ?` 条件，renderer 不能声明或替换 userId。
- 成本报告查询与 CSV 列移除数据库 ID、conversation ID 和 message ID，只保留 provider/model、token、成本、缓存/压缩和时间指标；导出仍只向 renderer 返回固定 success 投影，不返回临时绝对路径。
- get/set budget 与 resume-service 只使用授权 actor DID；preload 和 renderer store 删除 userId 参数。预算设置只接受限额、0–1 阈值和布尔开关白名单，warning 不得高于 critical；预算判断把 actor DID 传入 Manager，并读取该 actor 的预算配置。
- usage/cost/export 日期必须是安全时间戳、起止有序且跨度不超过 366 天；provider、interval 和 format 使用长度或枚举限制。成本估算只接受受限 provider/model 和非负安全 token 数，Proxy、accessor、未知字段和 renderer 身份字段失败关闭。
- 缓存清理默认只执行 `clearExpired()`，显式 `expiredOnly: false` 才调用全量清理；选项必须是严格布尔值。服务暂停/恢复、缓存统计和其他无参数入口拒绝附加参数。
- 专用 preload 预算 API 与 renderer 调用已切换到无身份参数合同；部分预算更新会先与 store 当前白名单状态合并，再发送完整受限配置。
- 固定 renderer IPC 能力生成器现识别 `authorizedIpcMain` 等受治理 wrapper 的精确字符串注册，并显式保留两个动态 browser operator channel，避免授权包装后的真实 handler 被误判为未注册能力。

## 回归与门禁

- Token authorization、输入、actor 作用域、成功投影、TokenTracker SQL、聚合隐私、注册与 renderer store 定向回归：7 test files、144 tests passed。
- 完整主 LLM 回归：46 test files、618 tests passed、15 skipped。
- 相关 ESLint：0 errors；LLM Manager 存在 18 条既有 curly warnings。
- Desktop renderer 与主进程构建通过；`git diff --check` 通过。

## 未完成边界

- `llm_cache` 当前没有 actor/tenant owner；全量清理、缓存统计和 service pause/resume 仍是进程级资源。本批通过固定用途授权和默认过期清理降低暴露，但生产企业 policy、分区 schema 与身份切换撤销仍需接线。
- CSV 仍写入应用临时目录，尚未进入具备领取、过期、删除回读和耐久审计的 artifact custody；真实导出交付 E2E 未完成。
- 历史 `user_id = 'default'` usage/budget 行不会自动归入任意新 actor；目标环境需制定认证迁移或废弃策略。真实 Electron/preload/SQLite 用户目录 E2E、tenant HMAC 和耐久审计仍待处理。
