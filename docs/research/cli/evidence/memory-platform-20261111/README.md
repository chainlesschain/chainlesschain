# Memory 三系统回执审计（2026-11-11）

本批核对已有发布源的三系统小矩阵，保留新的本机完整 Stop 失败，并启动计划要求的每组 100 次矩阵。第 8 项仍为 Partial。没有发起模型请求、发布或扩大付费准入。

## 已完成的三系统小矩阵

[Actions 42722731666](https://github.com/chainlesschain/chainlesschain/actions/runs/42722731666) 的源提交是 `daafda2cf7790580467dae8ce006ceaa1285d3b4`，12 个 job 均完成且成功。下载全部 13 个产物，原始 JSON 字节以确定性 gzip 保存，压缩前后 SHA256 见 [manifest.json](./manifest.json)。[jobs.json](./jobs.json) 和 [artifacts.json](./artifacts.json) 保留 GitHub 插件读取的运行、步骤及产物身份；上游 ZIP digest 仅记录，下载器提取后的 ZIP 未在本机重新计算。

| 平台    | 查询五模式样本 | Stop 样本 / 确认取消 / 送达前完成 | 八进程混合轮数 | 首次冷组合样本 |
| ------- | -------------- | --------------------------------- | -------------- | -------------- |
| Linux   | 165            | 66 / 23 / 43                      | 33             | 99             |
| Windows | 165            | 66 / 66 / 0                       | 33             | 99             |
| macOS   | 165            | 66 / 63 / 3                       | 33             | 99             |

各平台、各档、各模式是 **11 次**。Stop 没有送达后的成功返回，两个 500ms 限制均满足；送达前完成不计为取消确认。查询覆盖 baseline/cold/hot/rebuild/corrupt，逐样本结果摘要匹配记录中的全量参考。混合轮次保留代际验证与最终删除可见性审计；组合查询保留独立 oracle、首次调用、完整分页、最终审计和清理条件。组合报告的 `sampleMatrixComplete:false`、`performanceAccepted:false` 保持原值。这些结果不授予新 HEAD、100 次矩阵、真实 IDE Stop 或生产 SLO。

## 本机 100 次 Stop：失败

命令：

```powershell
node packages/cli/scripts/memory-query-responsiveness-benchmark.mjs --counts 1000,10000,100000 --samples 100 --require-cancellation --output .tmp/memory-stop-gap-20261110.json
```

Windows x64 / Node 24.12.0 的三档双模式共 600 个样本完整保存。580 次取消确认、20 次送达前完成，送达后成功返回为 0，所有样本释放 authority lock，各档 authority 字节不变。但 1K validate-disk 和 100K verified-memory 分别出现 **631.349ms** 和 **514.960ms** 的确认延迟，超过既有 500ms 限制，退出码 1、`targetMet:false`。没有删掉样本、放宽限制或用重复运行覆盖失败。原因尚未定位，不能将其直接归因为沙箱、机器负载或产品取消逻辑。

执行时 checkout 为 `ed53ce6527f3bbca5f5e6148a3f0ffc389e7f3fd`，工作区带有 Stop 基准与测试覆盖层；两文件与最新 main `6338e6a1b1310af6a6164d799ab544ed0bc15668` 的 Git blob 完全相同。报告记录的 11 个源码摘要也逐一匹配 `6338e6a1b1`。这是组件字节身份核对，不声明运行在干净的该提交上。进入新 feature 分支前，原工作区已另存 Git stash 快照，原有实现已由 main 保留。

## 完整矩阵与本批改动

使用既有 `memory-query-index.yml`、`samples=100` 启动 [Actions 42850534026](https://github.com/chainlesschain/chainlesschain/actions/runs/42850534026)，准确源为 `6338e6a1b1310af6a6164d799ab544ed0bc15668`。启动时 queued，后续结果应单独补记；本归档尚未授予它通过或完整性结论。

main 已包含原 Stop 修正和 6 个定向回归，本机重新执行为 6/6 通过。本批仅补齐新增 `.node-test.mjs` 文件对 push/pull_request 的路径触发规则，现有三平台 Stop 测试步骤、10ms 调度、500ms 限制及样本数保持原配置。

## 离线复核

在包含记录提交的仓库克隆中执行，无网络、provider 或额外 Python 依赖：

```powershell
python docs/research/cli/evidence/memory-platform-20261111/verify.py
python docs/research/cli/evidence/memory-platform-20261111/verify_test.py
```

校验器检查 14 份压缩/原字节、元数据、12 个 job verdict、样本数量、来源身份、154 组提交/路径字节绑定、Stop 时序与计数，以及组合查询实际行摘要。对于查询全量参考和混合最终审计，它核对回执中的结果摘要及声明，不重新执行原始运行或第三方代码；源码枚举不是完整依赖闭包。5 个拒绝边界用例覆盖原失败保留、伪造通过、缺样本、把完成伪报为取消确认和错误源码摘要。

原 macOS 测量误判保留在 [Issue #578](https://github.com/chainlesschain/chainlesschain/issues/578)；本批 600 次的两个超限属于修正后测量的新失败，二者不混同。多语言真实用户任务、完整冷/热/混合 SLO、双 IDE 生命周期及账单准入仍需各自证据。
