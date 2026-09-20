# 第一百四十四次工程实施：Volcengine 函数签名 Authority 装配

## 本批目标

把第一百四十三批的主进程 capability 边界接入已认证 evolution deployment：authority 必须由 CLI 内建品牌工厂创建、绑定签名 deployment 模块摘要，并在 Desktop 侧经物理 CLI 模块捕获后才能成为 IPC 可用的 opaque host。

## 实施结果

- CLI 新增 `volcengine-function-execution-authority`。authority 是私有 `WeakMap` 品牌对象，外部普通对象不能通过 capture；descriptor 固定绑定 authority、tenant、签名 `handlerArtifactDigest`、policy revision、用途、函数白名单与审计模式。
- Desktop 主进程 capability descriptor 和逐次请求新增 `handlerArtifactDigest` 与 `policyRevision` 绑定，避免签名 deployment 更换处理器或策略后复用旧请求/回执。
- CLI authority 会重新投影参数并独立复算 argument/request digest，校验请求新鲜度、actor、tenant、sender、executor、用途与函数白名单；被篡改或过期请求不会进入业务执行 port。
- 业务执行 port 必须返回 `toolResult` 与精确 audit evidence。只有 authority/tenant/artifact/policy/request/result 全部匹配，且 `authenticated`、`durable`、`readbackVerified` 均为真，同时 audit event digest 与 durability receipt digest 合法时，authority 才生成 Desktop 可消费的结果回执。
- evolution deployment loader 已向 `desktop` 命令提供 `createVolcengineFunctionExecutionAuthority`，并强制 descriptor 的 `handlerArtifactDigest` 等于已认证 deployment 模块摘要；替换摘要会在 authority 创建前失败。
- Desktop deployment loader 只读取 enumerable data property `volcengineFunctionExecutionAuthority`，再从实际 CLI 包加载 capture 函数并收窄为 opaque host；该 host 经现有主进程注册链传给 Volcengine IPC。
- 未提供 authority 的签名 deployment 仍保持现状：Function Calling 固定失败关闭，不会自动启用数据库、文件、P2P 或系统信息函数。

## 回归与门禁

- Desktop capability 与 deployment 装配定向回归：2 test files、53 tests passed。
- CLI authority 与 deployment loader 定向回归：2 test files、70 tests passed。
- 完整 LLM 主进程回归：32 test files、509 tests passed、15 tests skipped。
- 覆盖品牌捕获、签名模块摘要约束、请求/参数摘要篡改、函数白名单、Proxy/accessor、跨 tenant、执行结果摘要、认证耐久回读证据和 Desktop opaque host 收窄。
- 相关模块 ESLint：0 errors、0 warnings；Desktop 主进程构建与 JavaScript 语法检查通过。

## 未完成边界

- 仓库未内置会访问真实笔记、文件、P2P 或系统信息的 deployment authority。生产签名模块必须逐函数实现最小资源范围、字段投影、审批与审计存储，并显式输出 `volcengineFunctionExecutionAuthority`。
- 对真实副作用仍需 deadline、协作取消、撤销、幂等键、不可逆操作恢复和管理员 policy；通用 authority 合同不替代这些业务控制。
- Volcengine provider 工具循环当前仍由治理入口失败关闭；真实网络、Electron renderer/preload、企业 tenant/RBAC、身份切换与撤销 E2E 尚未完成。
- G03 仍为部分完成；真实签名业务 authority、tenant HMAC、生产日志治理以及目标环境 Electron/browser/provider/custody 验收仍是上线门槛。
