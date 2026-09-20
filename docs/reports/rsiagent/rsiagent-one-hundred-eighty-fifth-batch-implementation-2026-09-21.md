# 第一百八十五次工程实施：独立 Token Tracker IPC 授权与身份作用域

## 本批目标

关闭启动阶段另行注册的 12 个 `tracker:*` handler 未验证 renderer、当前身份与用途，并允许 renderer 提供 `userId`、任意查询/记录对象和 conversation ID 影响全局 Tracker 状态或数据库行的缺口。

## 实施结果

- 使用统计、时序、成本分解、定价、成本估算、预算读取/写入/重置、用量记录、报表导出、会话统计和汇率设置 12 个入口，在读取 Tracker 或数据库前统一复用 LLM Core authorization，验证实际 Desktop 主窗口、main frame、主进程当前 DID/tenant，并携带各自固定 operation、purpose 与冻结字段集；Phase 1 已完成生产装配。
- renderer 不再能提供 `userId`。usage/time-series/cost/export 查询、预算读取/写入/重置、用量记录和 conversation stats 均使用 authorization 返回的 actor DID；预算重置 SQL 及会话用量聚合同时以该 DID 约束。
- 查询区间限制为有效时间戳和最多 366 天；provider/model/conversation/message 标识、token、响应时间、压缩率、预算阈值、汇率、重置周期和导出格式均有类型、枚举或规模边界。未知字段、额外参数、Proxy、accessor 和非 plain object 失败关闭。
- 独立用量记录可保留当前 actor 的 conversationId 以支持 actor 作用域统计，但显式设置 `updateConversationTotals: false`，不再触发 `TokenTracker` 对无 owner 字段旧 `conversations` 表的全局汇总更新。其他内部可信调用维持原有默认行为。
- 成功结果继续使用第一百五十二批的有界投影；授权失败只返回固定 `CC_LLM_IPC_UNAUTHORIZED`，输入、Tracker 和数据库失败只返回固定 `CC_LLM_IPC_OPERATION_FAILED`。未初始化路径也必须先通过授权。
- 固定 preload capability 清单仍未暴露这些通道，验证保持 1,227 exact、156 denied；未来若显式开放，主进程授权、身份参数绑定和输入/输出边界仍会生效。

## 回归与门禁

- Token Tracker IPC、Tracker 实现、Core authorization 与 Phase 定向回归：4 test files、95 tests passed。
- 完整主 LLM 回归：48 test files、636 tests passed、15 skipped。
- 固定 renderer IPC capability 验证通过：1,227 exact、156 denied。
- 相关 ESLint：0 errors、0 warnings。
- Desktop 主进程构建通过；`git diff --check` 通过。

## 未完成边界

- `authorizeTokenTrackerPurpose` 是可选部署策略，企业组织 RBAC、敏感报表导出审批、身份切换撤销和生产 audit writer 尚未接线。
- CSV 导出仍由 Tracker 写入进程临时目录；IPC 不返回路径，但尚未进入隔离 custody、领取和耐久处置流程。
- 历史 `default` user 行没有认证迁移；定价目录和 exchange rate 仍是进程级状态。多身份生产部署前需要迁移策略、配置 owner 语义和并发更新验证。
- Tracker 内部仍含动态业务日志和若干降级路径；通道当前也未进入 preload 白名单。若恢复对应 UI，需要同时完成内部日志治理、最小 preload API、界面验收及真实 Electron/SQLite 多身份 E2E。
