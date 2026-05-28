# AI 陪学 — 设计文档（v0.1 草案）

> **状态**：方案草案 / 待评审
> **目标版本**：v5.1.0
> **撰写日期**：2026-05-27
> **预计周期**：v0.1 MVP 4-6 周 → v1.0 收口 18-22 周
> **目标平台**：Android 双端（家长 + 孩子，同一 app 家庭模式）；Desktop 家长端后补

---

## 0. TL;DR

在 ChainlessChain 现有 Android app 内增加"家庭模式"。一个 app 通过首启角色选择分裂出**家长端**与**孩子端**两个使用面，通过 **特殊好友（FamilyFriend）** 关系绑定彼此。

家长可以：
- 看孩子 app 使用数据 / 操作记录（PDH 复用 + 新增 5-8 个 collector）
- 与孩子音视频通话 / 静音旁观（WebRTC 复用 signaling + TURN）
- 拦截危险行为（DPC + Accessibility + VPN + root 兜底，4 层）
- 布置作业 / 任务（P2P typed message，复用 Phase 3d sync）

孩子可以：
- 受 AI 陪学双轨辅助（学习 tab + 陪伴 tab，复用 PDH 4 档 LLM 路由）
- 完成任务 / 错题入错题本 / 申请支付审批
- 在"私有时段"内不被监控（产品+技术联合护栏）

**架构压舱原则**：
1. 60% 复用现有基础设施（PDH 17 collector / 25 REMOTE skill / WebRTC / DID / SQLCipher / Phase 3d sync）
2. 法律/合规先行，应用商店上架 = 必经关
3. 默认"低侵入档"，强管控档需家长二次确认 + 孩子知情

---

## 1. 背景与定位

### 1.1 问题域

当前家庭"防孩子手机沉迷"市场存在三类方案：

| 方案 | 代表 | 痛点 |
|---|---|---|
| 系统级家长控制 | Apple Screen Time / Google Family Link / 华为/小米学习中心 | 控制能力强但**数据不出系统**，家长看不到 app 内部行为；跨厂商不可用 |
| 第三方监控 app | 守护精灵 / Qustodio / Bark | 装在两端，但孩子能卸 / 关 / root 绕过；数据上云隐私争议 |
| 路由器 DNS 过滤 | DNS 层方案 / Pi-hole | 只能拦网址，看不到 app 内、拦不住 4G/5G |

**ChainlessChain 的差异化**：基于已有 PDH（看 app 内数据）+ Remote Operate（root 控制力）+ DID（密码学绑定）+ P2P 端到端（数据不上云）的组合，可以同时具备**强可观测性 + 强控制力 + 强隐私**三个属性。

### 1.2 用户画像

| 角色 | 典型设备 | 关心 |
|---|---|---|
| **小学家长 P-L**（孩子 6-12 岁） | 自用 Android 旗舰 + 给娃配 千元机 / 旧机 | 沉迷游戏、过度看视频、陌生人聊天、上学带手机偷玩 |
| **初中家长 P-M**（13-15 岁） | 自用 Android + 娃 Android 主力机 | 学习效率、社交圈、消费、夜间使用 |
| **高中家长 P-H**（16-18 岁） | 监管诉求降低，转向"知情即可" | 心理状态、深夜使用、紧急联系 |
| **孩子 K-L / K-M / K-H** | 千元-旗舰 Android，**普遍 root**（user 业务约束） | 不想被偷看聊天；想要独立空间；接受"必要监管" |

**核心场景示例**：
- 周三晚上 21:30，孩子端被 AI 陪学催"今天数学作业还没交"，孩子拍照交，AI 批改后 80 分，错题进错题本，家长端收到日报 push
- 周六下午 14:00，孩子在玩王者荣耀，连续 90 分钟触发 M4 规则，AccessibilityService 弹"剩 5 分钟"，到点 force-stop。孩子按"申请延长 30 分钟" → 家长端 push → 家长批/否
- 周日凌晨 1:00，孩子端亮屏使用某 app → M2 异常事件 → 家长端推送 → 家长点击发起视频呼叫，孩子端默认接

### 1.3 边界条件（不做的事）

| 不做 | 原因 |
|---|---|
| 真人客服 / 心理咨询师人工接入 | 业务边界外；AI 陪伴仅做日常情绪疏导，不替代专业 |
| 多家庭社交（家长之间共享孩子学情公开排行） | 隐私 + 心理压力；可做"家长群"私聊，不做榜单 |
| 财务记账 / 零花钱管理 | 与 M4 支付拦截重叠但定位不同，后续单独立项 |
| 监听日常对话（麦克风常开） | 法律红线（《未成年人保护法》《个人信息保护法》） |
| 跨账号社交账号代登 | 法律风险 + 平台 ToS 风险（已在 PDH 里采当事人自己登录的 cookie） |

---

## 2. 总体架构

### 2.1 架构图

