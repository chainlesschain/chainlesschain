# MCP 新版协议与独立参考服务验证（2026-11-09）

对应差距复核第 4 项。新增显式 2026-07-28 HTTP 任务轮询路径，并完成官方未修改 Everything 2.2.1 的 Windows 多进程恢复验证。整体条目仍为 partial，项目目标仍未完成。

## 实现范围

用户、项目和受管配置可持久化 `protocolVersion`，CLI 增加 `mcp add --protocol-version`。默认协议仍为 2025-11-25。旧 SQLite 表通过可空列迁移保留原配置；省略版本保留已有选择，显式 null 清除。无状态版本只允许 HTTP(S)。

新路径使用 server/discover、每次请求的 params._meta、MCP-Protocol-Version、Mcp-Method 和按方法确定的 Mcp-Name。宿主覆盖保留字段，Unicode 或保留前缀按协议编码；不沿用 HTTP session。协议进入 discovery cache 和原有任务恢复身份，不能跨协议复用身份。

只为显式任务操作声明 `io.modelcontextprotocol/tasks` 扩展。创建不发送旧 task/ttl；现代 TTL 参数在派发前被拒绝，普通工具意外返回任务则保持结果未知，不自动重放。tasks/get 同时承担状态和最终结果查询，先校验 taskId、状态、时间与结果身份，再转换为既有验链日志结构。取消 ACK 必须另行观察，不能推断远端终止。没有新增出站适配器或修改付费准入。

协议依据为官方 [2026-07-28 Tasks 扩展](https://github.com/modelcontextprotocol/ext-tasks/blob/main/specification/2026-07-28/tasks.md)及[协议变更记录](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/changelog.mdx)。本实现没有覆盖 input_required 交互续传、采样、订阅流或全部现代协议；没有向服务端声明这些能力。

## 实际缺陷与修复

新增回归在修复前得到 3 项失败：挂起的网络请求与 60 秒轮询间隔均未在 100 毫秒 watch 期限结束；已中止调用者仍可把缓存结果投递到会话。修复用统一 AbortSignal 覆盖排队、请求、间隔、结果领取和投递边界，finally 清理计时器。排队中的过期查询不能在之后派发；已中止的缓存路径不能发布参考。超时不发送 tasks/cancel、不宣称远端停止，也不重新创建工具任务。

最终回归为 **42 文件、563/563**，包含旧协议、stdio/WebSocket、HTTP 取消/超时/大小限制、配置迁移、真实会话日志、交付、压缩与恢复。该数字包含新协议和运行时子集，不能与子集重复相加。ESLint、Prettier、命令帮助与清单检查通过。

## 独立参考服务

隔离安装 `@modelcontextprotocol/server-everything@2.2.1`，未更改根依赖或锁文件。npm tarball 的 SHA-512 与注册表 integrity 一致，发布包全部 **59/59** 文件与实际安装逐字节相同；另存 94 项安装依赖的版本与 integrity。该参考服务自身需要 Node 24，本次使用 Windows x64 / Node 24.12.0。

未修改的 createApp 在独立进程内监听数字 IPv4 loopback，生产 MCPClient 和 DurableMcpTaskRuntime 在另一个进程创建模拟研究任务。保存受理后强制 SIGKILL 客户端。新进程通过真正的 DPAPI 密钥恢复原绑定，查询并投递结果；再次重启后重复 deliver 仍只返回原 deliveryId。独立校验确认原会话只有一条经过验链的 assistant 外部参考，正文包含任务 marker，没有伪造 user/tool 消息。第二个任务验证取消 ACK 后查询得到 cancelled。

服务端观测为两次 tools/call（两个不同任务），一次 tasks/cancel，八次 tasks/get；六个客户端进程各自 discover。只有 POST，无旧 initialize、tasks/result、tasks/list、GET、DELETE 或 session header。没有调用真实模型、外部生产服务或收费工具。

脚本、回执、JUnit、源码摘要和原包核验见[证据目录](../../cli/evidence/mcp-tasks-reference-stateless-20261109/README.md)。新诊断脚本动态加载指定安装的参考服务，不在静态网络扫描候选集中；这一扫描边界不能当作无网络行为的证明。对已修改 MCP transport 的分类逐项复核后刷新摘要，审计仍为 89 个候选、0 未分类、0 解析错误，78 个调用链尚未映射，`paidReady:false`。

尚需远程第三方生产服务、真实模型续跑、现代输入交互、实际到期/撤权、双 IDE/桌面及多平台证据。旧源码提交 52a24ee 的 GitHub 矩阵已取消且三个系统测试跳过；取消不是通过。本批新提交的 CI 另行按准确 SHA 核对，未发布任何包。
