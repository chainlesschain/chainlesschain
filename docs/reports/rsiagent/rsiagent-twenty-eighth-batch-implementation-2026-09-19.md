# RSIAgent 第二十八次工程实施：视觉协议适配与签名截图读取授权

> 日期：2026-09-19（Asia/Shanghai）<br>
> 前置实施：[第二十七次工程实施：受治理浏览器视觉只读接线](./rsiagent-twenty-seventh-batch-implementation-2026-09-19.md)<br>
> 状态：仓库内已补齐 OpenAI-compatible、Anthropic、Ollama 与 Gemini 四类视觉协议边界，并建立与签名 Desktop deployment 模块摘要绑定的截图读取 authority。只读截图在浏览器引擎和页面访问前取得一次性授权；页面变更仍然失败关闭。真实 operator 策略、DID/RBAC/隐私规则、生产签名部署及 Electron/browser/provider E2E 尚未完成。

## 1. Provider 投影只发生在认证回读之后

浏览器视觉内部继续使用 Agent v3 的 provider-neutral `image_url` 数据块。图片字节先进入 Desktop 模型 ingress，形成 digest-bound 投影并完成认证回读，随后才在具体 provider 的最终 wire boundary 转换：

- OpenAI-compatible 保留标准 `image_url` 块；
- Anthropic 转换为 `image/source/base64`；
- Ollama 转换为消息级 `images: [base64]`，不携带 data URL 前缀；
- Gemini 转换为 `inlineData { mimeType, data }`。

Ollama 与 Gemini 均拒绝远程图片 URL、异常 MIME、非规范 base64 和无法由治理入口恢复的图片。`LLMManager` 只向已初始化、仍绑定同一签名 ingress 且属于上述四类协议的当前 provider 签发 opaque 视觉模型 capability；provider 切换后会重新校验，调用方不能沿用旧绑定覆盖模型或 provider。

## 2. 签名截图读取 authority

CLI deployment loader 新增 `createBrowserVisionObservationAuthority` 内建工厂，并把它与已经验签的 deployment 模块摘要强制绑定。authority descriptor 固定以下边界：

- authority、tenant 与 policy revision；
- 已验签 handler artifact digest；
- 最长 60 秒、由部署进一步收紧的授权有效期。

每次读取请求绑定 renderer sender ID、frame URL digest、目标 tab、只读操作和规范化输入 digest。输入摘要覆盖 prompt/description、基线图片摘要、截图范围、质量、detail、temperature 与 token 预算；调用方模型覆盖、越界参数、accessor 和异常 clip 在 authority 调用前拒绝。原始授权材料只交给私有策略端，回执仅保留授权摘要和 evidence reference，不回传原始凭据。

Desktop loader 只把签名 authority 窄化为主进程私有的 opaque host。Browser IPC 在取得浏览器引擎前请求授权，并将回执转换成短期、一次性、目标/操作/输入精确绑定的 grant。`VisionAction` 必须在页面访问和截图前消费该 grant；缺少 host、伪造 host、过期、重放或参数替换均返回 `CC_AGENT_EVOLUTION_INGRESS_FAILED`。

## 3. 当前开放与继续关闭的能力

下列操作具备独立的只读授权操作名并始终获取新鲜截图：

- 页面分析 `analyze`；
- 视觉元素定位 `locate`；
- 基线截图比较 `compare`；
- 页面描述 `describe`；
- 可见文本识别 `ocr`。

授权只证明当前读取被策略允许，不授权页面写入。`visualClick`、输入、导航和多步 `executeVisualTask` 仍在截图、模型调用与页面变更前失败关闭；后续必须使用不同的 action authority、审批、审计与恢复合同，不能复用 observation grant。

## 4. 尚未关闭的 G03 边界

本批交付的是可由签名部署装配的协议和能力边界，不等于生产策略已经存在。G03 仍需：

- operator 签发的生产 Desktop deployment 实际返回该 authority；
- 将真实用户、任务、tenant、DID/RBAC、页面敏感级别和隐私规则接入授权策略及耐久审计；
- 为点击、输入、导航和多步任务建立独立 action authority；
- 在真实 Electron 与浏览器页面上，分别完成至少一个受支持视觉 provider 的正向 E2E 和拒绝、取消、超预算、切换、篡改、敏感页面负例；
- 完成日志脱敏、凭据轮换、生产观察窗口和隐私审查。

因此 G03 继续标记为“部分完成”，不授予自主视觉探索或页面变更权限。

## 5. 验证口径

自动化回归覆盖签名模块摘要替换、authority 品牌、授权材料脱敏、有效期、一次性消费、sender/frame/target/operation/input 替换、异常截图参数、无 host 时浏览器引擎零访问、OCR 只读路径，以及 OpenAI-compatible/Anthropic/Ollama/Gemini 投影边界。

本批相关回归为 15 files、233 tests passed、15 skipped；跳过项为既有条件测试，不是本批新增失败。

本批未启动 Electron、未访问真实网页、未发送真实截图、未调用付费视觉模型，也未创建或发布生产签名 deployment。测试绿灯只证明仓库内合同与失败关闭行为，不证明目标环境的身份、隐私策略或模型能力已经验收。
