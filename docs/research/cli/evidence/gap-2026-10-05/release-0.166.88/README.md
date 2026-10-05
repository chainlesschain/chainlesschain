# CLI / IDE 发布证据（2026-10-05）

本轮发行源码固定为 `7db17a12e15cc92cd7d84f8087141a9521cec5c3`，三项不可变标签均指向该提交。工作区中的后续实际宿主采集实现不属于本次发行。

| 产品             | 版本     | 标签                     | 结果                                                           |
| ---------------- | -------- | ------------------------ | -------------------------------------------------------------- |
| CLI              | 0.166.88 | `v-npm-0-166-88`         | npm OIDC 发布成功，公开 tarball 字节和签名 provenance 校验成功 |
| VS Code 兼容扩展 | 0.37.133 | `ide-vscode-v0.37.133`   | Open VSX 准确版本、listing 和下载制品校验成功                  |
| JetBrains 插件   | 0.4.151  | `ide-jetbrains-v0.4.151` | Marketplace 上传及公开准确版本回读成功                         |

## 准确提交与发布工作流

| 工作流                     | 最终结果                        | 链接                                                                                     |
| -------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------- |
| CLI CI                     | attempt 3；67 成功 / 1 条件跳过 | [37279746954](https://github.com/chainlesschain/chainlesschain/actions/runs/37279746954) |
| CLI Strict Sandbox         | attempt 1；5 成功 / 0 条件跳过  | [37279746478](https://github.com/chainlesschain/chainlesschain/actions/runs/37279746478) |
| IDE Extensions             | attempt 1；18 成功 / 1 条件跳过 | [37279774086](https://github.com/chainlesschain/chainlesschain/actions/runs/37279774086) |
| IDE ARM64 Host Validation  | attempt 1；10 成功 / 0 条件跳过 | [37279869315](https://github.com/chainlesschain/chainlesschain/actions/runs/37279869315) |
| Publish CLI release to npm | attempt 1；5 成功 / 2 条件跳过  | [37290065303](https://github.com/chainlesschain/chainlesschain/actions/runs/37290065303) |
| IDE Extensions             | attempt 2；11 成功 / 3 条件跳过 | [37291923667](https://github.com/chainlesschain/chainlesschain/actions/runs/37291923667) |
| IDE Extensions             | attempt 1；13 成功 / 6 条件跳过 | [37291923696](https://github.com/chainlesschain/chainlesschain/actions/runs/37291923696) |

`cli-release-gate.json` 为生产 CLI 标签工作流生成的准确 SHA 回执，CLI CI 与 CLI Strict Sandbox 均完整覆盖 Linux、Windows、macOS。`release-workflows.json` 保存发行结束时的 7 项工作流、全部任务状态、3 项标签身份及同一 attempt 的 PM 三系统制品身份。

## 失败与官方重跑

CLI CI attempt 1 的 Windows 收尾测试出现一次 `STATE_LOCK_UNAVAILABLE`：4 进程连续 24 次权限设置更新，在产品 2 秒锁预算内未取得锁；失败写入为 `not-committed`。同 SHA 的 Windows 完整单测和 Strict Sandbox 已分别通过该并发断言。当前证据不能确定调度、磁盘或连续重获锁中的具体根因，也未证明死锁；严格拒绝写入行为保持生效。

一次官方失败任务重跑后，Windows 验证成功，但 attempt 2 汇总只取得本批次 Windows 制品，准确错误为 `expected exactly three PM recovery evidence files; found 1`。随后通过官方 API 重跑短上游 Linux 分片及其依赖，使三系统验证及汇总在同一 attempt 3 重新完成。最终完整 CLI CI 成功，源码未改动。失败日志及回执保存在 `windows-verify-attempt1.txt` 和 `cli-ci-retry-history.json`；Astra 分析属于 AI 代码审查，不是独立人工签核。

VS Code 标签工作流 attempt 1 的 Linux stable 首个窗口启动报 `CodeWindow: detected unresponsive`，managed host 退出 1，尚无扩展激活或测试断言记录。同 SHA、VS Code 1.140.0 和 Ubuntu 镜像的预发布门此前通过，相同 DBus 警告也存在于成功日志；具体根因未确认。保留启动日志、journey/progress 材料与 `vscode-host-retry-history.json` 后，官方同 SHA 重跑该任务，最终 attempt 2 的 Linux stable/minimum 宿主门及发布均成功。没有绕过宿主检查。

## 子 npm 包先于 CLI

发行链中的 13 个子 npm 包源码与已发布 `v-npm-0-166-87` 一致，复用已公开的精确版本。`child-package-audit.json` 记录发行前工作区 `0337b334b3baea9e11f6261cc442740bc7761964` 的补充复审，不是最终发行 SHA 的生产门回执；生产工作流仍按依赖顺序逐包核对源码打包结果与官方 tarball，验证公开 fetch、历史 provenance 锚点和 registry-only 子依赖安装，完成后才发布 CLI。CLI 及双 IDE 的公开安装回执均记录 CLI 的 10 个直接内部依赖。没有本地 npm 发布或 token 替代。

## CLI 公开回读

- [公开元数据](https://registry.npmjs.org/chainlesschain/0.166.88) 与 [公开 tarball](https://registry.npmjs.org/chainlesschain/-/chainlesschain-0.166.88.tgz) 已获取。
- tarball：9212213 字节；SHA-256：`180a1f87ec66a190bbd079cef499d20178e7107b3da69383a2b0863377c4607c`；SHA-512：`00c882645c6ca77781d3ecc5f810ef38a26e070cf9a0ce331783ea99f46abc5d2813e01565eb79e9462f61facbbe39fdbcd9cc40e77178a9091fd76132636592`。
- 公开制品与工作流不可变 artifact 的字节、版本、bundled changelog、Web Panel 及 Linux 两架构静态辅助程序均核对成功。
- `chainlesschain-npm-provenance.json` 为官方工作流的签名 provenance 回执，绑定本轮准确源码、标签及工作流。`cli-public-child-install.json` 保存官方 npm 子依赖安装的版本、来源和 integrity。
- `cli-public-readback.json` 是额外本地公开下载校验；它补充生产门，不替代 GitHub Actions。

## IDE 发布跟踪

CLI 工作流及公开回读全部成功后，才推送两个 IDE 标签。标签工作流重新完成相关真实宿主、构建及插件检查，上传前从公开 npm 安装并探测 CLI 0.166.88；回执为 `vscode-cli-prerequisite.json` 和 `jetbrains-cli-prerequisite.json`。

Open VSX [0.37.133](https://open-vsx.org/extension/chainlesschain/chainlesschain-ide)：`ready`、`listed=true`、`downloadable=true`，回读时 latest 为 `0.37.133`。公开 VSIX SHA-256：`b0186911cefbade90e18266c5a29983fe8b4546031948d46ba01c76a28f371c5`；规范化 ZIP 内容 SHA-256：`b525e2835daf9c96fb82742f65348758000a72fa59506c36e9b63daeb177709b`。公开下载与本轮候选 artifact 内容一致。

JetBrains 0.4.151：Marketplace 上传及公开准确版本回读成功。本记录按实际回读区分上传成功和公开上架。`open-vsx-public-readback.json` 与 `jetbrains-marketplace-readback.json` 为仓库自带 verifier 在本地执行的补充公开回读；官方标签工作流自身也完成发布后校验。VS Code 扩展主渠道为 Open VSX，Microsoft Marketplace 为另行触发的可选回填渠道。

## 验收边界

本记录证明本轮准确提交的自动化发布门与制品状态。真实 Docker 整包/反例执行、付费 provider、冻结 36+9 任务、公开首次安装人工验收、AX 听测及长时 SLO 等仍按实施记录保留开放状态；36+9 为 `NOT_RUN`，零正式 observations，费用未测量。后续工作区的 GUI capture driver 验证属于另一次工程补充，不能冒充本次发行源码或正式模型样本。
