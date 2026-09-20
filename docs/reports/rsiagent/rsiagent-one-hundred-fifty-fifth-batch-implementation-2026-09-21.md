# 第一百五十五次工程实施：CLI Volcengine 函数 Deadline 与协作取消

## 本批目标

继续优先收敛 CLI 签名函数 authority：把逐函数最大执行时限变成请求、执行和认证审计共同绑定的强制合同，并让真实业务端口取得协作取消信号，避免 authority 无限等待或接受 deadline 后返回的结果。

## 实施结果

- Volcengine function authority、request、audit evidence 与 receipt 合同升级到 v3；v1/v2 descriptor 均在 Desktop host 和 CLI authority 装配时失败关闭。
- 每条逐函数策略新增 `maxExecutionMs`，只允许 1–120000 ms；该值进入规范策略摘要，因此替换执行时限会同时改变 request、audit evidence 与 receipt 的绑定。
- Desktop capability 使用同一次时钟采样生成规范 ISO `requestedAt` 与 `deadlineAt`，deadline 精确等于请求时间加该函数最大执行时限，并进入 v3 request digest。
- CLI authority 独立校验两个时间戳的规范格式、请求新鲜度、deadline 尚未到达、deadline 晚于请求时间且不超过策略上界；被替换或已过期请求不会进入业务端口。
- 业务 `execute(request, context)` 的第二参数为冻结 context，只提供 `AbortSignal`、`deadlineAt` 与 `functionPolicyDigest`。authority 用剩余时限建立 timer；到期时先 abort，再以固定 `CC_VOLCENGINE_FUNCTION_DEADLINE_EXCEEDED` 拒绝。
- timer 与业务 Promise 竞速，迟到结果不能恢复为成功；请求已由上一批 replay fence 占用，超时后重试同一 ID 也不会重复触发副作用。
- CLI audit evidence 与最终 receipt 均绑定 deadline；CLI 和 Desktop 都要求 `completedAt` 位于请求时间与 deadline 之间，伪造 deadline 后完成的回执无法进入模型。

## 回归与门禁

- CLI authority 与签名 deployment loader 定向回归：2 test files、81 tests passed。
- Desktop capability 与 deployment loader 定向回归：2 test files、59 tests passed。
- 完整 LLM 主进程回归：39 test files、564 tests passed、15 tests skipped；仅出现既有 Node `punycode` 弃用提示。
- 覆盖 v1/v2 拒绝、策略 deadline 越界、真实 timer 超时、AbortSignal、固定错误 code、deadline 摘要替换和 deadline 后完成回执。
- 相关 JavaScript 语法、Prettier、`git diff --check` 与 Desktop `build:main` 通过；CLI 与 Desktop 相关文件 ESLint 均为 0 errors/0 warnings。

## 未完成边界

- `AbortSignal` 是协作取消；忽略信号且继续产生副作用的业务实现不能被本批在同一进程内硬终止。需要硬边界的函数仍应进入可终止子进程或独立服务。
- 取消 acknowledgement、撤销、管理员 policy、不可逆操作恢复及跨进程耐久幂等仍未完成。
- 仓库仍未内置访问真实业务数据的签名 production authority；真实 Volcengine 网络、Electron renderer/preload、企业 tenant/RBAC、身份切换与撤销 E2E 尚未完成。