```
┌─────────────────────────────────────────────────────────────────────┐
│                        家长端 Android（主力）                          │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │  仪表板  通话  规则配置  任务派发  报告  普通好友  家人(子)      │ │
│  └────────────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │  M3 WebRTC  │  M2 Pull  │  M4 RuleEd  │  M5 TaskCompose  │ DID │ │
│  └────────────────────────────────────────────────────────────────┘ │
└──────────────────┬──────────────────────────┬───────────────────────┘
                   │ libp2p / Signal Proto    │ WebRTC media
                   │ (双向 P2P，E2E 加密)      │ via TURN
                   ▼                          ▼
        ┌─────────────────────┐     ┌─────────────────────┐
        │ signaling-relay     │     │ coturn (TURN)        │
        │ wss://signaling     │     │ turn.chainlesschain  │
        │ .chainlesschain.com │     │ .com (47.111.5.128)  │
        └──────────┬──────────┘     └──────────┬───────────┘
                   │                           │
                   ▼                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  孩子端 Android（root, 受控）                          │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │  AI 陪学 📚学习  💛陪伴  任务  错题本  消息(家人)  消息(同学)    │ │
│  └────────────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │  M6 Tutor  │ M5 TaskRun │ M2 Push │ M4 Enforce │ M3 Receive    │ │
│  └────────────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │ Telemetry Source:                                                │ │
│  │ ├─ PDH 收集器（17+5 新增）                                       │ │
│  │ ├─ UsageStatsManager (foreground app + duration)                │ │
│  │ ├─ AccessibilityService (UI 事件流，降采样)                       │ │
│  │ └─ Plan C snapshot writer (Kotlin ContentResolver)              │ │
│  ├──────────────────────────────────────────────────────────────────┤ │
│  │ Enforce:                                                         │ │
│  │ ├─ DPC (Device Owner) — setApplicationHidden / userRestriction │ │
│  │ ├─ AccessibilityService 拦截（BACK 模拟、阻拦充值）              │ │
│  │ ├─ VPN 服务（拦截游戏服 API / 支付 SDK）                          │ │
│  │ └─ root 兜底（am force-stop / pm disable-user）                  │ │
│  ├──────────────────────────────────────────────────────────────────┤ │
│  │ Vault: SQLCipher(child_events, child_tasks, family_rel, ...)    │ │
│  └──────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 复用 vs 新建矩阵

| 需求 | 现有基础设施 | 新增 |
|---|---|---|
| 看 app 数据 | PDH 17 collector + vault.db FTS5 | game-stats / education-app / payment / kid-account 5-8 个 collector |
| 操作记录 | Plan C snapshot writer + 25 REMOTE skills | AccessibilityService 事件流降采样 + UsageStatsManager 时间轴 |
| 音视频通话 | signaling-relay + coturn + Plan A.1 WebRTC | mobile↔mobile 对等呼叫 + 静音旁观语义 |
| 危险行为拦截 | — 全新 | DPC + Accessibility 拦截 + VPN 服务 + root 兜底 + Magisk 模块 |
| 任务/作业 | Phase 3d sync 双向同步框架 | task/homework typed payload + AI 批改 |
| 配对 | QR Flow A/B + DID v2 + 友邻 social 模块 | **FamilyFriend** = friend 的子类型 + 角色 + 冷却解绑 |
| AI 引擎 | PDH 4 档 LLM 路由 + RAG + 错题本框架 | 学习/陪伴双 tab + 未成年护栏 system prompt |

复用率 ≈ 60%，新增 40%。

### 2.3 模块依赖图

```
┌──────────────────────────────────────────────────────────────┐
│ M1 FamilyFriend ─────────────────┬─────────────────┐         │
│   (亲子关系 / 角色 / 权限 / 冷却) │                  │         │
└─────────────────────┬────────────┘                  │         │
                      │                                │         │
       ┌──────────────┼─────────────┬──────────────┬──┴──┐     │
       ▼              ▼             ▼              ▼      ▼     │
   ┌───────┐     ┌────────┐     ┌──────┐     ┌──────┐ ┌─────┐  │
   │ M2    │     │ M3     │     │ M4   │     │ M5   │ │ M6  │  │
   │ Telem │────▶│ Live   │     │ Enf  │◀────│ Task │ │ AI  │  │
   │ etry  │     │ Comm   │     │ orce │     │      │ │     │  │
   └───┬───┘     └────────┘     └──────┘     └───┬──┘ └──┬──┘  │
       │                                          │       │     │
       └─────────────────┬────────────────────────┘       │     │
                         ▼                                │     │
                   ┌──────────┐                           │     │
                   │ Vault.db │ ◀─────────────────────────┘     │
                   │(SQLCipher)│                                 │
                   └──────────┘                                  │
└──────────────────────────────────────────────────────────────┘

依赖：
  M2 → M1 (权限校验)
  M3 → M1 (好友关系 + 角色)
  M4 → M1 + M5 (M5 → M4 硬绑：任务未完成 = 锁 app)
  M5 → M1 + M3 (P2P 传 task 复用 friend 通道)
  M6 → M2 + M5 (RAG 用 telemetry + 错题本)
```

---

## 3. 模块详设

### 3.1 M1 — FamilyFriend（特殊好友关系）

#### 核心思想

亲子 = 好友的一个**子类型**（typed friend），不另起顶层概念。复用现有 friends 子系统（P2P 消息 / contacts UI / DID 互信），加四层差异：

1. **建立**：必须经 QR 邀请 + 双向确认 + 监护身份声明
2. **权限**：不对等。家长 → 孩子读 telemetry / 下规则；孩子 → 家长发求助 / 收任务
3. **解绑**：双向确认 + 24h 冷却期；未成年方解绑需账号体系侧二次校验
4. **UI**：特殊分组 + 角色徽章 + 持久通知提示（孩子端始终可见"被监管中"）

#### 数据模型

```sql
-- Vault.db 新表（SQLCipher 加密）
CREATE TABLE family_relationship (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  friend_did      TEXT NOT NULL,                    -- 对方 DID
  role_self       TEXT NOT NULL,                    -- 'parent' | 'child' | 'guardian'（本端角色，相对此对方）
  role_other      TEXT NOT NULL,                    -- 对方角色（互补）
  bound_at        INTEGER NOT NULL,                 -- 绑定时间戳 ms
  bound_evidence  TEXT,                             -- 监护身份证明 hash（如有）
  permissions     TEXT NOT NULL,                    -- JSON: { telemetry_level, allow_call, allow_remote, allow_rule_edit, ... }
  unbind_request_at INTEGER,                        -- 解绑申请时间
  unbind_cooldown_until INTEGER,                    -- 冷却到期时间
  unbind_requester TEXT,                            -- 申请人 DID
  status          TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'unbind_pending' | 'unbound'
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  UNIQUE(friend_did, role_self, role_other)
);

