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

Open VSX **0.37.186** / JetBrains **0.4.201** 配套源码为 `c3ac7485b2e671864acc52da1fa36fa13ad134fa`，两者当前均**尚未发布**。主 IDE 工作流 18 项成功、1 项发布条件跳过；ARM64 首次 Windows JetBrains 菜单在二级弹窗显示约 95ms 后关闭，保留失败产物 `13836700943`（SHA-256 `20406adc5eedd18383845cd8c11e3c191f34ee983213c3659dfbf14825d0e3cb`）。正在相同源码和断言下复跑失败宿主与汇总，完整门禁通过后才进入插件发行。现有公开插件 **0.37.185 / 0.4.200** 仍推荐 CLI **0.166.146**。

本批自进化仅推进原 manifest 组件所有权，自动晋级仍 HOLD。受控时钟原生跨夜已通过，不代表真实整夜、已安装客户端或独立业务验收。36+9 仍为 **PREPARED_NOT_RUN**，本次归档没有模型请求或新的完成率成绩；移动/PC、Microsoft Marketplace、账单及付费准入仍保留各自条件。
