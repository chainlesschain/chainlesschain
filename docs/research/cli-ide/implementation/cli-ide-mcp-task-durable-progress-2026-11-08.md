# MCP Tasks 持久化 CLI 与崩溃恢复（2026-11-08）

本批继续推进[差距复核第 4 项](../plans/cli-ide-codex-claude-gap-review-2026-11-08.md)。分支 feature/mcp-task-durable-runtime-20261108；实现基线 520508fb3ad6847955a62a8e24153fc019902e2d。[用户指南](../../../cli/mcp-tasks.md)说明可用命令及恢复边界。

代码提交：2cde23e9f7e950992692b52192cd38b7be5cd6f8。提交钩子通过并已推送 GitHub；未合并或发布，准确提交的跨平台 Actions 尚未完成验证。

**本批行为**

- 新增 mcp tasks create / list / poll / result / cancel，要求明确的 canonical 会话；恢复操作使用原记录的服务器名，不能由参数重定向到其他服务器。
- mcp_task_ledger 与原调用账本联合投影，每次转移复用验链、独立 anchor 和同锁校验追加。prepare 绑定原 started 调用的会话、服务器、工具、输入摘要和本地任务 ID。
- 原调用 started 与 task prepared 是两次追加，不宣称原子。两者之间崩溃会留下未结算调用，既有会话恢复门禁继续阻止不安全重放。受理 ID 未可靠保存时不猜测远端任务，不重跑 tools/call。
- OS Secret Store 保存每任务随机密钥，没有明文降级。HMAC 绑定完整 endpoint、有效 headers、协议、TLS 材料及相关配置；不将 key、认证 headers 或参数正文写入任务事件。跨进程 HTTP session 变化允许恢复，但服务器或凭据身份变化拒绝自动恢复。
- 每次创建、状态查询、结果领取及取消的实际发送处，重新检查身份与会话租约。仍活跃的原宿主不能被自动抢占；取消预写后撤销租约也不能继续发送。
- 受理、状态、取消意图和结果保存分开记录。取消回执丢失必须先 poll 核对，再决定是否显式重发取消；cancelled 不证明副作用已撤销。
- result_saved 单次保存严格校验的最终结果，随后结算原调用。若两步之间崩溃，后继命令从本地正文修复结算，不再次请求结果。已保存结果的 result / poll 无须连接远端或访问密钥服务；list 始终只读本地摘要。
- 任务过期或撤权的服务器错误保留未决状态，不当作“从未执行”。expiresAt 仅为提示，由服务器裁决是否仍可领取，没有宣称本地 TTL 阻断或自动删除。

规范依据：[MCP 2025-11-25 Tasks](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks)。本批 HTTP(S) 请求方流程复用上一批协议入口；普通宿主 facade 仍拒绝直接使用 raw 任务 API，辅助 CLI 经独立持久化服务和租约执行。

**验证与原始证据**

| 验证                     | 结果                   | 范围                                                                                                                    |
| ------------------------ | ---------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 最终组合回归             | 18 文件 303 / 303 通过 | Windows，Node.js 24.12.0；真实 canonical 会话、HTTP 回环、任务日志、CLI、旧 MCP / 账本 / 租约 / 凭据 / TLS 配置来源回归 |
| Windows 原生子进程探针   | 通过                   | 真实 DPAPI、两个独立会话、活跃租约竞争、两处 SIGKILL 后恢复                                                             |
| 真实 CLI help            | 通过                   | mcp tasks 命令注册及 HTTP(S) 范围显示                                                                                   |
| ESLint / Prettier / diff | 通过                   | 本批实现与测试；仓库已有 module type 提示未改动                                                                         |

[最终测试报告](./evidence/mcp-task-durable-20261108/mcp-task-durable-final-tests.json)、[原生报告](./evidence/mcp-task-durable-20261108/native-report.json)及[SHA-256 清单](./evidence/mcp-task-durable-20261108/manifest.json)按原字节归档。首次 63 项测试中 2 项因断言预期的既有错误码写错而失败，原报告保留；后续修正并通过，不累计到最终 303 项。

原生探针仅使用回环假任务，无模型及付费调用。任务受理后强制结束原持有进程，竞争者在原进程存活时收到 LEASE_HELD，原进程终止后新进程恢复 poll / result。另一个任务在 result_saved 后、原调用结算前被强制结束，新进程从缓存修复 completed。两个任务合计 tools/call=2、tasks/result=2，未重复创建或领取。使用隔离的 DPAPI 文件，密钥、加密 vault 和完整会话没有纳入 Git。

Astra 实现并验证日志模块，另对根代理的运行时和真实连接器进行审核，推动修复 HTTPS 拒绝、离线缓存仍依赖远端及 strict JSON 错误路径。连接器测试通过真实 registerMcpCommand，验证固定 JSON、敏感错误不外泄、未调用 process.exit、租约释放后继可用。HTTPS 身份测试使用模拟 TLS identity，不代表真实 TLS 握手。

**剩余验收**

此批提供辅助 CLI 的结果读取，没有模型自动继续或原会话完整 tool round 消费，也没有双 IDE / 桌面原生任务界面。不能据此宣称结果已自动注入模型、模型请求恰好执行一次或完整生命周期进度完成。

当前原调用未结算时的保守门禁仍会限制同会话新副作用调用；跨会话并行另有原隔离机制。本地 stdio 重启后的任务存活、SSE / WebSocket durable 路径、真实第三方服务、真实 HTTPS/mTLS 任务旅程、macOS / Linux OS 密钥服务、跨平台准确提交 CI、掉电耐久性及更完整过期保留策略仍未验收。全项目与第 4 项保持未完成，生产范围及发布状态未扩大。