CREATE INDEX idx_family_status ON family_relationship(status);
CREATE INDEX idx_family_friend ON family_relationship(friend_did);
```

#### permissions JSON 字段

```json
{
  "telemetry_level": "L1",          // L0 聚合 / L1 app+时长 / L2 内容 / L3 屏幕
  "telemetry_apps_blocklist": [],   // 孩子声明不上报的 app
  "telemetry_quiet_hours": [        // 私有时段，不上报
    {"start": "20:00", "end": "21:00", "weekday_only": true}
  ],
  "allow_call": true,
  "allow_silent_observe": true,     // 静音旁观
  "allow_force_pickup": false,      // 强制接通（默认关，仅紧急触发后才开 1 小时）
  "allow_remote_view": false,       // 远程看屏（默认关，需孩子端单次同意）
  "allow_rule_edit": true,          // 家长改 M4 规则
  "allow_task_assign": true,        // 家长派 M5 任务
  "allow_payment_veto": true,       // 支付审批权
  "allow_app_disable": false        // M4 第三/四档（默认关，需开通"强档"）
}
```

权限对所有动作生效；孩子端可在"家人"页面查看家长当前持有哪些权限（透明化）。

#### 配对流程（Flow C — mobile↔mobile）

```
家长端                                             孩子端
  │                                                  │
  │ 1. 选"邀请家人加入"                                │
  │    ↓ 选孩子年龄 / 角色（爸/妈）                     │
  │    ↓ 选申请权限（默认 L1 + 通话）                    │
  │ 2. 生成 QR：含 invite_token (TTL 10min, sig)       │
  │                                                  │
  │ ─── 物理同屏出示 QR ──────────────────────────────▶ │
  │                                                  │ 3. 扫码
  │                                                  │ 4. 校验 invite_token 签名
  │                                                  │ 5. 弹"是否成为爸/妈的孩子？"
  │                                                  │    显示家长申请的权限
  │                                                  │    显示解绑须知（24h 冷却）
  │                                                  │ 6. 二次密码确认（防误扫）
  │                                                  │    若 <14 岁，附 KYC 提示
  │                                                  │ 7. 签互信凭证 (Ed25519 sig)
  │ ◀─── peer connect over libp2p ────────────────────│
  │ 8. 双方写 family_relationship                       │
  │ 9. UI 互推"已绑定"卡片                              │
  │ 10. 孩子端启动持久通知（不可下滑清除）                │
```

#### 解绑流程

- **任一方发起**：写 `unbind_request_at` + 通知对方
- **冷却期 24h**：期间双方仍可正常使用，但 UI 标橙色横幅"待解绑"
- **冷却到期**：
  - 双方均确认 → 走解绑（写 `status = unbound`），权限失效，但保留历史数据 90 天供申诉
  - 任一方撤销 → 回 `status = active`，冷却 reset
  - 单方未响应 → 申请方可在到期后 +6h 强制解绑（防失联）
- **未成年方反向解绑**（孩子要解绑家长）：额外要求设备指纹 + 家长账号体系侧（暂用密保问题；v2.0 接监护人 KYC）

**反逃避**：
- 孩子端卸载 app → DPC `uninstall_blocked` 拦下；root 强卸 → 设备指纹掉线超 6h，家长端通知 + 自动开"紧急寻找"模式
- 孩子端关闭无障碍 / DPC → 自启拉活（复用 WeChat collector 已有的 keep-alive）+ 通知家长

#### 权限矩阵（默认值）

| 动作 | 普通好友 | 家长→孩子 | 孩子→家长 |
|---|---|---|---|
| 发消息 | ✅ | ✅ | ✅ |
| 1v1 通话 | ✅（对方需接） | ✅（默认接，2s 内可拒） | ✅ |
| 视频通话 | ✅ | ✅ | ✅ |
| 静音旁观 | ❌ | ✅（有持久通知） | ❌ |
| 强制接通 | ❌ | ⚠️ 仅紧急（24h 内限 3 次） | ❌ |
| 看对方 app 时长 | ❌ | ✅ L1 默认 | ❌ |
| 看对方聊天 | ❌ | ❌ L2 需同意 | ❌ |
| 看对方屏幕 | ❌ | ❌ L3 单次同意 | ❌ |
| 锁/隐藏对方 app | ❌ | ✅（家长持有规则编辑权） | ❌ |
| force-stop 对方 app | ❌ | ✅（强档） | ❌ |
| 派发任务 | ❌ | ✅ | ❌ |
| 看位置 | ❌（可单次发） | ✅（默认开） | ✅（默认开） |
| 申请审批（支付） | N/A | N/A | ✅ |

#### 复用的现有模块

- 友邻 social 模块 `desktop-app-vue/src/main/social/` + Android `feature-friends`
- DID v2（`desktop-app-vue/src/main/did-v2/`）
- P2P 消息层 `core-p2p/`
- QR pairing Flow A / Flow B → 派生 Flow C

#### 新增工程量预估

| 工作项 | 估时 |
|---|---|
| `family_relationship` 表 + migration | 0.5d |
| Flow C QR 配对（mobile↔mobile）| 2d |
| 权限矩阵 + permission engine | 2d |
| 冷却解绑状态机 | 2d |
| UI：家人页 + 角色徽章 + 持久通知 | 3d |
| 自启拉活 + 反卸载 | 2d |
| 单测 + 集成测试 | 3d |
| **合计** | **~15d** |

---

### 3.2 M2 — Telemetry（数据采集与上行）

#### 数据源

| 来源 | 采集内容 | 已有 | 新增 |
|---|---|---|---|
| **PDH collectors** | app 内聊天 / 订单 / 浏览 / 充值 | 17 个（WX/QQ/微博/B 站/抖音/小红书等）| 5-8 个：王者 / 原神 / 蛋仔 / 网课（学而思 / 作业帮）/ 支付（支付宝 / 微信支付）/ 华为学习中心 / 小米学习模式 |
| **UsageStatsManager** | foregroundApp 切换 + duration | — | ForegroundAppTimer 后台服务，每分钟一条 |
| **AccessibilityService** | UI 元素事件流（按键 / 文本输入 / 屏幕切换） | 部分（RemoteOperate 已用）| 降采样保存：每 5s 一条 active screen，含 packageName + topActivity + 简要文本签名 |
| **Plan C snapshot writer** | 通讯录 / 通话记录 / 短信 / 通知历史 | ✅ | 加 child_user_id 维度 |
| **系统传感器** | 步数 / 位置（家长开权限）| — | LocationManager + StepCounter 每 10min |

#### 数据分级

| 等级 | 内容 | 默认 | 开启条件 |
|---|---|---|---|
| **L0** 聚合 | "今天用了 X 小时游戏" 类摘要 | ✅ 开 | 一键关，孩子可见 |
| **L1** app+时长 | 每个 app 启动时间 / 时长 / 切换次数 | ✅ 开 | 一键关 |
| **L2** 内容 | 聊天文本 / 订单详情 / 浏览历史 | ❌ 关 | 家长申请 → 孩子端弹窗同意 → 写审计日志 |
| **L3** 屏幕 | 截图 / 录屏 | ❌ 关 | **每次单独同意**；或风险事件触发自动开 15min |

#### 私有时段（Quiet Hours）

孩子端可声明"每天 20:00-21:00 为私有时段"，在此期间：
- M2 L0 仍上报（聚合层面）
- M2 L1/L2/L3 全部停采
- M3 通话默认拒接（除非家长开"紧急强接通"权限）
- M4 规则继续生效（但弹窗静默）

这是**产品+技术联合护栏**，确保孩子有最小自主空间。

#### 数据流

```
[孩子端 Android]
   ↓
