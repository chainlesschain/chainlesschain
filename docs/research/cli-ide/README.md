# CLI / IDE 联合实施与验证

[返回研究索引](../README.md) · [CLI 研究](../cli/README.md) · [IDE 研究](../ide/README.md)

收录跨 CLI、VS Code 与 JetBrains 的共享计划、功能实施、验收复测和发布记录。结论以各记录中的日期、源码基线与验收范围为准。

后续同类记录放入本目录；CLI、IDE 各自的研究报告及现有证据目录继续由各自索引导航。

## 计划与差距复核

- [CLI / IDE 差距实施状态（2026-09-27）](./cli-ide-gap-implementation-2026-09-27.md)
- [CLI / IDE 2026-10-05 差距实施状态](./cli-ide-gap-implementation-2026-10-05.md)
- [ChainlessChain 借鉴 Codex 和 Claude Code 的实施计划](./cli-ide-codex-claude-implementation-plan-2026-10-15.md)
- [ChainlessChain 对照最新 Claude Code / Codex 的差距与优化建议](./cli-ide-codex-claude-gap-review-2026-10-27.md)

## 功能实施进度

- [CLI 与 IDE 输入交付、草稿恢复续做（2026-10-23）](./cli-ide-recovery-progress-2026-10-23.md)
- [CLI / IDE 保存输入删除与恢复续做（2026-10-26）](./cli-ide-recovery-progress-2026-10-26.md)
- [CLI / IDE 差距优化首批实施：Goal 验收与检查点恢复](./cli-ide-goal-completion-progress-2026-10-27.md)
- [CLI / IDE 差距优化第二批：配置读取状态与首次使用提示](./cli-ide-llm-configuration-progress-2026-10-27.md)
- [CLI / IDE 差距优化第三批：共享模型推荐与连接测试协议](./cli-ide-llm-onboarding-progress-2026-10-27.md)
- [CLI / IDE 差距优化第六批：MCP 紧凑目录与请求投影](./cli-ide-mcp-compact-catalog-progress-2026-10-27.md)
- [CLI / IDE 差距优化第五批：MCP 中文检索与大目录基线](./cli-ide-mcp-search-progress-2026-10-27.md)
- [CLI / IDE 差距优化第八批：Memory 索引候选合并](./cli-ide-memory-posting-progress-2026-10-27.md)
- [CLI / IDE 差距优化第四批：会话模型与全局连接隔离](./cli-ide-session-model-progress-2026-10-27.md)
- [CLI / IDE 差距优化第七批：Skills 多语言目录检索](./cli-ide-skill-search-progress-2026-10-27.md)
- [CLI / IDE 差距优化第十一批：Codex 三系统 CI 与分页边界](./cli-ide-codex-ci-progress-2026-10-28.md)
- [CLI / IDE 差距优化第九批：外部 Codex 兼容清单](./cli-ide-codex-compatibility-progress-2026-10-28.md)
- [CLI / IDE 差距优化第十批：Codex 多版本与重启恢复验证](./cli-ide-codex-history-progress-2026-10-28.md)
- [36+9 剩余任务续测与宿主修复](./cli-ide-task-completion-progress-2026-10-28.md)
- [真实 CLI 压缩与独立进程恢复](./cli-ide-cli-memory-restart-progress-2026-10-29.md)
- [Codex 扫描分页与冷索引恢复实测](./cli-ide-codex-scan-progress-2026-10-29.md)
- [压缩前后刷新项目规则与文件 Memory](./cli-ide-compaction-context-progress-2026-10-29.md)
- [非持久会话压缩后的宿主基础规则保留](./cli-ide-compaction-live-host-progress-2026-10-29.md)
- [发行审计阻断与准确源码登记](./cli-ide-egress-review-progress-2026-10-29.md)
- [Goal 模型评审预算与取消闭环](./cli-ide-goal-budget-progress-2026-10-29.md)
- [Goal 独立验收定义与执行](./cli-ide-goal-verification-progress-2026-10-29.md)
- [Goal 证据与工作区版本绑定](./cli-ide-goal-workspace-progress-2026-10-29.md)
- [MCP 晚连接目录与子任务取消](./cli-ide-mcp-live-catalog-progress-2026-10-29.md)
- [Memory 合并索引读取与规范化分配优化](./cli-ide-memory-bundle-progress-2026-10-29.md)
- [Memory 权威分片解析复用与完整采样准备](./cli-ide-memory-cache-progress-2026-10-29.md)
- [Memory 目录身份修复与热查询复测](./cli-ide-memory-directory-progress-2026-10-29.md)
- [Memory 本机完整采样与性能诊断](./cli-ide-memory-full-progress-2026-10-29.md)
- [Memory 压缩、实际进程终止与独立恢复验收](./cli-ide-memory-process-restart-progress-2026-10-29.md)
- [Memory recall 版本、取消与 Windows 文件身份恢复](./cli-ide-memory-recovery-progress-2026-10-29.md)
- [.131 Memory 索引重建与损坏恢复的本地 600 次测量](./cli-ide-memory-recovery131-progress-2026-10-29.md)
- [.131 冻结运行时的 Memory 100 次采样与原型复查](./cli-ide-memory-slo131-progress-2026-10-29.md)
- [CLI / IDE 差距优化第十六批：Memory 磁盘查询与取消](./cli-ide-memory-store-progress-2026-10-29.md)
- [第四十五批：修复 .131 冷会话读取的多余加载](./cli-ide-session-cold-rss131-progress-2026-10-29.md)
- [Skills 下载取消与持久化边界](./cli-ide-skill-download-progress-2026-10-29.md)
- [MCP 子任务发现与缓存隔离](./cli-ide-subagent-mcp-progress-2026-10-29.md)
- [Terra API 能力与缓存计费修复](./cli-ide-terra-model-progress-2026-10-29.md)
- [第四十六批：修复 .131 干净构建与产物来源审计](./cli-ide-web-panel-production131-progress-2026-10-29.md)
- [临时 worktree 消费者生命周期修复](./cli-ide-worktree-lifetime-progress-2026-10-29.md)

