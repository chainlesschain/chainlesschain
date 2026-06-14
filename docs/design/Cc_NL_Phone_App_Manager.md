# cc CLI 自然语言驱动 — 管理手机其他 App + 数据

> **状态**：v0.1 设计稿（2026-05-20）。
>
> **要解决的问题**：用户说自然语言就能让 cc 去**拉数据 / 控 app / 查信息 / 触发 hub ingest**，而不必记 30+ 个子命令。技术 spine 是端侧小 LLM（1.5-3B）做 intent 解析 + 既有 cc 命令栈作为 action 执行层 + 隐私 gate 保护敏感操作。
>
> **关联文档**：
> - 父：[`Personal_Data_Hub_Android_Standalone_Cc.md`](./Personal_Data_Hub_Android_Standalone_Cc.md)（Plan A 主架构，本文档是其 NL 层细节）
> - 同源思路：[`Personal_Data_Hub_Architecture.md`](./Personal_Data_Hub_Architecture.md) §AnalysisEngine（已有 NL → query-parser → vault facts → LLM 模式，本文档把它从 Q&A 扩展到 Action）
> - 已有 cc NL skill：`.claude/skills/cc-cli/SKILL.md`（per memory [[cc-cli-nl-skill]]，Claude Code 内已有的 cc 命令自然语言入口；本文档是在用户手机里的同思路实现）
>
> **范围**：Android 优先（Plan A 落地路径）。桌面端同思路可复用 — 已有 `cc-cli` SKILL 通过 Claude Code 做 NL 解析，但桌面 v1 优先保留外部 LLM；手机端必须自包含。

---

## 1. 背景

### 1.1 既有 NL 入口 vs 缺口

| 入口 | NL 解析 | 执行层 | 范围 |
|---|---|---|---|
| Claude Code `cc-cli` SKILL | Claude（用户付费） | Bash 调 cc | 通用 cc 命令；不在手机里 |
| 桌面 PDH AnalysisEngine `ask` | Ollama qwen2.5:7b | vault 查询（read-only） | 只解析查询；不触发 ingest / action |
| Android in-app terminal（既有 Phase 2.5） | ❌ 无 | 用户手打 cc | 必须记命令 |
| **Cc NL Phone App Manager**（本文档） | 端侧 llama.rn 1.5-3B | cc android / cc hub / cc nl | 完整覆盖 query + ingest + control |

**核心缺口**：手机用户在通勤路上想说"看看上周和我妈通话多久"，目前路径是 (1) 进 cc terminal → (2) 想起 `cc hub ask` 命令 → (3) 输入 → (4) 等响应。NL 入口把 1-3 合一。

### 1.2 为什么不直接复用桌面 AnalysisEngine？

AnalysisEngine 是 **Q&A only** — 输入问题，输出答案 + citation。它不会触发任何**写**操作（ingest / register / unregister / app launch）。本文档要的是：

```
用户 NL → intent classifier → {query | ingest | control | action} → 路由
                                ↓
                    {query: AnalysisEngine.ask}
                    {ingest: cc hub ingest <adapter>}
                    {control: cc android app launch / cc android a11y click}
                    {action: cc android root exec / cc workflow run}
```

即"**先决定意图，再调对应 cc 子命令**"。AnalysisEngine 只是 query 这一分支的实现。

### 1.3 为什么必须端侧 LLM？

| 选项 | 评估 |
|---|---|
| 远程云 LLM 解析 NL | 违背"数据回归个人"哲学 — 用户的 NL 已可能含敏感片段（"上周和我妈通话"暴露关系图） |
| 规则正则解析 | 中文短语变体爆炸；"昨天微信" / "昨天的微信" / "前一天微信" / "yesterday wechat" 全要写 |
| 端侧 1.5B 小 LLM | 解析能力足够（intent classification + slot filling）；离线可用；隐私无外泄 |
| 桌面 LLM 解析（手机 RPC） | 与 Plan B 冲突 — 本设计文档为 Plan A 服务，必须本机自包含 |

**结论**：端侧 LLM 必选。准确率不足靠"规则 fast-path"补足（§4.3）。

---

## 2. 目标 & 非目标

### 2.1 目标

