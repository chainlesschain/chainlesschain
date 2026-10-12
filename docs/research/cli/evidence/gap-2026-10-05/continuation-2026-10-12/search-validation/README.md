# search_files 缺失 pattern 的执行前拒绝

实际 0.166.98 复测的 call_t0e4c7a3qd185czlb3d6twyy / call_w5pfl0aepxpon28vtof1ekjz 使用 query 而没有 schema 所需 pattern，旧 builder 把缺失 pattern 转为一个成功的空 grep，返回无关 node_modules 路径。这是工具输入校验缺口，不能算模型找到了目标源码。

当前 builder 明确拒绝缺失、空字符串及非字符串 pattern，不推测 query 别名；合法 pattern 的空格和既有 shell 转义保持。真实生产 executeTool 的 runner-spy 验证非法请求不会启动搜索进程，正常 pattern 仍派发。原生产 builder 与新 builder 的跨平台对照 8 项由生成命令变为拒绝，没有执行任何原 shell 命令。

Windows 三文件回归 **34/34** 通过，覆盖执行前拒绝、正常派发、注入转义和输出归集；session-tail 最终失败清理补强后 **16/16** 通过，早期拒绝能解除等待，独立 10 秒观察期限及嵌套 finally 保证恢复 spy。源码及原报告见 [manifest.json](./manifest.json)，范围见 [summary.json](./summary.json)。源码增量尚未发行或付费复跑，原任务仍失败，正式 36+9 不变。
