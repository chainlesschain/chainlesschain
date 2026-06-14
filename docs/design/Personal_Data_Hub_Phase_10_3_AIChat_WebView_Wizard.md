# Personal Data Hub — Phase 10.3 AIChat WebView 鉴权向导设计

> **版本**: v0.1 (2026-05-21) | **状态**: 设计稿 | **父文档**: [`Personal_Data_Hub_Architecture.md`](./Personal_Data_Hub_Architecture.md) · [`Adapter_AIChat_History.md`](./Adapter_AIChat_History.md)
>
> Phase 10.3 把 9 家国产 AI（DeepSeek / Kimi / 通义 / 智谱 / 混元 / 千帆 / 扣子 / Dreamina / 豆包）的 Cookie 鉴权流程做成统一向导：用户在 ChainlessChain UI 内打开厂商登录页，登录成功后自动抓 cookie，注册到 `AIChatHistoryAdapter`。**桌面 Electron 主进程**承载实际 BrowserView + `session.cookies.get`；`cc ui` web-shell 因浏览器同源策略无法越权读厂商 cookie，走"用户复制 cookie 字符串"备用路径（详 §6）。
>
> 本文件单独成稿是因为：父文档 `Adapter_AIChat_History.md` §11 只给一行 "WebView 鉴权流程"，§7 给 G2/G8 验收目标，§12 给 T5/T7 缓解，**没有具体到 Electron API / IPC 协议 / Vue 组件 / 9 vendor cookie matrix / re-login UX**。本文件填这部分空白。

## 0. 设计动机

`AIChatHistoryAdapter` 在 Phase 10.2 已落地全部 9 家 vendor sub-adapter（`SPEC.validateCookie` / `listConversations` / `listMessages` 三接口齐全），但**至今没有一个用户能在 UI 里点的"添加 AIChat 来源"流程**。当前唯一注册方式是：用户自己用浏览器开发者工具复制 cookie → 拼成 JSON → 走 `register-aichat-vendor` IPC。这显然不可用化产品落地。

Phase 10.3 把这个 gap 填上：

| 角色 | 现状 | Phase 10.3 目标 |
|---|---|---|
| 普通用户 | 不可能注册成功 | 桌面/Web 弹窗式向导，3 步走完一家 |
| 开发者 | cookie 必须手抠 | UI 自动抓 cookie，写文档时仅维护 vendor matrix |
| QA | 无 smoke 路径 | 每家 vendor 走通后 fixture 化，回归全自动 |

## 1. 目标 / 非目标

### 目标 (G1-G8)

- **G1** — Wizard 完成一家全流程时间 ≤ 90 秒（含用户登录时间）
- **G2** — 桌面 Electron 端用 `BrowserView` + `session.cookies.get` 抓 cookie，零手工拷贝
- **G3** — `cc ui` web-shell 端走 fallback 路径（用户在外部浏览器登录 → 在 UI 粘贴 cookie 字符串 → 服务端校验）
- **G4** — 9 家 vendor 统一向导：vendor picker → modal browser → cookie probe → validateCookie → register
- **G5** — Cookie 过期 health-check 每 6 小时跑一次；过期 vendor 在 UI 红点 + 一键重登
- **G6** — 用户在任意一步取消都不残留状态（不写 vault / 不写 aichat-accounts.json）
- **G7** — 全程审计日志（`audit_log` 表 action=register-aichat-* + 时间 + vendor + 来源 IP=`local`）
- **G8** — vendor 失败不阻塞其他 vendor（单家 cookie 抓失败 → wizard 标红 → 用户可跳过 / 重试 / 改走 fallback）

### 非目标

- **不**做 OAuth2 / API token 鉴权 — 9 家厂商目前不开放个人 API key 给 web chat 历史，v1 全走 cookie。
- **不**自动化登录 — 用户必须自己输用户名密码 + 短信验证码（避免反爬 / ToS 风险）。
- **不**同步登录态到云端 — cookie 永远只落本地 `aichat-accounts.json` (0600)。
- **不**反风控 — adapter 默认节奏温和，触发风控就停（per T3）。

## 2. 顶层架构

