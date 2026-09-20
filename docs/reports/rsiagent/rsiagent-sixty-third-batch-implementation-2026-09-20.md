# 第六十三次工程实施：隔离 Custody 崩溃遗留恢复

日期：2026-09-20

## 本批结论

本批补齐文件系统 quarantine custody 在 writer、metadata 原子提交或 deletion 提交中途崩溃后的本地盘点与恢复。custody 首次使用时会扫描专用 `objects`、`metadata`、`deletions` 与 `locks` 目录，按 artifact 取得上一批的跨进程锁后再裁决遗留状态；活进程持有的 artifact 只记录为 active 并跳过，不能被恢复器抢占。

恢复遵循“有权威证据则验证并保留，无权威证据才删除”的原则：完整 metadata 必须与 blob 的长度/SHA-256 一致；deletion intent/tombstone 必须通过原 schema、custody/tenant/handler 与 digest 校验；只有没有最终 metadata、intent 或 tombstone 的 `.part`/孤立 `.blob` 才被视为未提交写入并清除。原子写 `.tmp` 只在锁内清理。未知文件、链接、损坏的最终证据、缺失 blob 或相互冲突的删除证据全部失败关闭，不会被批量删除掩盖。

## 主要实现

### 1. 首次使用盘点

- `ensureRecovered()` 在任一 open、scan、completion、inspect、retention 或 disposal 操作前只共享一次恢复 promise，防止同实例重复并发扫描。
- 扫描只接受规范的 `.part`、`.blob`、metadata、deletion intent/tombstone、原子 temp 和 artifact lock 名称；任何未知目录项立即失败。
- 若发现活进程锁，恢复器跳过该 artifact 并允许不相关 artifact 继续；后续调用会重新盘点，进程退出后可恢复。

### 2. 状态分类与裁决

- `metadata + blob`：重新验证 schema、tenant、digest、长度和 receipt；多余 `.part`/temp 可在锁内删除。
- `deletion intent`：验证完整删除绑定并保留，等待原 disposal/retention/operator authority 以既有授权续作；恢复器不自行签发删除成功。
- `tombstone`：验证 deletion receipt digest，并要求 part/blob/metadata 全部不存在；冲突时失败关闭。
- 无 metadata/intent/tombstone：`.part`、孤立 `.blob` 与对应原子 temp 属于未提交状态，可删除并回读不存在后允许相同 artifact ID 重试。

### 3. 操作内二次核对

全局首次盘点后仍可能有另一个进程崩溃。`openQuarantine()` 因此在取得目标 artifact 锁后再次检查该 artifact 的 final evidence 与 temp；只有完成同样的裁决后才创建新的 `.part`。这避免长期进程因缓存首次恢复结果而无法接管后来出现的崩溃遗留。

## 验证结果

```text
Filesystem custody / disposal / retention / operator revoke / scheduler / loader:
  Test Files  6 passed (6)
  Tests      86 passed (86)

ESLint:
  0 errors
```

新增真实子进程故障用例在 writer 写出 partial bytes 后强制终止进程，同时注入孤立 blob、metadata temp 与 deletion temp；父进程先验证活 owner 期间不能接管，进程退出后完成锁恢复和 debris 清理，以相同 artifact ID 重新写入并取得耐久回读。另一负例放置未知对象文件，恢复明确拒绝且确认文件未被删除。

## 仍未完成

- 文件、lock、metadata 和 deletion 目录项尚未做平台验证的 directory fsync；突然断电仍可能丢失已 rename/link/unlink 的目录更新。
- 自动恢复只处理 custody 专用根内可证明的状态；磁盘 I/O 错误、空间耗尽、权限漂移和底层文件系统损坏需要生产告警与人工处置流程。
- PID 重用的孤儿锁仍选择失败关闭，尚无受审计的管理员诊断/解除入口。
- 真实多实例 Electron、系统休眠/恢复、进程崩溃矩阵和断电故障注入仍待目标环境验收。
