# 第一百七十六次工程实施：旧 Stream Controller IPC 租户隔离与最小回执

## 本批目标

关闭启动阶段另行注册的 12 个 `stream:*` handler 无 renderer/DID tenant/用途授权、全局 registry 无 tenant 所有权，以及直接返回 buffer、result、reason、时间戳、内部限制/统计和动态异常/日志的缺口。

## 实施结果

- 12 个 handler 均在 registry/controller 访问前验证实际 Desktop 主窗口/main frame，从主进程当前 identity 绑定 DID tenant，并按创建、控制、删除、状态/统计/列表读取、buffer metadata 读取和 buffer 删除用途授权。
- IPC 创建的 controller 以私有 WeakMap 绑定 authorization tenant；状态、统计、buffer 和控制操作只接受同 tenant 的 opaque streamId，list-active 只列出本 tenant。跨 tenant 查询固定失败，跨 tenant destroy 返回幂等成功但不会删除目标，避免存在性探测。
- renderer 不再提供自定义 streamId；创建使用 `crypto.randomUUID()` 生成 opaque ID。创建选项只接受五个 plain non-Proxy 自有字段，并按核心 Stream Controller 硬上限验证布尔/整数值；未知字段、Symbol、accessor、Proxy 和越界值失败关闭。
- create 仅返回 success/streamId；start/complete/destroy/pause/resume/cancel/clear-buffer 仅返回固定 success。complete/result 与 cancel/reason 参数不再进入 controller 回执或日志。
- get-status 删除 start/end 时间戳，get-stats 使用固定字段/数值投影，get-buffer 不再读取或返回正文，只返回 bufferedChunks/bufferedBytes；list 删除 startTime 并限制为本 tenant 的 opaque 引用、状态和处理计数。
- 旧模块删除直接通用 logger、动态字符串和 `error.message`；全部失败重建为固定 component/operation/code。Phase 1 注册现传入 didManager，身份缺失时请求失败关闭。

## 回归与门禁

- Stream IPC privacy、authorization、registry 与 controller 定向回归：5 test files、75 tests passed。
- Phase 模块注册回归：1 test file、48 tests passed。
- 完整主 LLM 回归：42 test files、605 tests passed、15 skipped。
- 相关 ESLint：0 errors、0 warnings。
- Desktop 主进程构建通过；`git diff --check` 通过。

## 未完成边界

- 这些旧 `stream:*` channel 当前未由 preload 暴露；本批验证主进程注册和合成 handler 合同，未执行真实 Electron renderer/preload E2E。
- 复用的 purpose authority 在生产装配中仍为可选策略；企业组织 RBAC、身份切换时在途 controller 中止/撤销、每 tenant 容量配额和耐久审计仍需目标环境接线。
- 聚合注册器的六个 `llm:*stream*` handler 后续已由第一百七十七批完成 sender/DID tenant/用途授权与身份切换后的事件抑制；其他辅助 LLM IPC 授权、其他 LLM 模块日志/错误通道、tenant HMAC 和生产日志访问治理仍待处理。
