# 第一百八十三次工程实施：Instinct IPC 授权、输入与回执边界

## 本批目标

关闭 11 个 `instinct:*` handler 未验证 renderer、当前身份与用途，直接接收任意筛选/写入/导入对象，成功返回完整 manager 对象，以及失败回传原始 `error.message` 的缺口。

## 实施结果

- 11 个读取、匹配、增删改、强化/衰减、演化、导入导出和统计入口现在都在 manager 访问前复用 LLM Core authorization，验证实际 Desktop 主窗口、main frame 和主进程当前 DID/tenant，并携带固定 operation、purpose 与冻结输出字段集；Phase 17 已接入该授权装配。
- 未初始化 fallback 也必须先完成授权；授权拒绝使用固定 `CC_LLM_IPC_UNAUTHORIZED`，manager/input 失败使用固定 `CC_LLM_INSTINCT_OPERATION_FAILED`，服务缺失使用固定 `CC_LLM_INSTINCT_UNAVAILABLE`。handler 与 Phase 初始化不再记录或返回 caught Error/message。
- filters 只接受 category、minimum confidence、source、固定排序和 1–100 limit；相关上下文限制为 16 KiB，ID 限制为 128 字符，写入只接受 pattern/confidence/category/examples，pattern 和 examples 均有数量、长度、类型及控制字符边界。
- 导入只接受最多 1,000 条 plain instinct 记录；Proxy、accessor、稀疏/扩展数组、未知字段和 renderer 身份字段失败关闭，getter 不会被执行。导出最多返回 1,000 条并显式给出 `truncated`，可安全回导本批输出。
- 列表、匹配和写操作只返回 id、pattern、confidence、category、source 与 useCount；创建/更新时间、任意 metadata 和扩展字段被删除。examples 仅在显式导出中返回有界字符串；演化删除完整 patterns，导入只返回计数，统计只保留固定指标和已知 category。
- 固定 preload capability 清单仍未暴露这些通道，验证结果保持 1,227 个精确通道、156 个未注册 renderer 通道拒绝；未来若显式开放，主进程授权和数据边界仍会生效。

## 回归与门禁

- Instinct authorization/input/projection、Core authorization、Phase wiring 与 SQL 排序注入定向回归：5 test files、65 tests passed。
- 完整主 LLM 回归：47 test files、627 tests passed、15 skipped。
- 固定 renderer IPC capability 验证通过：1,227 exact、156 denied。
- 相关 ESLint：0 errors、0 warnings。
- Desktop 主进程构建通过；`git diff --check` 通过。

## 未完成边界

- Instinct 数据库 schema 仍无 actor/tenant owner，授权身份尚不能把现有记录按租户隔离；生产多租户使用前需要 owner 迁移、复合索引、身份切换撤销和真实 SQLite E2E。
- `authorizeInstinctPurpose` 是可选部署策略，尚未接入企业组织 RBAC、读写/导入导出分权审批和生产 audit writer。
- `instinct-manager.js` 内部仍含动态业务日志和原始 Error 传播/降级路径；本批只关闭 renderer IPC 与 Phase 初始化边界，manager 内部日志、旧数据迁移和正式经验晋级语义仍需分别治理。
- Instinct 通道目前未进入 preload 白名单；若恢复对应 UI，需要同时增加最小 preload API、界面验收和真实 Electron sender/identity E2E。
