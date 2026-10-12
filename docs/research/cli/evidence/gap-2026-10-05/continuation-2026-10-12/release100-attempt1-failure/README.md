# 0.166.100 首轮发行门失败原件

准确候选 `ff292775c4a032541fb50147d49dd353967be3b4` 的 [Windows ARM64 JetBrains2026.2.0.1 job114895528089](https://github.com/chainlesschain/chainlesschain/actions/runs/38274184765/job/114895528089) 失败：`Summarize from here` 后续动作菜单在45秒内未出现，visible lists 为空。保留原断言和时间限制；根因目前 `NOT_DETERMINED`。

[summary.json](./summary.json) 和 [manifest.json](./manifest.json) 保存9份双哈希原件，包括 job/run/artifacts API、完整日志、上游源码回执及 GitHub artifact11758154099 ZIP。ZIP SHA256 `4526a301293fca3ae0103c6abd17c5fa3760531bf9835d8a0adf462cd1174e46` 与 GitHub API digest 一致，36个 manifest 文件字节和摘要匹配。run API 的 queued 状态属于采集时点，后续汇总失败不会改写这份原件。

CLI **0.166.100** / VS Code **0.37.144** / JetBrains **0.4.162** 尚未发布。后续诊断或修复产生新源码时，须重新取得该准确 SHA 的完整发行门；此失败原件及其他旧源码成绩均不转移。