| # | 项 | 验收 |
|---|---|---|
| G1 | `cc nl "<中文/英文 NL>"` 顶层命令，将 NL 解析为 cc 子命令并执行 | `cc nl "拉昨天的通讯录"` → 解析为 `cc android contacts pull --since <ms>` → 执行 → 返回 SyncReport |
| G2 | 4 大 intent 类别识别准确率 ≥ 85%（query / ingest / control / action） | 单测 50 条 fixture phrases / 实测命中率 ≥ 85% |
| G3 | 时间词 fast-path — "昨天" / "上周" / "今天" / "上个月" / "去年" 等高频时间表达走正则不走 LLM | 单测覆盖 10+ 时间表达式 |
| G4 | 实体（adapter 名 / app 名 / 联系人名）的 NER — LLM 输出 JSON slot，cc 端 fuzz-match 到注册 adapter 列表 | "拉抖音" → adapter=`social-douyin`；"看京东订单" → adapter=`shopping-jd` |
| G5 | 高敏感 action 强制二次确认（destroy / unregister / app launch / root exec / a11y click） | NL "删 vault" → 解析为 destroy → 弹 confirm dialog "你确定吗？" |
| G6 | 用户语言纠错 / 二次澄清回路 — 若 intent 不明 / slot 缺失 LLM 输出 `clarify`，cc 端追问一句 | "看 xx" → LLM clarify "你想看哪个 app 的数据？我支持: 微信/QQ/淘宝..." |
| G7 | NL 历史 + 上下文记忆 — 最近 5 条 cc nl 输入存 session memory，支持代词指代（"再来一次" / "改成上周") | "拉昨天微信" → "改成上周" → 解析为 wechat + since=lastweek |
| G8 | 隐私 gate — 端侧 LLM 始终视为 local；若 LLM 调用走远程 API（用户切了），解析路径不变但 cc 提示 user "正在用远程模型解析你的指令" | UI: warning banner |

### 2.2 非目标（defer 到 v0.2+）

- **多轮对话** — v0.1 单轮 query / clarify-一次。多轮真正像聊天的留给 [[managed-agents-phase-h]] 那一支。
- **语音输入** — Android 语音 → 文字 → cc nl 这步走 Android 系统 SpeechRecognizer，**不在本文档**。
- **跨设备 NL** — 用户在桌面说 "查我手机里的抖音" → 走桌面 cc 远控 → Plan B 路径。本文档只覆盖手机本机。
- **大模型 14B+** — 1.5-3B 够用；14B 留给重型分析（不是 NL 解析）。
- **NL 触发自定义 cc 命令** — v0.1 只覆盖白名单 cc 命令（cc hub / cc android / cc llm / cc workflow run），不让 LLM 自由组合 shell 命令（命令注入风险）。

---

## 3. Open Questions

### OQ-1: NL 解析层和 cc command 层之间的协议

**A.** LLM 直接输出 cc 命令字符串（`cc hub ingest wechat --since <ms>`），cc 把它当 bash 执行。简单但有命令注入风险。

**B.** LLM 输出结构化 JSON `{intent, adapter, action, params}`，cc 内部映射到子命令调用。安全。

**推荐：B**。隔离 LLM 输出与 shell 执行。

### OQ-2: 不识别的 NL 如何兜底

**A.** 直接报错 "我没听懂"。

**B.** 走 AnalysisEngine.ask 兜底（当作 Q&A） — 大多无法分类的 NL 其实是问题。

**推荐：B**。Q&A 是 80% NL 输入的真实意图。

### OQ-3: 端侧 LLM 模型选择

**A.** qwen2.5:1.5b-instruct（Q4_K_M ~1GB）— 中文优秀。

**B.** phi-3.5-mini（~2GB）— 英文优秀，中文一般。

**C.** Llama-3.2-3B（~2GB）— 平衡。

**推荐：A 默认（用户基数主要中文）+ C 可选**。

### OQ-4: NL 命令历史持久化

**A.** 不持久化（每次 fresh）。

**B.** session memory 内存（cc 进程生命周期）。

**C.** 持久化到 `~/.chainlesschain/nl-history.jsonl` — 用户可 `cc nl history` 翻阅。

**推荐：B+C 混合 — B 优先（性能），C 后台异步落盘**。

---

## 4. NL 解析 Pipeline

### 4.1 整体流程

