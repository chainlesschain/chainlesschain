# 第一百七十七次工程实施：聚合 Stream IPC 授权与身份切换隔离

## 本批目标

关闭 `llm-ipc-stream.js` 聚合注册器中 6 个 `llm:*stream*` handler 未绑定 renderer、DID tenant 和用途授权，controller 可被其他 tenant 通过全局 ID 操作，以及身份切换后旧 controller 仍向当前 renderer 广播事件的缺口。

## 实施结果

- create、pause、resume、cancel、stats 和 destroy 六个入口统一复用 LLM Core authorization，在访问 controller registry 前校验实际 Desktop 主窗口/main frame，从主进程当前 identity 绑定 DID tenant，并按控制、统计读取和删除用途取得授权。
- controller 以私有 WeakMap 绑定创建时的 authorization tenant；pause、resume、cancel 与 stats 只允许 owner tenant，跨 tenant 操作返回固定失败。跨 tenant destroy 保持幂等成功但不删除目标，避免通过销毁结果探测对象存在性。
- renderer 不再影响 controller ID；创建使用 `crypto.randomUUID()` 生成 opaque 引用。创建选项只接受五个 plain、non-Proxy 自有字段，并按核心 Stream Controller 硬上限校验；未知字段、Symbol、accessor、Proxy 与越界值失败关闭。
- 六类异步生命周期广播在发送前重新读取主进程当前 identity；身份已退出或 tenant 已切换时，旧 controller 的 chunk、pause、resume、cancel、complete 和 error 事件全部停止进入 renderer。
- create 只返回冻结的 controllerId 回执，控制与删除只返回共享冻结 success 回执；cancel 不再接收 renderer 原因文本。stats 继续使用固定字段和非负有限数值投影，事件继续只携带 controllerId 与固定 code/component/event。
- 聚合注册上下文新增当前 identity provider；六个操作的 purpose 与字段集进入统一 authorization 映射，缺失授权组件时模块注册失败关闭。

## 回归与门禁

- 聚合 Stream、Core authorization、LLM 注册与旧 Stream IPC 定向回归：4 test files、66 tests passed。
- 完整主 LLM 回归：42 test files、605 tests passed、15 skipped。
- 相关 ESLint：0 errors、0 warnings。
- Desktop 主进程构建通过；`git diff --check` 通过。

## 未完成边界

- 本批验证合成 handler 与主进程构建，未执行真实 Electron renderer/preload 的身份切换和在途 stream E2E。
- 当前在身份切换后抑制旧 controller 广播，但未主动中止其上游 provider 工作；切换时的强制取消、资源回收、每 tenant 容量配额和耐久审计仍需目标环境接线。
- 模型预算与 retention 辅助 IPC 后续已分别由第一百七十八、第一百七十九批完成 actor DID/tenant/用途授权和输入收口；生产 purpose authority/企业组织 RBAC、alert/token 辅助 IPC 授权、其他 LLM 模块日志/错误通道、tenant HMAC 和生产日志访问治理仍待处理。
