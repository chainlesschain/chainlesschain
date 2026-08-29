# 统一上下文与记忆

ChainlessChain 的 CLI、Desktop、VS Code 和 JetBrains 现在通过同一套 Context/Memory Kernel 契约构建上下文、压缩长会话并管理长期记忆。CLI App Server 是生产 mutation authority；Desktop 和 IDE 通过固定 capability 调用它，不在本地维护第二个可写记忆副本。

## 常用操作

```bash
# 查看会话的上下文窗口占用
cc context [session-id]

# 先预览，再压缩已保存的会话
cc compact <session-id> --dry-run
cc compact <session-id>

# 添加、搜索和召回长期记忆
cc memory add "偏好使用确定性测试" --category preference
cc memory search "确定性测试"
cc memory recall "确定性测试"

# 删除并查看机器可读 receipt
cc memory delete <memory-id>
cc memory reconcile <deletion-request-id> --json
```

交互会话中的 `/context` 和 `/compact` 使用相同的 canonical 预算、CAS 和 receipt 语义。Desktop 的永久记忆界面会转发到 App Server；VS Code、JetBrains 的 Context Center 是有界 projection，不是本地 writer。

## 压缩会保留什么

Kernel 在预算内稳定保留系统策略、当前目标、工作目录/worktree 身份、未完成任务、pending approval/question，以及成对的工具调用和结果。大工具正文存入内容端口，上下文只携带带 digest、大小和恢复策略的引用。压缩提交绑定 session head；并发修改会返回 `stale`，不会覆盖较新的会话。

## 记忆作用域与删除

记忆明确属于 `session`、`agent`、`project`、`user` 或 `global` scope。召回必须同时通过 scope admission、敏感级别和 allowed-sink 检查，不会跨 scope 静默回退。

删除先写入带 revision 和 fence 的最小 tombstone，再清理正文及已注册的索引、缓存、同步副本和已迁移 legacy projection：

- `purged`：当前部署要求的所有在线目标均返回了 purge receipt；
- `partial`：至少一个目标尚未确认，不能视为全局删除；
- `reconciliation_required`：需要使用 receipt 中的 request ID 继续对账。

离线副本不能越过 tombstone fence 回灌。外部备份的保留窗口和未接入 Kernel 的历史离线文件仍遵循部署方的数据保留政策，不包含在在线 purge receipt 中。

## 运维与发布边界

仓库提供 writer inventory、运行期旧 writer 探针、跨端 conformance、容量基准、quick soak 和 30 分钟 release soak。正式生产关闭只接受同一完整提交 SHA 的 Linux、Windows、macOS 矩阵及签注 evidence；本地成功结果只是补充证据。

开发者可参阅 [模块 108 设计](../design/modules/108_Context_Memory_Kernel设计.md) 和 [`@chainlesschain/context-memory-kernel`](../../packages/context-memory-kernel/README.md)。
