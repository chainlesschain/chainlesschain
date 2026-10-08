# 设置严格锁公平性（2026-10-08）

修复提交 `91924f202ecee89306fdd649df90f311e37debdf`。

[用户指出的Windows job](https://github.com/chainlesschain/chainlesschain/actions/runs/37773413407/job/113298272095)绑定旧SHA `be17dfc48a2e8b440d984d00d3f98d9a78a406a3`：2692通过/1失败/11跳过。并发addRule在原两秒期限内STATE_LOCK_UNAVAILABLE，owner仍活跃、releasePublished=false。

- [failed-job.json](./failed-job.json)：GitHub原始元数据。
- [failed-job-excerpt.log](./failed-job-excerpt.log)：唯一失败原始片段；完整原件在.work，摘要见下一文件。
- [local-validation.json](./local-validation.json)：定向/真实锁写入及两次完整本机Strict失败，未改写通过状态。
- [新Strict #37779098798](https://github.com/chainlesschain/chainlesschain/actions/runs/37779098798)和[CLI CI #37779105012](https://github.com/chainlesschain/chainlesschain/actions/runs/37779105012)单独回读。

等待活跃锁不再创建/删除candidate，addRule释放后给等待者重试窗口。原两秒期限、ownership/token、回调单次执行、unknown commit保留。

Windows两个Node版本定向各136通过/1 Linux专属跳过，Windows/WSL Linux真实四进程各240次写入无丢失/重复。完整本机Strict第一次因临时Node程序名被身份校验拒绝（16失败）；改正node.exe后2695通过/1 headless恢复超时/11跳过。该单文件保持原15秒期限后来5项通过，不把后续通过改写成整组通过。
