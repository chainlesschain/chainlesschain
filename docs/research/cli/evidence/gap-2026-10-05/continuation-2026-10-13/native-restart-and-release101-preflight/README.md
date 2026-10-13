# Native 重启、公开 CLI 路径与 0.166.101 发行预检

正式冻结计划保持 **NOT_RUN / 0/36 / 0/9 / NOT_PAID_READY**，原共享上限 **$99**，余额未知。真实账户对账、目标宿主和人工验收按用户要求记为 `SKIPPED_BY_USER`，不计通过。新的 CLI/IDE 发行已获用户授权，仍须最终提交的完整 Actions 矩阵通过。

本归档保存 **1197 份原件映射、650 个去重 gzip 对象**。每个原件的长度、SHA-256 和存储对象摘要见 [manifest.json](./manifest.json)，范围与状态见 [summary.json](./summary.json)。Astra 与根代理均为 AI 审查，不计人工验收。

## 实际 broker 崩溃与重启

新 build008 在固定 owner-only 日志的 flush 与完整链扫描之后、唯一成功回执发出之前，实际终止自己的测试 broker，原 HANDLE 回读退出码 **18945**。同一 supervisor 生命周期中，新 broker 使用新 epoch，拒绝 3 项旧身份请求；恢复 2 项幂等回执，总计 2 次 append、2 次成功 flush，未重复追加原操作。

重启结算原件保留首次 outer Job **1**，15 毫秒后第二次查询真实为 **0**；两次查询均成功，早于 3 秒截止时间，未通过失败清理强制取得零计数。actor 退出 0，12 项直接文件操作拒绝，目标对象身份与 owner-only ACL 保持，Job 清空、profile 删除。根代理核验 175 项 pin，Astra另核验源码、二进制、原件及复制输入；4 次旧失败完整保留，其中 build007 仍失败。

这是固定日志原型的一次真实 broker 重启成功。**完整 native review 仍为 `NOT_ADMITTED / durable=false`**：跨 supervisor 的持续 authority、生产 SQLite WAL/SHM 防回滚、完整冻结 setup/check/baseline/candidate/mutant 工具链尚未完成；未执行断电测试。构建缓存及当前运行时兼容观察也不等于完整编译器闭包证明。

## 出口实验的原始失败

review1 因父进程 IPv6 正控拒绝提前失败。review2 按用户要求将 IPv6 记为外部条件跳过；六项 native 文件访问及两项父进程访问均返回权限拒绝码 **5**，17 项日志 RPC 完成。但 IPv4 loopback 未在固定 `select` 观察界限内就绪，探针赋值 **10060**；它不是 OS 显式拒绝。JS 另记录 `ETIMEDOUT`，也不满足要求的 `EACCES`。**review2 保持失败，外部策略归因为 `UNPROVEN`**，没有调整网络策略或重试。

原 actor 退出 1、broker 退出 2；Job 清空、profile 删除和映射保持已核验。缺失的原最终 ACL 回执仍记为缺失。之后独立只读重开验证相同对象、ACL 和 352 字节有效链，不改变原失败结论。上述事实不能证明所有出口或正式付费就绪。

## 公开 CLI 与生产修复

未修改公开 `.99` 的 1782 个文件。Linux 实际 loader 校验 Ed25519 签名与模块摘要，使用 run-bound `secure:true` composition；真实 PTY chat、Advisor 与一次自动重试完成，**18/18** 断言通过。四次 synthetic loopback 请求均在发起前预留、随后结算，同一 broker/capability 保留非零历史费用；两项签名篡改负控未发请求。Windows authenticated 路径拒绝持久初始化的原失败保留。

公开路径实证的压缩缺陷已在开发 kernel 修复：规划会清空非空上下文，或丢弃任意新摘要时，在提交前以 `context_over_budget` 拒绝，保留原 session/head。新增负控在旧公开实现实际失败；修复的独立 Windows/Linux Node 22.12 定向回归各 **28/28，零跳过**。CLI 消费者对计划拒绝后的用量结算正在进一步审查，最终发行不能借用本地预检或旧提交的测试结果。

## 长期任务和发行边界

截至 **2026-10-13 15:19 UTC**，原 Linux 运行 **35925.188 秒 / 9596 循环**，已保存真实 8h 检查点；新 Windows 运行 **3217.312 秒 / 1736 循环**。根代理回读两者真实身份，观察器均 `MONITORING`。Linux 未观察前缀 809.555 秒及 190 秒旧间隙，Windows 前缀 137.858 秒，均如实保留，不能计为完整 launch 起的正式观察。24h 最终报告尚未产生；旧 Windows 两次中断不与新时长拼接。

发行候选为 kernel **0.1.10**、CLI **0.166.101**、VS Code **0.37.145**、JetBrains **0.4.163**。manifest、lock、CLI changelog 和 IDE 推荐版本已同步。最终准确 SHA 必须通过沿用的七门：CLI CI、Strict Sandbox、Context Memory Kernel CI、IDE Extensions、IDE ARM64、Memory Query Index、Background Interaction E2E；然后按 **OIDC 子包 → CLI → 公网安装回读 → IDE** 发布。本归档时点尚未发布。正式计划仍冻结 `.99 / .37.143 / .4.161`，不随发行修改。

```sh
node docs/research/cli/evidence/gap-2026-10-05/continuation-2026-10-13/native-restart-and-release101-preflight/verify-archive.mjs
```

此前 [native 日志与 Linux 8h 原件](../native-journal-and-8h/README.md) 保留各自历史时点。