```
┌────────────────────────────────────────────────────────────────────┐
│ 渲染进程 (Vue3 / Electron + web-panel SPA)                          │
│   AIChatWizard.vue                                                  │
│   - Step 1: vendor 选择 (9 卡片，已注册 vendor 标 ✓)               │
│   - Step 2: 内嵌 BrowserView (electron) / 外链 + 粘贴框 (web-shell) │
│   - Step 3: 抓 cookie → validateCookie → 提示成功 + close           │
└──────────────────────┬─────────────────────────────────────────────┘
                       ↓ IPC: personal-data-hub:aichat-* (4 个新通道)
                       ↓ WS:  personal-data-hub.aichat-* (镜像)
┌────────────────────────────────────────────────────────────────────┐
│ 主进程 / cc ui 服务端                                                │
│   aichat-wizard-controller.js                                       │
│   - openVendorLogin(vendor)  → 创建独立 partition + BrowserView     │
│   - probeCookies(vendor)     → session.cookies.get(domain matrix)   │
│   - registerVendor(vendor, cookies) → AIChatHistoryAdapter 注册     │
│   - rotateLoginPartition(vendor) → 清旧 cookie 重开                 │
└──────────────────────┬─────────────────────────────────────────────┘
                       ↓
┌────────────────────────────────────────────────────────────────────┐
│ Hub 现有能力                                                         │
│   - AIChatHistoryAdapter (Phase 10.1)                              │
│   - aichat-accounts.json 持久化                                     │
│   - HealthCheck 调度（新增：每 6h 跑 validateCookie 巡检）           │
└────────────────────────────────────────────────────────────────────┘
```

**两端差异**：

| | 桌面 Electron | `cc ui` Web-Shell |
|---|---|---|
| 浏览器载体 | `BrowserView` (主进程拥有) | 外部浏览器 (用户自己) |
| Cookie 提取 | `session.fromPartition(...).cookies.get({url})` | 用户复制粘贴（开发者工具 / EditThisCookie） |
| 同账号续登 | 走 partition，浏览器记住登录 | 用户自己在外部浏览器记住 |
| 体验等级 | A 级（一键） | C 级（手工但可控） |

Web-shell 没法 A 级 — 浏览器同源策略 + 第三方 cookie 隔离让 `cc ui` 起的服务端**永远**读不到 `chat.deepseek.com` 的 cookie。承认这一点比硬上来强。

## 3. Vendor Cookie Matrix（9 家）

由 `packages/personal-data-hub/lib/adapters/ai-chat-history/cookie-capture-spec.js` 实现，与 `vendors/*.js` 的 SPEC 解耦（adapter 层保持纯 HTTP）。每条 entry：

| 字段 | 类型 | 说明 |
|---|---|---|
| `vendor` | string | `deepseek` / `kimi` / `tongyi` / `zhipu` / `hunyuan` / `qianfan` / `coze` / `dreamina` / `doubao` |
| `loginUrl` | string | wizard 打开的首页 URL（与 SPEC.loginUrl 一致） |
| `cookieDomains` | string[] | `session.cookies.get` 查询用的 domain 列表 |
| `requiredCookies` | string[] | 至少存在 1 个就视为登录成功（验证步先这层 + validateCookie 再确认） |
| `postLoginPathHints` | string[] | URL path 含其一时强提示"登录已成功"（如 `/chat`、`/c/`） |
| `cookieMaxAgeHintDays` | number | 经验值，过此值 UI 提前 3 天预警 |
| `notes` | string | wizard 内显示的用户提示（用户名 vs 邮箱 vs 手机 / 是否需短信） |

Matrix（v0.1 用户社区可贡献 patch）：

