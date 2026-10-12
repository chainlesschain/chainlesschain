# 服务端终态误重试修复

读 Responses Retry-After 候选时，发现共享连接重试分类器先匹配网络code/文字，会把含有timeout、ECONNRESET或network error的HTTP/Responses失败误作连接中断。新29项离线回归修前 **21失败/8通过**；修后全部通过。HTTP格式化诊断、实际Responses归一化异常、status/statusCode元数据优先判为终态，保留正常fetch/reset/DNS/超时连接恢复。

实际重试循环spy验证终态只尝试一次、无sleep/onRetry；真正连接错误仍能一次重试恢复。完整相关8文件 Windows Node22.22.2 / Linux Node22.12.0各 **139/139**，零失败/skip/todo；6份源码测试前后摘要一致，且与本地工程提交 **ceb2d6f5961fd260739cfe523365f827e22dd9e9** 的Git blob匹配。原失败报告、源前/后、两平台JSON/日志/采集回执与验证脚本见 [manifest.json](./manifest.json) 与 [summary.json](./summary.json)。

Astra进行了只读代码复核，没有代跑这些回归或作为独立人工签核。修复限定为终态误分类，不新增HTTP错误自动重放，**没有完成推理Retry-After的header/delay语义**。该候选、模型传输WebSocket及实际provider验证继续开放。新工程暂本地提交，远端fdead的成绩不能转移到此提交；没有新增付费调用、正式样本、发行或合并。
