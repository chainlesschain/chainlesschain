# CLI .129 公开配对文档同步

日期：2026-10-29。第二十批，承接[差距表](./cli-ide-codex-claude-gap-review-2026-10-27.md)第 4.9 节。基线 `b8dc60c43174967f3c84cf88373119f224e45480`；直接修改 `main`，Microsoft 渠道继续暂缓。

已公开的 CLI `.129` / Open VSX `.167` / JetBrains `.184` 在部分入口仍标为候选，安装示例还指向 `.105`、`.112` 或 `.128`。本批根据既有公开回执统一入口，保留带日期的历史记录。

| 项目                   | 当前完成情况     | 证据与边界                                                                                                                                                         |
| ---------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 根中文 / 英文 README   | **源码同步完成** | 当前配对、安装命令、累计 34/45 及未发布功能边界一致；历史版本保留。                                                                                                |
| CLI README             | **源码同步完成** | `.129` 改为公开发行；说明完整双门禁、OIDC、子依赖和 IDE 配对，未重新发布 npm 包。                                                                                  |
| 双 IDE README          | **源码同步完成** | `.167` / `.184` 改为公开；固定源码、标签、下载 URL 和哈希，保留 JetBrains 外层 ZIP 不同的事实。                                                                    |
| 用户文档               | **源码同步完成** | 新增 [10 月 29 日升级指南](../../docs-site/docs/chainlesschain/cli-ide-update-2026-10-29.md)，更新首页、导航、Agent、IDE、运行时、发布、MCP、Skills、Memory 入口。 |
| 文档结构               | **本地检查通过** | 324 个页面均包含 11 个必需模块。                                                                                                                                   |
| Marketplace Overview   | **本地检查通过** | 版本声明与 manifest 一致，相关 19 项既有 Node 测试通过。                                                                                                           |
| 网站构建与线上部署     | **待核验**       | 主分支推送后由 Docs-Site Build Gate 检查实际 HTML 产出；本次源码编辑未部署网站。                                                                                   |
| 完整安装与真人可访问性 | **未完成**       | 既有公开归档与宿主门禁不替代升级、重启恢复、键盘和读屏器旅程。                                                                                                     |

公开版事实仍来自 [.129 发行记录](./cli-ide-release129-progress-2026-10-28.md)与[发布回执](./cli/evidence/release129-public/publication.json)。后续独立 Goal checker、Memory 磁盘 / 缓存及 Terra 改动尚未发行，PC / 移动端保持独立 `.143`；累计 34/45 不表示 `.129` 单轮成功率，也不解除 `NOT_PAID_READY / NOT_ADMITTED / HOLD`。

补充静态核验：所有改动文件通过 Prettier；VitePress 配置通过 Node 语法检查；59 个新增本地 Markdown 链接可解析，两份新增压缩证据的压缩 / 解压摘要匹配，`git diff --check` 通过。

本批还回读了 Terra [Ubuntu 合同门禁](./cli/evidence/terra-model-2026-10-29/remote-contract/verification.json)：准确提交 `b8dc60c431` 成功，13 个来源摘要与 Git blob 一致。此门不等于完整三系统 CLI 发行门，未执行真实账号或账单测试。

Memory 长测继续使用原进程；新增 [10K 采样快照](./cli/evidence/memory-snapshot-cache-2026-10-29/sampling-progress-10k.json)。1K / 10K 的五场景均各满 100 次，结果摘要全部一致；10K 冷 p95 **1036.680ms**、热 p95 **354.161ms**，仍未达到 1s / 200ms 目标。100K、Stop、混合读写删与三系统结果仍待完成。本机为共用工作站，不属于隔离硬件实验。

已提交并推送 `main@92e5403292879dc87e86750592166314fc9a72ae`。对应 [Docs-Site Build Gate 40767303666](https://github.com/chainlesschain/chainlesschain/actions/runs/40767303666) 已触发、当前排队；完整网站构建未计通过。官网 `docs-website-v2/src/data/release-status.json` 与设计站当前入口仍需后续同步，不能把这次用户文档修改视为三个网站均已更新。

后续只读回读确认 Linux Memory 1500/1500 样本与参考结果一致，100K 热 / 冷 p95 为 72.194 / 486.836ms；准确源码摘要和 GitHub 制品摘要均匹配，见[测量记录](./cli-ide-memory-cache-progress-2026-10-29.md)。Windows / macOS 和本机长测尚未完成。`.129 verify-11` 的只读派发核对仍返回不确定，保留原请求且未重发，累计仍为 34/45。

分支检查：当前仅 `main` 及未合并的 `feature/cli130-security-map-release`，没有已合并 feature 分支待删。未合并分支及其工作树保留。