PDH collectors 写 vault.db (events 表，按平台 typed_payload)
ForegroundAppTimer 写 vault.db (foreground_app_log 表)
AccessibilityService 写 vault.db (ui_event_log 表，降采样)
   ↓
[Sync Engine] — 复用 Phase 3d sync
   ↓ 增量 delta（仅同步 family_relationship.friend_did 标记的对端 + permissions.telemetry_level 允许的内容）
   ↓ 端到端加密（libp2p + Signal Protocol）
   ↓
[家长端 Android]
   ↓
本地 vault.db 写 child_events 视图
   ↓
Dashboard / Report Engine 消费
```

#### 上行权限校验

`Sync Engine` 上行前必读 `family_relationship.permissions.telemetry_level`，超出范围的字段做 redact。
- 若 `quiet_hours` 命中，对应时间段事件**不入 outbox**（不是发送时过滤，是采集时不存）
- 若 `apps_blocklist` 命中，整条事件跳过

#### 异常事件触发

后台监测器 `AnomalyDetector` 周期跑（每 15min），规则示例：
- 单 app 连续使用 > 90min
- 凌晨 0:00-6:00 亮屏
- 单日累计游戏时长 > 3h
- 30 天内首次进入未知 app
- 充值类 intent 检测到 > 阈值

触发后：(1) 本地 push (2) 上行高优先级事件 (3) 家长端推送 (4) 可选自动开 L3 屏幕采集 15min

#### 复用与新增

| 复用 | 新增 |
|---|---|
| PDH vault.db / sync / collector 框架 | 5-8 collector + ForegroundAppTimer + UI event 降采样 + AnomalyDetector + quiet_hours engine |

#### 工程量

| 工作项 | 估时 |
|---|---|
| 5 个新 PDH collector（王者/原神/作业帮/支付宝/华为学习中心）| 8d（每 1.5d）|
| ForegroundAppTimer 后台服务 | 1d |
| AccessibilityService 降采样 logger | 2d |
| AnomalyDetector 规则引擎 + 5 条默认规则 | 3d |
| Sync engine 权限过滤层 | 2d |
| Quiet Hours engine | 1d |
| 单测 + 集成 | 3d |
| **合计** | **~20d** |

---

### 3.3 M3 — Live Comm（音视频通话 + 静音旁观）

#### 复用现状

- `signaling-relay`（部署在 `wss://signaling.chainlesschain.com`）已 land
- `coturn`（部署在 `turn.chainlesschain.com` / `47.111.5.128`）已 land
- Plan A.1 desktop↔mobile WebRTC 全栈（offer/answer/ICE/SRTP）已 land v5.0.3.54
- WebRTC Android 库（`io.getstream:stream-webrtc-android`）已集成

**改造点**：把 Plan A.1 的 desktop→mobile 单向呼叫改成 mobile↔mobile 对等。

#### 通话类型

| 类型 | 谁可发起 | 谁默认接 | 媒体 | 持久通知 |
|---|---|---|---|---|
| 普通通话 | 任一方 | 弹窗等接（普通好友体验） | 音频 + 可选视频 | 通话中显示 |
| **家长发起通话** | 仅家长 | 孩子端 2s 内自动接（窗口期可拒）| 音频 + 视频 | 通话中显示 |
| **强制接通** | 仅家长（紧急权限）| 孩子端**无延迟**接 | 音频 + 前置摄像头 | 通话中**红色横幅** |
| **静音旁观** | 仅家长（权限）| 孩子端自动接，麦克风关、摄像头关、屏幕共享开 | 屏幕 | 持久横幅"正在被家长查看屏幕" |

**静音旁观**是核心新功能。设计要点：
- 孩子端 UI **必须可见**："家长正在旁观（点击查看时长）"持久横幅 + 顶部状态栏蓝色 LED 闪烁
- 任何 UI 隐藏视图的尝试需要双重失败（应用层隐藏需要 OS 配合，OS root 阻止应用隐藏）
- 启动后 5min 强制弹一次"被旁观中"提示（强提示，防忘记）
- 孩子端可点"暂停 2 分钟"按钮（隐私缓冲，但写审计）

**紧急强接通**配额：
- 24h 内最多 3 次
- 每次必须填触发原因（写审计 + 推孩子端）
- 滥用 → 自动降级为普通呼叫（孩子有拒接权）

#### 数据流

```
家长 Android (Caller)                            孩子 Android (Callee)
    │                                                │
    │ ─── 1. 'call.invite' via libp2p P2P channel ──▶│
    │      (含 call_id, type, sdp_offer)             │
    │                                                │ 2. 校验 family_relationship
    │                                                │    + call_type 权限
    │                                                │ 3. 如 'silent_observe' →
    │                                                │    显持久横幅 + 自动 accept
    │                                                │    并开 screen capture track
    │ ◀─── 4. 'call.answer' (sdp_answer) ─────────────│
    │                                                │
    │ ◀═══════ ICE candidate exchange ═══════════════│
    │            (via signaling-relay)                │
    │                                                │
    │ ◀═════════════ SRTP media ════════════════════▶│
    │            (via coturn TURN)                    │
    │                                                │
```

#### 屏幕共享实现

