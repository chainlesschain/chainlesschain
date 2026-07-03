# 多引擎搜索（multi-search-engine）

> **版本: v1.0.0 | 状态: ✅ 生产可用 | 17 个搜索引擎（8 中 + 9 国际）| 零配置 · 免 API Key**
>
> `multi-search-engine` 是 `cc agent` / Cowork 的**内置技能**（`category: knowledge`，可直接 `/multi-search-engine` 调用）。它把同一个查询词一次性展开成 **17 个搜索引擎**的可点击搜索 URL，**不需要任何 API Key、不发起任何网络请求**——只做「生成 URL」，把「抓取内容」交给 `web_fetch`。

## 概述

搜索聚合器的通常做法是逐个调用各引擎的付费 API，配置繁琐、成本高、还受配额限制。`multi-search-engine` 反其道而行：它是一个**纯 URL 生成器**——接收查询词与筛选选项，为选中的引擎各生成一条带编码参数的标准搜索 URL，然后提示用 `web_fetch()` 去抓取任意一条结果。

这带来两个直接好处:

- **零配置**——不读 `config.json`、不需要 key，装好即用；
- **可组合**——生成的是普通 URL，agent 可挑其中几条交给 `web_fetch` 深读，也可直接呈现给用户在浏览器打开。

它与联网搜索工具 [`web_search`](./web-search.md) 互补：`web_search` 真正调用搜索源并返回归一化结果 `{title,url,snippet}`；`multi-search-engine` 不调用、只广撒网生成入口 URL，适合「同一问题多引擎交叉验证」「国内/国际源对照」「隐私源专搜」等场景。

## 核心特性

- **17 引擎覆盖**——8 个中文源 + 9 个国际源，一次查询全展开。
- **零 API Key / 零请求**——纯 URL 构造，无网络副作用、无配额、无鉴权。
- **分组快捷筛选**——`--chinese` / `--international` / `--privacy` / `--all`，或 `--engine a,b,c` 精确指定。
- **隐私源标注**——DuckDuckGo / Startpage / Brave / Qwant 4 个隐私引擎带 `[Privacy]` 标记，`--privacy` 一键只搜隐私源。
- **时间过滤**——`--time hour|day|week|month|year`，对支持的引擎注入各自的时间参数（Google/Bing/DDG/Baidu/Startpage/Brave）。
- **高级检索算子透传**——`site:`、`filetype:`、`"精确短语"`、`-排除词` 原样编码进查询串。
- **默认 5 源均衡**——不带筛选时取 `google, baidu, ddg, bing, brave`（中/国际/隐私兼顾）。
- **与 `web_fetch` 天然衔接**——输出末尾提示用 `web_fetch()` 抓取任意结果 URL。

## 系统架构

技能是**单文件无状态**的：一个 `SKILL.md` 声明 + 一个 `handler.js` 实现，无外部依赖、无持久化。

```
/multi-search-engine <query> [options]
        │
        ▼
 parseInput(input)                     # 解析 --engine/--all/--chinese/--privacy/--time + 查询词
        │
        ▼
 encodeURIComponent(query)             # 查询词编码一次
        │
        ▼
 for engineKey in engines:
     ENGINES[engineKey].buildUrl(q, opts)   # 每引擎独立的 URL 模板 + timeParam() 时间参数
        │
        ▼
 { success, result:{ query, results[], invalidEngines, options }, message }
```

- **`ENGINES`**——引擎注册表，每项含 `{name, key, region: 'cn'|'intl', privacy, buildUrl(q, opts)}`。新增引擎 = 往这张表加一条 `buildUrl`。
- **`timeParam(engine, time)`**——把统一的 `day/week/month/...` 映射到各引擎自己的时间过滤参数（如 Google `&tbs=qdr:w`、DDG `&df=w`、Baidu `&gpc=stf%3D7d`）；不支持的引擎返回空串。
- **分组常量**——`CHINESE_ENGINES` / `INTL_ENGINES` / `PRIVACY_ENGINES` 由 `region` / `privacy` 字段在加载时派生，`--chinese` 等选项直接取用。
- **测试缝**——`handler.js` 额外导出 `_deps` / `_ENGINES` / `_DEFAULT_ENGINES`，便于单测注入与断言。

