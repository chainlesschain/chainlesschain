# 联网搜索工具（web_search）

> **版本: v0.162+ | 状态: ✅ 生产可用 | 7 个可插拔搜索源 | 工具数 17→18 | 21 单元测试 + 真查实测**
>
> `web_search` 是 `cc agent` 的内置工具，补齐 agent 此前「能 `web_fetch` 抓取、却不能搜索」的能力缺口。后端**可插拔**——通过 `.chainlesschain/config.json` 的 `webSearch` 字段在 7 个搜索源之间切换，`auto` 模式按已配置的密钥自动择优，无密钥时回退到免费源。

## 概述

agent 要回答「最新发生了什么」就需要联网搜索。`web_search` 接收查询词，返回归一化的结果列表 `{title, url, snippet}`（部分源附带合成 `answer`），供 agent 进一步推理或配合 `web_fetch` 深读。它的设计镜像 `web_fetch`：网络层 `src/lib/web-search.js` 单点实现，provider/HTTP 失败**不抛异常**而转为 `{error}`，让 agent 自行适配重试或换源。

搜索源是**配置开关**而非写死：你可以只用免费的 DuckDuckGo，也可以配置 Tavily/Brave/博查/千帆等带密钥的源以获得更稳定、更适合国内网络的结果。

## 核心特性

- 🔌 **7 个可插拔搜索源**：4 个带密钥 + 3 个免密钥，经 `webSearch` 配置切换
- 🤖 **auto 自动择优**：按 `tavily > brave > bocha > qianfan` 顺序选已配置密钥的源，都没有则回退免费 `duckduckgo`
- 🆓 **免密钥可用**：开箱即用，无需任何密钥即可联网搜索
- 🌐 **国内网络友好**：博查（bocha）、百度千帆（qianfan）、百度（baidu）等源在国内可达
- 📐 **归一化结果**：统一为 `{query, provider, count, results:[{title,url,snippet}], answer}`
- 🛡️ **失败转 error**：provider/HTTP 失败不抛异常，转 `{error}` 让 agent 适配
- 🔑 **多级密钥解析**：`options > config > 环境变量` 优先级
- 🧩 **全集成点接线**：契约 schema、策略（只读/auto/plan-mode 允许）、权限规则（`WebSearch` 伞名）、子代理 profile、agent-core 工具分发

## 系统架构

```
┌─────────────────────────────── cc agent ───────────────────────────────┐
│  工具循环 → case "web_search" → 读 webSearch config                       │
└────────────────────────────────┬───────────────────────────────────────┘
                                 │
                       ┌─────────▼──────────┐
                       │ src/lib/web-search.js│  webSearch(query, opts)
                       │  resolveProvider     │  options>config>env
                       │  resolveApiKey       │
                       │  归一化 {results,…}   │  失败 → {error}
                       └─────────┬───────────┘
              ┌──────────────────┼────────────────────┐
        ┌─────▼─────┐      ┌─────▼─────┐         ┌─────▼─────┐
        │ keyed      │      │ keyless    │         │ auto       │
        │ tavily     │      │ duckduckgo │         │ keyed 顺序  │
        │ brave      │      │ searxng    │         │ 择优,否则   │
        │ bocha      │      │ baidu      │         │ duckduckgo │
        │ qianfan    │      └────────────┘         └────────────┘
        └────────────┘
```

集成点（与 `web_fetch` 一致）：契约 `coding-agent-contract-shared.cjs`（schema + provider 枚举）、策略 `coding-agent-policy.cjs`（只读/auto/plan-mode 允许）、`permission-rules.cjs`（`WebSearch` 伞名 + `websearch` 分组）、`sub-agent-profiles.js`（explorer/executor/design 三 profile）、`agent-core.js`（`case "web_search"`）。

## 搜索源参考

### 带密钥（keyed）

| 源                            | 方式                                     | 说明                                        |
| ----------------------------- | ---------------------------------------- | ------------------------------------------- |
| `tavily`                      | POST                                     | 带合成 `answer`，1000 次免费/月             |
| `brave`                       | GET（`X-Subscription-Token`）            | Brave Search API                            |
| `bocha`（博查）               | POST                                     | Bing 风格 `data.webPages.value[]`，国内可达 |
| `qianfan`（百度千帆 AI 搜索） | POST `qianfan.baidubce.com/v2/ai_search` | 解析 `references[]`，国内稳定               |

### 免密钥（keyless）

| 源           | 方式 | 说明                                                    |
| ------------ | ---- | ------------------------------------------------------- |
| `duckduckgo` | HTML | **auto 默认回退**，解析 `result__a` + 解码 `uddg=` 跳转 |
| `searxng`    | JSON | 自建实例（`instanceUrl`）                               |
| `baidu`      | HTML | 抓 `www.baidu.com/s`，浏览器 UA，仅适合**低频**         |

### auto（默认）

按 `tavily > brave > bocha > qianfan` 选已配置密钥的源；都没有 → 免密钥 `duckduckgo`。

## 配置参考

`.chainlesschain/config.json`：

```json
{
  "webSearch": {
    "provider": "auto",
    "tavilyApiKey": "tvly-...",
    "braveApiKey": "...",
    "bochaApiKey": "sk-...",
    "qianfanApiKey": "<bce-v3 token>",
    "qianfanUrl": "https://qianfan.baidubce.com/v2/ai_search",
    "searxng": { "instanceUrl": "https://searx.example.com" }
  }
}
```

环境变量（优先级 `options > config > env`）：

| 变量                                         | 源      |
| -------------------------------------------- | ------- |
| `TAVILY_API_KEY`                             | tavily  |
| `BRAVE_API_KEY`（或 `BRAVE_SEARCH_API_KEY`） | brave   |
| `BOCHA_API_KEY`                              | bocha   |
| `QIANFAN_API_KEY`                            | qianfan |

