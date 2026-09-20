# 第一百四十八次工程实施：Secure Storage 跨进程 Owner Fence

## 本批目标

补齐 LLM 安全配置原子提交器只有进程内互斥的缺口：同步/异步写入、崩溃恢复和删除必须共同取得可跨进程排他的目标 owner；owner 进程崩溃后只能由单一 recovery fence 接管，竞争失败的进程不得清理锁持有者正在写入的临时文件。

## 实施结果

- 每个目标增加相邻的私有 owner 记录。提交器先完整写入并 flush 随机 claim 文件，再用排他 hard link 原子占有固定 lock path，最后同步父目录；同一目标在跨进程范围内只能有一个 owner。
- owner 使用严格、定长有界的 JSON 合同，绑定版本、类型、PID、进程启动时间、随机 nonce 与规范目标摘要。符号链接、非普通文件、超大记录、未知字段、错误摘要和损坏 JSON 均失败关闭。
- 同步/异步写入、同步/异步认证恢复和删除都接入同一目标锁。只有已经取得 owner 的调用才可清理 `.tmp`，竞争失败不会再删除另一进程正在提交的临时文件。
- owner 释放前重新读取并逐字节核对记录；记录被替换或篡改时不会删除当前 lock。
- 检测到 owner PID 已终止后，接管者必须先取得独立 recovery fence。fence 绑定所观察 owner 的摘要；取得 fence 后再次核对完整 owner 字节和存活状态，才可删除孤儿 lock 并重新竞争目标。
- recovery fence 自身也有 owner、存活检查和精确字节释放，多个恢复者不能同时接管同一孤儿锁。进程内 resolved target 集合继续作为快速互斥层。

## 回归与门禁

- 原子文件、备份保留、Secure Storage 隐私与存储定向回归：4 test files、139 tests passed。
- 完整 LLM 主进程回归：35 test files、541 tests passed、15 tests skipped。
- 真实 Node 子进程在 Windows 临时目录中持有异步提交锁时，另一进程的恢复、删除和写入均失败关闭；锁持有者仍可完成提交。强制终止 owner 后，新进程能够通过 recovery fence 清理孤儿锁并提交。
- 覆盖损坏 owner 记录、进程内竞争、rename 失败、认证临时文件恢复与普通同步/异步提交；完成后不遗留 target lock 或 recovery fence。
- 相关模块 ESLint：0 errors、0 warnings；Prettier、JavaScript 语法检查与 `git diff --check` 通过。
- Desktop `build:main` 通过。测试仅出现 Node `punycode` 弃用提示。

## 未完成边界

- 默认存活探针可验证 PID 是否存在，并能识别当前进程启动时间不符；对其他进程无法跨平台读取可信启动标识。远端 PID 被复用时会保守地保留旧锁，需要生产 maintenance authority 处理。
- 当前真实跨进程回归运行于 Windows 本地文件系统。macOS、Linux、SMB/NFS 及不支持 hard link 的文件系统仍需目标环境验收；不满足排他 hard-link 语义的存储会失败关闭。
- 真实突然断电、控制器缓存丢失以及 lock/claim/fence 各阶段的文件系统故障矩阵尚未完成。
- operator 签名 tenant 保留 policy、独立 destruction authority、认证耐久删除审计、真实 OS safeStorage/导入导出 E2E、tenant HMAC、秘密轮换与撤销仍是生产上线门槛。