## 支持的引擎

### 中文（8）

| 引擎             | key       | 隐私 | 时间过滤 |
| ---------------- | --------- | ---- | -------- |
| 百度 Baidu       | `baidu`   | 否   | ✅       |
| Bing 国内        | `bing-cn` | 否   | ✅       |
| Bing 国际        | `bing`    | 否   | ✅       |
| 360 搜索         | `360`     | 否   | —        |
| 搜狗 Sogou       | `sogou`   | 否   | —        |
| 微信搜索 WeChat  | `wechat`  | 否   | —        |
| 头条搜索 Toutiao | `toutiao` | 否   | —        |
| 集思录 Jisilu    | `jisilu`  | 否   | —        |

### 国际（9）

| 引擎         | key         | 隐私 | 时间过滤 |
| ------------ | ----------- | ---- | -------- |
| Google       | `google`    | 否   | ✅       |
| Google HK    | `google-hk` | 否   | ✅       |
| DuckDuckGo   | `ddg`       | ✅   | ✅       |
| Yahoo        | `yahoo`     | 否   | —        |
| Startpage    | `startpage` | ✅   | ✅       |
| Brave Search | `brave`     | ✅   | ✅       |
| Ecosia       | `ecosia`    | 否   | —        |
| Qwant        | `qwant`     | ✅   | —        |
| WolframAlpha | `wolfram`   | 否   | —        |

> **默认引擎**（不带筛选选项时）：`google, baidu, ddg, bing, brave`。
> **隐私引擎**（`--privacy`）：`ddg, startpage, brave, qwant`。

## 配置参考

本技能**无需任何配置**——不读 `config.json`、不需要 API Key。全部行为由命令行选项控制:

| 选项                       | 作用                                     | 示例                    |
| -------------------------- | ---------------------------------------- | ----------------------- |
| `<query>`                  | 查询词（必填，可含高级算子）             | `Vue3 best practices`   |
| `--engine a,b,c`           | 精确指定引擎（逗号分隔 key，忽略大小写） | `--engine google,baidu` |
| `--all`                    | 全部 17 个引擎                           | `--all`                 |
| `--chinese`                | 仅 8 个中文引擎                          | `--chinese`             |
| `--international`/`--intl` | 仅 9 个国际引擎                          | `--intl`                |
| `--privacy`                | 仅 4 个隐私引擎                          | `--privacy`             |
| `--time <window>`          | 时间过滤 `hour\|day\|week\|month\|year`  | `--time week`           |

**高级检索算子**（原样编码进查询串，由目标引擎解释）:

- `site:example.com` — 限定站内
- `filetype:pdf` — 限定文件类型
- `"exact phrase"` — 精确匹配
- `-exclude` — 排除词

## 性能指标

| 指标         | 值                                                    |
| ------------ | ----------------------------------------------------- |
| 网络请求     | **0**（纯本地 URL 构造）                              |
| 单次调用耗时 | 亚毫秒级（字符串拼接 + `encodeURIComponent`）         |
| 内存占用     | 常量（引擎表 17 条，无缓存无状态）                    |
| 输出规模     | 每引擎 1 条结果对象 `{engine,key,region,privacy,url}` |

真正的耗时发生在后续用 `web_fetch` 抓取所选 URL 的阶段——本技能自身不承担网络开销。

## 测试覆盖率

`handler.js` 通过导出 `_ENGINES` / `_DEFAULT_ENGINES` / `_deps` 暴露测试缝，可在无网络下断言:

