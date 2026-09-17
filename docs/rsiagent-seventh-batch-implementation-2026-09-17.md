# RSIAgent 第七次工程实施：三系统精确 SHA 恢复门禁

> 日期：2026-09-17（Asia/Shanghai）<br>
> 前置实施：[第六次恢复与 CAS 故障演练](./rsiagent-sixth-batch-implementation-2026-09-17.md)<br>
> 后续实施：[第八次存储与 authority 故障关闭](./rsiagent-eighth-batch-implementation-2026-09-17.md)<br>
> 实施基线：`5142f6744220e1ff7af68214e066a8f62b18e02e`；本文记录未提交工作树，不代表已发布版本。<br>
> 状态：恢复演练已接入现有权威 `CLI CI` 三系统矩阵，并新增精确提交绑定、不可变证据上传和完整矩阵聚合门禁；本地验证已通过，GitHub Actions 尚未对本工作树对应提交实际运行。

本文的“第七次”只表示工程交付次序。本批把第六次的本地多进程演练提升为可由发布工作流消费的测试证据，但仍不把测试 authority、强制进程退出或宿主文件系统测试解释为生产级断电耐久性。

## 1. 实施结果

[恢复演练脚本](../packages/cli/scripts/pm-exploration-recovery-drill.mjs)新增两层证据合同：

| 层级       | Schema                                                | 约束                                                                                  |
| ---------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 单平台证据 | `chainlesschain.pm-exploration-recovery-evidence/v1`  | 演练必须通过、绑定完整 40 位提交 SHA、记录平台/架构/Node 版本，并保留非生产边界       |
| 三平台聚合 | `chainlesschain.pm-exploration-recovery-aggregate/v1` | 恰好接收 Linux、Windows、macOS 各一份同 SHA 证据，拒绝缺失、重复、跨 SHA 或生产级声明 |

单平台封装会再次检查第六次演练的全部正向结论、三个崩溃阶段、不同恢复进程、零假成功回执以及四项未验证条件。聚合器不会只相信 `status: passed`，而是重新校验每份报告，并保存各证据文件的 SHA-256 摘要。

命令行入口如下：

```bash
# 执行演练并生成与源码提交绑定的单平台证据
node packages/cli/scripts/pm-exploration-recovery-drill.mjs \
  --source-revision <40-char-commit-sha> \
  --output <platform-evidence.json>

# 校验下载后的完整三系统矩阵
node packages/cli/scripts/pm-exploration-recovery-drill.mjs \
  --verify-evidence-dir <evidence-directory> \
  --release-commit <40-char-commit-sha> \
  --output <aggregate.json>
```

输出采用临时文件加同目录重命名，避免把半写入 JSON 当成可消费证据。

## 2. 权威 CLI CI 接线

[CLI CI 工作流](../.github/workflows/cli-ci.yml)现有 `verify-cli` 作业本来就以 `ubuntu-latest`、`windows-latest`、`macos-latest` 组成矩阵，并检出、核对事件对应的精确 SHA。本批在该矩阵内执行恢复演练，而不是创建不参与 npm 发布判断的旁路工作流。

每个平台会：

1. 使用 Node.js 22.22.2 和当前仓库依赖执行完整恢复演练；
2. 将事件精确 SHA 写入证据封装；
3. 以平台、提交 SHA 和 `run_attempt` 组成 artifact 名称；
4. 即使前序步骤失败也尝试上传，且缺少证据文件会失败；
5. 保留证据 90 天。

新增 `pm-exploration-recovery-aggregate` 作业依赖整个 `verify-cli` 矩阵。任一矩阵项失败或未完成时，它先显式拒绝；全部成功后才下载本次尝试、同一 SHA 的证据，要求合并目录中恰好有三份 JSON，并发布同 SHA 聚合结果。

## 3. 失败关闭条件

以下情况不能产生通过的聚合证据：

- 提交标识不是完整 40 位 SHA，或单平台证据与待发布提交不同；
- Linux、Windows、macOS 任一缺失，或同一平台重复；
- Node 主版本不是工作流约束的 22；
- 演练进程数不足、存在假成功回执、崩溃阶段不完整或 CAS 结论缺失；
- 单平台证据宣称使用生产 authority、验证过物理断电或具备生产晋级资格；
- `verify-cli` 矩阵中任一其他权威检查失败。

[证据与工作流契约测试](../packages/cli/__tests__/unit/pm-exploration-recovery-evidence.test.js)覆盖精确 SHA、三平台完整性、摘要、重复平台、错误 SHA、伪造生产声明和 `CLI CI` 接线；[发布工作流契约测试](../packages/cli/__tests__/unit/release-workflow-contract.test.js)同步要求聚合作业检出并核对精确源码身份。

## 4. 本地验证

| 检查                                | 结果                                 |
| ----------------------------------- | ------------------------------------ |
| 第一至第七次 PM 定向单测            | 101 passed，0 failed                 |
| 恢复演练与证据专项                  | 7 passed，0 failed                   |
| 真实命令行演练、精确 SHA 输出与聚合 | passed；3 platforms；0 false success |
| `CLI CI` YAML 解析                  | passed                               |
| 相关 ESLint / Prettier              | 0 error / passed                     |

命令行聚合闭环在本地通过复制同一份真实演练结果并替换平台字段来验证 CLI 路由和聚合器。这只是本地接口测试，不是三个真实宿主系统的证据；权威三系统结论必须等待 GitHub Actions 对同一实际提交完成矩阵运行。

## 5. 保留边界与下一步

聚合输出继续固定为：

- `testAuthority: true`
- `productionAuthority: false`
- `physicalPowerLossVerified: false`
- `qualifiesForProduction: false`

因此，本批不能关闭 Desktop readiness 中的生产恢复条件，也不能证明真实 KMS/HSM/PKI、独立远端故障域、设备缓存刷盘或物理断电语义。

下一步应在形成实际提交后观察 `CLI CI` 三系统矩阵与聚合 artifact；随后为目标 Desktop 隔离部署引入受审查的生产 authority 和存储目录，并把磁盘满、只读文件系统、远端超时/断连及设备级断电测试作为独立证据类别，而不是修改本批测试报告的资格字段。
