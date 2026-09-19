# 第六十二次工程实施：隔离 Custody 跨进程生命周期锁

日期：2026-09-20

## 本批结论

本批把文件系统 quarantine custody 原先只在单一 JavaScript 实例内生效的 `active/readers/completions/disposals` 互斥，扩展为同一状态根上的真实跨进程排他锁。写入 session、扫描字节流、完成 metadata 提交和不可逆删除现在必须取得同一个 artifact lock；第二个进程不能在 scanner 持有字节、writer 尚未提交或 completion 正在改写 metadata 时删除、复用或推进同一工件。

锁使用状态根内按 artifact ID 分隔的目录，并依赖文件系统原子 `mkdir` 竞争。owner 记录绑定 custody、tenant、artifact、操作、随机 lock ID、PID 与取得时间，经文件 fsync 和回读后才视为持有。活 PID 的锁绝不按时间强抢；完整 owner 对应的 PID 已退出时可安全清理并重试。owner 尚未落盘的半初始化目录只允许在固定宽限期后恢复，格式损坏、symlink 或未知目录项一律失败关闭。

## 主要实现

### 1. Artifact 级跨进程锁

- 新增 `locks/<artifactId>.lock/owner.json`，lock directory 只能位于已验证的 state root 下。
- owner schema 固定 custody/tenant/artifact/operation/lockId/PID/acquiredAt，不能被另一个 custody 或 tenant 接管。
- 创建、owner 写入、fsync、回读、所有权核对和释放均在 custody 内完成；调用方拿不到锁路径或释放端口。
- 释放前重新读取 owner 并核对 lock ID；所有权变化、未知文件、链接或清理回读失败都会把结果视为不确定。

### 2. 生命周期覆盖

- `openQuarantine()` 从 `.part` 创建前持锁，直到 commit 完整回读或 discard 清理完成才释放。
- scanner 在异步 body 首次迭代时持锁，重新回读 metadata/blob 后才输出首个字节，并在迭代完成或 `return()` 时释放。
- `completeArtifact()` 在读取旧 metadata、校验 blob、原子写入 ready metadata 和回读期间持锁。
- user discard、retention expiry 与 operator revoke 共用的真实 disposal 端口，在 intent、字节/metadata 删除、tombstone 和清理回读全程持锁。
- `inspectArtifact()` 保持无副作用只读快照语义，不与活动 scanner 互斥；与删除竞争时只能返回完整校验快照或失败，不能修改状态。

### 3. 崩溃 owner 恢复

- 发现现有 lock 时先验证目录结构与 owner schema。
- owner PID 仍存活时返回分类锁定错误，不因锁龄较长而抢占，避免暂停或慢扫描期间双写。
- owner PID 已退出时删除受限的已知 owner/temp 文件和空 lock directory，然后重新参加原子竞争。
- owner 文件缺失但目录仍新鲜时视为另一进程正在初始化；只有超过宽限期才回收。

## 验证结果

```text
Filesystem custody / disposal / retention / operator revoke / scheduler / loader:
  Test Files  6 passed (6)
  Tests      84 passed (84)

ESLint:
  0 errors
```

新增真实子进程回归：子进程提交工件并在扫描流首块后持续持锁；父进程的 operator-style 删除取得分类锁定错误。强制终止子进程后，父进程识别 dead PID、回收遗留锁、完成 intent/tombstone 删除，并取得认证、耐久、精确回读确认。

## 仍未完成

- writer 在 `.part` 或 metadata 临时文件阶段崩溃后的安全盘点、隔离与恢复尚未实现；本批只恢复锁 owner，不擅自删除未知部分工件。
- lock/metadata/blob/deletion 目录本身尚未做平台验证的 directory fsync，因此仍不能声明突然断电后目录项已稳定落盘。
- PID 重用时选择失败关闭而非抢锁；生产运维仍需提供受审计的孤儿锁诊断/解除流程。
- 网络文件系统、真实多实例 Electron、系统休眠/恢复、进程崩溃矩阵与断电故障注入尚未在目标环境验收。
