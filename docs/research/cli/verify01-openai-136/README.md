# CLI 0.166.136：仅复测剩余五项

仅选取上一轮独立验收仍失败的 verify-08、verify-13、verify-19、verify-36、first-run-darwin-vscode，按原宿主入口进行四次显式子集派发。已通过的 verify-26 和更早 39 项不重跑。

使用已发布 CLI 0.166.136、公开 Open VSX 0.37.173 与经过来源和原 ZIP 摘要校验的 JetBrains 0.4.189 官方 Actions 构建，无需等待商店审核。保留原冻结任务与离线独立验收；当前仓库的工程修复不自动替换冻结项目。模型保持 OpenAI / gpt-6.1-sol / Responses。

[计划](retest-plan.json)绑定上一轮原始失败集合、报告摘要和组件清单。原历史成绩保持不变；本轮生成、独立验收、用量和临时凭据清理将另行归档。状态：准备派发，尚无新一轮结果。
