# CLI 0.166.147 公开发行（2026-11-11）

CLI **0.166.147 已公开**。准确源码 `32451e4d568e414acdb9c956208e5cff827cd6e0` 通过全部 **76/76 CLI CI**、**6/6 Strict Sandbox** 宿主作业后，使用固定标签 `v-npm-0-166-147` 和 GitHub Actions OIDC 发布。正式作业继续核对准确源码门禁、Linux 双架构制品、公开子包字节及仅 registry 安装，再发布 CLI。

| 项目           | 权威运行                                                                                 | 结果                                                      |
| -------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| CLI CI         | [42959022247](https://github.com/chainlesschain/chainlesschain/actions/runs/42959022247) | 完整分页 76 个 job 全部成功，覆盖 Linux、Windows、macOS   |
| Strict Sandbox | [42959022282](https://github.com/chainlesschain/chainlesschain/actions/runs/42959022282) | 全部 6 个 job 成功，含 ARM64 与 macOS 原生边界            |
| OIDC 正式发布  | [42976618525](https://github.com/chainlesschain/chainlesschain/actions/runs/42976618525) | 发布与上游公开包核验成功                                  |
| 独立公开回读   | [43032767673](https://github.com/chainlesschain/chainlesschain/actions/runs/43032767673) | npm 来源证明成功；公开 tarball 与不可变官方制品逐字节一致 |

安装：`npm i -g chainlesschain@0.166.147 --registry https://registry.npmjs.org`，重启宿主后运行 `cc --version` 和 `cc doctor`。

公开 tarball 为 **9,628,979 字节**，SHA-256 为 `2d933c68e6053d9de21a16c2d2c4e245d964d957ce9663958419b8061e9969b2`。npm 审核的来源绑定固定标签、上述源码、正式运行及第 1 次 attempt，签名审核 invalid/missing 均为 0。三个 `.json.raw` 文件保留回读产物的原始成员字节，文件摘要见 [publication.json](./publication.json)。这些证据不依赖 npm metadata 是否含 `gitHead`。

Open VSX 0.37.186：已公开并核验；JetBrains 0.4.201：官方发行中，公开回读未完成。准确源 `703b22e89` 的 IDE 18 成功/1 项发布后条件跳过、ARM64 11/11、无障碍 4/4、桌面 E2E 4/4、质量 8 成功/2 项条件跳过及进程恢复 2/2 全部完成；两个正式标签均绑定该源。旧源码两次菜单失败、Ubuntu DNS/权限交接/ARM64 ports 失败及 Windows CIM 观测失败保持原样。详见[焦点证据](../../../cli-ide/evidence/jetbrains201-focus/README.md)与[下载/解析修复](../../../cli-ide/evidence/ide201-infrastructure/README.md)。

本批自进化仅推进原 manifest 组件所有权，自动晋级仍 HOLD。受控时钟原生跨夜已通过，不代表真实整夜、已安装客户端或独立业务验收。36+9 仍为 **PREPARED_NOT_RUN**，本次归档没有模型请求或新的完成率成绩；移动/PC、Microsoft Marketplace、账单及付费准入仍保留各自条件。

## 2026-11-12 IDE 正式标签与公开回读

| 渠道                  | 正式工作流                                                                                                       | 实际状态                                            |
| --------------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Open VSX 0.37.186     | [43072205009](https://github.com/chainlesschain/chainlesschain/actions/runs/43072205009)，11 成功 / 3 项条件跳过 | 已公开，771,301 字节，与不可变候选逐字节一致        |
| JetBrains 0.4.201     | [43072220080](https://github.com/chainlesschain/chainlesschain/actions/runs/43072220080)                         | 正式标签工作流仍在运行，尚未核验上传                |
| Microsoft Marketplace | 本次 Open VSX 标签工作流的发布和回读步骤均按条件跳过                                                             | 需单独的准确标签补发；仓库密钥元数据未配置 VSCE_PAT |

Open VSX VSIX 的 SHA-256 为 `3b8579bf23e6ae5f52c11d1e685e16955487f382a16e13b3dc7af805c1f4c83f`，推荐 CLI 0.166.147。[公开下载](https://open-vsx.org/api/chainlesschain/chainlesschain-ide/0.37.186/file/chainlesschain.chainlesschain-ide-0.37.186.vsix)及[生成的回读核验结果](./vscode186-public-readback.json)可复核。`vscode186-candidate-manifest.json.raw` 保留 714 字节的原始托管成员，外层制品 ID 13882992414、原始 ZIP 摘要和内部 VSIX 摘要记录在 publication.json；生成的回读结果与原始成员明确区分。
