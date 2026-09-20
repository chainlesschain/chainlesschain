# 第一百七十五次工程实施：LLM Selector 授权与成功结果投影

## 本批目标

关闭四个 selector IPC 在无 renderer/DID tenant/用途授权时读取能力目录、执行推荐/报告或切换 provider，以及直接返回 selector 任意对象和扩展字段的缺口。

## 实施结果

- get-selector-info、select-best、generate-report 和 switch-provider 均在 selector/config/manager 访问前验证实际 Desktop 主窗口/main frame，从主进程当前 identity 绑定 DID tenant，并分别使用 catalog read、recommendation、report 和 provider switch 固定用途授权。
- 新增独立 selector success projector，只接收 plain non-Proxy 自有数据；能力目录最多 32 个受支持 provider 和 32 个任务类型，名称、能力/适用标签、优先字段、分数、上下文长度、联网/配置/健康布尔字段均有类型、数量或长度约束。
- 推荐输入只允许 taskType、strategy、excludes；任务、策略和 provider 均来自固定集合，未知字段、Symbol、accessor、Proxy、越界数组和非法标识失败关闭。推荐成功只返回 `{ provider }`，不再透传 model、config 或任意扩展。
- 选择报告最多 32 项，只保留 provider/name/score/configured/healthy 与 cost/speed/quality/contextLength；endpoint、模型、配置和上游扩展被删除。
- provider 切换只接受 manager 实际支持的 provider/alias，成功返回冻结的 `{ success: true }`；非法 provider 在读取或写入配置前拒绝。

## 回归与门禁

- Selector privacy、authorization、聚合 IPC 与 manager 治理定向回归：4 test files、83 tests passed。
- 完整主 LLM 回归：41 test files、601 tests passed、15 skipped。
- 相关 ESLint：0 errors；仅聚合治理测试保留 9 条既有 `curly` warnings。
- Desktop 主进程构建通过；`git diff --check` 通过。

## 未完成边界

- 本批复用现有用途 authority 合同，企业组织 RBAC、生产 purpose policy、身份切换时在途推荐/切换中止与撤销仍需目标环境接线和验收。
- 启动阶段旧 `stream-controller-ipc.js`、其他辅助 LLM IPC 的业务 payload、日志/错误通道和 sender/DID tenant/用途授权仍待处理。
- 真实 Electron renderer/preload/provider E2E、provider 切换失败后的配置回滚、tenant HMAC 和生产日志访问治理未在本批执行。
