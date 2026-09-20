# 第一百七十一次工程实施：LLM Manager 原始异常终止边界

## 本批目标

关闭 `llm-manager` 直接方法把 provider、缓存、压缩、治理工作流、Volcengine 工具或 Token Tracker 的原始 rejection 交给调用方的缺口，同时保留受治理模型入口的终止错误码语义。

## 实施结果

- Manager 隐私边界新增固定异常工厂。普通失败统一重建为 `LLM manager operation failed` / `CC_LLM_MANAGER_OPERATION_FAILED`，只携带白名单 `component` 与 `operation`，不保留原异常对象、message、cause、stack 或任意扩展字段。
- `CC_AGENT_EVOLUTION_INGRESS_FAILED` 仍作为唯一受控终止码传播，但同样重建为固定 message/component/operation，不再原样传播可能带私有 message/cause 的治理异常。
- initialize、client 创建、provider 切换、query、chat、stream、embeddings、受治理函数工作流、五类 Volcengine 工具和预算/统计异步入口均接入固定边界；公开 chat/stream 外层也会重新收口缓存与 Desktop ingress 的 rejection。
- query/chat/stream 的既有固定 failure event、服务状态 fallback、token tracking 非终止失败与 provider fallback 行为保持现有合同。
- 新增普通 Error、治理 Error 与 hostile Proxy/accessor 回归，并将初始化、client 创建、provider 切换、query、embeddings 的断言更新为稳定错误合同。

## 回归与门禁

- Manager、governance 与 workflow admission 定向回归：4 test files、94 tests passed。
- 完整主 LLM 回归：41 test files、595 tests passed、15 skipped。
- 扩展 `src/main/llm/__tests__ + tests/unit/llm` 回归：61 test files passed；与本批无依赖的 `secure-config-storage.test.js` 基线仍有 8 项失败，单文件重跑结果相同，失败集中于共享配置文件的 save/load/delete/password import/export 状态。
- 相关 ESLint：0 errors、27 条既有 `curly` warnings。
- Desktop 主进程构建通过；`git diff --check` 通过。

## 未完成边界

- Manager 的 provider/model/budget 成功事件与其他非失败业务事件仍携带现有 payload，需要独立完成字段投影和订阅授权。
- Stream controller、test-data、selector 与其他 LLM 模块的成功 payload、内部事件和授权投影仍待收口。
- 企业 purpose/RBAC、身份切换中止与撤销、真实 Electron renderer/preload/provider E2E、tenant HMAC 和生产日志访问治理仍需目标环境验收。