> ⚠️ **qianfan token 格式**：`Authorization: Bearer <token>`，token 必须是完整 `bce-v3/{access-key-id}/{secret}` 形式。只填短 API Key 片段 → `401 InvalidHTTPAuthHeader`；裸 key/`bce-v3/<短key>` → `401 Invalid token`。在千帆控制台开通「AI 搜索」获取完整 Bearer token，填 `webSearch.qianfanApiKey`，endpoint 可经 `webSearch.qianfanUrl` 覆盖。

## 性能指标

- **单次 HTTP**：每次搜索为一次后端 HTTP 请求 + 归一化解析，无额外开销。
- **auto 零探测**：按已配置密钥静态择优，不做联网探测。
- **失败快速降级**：provider/HTTP 失败立即转 `{error}`，不阻塞 agent 循环。

## 测试覆盖率

```bash
cd packages/cli
npx vitest run __tests__/unit/web-search.test.js
# 真后端联调（按 env 密钥 gated，无密钥则全 skip）：
BOCHA_API_KEY=sk-xxx npx vitest run __tests__/integration/web-search-live.test.js
```

| 测试文件                  | 数量  | 覆盖                                                                                                                                    |
| ------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `web-search.test.js`      | 21    | 密钥/源解析 + 5 适配器解析（含 ddg `uddg=` 解码 / baidu 验证码错误路径 / qianfan `references[]` / searxng 本地 server）+ 各 missing-key |
| `web-search-live.test.js` | gated | 带密钥后端真查询（`it.skip` gated，无密钥不失败）                                                                                       |

**真查实测**：DuckDuckGo（auto 回退，无密钥）查 2022 世界杯冠军 → 5 条正确结果（命中 Argentina）✅；qianfan（真 `bce-v3/…` token）查杭州亚运会 → `references[]` 解析正确 ✅；bocha（真 `sk-…` key）查 2024 诺贝尔物理学奖 → `data.webPages.value[]` 解析正确 ✅。

## 安全考虑

- **失败不泄露**：provider/HTTP 失败转明确 `{error}`（如 `missing API key`、`baidu: rate-limited / captcha challenge`），不静默失败、不抛栈。
- **密钥仅本地**：搜索密钥存于本地 `webSearch` 配置或环境变量，不进入提示历史。
- **权限收口**：`web_search` 受 `permission-rules.cjs` 的 `WebSearch` 伞名管理；只读/auto/plan-mode 策略允许，可按需收紧。
- **低频保护**：免密钥 baidu 高频会触发反爬验证码，适配器专门检测 3xx/wappass 并返回明确限流错误而非静默——高频/稳定场景请用 keyed 源（qianfan/bocha）。

## 故障排查

| 现象                                               | 可能原因                                         | 处理                                     |
| -------------------------------------------------- | ------------------------------------------------ | ---------------------------------------- |
| qianfan 返回 `401 InvalidHTTPAuthHeader`           | token 不是完整 `bce-v3/{access-key-id}/{secret}` | 用千帆控制台完整 Bearer token            |
| bocha 返回 `403 ... enough money or package quota` | 鉴权通过但余额/配额不足（非 401）                | 充值后即恢复                             |
| baidu 返回 `rate-limited / captcha challenge`      | 高频请求触发反爬 302→wappass                     | 降低频率，或改用 keyed 源                |
| 返回 `missing API key`                             | 选了 keyed 源但未配密钥                          | 配置对应密钥，或用 `duckduckgo`/`auto`   |
| auto 总是走 duckduckgo                             | 未配置任何 keyed 密钥                            | 配置 tavily/brave/bocha/qianfan 任一密钥 |

## 关键文件

| 文件                                                                                     | 说明                                                                                            |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `packages/cli/src/lib/web-search.js`                                                     | 网络层：`webSearch(query, opts)` + 7 适配器 + `resolveProvider`/`resolveApiKey`（`_deps` 注入） |
| `packages/cli/src/ai/agent-core.js`                                                      | `case "web_search"` 工具分发（读 `webSearch` config）                                           |
| `coding-agent-contract-shared.cjs`                                                       | 工具 schema + provider 枚举                                                                     |
| `coding-agent-policy.cjs` · `permission-rules.cjs`                                       | 策略允许 + `WebSearch` 伞名权限                                                                 |
| `packages/cli/__tests__/unit/web-search.test.js` · `integration/web-search-live.test.js` | 21 单元 + gated 真查                                                                            |

## 使用示例

```bash
# 1) 无密钥即可联网搜索（auto → duckduckgo）
cc agent -p "搜一下 2024 年诺贝尔物理学奖得主，并总结他们的贡献"

# 2) 配置带密钥的源（.chainlesschain/config.json）
#    "webSearch": { "provider": "auto", "tavilyApiKey": "tvly-..." }
cc agent -p "查最新的 Electron 安全公告"

# 3) 国内网络用千帆 / 博查
#    "webSearch": { "provider": "qianfan",
#                   "qianfanApiKey": "<bce-v3 token>" }
cc agent -p "杭州亚运会的举办时间和主要赛事"
```

工具内部调用（归一化返回）：

```js
const { webSearch } = require("./lib/web-search.js");
const r = await webSearch("who won the 2022 FIFA World Cup", {
  provider: "auto",
});
// → { query, provider: "duckduckgo", count: 5,
//     results: [{ title, url, snippet }, ...], answer? }
```

## 相关文档

- [CLI Agent 智能代理](./cli-agent.md)
- [浏览器自动化](./browser-automation.md)
- [计算机操控](./computer-use.md)
- [权限系统](./permissions.md)
- [MCP 集成](./cli-mcp.md)