| vendor | loginUrl | requiredCookies (至少 1) | maxAgeHintDays |
|---|---|---|---|
| deepseek | `https://chat.deepseek.com/` | `userToken`, `intercom-session-*` | 30 |
| kimi | `https://kimi.moonshot.cn/` | `access_token`, `refresh_token` | 30 |
| tongyi | `https://tongyi.aliyun.com/` | `XSRF-TOKEN`, `login_aliyunid` | 7 |
| zhipu | `https://chatglm.cn/` | `chatglm_token`, `cgsessionid` | 30 |
| hunyuan | `https://yuanbao.tencent.com/` | `hy_token`, `hy_user`, `uin` | 14 |
| qianfan | `https://yiyan.baidu.com/` | `BDUSS`, `BAIDUID`, `STOKEN` | 7 |
| coze | `https://www.coze.cn/` | `sessionid`, `passport_csrf_token`, `s_v_web_id` | 14 |
| dreamina | `https://jimeng.jianying.com/` | `sessionid`, `passport_csrf_token` | 14 |
| doubao | `https://www.doubao.com/chat/` | `sessionid`, `sid_guard` | 14 |

> 字段名是反向工程结果，**会变**。Phase 10.4 fixture pin 时把每家真实 cookie 截屏入 `__fixtures__/aichat-cookies/<vendor>.txt` 锁住一版；adapter manifest 加 `cookieSpecVersion` 字段，未来不兼容变更 bump。

## 4. IPC / WS 接口（新增 4 通道）

桌面 IPC + cc ui WS 双登记，命名遵循既有约定（colon vs dot）：

| 通道 | 入参 | 出参 | 双端可用 |
|---|---|---|---|
| `aichat-open-login` | `{ vendor, opts?: { reuseSession?: boolean } }` | `{ ok, sessionId, helpText, fallbackMode? }` — Electron 启 BrowserView 返回 sessionId；web-shell 返回 `fallbackMode: "paste"` + helpText | 桌面 A 级 / web-shell C 级 |
| `aichat-probe-cookies` | `{ vendor, sessionId? }` (web-shell 传 `{ vendor, cookieHeader }`) | `{ ok, cookies: Record<string, string>, foundRequired: string[], missing: string[] }` | 双端 |
| `aichat-register-vendor` | `{ vendor, cookies }` | `{ ok, accountId, validation: { ok, userId?, reason? } }` — 内部串联 `validateCookie` + 持久化 | 双端 |
| `aichat-rotate-login` | `{ vendor }` | `{ ok, sessionId }` — 清旧 partition cookie + 重开 BrowserView（web-shell 仅返回 helpText） | 桌面 A 级 / web-shell C 级 |

**已有但相关**：`aichat-list-accounts` / `aichat-unregister-vendor` / `aichat-validate-cookie` — Phase 10.2 已通过 `register-aichat`/`unregister-aichat`/`list-aichat-accounts` 暴露，本 Phase 沿用。

### 4.1 流式细节

`aichat-open-login` 在 Electron 端会推 2 个事件到 `aichat-login-progress.<sessionId>` 通道（与既有 `sync-adapter-stream` 同模式）：

| event.kind | payload | 说明 |
|---|---|---|
| `nav` | `{ url, title }` | 每次 BrowserView did-navigate 推一次（UI 实时显地址栏） |
| `login-detected` | `{ vendor, requiredFound: string[] }` | postLoginPathHints 命中 OR requiredCookies 至少 1 个出现 → 主动提示用户"可以关窗了" |

## 5. UI 流（Vue 组件 `AIChatWizard.vue`）

3 步走，全部嵌入 `PersonalDataHub.vue` 现有"配置抽屉"右侧 tab（与 Email / Alipay 同 widget 容器）：

### Step 1 — Vendor Picker

- 3×3 卡片网格（每家 logo + displayName + 状态）
- 状态标：`未连接` / `✓ 已连接(YYYY-MM-DD)` / `⚠ Cookie 即将过期(还剩 3 天)` / `🔴 失败`
- 点击 `+` 跳 Step 2；点击已连接卡片显 dropdown（同步 / 重登 / 注销）

### Step 2 — 鉴权

**桌面 Electron 分支**：

```
[address bar (read-only, 主进程推 nav event)]
┌─────────────────────────────────────────┐
│  BrowserView 嵌入 (640 × 800)           │
│  - 用户在这里登录                       │
│  - 主进程监听 cookie 出现               │
└─────────────────────────────────────────┘
[提示横幅: "登录后自动检测，可关闭窗口"]
[取消] [手动检测] [我已登录，继续]
```

**Web-Shell 分支**：