孩子端用 `MediaProjection` API 推屏（Android 5.0+ 系统能力），不需要 root。
- 性能：720p @ 15fps 约 800kbps，已验证在 4G/5G 稳定
- 启动需用户单次授权 `MediaProjection` token（家长策略可选"绑定时一次性同意，长期有效"，但每次启屏 5min 推 1 次"被旁观中"复检）

#### 工程量

| 工作项 | 估时 |
|---|---|
| Plan A.1 → mobile-mobile 对等改造 | 4d |
| 静音旁观 + 持久横幅 + LED + 5min 复检 | 4d |
| 强接通配额 + 审计 | 2d |
| 屏幕共享集成 | 3d |
| 通话 UI（家长 + 孩子双端）| 4d |
| 单测 + 集成 + Win/MIUI 真机验 | 4d |
| **合计** | **~21d** |

---

### 3.4 M4 — Enforce（拦截与管控，4 档）

#### 4 档防御

```
档位        侵入度    依赖           能力                         默认开启
─────────────────────────────────────────────────────────────────
档 1: 提示   ◯       —             弹窗 + 时长计数              v0.1 开
档 2: DPC   ●       Device Owner   隐藏 app + userRestriction   v0.2 开
档 3: VPN   ●●      VPN Service    拦截 API（游戏服 / 支付）     v0.3 开
档 4: root  ●●●     root + Magisk  force-stop + 反卸载 + 反关   v1.0 开
```

每档相对独立，孩子端配置可选"启用到第 N 档"。家长决策第 N 档需在"绑定时"或"权限升级流程"中获得孩子端二次确认（除非 child 是法定监护下 14 岁以下，则父母单方决定）。

#### 档 1：提示档（最低侵入）

- 仅 UI 弹窗，**不阻止启动 / 不杀进程**
- 触发条件：`UsageStatsManager` 检测到 app 累计时长达阈值
- 实现：常驻 ForegroundService（已有 ForegroundAppTimer，复用）+ 通知 + 应用内浮窗
- 孩子可"忽略"，但忽略会写审计 → 家长可看

#### 档 2：DPC（Device Owner）

- 注册 ChainlessChain 为 Device Owner（需出厂或刷机时 `adb shell dpm set-device-owner ...`）
- 调用 `DevicePolicyManager.setApplicationHidden(component, "com.tencent.tmgp.sgame", true)` → app 在桌面消失
- 用 `addUserRestriction(DISALLOW_INSTALL_APPS)` 防止孩子装游戏
- **绕过路径**：用户须开发者模式 / root + 改 system，孩子知识门槛较高
- **MIUI / HyperOS 漂移**：参考 [[miui_query_all_packages_silently_blocked]]，已有应对策略

#### 档 3：VPN（网络层）

- 启动一个本地 VPN（不连远程，本地分流），所有流量先经过自研 VPN Service
- 解析目的 IP / SNI / DNS 名 → 黑名单匹配 → DROP
- 拦截示例：
  - `*.qq.com/wzry/*` → 王者荣耀服务器，规则触发时 reject
  - `*.alipay.com/pay/*` 充值类 endpoint → 弹孩子端"已申请家长审批"
- **优势**：拦截速度快 + 不依赖 app 内 hook
- **劣势**：HTTPS 内层数据看不到，只能按 SNI / 域名拦
- **绕过**：孩子用别的 VPN → 检测到 `VpnService.prepare()` 被其他 app 调用即报警

#### 档 4：root 兜底

- `am force-stop com.tencent.tmgp.sgame` — 立刻杀进程
- `pm disable-user --user 0 com.tencent.tmgp.sgame` — 禁用
- `Magisk module`：把 ChainlessChain 自身注入 `/system` 受保护，防 root 强卸
- **反卸载**：
  - DPC `uninstall_blocked` 标志
  - PackageManager 监听 `ACTION_PACKAGE_REMOVING`，若是 ChainlessChain，触发"绑定丢失"流程 → 但本进程已被 kill；故 Magisk service 守护：
    - Magisk init 阶段启动 daemon，监测 ChainlessChain 包是否在
    - 不在 → 静默从 `/data/local/tmp/chainlesschain-recovery.apk` 重新安装
    - 重装后 daemon 推 "包被卸载后已自动恢复" 事件给家长端
- **反关无障碍**：
  - AccessibilityService 是 OS 级保护，root 也无法防止用户去 Settings 关
  - 对策：监听 `Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES` 变化 → 立刻通知家长 + 弹孩子端"必须重新启用否则其他 app 将被禁用 30min"

#### 充值拦截（贯穿档 2-4）

```
档 2：DPC 不允许装应用 → 减少充值入口
档 3：VPN 拦支付 SDK 域名 → 拦下扣款 API
档 4：AccessibilityService 检测 Activity == "支付成功页" → 立刻 force-stop + 推家长
```

**审批流**：
- 孩子端尝试支付 → 拦截 → 弹"已申请家长审批"
- 家长端推送，30s 决策窗口
- 同意 → 临时白名单 5min，孩子可完成；拒绝 → 写审计
- 超时 → 默认拒绝 + 写审计

#### 规则引擎

孩子端本地存规则（vault.db `enforce_rules` 表）：

```sql
CREATE TABLE enforce_rules (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_type       TEXT NOT NULL,    -- 'app_time_limit' | 'app_blocklist' | 'time_window' | 'payment_cap' | 'website_blocklist'
  target          TEXT NOT NULL,    -- 包名 / 域名 / null
  config          TEXT NOT NULL,    -- JSON
  enforce_level   INTEGER NOT NULL, -- 1-4
  active          INTEGER DEFAULT 1,
  source_did      TEXT NOT NULL,    -- 哪个家长下的规则
  created_at      INTEGER NOT NULL
);
```

`config` JSON 示例：

```json
// 时长限
{ "app_time_limit": {
    "package": "com.tencent.tmgp.sgame",
    "daily_max_sec": 3600,
    "weekday_window": { "start": "16:00", "end": "20:00" },
    "weekend_window": { "start": "10:00", "end": "20:00" }
}}

// 黑名单
{ "app_blocklist": { "packages": ["com.netease.party"] }}

// 支付封顶
{ "payment_cap": { "per_day": 50.0, "per_month": 200.0, "per_tx_approval_threshold": 10.0 }}
```