```
用户输入 NL
   ↓
┌──────────────────────────────────────────────────────┐
│ Stage 1: 规则 fast-path                              │
│   - 时间词正则提取 (昨天/上周/今天/...)             │
│   - 高频短语直接命中 (cc nl "health" → cc hub health)│
│   - 设备命令直查 (cc nl "list app" → cc android app │
│                                       list)         │
└──────────────────────────────────────────────────────┘
   ↓ (未命中)
┌──────────────────────────────────────────────────────┐
│ Stage 2: 端侧 LLM intent classification              │
│   System prompt: "你是 cc CLI 命令解析器。把用户的   │
│     自然语言解析成 JSON: {intent, adapter?, action?,│
│     since?, until?, target?, params}. 4 类 intent:  │
│     query/ingest/control/action. 输出仅 JSON。"     │
│   User: "拉昨天的微信记录"                          │
│   LLM 输出: {"intent":"ingest","adapter":"wechat",  │
│              "since":"yesterday"}                    │
└──────────────────────────────────────────────────────┘
   ↓
┌──────────────────────────────────────────────────────┐
│ Stage 3: slot 验证 + 实体规范化                      │
│   - "yesterday" → Date.now()-86400000                │
│   - "微信" → adapter="wechat" (fuzz match 注册列表) │
│   - 检查 adapter 在当前设备能力清单内（§5 PlanA）   │
└──────────────────────────────────────────────────────┘
   ↓
┌──────────────────────────────────────────────────────┐
│ Stage 4: 隐私 / 高敏 gate                            │
│   - intent=action + target=destroy → confirm dialog │
│   - adapter 在 P5 (root) 路径且无 root → 拒 + 提示  │
│   - LLM 非本地时整体 gate（继承 AnalysisEngine 规则）│
└──────────────────────────────────────────────────────┘
   ↓
┌──────────────────────────────────────────────────────┐
│ Stage 5: 路由到 cc 子命令                            │
│   {intent:'query'}   → cc hub ask "<原 NL>"          │
│   {intent:'ingest'}  → cc hub ingest <adapter>       │
│                         --since <ms>                 │
│   {intent:'control'} → cc android app launch <pkg>   │
│                       / cc android a11y click ...   │
│   {intent:'action'}  → cc android root exec / cc    │
│                       workflow run / cc hub destroy │
└──────────────────────────────────────────────────────┘
   ↓
┌──────────────────────────────────────────────────────┐
│ Stage 6: 执行 + 反馈                                 │
│   - 流式回显进度（复用既有 cc stream）              │
│   - 错误透传 + LLM 自然语言重述（"我尝试拉微信但你 │
│     的设备没 root，无法访问其它 app 数据"）         │
└──────────────────────────────────────────────────────┘
```

### 4.2 4 类 Intent + 路由表

| Intent | 触发短语示例 | 路由命令 | 高敏 |
|---|---|---|---|
| **query** | "我昨天买了啥" / "上周和谁聊得多" / "最近一笔大额支出" | `cc hub ask "<原 NL>"`（走 AnalysisEngine） | 否 |
| **ingest** | "拉昨天的微信" / "同步最近的通讯录" / "把支付宝账单导进去" | `cc hub ingest <adapter> [--since <ms>]` | 否（已注册 adapter 的话） |
| **control** | "打开微信" / "切到抖音" / "点这个按钮" / "返回桌面" | `cc android app launch <pkg>` / `cc android a11y click <node>` | 否 |
| **action** | "删 vault" / "停掉所有 adapter" / "退出登录淘宝" / "执行截图工作流" | `cc hub destroy --confirm` / `cc android root exec` / `cc workflow run <name>` | 是（强 confirm） |

### 4.3 规则 fast-path（Stage 1）

| 类型 | 模式 | 路由 |
|---|---|---|
| 时间词 | `昨天|前天|今天|上周|上个月|去年|前\d天` | 提取 → `since` 参数；继续后续 LLM |
| 健康检查 | `health|健康|状态|检查` | 直 `cc hub health` |
| Adapter 列表 | `所有 adapter|adapter 列表|哪些数据源` | 直 `cc hub list-adapters` |
| 帮助 | `help|帮助|怎么用|有什么命令` | 直 `cc --help` + cc nl 短语集 |
| 退出 | `quit|exit|退出` | 退出 cc nl REPL |

### 4.4 端侧 LLM Prompt 模板