```
[外链按钮: "在浏览器打开 https://chat.deepseek.com/ →"]
[多行文本框: 粘贴 Cookie 字符串]
[助手: 如何获取 cookie？(展开 EditThisCookie / DevTools 指南)]
[取消] [验证]
```

### Step 3 — 校验 + 注册

- 调 `aichat-probe-cookies`（桌面）或解析粘贴串（web-shell）
- 显示 `foundRequired` / `missing`，缺关键 cookie 红字
- 调 `aichat-register-vendor` 内部串 `validateCookie` → ok 写 `aichat-accounts.json` → audit
- 成功 → Confetti + 跳回 Step 1，对应卡片变绿
- 失败 → 显示 `reason`（`UNEXPECTED_RESPONSE_SHAPE` / 网络 / cookie 不全） + 三按钮：`重试 probe` / `重新登录` / `转 fallback 粘贴`

## 6. 重登流（Cookie 过期）

后台 `AIChatHealthChecker` 每 6h 跑一遍（首次启动 30s 后跑 1 次）：

```
forEach registered vendor:
  result = vendor.SPEC.validateCookie({ httpClient: clientFor(vendor), session })
  if (!result.ok):
    mark accounts.json entry { lastHealth: { ok:false, reason, at } }
    push notification → PersonalDataHub.vue 卡片红点
```

UI 卡片点 `🔴 重登`：

- **桌面**：调 `aichat-rotate-login` → 主进程清 partition 该 vendor 全部 cookie → 重启 BrowserView → 走 Step 2/3
- **Web-shell**：弹粘贴框 → Step 3

## 7. 持久化

`%APPDATA%\chainlesschain-desktop-vue\.chainlesschain\hub\aichat-accounts.json`（已有，0600，本 Phase 仅扩字段）：

```json
{
  "deepseek": {
    "vendor": "deepseek",
    "registeredAt": 1747800000000,
    "cookies": { "userToken": "...", "intercom-session-xxx": "..." },
    "userId": "u_123",
    "displayName": "DeepSeek",
    "lastSyncAt": 1747900000000,
    "lastHealth": { "ok": true, "at": 1747900000000 },
    "cookieSpecVersion": 1
  }
}
```

`cookieSpecVersion` 字段：每次 `cookie-capture-spec.js` 不兼容变更 bump，旧 entry 升级前 health-check 主动 mark `ok:false, reason:"SPEC_VERSION_DOWNGRADE"`。

## 8. 测试矩阵

| 层 | 测试 | 数量 |
|---|---|---|
| 单元 — cookie-capture-spec | 9 家 spec 形状 / loginUrl host == cookieDomains 主域 / requiredCookies 非空 / 不存在重复 vendor | 8 测 |
| 单元 — wizard-controller | open / probe / register / rotate 4 happy + 4 error path + 1 vendor unknown | 9 测 |
| 集成 — IPC roundtrip | 4 新通道在 desktop-app-vue + cc ui WS 端到端 | 8 测（4×2 shell） |
| Vue 组件 — AIChatWizard | Step 1 卡片状态 / Step 2 两分支 / Step 3 成功失败 | 6 测 |
| 真账号 smoke | 每 vendor 一次 Wizard 真走通 + 1 次 health-check 过期模拟 | 9+1 |

`cookie-capture-spec.test.js` 在本 Phase 同步落地（与本 design 一起 commit）；其余测试随 wizard impl 推进。

## 9. Phase 拆分（工期估算）

| Sub-phase | 内容 | 工期 |
|---|---|---|
| 10.3.1 | cookie-capture-spec + 单测（**本 Phase 同步落地**） | 0.3d |
| 10.3.2 | wizard-controller 主进程 + 4 IPC + 单测 | 0.7d |
| 10.3.3 | AIChatWizard.vue + 集成进 PersonalDataHub.vue | 1d |
| 10.3.4 | cc ui WS 镜像 + 粘贴 fallback UI | 0.5d |
| 10.3.5 | HealthChecker + 红点 UI + 重登流 | 0.5d |
| 10.3.6 | 9 vendor 真账号 smoke + fixture pin | 1d |
| **总** | | **~4d** |

跟父文档 `Adapter_AIChat_History.md` §11 / `Personal_Data_Hub_Architecture.md` Phase 10 路线图工期一致。