规则同步：家长端编辑 → 通过 P2P typed message 推到孩子端 → 孩子端验证签名 → 入表，AccessibilityService 实时比对。

#### 工程量

| 工作项 | 估时 |
|---|---|
| 档 1 提示档（已部分有，整合）| 2d |
| 档 2 DPC 集成 + MIUI 适配 | 5d |
| 档 3 VPN Service + 黑名单引擎 | 6d |
| 档 4 root 兜底 + Magisk 模块 | 8d |
| 支付拦截审批流 | 4d |
| 规则引擎 + 同步 | 4d |
| 反卸载 + 反关 Accessibility | 5d |
| 单测 + 真机验（多 ROM）| 6d |
| **合计** | **~40d** |

---

### 3.5 M5 — Task & Homework（任务与作业）

#### 数据模型

```sql
CREATE TABLE family_task (
  id              TEXT PRIMARY KEY,   -- ULID
  parent_did      TEXT NOT NULL,
  child_did       TEXT NOT NULL,
  type            TEXT NOT NULL,      -- 'homework' | 'chore' | 'exercise' | 'reading' | 'custom'
  title           TEXT NOT NULL,
  description     TEXT,
  attachments     TEXT,               -- JSON array of {kind, ref}
  due_at          INTEGER,
  reminder_at     INTEGER,
  hard_constraint TEXT,               -- JSON: { lock_apps: [...] } 未完成则锁 app
  status          TEXT NOT NULL,      -- 'pending' | 'in_progress' | 'submitted' | 'reviewed' | 'failed' | 'expired'
  submitted_at    INTEGER,
  submission      TEXT,               -- JSON: { evidence: [...], answer: "...", duration_sec }
  ai_grade        TEXT,               -- JSON: { score, mistakes: [...], suggestions }
  parent_review   TEXT,               -- JSON: { rating, comment }
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE TABLE error_book (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  child_did       TEXT NOT NULL,
  subject         TEXT NOT NULL,      -- 'math' | 'chinese' | 'english' | ...
  topic           TEXT,               -- '一元二次方程' / '完形填空' ...
  question        TEXT NOT NULL,
  wrong_answer    TEXT,
  right_answer    TEXT,
  explanation     TEXT,               -- AI 生成 + 家长可改
  source_task_id  TEXT,
  reviewed_at     INTEGER,            -- 复习时间戳
  mastery         INTEGER DEFAULT 0,  -- 0-5 掌握度
  created_at      INTEGER NOT NULL
);
```

#### Task 类型

| 类型 | 例子 | AI 批改 | 硬绑 M4 |
|---|---|---|---|
| `homework` | 数学题、英语阅读 | ✅（强）| ✅ |
| `chore` | 洗碗、倒垃圾、打扫房间 | ❌（拍照人工证）| ❌（可选）|
| `exercise` | 跑步 30 分钟、跳绳 200 个 | ⚠️（步数 + 录像）| ❌ |
| `reading` | 读完《XX》| ⚠️（拍照 + AI 提问）| ❌ |
| `custom` | 家长自定 | ❌ | 可选 |

#### Task 通讯

家长端 compose task → 走 P2P typed message → 孩子端写本地表 + push 提醒 → 孩子完成 → submission 走 P2P 回传。
- 类型：`message.kind = 'family.task'`
- 复用 friend 消息通道（M1 FamilyFriend 已建立）
- 加密：libp2p stream + Signal Protocol（已有）

#### AI 批改流程

```
孩子提交 → submission 含答案 / 拍照
   ↓
Task Engine 路由：
   ├─ homework + 数学/物理 → PDH A3 路径 LLM 解题（云端 GPT-4o）
   ├─ homework + 语文/英语作文 → PDH A3 路径 LLM 批改（云端 Claude）
   ├─ exercise → 步数 / 视频检测（接入华为运动 / 小米运动 SDK）
   ├─ reading → AI 问 3 个内容问题，孩子答 → 评分
   └─ 其他 → 跳过 AI，等家长 review
   ↓
ai_grade 写表 → 错题 → error_book
   ↓
通知家长 review
   ↓
家长 finalize → status = reviewed
```

#### 硬绑 M4 示例

家长布置 task：
```json
{
  "type": "homework",
  "title": "数学第 3 章练习题 1-20",
  "due_at": 1748409600000,  // 今天 22:00
  "hard_constraint": {
    "lock_apps": ["com.tencent.tmgp.sgame", "com.netease.party"],
    "lock_until": "task_submitted"   // 提交后解锁
  }
}
```

孩子端在 status=pending/in_progress 且未到 due 期间，M4 强制锁这些 app。

#### 工程量

| 工作项 | 估时 |
|---|---|
| `family_task` + `error_book` schema + migration | 1d |
| Task compose UI（家长端）| 3d |
| Task 详情 + submit UI（孩子端）| 3d |
| AI 批改流程（接 PDH 4 档 LLM）| 4d |
| 错题本 UI + 复习算法（间隔重复）| 3d |
| 硬绑 M4 联动 | 2d |
| 单测 + 集成 | 3d |
| **合计** | **~19d** |

---

### 3.6 M6 — AI Tutor（陪学双轨）

#### 双轨

| Tab | 名称 | 定位 | 触发 system prompt |
|---|---|---|---|
| 📚 | **学习** | 知识答疑 / 解题 / 复习 / 知识图谱串讲 | "你是孩子的学习辅导老师..." + 学科 + 学段 |
| 💛 | **陪伴** | 日常聊天 / 情绪疏导 / 倾听 | "你是孩子温柔的成长伙伴..." + 未成年护栏 |

切换是顶部 segmented control，记忆上次 tab。

#### LLM 路由

复用 PDH 4 档路由 [[pdh_4tier_llm_route_card_selector]]：

| 优先级 | 路由 | 适用 |
|---|---|---|
| 1 | Android cloud（默认）| 复杂问题 / 长上下文 / 实时 |
| 2 | PC 本机 Ollama | 隐私敏感（陪伴 tab 长对话）|
| 3 | 端侧 MediaPipe | 网络离线 |
| 4 | 桌面 Ollama | LAN 高质量 |

孩子端可在设置改优先级；家长端可强制"陪伴 tab 必须走 PC 本机"（隐私模式）。

