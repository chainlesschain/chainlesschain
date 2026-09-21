# 第一百九十九次工程实施：AI Engine IPC 最小表面与诊断收口

## 本批目标

把 AI Engine IPC 收敛到当前产品实际使用的文档生成入口。旧模块注册了 29 个 handler，其中通用 AI、Web、Document、Data、Git 自动提交和意图识别入口没有生产 renderer 消费者，却可访问共享 manager、任意路径和动态输入，并会把请求、结果或原始异常写入日志和失败回执。

## 实施结果

- 删除 27 个没有生产 renderer 消费者的 handler，只保留任务规划页实际调用的 `aiEngine:generatePPT` 与 `aiEngine:generateWord`。
- 从 preload 删除未使用的 `ai` scoped API 及 `aiEngine.recognizeIntent`，共移除 5 个旧 capability；同步删除不再需要的步骤事件广播和意图识别运行时依赖。
- PPT 成功回执只返回 `fileName`、`path`、`slideCount`，Word 成功回执只返回 `fileName`、`path`、`fileSize`、`paragraphCount`，不再透传 engine 内部扩展字段。
- 数值统计统一归一化为有限非负值；生成器没有返回可选元数据时使用稳定默认值。
- 失败回执统一为固定 `AI_ENGINE_OPERATION_FAILED`，普通日志不再记录请求正文、输出路径、生成结果或 caught Error。
- 新测试精确锁定两个 handler 的注册/注销集合、成功投影、默认值、错误脱敏和 IPC cleanup 边界；Phase 1 handler 元数据修正为 2。
- 已删除 capability 原本没有生产 renderer 调用，固定 renderer IPC 交集清单保持 1,217 exact、156 denied。

## 回归与门禁

- AI Engine IPC/Phase/preload 定向回归：3 test files、67 tests passed。
- 完整 AI Engine 回归：252 test files、6,166 tests passed、3 skipped。
- 扩展主 LLM 回归：70 test files、1,370 tests passed、27 skipped。
- 固定 renderer IPC capability 验证通过：1,217 exact、156 denied。
- 相关 ESLint：0 errors、0 warnings；相关 Prettier 检查通过。
- Desktop 主进程构建通过；`git diff --check` 通过。

## 未完成边界

- 保留的两个 handler 尚未绑定实际主窗口/main frame、当前 actor DID/tenant 与固定文档生成用途。
- renderer 仍可直接提交输出路径；后续应由主进程按项目与 tenant 托管目标路径，并限制扩展名、目录和覆盖策略。
- outline、theme、author 与 Word structure 尚缺 plain-data、字段、字符串、集合、深度、总字节和速率边界。
- PPT/Word engine 的文件写入、临时文件、失败清理和审计尚未形成认证耐久回执。
- 真实 Electron 任务规划、身份切换、恶意路径、超限文档及 Office 文件回读 E2E 仍待完成。