## 10. Traps & 风险（10 个）

| # | Trap | 描述 | 缓解 |
|---|---|---|---|
| T1 | BrowserView partition 缓存污染 | 一个 vendor 留下的 cookie 影响另一个 vendor 登录 | 每 vendor 独立 partition `persist:aichat-<vendor>`；rotate 时 `session.clearStorageData` |
| T2 | 部分 vendor 用 HTTP-only cookie | DevTools 看得到但 `session.cookies.get` 拿不到 | Electron `session.cookies.get` 默认能取 HTTP-only（与 chromium DevTools 同权限）；Web-shell fallback 粘贴用户得开 `Application` 面板而非 `document.cookie` |
| T3 | 反风控识别 BrowserView UA | 厂商把 Electron UA 识为 bot 拒登 | 主进程在 webContents 设 chrome stable UA：`session.setUserAgent(navigator.userAgent.replace(/Electron\\/[\\d.]+ /, ""))` |
| T4 | postLoginPathHints 误判 | 用户登录前先访问 `/chat` 公开页 → 误推 `login-detected` | postLoginPathHints + requiredCookies 至少 1 个**同时**满足才推；用户也可手动按"我已登录" |
| T5 | 用户在 wizard 外开同名 vendor 登录 | 系统浏览器的 cookie ChainlessChain 看不到 | UI 引导走 fallback 粘贴；不静默失败 |
| T6 | Cookie 截短粘贴 | 用户从浏览器复制时遗漏部分 cookie | 解析时校验 `requiredCookies` 全有；缺则报"已识别 X / Y 关键 cookie" |
| T7 | 厂商 cookie 名变更 | spec 写的 `userToken` 改名 `user_token_v2` | adapter manifest `cookieSpecVersion` + health check 报 `SPEC_VERSION_MISMATCH` + 用户社区 PR 流程 |
| T8 | wizard 中途崩溃残留 partition | BrowserView crash / 用户强关进程 → partition cookie 留下 | 启动时 `aichat-wizard-controller.cleanupOrphanPartitions()` 扫所有 `persist:aichat-*` 不在 accounts.json 的 partition + 清除 |
| T9 | web-shell 粘贴的 cookie 含分号空格混乱 | 用户复制不规范 | 解析时容忍 `; ` / `;` / 多空格 + trim 每对 key=value |
| T10 | 已注册 vendor 重新走 wizard 覆盖 cookie | 用户重复点 + 也许卡在登录页 | Step 1 卡片改 "重新登录" 按钮（不是 +）；明确文案；不动 `registeredAt`，只更 `cookies` + `lastHealth` |

## 11. 跨端等价

| 接口 | 桌面 Electron | cc ui WS | Android | iOS |
|---|---|---|---|---|
| `aichat-open-login` | A 级 BrowserView | C 级 fallback 粘贴 | RPC 转桌面 BrowserView (Phase 14 远程操控) | 同 Android |
| `aichat-probe-cookies` | 主进程读 session | 服务端解析粘贴 | RPC | RPC |
| `aichat-register-vendor` | 全等价 | 全等价 | RPC | RPC |
| `aichat-rotate-login` | A 级 | C 级 | RPC | RPC |

移动端**永远不复刻** BrowserView — 通过 P2P 远程操控（per Phase 14 设计稿）转给桌面：

```
iPhone → P2P DC RPC "aichat.openLogin" → 桌面 mobile-bridge
  → 主进程开 BrowserView (桌面显示 / iPhone 仅看 nav 事件流)
  → 登录完成 cookies 落桌面 vault → iPhone 收 ok 返回
```

移动端 Phase 14 需新增 `personal-data-hub.aichat.*` 5 个 RPC 子项到 SeedRegistry（接 Phase 14.1 节奏，对 ~0.5d 数据层 + 0.5d UI）。

## 12. 演进路线

### v1（本设计）

- 9 家国产 AI 全 Wizard 化
- 桌面 A 级 / web-shell C 级 / 移动端经由 Phase 14 远程

### v2