- **引擎表完整性**——17 条、8 中 9 国际、隐私分组正确、默认 5 源。
- **`parseInput` 解析**——各筛选选项与 `--time` 的组合、查询词拼接、未知引擎归入 `invalidEngines`。
- **URL 构造**——查询词只编码一次、各引擎 URL 模板正确、`timeParam` 对支持/不支持的引擎分别注入参数/空串。
- **空查询兜底**——无查询词时返回 `success:false` + 用法帮助文本。

## 安全考虑

- **无凭据、无出网**——技能不持有任何 key，也不主动发起请求，本身不构成数据外泄面。
- **查询词编码**——查询统一经 `encodeURIComponent`，避免把用户输入原样拼进 URL 造成参数注入/越界。
- **抓取阶段才是信任边界**——真正访问外部站点发生在下游 `web_fetch`；对返回内容的可信度、SSRF、隐私泄露等约束由 `web_fetch` 侧负责（另见 [`web_search` 安全考虑](./web-search.md#安全考虑)）。
- **隐私分组**——`--privacy` 便于把查询只投向不做用户画像的引擎，但生成 URL 仍会在你实际打开/抓取时暴露查询词给该引擎。

## 故障排查

**Q: 提示 `Unknown engines: xxx`？**
`--engine` 里的 key 拼错或大小写无关但不在表内。用表中的 `key` 列（如 `bing-cn` 而非 `bingcn`）。技能会跳过未知引擎、照常返回其余结果，并在末尾列出可用引擎。

**Q: 加了 `--time week` 但某些引擎 URL 没有时间参数？**
预期行为。仅 Google / Bing / DDG / Baidu / Startpage / Brave 支持注入时间参数，其余引擎（360/搜狗/微信/头条/集思录/Yahoo/Google HK/Ecosia/Qwant/Wolfram）不支持，`timeParam` 对它们返回空串。

**Q: 返回了 URL 但看不到搜索结果内容？**
本技能只生成入口 URL，不抓取。要拿到页面内容，把某条 `url` 交给 `web_fetch()`；或直接在浏览器打开。

**Q: 想只搜国内可访问的源？**
用 `--chinese`（Google/DDG 等在国内网络可能不通）。

## 关键文件

| 文件                                                                                      | 说明                                                                  |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `desktop-app-vue/src/main/ai-engine/cowork/skills/builtin/multi-search-engine/SKILL.md`   | 技能声明（元数据、引擎表、用法、示例）                                |
| `desktop-app-vue/src/main/ai-engine/cowork/skills/builtin/multi-search-engine/handler.js` | 实现：`ENGINES` 表 / `timeParam` / `parseInput` / `execute`（313 行） |

## 使用示例

```bash
# 1) 默认 5 源（google/baidu/ddg/bing/brave）
/multi-search-engine Vue3 组合式 API 最佳实践

# 2) 指定引擎
/multi-search-engine --engine google,baidu machine learning

# 3) 只搜隐私引擎（DDG / Startpage / Brave / Qwant）
/multi-search-engine --privacy secure messaging apps

# 4) 只搜中文源 + 近一周
/multi-search-engine --chinese --time week 大模型 推理优化

# 5) 全部 17 个引擎
/multi-search-engine --all quantum computing 2026

# 6) 配合高级算子
/multi-search-engine --engine google site:github.com filetype:md "agent skill"
```

生成的 URL 可交给 `web_fetch` 深读，例如让 agent 抓取默认 5 源里的前两条做交叉验证:

```
/multi-search-engine LLM 上下文工程
→ 得到 5 条 URL
→ web_fetch(<google url>) + web_fetch(<baidu url>) → 汇总
```

## 相关文档

- [联网搜索工具（web_search）](./web-search.md) — 真正调用搜索源并返回归一化结果的内置工具，与本技能互补
- [Skills 技能系统](./skills.md) — 技能加载、匹配与执行机制
- [Cowork 多智能体协作系统](./cowork.md) — 技能在 Cowork / agent 中的调度
- [浏览器自动化](./browser-automation.md) — 抓取/自动化网页的更重方案
