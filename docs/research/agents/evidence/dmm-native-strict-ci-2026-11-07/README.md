# 原生严格 CI：依赖裁剪失败、复现与修复（2026-11-07）

本批保留前两轮严格 CI 的真实失败及离线复现。修复候选 `cb6d7aa79b282931d9f6fbe998c65f1ef3001437` 的两个 Windows 原生 GUI 与三平台宿主工作流均已成功，两个 GUI 报告的 `sourceStatus` 均为空。未提升版本或发布；CLI CI / Strict Sandbox 的新提交发行门禁仍需另行完成。

## 失败与原因

| 源码                                       | 原生目标旅程                                                                             | 原生移交旅程                                                                             | 已观察结果                                                                                                   |
| ------------------------------------------ | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `947f861886a7592753dc4d2de362413c8f0320e6` | [42286593201](https://github.com/chainlesschain/chainlesschain/actions/runs/42286593201) | [42286593343](https://github.com/chainlesschain/chainlesschain/actions/runs/42286593343) | 两次锁定安装、源码检查及构建通过；目标卡片等待超时、移交确认框可访问性读取失败。保留原始 JSON 和截图。       |
| `e4b51458c8d9db03aa364f61a856f45ab0d346b4` | [42290084043](https://github.com/chainlesschain/chainlesschain/actions/runs/42290084043) | [42290084004](https://github.com/chainlesschain/chainlesschain/actions/runs/42290084004) | 增加有界诊断与加密 Graph 预检后，两者在预检明确报 CLI 无法导入 `ajv/dist/2020.js`；未执行后续 renderer/GUI。 |

[四次失败的远端步骤](./failed-runs.json)、[947 目标失败](./failures-947/goal-journey.json)、[947 移交失败](./failures-947/transfer-journey.json)、[最小错误摘录](./preflight-module-error.txt)保留原貌。947 失败尚不能全部归因为同一问题：模块预检证明了 e4b 的依赖缺失；是否同时解决两个 GUI 失败，仍需完整旅程验证。

根 `package.json` 实际包含 `desktop-app-vue` 和 `packages/cli` 两个工作区。根锁文件正确保留 CLI 的 Ajv 8 和其他工具的根 Ajv 6。先根安装、再在 desktop 工作区运行 `npm ci` 会删除 CLI 专用依赖，使解析退回没有 Draft 2020 入口的根 Ajv 6。

[离线复现源码](./workspace-prune-repro.cjs)只在系统临时目录创建合成本地 npm 包，关闭网络与 lifecycle；[原始结果](./workspace-prune-repro.json)依次为根安装后存在、子工作区安装后缺失、重新安装全部工作区后恢复。归档脚本保留原执行时的报告输出路径；重新执行会创建新的临时 fixture，不重装仓库依赖。

## 修复候选

两个原生工作流只运行一次根 `npm ci --legacy-peer-deps --workspaces --include-workspace-root`，然后从 CLI 解析位置验证 Ajv 8 和 Draft 2020 模块，并验证 Electron 与加密 SQLite 依赖。保留准确 SHA、构建前后 tracked source/index 无漂移、锁定 Electron/原生预编译包、真实加密 Graph 预检、完整生产 renderer 和实际 GUI 旅程要求。

目标失败时增加只读状态诊断；相关 IPC 错误限定为最多 30 条并过滤凭据。移交驱动先读取真实 Win32 子控件正文，不可用时才查询相同 HWND 的 UIA，继续要求核对完整预期内容。预检失败先保存有界结构化报告再退出失败，避免原失败没有可下载制品。

[本地真实加密预检](./local-encrypted-preflight-fixed-reporter.json)通过，运行时 Electron 39.8.10 / Node 22.22.1 / ABI 140 / cipher 12.11.1；[不存在可执行文件的负控](./reporter-expected-failure.json)退出失败并保存 `passed:false`。`local-encrypted-preflight.json` 是 reporter 修复前的历史成功报告，两次不累计为业务用例。

| 准确提交远端工作流                                                                                        | 终态与实际结果                                                                                                                        | 原始报告                                                                   |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| [Windows 目标旅程 42292069411](https://github.com/chainlesschain/chainlesschain/actions/runs/42292069411) | success；真实登录、原生取消/确认、风险→动作→血缘、独立拒绝完成、实际 70 秒停止观察；源码状态干净                                      | [journey.json](./candidate-goal/dmm-native-goal-journey/journey.json)      |
| [Windows 移交旅程 42292069465](https://github.com/chainlesschain/chainlesschain/actions/runs/42292069465) | success；22 份业务原生窗口回执、2 个实际选择器探针、9 次真实 CLI 命令；签名恢复/重导及实际 UI 修订后拒绝回退；源码状态干净            | [journey.json](./candidate-transfer/dmm-native-goal-transfer/journey.json) |
| [三平台宿主 42292069559](https://github.com/chainlesschain/chainlesschain/actions/runs/42292069559)       | Linux、Windows、macOS 全 success；每平台桌面 21/402、renderer 19/292、完整组织 17/338，排除重叠后 **52 文件/954 项通过，0 失败/跳过** | [完整平台报告](./candidate-host/)                                          |

两个原生工作流均通过单次全工作区锁定安装、依赖存在性、构建前后 tracked source/index 检查、真实加密 Graph 预检和完整生产构建。此前 947 GUI 失败在此候选上不再出现；e4b 缺失模块已由新预检直接验证修复。新原生确认报告保留 `verifiedBy`，没有跳过正文验证或替换业务审批。

[终态、步骤和 GitHub 制品身份摘要](./candidate-runs/)按准确 SHA 归档；[工作流快照](./candidate-workflows/)保留实际安装/构建/运行命令。三平台、两个原生预检、父批和历史本地批次均不累计为额外独立测试。

远端报告记录实际读取文件的原始/恢复 SHA256 相同，以及持久回执与重新导出字节相同；归档还可独立验证报告内 Ed25519 签名及回执序列化摘要。远端临时 profile、原始备份/移交文件和数据库未上传，因此本批不能独立重读它们；此前本地 947 的原始字节证据仍在[上一批归档](../dmm-native-goal-transfer-2026-11-07/README.md)，未用新对象重造旧文件。

## 校验与范围

`manifest.json` 保存原始证据摘要及按提交分组的源码摘要。运行：

```powershell
node docs/research/agents/evidence/dmm-native-strict-ci-2026-11-07/verify-evidence.mjs
```

校验器通过 `git show <原提交>:<路径>` 验证历史来源，后续文档提交不会把旧报告绑定到新脚本。它检查四份失败、修复候选的三个终态工作流、两个干净 GUI 报告/运行器摘要、真实停止时间、签名和回退拒绝，并逐平台按文件与用例名去重到 954 项。校验失败报告本身成功不表示产品旅程成功；本批成功依据是上述准确提交的终态与真实报告。

全部运行使用隔离合成数据，尚无独立业务验收或已安装客户端验收。完整安装升级、数据库迁移/回退、Linux/macOS 和 IDE/扩展/记忆/通知组合 GUI、其他 adapter、24 entries/72 份生产签名回执与新增源码发行门禁仍未完成。原始应用日志、凭据、密钥及数据库均未归档。
