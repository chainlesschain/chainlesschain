# 交互 Memory 召回开关与诊断等待取消

日期：2026-11-08。承接[差距评审](../plans/cli-ide-codex-claude-gap-review-2026-10-27.md)4.3、4.8、4.10及4.11。父源码为 `7c5d559255070f9ad1e23c454a616091899c7c29`；该主线已由 PR #558 整合旧派发修复。本批是后续未发布源码，完整目标尚未完成。

## 实际复现与修复

交互 CLI 的 `--no-recall-memory` 仅跳过旧启动注入，没有传给 canonical 每请求规划。真实 CLI/Evolution/HTTP 旅程中，关闭召回仍在首次请求、外部删除并添加新 Memory 后、退出再恢复后带入相应正文；修前两条旅程为1通过、1失败。普通默认召回对照正确显示旧→新→恢复后新，不能把此前对 legacy 绕过的静态怀疑写成已复现缺陷。

REPL 现在在启动时固定本次召回选择，传给 canonical 规划、hierarchical context、子代理 Memory 继承及直接压缩/Goal judge。canonical 启动采用每请求授权召回，跳过旧启动注入。帮助和 CLI README 同步说明交互范围。恢复时再次显式传开关；本批不宣称偏好已经持久化。

模型输入诊断直接 await observer，原先在逻辑输入、请求 body 或预算 scope 结束时不能及时结束等待。新增3条先红回归证明问题。诊断现在继承调用者、请求及预算生命周期信号，最终 governed-body 观察还继承独立 transport timeout。取消解除调用者等待，迟到 resolve/reject 保持被观察且不能恢复派发；observer 自身可以继续执行。body/signal 快照和 attempt 关联保留，关闭诊断的普通传输路径保持原行为。预算已经预留的请求保守保留 unknown，不重置额度、不重放。

原快照正例预先取消却仍期待假 fetch 被调用，与更强的前置取消合同冲突；已分别覆盖未取消时的快照/原信号绑定和已取消时 observer/transport 均不调用，原失败报告保留。

## 验证与原始记录

- Node22.20：23文件 **599/599**，无跳过。包括取消、迟到拒绝、已取消前置拒绝、关闭诊断兼容及既有上下文/压缩/流式/REPL回归。首轮597通过、2条既有 Bash 用例误走未安装WSL；仅为本次命令启用本机Git Bash后，同一选择全部通过，没有修改机器全局环境或旧测试。
- Node24.12/SQLite ABI137：预算套件 **108/108**，无跳过。新增独立2秒transport timeout在最终body observer仍被阻塞时结束请求，unknown责任保留，释放后物理fetch仍为0。
- 真实交互CLI **2/2**：两轮、独立进程删除/新增、退出后同session恢复第三轮。默认召回内容及时更新，关闭时三次请求均无Memory标记；两次verified JSONL均无Memory原文，用户轮数2→3。绿色原始回执另存JSONL，供离线直接核对。
- Web Panel重新构建成功；89候选静态分类通过，78条调用链仍未映射。生成帮助检查和修改文件lint通过，原有unused变量警告保持单独范围。

[原始红/绿报告、绿色请求摘要、源码快照及离线校验器](../../cli/evidence/recall-policy-2026-11-08/README.md)。599、108和2分别按测试范围报告；旧402/106、425/108及历史性能不加到本批成绩。归档摘要证明所选源码字节和记录完整性，不代表完整依赖闭包或第三方签名。

## 剩余范围

输入终端由 `isTTY` 模拟，readline、CLI/Evolution、provider传输与持久化为真实进程；这不是OS PTY或真人键盘/读屏器验收。加密SQLite安装不由可降级bootstrap警告证明。没有外部付费模型调用，不扩大 `paidReady`、`runtimeCoverageVerified`、语义质量、性能SLO、安装升级或完整OS准入。

真实语义候选源与独立相关性评测、完整REPL/双IDE崩溃恢复和历史来源治理、准确提交三系统门禁及生产宿主准入继续保留。主线 `7c5d55925` 的IDE工作流 `42441006550` 在公开能力清单遗漏新增model-input命令处失败，其余主要CLI门禁仍待准确终态；合并不是发行通过证明。
