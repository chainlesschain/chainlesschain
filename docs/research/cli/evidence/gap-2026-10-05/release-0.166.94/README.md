# CLI 0.166.94 配对发行证据（2026-10-09）

源码固定为 `efcab5f632312aea433953157d52091f018f26ae`，已通过 [PR #423](https://github.com/chainlesschain/chainlesschain/pull/423) 合并至 main。所有三个发行标签指向该已验证提交，CLI使用GitHub Actions OIDC；IDE按公开CLI之后的顺序发布。

| 组件             | 版本     | 当前状态                                                |
| ---------------- | -------- | ------------------------------------------------------- |
| CLI              | 0.166.94 | npm公开可取，tarball字节及provenance验证成功            |
| VS Code/Open VSX | 0.37.139 | Open VSX 公开，latest/listed/downloadable，标签字节一致 |
| JetBrains        | 0.4.157  | 已获批并公开上架，全部 entry 字节与标签一致             |

[准确SHA双门](./exact-sha-release-gates.json)：[CLI CI #37794298055](https://github.com/chainlesschain/chainlesschain/actions/runs/37794298055) 71个job成功；[Strict #37794297542](https://github.com/chainlesschain/chainlesschain/actions/runs/37794297542) 5个job成功，涵盖Windows、Linux x64/ARM64、macOS15和额外latest能力。[IDE #37794297457](https://github.com/chainlesschain/chainlesschain/actions/runs/37794297457)18个job成功，仅非tag的Marketplace验证跳过；双IDE全部实际宿主通过。

[CLI公开回读](./cli-public-readback.json)：9,352,287 bytes，SHA256 `0434a449314ac67f6a4a7a651ff8363c7fa23b2069f2c7c6bcf4f9219ce0ceca`；与[不可变发行清单](./chainlesschain-release.json)完全一致。[provenance](./chainlesschain-npm-provenance.json)核对仓库、workflow、ref和准确commit，invalid/missing均0。[OIDC发布 #37821698813](https://github.com/chainlesschain/chainlesschain/actions/runs/37821698813)完整成功。[10个固定子包](./child-registry-readback.json)及[registry-only依赖安装](./cli-public-child-install.json)真实验证完成，本轮无子包源码改动，无新子包版本。

## IDE 标签与公开回读

[VS Code 标签流程](./vscode-tag-workflow-final.json)完整成功（11 成功/3 渠道跳过）；[JetBrains 标签流程](./jetbrains-tag-workflow-final.json)完整成功（13 成功/6 渠道跳过）。上传前分别保留[VS Code](./vscode-cli-prerequisite.json)和[JetBrains](./jetbrains-cli-prerequisite.json)的公开 CLI `0.166.94`、10 个固定子包及能力探测回执。所有 artifact ZIP 下载均与 GitHub 返回的不可变 digest 一致，见[VS Code 产物](./vscode-tag-artifact-readback.json)及[JetBrains 产物](./jetbrains-tag-artifact-readback.json)。

[Open VSX 公开回读](./open-vsx-public-readback.json)确认 `0.37.139` 为 latest、listed、downloadable；公开 VSIX 与[标签候选](./vscode-tag-candidate-manifest.json)原始字节一致，SHA256 `add3060cfa8baee5edf1dab09de6578246bc80390c4376850e0d85fc0acbbc1e`，内容摘要 `c8d9f3d147ed3399eb6d18dbbce483a0371f2b876fb76aaf0652859f0871f063`。

[JetBrains 公开回读](./jetbrains-marketplace-readback.json)确认 `0.4.157`、update `1189859` 已 approve/listed、未 hidden；公开下载包 SHA256 `a32cca3b4785a51dc87a06889cff3f4e4b2c114430e48a2c824610749a5816d5`。公开 ZIP 与标签 ZIP 的容器字节有差异，全部解压 entry 字节逐一相同；版本与 CLI 推荐值 `0.166.94` 及 Doctor 无旧 `0.166.90` literal 均已核对。记录容器差异，不声称原始 ZIP 字节相同。

Open VSX 是本轮 VS Code 插件的主渠道；Microsoft Marketplace 未配置 VSCE_PAT，是未执行的可选回填渠道。本轮未改变 JetBrains 既有上传/Marketplace 签名路径。

## 失败与恢复

GitHub macOS arm64容量不足导致取消项runner为空、steps=0，并有明确“not acquired by Runner”annotation。原件见[容量取消回读](./macos-capacity-cancellations.json)。CLI [attempt1](./cli-ci-attempt1.json)、[attempt2](./cli-ci-attempt2.json)、[attempt3](./cli-ci-attempt3.json)保留失败和缺项；[最终attempt4](./cli-ci-final.json)完成全部矩阵。原63个成功job保留原执行时间，缺项分别在后续轮次实际执行，三个verify-cli生产者首次执行于attempt4，PM汇总读取同轮完整三平台产物。不能把latest API的新job ID/run_attempt当成所有任务重新执行的证据。

Windows Strict原件：合同组2696通过/0失败/11跳过，原生边界组29通过/0失败/11跳过。[PR CLI全套计数原始日志摘录](./pr-cli-test-counts.json)：1994测试文件通过/7跳过；常规CI、全套测试自动化、质量、安全矩阵及恢复后的Clipboard/Keeper/Fairness/Ledger/Session Host均完整通过。原本机完整Strict失败和旧91924f CI失败不删除，不作为当前完整通过的依据。

## 验收边界

此次发行不关闭私有esbuild完整service/config/default forks/full review，也不关闭Windows/macOS durable authority、活跃网络撤销或崩溃恢复。冻结正式36 tasks + 9 firstRuns仍NOT_RUN；官方账户/账单、独立人工setup/check、目标Win11/Node22.12、真人辅助技术、8h/24h及SLO仍需验收。$99预算、原分母、observations和CLOUD-02条件项未改，无新增付费provider请求。

## 证据索引

[Strict完整工作流](./strict-workflow-final.json)与[IDE PR完整工作流](./ide-pr-workflow-final.json)保留run、准确SHA、jobs、实际执行时间和结论。[常规CI](./ci-tests-workflow-final.json)、[PR Tests](./pr-tests-workflow-final.json)、[全套自动化](./full-tests-workflow-final.json)、[质量](./quality-workflow-final.json)、[Safety](./safety-workflow-final.json)、[Clipboard](./clipboard-workflow-final.json)、[Keeper](./keeper-workflow-final.json)、[Fairness](./fairness-workflow-final.json)、[Ledger](./ledger-workflow-final.json)与[Session](./session-workflow-final.json)均有最终快照。

[递归摘要索引](./archived-readback-digests.json)覆盖本目录全部取证原件，包括子包下载、Strict及macOS capability子目录；README与索引自身不参与索引。原件保留捕获字节，提交前再次核对Git暂存区的bytes/SHA256。两份分析的较早日期记录保持各自时点含义，发行状态以最新回读为准。
