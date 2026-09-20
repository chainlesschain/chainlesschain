# 第一百四十一次工程实施：Volcengine IPC 最小披露

## 本批目标

收敛 `volcengine-ipc` 的动态日志与原始异常返回，确保被治理入口拒绝的直接工具通道只返回固定失败凭据。

## 实施结果

- 新增 Volcengine IPC 固定诊断边界，15 个 handler 的失败操作和注册生命周期均使用白名单标识。
- 模型选择、成本估算、模型列表与配置更新不再返回 caught Error 文本，统一返回固定失败 receipt。
- Web、图像、知识库、Function Calling、MCP 和多工具直连通道继续被治理入口拒绝，并统一返回 `CC_AGENT_EVOLUTION_INGRESS_FAILED`。
- 内置函数执行与 P2P 准备不再记录函数名、参数或消息 ID；`volcengine-ipc` 的直接 logger/console 和 `error.message` 访问已归零。
- 注册函数支持注入 IPC、配置、模型选择器与隐私边界，生产默认依赖和既有成功返回合同保持不变。

## 回归与门禁

- Volcengine IPC、Tools Privacy 与 Evolution Ingress 回归：3 test files、11 tests passed。
- 新增固定失败 receipt、治理入口、成功合同、注销和源码隐私门禁覆盖。
- ESLint：0 errors、0 warnings。
- Prettier 与 `git diff --check` 通过。

## 未完成边界

- 模型选择、模型列表与配置更新仍需 sender/tenant/用途授权和最小成功投影。
- 内置数据库、文件系统和系统信息函数虽无法经当前直接工具 IPC 到达，但在未来接线前仍需独立 capability 授权与沙箱验收。
- 真实 Volcengine 网络调用、治理执行链和 Electron renderer/preload E2E 尚未完成。
- G03 仍为部分完成，tenant HMAC、生产日志治理及真实 Electron/browser/provider/custody 验收仍不可省略。
