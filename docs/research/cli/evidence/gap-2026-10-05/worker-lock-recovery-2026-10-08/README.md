# Worker 结算与严格锁释放恢复

- [ci-1e54-final.json](./ci-1e54-final.json)：前序准确源码 CLI CI 的完整 69 job 最终回读。实际失败为 Linux unit shard 2/4 的 Worker message/exit 监听竞态；PM recovery aggregate 为前置检查失败后的连带安全拒绝。
- [windows.json](./windows.json)、[linux.json](./linux.json)：Windows 10/Node 22.22.2 的 74 通过/1 Linux 专属跳过，以及 WSL Ubuntu/Node 22.12.0 的 75 全通过，含实际源码摘要。
- 同名前缀的 stdout/stderr 为采集文本，ANSI 控制码移除；摘要绑定所归档的文本。
- 新增锁恢复 16 项涵盖安全重试和身份替换/缺失/期限/持续争用；Worker 7 项涵盖同回调消息/exit、唯一结果和原错误传播。
- `file-lock-concurrency.node-test.mjs` 在两系统用四个真实进程写入 240 条，核对完整、唯一及每个写者的顺序；不重放写入。

原损坏测试源码 48,441 个 NUL 字节保存为本机 `.work/with-file-lock.test.js.corrupt-20261008`，从 HEAD 恢复源码并新增独立回归。没有改变冻结任务、预算或正式 observations。记录为局部工程验证，CI 发布资格须绑定新的准确源码提交。
