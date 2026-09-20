# 第一百八十次工程实施：告警历史 IPC 身份绑定与输入边界

## 本批目标

关闭 LLM 告警历史读取、新增、dismiss 和清理四个 IPC 入口未验证 renderer、DID tenant 与用途授权，接受 renderer 自报 `userId`/`dismissedBy`，以及任意告警对象和查询参数可直接进入 SQLite 的缺口。

## 实施结果

- 四个入口在任何数据库访问前统一复用 LLM Core authorization，校验实际 Desktop 主窗口/main frame，从主进程当前 identity 绑定 actor DID/tenant，并按历史读取、记录创建、状态更新和历史删除用途取得明确授权。
- 查询、插入、dismiss 和清理的 `user_id` 只来自 authorization actor DID。读取/清理不再接受 renderer `userId`，dismiss 不再接受 renderer `dismissedBy`；处理人固定为当前 actor DID。
- dismiss SQL 同时匹配 alert ID 与 actor DID；跨身份或不存在的 ID 返回相同冻结 success 回执且不会更新目标，避免存在性探测。新增和清理也只返回共享冻结 success，不再返回数据库 ID。
- 历史读取选项只接受 1–250 的 limit、三类固定 level 和布尔 dismissed 过滤；结果继续通过告警字段白名单投影。数据库 details 只解析字符串且限制为 64 KiB，畸形或越界 JSON 固定降级为空详情。
- 新增输入只接受固定 type/level、受限 title/message、可选 provider/model 及四个 details 字段；删除选项只接受 1–3650 天。plain data、长度、有限数值、枚举和对象字段边界会拒绝未知字段、Symbol、accessor、Proxy、renderer 身份字段与隐式类型转换。
- 插入主键使用 `crypto.randomUUID()`；四个操作的 purpose 与允许字段集进入统一 authorization 映射，缺失授权组件时 alert 模块注册失败关闭。

## 回归与门禁

- Alert authorization、输入、actor 作用域、记录投影、聚合隐私与注册定向回归：5 test files、68 tests passed。
- 完整主 LLM 回归：45 test files、614 tests passed、15 skipped。
- 相关 ESLint：0 errors、0 warnings。
- Desktop 主进程构建通过；`git diff --check` 通过。

## 未完成边界

- 历史 `user_id = 'default'` 告警行不会自动归入任意新 actor；需要目标环境依据认证身份制定迁移或明确废弃策略。
- 本批未执行真实 Electron renderer/preload 与 SQLite 用户目录 E2E，也未验证身份切换时告警面板缓存立即失效。
- 生产 purpose authority/企业组织 RBAC、token 辅助 IPC 授权、tenant HMAC 和耐久审计仍待处理。