- 海外厂商（ChatGPT / Claude / Gemini / Perplexity）扩 spec — 海外 cookie 鉴权门槛更高，需配合 OAuth2 时切轨
- 厂商 API token 鉴权（用户提供自己 API key），跳过 Wizard 全程
- Wizard 录屏录像选项（用户主动开启用于贡献社区 fixture）

### v3

- AI 厂商社区贡献 spec marketplace（spec 文件 + fixture + 测试用例）
- 自动检测 cookie spec 升级 + diff 推 PR

## 13. 参考

- 父文档 [`Personal_Data_Hub_Architecture.md`](./Personal_Data_Hub_Architecture.md) Phase 10
- 姐妹 [`Adapter_AIChat_History.md`](./Adapter_AIChat_History.md) §7 / §11 / §12 — 高层目标 + 单家 SPEC
- 姐妹 [`Personal_Data_Hub_Fixture_Pin_Protocol.md`](./Personal_Data_Hub_Fixture_Pin_Protocol.md) — 通用 fixture 落地协议（10.3.6 复用）
- 姐妹 [`Personal_Data_Hub_Phase_14_Mobile_Native_Entry.md`](./Personal_Data_Hub_Phase_14_Mobile_Native_Entry.md) — 移动端经由远程操控调用本 Wizard
- Electron [`session.cookies.get`](https://www.electronjs.org/docs/latest/api/cookies) / [`BrowserView`](https://www.electronjs.org/docs/latest/api/browser-view)
- Memory: `desktop_web_shell_strategy.md` — 桌面 vs cc ui 策略决策来源（A 起步，按需引入 B）

## 附录：规范章节补全（v5.0.3.108）

> 本文为设计文档。为对齐项目文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文细节。

### 1. 概述

见正文「0. 设计动机」。Phase 10.3 AIChat WebView 鉴权向导（`AIChatWizard.vue`）为 9 家 AI 厂商提供统一 cookie 鉴权 UI，配套 `Adapter_AIChat_History.md`（Phase 10）。

### 2. 核心特性

9 家 vendor cookie matrix；WebView 登录向导；4 新 IPC/WS 通道；重登流（cookie 过期）。

### 3. 系统架构

见正文「2. 顶层架构」；Electron BrowserView/session.cookies + Vue `AIChatWizard.vue` + IPC/WS。

### 4. 系统定位

PDH AI 对话采集（Phase 10）的**WebView 鉴权向导**。

### 5. 核心功能

见正文 3–6：Vendor Cookie Matrix（9 家）/ IPC/WS 4 通道 / UI 流 / 重登流。

### 6. 技术架构

Electron `session.cookies.get` + `BrowserView`；Vue `AIChatWizard.vue`；4 新 IPC/WS 通道。

### 7. 系统特点

桌面 A 起步、按需引入 cc ui B（见 memory `desktop_web_shell_strategy.md`）；移动端经远程操控调用本 Wizard。

### 8. 应用场景

用户为 9 家 AI app 完成 cookie 鉴权，供 Phase 10 采集对话史。

### 9. 竞品对比

统一向导 vs 各家独立登录（9 家一处搞定）。

### 10. 配置参考

见正文「3. Vendor Cookie Matrix（9 家）」与「4. IPC/WS 接口」。

### 11. 性能指标

WebView 登录交互时延；cookie 抓取即时。

### 12. 测试覆盖

IPC/WS 通道测试；fixture 落地复用 `Personal_Data_Hub_Fixture_Pin_Protocol.md`（10.3.6）。

### 13. 安全考虑

cookie 高敏感；WebView 桌面登录；落盘经 LocalVault 加密。

### 14. 故障排除

见正文「6. 重登流（Cookie 过期）」；vendor 登录页变更 → 更新 matrix。

### 15. 关键文件

`AIChatWizard.vue`；4 新 IPC/WS 通道；Electron BrowserView/session。

### 16. 使用示例

见正文「5. UI 流」向导步骤。

### 17. 相关文档

见正文父/姐妹文档：`Personal_Data_Hub_Architecture.md` Phase 10、`Adapter_AIChat_History.md`、`Personal_Data_Hub_Fixture_Pin_Protocol.md`、`Personal_Data_Hub_Phase_14_Mobile_Native_Entry.md`。
