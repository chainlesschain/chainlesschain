# Sonnet 5.5 缓存读取价格修复

2026-10-12 对照 [Anthropic 平台定价](https://platform.claude.com/docs/en/about-claude/pricing)、[Claude 定价](https://claude.com/pricing) 与原 Claude Code 2.1.296 changelog，确认 Sonnet 5.5 的缓存读取价格为 **USD 0.10 / 百万 token**，输入价格 USD 2，故共享目录倍率由 0.1 修正为 0.05。共享 llm-pricing 与 CostBudget 消费该目录；输入、输出和缓存写入价格保持原合同。

4 个相关测试文件 **74/74 通过、零失败/跳过**。100K 缓存读取估算 USD 0.01，混合输入/输出/缓存读取/写入与预算总计 USD 0.038；旧 Sonnet 4.6、Opus 5.5 与两代 GPT 价格有隔离断言。原始官方页面、抓取元数据、5 组前后源码快照、patch、完整测试和目录复核结果见 [manifest.json](./manifest.json)。测试时为 a537 工作区增量，五个执行源文件均与工程提交 `bdaf873c68a706ee65b985892d2603cbe0510979` 的 Git blob 精确匹配；准确提交 Actions 结果另验。

仅本次公共标准价格估算得到复核，不证明价格生效历史、实际账单或网关合同。原冻结候选与历史金额未重算，原 CLI 审查基线 0.160.0 / 2.1.289 未推进，0.162.1 / 2.1.296 完整上游审查仍待完成。没有新付费调用或公开发行；正式 36+9 / NOT_RUN / observed=0 保持。范围见 [summary.json](./summary.json)。
