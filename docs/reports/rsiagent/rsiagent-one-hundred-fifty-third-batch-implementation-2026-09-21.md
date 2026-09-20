# 第一百五十三次工程实施：CLI Volcengine 函数请求重放门禁

## 本批目标

先收敛 CLI 签名函数 authority 的可本机闭环缺口：阻止同一份合法请求、同一 `requestId` 的改参请求或并发请求重复进入真实业务执行端口，避免笔记、文件、P2P 等函数产生重复副作用。

## 实施结果

- CLI `volcengine-function-execution-authority` 现在把已验签请求的 `requestId` 作为一次性幂等键，并在 `await execute()` 前同步占用；并发调用无法越过同一个检查窗口。
- 精确重放和保持 `requestId` 但重新计算参数/请求摘要的改参重放均在业务端口前失败关闭，不能用合法新摘要绕过一次性约束。
- 业务端口抛错后仍保留该请求，因为 authority 无法证明下游副作用没有发生；调用方重试不会再次触发未知状态的写操作。
- 重放记录只保留请求最大年龄与允许时钟偏差组成的短期窗口，过期项在下一次请求前回收；内存表另有 4096 项硬上限，满载时拒绝新执行。
- authority 时钟若返回非有限值，会在请求校验和业务执行前失败关闭。

## 回归与门禁

- CLI authority 与签名 deployment loader 定向回归：2 test files、74 tests passed。
- 新增精确重放、同 ID 改参重放、并发重放和下游失败后重试负例；四类场景均证明业务执行端口只调用一次。
- 相关模块 ESLint：0 errors、0 warnings；`git diff --check` 通过。
- 补充启动完整 `npm test`，运行超过 80 分钟且未出现 suite 级失败摘要，但因仍持续生成仓库级跨进程、Git worktree 与耐久性任务而人工终止；该次运行不计为通过门禁。

## 未完成边界

- 当前重放表属于单个 authority 进程内的短期状态；跨进程、重启和多副本部署仍需要外部认证耐久幂等存储及原子占用协议。
- 逐函数最小资源范围、字段投影、交互审批、deadline、协作取消、撤销和不可逆操作恢复仍需由真实签名业务 authority 实现。
- 真实 Volcengine 网络、Electron renderer/preload、企业 tenant/RBAC、身份切换与撤销 E2E 尚未完成。