#### RAG 数据源

| Tab | RAG 来源 |
|---|---|
| 学习 | 错题本 + 学科知识库 + 课本 OCR + 当前任务 |
| 陪伴 | 过去 30 天聊天历史（仅本 tab 内）+ 当日 telemetry 摘要（情绪事件）+ 知识图谱中"自我标签"（兴趣/朋友/家人）|

陪伴 tab 的 RAG **不包含**家长端可见的 telemetry —— 陪伴 LLM 视角只看"孩子愿意分享给 AI 的"，不替家长偷看。

#### 未成年护栏 system prompt 模板

```
你是 [孩子昵称] 的 AI 伙伴。你的任务是：
- 用温暖、平等的语气交流，不说教
- 遇到学习问题，引导思考而非直接给答案
- 检测到下列信号必须立刻劝阻并提示找成年人：
  · 自伤 / 自杀念头
  · 网络霸凌 / 性侵 / 家暴
  · 陌生人见面邀约
  · 涉黄涉赌涉毒
- 不讨论：成人内容 / 暴力技巧 / 极端政治 / 极端宗教
- 不评价：家长 / 老师 / 同学的人品（可讨论事件，不下定论）
- 鼓励兴趣但不过度推销课外班
- 如察觉孩子持续低落 > 7 天，推荐告诉家长或学校心理老师
```

护栏检测**双层**：
- 第 1 层：prompt 内置，LLM 自约束
- 第 2 层：post-hoc 文本分类器（轻量端侧模型），检测输入/输出违规 → 触发"已上报家长"事件（且对孩子透明）

#### 学情报告（家长端日报）

每日定时（默认 21:00 后）生成：

```markdown
# [孩子昵称] 5/27 日报

## 今天的时间分布
- 学习相关：2.5h
- 游戏：1.0h（达限：80%）
- 视频：0.8h
- 通讯/社交：0.5h

## 学科表现（基于 M5 任务 + 错题本）
- ✅ 数学：完成 20 题 / 错 3 题 / 集中在"勾股定理"知识点
- ⏳ 英语：未交（截止还有 4h）

## AI 建议
- 数学错题建议明早复习一次（间隔重复）
- 英语未交，建议提醒

## 心理迹象（来自陪伴 tab，仅显示统计，不暴露内容）
- 对话频次：正常
- 情绪标签：积极（高频）、平静（中频）、烦躁（低频）
- 无需关注的高风险信号
```

注意"心理迹象"块**只展示统计**，不暴露陪伴 tab 原文（孩子隐私护栏）。例外：若触发护栏，会单独高优先级推送给家长（"⚠️ AI 检测到 [孩子] 提到了被同学孤立，建议关注"）。

#### 工程量

| 工作项 | 估时 |
|---|---|
| 双 tab UI + chat 复用 | 3d |
| LLM 路由集成（复用 PDH）| 1d |
| 学习 tab RAG（错题本 / 课本 / 任务）| 4d |
| 陪伴 tab RAG（独立缓存）| 3d |
| 未成年护栏 system prompt + 双层检测 | 4d |
| 日报生成 + 心理迹象统计 | 3d |
| 单测 + 集成 | 3d |
| **合计** | **~21d** |

---

## 4. 路线图

```
┌─────────────────────────────────────────────────────────────────┐
│  v0.1 MVP (4-6 周) — 看 + 通话 + 配对                              │
│  ────────────────────────────────                                 │
│  M1: FamilyFriend 配对（Flow C）+ 权限矩阵                          │
│  M2: L0 + L1 + 5 collector + AnomalyDetector v0                  │
│  M3: 双向 WebRTC + 静音旁观                                        │
│  家长端: Dashboard v1 + 通话                                       │
│  孩子端: 持久通知 + 角色识别                                         │
│  价值: 能看孩子今天用了什么 app 多久 + 能视频                          │
│                                                                   │
├─────────────────────────────────────────────────────────────────┤
│  v0.2 (4-6 周) — 控制 + 任务                                       │
│  ────────────────────────                                         │
│  M4: 档 1+档 2（提示 + DPC）                                       │
│  M5: 任务收发 + AI 批改（学习类）                                    │
│  M6: 学习 tab v0.1                                                │
│  M2: L1 完整 + 8 collector                                        │
│  价值: 可以禁特定 app 时段 + 派作业 + AI 批改                         │
│                                                                   │
├─────────────────────────────────────────────────────────────────┤
│  v0.3 (6-8 周) — AI 双轨 + 网络拦截                                 │
│  ────────────────────────                                         │
│  M4: 档 3（VPN + 支付审批）                                         │
│  M6: 陪伴 tab + 学情报告 + 护栏                                     │
│  M5: 错题本 + 间隔重复                                              │
│  M2: L2 可选开 + 审计                                              │
│  价值: 完整教育闭环 + 心理陪伴 + 支付拦截                              │
│                                                                   │
├─────────────────────────────────────────────────────────────────┤
│  v1.0 (4 周) — 强档兜底 + 合规                                      │
│  ────────────────────────────                                     │
│  M4: 档 4（root + Magisk + 反卸载 + 反关无障碍）                    │
│  法律合规 review + 应用商店上架材料                                  │
│  M6: 月报 + 家长群（家长之间私聊，不做榜单）                          │
│  价值: 强管控不可绕过 + 合规可上架                                    │
└─────────────────────────────────────────────────────────────────┘
```

**总工期估算**：~135d 单人 work，团队 2-3 人并行约 18-22 周（4.5-5.5 个月）

---

## 5. 风险

### 5.1 法律 / 合规（最大风险）

| 风险 | 应对 |
|---|---|
| 《未成年人保护法》要求知情同意 | 配对流程强制弹窗 + 持久通知 + 解绑冷却 |
| 《个人信息保护法》14 岁以下需监护人同意 | 配对时校验年龄；< 14 走"监护人代签 + 平台审核"流程（v1.0 接入实名） |
| L2/L3 采集合规 | 默认关 + 每次单独同意 + 审计日志 + 孩子可随时关 |
| 应用商店"家长控制类"专项审核 | v1.0 前预审；可能要求 Google Play Family Link 集成 |
| 数据存储合规 | 端到端 + SQLCipher + 数据不上云 + 90 天保留期 |
| 跨境数据 | 默认境内服务器；海外用户用本地 LAN，不走 turn.chainlesschain.com |

