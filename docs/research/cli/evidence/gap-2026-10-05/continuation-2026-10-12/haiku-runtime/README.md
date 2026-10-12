# Haiku 5.5 精确契约与最终合并回归

官方原件确认精确 ID claude-haiku-5-5、1M 上下文、128K 常规输出上限、adaptive/medium 默认与五档 effort。保留原 4096 默认请求预算，显式输出封顶128K；禁止 legacy thinking budget、assistant prefill，以及 disabled 与 xhigh/max 的不支持组合。旧型号与未知后代保持各自边界。当前 API 协议请求由真实 fetch-stub 测试捕获，未使用真实账号。

每次请求按 uncached input + cache read + 全部 cache write 判断100K边界，超出时整请求各桶5倍；5m/1h 写入分别计价。保留官方 usage.inference_geo=us/global，US倍率1.1，未知地区、缺正写入TTL或冲突证据不伪造金额；聚合按每请求阈值/地区/TTL证据分桶。公共 global 列表估算与实际usage证据分开；Batch价格与伙伴云合同仍未作为已支持计价项。

Windows22.22.2 与 Linux22.12.0 最终各 **400/400**（22文件），采集合同各 **9/9**，零失败/跳过。验证前后16份修改源文件字节不变，并与 fdead28689393bdf6881c9f806927f9f09333194 的 Git blob 逐一核对。源blob、官方页、真实地区/TTL反例、全部测试与采集回执见 [manifest.json](./manifest.json)，范围见 [summary.json](./summary.json)。

Linux 初次全仓 Git diff 准备30秒超时，未进入测试；改用 Windows 已验证的16文件清单并核对同一HEAD、每份完整字节摘要后成功，测试期限/断言不变。原准备失败摘要与 native addon 启动错误均保留。当前新模型合同使用独立2026-10-12 fixture，旧2026-10-05 fixture及上游未关闭基线不变，新增一小时缓存价和300K beta误用的拒绝回归。没有新付费请求、账单核验、正式observations或公开发行。
