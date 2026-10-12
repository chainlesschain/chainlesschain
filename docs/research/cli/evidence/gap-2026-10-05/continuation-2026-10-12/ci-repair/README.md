# 2026-10-12 Windows CI 测试驱动修复

原合并提交 fd284e 的 CLI CI run 38154423057 在 session-tail 跟随测试中得到空结果，其他 2056 项通过；CI Tests run 38154422707 的原生目标生命周期用例超过默认 5 秒，其他 230 项通过。完整失败日志保存于 manifest。

会话测试现在等待 reader 首次 stat 已开始后才追加事件，实际读取文件，并在 finally 取消和关闭 iterator；取消不再取决于独立的 600ms 定时器。原生 SQLite start/check/status/stop 用例采用 30 秒有界功能预算并记录单调时钟阶段，保持原行为断言；该预算不是性能 SLO。

Windows Node v22.22.2 本地会话测试 **16/16**、原生目标宿主 **20/20**、Gradle/bootstrap 与证据归档 **9/9** 通过。定向 ESLint、Prettier、git diff --check 通过。原 CI 的负载和慢 I/O 未在本机重现；修复绑定新 [草稿 PR #431](https://github.com/chainlesschain/chainlesschain/pull/431)，其准确提交 Actions 仍待完成。生产 runtime、发布制品和正式样本未改变。

本轮归档记录局部工作区结果，不宣称是发布提交的完整三系统门。源码快照采集于提交后，目标用例的说明注释在本地测试后补充，行为代码一致；正式准入使用新准确提交 Actions。

[manifest.json](./manifest.json) 保存 7 份原件的压缩前后字节数和 SHA-256；[summary.json](./summary.json) 为验收范围。
