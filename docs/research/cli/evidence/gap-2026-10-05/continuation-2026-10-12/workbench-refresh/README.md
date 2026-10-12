# Workbench 周期刷新争用与旧投影回写修复

macOS真实100样本采集发现sample23/89有第四条投影命令与操作链竞争。只读审查还确认较晚完成的旧投影能覆盖更新的revision。当前源在用户action执行中延后周期读取，动作前fresh authority/revision检查及动作后canonical读取保持；同一次动作后的在途刷新覆盖周期tick，旧readSequence/已更换panel结果不再发布。

首组4项有效回归在旧实现为 **3失败/1通过**（旧初始读取覆盖显式refresh、操作中周期读、操作前旧读取覆盖mutation后状态）；后续新增post-read tick反例，中间实现5项 **4通过/1失败**，修后5项全过。最初fixture直接builder schema、row revision及Windows转义argv准备失败另存，不混入上述有效基线。

Node相关3文件 Windows22.22.2 / Linux22.12.0各 **46/46**；Vitest投影/Workbench/宿主fixture3文件各 **51/51**，零失败/skip/todo。4份验证源码前后摘要不变，并与本地工程提交 **20f4a4bfe395f3b36846f1e7b48c6c8c6cfcc8a5** 的Git blob全部匹配；原失败/中间反例、源码、日志/回执与验证脚本见 [manifest.json](./manifest.json) 和 [summary.json](./summary.json)。

这项修复消除可复现争用/陈旧回写，**不保证已把macOS P95降至2s内**。真实宿主2s/100样本门与旧失败原件继续保留，需当前新源码的完整Actions/native host复验；未把本地自动化当作性能SLO或真人验收。此处归档时新源码尚未推送/发行，没有新增真实模型请求或正式样本。