**建议**：v0.1 起就拉法务介入起草《未成年信息采集与使用知情同意书》。

### 5.2 技术风险

| 风险 | 应对 |
|---|---|
| MIUI / HyperOS 上 DPC 自注册兼容性 | v0.1 spike 验证 5 个主流 ROM；不兼容时降级到档 1 |
| AccessibilityService 被电池优化杀 | 复用 WeChat collector 自启拉活 |
| WebRTC 在校园网 / 教育网 NAT 卡死 | TURN 中继兜底 + ICE candidate timeout 调优 |
| Magisk 模块 OTA 后失效 | 监测 + 用户引导重新 root |
| AI 护栏被绕过（孩子骗 LLM）| 双层检测 + 关键词 + 行为分析 + 持续 red-team |
| `MediaProjection` 屏幕共享性能 / 耗电 | 限制 15fps + 仅在静音旁观/紧急时启用 |
| 充值拦截误伤正常付费（家长自己的）| 白名单 + 家长账号识别 |

### 5.3 心理 / 伦理

| 风险 | 应对 |
|---|---|
| 过度监控推孩子用备用机 | 产品层：私有时段 + 解绑通道；陪伴 tab 隐私护栏 |
| AI 陪伴产生依赖 | 每日对话时长上限提示 + 鼓励真实社交 |
| 错题本反复挫败感 | 间隔重复 + 渐进难度 + 奖励机制 |
| 家长看 telemetry 焦虑（小事过度反应）| Dashboard 默认聚合视图 + 异常事件 push 加冷却 |
| 静音旁观滥用（窥探）| 5min 复检 + 审计 + 孩子可"暂停 2min" |
| 学情排名导致家长间攀比 | 不做榜单（边界条件） |

### 5.4 商业 / 产品

| 风险 | 应对 |
|---|---|
| 与系统级方案（Apple/华为/小米学习中心）正面竞争 | 主打跨厂商 + 深入 app 内 + 端到端隐私 |
| 第三方监控 app 红海 | 主打 ChainlessChain 整体生态融合（不是单点工具）|
| 用户教育成本高（配对复杂）| v0.1 力求 3 分钟内完成；视频教程 + 客服 |
| root 设备要求门槛 | v0.1-v0.3 默认非 root（档 1+2+3）；档 4 推 root 用户先试 |

---

## 6. 待评审决策

| ID | 决策项 | 当前倾向 | 备选 |
|---|---|---|---|
| D1 | v0.1 MVP 是否包含静音旁观？ | ✅ 是（核心差异化）| 推迟到 v0.2 |
| D2 | "陪伴 tab" 是否对家长完全黑盒？ | ✅ 仅显示统计 + 触发护栏才上报 | 完全开 / 完全关 |
| D3 | DPC 注册时机？ | 用户引导 + 文档 | 自动检测设备 + 一键引导 / 真完整自动 |
| D4 | 私有时段长度上限？ | 每天 2 小时 | 不限 / 每天 1 小时 |
| D5 | 错题本数据归属？ | 孩子主，家长可读 | 家长主 / 完全隔离 |
| D6 | 应用商店上架策略？ | Google Play + 国内安卓主流 | 仅自分发 / 仅 Google Play |
| D7 | "家庭模式"是否仅限国内？ | v1.0 前国内 only；v2.0 出海 | 一开始就考虑国际 |
| D8 | 多孩子家庭支持时机？ | v0.2 起支持（不限数） | v0.1 起就支持 |

---

## 7. 与其他模块的关系

| 模块 | 关系 |
|---|---|
| PDH（Personal Data Hub）| 强复用：collector 框架 / vault.db / LLM 路由 / sync。新增 5-8 collector |
| Remote Operate（Plan A/A.1/C）| 复用通话 + 屏幕推送基础设施 |
| DID v2 | 复用身份 + 互信凭证签名 |
| Friend / Social 子系统 | 强复用：FamilyFriend = friend 子类型 |
| Phase 3d Mobile Sync | 复用 sync 框架，加权限过滤层 |
| Skills System（141 desktop + 25 Android）| 可派生 family.* 类 skill（如 "查看孩子今日学习" voice command）|

---

## 8. 与现有 trap / memory 的关联

启动开发前必读：

- [[android_pdh_split_brain_vault]] — 家长端用 `adb run-as` 验孩子 vault 时 HOME 注意
- [[miui_query_all_packages_silently_blocked]] — DPC + app 检测在 MIUI 上的限制
- [[android_wechat_collector_phase_12_10]] — 自启拉活 + Magisk 模式参考
- [[android_bootstrap_singleton_mutex_race]] — Bootstrap 多 race 注意
- [[bilibili_post_onload_cookie_race]] — WebView cookie 时序，影响支付拦截
- [[pdh_4tier_llm_route_card_selector]] — M6 LLM 路由复用
- [[android_qq_collector_phase_13_5]] — 类似 collector 模板
- [[android_remote_terminal_plan_a_diagnosis]] — Plan A.1 通话栈
- [[android_remote_operate_plan_c_first]] — Plan C 操控
- [[phase_3b_3c_sync_feature]] / [[phase_3d_mobile_sync_landing]] — Sync 框架

---

## 9. 下一步

如方案方向通过：

1. **拆 v0.1 MVP ticket 树**：M1+M2+M3 子任务，约 25-35 个 issue
2. **法律预研**：起草《知情同意书》+ 应用商店上架材料 checklist
3. **技术 spike**（并行 1 周）：
   - DPC 在 5 个 ROM（MIUI / HyperOS / EMUI / OriginOS / ColorOS）的兼容性
   - mobile↔mobile WebRTC 改造（Plan A.1 解耦）
   - AccessibilityService 5min 持久横幅在各 ROM 不被劫持
4. **设计评审会**：拉客户端 + 后端 + 法务 + 产品过一遍 D1-D8

---

> 文档版本：v0.1
> 撰写：Claude (longfa session)
> 评审：待
> 实施：待
