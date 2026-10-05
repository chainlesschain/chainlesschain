# CLI / IDE 发布证据（2026-10-05）

本轮发行固定在 `85f2f14aa1c36169e9f362eaaf733fde561a906c`。并行任务在工作区中的后续未提交改动不属于这些不可变发行标签。

| 产品 | 版本 | 标签 | 当前结果 |
| --- | --- | --- | --- |
| CLI | 0.166.87 | `v-npm-0-166-87` | npm OIDC 发布成功，公开 tarball 与工作流制品字节一致，签名 provenance 验证成功 |
| VS Code 兼容扩展 | 0.37.132 | `ide-vscode-v0.37.132` | Open VSX 发布成功，准确版本、latest/listing 和下载制品内容校验通过 |
| JetBrains 插件 | 0.4.150 | `ide-jetbrains-v0.4.150` | 上传成功，Marketplace 回读为 `pending`，等待人工审核/公开列表 |

## 发行前的准确提交检查

| 工作流 | 准确提交结果 | 链接 |
| --- | --- | --- |
| CLI CI | 成功；最新 attempt 的 67 个必需任务成功，1 个可选 dry-run 任务跳过 | [37263113287](https://github.com/chainlesschain/chainlesschain/actions/runs/37263113287) |
| CLI Strict Sandbox | Linux x64/ARM64、Windows、macOS 15/latest 共 5 个任务成功 | [37263117813](https://github.com/chainlesschain/chainlesschain/actions/runs/37263117813) |
| IDE Extensions | 三系统真实宿主、构建和插件校验成功 | [37262884353](https://github.com/chainlesschain/chainlesschain/actions/runs/37262884353) |
| IDE ARM64 Host Validation | 成功 | [37262884363](https://github.com/chainlesschain/chainlesschain/actions/runs/37262884363) |

`cli-release-gate.json` 是 CLI 标签工作流生成的准确 SHA 校验回执，绑定上述 CLI CI / Strict Sandbox 工作流及 Linux、Windows、macOS 矩阵。

`release-workflows.json` 保存发行结束时从 GitHub API 获取的上述 4 个准确提交检查以及 3 个生产发布工作流状态，7 项均为 `completed/success`。其中 CLI CI 使用最新的 attempt 2；其余为 attempt 1。

## 子包先于 CLI

生产发布只走 GitHub Actions OIDC Trusted Publishing。CLI 工作流先按依赖顺序检查/发布子包，再逐包比较当前源码打包结果与官方 npm tarball 的字节，完成只从官方 npm 解析子依赖的安装和能力探针，最后发布 CLI。

本轮所需 13 个子包的准确版本已公开存在，源码打包结果通过字节比对，因此复用这些不可变版本；没有重复发布或人为增加子包版本。

| 子 npm 包 | 复用版本 |
| --- | --- |
| `@chainlesschain/agent-protocol` | 0.1.12 |
| `@chainlesschain/core-env` | 0.1.2 |
| `@chainlesschain/core-mtc` | 0.2.3 |
| `@chainlesschain/core-multisig` | 0.1.4 |
| `@chainlesschain/core-settlement` | 0.1.2 |
| `@chainlesschain/shared-logger` | 0.1.1 |
| `@chainlesschain/core-config` | 0.1.2 |
| `@chainlesschain/core-db` | 0.1.5 |
| `@chainlesschain/core-infra` | 0.1.1 |
| `@chainlesschain/session-core` | 0.3.14 |
| `@chainlesschain/context-memory-kernel` | 0.1.6 |
| `@chainlesschain/agent-sdk` | 0.2.12 |
| `@chainlesschain/personal-data-hub` | 0.4.62 |

## CLI 公开回读

- [npm 发布工作流](https://github.com/chainlesschain/chainlesschain/actions/runs/37271910978)：成功。
- [公开包元数据](https://registry.npmjs.org/chainlesschain/0.166.87) 和 [公开 tarball](https://registry.npmjs.org/chainlesschain/-/chainlesschain-0.166.87.tgz)：已获取。
- tarball 大小：9,207,064 字节。
- SHA-256：`30aa8ba0e0c733330b7117e709f7df367c2f22c70c79a06202095dc543e21749`。
- SHA-512：`0aa90b4a2c3ed7ede8d478c83ca5fb05df3960a7aa74544f477ceb722507f1779e2f2ee1031dcecf36677a5e1832d22d9cdeb0353211cae591c5fa738a39f1fb`。
- 工作流中的公开下载校验和本地补充下载校验均与不可变制品一致；`chainlesschain-npm-provenance.json` 记录 npm 的签名验证结果，`invalid=0`、`missing=0`，绑定本轮准确 SHA、标签和发布工作流。

本目录中的 JSON 直接取自该生产工作流的 artifact：

- `chainlesschain-release.json`：不可变制品身份，含 Web Panel 和 Linux 两架构静态辅助程序信息。
- `chainlesschain-npm-provenance.json`：CLI 的准确发行 provenance 回执。
- `cli-public-child-install.json`：CLI 子依赖从官方 npm 安装的版本、来源和 integrity。
- `agent-protocol-npm-provenance.json`、`agent-sdk-npm-provenance.json`、`context-memory-kernel-npm-provenance.json`：复用子包的可信历史发行锚点校验。

## IDE 发布跟踪

只有 CLI 已公开且回读成功后，才推送以下两个 IDE 标签。标签工作流会重新验证真实宿主，并在上传前安装/探测对应的公开 CLI 0.166.87。

- [Open VSX 标签工作流](https://github.com/chainlesschain/chainlesschain/actions/runs/37272979353)：成功；11 个任务成功，3 个与本标签无关的 JetBrains 任务跳过。
- [JetBrains 标签工作流](https://github.com/chainlesschain/chainlesschain/actions/runs/37272989376)：成功；13 个任务成功，6 个与本标签无关的 VS Code 任务跳过。六个真实宿主任务（Linux、Windows、macOS × IDE 2024.2/2025.2）、smoke、JUnit、构建、结构/兼容性校验、公开 CLI 前置验证及 Marketplace 上传均成功。

Open VSX [0.37.132 公开元数据](https://open-vsx.org/api/chainlesschain/chainlesschain-ide/0.37.132) 回读结果为 `ready`、`listed=true`、`downloadable=true`，`latest=0.37.132`。公开 VSIX 和标签工作流候选制品的 SHA-256 均为 `dd9cdadea44d4906ab0c899053492397307635c5f036118690eb4f94aacef359`，规范化 ZIP 内容 SHA-256 为 `207913abf087ab278b6d187b8d99464cfeb29e8ce1672fb69152df6ddec19e00`。

`vscode-candidate-manifest.json` 来自本轮不可变候选 artifact；`vscode-cli-prerequisite.json` 来自上传前的公开 CLI 安装 artifact；`open-vsx-public-readback.json` 提取自成功发布 job 的校验步骤 JSON 输出。

`jetbrains-cli-prerequisite.json` 来自上传前的公开 CLI 安装 artifact。`jetbrains-marketplace-readback.json` 提取自成功的 post-publish verification job：`status=pending`、`reason=version-not-visible`，12 次回读后尚未在公开 API 看到 0.4.150。因此这里只确认 Marketplace 已接受上传，公开上架仍待人工审核和列表同步。

VS Code 兼容扩展主渠道为 Open VSX；Microsoft Marketplace 是另行配置和触发的可选回填渠道。JetBrains 上传成功与 Marketplace 公开上架分别记录，人工审核中的版本不会记为已公开。

## 验收范围

本记录证明该准确提交的自动化发布门、子包校验和发行制品状态。两份差距报告中尚需真实付费 provider、36+9 冻结验收、人工 AX 听测、8h/24h/SLO、Windows/macOS durable host 或完整 CLOUD resume 的条目保持原有验收状态；本轮发布不将其改写为已完成。
