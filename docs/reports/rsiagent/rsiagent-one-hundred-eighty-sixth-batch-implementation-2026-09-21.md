# 第一百八十六次工程实施：Prompt Compressor IPC 授权与身份隔离

## 本批目标

关闭启动阶段注册的 10 个 `compressor:*` handler 未验证 renderer、当前身份与用途，共享进程级配置/历史，接收和返回任意消息对象，并把配置、消息片段及原始异常写入普通日志的问题；同时阻止压缩入口通过启用总结间接取得未声明的模型推理能力。

## 实施结果

- 配置读取/设置/重置、压缩、预览、Token 估算、建议、统计、历史读取和清理 10 个入口，在访问 Compressor 或历史前统一复用 LLM Core authorization，验证实际 Desktop 主窗口、main frame、主进程当前 DID/tenant，并携带各自固定 operation、purpose 与冻结字段集；Phase 1 已完成生产装配。
- 生产注册按 actor DID 延迟创建独立 Compressor，并按 DID 保存最多 100 条只含 token、策略、耗时和时间戳的历史；进程最多接纳 128 个 actor，身份之间不能读取或清理彼此配置和历史。
- 消息只接受 `system/user/assistant/tool` role 与字符串 content，最多 200 条、单条 64 KiB、合计 256 KiB；稀疏/扩展数组、未知消息/配置字段、renderer 身份字段、Proxy、accessor、越界 Token/阈值/limit 和额外参数失败关闭，getter 不会执行。
- 配置、压缩消息、token/比例/策略、预览、估算 breakdown、建议、统计和历史均从 plain data 白名单重建；Compressor 或 LLM 扩展字段、动态建议描述和原始异常不再跨 IPC。失败只返回固定 `CC_LLM_IPC_OPERATION_FAILED`，授权拒绝使用固定 `CC_LLM_IPC_UNAUTHORIZED`。
- 独立 IPC 不再把共享 `llmManager` 注入 actor Compressor，且显式拒绝 `enableSummarization: true`；即使注入实例已开启总结，压缩也失败关闭，压缩用途授权不能扩大为模型推理权限。本地去重、截断、预览与估算仍可用。
- canonical Context/Memory 阶段继续在配置写入和实际压缩前返回固定 legacy-writer fence，并指向 App Server context plan/compact 替代路径；授权检查仍先于 fence。
- `prompt-compressor.js` 的配置、消息片段、数量、比例、耗时、策略和 caught Error 日志已改为固定白名单事件/失败回执，直接 logger/console 与 `error.message` 归零。固定 preload capability 清单仍未暴露这些通道，验证保持 1,227 exact、156 denied。

## 回归与门禁

- Prompt Compressor IPC/实现、Core authorization 与 Phase 定向回归：4 test files、97 tests passed。
- 完整主 LLM 回归：49 test files、644 tests passed、15 skipped。
- 固定 renderer IPC capability 验证通过：1,227 exact、156 denied。
- 相关 ESLint：0 errors、0 warnings。
- Desktop 主进程构建通过；`git diff --check` 通过。

## 未完成边界

- `authorizePromptCompressorPurpose` 是可选部署策略；企业组织 RBAC、压缩正文独立字段审批、身份切换撤销和生产 audit writer 尚未接线。
- actor 配置与历史仍是进程内状态，重启即丢失；达到 128 个 actor 后新身份会失败关闭，尚未接入登录/退出生命周期回收或认证持久化。
- canonical Context/Memory 已默认围栏旧写路径，但 App Server context plan/compact 的真实桌面调用、正文最小披露和恢复 E2E 不属于本批证明范围。
- 通道当前未进入 preload 白名单；若恢复对应 UI，需要同时增加最小 preload API、界面验收及真实 Electron 多身份/身份切换 E2E。
