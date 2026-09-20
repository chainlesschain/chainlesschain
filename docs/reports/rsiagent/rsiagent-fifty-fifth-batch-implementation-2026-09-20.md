# 第五十五次工程实施：隔离下载工件的可恢复耐久删除

日期：2026-09-20

## 本批结论

本批把交互式 `browser:action:discard-download-artifact` authority 接到真实文件系统隔离 custody。删除不再依赖抽象测试端口：custody 会先排他写入并回读删除 intent，再删除 `.part`、最终 blob 与元数据并确认均不可用，最后排他写入、fsync 和回读 tombstone，之后才返回 authenticated、durable、readback-verified 且 `bytesUnavailable:true` 的删除确认。

同一授权处置可在进程重启后从 intent 或 tombstone 幂等续作；绑定不同 action receipt、request、artifact、源下载回执或原因的竞争处置会在删除边界失败关闭。已删除 artifact 的 ID 也不能被重新用于新的隔离流，避免旧 tombstone 与新字节发生身份冲突。

同一 custody 实例内的扫描流由读租约保护：scanner 尚持有字节时拒绝处置，处置进行时拒绝新扫描读取，避免仅删除路径却仍有旧文件句柄可读时错误签发 `bytesUnavailable`。completion 元数据提交与处置也使用互斥状态，防止删除确认返回后又被并发完成流程重建元数据。

## 主要实现

### 1. Authority 与 custody 精确绑定

- `bindDisposalAuthority` 只接受 tenant、handler artifact digest、交互审批、认证耐久回读与不可逆字节处置模式均匹配的 descriptor；
- custody 只接受 disposal authority 输出的完整内部请求，精确校验 action receipt、request digest、opaque artifact ref、内容 digest、源下载回执和有限原因；
- 首次删除前必须从 custody 元数据回读并核对内容 digest 与源 action receipt，不能用另一工件或另一下载的授权替换。

### 2. 可恢复删除事务

删除按以下状态推进：

1. 使用同目录临时文件、文件 fsync 和排他 hard-link 提交删除 intent；
2. 删除遗留 `.part`、最终 blob 和元数据，并逐项回读不存在；
3. 使用同样的排他提交方式写入 tombstone，重新解析并验证其 digest；
4. 删除 intent，再次确认 blob 与元数据不可用，才签发删除确认。

intent 与 tombstone 均绑定 custody、tenant、authority、handler artifact、处置回执、请求、artifact、源下载回执、原因和时间。进程若在 intent 后崩溃，新 custody 实例会继续删除；若 tombstone 已存在，则在确认字节和元数据仍不存在后返回同一 deletion receipt digest。

### 3. 并发与身份复用防护

- 删除 intent 和 tombstone 使用不覆盖的排他提交；
- 两个不同处置同时竞争同一 artifact 时，只有一个绑定可以获胜，另一绑定在活动状态、intent 或 tombstone 校验处失败；
- 相同处置在首个事务完成后的重试可收敛到同一 tombstone；
- scanner 活动读取与 disposal 在 custody 内互斥，活动读租约释放后才能开始删除；
- completion 元数据事务与 disposal 互斥，任一流程活动时另一流程失败关闭；
- tombstone 或未完成 intent 存在时，`openQuarantine` 拒绝复用同一 artifact ID。

## 验证结果

```text
Filesystem custody / disposal authority / streaming executor / signed deployment loader:
  Test Files  4 passed (4)
  Tests      95 passed (95)

ESLint:
  0 errors
```

覆盖真实交互授权到字节删除、删除后不可读取、tombstone 重启幂等、intent 崩溃恢复、竞争处置失败关闭、活动 scanner 读租约、completion/删除竞态、已删除 ID 不可复用，以及原有流式下载执行器回归。

## 仍未完成

- operator 尚未在生产签名 deployment 中装配真实 policy egress、恶意文件 scanner、disposal authority 和该 custody；
- 自动过期清理与 operator revoke 的调度/入口尚未接线，本批只提供已授权原因的底层删除事务；
- 崩溃遗留 `.part`/临时文件的目录级扫描恢复、跨进程全生命周期锁和磁盘耗尽演练仍待完成；
- 文件 fsync、应用层回读和进程重启已验证，但删除目录项尚未执行目录 fsync，也未通过真实断电后的持久性验收；
- 受治理领取、导入和导出，以及目标环境真实 Electron/preload/download provider/custody E2E 仍待完成。