```
[system]
你是 ChainlessChain cc CLI 命令解析器。把用户的中文/英文自然语言指令解析成 JSON。

输出格式（仅 JSON，无 markdown 包装）：
{
  "intent": "query" | "ingest" | "control" | "action" | "clarify",
  "adapter": "<adapter 名 or null>",
  "appPkg": "<Android package or null>",
  "since": "<ISO date or null>",
  "until": "<ISO date or null>",
  "params": {},
  "rationale": "<一句话解释你为什么这么分类>"
}

支持的 adapter（必须 fuzz-match 到这个列表，不能编造）：
  email-imap, alipay-bill, system-data,
  shopping-taobao, shopping-jd, shopping-meituan,
  travel-amap, travel-baidu-map, travel-ctrip, travel-12306,
  ai-chat-history-deepseek (...8 vendor...),
  social-bilibili, social-weibo, social-douyin, social-xiaohongshu,
  messaging-qq, messaging-telegram, messaging-whatsapp,
  wechat

支持的 Android package（必须从 cc android app list 拉到的列表，由 cc 端注入到 prompt）：
{{INSTALLED_PKG_LIST}}

如果你无法确定 intent 或缺关键 slot，输出 {"intent":"clarify","rationale":"<追问内容>"}。

[user]
{{USER_NL}}

[assistant]
（JSON）
```

### 4.5 Stage 3 实体规范化细节

| LLM 输出 | 规范化结果 |
|---|---|
| `"wechat"` / `"微信"` / `"WeChat"` | adapter = `wechat`（用 Levenshtein ≤ 2 fuzz） |
| `"taobao"` / `"淘宝"` / `"淘宝订单"` | adapter = `shopping-taobao` |
| `"yesterday"` / `"昨天"` | since = `Date.now() - 86400000` |
| `"last week"` / `"上周"` / `"上一周"` | since = 周一 0:00 |
| `"this month"` / `"本月"` | since = 月初 |
| 不在注册列表的 adapter | error: "我不认识这个数据源，cc 当前支持: ..." |

### 4.6 Stage 4 高敏 action 矩阵

| Action | 风险 | UI 行为 |
|---|---|---|
| `cc hub destroy` | 极高 | 弹 confirm dialog 显示 "你将永久删除 X 条事件 / Y 个联系人 / Z MB 数据" — 用户必须输 `yes` |
| `cc hub unregister <name>` | 中 | confirm "解绑 Email 账号 X？" |
| `cc android root exec` | 极高 | confirm 显示完整 shell 命令 |
| `cc android a11y click` | 中 | confirm "点击屏幕节点 \"<text>\"？" |
| `cc android app launch` | 低 | 直接执行 + log |
| `cc hub ingest` | 低 | 直接执行 + progress |
| `cc hub ask` | 低 | 直接执行 |

---

## 5. cc 实现层

### 5.1 新文件清单

| 文件 | 职责 | LOC 估 |
|---|---|---|
| `packages/cli/src/commands/nl.js` | 顶层 `cc nl` 命令入口 + Stage 1-6 编排 | 300 |
| `packages/cli/src/lib/nl/fast-path.js` | Stage 1 规则匹配 | 150 |
| `packages/cli/src/lib/nl/llm-classifier.js` | Stage 2 LLM prompt 构造 + JSON parse | 200 |
| `packages/cli/src/lib/nl/normalizer.js` | Stage 3 实体规范化（adapter / time / pkg） | 250 |
| `packages/cli/src/lib/nl/gate.js` | Stage 4 隐私/高敏 gate | 100 |
| `packages/cli/src/lib/nl/router.js` | Stage 5 路由到 cc 子命令 | 200 |
| `packages/cli/src/lib/nl/history.js` | 历史持久化 + 代词指代解析 | 150 |
| `packages/cli/src/lib/nl/__tests__/*.test.js` | 6 个测试文件 / ≥ 60 tests | — |

**总新增**：~1350 LOC + 6 test file。

### 5.2 数据流（cc nl 单次调用）

```javascript
// packages/cli/src/commands/nl.js (伪代码)
async function ccNl(userNl) {
  // Stage 1
  const fast = tryFastPath(userNl);
  if (fast) return router.execute(fast);

  // Stage 2
  const llmJson = await llmClassifier.classify(userNl, {
    installedPkgs: await cachedInstalledPkgs(),
    registeredAdapters: await hub.listAdapters(),
    history: history.recent(5),
  });

  if (llmJson.intent === 'clarify') {
    print(llmJson.rationale);
    const followup = await readLine('>>> ');
    return ccNl(`${userNl}\n${followup}`); // recursive 一次
  }

  // Stage 3
  const normalized = normalizer.normalize(llmJson);

  // Stage 4
  const gateResult = gate.check(normalized);
  if (gateResult.requireConfirm) {
    const ok = await confirm(gateResult.message);
    if (!ok) return;
  }
  if (gateResult.blocked) {
    return print(gateResult.reason);
  }

  // Stage 5
  const cmd = router.toCommand(normalized);
  history.append({ userNl, cmd, ts: Date.now() });

  // Stage 6
  await execute(cmd, { stream: true });
}
```

