# 用户授权的火山受限连通性测试

用户明确指示“火山引擎可以测试”后，使用已有受控环境变量 `VOLCENGINE_API_KEY`，向正式固定模型 `deepseek-v4-flash-ga-260731` 的官方 `/api/v3/chat/completions` 发起一次短请求。最多1024输出token、20秒超时，无自动重试，没有输出或归档密钥/Authorization header。

实际 HTTP200，1246ms，回答“Hi”；usage为89输入/13输出，缓存读写均0。按当前价格表估算 **USD0.0000161**，`billingVerified:false`，provider硬额度仍未验证。请求体、响应原字节/摘要、usage回执、采集脚本和工程源见 [summary.json](./summary.json) 与 [manifest.json](./manifest.json)。响应未包含密钥，因此保存的 body 与实际原字节一致；若出现敏感值，采集器会明确标记脱敏。

这是一次认证/连通性诊断，不是普通编码任务或独立首次安装旅程，不写正式observations；36+9仍0/36、0/9，不能将这次短请求估算当成全任务的硬额度或官方账单。
