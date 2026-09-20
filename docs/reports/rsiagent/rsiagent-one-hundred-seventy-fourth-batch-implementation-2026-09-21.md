# 第一百七十四次工程实施：LLM 测试数据输入、授权与成功回执边界

## 本批目标

关闭 renderer 可在无身份/用途授权和无生成规模上限时写入或清空 LLM usage 测试数据，以及成功响应回传聚合 token/成本数据的缺口。

## 实施结果

- `llm:generate-test-data` 在数据库访问前复用 LLM IPC authorization，验证实际 Desktop 主窗口/main frame、主进程当前 DID tenant，并取得固定 `model-test-data-generate` 用途授权。
- `clear:true` 需要第二次取得独立 `model-test-data-delete` 用途授权；删除授权拒绝或异常时不会执行 DELETE、prepare 或 transaction。
- 输入只接受 plain non-Proxy 对象和 days、recordsPerDay、clear 三个自有数据字段；days 限制为 1–90，recordsPerDay 限制为 1–250，clear 必须为布尔值。未知字段、Symbol、accessor、Proxy、错误类型和越界值均固定失败关闭。
- 每日随机偏移后的记录数设置非负下限，整个请求最多生成 24,300 条记录，避免负循环语义和无界内存/SQLite 写入。
- 成功出口只返回冻结的 `{ success: true }`；totalRecords、totalTokens、美元/人民币成本聚合不再跨 IPC。现有性能页面只依赖 success，仍会刷新统计并显示通用“示例”提示。

## 回归与门禁

- Test-data、辅助 IPC、authorization 与聚合注册定向回归：3 test files、62 tests passed。
- 完整主 LLM 回归：41 test files、599 tests passed、15 skipped。
- 相关 ESLint：0 errors。
- Desktop 主进程构建通过；`git diff --check` 通过。

## 未完成边界

- 本批复用现有用途 authority 合同，企业组织 RBAC、生产 purpose policy、身份切换时在途生成中止与撤销仍需目标环境接线和验收。
- selector、旧 `stream-controller-ipc.js`、其他辅助 LLM IPC 的成功 payload、业务事件和 sender/DID tenant/用途授权仍待处理。
- 真实 Electron renderer/preload、生产 SQLite 大批量/故障注入、provider E2E、tenant HMAC 和生产日志访问治理未在本批执行。