### 5.3 路由表实现（关键）

```javascript
// router.toCommand({intent:'ingest', adapter:'wechat', since: 1716000000000})
// → returns: ['cc', 'hub', 'ingest', 'wechat', '--since', '1716000000000']

const ROUTES = {
  query: (n) => ['cc', 'hub', 'ask', n._originalNl],
  ingest: (n) => [
    'cc', 'hub', 'ingest', n.adapter,
    ...(n.since ? ['--since', String(n.since)] : []),
    ...(n.until ? ['--until', String(n.until)] : []),
  ],
  control: (n) => {
    if (n.appPkg && n.action === 'launch')
      return ['cc', 'android', 'app', 'launch', n.appPkg];
    if (n.action === 'a11y-click' && n.params?.nodeId)
      return ['cc', 'android', 'a11y', 'click', n.params.nodeId];
    throw new Error('Unsupported control action');
  },
  action: (n) => {
    // 高敏，gate 已 confirm 过
    if (n.action === 'destroy')
      return ['cc', 'hub', 'destroy', '--confirm'];
    if (n.action === 'root-exec' && n.params?.cmd)
      return ['cc', 'android', 'root', 'exec', n.params.cmd];
    if (n.action === 'workflow-run' && n.params?.name)
      return ['cc', 'workflow', 'run', n.params.name];
    throw new Error('Unsupported action');
  },
};
```

### 5.4 历史 + 代词指代

```javascript
// history.recent(5) 返回最近 5 条
// 用户输入 "改成上周" → LLM 看到 history 后理解 "改成上周" 是修改上一次 ingest 的 since 参数
// LLM prompt 加 history block:
//
// 最近的 cc nl 上下文（最新在最后）：
//   1. "拉昨天的微信" → ingest wechat since=2026-05-19
//   2. （当前）"改成上周"
//
// LLM 输出应该: {intent:'ingest', adapter:'wechat', since:'2026-05-13'}
```

---

## 6. Sub-Phase 拆分

| Sub-Phase | 主题 | 关键产出 | 测试 | 工时 |
|---|---|---|---|---|
| **N1** | `cc nl` 顶层命令骨架 + 规则 fast-path Stage 1 | `cc nl "health"` 直接 `cc hub health` | unit ≥ 15 | 0.5d |
| **N2** | 端侧 LLM classifier Stage 2 | LLM JSON 输出 + parse 错误 fallback | unit ≥ 10 fixture phrases / mock LLM | 1d |
| **N3** | Normalizer Stage 3 (adapter / time / pkg fuzz) | "微信" → "wechat" / "昨天" → ms | unit ≥ 20 | 1d |
| **N4** | Gate Stage 4 + 高敏 confirm | destroy 弹 confirm 拦截 | unit ≥ 10 | 0.5d |
| **N5** | Router Stage 5 + 4 intent 路由 | 全 4 intent 路由到对应 cc 命令 | unit ≥ 16 (4 intent × 4 happy/error) | 1d |
| **N6** | 历史 + 代词指代 | "再来一次" / "改成上周" | unit ≥ 8 | 0.5d |
| **N7** | clarify 回路（v0.1 仅 1 跳） | 缺 slot 时追问 + 二次输入 | unit ≥ 5 | 0.5d |
| **N8** | 真机 E2E 8 场景 | 见 §7 | 真机 Xiaomi 24115RA8EC | 0.5d |

**总工时**：~5d。本文档与 Plan A 串行（依赖 LlamaRn 已落 — Plan A Sub-Phase A3）。

---

## 7. 真机 E2E 8 场景

