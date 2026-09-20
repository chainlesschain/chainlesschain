# 第六十四次工程实施：隔离 Custody 目录级持久化

日期：2026-09-20

## 本批结论

本批补齐文件系统 quarantine custody 的 directory fsync 边界。此前 blob、metadata、deletion evidence 与 lock owner 的文件内容会在成功回执前 fsync，但创建、重命名、硬链接和删除对应的目录项尚未显式落盘；突然断电时，文件内容已落盘并不等价于最终名称或删除事实已经耐久。

现在所有会改变 custody 命名空间的关键操作都会在返回前同步父目录。任一目录同步失败都会沿原调用失败关闭，不能签发 `durable: true` 的提交、完成或删除回执。

## 主要实现

### 1. 跨平台目录同步

- POSIX 使用只读目录句柄执行 `fsync`；Windows 使用可写目录句柄调用 `FlushFileBuffers` 对应的 `FileHandle.sync()`，当前 Windows 环境已实际执行相关生命周期回归。
- 新建嵌套 state root 时，从 `mkdir({ recursive: true })` 返回的首个新目录逐层同步各级父目录；Windows namespaced path 会先统一后再做边界校验。
- 新建 objects、metadata、deletions、locks 子目录和 artifact lock directory 后同步其父目录。

### 2. 提交与删除顺序

- partial 文件创建后同步 objects 目录；文件内容 fsync 并关闭后，将 `.part` 重命名为 `.blob`，再同步 objects 目录。
- metadata、deletion intent、tombstone 与 lock owner 继续先同步临时文件/最终文件，并在 rename/link/unlink 后同步对应父目录。
- discard、恢复清理和 disposal 的 unlink 在不存在回读之前同步所属目录；lock owner 删除、lock directory 删除分别同步 lock directory 与 locks 根。
- 打开 partial 后若目录同步失败，会关闭句柄、尝试耐久清理 partial 并释放 lock，避免返回一个伪耐久写入 session。

## 验证结果

```text
Filesystem custody / disposal / retention / operator revoke / scheduler / loader:
  Test Files  7 passed (7)
  Tests      95 passed (95)

ESLint:
  0 errors
```

新增 absent nested state root 用例，实际经过递归目录创建、每级父目录同步、四个 custody 子目录同步、artifact lock 生命周期、partial 创建与 discard 删除。原有提交、完成、扫描、恢复、retention、operator revoke 和 disposal 用例共同覆盖其余目录变更路径。

## 仍未完成

- 自动化测试只能证明目标运行时接受并执行目录同步调用，不能代替物理断电、控制器缓存丢失或文件系统损坏注入；真实突然断电后的恢复与证据一致性仍待目标平台验收。
- Windows/POSIX/Linux 文件系统、网络盘、加密盘和容器挂载的实际持久化语义仍需形成部署支持矩阵；不支持目录同步的介质会失败关闭，但尚无生产告警与迁移流程。
- PID 重用孤儿锁的受审计诊断/解除、磁盘耗尽、权限漂移及真实多实例 Electron/custody E2E 仍未完成。
