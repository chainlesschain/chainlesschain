# 压缩消费者、重试耗尽与最终本地候选

最终源码的 CLI 消费者回归 **104/104**（5 suites，新增 canonical 23 项），根代理独立 Windows/Linux Node 22.12 kernel 与 conformance 回归各 **29/29，零跳过**。8 份源码在两套验证之间逐项哈希一致。候选 kernel **0.1.10**、CLI **0.166.101**、VS Code **0.37.145**、JetBrains **0.4.163** 尚未发布，最终提交的完整 Actions 发行矩阵仍待通过。

本归档保存 **341 份原件映射、184 个去重 gzip 对象**，见 [manifest.json](./manifest.json) 和 [summary.json](./summary.json)。所有失败、缓存依赖缺失和早期测试原件保留；权威消费者运行是 `run-4J19C8`，不从 `latest` 文件推断最终结论。

## 最终修复及验证范围

kernel 在提交前拒绝清空非空上下文或丢弃任意新摘要，并使用模块私有记录区分实际规划拒绝与外部伪造的错误。公开只读 getter 返回副本，不提供外部注册权限。CLI adapter 另核对 operation/session、规范化费用回执与实际 summarizer 的结果；错误字段本身不能成为计量许可。

自动压缩保留真实 provider 返回的已验证用量，由现有 host 路径实际结算一次，随后停止本轮；未知、错配及用量写入失败仍停止。手动压缩在自有回调中结算真实 ledger/budget，只有确认尚未提交的规划拒绝允许保留原上下文继续交互；提交失败停止，已知费用不会翻成未知或重试。无持久化、无 sessionBudget 的普通模式不制造 `ledgerSettled=true`。

23 项新测试覆盖实际 canonical 规划拒绝、缺失/未知/未结算用量、伪造错误及提交回调、provider/model/callId 绑定、真实计量失败、异步计量拒绝、费用阈值、正常成功和已有费用只记录一次。既有自动压缩、手动压缩、usage boundary 与持久化回归一并通过。它们是本地合成测试，不替代公开发行包或正式模型/宿主验收。

## 公开 `.99` 重试耗尽

新的 Linux 实际 signed secure CLI 单 invocation 配置一次重试；两次 synthetic literal loopback 响应均在 broker 结算后断开连接。**17/17** 断言通过：实际退出码 5，终态 error，无成功结果，两次 physical request、两次预留及结算、pending=0。

从 `15:20:10.415 UTC` 启动到 `15:20:28.188` 真实退出，再到 `15:20:28.198` 三个服务关闭并最终回读 authority，完整边界内无第三次请求；没有用短暂 sleep 推断重试终止。保留 synthetic history 150000 微美元，终态 exposure 150092；实际账单仍未知。公开 `.99` 的 1782 文件哈希未变。

## 工具链静态核验

固定编译器观测识别实际 wrapper 后的 `clang-23.exe` 和 `ld.lld.exe`，记录 1190 个文件 pin、785 个实际预处理输入。五次依赖重放与十项 PE imports 交叉核验通过；三项负控拒绝同尺寸 pin 漂移、越界路径及 ADS 相对路径。根代理重新核对 1290 项源码/二进制/原件 pin，约 499 MB 原始输入字节；归档保存清单和原始输出，不复制工具链库。

**`fullClosureVerified=false`**：静态 imports 与链接计划不能证明原 build008 的实际库成员、动态加载、API-set alias 解析或系统签名信任链。初次依赖参数遗漏与 DLL 名字解析失败的原件均保留，不用于成功结论。未执行新 native capsule、修改真实 cache 或系统策略。

## 发行与原始任务状态

用户已授权测试通过后发行。只读 CI 审核脚本按候选源码展开沿用的七门 **114 jobs**，核对每项矩阵、分片、实际 checkout SHA 与必要步骤，仅接受源码定义的条件跳过；14 项离线回归通过。这里记录的是审核准备，**最终 SHA Actions 尚未通过或发布**。完成后按 OIDC 子包→CLI→公开安装回读→IDE 顺序执行。

正式冻结计划仍 **NOT_RUN / 0/36 / 0/9 / 原共享 $99 / NOT_PAID_READY**；外部账户、真实目标宿主及人工验收按用户要求跳过，不计通过。完整 native authority/WAL、防回滚与工具链执行，IPv4 loopback 原失败，以及实际 24h 最终报告继续开放；两个长期任务的此前快照见 [native 重启与长测原件](../native-restart-and-release101-preflight/README.md)。本轮无新真实 provider 调用，Astra 和根代理均为 AI 审查。

```sh
node docs/research/cli/evidence/gap-2026-10-05/continuation-2026-10-13/compaction-consumers-and-retry-exhaustion/verify-archive.mjs
```