| # | NL | 期望 cc 命令 | 验收 |
|---|---|---|---|
| N-E1 | "我有几个联系人" | `cc hub ask "我有几个联系人"` | 返回正确数字 |
| N-E2 | "拉昨天的通讯录" | `cc hub ingest system-data --since <ms>` | SyncReport ingested ≥ 0 |
| N-E3 | "上周和谁通话最多" | `cc hub ask "..."` | 返回 top-N 列表 |
| N-E4 | "打开抖音" | `cc android app launch com.ss.android.ugc.aweme` | Activity 启动 |
| N-E5 | "删 vault" | confirm dialog → 用户 cancel → 不执行 | vault 保留 |
| N-E6 | "拉微信"（非 root 设备） | gate 拒 + 提示 "需要 root" | 友好错误 |
| N-E7 | "拉微信"（rooted 设备） | confirm root exec → 用户 yes → `cc android root exec` 链 | SyncReport |
| N-E8 | "改成上周"（紧接 N-E2 后） | 继承 system-data + since=上周 | SyncReport |

---

## 8. Forward-looking Traps

1. **LLM 输出非 JSON / markdown 包装的 JSON** — 1.5B 模型有概率包 ```\`\`\`json ... \`\`\`\`` 或加废话。Mitigation: parse 失败时 regex 抠最近的 `{...}` 块；3 次失败兜底走 AnalysisEngine.ask（当 Q&A）。

2. **adapter 名 fuzz-match 假阳性** — "小红"匹配到 social-xiaohongshu。Mitigation: 用 token-overlap 而非 substring；阈值 ≥ 0.6；ambiguous 时走 clarify。

3. **时间词歧义** — "上周末" / "周六" / "上个工作日" — 模糊定义。Mitigation: 仅支持枚举集（昨天/前天/今天/明天/上周/本周/上月/本月/上一年/本年），其它走 LLM + clarify。

4. **代词指代多层嵌套** — "再来一次但改成上周再加抖音" — 多 slot 改写 LLM 失败率高。Mitigation: v0.1 单 slot 改写支持；多 slot 走 clarify "你说的是: ingest wechat since=last-week + ingest douyin since=last-week 吗？"

5. **命令注入 — LLM 输出 raw shell 字符串** — LLM 输出 `cc hub ask "; rm -rf $HOME"`。Mitigation: 严格 JSON 路由（§5.3），LLM 输出**不**直接进 shell；所有参数 spawn `execFile` 不 shell。

6. **history 跨敏感会话泄漏** — 用户在公共场合 `cc nl history` 暴露之前问过的"我妈生日"。Mitigation: `history` 命令默认问 LLM "是否含敏感词"，含则提示用户独立窗口查看 + 可选 PIN gate。

7. **端侧 LLM 中文 token 化慢** — 1.5B 模型中文 tok/s 比英文低 30%。Mitigation: 接受；如真机测出 > 10s 单 query 体验差，切 3B 模型。

8. **NL 命令 ambiguous 时 clarify 嵌套循环** — clarify 后用户答的更模糊。Mitigation: 最多 2 跳 clarify；第三跳直接 `cc --help` + 短语集。

9. **history 持久化文件污染 cc CI** — `nl-history.jsonl` 进 `.chainlesschain/`，cc CI 默认会 cleanup 此目录可能跨测污染。Mitigation: 路径用 separate `.chainlesschain/nl/history.jsonl`；CI test 用 tmpdir。

10. **远程 API key 用户偷换为云 LLM 解析** — 用户设 `cc llm provider anthropic` 后跑 `cc nl` 时解析也走 anthropic，敏感 NL 出墙。Mitigation: `cc nl` 默认强制端侧 LLM（不读 cc llm provider）；想用云 LLM 解析 NL 走 `cc nl --llm anthropic` 显式 opt-in + warning。

11. **NER 必须知道当前注册 adapter 列表** — LLM prompt 含 `{{INSTALLED_PKG_LIST}}` 注入；列表过长 → context window 撑爆。Mitigation: ≤ 30 个 pkg 全注入；> 30 时只注入用户最近用过的 + 仍可 "list app" 走 fast-path 拿全列表。

12. **用户期望 NL 直接修改 cc config** — "把模型换成 3B" → 这是 cc config 改而非 cc hub/android。Mitigation: v0.1 加第 5 类 intent `config`，路由到 `cc config set <key> <value>`，但限制白名单 key（llm.provider / llm.model / etc）。

---

## 9. 端侧 LLM 模型分发

### 9.1 模型清单（v0.1）

| 模型 | 量化 | 大小 | tok/s (Snapdragon 8 Gen 3) | 用途 |
|---|---|---|---|---|
| qwen2.5-1.5b-instruct | Q4_K_M | ~1.1GB | ~25 | 默认 NL 解析 |
| qwen2.5-3b-instruct | Q4_K_M | ~2.1GB | ~12 | 高级 NL 解析（v0.2） |