## 验收与复测

- [CLI / IDE 差距续做：Actions 修复与身份诊断](./cli-ide-gap-validation-2026-10-05.md)
- [CLI 0.166.128 发布后 36+9 复测跟踪](./cli-ide-review128-task-progress-2026-10-28.md)
- [原生任务派发审计与脱敏响应回执](./cli-ide-native-dispatch-receipt-progress-2026-10-29.md)
- [.131 原生任务前置失败、行为测试修复与接续](./cli-ide-native-preflight131-progress-2026-10-29.md)
- [真实任务续测：保留 .128 记录并准备 .129（2026-10-29）](./cli-ide-native-retest129-progress-2026-10-29.md)
- [.131 原生任务续测当前进度](./cli-ide-native-retest131-progress-2026-10-29.md)
- [上游故障候选映射与资源取消回归](./cli-ide-upstream-regression-progress-2026-10-29.md)
- [辅助 verify-04 / 13 安装与当前源码兼容验证](./cli-ide-assisted-0413-install-progress-2026-10-30.md)
- [verify-07 持久正文分页：辅助交付与独立复验](./cli-ide-assisted-cli07-progress-2026-10-30.md)
- [macOS JetBrains 首次任务：verify-09 辅助修复](./cli-ide-assisted-install-progress-2026-10-30.md)
- [verify-10 辅助修复与原检查器复验](./cli-ide-assisted-verify10-progress-2026-10-30.md)
- [CLI .132 首项原生复测与路径合同修复](./cli-ide-native132-first-run-progress-2026-10-30.md)

## 发布与文档同步

- [CLI / IDE 候选版本范围（2026-09-27）](./cli-ide-release-candidate-2026-09-27.md)
- [CLI .128 与配套 IDE / 客户端发布记录](./cli-ide-release128-progress-2026-10-27.md)
- [CLI 0.166.129 与 IDE 发布进度（2026-10-28 准备，2026-10-29 发布）](./cli-ide-release129-progress-2026-10-28.md)
- [代码、Git 与公共文档对齐记录（2026-10-28）](./documentation-code-git-sync-2026-10-28.md)
- [Memory 子包 0.1.11 发布准备](./cli-ide-memory-child-release-progress-2026-10-29.md)
- [CLI .129 公开配对文档同步](./cli-ide-public-docs129-progress-2026-10-29.md)
- [.130 发布门禁失败与调度器租约测试修复](./cli-ide-release130-ci-recovery-2026-10-29.md)
- [.130 候选分支合并与发布前置核对](./cli-ide-release130-merge-progress-2026-10-29.md)
- [.130 公开配对回读与主线合并核对](./cli-ide-release130-reconcile-progress-2026-10-29.md)
- [.131 新发行候选准备](./cli-ide-release131-preparation-progress-2026-10-29.md)
- [CLI .129 官网、设计站与三站构建同步](./cli-ide-sites129-progress-2026-10-29.md)
- [.130 公开升级入口与三站同步](./cli-ide-sites130-progress-2026-10-29.md)
- [.131 设计、用户文档、README 与三站部署](./cli-ide-sites131-progress-2026-10-29.md)
- [CLI .132 / 配对 IDE：本批修复与发行进度](./cli-ide-release132-progress-2026-10-30.md)
- [CLI .133 路径声明修复与发行门禁](./cli-ide-release133-progress-2026-10-30.md)
- [CLI .132 文档、README 与三站部署进度](./cli-ide-sites132-progress-2026-10-30.md)
