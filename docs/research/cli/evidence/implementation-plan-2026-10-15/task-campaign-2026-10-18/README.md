# CLI / IDE 原生 36+9 实际任务评测（2026-10-18）

状态：**执行中，等待最新轮完整产物**。本轮按用户授权使用火山引擎付费测试，优先核对实际交付与验收；费用未评估、未推算。

## 当前指定轮次

本轮从各真实入口执行 36 项原始项目任务及 9 次独立首次安装项目任务。每次 first-run 使用独立安装流程、profile、workspace 和 run ID；同层普通任务不能替代它。九入口的 nonce 冒烟结果另列保存。

| 样本         | 候选通过独立验收 | 生成、宿主与验收全程通过 |
| ------------ | ---------------- | ------------------------ |
| 普通任务     | 10/36            | 5/36                     |
| 独立首次任务 | 0/9              | 0/9                      |

已收集当前指定轮次生成 30/45、验收 30/45。未收齐时，上表仅是当前观察值。

各入口下列三项依次为：生成通过 / 候选验收通过 / 全程通过。生成包含真实模型终态、工具范围、来源范围、代理状态，以及 IDE 的 UI 观察和重启恢复；候选验收在重建的冻结项目上执行。

| 原生入口         | 普通任务（各 4 项） | 独立首次任务（各 1 项） |
| ---------------- | ------------------- | ----------------------- |
| win32-cli        | 待收齐              | 待收齐                  |
| win32-vscode     | 待收齐              | 待收齐                  |
| win32-jetbrains  | 待收齐              | 待收齐                  |
| linux-cli        | 2/4 / 2/4 / 1/4     | 1/1 / 0/1 / 0/1         |
| linux-vscode     | 4/4 / 0/4 / 0/4     | 1/1 / 0/1 / 0/1         |
| linux-jetbrains  | 0/4 / 2/4 / 0/4     | 0/1 / 0/1 / 0/1         |
| darwin-cli       | 2/4 / 1/4 / 1/4     | 1/1 / 0/1 / 0/1         |
| darwin-vscode    | 3/4 / 3/4 / 3/4     | 0/1 / 0/1 / 0/1         |
| darwin-jetbrains | 0/4 / 2/4 / 0/4     | 0/1 / 0/1 / 0/1         |

精确逐项结果见 [CSV](./native45-latest-results.csv)，完整失败、基线、候选测试与行为变异控制记录见 [results.json](./results.json) 及其引用的原始压缩摘要。即使候选文件合格，网络失败、越界变化、宿主或恢复失败仍阻止全程通过。

## 轮次与历史

- 较早的 Linux CLI 36 项诊断：首次 **8/36**，含已记录的有界修复 **11/36**。它与本次九原生入口的 36+9 分开。
- 原生第一轮 `39051952884`：候选 **4/36、0/9**，全程 **2/36、0/9**；旧失败及原始判定均保留。
- 当前指定轮次：Windows CLI `39057575738`、VS Code `39057579828`、JetBrains `39057583779`；Linux/macOS VS Code `39055183659`、JetBrains `39055189152`；Linux/macOS CLI 沿用第一轮的精确候选与绑定复核。Windows 已显式修正 tar UTF-8 路径，其余传输、工具及 token 限制保持记录值。
- [独立来源审计](./native45-independent-audit.json) 分别记录首轮原判定、独立复核、历史累计和当前指定轮次。验收只按生成摘要 SHA-256 和 sample ID 关联；当前轮缺项不以旧通过填充。历史累计代表多次尝试后的覆盖，不是单轮成功率。

## 已定位并修复

1. Windows GNU tar 误解析盘符：使用原生 Windows tar。
2. VS Code 测试 relay 的 512 字符限制：完整原始提示经真实 webview textarea/input/send 提交，并比对 raw CLI input。
3. 持久 IDE 正常 `result` + `system/end` 被旧 checker 误判：严格校验唯一相邻终态、session、trace、turn 和 seq；原始流及旧失败不改写。
4. 缺少标准 Windows profile 目录导致 PowerShell 缓存污染工作区：建立 AppData 目录并使用绝对缓存路径，保留来源范围限制。
5. 长 SSE 响应撞 1 MiB 诊断传输上限：原生评测显式使用 16 MiB，上游输出上限仍为 8192 token、24 请求、180 秒。未知用量仍停止代理，不自动 HTTP 重放。
   Windows tar 文件名编码也已修复；旧产物按原始归档 header/PAX 信息核验完整树后，可在规范冻结源码上单独验收候选，其初始路径错误仍阻止全程通过。详见 [真实 CI 归档核对](./windows-archive-proof.json)。
6. 产品源码：JetBrains Markdown 历史恢复、CLI 延迟写入未执行却报告完成、上游 aborted 被误判用户中断。分别有 21 项 JUnit、22 项 focused Vitest、9 项中断回归通过；产品修复尚未发布，本轮仍使用下述公开版本。

完整提交 SHA、验证收据和优化边界见 [optimization-validation.json](./optimization-validation.json)。单元回归不替代修复版本的真实 GUI / 模型复测。

## 交付质量诊断

[Linux VS Code 五项逐一复核](./linux-vscode-task-quality-review.json) 已比对候选、checker receipt 与冻结源码：五项基线全部通过，候选真实落盘，23 个已执行测试中 15 过、8 败，另 6 个测试体被导入错误阻止执行。行为变异阶段均未进入。

| 样本           | 已证实的候选错误                                 |
| -------------- | ------------------------------------------------ |
| 首次 verify-05 | 调用不存在的 `createAgentRouter`，并误读返回结构 |
| 普通 verify-05 | `_runSingleTask` 少传独立 backend 参数           |
| verify-14      | 相对导入多退一层，未执行候选测试                 |
| verify-23      | 缺少 maintenance 证据，却断言完整 baseline 成功  |
| verify-32      | 忽略帧延迟最小 20ms，提前推进计时器              |

JetBrains 存在候选通过但重启恢复失败的情况，不能按文件通过数宣称插件完成任务。部分样本仍遇 8192 token 输出截断；传输上限修复不等于输出截断已解决。

## 证据与边界

- 冻结项目：`b2aa3aba082873570e85dce39b00754e5504ff37`；计划 digest：`sha256:04b90d1a93cfd6556f91688a39508c69e4423671a7b6bcb85fac4dc7e82c0e13`。
- 公开版本：CLI `0.166.99`、VS Code `0.37.143`（host `1.132.0`）、JetBrains `0.4.161`（IntelliJ `2025.2`）；模型为 `volcengine/deepseek-v4-flash-ga-260731`，Node `22.12.0`。
- 这是 thinking disabled、六文件工具的诊断；Windows 使用 hosted runner。生成在原生系统完成，所有候选执行验收均在 Linux、无网络 Docker 中完成，不表示 Windows/macOS 原生测试通过。
- 通过候选与收据按原始字节校验 SHA-256，分别归档到 [原生候选索引](./native-verified-deliveries.json) 和 [较早 Linux 诊断索引](./verified-deliveries.json)。归档测试追加 `.txt`，避免测试发现；内容与 digest 保持不变。
- [所有已收集原生候选](./native-candidates.json) 同时保留失败文件和未改动占位，不能视作通过列表。证据完整性可用 `node verify-evidence.mjs` 在此目录离线核验。
- 冻结 observations 保持 **0/36、0/9**，`paidReady:false`。未作正式准入、生产或发布背书。
