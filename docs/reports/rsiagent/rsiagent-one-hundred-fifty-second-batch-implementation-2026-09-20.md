# 第一百五十二次工程实施：独立 Token Tracker IPC 固定回执与失败边界

## 本批目标

补齐启动阶段独立注册的 12 个 `tracker:*` handler：阻止 tracker/database/pricing 对象、使用记录主键、conversation/user 标识、本地导出路径、动态错误和带身份参数的普通日志跨主进程边界，同时保持统计、预算、成本和控制能力的固定合同。

## 实施结果

- 重写 `token-tracker-ipc` 为固定隐私边界，复用聚合 Token IPC 的 usage、time-series、cost、budget 与 cost estimate 投影；所有 catch 只返回固定 `CC_LLM_IPC_OPERATION_FAILED`，caught Error 不再被读取或记录。
- usage/time-series/cost 继续返回性能数据，但 tracker 任意扩展被删除，interval 只允许 hour/day/week；预算读取删除数据库行 ID、user_id 和未知列，并返回有界限额、花费、阈值、行为、重置时间及派生百分比。
- pricing catalog 只接纳 plain data、最多 64 个 provider 和每个 provider 最多 2000 个 model；每个定价叶只返回 input/output/cache 三个非负有限数值，Proxy、accessor、原型键和任意扩展不展开。
- calculate-cost 不再回显请求参数；record-usage 删除使用记录 ID；conversation stats 删除 conversationId 和未知数据库列，并将明细限制为 1000 行。
- set-budget、export-report 和 set-exchange-rate 只返回固定 success；export-report 不再记录或返回本地路径，汇率更新不回传旧/新值。预算重置只接受 daily/weekly/monthly/all，并只返回固定周期列表。
- adapter 不再直接调用 logger/console，注册、重复注册、失败和注销只经过固定 component/event/operation 白名单；注销同时清除模块级 tracker 引用，避免重注册时复用旧实例。

## 回归与门禁

- 独立 tracker、聚合 token、辅助失败隐私与通用 LLM IPC 定向回归：4 test files、64 tests passed。
- 完整 LLM 主进程回归：39 test files、558 tests passed、15 tests skipped。
- 覆盖 tracker/database/pricing/path/error 任意扩展、固定失败、预算重置、汇率更新、定价目录与注销生命周期，验证私有值不会进入序列化结果或 adapter 日志源。
- 相关模块 ESLint：0 errors、0 warnings；Prettier、JavaScript 语法检查与 `git diff --check` 通过。
- Desktop `build:main` 通过。测试仅出现 Node `punycode` 弃用提示。

## 未完成边界

- `tracker:*` 当前没有 preload 消费入口，但仍在启动阶段注册；renderer sender、frame、DID tenant、用途、读取字段和写操作角色授权尚未接入。
- 手工 record-usage、预算变更/重置和汇率更新尚未由企业 RBAC/capability 分权；本批只收窄结果、失败与普通日志。
- stream controller 的 chunk/pause/resume/cancel/complete 事件和 stats、测试数据生成回执、selector/manager 成功事件仍未纳入本批。
- tenant HMAC、身份切换撤销、真实 Electron/preload E2E 与生产日志保留/访问控制仍未完成。
