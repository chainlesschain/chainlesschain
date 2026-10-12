# 火山精确模型的官方费用合同核查

Astra 只读核对 `deepseek-v4-flash-ga-260731` 与 `/api/v3/chat/completions` 的官方模型、价格、缓存和 Chat API 文档；未发新付费请求或修改冻结计划。[summary.json](./summary.json) 与 [manifest.json](./manifest.json) 保留18份双哈希原件，包括官方页面工具回执、HTTP SPA 原件、完整审查报告和既有短测响应的独立回读。直接 HTTP 页面仅返回 SPA，具体合同文本来自所列官方文档工具回执。

官方常规在线 token 价为人民币 **3/0.10/9 元每百万 token**（未缓存输入/缓存输入/输出），不同于项目当时的美元配置估价。已有短测89输入、13输出、缓存0，response `service_tier:default`；13输出含11思维链token，不重复相加。按公开常规价的 token-only 估算为 **¥0.000384**；原 **$0.0000161** 仅为旧配置估算，实际账单与汇率均未知。

官方精确模型上限为输入/上下文1024k、回答384k、思维链128k。按完整模型上限及常规token价可提出每物理请求 **¥7.86432**（保守圆整 **¥8**）的预留候选；它依赖账号适用价、计费上限及费用范围，尚不是已验证账单上界或正式美元预算控制。冻结的样本$2/$3及共享$99仍需有依据的币种换算、请求前原子预留、跨补救/宿主持久ledger与unknown usage停止规则。

官方来源：[模型列表](https://docs.volcengine.com/docs/ark/model-list?lang=zh)、[价格表](https://docs.volcengine.com/docs/ark/model-pricing?lang=zh)、[Chat API](https://docs.volcengine.com/docs/ark/chat-api?lang=zh)、[缓存](https://docs.volcengine.com/docs/ark/context-cache?lang=zh)。公开文档不替代账号订单、额度保证或实际账单；正式执行仍 `NOT_RUN / 0/36 / 0/9`。
