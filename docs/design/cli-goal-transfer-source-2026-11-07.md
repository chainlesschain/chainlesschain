# CLI 目标移交与签名回退：未发行源码进展

## 实现与发行身份

2026-11-07 核对实现 `7b5376091a`、报告提交
`a2e7f17a03df38bd8e97a8a977351f37dd5319c3` 和
[PR #539](https://github.com/chainlesschain/chainlesschain/pull/539)。该分支尚未发行。
公开 CLI **0.166.143**、Session Core **0.3.26**、Open VSX **0.37.179**、JetBrains **0.4.196** 与客户端 **v5.0.3.145** 均不因这份源码说明获得新移交能力。
操作要求匹配该分支的 CLI、Session Core 与桌面源码构建；当前公共安装说明仍见[发行指南](https://docs.chainlesschain.com/chainlesschain/cli-ide-update-2026-11-06-143.html)。

## 两个存储域的显式交接

独立 CLI 文件目标与原生个人项目目标有各自的存储和权限。
本批实现用户选择目标项目、冻结并备份源文件、原生确认导入以及签名作废后恢复原字节；没有跨存储原子提交的承诺。

```mermaid
flowchart LR
  N[原生选择个人项目] --> D[绑定项目的导入凭据]
  D --> F[CLI 严格锁与原字节备份]
  F --> X[源目标冻结与显式导出]
  X --> C[原生文件选择与确认]
  C --> T[目标/映射/备份的 SQLite 事务]
  T --> P[新项目目标保持暂停]
  P --> R[原生持久作废与签名回执]
  R --> V[CLI 验签并恢复原字节]
```

导入凭据绑定 store、所有者、项目引用/版本和 24 小时有效期，仅含公钥；凭据本身不授予项目访问权限。
CLI 的 `goal transfer-to-project` 需要实际 revision、用户选择的凭据与输出路径，以及显式 `--confirm-transfer`。
严格锁保护冻结日记和原字节备份，既有文件不覆盖。开始前须停止原目标的 CLI 运行；冻结目录不应再由不理解移交日记的旧 CLI 使用。

原生宿主在确认后重新核验当前 actor、项目所有权/版本、窗口/frame/导航、数据库和文件快照绑定。
一个原生 SQLite 事务提交新目标、原 store/ID/revision/digest 映射和原始备份。
导入目标保持暂停，不继承旧监控、受控动作、Memory 权限或完成证明，后续启用仍需独立操作。

## 恢复与回退边界

文件日记与原生事务分别持久化；不确定结果沿同一移交身份重查或恢复。
导出中断可沿原目标、revision 和项目凭据重试到新的空输出路径；导入回包丢失时重选同一文件，读取已有映射而非创建第二个目标。

原生作废仅移除未修订且没有目标关联数据的导入目标；冻结后尚未导入的凭据也可作废。
作废被持久化后才产生 Ed25519 回执，并永久失效该导入凭据。保存回执失败时重新导出同一回执。
CLI 的 `goal restore-transfer` 只接受绑定原项目公钥与凭据的有效签名，恢复原字节；超时或缺失响应不会自动解冻。
已有新业务数据会阻止快照回退，其他项目写入不被覆盖；这不是整个数据库恢复，原始备份与作废历史继续保留。

## 当前验证范围

[分支证据](https://github.com/chainlesschain/chainlesschain/blob/a2e7f17a03df38bd8e97a8a977351f37dd5319c3/docs/research/agents/evidence/dmm-goal-transfer-2026-11-06/README.md)
记录 Windows 本地 **49 个不重叠文件、790 项通过、0 失败、0 跳过**：CLI 118、桌面主进程 383、renderer 287、隔离 npm 打包 2。
真实部分包括文件系统、严格跨进程锁、原生 SQLite、Ed25519、CLI binary、四个 SIGKILL 恢复点、双进程导入及实际 npm 打包。
Electron 窗口/对话框/登录对象和 Vue IPC 为替身；初始 ACL 与依赖加载失败报告保留，不与最终范围累加。

本次文档任务阅读代码和现有报告，没有重跑这批完整运行时测试，也没有执行移交或模型推理。
真实 Electron/IDE GUI、Linux/macOS、真实业务样本、灰度/默认关闭、断电与备份数据库恢复、新源码准确提交 CI 和正式发行仍待独立验证。
这些工程结果不新增历史模型任务验收，也不替代公开 .143 的发行门禁。

## 关键源码

- [移交契约与签名](https://github.com/chainlesschain/chainlesschain/blob/a2e7f17a03df38bd8e97a8a977351f37dd5319c3/packages/session-core/lib/goal-transfer-contract.js)
- [原生事务与移交日记](https://github.com/chainlesschain/chainlesschain/blob/a2e7f17a03df38bd8e97a8a977351f37dd5319c3/packages/session-core/lib/project-goal-transfer.js)
- [CLI 命令](https://github.com/chainlesschain/chainlesschain/blob/a2e7f17a03df38bd8e97a8a977351f37dd5319c3/packages/cli/src/commands/goal.js)
- [桌面原生宿主](https://github.com/chainlesschain/chainlesschain/blob/a2e7f17a03df38bd8e97a8a977351f37dd5319c3/desktop-app-vue/src/main/task/project-goal-transfer-host.js)

权威源为本文件，两个文档站由同步脚本生成副本。站点部署身份与已公开运行时发行身份分别记录。
