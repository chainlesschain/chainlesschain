# 暂停工具请求的声明与终态关联

实际复测出现 47 个 tool_use / 49 个 tool_result，其中两次暂停 read_file 在执行前拒绝，却没有请求声明。新 runtime 只针对 TOOL_RECOVERY_PAUSED_CODE 发出 tool-pre-execution-denied，两个 headless 入口投影为同 ID 的 tool_use / tool_result，并明确 preExecutionDenied:true、execution_started:false；args 为 {}。拒绝不作为执行计入 JSON tool_calls、计划或副作用 ledger。

当前工作区三套回归 **209/209**（3 suites、退出 0）通过，记录 source-before/source-after 的 9 文件摘要均未变化；报告、控制台、exit-code 与源码补丁都保存。本次测试从 848e6e4 工作区增量启动，增量随后进入 861e9bc；不把旧 10 月 11 日控制台或原实际 47/49 改写为新通过。没有新 provider 调用，真实失败和费用未知继续保留。

双摘要原件见 [manifest.json](./manifest.json)，验证范围见 [summary.json](./summary.json)。正式 36+9 / NOT_RUN / observed=0 / $99 不变。