### 9.2 分发路径

- **APK 不内置**（避免体积膨胀，per Plan A trap 12）
- 首次 `cc nl` / `cc llm pull qwen2.5-1.5b` 触发下载
- CDN: `https://models.chainlesschain.com/<model>.gguf` + SHA-256 校验
- 离线设备：用户在桌面下载 → SAF 拖入 `/sdcard/Download/qwen2.5-1.5b.gguf` → `cc llm import <path>`

---

## 10. 与既有 cc-cli SKILL 的关系

桌面 Claude Code 已有 `cc-cli` SKILL（per memory [[cc-cli-nl-skill]]）— 用户在 Claude Code 里说"列我所有 skill"，Claude 通过 `cc --help` 动态发现命令并调用。本文档与之**互补不重叠**：

| 维度 | cc-cli SKILL（Claude Code 桌面） | Cc NL Phone App Manager（手机） |
|---|---|---|
| LLM 来源 | Claude（用户已付费） | 端侧 llama.rn |
| 触发场景 | 用户在 Claude Code 对话窗口里说话 | 用户在 Android cc terminal 或 NL UI 里说话 |
| 命令发现 | `cc --help` 动态 | 端侧 prompt 注入 adapter / pkg 列表 |
| 隐私 | 看 Claude 服务条款 | 端侧 100% 本机 |
| 上下文记忆 | Claude session（对话） | cc nl history.jsonl |

> 长期可考虑 Claude Code 用 `cc-cli` SKILL 调远控手机的 cc nl（Plan B 路径），即"桌面 NL → cc remote → 手机 cc nl"。v1 范围外。

---

## 11. 决策结论

**问题**："用 cc CLI 自然语言管理手机其他 app 和数据"

**答**：技术上可行。Pipeline = 端侧小 LLM (intent classifier) + 既有 cc 命令栈作为执行层 + 4 类 intent 路由 + 隐私 gate。

**核心条件**：
1. ⏳ Plan A LlamaRn 落地（依赖 [`Personal_Data_Hub_Android_Standalone_Cc.md`](./Personal_Data_Hub_Android_Standalone_Cc.md) Sub-Phase A3）
2. ⏳ 新增 `cc nl` 顶层命令 + 6 lib/nl/* 模块 (~5d)
3. ✅ 既有 cc 命令栈、AnalysisEngine、AdapterRegistry 零改动复用

**总工程**：**~5d** 在 Plan A LlamaRn 落地之后串行。

**强约束**：
- 端侧 LLM 模型 1.5-3B 范围；APK 不内置，走 CDN on-demand
- 高敏 action 强制 confirm（不让 LLM 自动 destroy / root exec / a11y click）
- 命令注入防护严格 JSON 路由（不让 LLM 输出 raw shell）

---

> **下一步**：(1) 用户 align 是否做；(2) 若做，等 Plan A Sub-Phase A3 (LlamaRn) 落地后启 N1。

## 附录：规范章节补全（v5.0.3.108）

> 本文为设计文档。为对齐项目文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文细节。

### 1. 概述
见正文头部。cc CLI 自然语言驱动管理手机其他 App：NL 驱动 App 管理 + 数据。

### 2. 核心特性
自然语言 / 手机 App 管理 / 数据采集。

### 3. 系统架构
见正文架构 / 设计章节。

### 4. 系统定位
ChainlessChain 的「cc NL 手机 App 管理」。

### 5. 核心功能
见正文功能 / 设计章节。

### 6. 技术架构
见正文实现 / 技术章节。

### 7. 系统特点
见正文（状态 / 版本 / 特性）。

### 8. 应用场景
见正文应用场景 / 背景。

### 9. 竞品对比
见正文对比 / 借鉴（如有）。

### 10. 配置参考
见正文配置 / 参数章节。

### 11. 性能指标
见正文性能 / 指标章节。

### 12. 测试覆盖
见正文测试 / E2E 章节。

### 13. 安全考虑
见正文安全 / 权限章节。

### 14. 故障排除
见正文故障 / trap / 已知限制章节。

### 15. 关键文件
见正文实现位置 / 关键文件章节。

### 16. 使用示例
见正文使用 / 命令 / API 示例。

### 17. 相关文档
[系统设计主文档](./系统设计_主文档.md)、相关设计文档。
