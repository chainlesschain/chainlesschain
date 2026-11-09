# MCP 服务端长任务（开发分支）

本功能提供显式的 MCP Tasks CLI 工作流，当前适用于 HTTP / HTTPS 服务。它尚未纳入公开发行承诺。默认沿用 2025-11-25：服务端必须协商 Tasks 能力，并为工具声明 optional 或 required 的任务支持。2026-07-28 的显式配置见下文。

先用 cc session list 找到所属会话，并确认该会话已保存为 canonical 会话。操作期间应退出正在占用同一会话的 REPL 或其他宿主；会话租约会拒绝同时写入，不会自动接管仍存活的宿主。

**使用顺序**

以下尖括号内容需要替换为已有配置及会话 ID：

```text
cc mcp tasks create <tool> --server <configured-server> --session <session-id> --json
cc mcp tasks list --session <session-id> --json
cc mcp tasks poll <local-id> --session <session-id> --json
cc mcp tasks result <local-id> --session <session-id> --json
cc mcp tasks deliver <local-id> --session <session-id> --json
cc mcp tasks watch <local-id> --session <session-id> --interval 1000 --timeout 60000 --json
cc mcp tasks cancel <local-id> --session <session-id> --json
```

create 可以追加 --args 传入工具所需的 JSON 参数；默认协议还可以用 --ttl 指定期望保留的毫秒数。create 返回的 localId 用于后续命令；服务器返回的 taskId 是另一种身份。poll / result / cancel 从所属会话读取原服务器配置名，不接受重定向到另一台服务器。

watch 查询并保存结果，默认随后执行单次 deliver；--no-deliver 只保存。--timeout 覆盖排队、网络请求和轮询间隔；到期只结束本地等待，不向远端发送取消或重放原工具。之后仍可对同一个 localId 再次 poll / watch。显式取消使用 cancel。

**2026-07-28 无状态 HTTP 配置**

仅在服务端支持该协议时显式选择，例如：

```text
cc mcp add reference --transport http --url http://127.0.0.1:3001/mcp --protocol-version 2026-07-28
```

配置文件中的对应字段为 `protocolVersion: "2026-07-28"`，支持用户、项目和受管配置。省略字段保持默认协议；不能在 initialize 响应中自动升级为无状态协议。已有任务的恢复身份包含协议，更换协议后不能自动接续原任务。

该路径通过 server/discover 核查版本和 `io.modelcontextprotocol/tasks` 扩展。宿主为每个请求设置协议、客户端能力和路由信息；只在显式任务操作中声明 Tasks。创建时不发送旧协议 task / ttl，保留期由服务端决定，--ttl 会在派发前被拒绝。查询和领取结果都使用 tasks/get；没有远端 tasks/list 或 tasks/result，CLI 的 list 仍然只读本地日志。取消 ACK 后必须另行查询状态，不能把 ACK 直接显示为远端已停止。

这是有界的任务轮询支持。尚未实现新协议的 input_required 交互续传、采样或订阅流，也没有声明这些客户端能力。独立官方 Everything 2.2.1 的 Windows 多进程恢复与投递证据见[参考服务验收](../research/cli/evidence/mcp-tasks-reference-stateless-20261109/README.md)；它不是远程生产服务、模型续跑或三系统的验收结论。

list 只读已验证的本地记录。第一次 result 会领取并保存正文；保存成功后的 result / poll 可在服务端离线或配置删除后完成本地读取及必要的结算修复，不再次领取正文。列表不会输出结果正文、凭据或 HMAC 密钥。

deliver 要求结果已经保存并结算；它离线将一次外部参考写入原会话，重复调用不会再写。随后可以使用真实输入继续，例如：

```text
cc agent --resume <session-id> "Continue using the delivered result."
```

这一步仍使用原有模型和权限配置。参考不是新的用户要求或模型回答；正文最多 64 KiB，明确标记摘录，完整结果可用 result 查询。普通分页、history 和压缩恢复能读取同一份参考。

**理解状态**

| 字段或阶段                        | 含义                                                                                      |
| --------------------------------- | ----------------------------------------------------------------------------------------- |
| prepared                          | 已写调用预记录；还没有可靠保存远端受理 ID。若对应调用仍为 started，其结果未知，需要核对。 |
| accepted / observed               | 已保存受理或查询回执；这不代表工具已交付结果。                                            |
| remoteStatus                      | 最后一次显式保存的远端状态。取得正文后不据此猜测新的具体状态。                            |
| resultSaved                       | 最终正文已保存在原会话中。                                                                |
| delivered                         | 外部参考已一次写入该会话；不表示模型已读取或完成任务。                                    |
| callStatus                        | 原调用账本的结算状态；只在保存并核对最终结果后完成结算。                                  |
| cancel_requested / cancel_unknown | 已准备取消或取消回执不确定；再次发送前先 poll 核对。                                      |

取消确认不证明此前的写入、构建或导出已被撤销。任务过期、不可访问或服务器返回不存在，也不能证明任务从未执行。expiresAt 只是按服务器回执计算的到期提示，实际是否仍能领取由服务器裁决。

如果结果未知，先查看该会话的 tasks list 和 session mcp-recovery show。不要将相似的服务器任务自动认作原任务，也不要直接重跑原工具来“恢复”。原调用保持未结算时，会话已有的恢复门禁继续阻止不安全重放；取消后的未决副作用也可能需要现有人工核对流程。

**恢复与存储**

任务记录写入现有验链会话日志。每个任务的随机恢复密钥使用系统 Secret Store 保存：Windows DPAPI、macOS Keychain 或 Linux Secret Service。系统密钥服务不可用时，创建会在工具派发前失败；没有明文文件降级。当前原生验证覆盖 Windows DPAPI，其他系统仍需各自验收。

恢复身份绑定完整 endpoint、有效认证 headers、协议、TLS 材料及相关配置。新的 HTTP transport session 可以变化；凭据、服务器或 TLS 身份变化会拒绝自动续接，避免跨账号领取任务。密钥丢失也会拒绝远端恢复；已经保存的本地结果仍可读取。

支持显式 deliver 后由真实用户继续；现有 REPL 另有显式 /mcp-watch 和可选自动唤醒接线。本次参考服务验证只证明跟踪、恢复和会话参考投递，未证明真实模型续跑。fork 保留外部参考，但不继承父任务操作权；原有外来 MCP 调用恢复门禁仍可能限制新操作。双 IDE 任务界面及本地 stdio 任务重启恢复仍属于后续工作。原调用未结算时，保守门禁也会限制同会话的新副作用调用。

实现与测试证据见[实施记录](../research/cli-ide/implementation/cli-ide-mcp-task-durable-progress-2026-11-08.md)。

单次交付与续跑的后续证据见[交付实施记录](../research/cli-ide/implementation/cli-ide-mcp-task-delivery-progress-2026-11-08.md)。
