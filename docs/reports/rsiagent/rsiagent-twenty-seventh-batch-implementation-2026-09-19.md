# RSIAgent 第二十七次工程实施：受治理浏览器视觉只读接线

> 日期：2026-09-19（Asia/Shanghai）<br>
> 前置实施：[第二十六次工程实施：旧学习来源证明与正式晋级控制面接线](./rsiagent-twenty-sixth-batch-implementation-2026-09-19.md)<br>
> 状态：仓库内已把浏览器页面分析、视觉定位和截图对比接入签名 Desktop 模型 ingress 与 Agent v3 多模态投影；视觉点击和多步页面变更继续失败关闭。真实签名部署、浏览器/provider E2E、截图读取授权、Ollama/Gemini 适配及页面变更 authority 尚未完成。

## 1. 品牌化视觉模型能力

[LLM Manager](../../../desktop-app-vue/src/main/llm/llm-manager.js) 现在只能从同时满足以下条件的实例签发 opaque 视觉模型 capability：

- Desktop manager 已绑定签名模型 ingress；
- manager 已初始化，当前 provider client 仍持有同一品牌绑定；
- provider 使用已接线的 OpenAI 兼容协议或 Anthropic 协议。

capability 不暴露 manager、provider client、密钥或 ingress host。每次调用都会重新检查当前 provider 与 client 绑定，因此 provider 切换后，旧 capability 不能默许新 provider。Ollama 和 Gemini 当前不会取得该能力。

Browser IPC 只把这项主进程私有 capability 注入 `VisionAction`，不再尝试加载仓库中不存在的 `llm-service.js`。`ComputerUseToolExecutor` 和 `ComputerUseAgent` 也不再接受普通对象作为视觉模型服务。

## 2. Agent v3 多模态投影与 provider 边界

视觉请求内部统一使用 Agent v3 已验证的 OpenAI-shaped `image_url` 数据块。请求跳过旧的响应缓存和 prompt compression 文本路径，图片字节先形成 digest-bound opaque transport commitment，经认证 readback 恢复后才进入 provider client。

OpenAI 兼容 provider 直接使用恢复后的标准块。Anthropic client 保留 provider-neutral 块直到投影完成，并只在最终 HTTP wire boundary 转换为 `image/source/base64`；畸形、远程 URL 或非规范 base64 会在网络请求前被拒绝。这样不会再把截图数组先 `JSON.stringify()` 成普通文本并落入旧缓存路径。

调用方不能通过视觉 IPC 覆盖 manager 已配置的模型。provider 能否实际处理图片仍需目标模型和真实服务验收；仓库接线不把协议形态正确等同于模型能力通过。

## 3. 只读范围与输入预算

[VisionAction](../../../desktop-app-vue/src/main/browser/actions/vision-action.js) 当前只开放：

- 新鲜页面截图分析；
- 视觉元素定位；
- 两张截图的只读差异分析；
- 基于上述入口的 OCR/页面描述。

旧 `analysisCache` 不参与读取或写入，避免把无法证明对应当前像素的结果当成新观察。请求限制包括：

- prompt 非空且最大 16 KiB，元素描述最大 4 KiB；
- 输出 token 上限最大 4096；
- JPEG 截图及对比图片合计解码字节不超过 700 KiB，以满足 Agent v3 整体 1 MiB 请求预算；
- 图片必须是规范 base64，quality、detail、temperature 和 full-page 标志必须在允许范围；
- 已取消请求在页面截图前失败；
- legacy cache、prompt compressor 和调用方模型覆盖均被禁用。

`visualClick` 和多步 `executeVisualTask` 仍在截图、模型调用和页面操作前返回 `CC_AGENT_EVOLUTION_INGRESS_FAILED`。模型 ingress 只证明图片请求受治理，不能替代页面变更授权。

## 4. G03 仍未关闭的边界

本批把 G03 从“待实施”推进为“部分完成”，但以下事项仍须单独交付：

- 为截图读取建立与目标 tab、用户、租户、隐私策略和任务授权绑定的 authority；
- 为点击、输入、导航和多步任务建立独立的 action authority、审批、审计和回滚合同；
- 为 Ollama/Gemini 增加投影后 provider 转换，并按具体视觉模型做能力探测；
- 使用 operator 签发的 Desktop deployment 启动真实 Electron/浏览器，完成至少一个真实 OpenAI-compatible 或 Anthropic 视觉 provider E2E；
- 验证取消、超预算、provider 切换、图片篡改、权限拒绝和敏感页面负例；
- 完成目标平台隐私审查、日志脱敏和生产观察窗口。

因此本批不授权自主视觉探索，也不改变“结构化 PM 试点优先”的路线。

## 5. 回归证据

- 视觉入口、边界动作、品牌化模型 capability、Anthropic wire 转换、Desktop deployment/IPC 模块、Computer Use bridge/tools 及 OpenAI/Anthropic/Gemini/Ollama 客户端：11 files、155 tests passed、15 skipped。
- 改动文件 ESLint：0 errors、18 warnings；warning 为相关旧文件中的未使用参数。
- `git diff --check` 通过。

本批没有访问真实网页、没有发送真实截图、没有调用付费视觉模型、没有启用视觉点击，也没有创建或发布生产签名 deployment。
