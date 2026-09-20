# 第一百五十六次工程实施：CLI Volcengine 运行时 Authority 撤销

## 本批目标

继续优先收敛 CLI 函数执行边界：让已经由签名 deployment 创建并被 Desktop 捕获的 Volcengine function authority 可以在运行时失效，阻止撤销后的新调用，并让在途调用立即从 authority 边界失败关闭。

## 实施结果

- 新增 `revokeVolcengineFunctionExecutionAuthority(authority)`。入口只接受同一模块创建的品牌化 opaque authority；伪造对象失败关闭，首次撤销返回 `true`，重复撤销幂等返回 `false`。
- 撤销入口已加入 Desktop 命令可用的内建 deployment factories。签名且已验真的单文件 deployment 可以在自己的受信控制面中保留该入口，并针对其创建的 authority 触发撤销。
- 每个 authority 私有维护 `revoked` 状态和在途 `AbortController` 集合。撤销先同步锁定状态，再逐一 abort 在途 controller，避免新调用插入撤销窗口。
- 后续调用会在读取时钟、解析请求、占用 replay fence 和调用业务端口之前拒绝，固定错误为 `CC_VOLCENGINE_FUNCTION_AUTHORITY_REVOKED`；动态撤销原因不会穿透边界。
- deadline 与撤销共享同一个私有 controller 和取消 Promise。撤销发生后，authority 调用会立即拒绝并忽略迟到业务结果；业务端同时从已有冻结 context 的 `AbortSignal` 收到同一固定错误。
- 执行成功返回前再次核对 authority 状态；业务执行期间触发的撤销不能被已完成但尚未签发的结果绕过。

## 回归与门禁

- CLI authority 与签名 deployment loader 定向回归：2 test files、83 tests passed。
- 覆盖伪造 authority 撤销、首次/重复撤销、新调用前阻断、在途调用 abort、固定错误 code/message、忽略信号的挂起业务 Promise 以及 deployment factory 暴露。
- 相关 JavaScript 语法、Prettier、`git diff --check` 与 ESLint 通过。

## 未完成边界

- 本批保证 authority 调用立即失败并丢弃迟到结果，但 `AbortSignal` 仍是协作式通知；已经在同一进程中执行且忽略信号的业务代码仍可能继续产生副作用，硬终止需要子进程或独立服务边界。
- 撤销决定尚未写入认证耐久审计，也未跨进程广播；deployment profile 变化、企业身份切换、tenant/RBAC 与管理员 policy 尚未自动驱动该入口。
- 真实 Electron 生命周期、preload/renderer 调用、Volcengine 网络工具循环与生产签名 deployment 的撤销 E2E 仍待目标环境完成。
