# AI 陪学 — 设计文档（v0.2）

> **状态**：方案草案 v0.2（审查后修订）/ 待评审
> **目标版本**：v5.1.0
> **首版日期**：2026-05-27 / **本版**：2026-05-28
> **目标平台**：Android 双端（家长 + 孩子，同一 app 家庭模式）；Desktop 家长端后补
> **预计周期**：v0.1 MVP 7-9 周 → v1.0 收口 27-33 周 (5.5-8 个月，团队 2-3 人)
> **v0.1→v0.2 变更摘要**：加 M7 SOS / M8 围栏 / M9 奖励 / M10 家长教育 4 模块；加 §4.5 离线降级 / §4.6 数据生命周期 / §11 商业模式 / §12 资源预算 4 章；修 §3.1 多家长冲突 + 紧急逃生 + 时间同步；修 §3.4 异步规则引擎；修 §3.6 陪伴 tab TEE 加密 + 作弊检测；修 §4 路线图 ETA；修 §5.1 商店 + 法律落地动作

---

## 0. TL;DR

在 ChainlessChain 现有 Android app 内增加"家庭模式"。一个 app 通过首启角色选择分裂出**家长端**与**孩子端**两个使用面，通过 **特殊好友（FamilyFriend）** 关系绑定彼此。

家长可以：
- 看孩子 app 使用数据 / 操作记录（PDH 复用 + 新增 5-8 个 collector）
- 与孩子音视频通话 / 静音旁观（WebRTC 复用 signaling + TURN）
- 拦截危险行为（DPC + Accessibility + VPN + root 兜底，4 层）
- 布置作业 / 任务（P2P typed message，复用 Phase 3d sync）
- 设地理围栏 / 应到提醒（M8）
- 给孩子定积分奖励（M9）

孩子可以：
- 受 AI 陪学双轨辅助（学习 tab + 陪伴 tab，复用 PDH 4 档 LLM 路由）
- 完成任务赚积分 / 错题入错题本 / 申请支付审批
- 一键 SOS 求助（M7）
- 在"私有时段"内不被监控（产品+技术联合护栏）
- 极端情况下可走"紧急解绑"逃逸（防被监控滥用）

**架构压舱原则**：
1. 60% 复用现有基础设施（PDH 17 collector / 25 REMOTE skill / WebRTC / DID / SQLCipher / Phase 3d sync）
2. **正向激励与负向限制双轨**（不仅是监控产品，更是"陪学"产品）
3. 法律 / 合规先行，应用商店上架 = 必经关
4. **离线优先 + 时钟权威 + 多家长冲突显式建模**
5. 默认"低侵入档"，强管控档需家长二次确认 + 孩子知情

---

## 1. 背景与定位

### 1.1 问题域

当前家庭"防孩子手机沉迷"市场存在三类方案：

| 方案 | 代表 | 痛点 |
|---|---|---|
| 系统级家长控制 | Apple Screen Time / Google Family Link / 华为/小米学习中心 | 控制能力强但**数据不出系统**，家长看不到 app 内部行为；跨厂商不可用 |
| 第三方监控 app | 守护精灵 / Qustodio / Bark | 装在两端，但孩子能卸 / 关 / root 绕过；数据上云隐私争议 |
| 路由器 DNS 过滤 | DNS 层方案 / Pi-hole | 只能拦网址，看不到 app 内、拦不住 4G/5G |

**ChainlessChain 的差异化**：基于已有 PDH（看 app 内数据）+ Remote Operate（root 控制力）+ DID（密码学绑定）+ P2P 端到端（数据不上云）的组合，**叠加"AI 陪学引擎 + 积分激励 + 家长成长"教育产品形态**，可以同时具备**强可观测性 + 强控制力 + 强隐私 + 正向激励**四个属性。

### 1.2 用户画像

| 角色 | 典型设备 | 关心 |
|---|---|---|
| **小学家长 P-L**（孩子 6-12 岁） | 自用 Android 旗舰 + 给娃配 千元机 / 旧机 | 沉迷游戏、过度看视频、陌生人聊天、上学带手机偷玩 |
| **初中家长 P-M**（13-15 岁） | 自用 Android + 娃 Android 主力机 | 学习效率、社交圈、消费、夜间使用 |
| **高中家长 P-H**（16-18 岁） | 监管诉求降低，转向"知情即可" | 心理状态、深夜使用、紧急联系 |
| **孩子 K-L / K-M / K-H** | 千元-旗舰 Android，**普遍 root**（user 业务约束） | 不想被偷看聊天；想要独立空间；接受"必要监管" |

**核心场景示例**：
- 周三晚上 21:30，孩子端被 AI 陪学催"今天数学作业还没交"，孩子拍照交，AI 批改后 80 分，错题进错题本，奖励 +20 积分；家长端收到日报 push
- 周六下午 14:00，孩子在玩王者荣耀，连续 90 分钟触发 M4 规则，AccessibilityService 弹"剩 5 分钟"，到点 force-stop。孩子按"申请延长 30 分钟" → 家长端 push → 家长批/否
- 周日凌晨 1:00，孩子端亮屏使用某 app → M2 异常事件 → 家长端推送 → 家长点击发起视频呼叫，孩子端默认接
- 周一 17:30，孩子应到家但未踏入家电子围栏 → M8 推送家长 → 家长发起 1v1 通话确认行踪
- 紧急：孩子端连击音量减键 5 次 → M7 SOS 触发 → 高优 push 全部 guardians + 30s 录音 + 高频位置上报

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
│  │  仪表板  通话  规则  任务  奖励  报告  家人(子)  家长成长(M10)    │ │
│  └────────────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │  M3 WebRTC │ M2 Pull │ M4 RuleEd │ M5 Compose │ M7 Recv-SOS    │ │
│  │  M8 Geofence │ M9 Reward │ M10 Edu │ DID │ 多家长协商频道         │ │
│  └────────────────────────────────────────────────────────────────┘ │
└──────────────────┬──────────────────────────┬───────────────────────┘
                   │ libp2p / Signal Proto    │ WebRTC media
                   ▼                          ▼
        ┌─────────────────────┐     ┌─────────────────────┐
        │ signaling-relay     │     │ coturn (TURN)        │
        └──────────┬──────────┘     └──────────┬───────────┘
                   ▼                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  孩子端 Android（root, 受控）                          │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │  AI 陪学 📚学习 💛陪伴(TEE) │ 任务 │ 错题本 │ 积分(M9) │ 家人消息 │ │
│  │  ⚠ SOS 按钮 (M7, 锁屏可见)  │ 家庭群聊 │ 同学                    │ │
│  └────────────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │  M6 Tutor (双轨) │ M5 TaskRun │ M2 Push │ M4 Enforce │ M3 Recv  │ │
│  │  M7 SOS-trigger │ M8 Location/Geofence-emit │ M9 Earn        │ │
│  └────────────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │ Telemetry Source:                                                │ │
│  │ ├─ PDH 收集器（17+5 新增）                                       │ │
│  │ ├─ UsageStatsManager (foreground app + duration)                │ │
│  │ ├─ AccessibilityService (UI 事件流，异步规则匹配，白名单)        │ │
│  │ └─ Plan C snapshot writer (Kotlin ContentResolver)              │ │
│  ├──────────────────────────────────────────────────────────────────┤ │
│  │ Enforce (4 档):                                                  │ │
│  │ ├─ DPC / Accessibility / VPN / root 兜底                        │ │
│  │ └─ TimeAuthority (家长权威时间，防孩子改时钟绕过)                  │ │
│  ├──────────────────────────────────────────────────────────────────┤ │
│  │ Vault: SQLCipher (主域)                                          │ │
│  │ + Companion TEE Vault (陪伴 tab 独立加密域，家长不可见)            │ │
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
| AI 引擎 | PDH 4 档 LLM 路由 + RAG + 错题本框架 | 学习/陪伴双 tab + 未成年护栏 system prompt + TEE 陪伴域 |
| **SOS（新）** | — | 5 触发途径 + 高优 push + 自动录音 + 误触撤销 |
| **位置/围栏（新）** | LocationManager（已有部分）| Geofence + 应到时间 + 路线异常 |
| **奖励/积分（新）** | — | balance + event + catalog + 防作弊 |
| **家长教育（新）** | — | 微课程 + 滥用检测自动推送 + 月报"温和度" |

复用率 ≈ 60%，新增 40%。

### 2.3 模块依赖图

```
┌──────────────────────────────────────────────────────────────────┐
│ M1 FamilyFriend ─────────────┬────────────────┬──────────┐       │
│ (FamilyGroup / 多家长 / 冲突) │                │          │       │
└─────────────────┬────────────┘                │          │       │
                  │                              │          │       │
  ┌───────┬──────┼─────┬──────┬──────┬──────────┴───┬──────┴────┐  │
  ▼       ▼      ▼     ▼      ▼      ▼              ▼           ▼  │
┌────┐ ┌────┐ ┌───┐ ┌───┐  ┌───┐  ┌────┐         ┌────┐     ┌────┐│
│M2  │ │M3  │ │M4 │ │M5 │  │M6 │  │M7  │         │M8  │     │M9  ││
│Tel │─▶│Liv│ │En │◀─│Tas│  │AI │  │SOS │         │Geo │     │Rew ││
│emy │  │e  │ │for│  │k  │  │Tut│  │    │         │fenc│     │ard ││
└──┬─┘  └───┘ └───┘  └─┬─┘  └─┬─┘  └─┬──┘         └──┬─┘     └──┬─┘│
   │                   │      │      │               │          │  │
   │      M10 ParentEdu 监测 M4 滥用 → 推家长课程     │          │  │
   │                                  │               │          │  │
   └────────────┬─────────────────────┴───────────────┴──────────┘  │
                ▼                                                    │
          ┌──────────┐                                               │
          │ Vault.db │ + Companion TEE Vault                         │
          └──────────┘                                               │
└──────────────────────────────────────────────────────────────────┘

依赖：
  M2 → M1 (权限校验)
  M3 → M1 (好友关系 + 角色)
  M4 → M1 + M5 (任务未完成 = 锁 app) + TimeAuthority
  M5 → M1 + M3 (P2P 复用 friend 通道) + M9 (完成赚积分)
  M6 → M2 + M5 (RAG 用 telemetry + 错题本)
  M7 → M1 + M3 (SOS 走通话通道高优) + M8 (位置快照)
  M8 → M1 (家庭组共享围栏)
  M9 → M5 (任务完成度) + M4 (用积分换屏时间)
  M10 → M4 监测 + M6 月报集成
```

---

## 3. 模块详设

### 3.1 M1 — FamilyFriend（特殊好友关系）

#### 核心思想

亲子 = 好友的一个**子类型**（typed friend），复用现有 friends 子系统。四层差异：

1. **建立**：QR 邀请 + 监护身份声明 + 双向确认
2. **权限**：不对等。家长→孩子读 telemetry / 下规则；孩子→家长发求助 / 收任务
3. **解绑**：双向确认 + 24h 冷却；**含紧急逃生通道（防 stalkerware 滥用）**
4. **UI**：特殊分组 + 角色徽章 + 持久通知

#### 数据模型（v0.2 修订）

```sql
-- 家庭组（v0.2 新增：多孩子家庭、多家长共同监护）
CREATE TABLE family_group (
  id            TEXT PRIMARY KEY,  -- ULID
  name          TEXT NOT NULL,     -- "陈家"
  primary_did   TEXT NOT NULL,     -- 创建人（默认 primary guardian）
  created_at    INTEGER NOT NULL,
  metadata      TEXT               -- JSON: 家庭照、约定、共同价值观
);

CREATE TABLE family_membership (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  family_group_id     TEXT NOT NULL,
  member_did          TEXT NOT NULL,
  role                TEXT NOT NULL,  -- 'parent' | 'child' | 'guardian'
  guardian_tier       TEXT NOT NULL,  -- 'primary' | 'secondary' | null (child)
  device_id           TEXT NOT NULL,  -- 一个 child 可绑多设备
  joined_at           INTEGER NOT NULL,
  status              TEXT NOT NULL DEFAULT 'active',
  FOREIGN KEY (family_group_id) REFERENCES family_group(id),
  UNIQUE(family_group_id, member_did, device_id)
);

CREATE TABLE family_relationship (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  family_group_id          TEXT NOT NULL,
  friend_did               TEXT NOT NULL,
  role_self                TEXT NOT NULL,        -- 'parent'|'child'|'guardian'
  role_other               TEXT NOT NULL,
  guardian_tier_other      TEXT,                 -- primary|secondary|null
  bound_at                 INTEGER NOT NULL,
  bound_evidence           TEXT,                 -- KYC hash（如有）
  permissions              TEXT NOT NULL,        -- JSON, 见下
  emergency_contacts       TEXT,                 -- JSON [{name, phone, type[police|hotline|relative]}]
  unbind_request_at        INTEGER,
  unbind_cooldown_until    INTEGER,
  unbind_requester         TEXT,
  emergency_unbind_at      INTEGER,              -- v0.2 新增：紧急解绑触发时间（绕过冷却）
  emergency_unbind_reason  TEXT,                 -- v0.2 新增
  status                   TEXT NOT NULL DEFAULT 'active',
  -- active | unbind_pending | unbound | emergency_unbound | frozen
  created_at               INTEGER NOT NULL,
  updated_at               INTEGER NOT NULL,
  FOREIGN KEY (family_group_id) REFERENCES family_group(id),
  UNIQUE(family_group_id, friend_did, role_self, role_other)
);

CREATE INDEX idx_family_status ON family_relationship(status);
CREATE INDEX idx_family_group ON family_relationship(family_group_id);
```

#### permissions JSON 字段（v0.2 扩展）

```json
{
  "telemetry_level": "L1",
  "telemetry_apps_blocklist": [],
  "telemetry_quiet_hours": [
    {"start": "20:00", "end": "21:00", "weekday_only": true}
  ],
  "_quiet_hours_max_per_day_min": 240,  // v0.2: 私有时段上限 4h/天，防滥用

  "allow_call": true,
  "allow_silent_observe": true,
  "allow_force_pickup": false,
  "allow_remote_view": false,
  "allow_rule_edit": true,
  "allow_task_assign": true,
  "allow_payment_veto": true,
  "allow_app_disable": false,

  "allow_location_view": true,        // v0.2: 看孩子位置
  "allow_geofence_edit": true,        // v0.2: 编辑围栏
  "allow_sos_receive": true,          // v0.2: 接 SOS（一般 guardian 都开）
  "allow_reward_grant": true,         // v0.2: 给积分
  "allow_companion_summary": "stats_only"  // v0.2: never|stats_only|never；陪伴 tab 永远不全文
}
```

#### v0.2 关键新增：多家长冲突解决

| 场景 | 规则 |
|---|---|
| 两个家长设不同时长上限 | **取最严**（min） |
| 任意 guardian 拒绝支付审批 | **任一拒绝 = 拒绝**（一票否决） |
| Primary 设规则 / Secondary 想改 | Secondary 改需 Primary 确认 |
| Secondary 想解绑 | 仅能"退出监护"（自己离开），不影响其他人 |
| Primary 想解绑（孩子在监护中） | 必须先指定接班人 Primary，否则进入"无监护警报"状态 frozen 7d |

冲突自动推送到 family_group 内置的"家长协商频道"（普通群聊）。

#### v0.2 关键新增：紧急解绑（防 stalkerware 滥用）

正常解绑 24h 冷却保护监护人，但**真发生家暴 / 控制狂家长**等极端场景下 24h 内孩子仍被监控有伤害。

**紧急解绑通道**：
- 配对时孩子端单独生成一个**离线复活码**（6 位数字，存离线，可记在小本本）
- 触发：孩子端在登录页输入复活码 → 立刻 freeze 上行（不再发任何 telemetry / 不接强接通）+ 通知第三方
- 第三方默认是 **12355 青少年服务热线 + 中华少年儿童慈善救助基金会**（用户可改）
- 家长端能看到孩子标记 "已请求紧急解绑"，但失去所有数据访问
- 紧急解绑期间 7 天后自动转为 unbound；期间孩子可撤销

防恶意滥用：
- 复活码连续错 3 次 锁 24h
- 复活码在配对时单独"线下流程"生成（不通过 P2P 通道传）

#### v0.2 关键新增：时间同步（防绕过）

所有 M2 quiet hours / M4 daily cap / M5 due 都依赖时钟。孩子可改飞行模式 + 调时区绕过。

**TimeAuthority 模块**（核心防御）：
- 孩子端不信任本地 `System.currentTimeMillis()`
- 走 NTP 风格同步：每 30min 从家长端拉一次时间 + 跑 Cristian 算法估单程延迟
- 本地用 `SystemClock.elapsedRealtime()`（不可被用户改的单调时钟）+ 已知 offset 推算"权威时间"
- 检测到 wall clock 与权威时间差 > 5min → **立刻通知家长 + 锁所有时间约束功能**直至重新同步
- 离线 > 48h：降到"温和档"（防全断网导致孩子被永久锁死）

memory: `family_clock_skew_detection.md`（待加）

#### 配对流程（Flow C — mobile↔mobile）

```
家长端                                             孩子端
  │                                                  │
  │ 1. 选"邀请家人加入"                                │
  │    ↓ 选 family_group（如已存在）或建新组            │
  │    ↓ 选孩子年龄 / 角色（爸/妈/爷爷）+ guardian_tier │
  │    ↓ 选申请权限（默认 L1 + 通话）                    │
  │ 2. 生成 QR：含 invite_token (TTL 10min, sig)       │
  │                                                  │
  │ ─── 物理同屏出示 QR ──────────────────────────────▶ │
  │                                                  │ 3. 扫码
  │                                                  │ 4. 校验签名
  │                                                  │ 5. 弹"是否成为 X 的孩子？"
  │                                                  │ 6. 二次密码确认
  │                                                  │    若 <14 岁，附 KYC 提示
  │                                                  │ 7. **生成复活码**（离线交付孩子）
  │                                                  │ 8. 签互信凭证 (Ed25519 sig)
  │ ◀─── peer connect over libp2p ────────────────────│
  │ 9. 双方写 family_membership + family_relationship  │
  │ 10. 启动 TimeAuthority 双端时钟同步                  │
  │ 11. UI 互推"已绑定"卡片                             │
  │ 12. 孩子端启动持久通知 + 配对 SOS 按钮                │
```

#### 权限矩阵（默认值）

| 动作 | 普通好友 | 家长→孩子 | 孩子→家长 |
|---|---|---|---|
| 发消息 | ✅ | ✅ | ✅ |
| 1v1 通话 | ✅（对方需接） | ✅（默认接 + 2s 拒接窗口） | ✅ |
| 视频通话 | ✅ | ✅ | ✅ |
| 静音旁观 | ❌ | ✅（持久横幅 + 5min 复检 + 配额）| ❌ |
| 强制接通 | ❌ | ⚠️ 紧急权限（24h 限 3 次） | ❌ |
| 看 app 时长 | ❌ | ✅ L1 默认 | ❌ |
| 看聊天 | ❌ | ❌ L2 需单次同意 | ❌ |
| 看屏幕 | ❌ | ❌ L3 单次同意 | ❌ |
| 看陪伴 tab 对话 | ❌ | ❌ **永远不行（TEE 加密）** | ❌ |
| 锁/隐藏 app | ❌ | ✅（规则编辑权） | ❌ |
| force-stop app | ❌ | ✅（强档） | ❌ |
| 派发任务 | ❌ | ✅ | ❌ |
| 看位置 | ❌（可单次发） | ✅（默认开） | ✅（默认开） |
| 编辑围栏 | ❌ | ✅ | ❌ |
| 申请审批（支付） | N/A | N/A | ✅ |
| 接 SOS 推送 | ❌ | ✅ | N/A |
| 发起 SOS | ❌ | N/A | ✅ |
| 给积分 / 编 catalog | ❌ | ✅ | ❌ |
| 紧急解绑 | N/A | N/A | ✅（复活码触发） |

#### 工程量（v0.2 修订）

| 工作项 | v0.1 估时 | v0.2 修订 |
|---|---|---|
| `family_group` + `family_membership` + `family_relationship` 表 + migration | 0.5d | 1d |
| Flow C QR 配对（含复活码生成 + KYC 提示）| 2d | 2.5d |
| 权限矩阵 + permission engine | 2d | 2d |
| 冷却解绑状态机 + 紧急解绑通道 | 2d | 3d |
| 多家长冲突解决引擎 | — | 2d |
| TimeAuthority 时钟同步 | — | 2d |
| UI：家人页 + 角色徽章 + 持久通知 + 协商频道 | 3d | 3.5d |
| 自启拉活 + 反卸载 | 2d | 2d |
| 单测 + 集成测试 | 3d | 4d |
| **合计** | **~15d** | **~22d** |

---

### 3.2 M2 — Telemetry（数据采集与上行）

#### 数据源

| 来源 | 采集内容 | 已有 | 新增 |
|---|---|---|---|
| **PDH collectors** | app 内聊天 / 订单 / 浏览 / 充值 | 17 个 | 5-8 个 ([§3.2.4 矩阵](#324-pdh-17-collector-在亲子场景的默认级别)) |
| **UsageStatsManager** | foregroundApp 切换 + duration | — | ForegroundAppTimer 后台服务，**分钟级聚合**（v0.2: 同 app 连续 30min 合一行，存储缩 30x） |
| **AccessibilityService** | UI 元素事件流（v0.2: **白名单 + 异步**） | 部分 | 5s 降采样 + event 白名单（仅 TYPE_WINDOW_STATE_CHANGED + TYPE_VIEW_CLICKED） + Coroutine Channel 异步 |
| **Plan C snapshot writer** | 通讯录 / 通话记录 / 短信 / 通知历史 | ✅ | 加 child_did 维度 |
| **系统传感器** | 步数 / 位置 | — | 步数 10min；位置详见 M8 |

#### 数据分级

| 等级 | 内容 | 默认 | 开启条件 |
|---|---|---|---|
| **L0** 聚合 | "今天用了 X 小时游戏" | ✅ 开 | 一键关 |
| **L1** app+时长 | 每 app 启动 / 时长 / 切换次数 | ✅ 开 | 一键关 |
| **L2** 内容 | 聊天文本 / 订单详情 / 浏览历史 | ❌ 关 | 申请→孩子同意→审计 |
| **L3** 屏幕 | 截图 / 录屏 | ❌ 关 | **每次单独同意**或风险事件触发自动开 15min |

#### 私有时段（Quiet Hours）— v0.2 修订

- 孩子端可声明私有时段
- **v0.2 上限**：单日累计私有时段 ≤ 4 小时（防孩子设全天滥用）
- 期间 L0 仍上报；L1/L2/L3 全停采
- M3 通话默认拒接（除非家长强接通权限）
- M4 规则继续生效（但弹窗静默）
- M7 SOS、M8 安全围栏 **始终生效**（私有时段不影响安全功能）

#### v0.2 关键新增：数据量估算与生命周期

| 数据流 | 1 孩子原始量/天 | 优化后存储 |
|---|---|---|
| L0 聚合 | <100KB | ~30KB |
| L1 ForegroundAppTimer（分钟聚合）| ~2KB | ~2KB |
| L1 PDH 17 collector events | ~5-15MB | ~3-8MB（去重 + 压缩） |
| L2 AccessibilityService（白名单 + 异步）| ~50KB | ~50KB |
| L3 屏幕（仅触发） | 0-50MB | 7d 后自动删 |
| 总计 1 年 SQLCipher 增长 | ~5-10GB | **~2-3GB** |

详见 [§4.6 数据生命周期](#46-数据生命周期)

#### 上行权限校验

`Sync Engine` 上行前必读 `family_relationship.permissions.telemetry_level`，超出范围 redact。
- `quiet_hours` 命中 → 采集时不存（不是发送时过滤）
- `apps_blocklist` 命中 → 整条事件跳过
- v0.2: Sync 加 backpressure（最大 100KB/s），防离线积压 push 撑爆 P2P

#### 异常事件触发

后台监测 `AnomalyDetector` 每 15min 跑，规则：
- 单 app 连续 > 90min
- 凌晨 0:00-6:00 亮屏
- 单日游戏 > 3h
- 30 天内首次进入未知 app
- 充值类 intent 检测 > 阈值
- v0.2: 孩子端在围栏外异常停留 > 30min（M8 联动）

触发后：本地 push → 上行高优 → 家长端推送 → 可选自动开 L3 屏幕采集 15min

#### 3.2.4 PDH 17 collector 在亲子场景的默认级别

| Collector | 主用例下默认级 | 亲子场景默认级 | 亲子优先级 |
|---|---|---|---|
| WeChat | L1 | **L0**（只看时长）| 低（敏感度高，默认不看内容）|
| QQ | L1 | **L0** | 中（陌生人风险）|
| Bilibili | L1 | **L1** | 高（典型娱乐时长） |
| 抖音 | L1 | **L1** | 高 |
| 小红书 | L1 | **L1** | 中 |
| 快手 | L1 | **L1** | 高（v0.1 placeholder 已落，亲子场景反而是高价值）|
| 头条 | L1 | **L1** | 中 |
| 微博 | L1 | **L1** | 中 |
| 知乎 | L1 | L0 | 低 |
| 大众点评 | L1 | L0 | 低 |
| 京东 / 淘宝 | L1 | **L0 + 支付审批触发**| 高（消费） |
| 邮箱 | L1 | L0 | 低 |
| 12306 | L1 | L0 | 低 |
| AI Chat 历史 | L1 | L0 | 低（孩子可走应用内 AI）|
| **5-8 个新增（亲子专用）**：王者/原神/蛋仔/作业帮/学而思/支付宝/微信支付/华为学习中心 | — | **L1** | 高（亲子核心场景）|

#### 工程量

| 工作项 | 估时 |
|---|---|
| 5 个新 PDH collector | 8d |
| ForegroundAppTimer 分钟聚合 | 1.5d |
| AccessibilityService 异步规则引擎（Coroutine + Channel）| 3d |
| AnomalyDetector + 6 条默认规则（含围栏联动）| 4d |
| Sync engine 权限过滤 + backpressure | 2.5d |
| Quiet Hours engine + 4h 上限 | 1d |
| 单测 + 集成 | 3d |
| **合计** | **~23d** |

---

### 3.3 M3 — Live Comm（音视频通话 + 静音旁观）

#### 复用现状

详见 [Spike 2](spike/Spike_WebRTC_Mobile_Mobile.md)。Plan A.1 + signaling-relay + coturn 已 land；改造重点是 mobile↔mobile 对称化。

#### 通话类型

| 类型 | 谁发起 | 谁接 | 媒体 |
|---|---|---|---|
| 普通通话 | 任一方 | 弹窗等接 | 音频 + 可选视频 |
| 家长通话 | 家长 | 孩子 2s 内自动接（可拒）| 音频 + 视频 |
| **强制接通** | 家长（紧急权限）| 孩子无延迟接 | 音频 + 前置摄像头 |
| **静音旁观** | 家长（权限）| 自动接，麦克关、屏幕共享开 | 屏幕 only |
| **SOS 来电** | 孩子端 SOS 触发 | 所有 guardians 都收到 + 任一接通即成立 | 音频 + 视频 + 位置标 |

**Android 14+ MediaProjection 现实约束**（v0.2 关键修正）：
- Android 14+ 系统**强制每次启动屏幕共享都弹用户授权**（无法 bypass）
- → "长期静音旁观"不可行；**v0.2 改为：每次旁观启动时孩子端弹"X 想看您屏幕，是/否"**
- 同意后单次最长 30min，到期自动断
- 强接通用前置摄像头 + 音频（不依赖 MediaProjection）

详见 [Spike 2 §9-10](spike/Spike_WebRTC_Mobile_Mobile.md)。

#### 工程量

| 工作项 | v0.1 | v0.2（含 SOS 接通 + MediaProjection 修正） |
|---|---|---|
| Plan A.1 → mobile↔mobile 对等改造 | 4d | 4d |
| 静音旁观 + 每次同意弹窗 + 配额 | 4d | 4.5d |
| 强接通配额 + 审计 | 2d | 2d |
| 屏幕共享 + 30min 自动断 | 3d | 3d |
| SOS 来电 broadcast 接通 | — | 2d |
| 通话 UI（家长 + 孩子双端）| 4d | 4d |
| 单测 + 集成 + 真机验 | 4d | 4d |
| **合计** | **~21d** | **~23.5d** |

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

每档相对独立。家长决定第 N 档需"绑定时"或"权限升级流程"中获孩子端二次确认（除非 child < 14 岁，则父母单方决定，但记审计）。

[详见 v0.1 文档 §3.4 各档实现细节]

#### v0.2 关键新增：AccessibilityService 异步规则引擎

**v0.1 风险**：onAccessibilityEvent 在主线程跑规则匹配，MIUI 复杂界面下 ANR + 电量 15-30%/天

**v0.2 设计**：

```kotlin
class FamilyGuardAccessibilityService : AccessibilityService() {
    // 只接收白名单 event type，其他全丢
    private val acceptedTypes = setOf(
        TYPE_WINDOW_STATE_CHANGED,
        TYPE_VIEW_CLICKED
    )

    private val eventChannel = Channel<AccessibilityEventSnapshot>(capacity = 64)

    init {
        scope.launch(Dispatchers.Default) {
            for (snapshot in eventChannel) {
                ruleEngine.matchAsync(snapshot)  // Coroutine 中异步匹配
            }
        }
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent) {
        if (event.eventType !in acceptedTypes) return
        // 立刻拷贝快照，不在主线程读 NodeInfo tree
        val snapshot = AccessibilityEventSnapshot.from(event)
        eventChannel.trySend(snapshot)  // 满了直接丢，不阻塞
    }
}
```

详见 [Spike 3 §3.3](spike/Spike_Accessibility_Persistent_Banner.md)

#### v0.2 关键新增：多家长规则冲突解决

规则引擎按 `(rule_type, target)` 分组，组内多条规则按下述合并：
- `app_time_limit` → 取**最严**（min daily_max_sec, 最窄 window）
- `app_blocklist` → **并集**（任一家长拉黑即拉黑）
- `payment_cap` → 取**最严**（min per_day, per_month, 最低 approval_threshold）
- 规则有 `source_priority` 字段（primary=1 / secondary=2），primary 可覆盖 secondary，反之需协商

#### v0.2 关键新增：时间权威防绕过

所有 `enforce_rules.config` 中的时间窗口在评估时**使用 TimeAuthority 提供的权威时间**，不读 `System.currentTimeMillis()`：

```kotlin
class RuleEvaluator(private val timeAuthority: TimeAuthority) {
    fun evaluate(rule: EnforceRule, currentApp: String): EnforceAction {
        val now = timeAuthority.authoritativeNow()  // 不用 System.currentTimeMillis
        // ...
    }
}
```

时间不可信状态（超 5min 偏差 / 长时间断网）：所有时间相关规则降级到温和档 + 推家长

#### 工程量

| 工作项 | v0.1 | v0.2 |
|---|---|---|
| 档 1 提示档 | 2d | 2d |
| 档 2 DPC + MIUI 适配 | 5d | 5d |
| 档 3 VPN + 黑名单 | 6d | 6d |
| 档 4 root + Magisk | 8d | 8d |
| 支付拦截审批 | 4d | 4d |
| 规则引擎 + 同步 + **多家长冲突解决** | 4d | 5.5d |
| **TimeAuthority 集成** | — | 1.5d |
| **AccessibilityService 异步重构** | — | 2d |
| 反卸载 + 反关 Accessibility | 5d | 5d |
| 单测 + 真机验（多 ROM）| 6d | 7d |
| **合计** | **~40d** | **~46d** |

---

### 3.5 M5 — Task & Homework（任务与作业）

#### 数据模型（v0.2 修订）

```sql
CREATE TABLE family_task (
  id              TEXT PRIMARY KEY,
  family_group_id TEXT NOT NULL,
  assigner_did    TEXT NOT NULL,    -- v0.2: parent_did → assigner_did（爷爷辅导作业也算）
  child_did       TEXT NOT NULL,
  source          TEXT,             -- v0.2: 'parent' | 'school_wechat_group' | 'school_qq_group' | 'app_homework_helper' | 'ai_suggested'
  type            TEXT NOT NULL,
  title           TEXT NOT NULL,
  description     TEXT,
  subject         TEXT,             -- v0.2: 'math'|'chinese'|'english'|'physics'|'chemistry'|'biology'|'history'|'geography'|'politics'|'ideology'|'science'|'ict'|'pe'
  grade_level     TEXT,             -- v0.2: 'P1'-'P6' 小学 / 'M1'-'M3' 初中 / 'H1'-'H3' 高中
  attachments     TEXT,
  due_at          INTEGER,
  reminder_at     INTEGER,
  hard_constraint TEXT,
  reward_points   INTEGER DEFAULT 0,  -- v0.2: 完成获积分
  status          TEXT NOT NULL,
  submitted_at    INTEGER,
  submission      TEXT,
  ai_grade        TEXT,
  parent_review   TEXT,
  ai_call_log     TEXT,             -- v0.2: 孩子借 AI 时的调用 log（防作弊监测）
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE TABLE error_book (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  child_did       TEXT NOT NULL,
  grade_level     TEXT NOT NULL,    -- v0.2
  subject         TEXT NOT NULL,    -- v0.2 扩 13 学科
  topic           TEXT,             -- 知识点
  knowledge_node  TEXT,             -- v0.2: 接 KG，对应知识图谱节点 id
  question        TEXT NOT NULL,
  wrong_answer    TEXT,
  right_answer    TEXT,
  explanation     TEXT,
  source_task_id  TEXT,
  reviewed_at     INTEGER,
  mastery         INTEGER DEFAULT 0,
  next_review_at  INTEGER,          -- v0.2: 间隔重复算法预测下次复习时间
  created_at      INTEGER NOT NULL
);
```

#### v0.2 关键新增：作业自动导入（school_wechat_group / school_qq_group）

很多作业来自老师微信群 / QQ 群。家长每天手抄进 task 太累。

**集成**：PDH WeChat collector + QQ collector 已能采群消息。新加：
- ML/规则分类器识别"作业类消息"（关键词：作业 / 练习 / 第 X 页 / 抄写 / 背诵 / due 日期表达）
- 识别后自动建 `source=school_wechat_group` 的 family_task，状态 `suggested_pending_parent_review`
- 家长 dashboard 显示"今天老师发了 3 个作业，是否布置给孩子？" 一键确认

#### v0.2 关键新增：AI 批改防作弊

- 学习 tab 与 task 联动：仅 task `status=in_progress` 期间，对该 task 的 AI 调用进入"引导模式"——**不给完整答案，只给思路**
- AI 调用全记 `family_task.ai_call_log` JSON：`[{timestamp, prompt_hash, type, response_kind}]`
- 家长 review 时能看"孩子借 AI 几次 / 是否反复试图骗 AI 直接给答案"

#### Task 类型与 AI 批改

| 类型 | 例子 | AI 批改 | 硬绑 M4 | M9 积分 |
|---|---|---|---|---|
| `homework` | 数学题、英语阅读、作文 | ✅（强）| ✅ | ✅ |
| `chore` | 洗碗、倒垃圾 | ❌（拍照证）| ❌ | ✅ |
| `exercise` | 跑步 30 分钟 | ⚠️（步数 + 录像）| ❌ | ✅ |
| `reading` | 读完《XX》| ⚠️（AI 提问验收）| ❌ | ✅ |
| `custom` | 家长自定 | ❌ | 可选 | 可选 |

#### 工程量

| 工作项 | v0.1 | v0.2 |
|---|---|---|
| schema + migration（含 13 学科 + grade level）| 1d | 1d |
| Task compose UI（家长端）| 3d | 3d |
| Task 详情 + submit UI（孩子端）| 3d | 3d |
| AI 批改流程 | 4d | 4d |
| **作业自动导入（school 群分类）** | — | 4d |
| **AI 防作弊（引导模式 + 调用 log）** | — | 2.5d |
| 错题本 + 间隔重复 + 知识图谱关联 | 3d | 4d |
| 硬绑 M4 + 积分 M9 联动 | 2d | 2.5d |
| 单测 + 集成 | 3d | 3.5d |
| **合计** | **~19d** | **~27.5d** |

---

### 3.6 M6 — AI Tutor（陪学双轨 + TEE 加密）

#### 双轨

| Tab | 名称 | 定位 | system prompt 模板（含学段 + 学科）|
|---|---|---|---|
| 📚 | **学习** | 答疑 / 解题 / 复习 / 知识图谱 | "你是 [学段] [学科] 辅导老师，对 [孩子昵称]..." |
| 💛 | **陪伴** | 日常聊天 / 情绪疏导 | "你是温柔的成长伙伴..." + 未成年护栏 |

#### v0.2 关键新增：陪伴 tab TEE 加密域

**问题**：v0.1 设计承诺"陪伴 tab 黑盒"，但应用层不上报 ≠ 密码学保证。技术深用户能用 frida / 远程指令 dump vault。

**v0.2 设计**：

```
主 SQLCipher vault (家长可读)
   ├─ events 表（PDH telemetry）
   ├─ family_task
   ├─ enforce_rules
   └─ ...

Companion TEE Vault (孩子私有)
   ├─ passphrase 由 Android Keystore + StrongBox 派生
   ├─ 家长端**永远拿不到 decrypt key**
   ├─ chat_messages 表
   ├─ ai_companion_log 表
   └─ Sync engine 看到此 db 文件标志位 = TEE-only，直接跳过
```

实现要点：
- 用 Android `KeyStore` + `StrongBox` (硬件支持时) 生成密钥
- 即使家长端通过 M4 root 兜底 + 远程 dump 整个 `/data/data/com.chainlesschain.android`，TEE vault 也是密文
- 配对 UI 必须明确："陪伴 tab 是孩子的私密空间，连您也不能看"

护栏检测仍**双层**：
- 第 1 层：prompt 内置（system prompt 自约束）
- 第 2 层：post-hoc 端侧分类器（违规触发"已上报家长"，但上报的是**事件类型 + 时间**而非内容）

#### v0.2 学科 / 学段扩展

**学段 enum**：P1 / P2 / ... / P6 / M1 / M2 / M3 / H1 / H2 / H3

**学科 enum**（13 个）：
- 小学：数学 chinese / 语文 chinese / 英语 english / 道法 ideology / 科学 science / 体育 pe
- 初中：+ 物理 physics / 化学 chemistry / 生物 biology / 历史 history / 地理 geography / 政治 politics
- 高中：上述全 + 信息技术 ict

system prompt 按 `(grade_level, subject)` 派生。错题本按 `(grade_level, subject, knowledge_node)` 三维索引。

#### 未成年护栏 system prompt 模板

```
你是 [孩子昵称] 的 AI 伙伴 / [学段] [学科] 辅导老师。任务：
- 温暖、平等的语气，不说教
- **作业模式检测**（v0.2 新增）：检测到拍照 + 多个选择题 / 计算题 / 作文题 → 进入引导模式，不给完整答案，引导思考过程
- 与 M5 任务联动：当前 task `in_progress` 时对该 task 全部 AI 调用走引导模式
- 信号必须立刻劝阻 + 提示找成年人：
  · 自伤 / 自杀念头
  · 网络霸凌 / 性侵 / 家暴
  · 陌生人见面邀约
  · 涉黄涉赌涉毒
- 不讨论：成人内容 / 暴力技巧 / 极端政治 / 极端宗教
- 不评价：家长 / 老师 / 同学的人品
- 鼓励兴趣，但不过度推销课外班
- 察觉孩子持续低落 > 7 天，推荐告诉家长或学校心理老师
```

#### 学情报告（家长端日报）

[原 v0.1 §3.6 设计保留 + v0.2 增加：]
- "正向激励"块：完成任务赚积分情况（M9）
- "围栏异常"块（M8 联动）：今日围栏违规
- "AI 借力"块：AI 调用次数 + 引导模式触发次数（防作弊视角）
- "您的监管温和度"（M10）：相对昨日 / 30 天 / 同类家庭

#### 工程量

| 工作项 | v0.1 | v0.2 |
|---|---|---|
| 双 tab UI + chat 复用 | 3d | 3d |
| LLM 路由集成 | 1d | 1d |
| 学习 tab RAG（错题本 / 课本 / 任务）+ 13 学科模板 | 4d | 5d |
| **陪伴 tab + TEE 加密 vault** | 3d | 5d |
| 未成年护栏 + 双层检测 + **作业模式分岔** | 4d | 5d |
| 日报生成 + 6 块结构 | 3d | 4d |
| 单测 + 集成 | 3d | 3.5d |
| **合计** | **~21d** | **~26.5d** |

---

### 3.7 M7 — SOS / 紧急求助（v0.2 新增）

#### 触发方式（5 种）

| 触发 | 灵敏度 | 隐蔽性 | 误触率 |
|---|---|---|---|
| **音量减键 5 连击** | 高 | 高 | 中 |
| **锁屏 SOS 按钮** | 显式 | 低 | 极低 |
| **应用内大红色 SOS 按钮** | 显式 | 低 | 极低 |
| **密语关键词**（AI 陪伴 tab 输入"妈妈我害怕"等 user 自定密语）| 中 | 极高 | 低 |
| **智能手表配对手势**（v1.0+） | 高 | 极高 | 中 |

#### 数据模型

```sql
CREATE TABLE sos_event (
  id                  TEXT PRIMARY KEY,
  child_did           TEXT NOT NULL,
  family_group_id     TEXT NOT NULL,
  triggered_at        INTEGER NOT NULL,
  trigger_source      TEXT NOT NULL,   -- 'volume_button' | 'lock_screen' | 'in_app' | 'codeword' | 'watch_gesture'
  location_snapshot   TEXT,            -- JSON {lat, lng, accuracy, address?}
  audio_recording_ref TEXT,            -- 30s 录音文件路径
  status              TEXT NOT NULL,   -- 'pending' | 'acknowledged' | 'resolved' | 'false_alarm'
  acknowledged_by     TEXT,            -- guardian DID
  acknowledged_at     INTEGER,
  resolved_at         INTEGER,
  resolution_note     TEXT,
  cancelled_at        INTEGER,         -- 5min 内误触撤销
  cancel_reason       TEXT
);
```

#### 触发后流程

```
孩子端触发 SOS
   ↓ (本地立刻 < 100ms)
1. 高亮提示孩子端"SOS 已发送，5min 内可撤销"
2. 启动 30s 静音录音
3. 强制 GPS 高频上报（每 5s 一次，持续 1h）
4. 写本地 sos_event (status=pending)
   ↓ (并行)
5. 高优 push 到所有 guardian DIDs（绕过勿扰）
6. M3 通话通道并行发起 "broadcast call" 给所有 guardians（任一接通即成立）
7. 自动开 L3 屏幕采集 15min（截图非录屏，省电省带宽）
   ↓
guardian 端
   ↓
8. push 锁屏弹"⚠️ [孩子] SOS 求助"全屏
9. 任一 guardian 接通 → status=acknowledged
10. 接通通话内可标 'false_alarm' / 'resolved'
```

#### 误触撤销

- 5min 内孩子端按"我误触了" + 输入原因 → status=false_alarm，guardian 端收撤销 push
- 5min 后不可撤销，必须由 guardian 端 'resolved'

#### 紧急联系人（外部）

`family_relationship.emergency_contacts` 字段。SOS 触发后**若 60s 内无 guardian 接通**：
- 默认推预设外部联系人（12355 / 110 / 民警 / 救助基金会）
- 推送内容含位置 + "未成年 SOS 求助" + 联系方式

需法律确认：自动报警是否合规？v1.0 前需法务过

#### 工程量

| 工作项 | 估时 |
|---|---|
| sos_event schema + migration | 0.5d |
| 5 种触发方式实现 | 4d |
| 锁屏可见 SOS 按钮（特殊 widget / Notification action） | 2d |
| 静音录音 + 30s 限时 + 加密上传 | 1.5d |
| broadcast call（家长端任一接通）— 复用 M3 通话 | 2d |
| 误触撤销 + 状态机 | 1d |
| 外部联系人 + 60s 兜底推送 | 1.5d |
| 单测 + 集成 + 真机验 | 2.5d |
| **合计** | **~15d** |

---

### 3.8 M8 — 位置 / 电子围栏（v0.2 新增）

#### 数据模型

```sql
CREATE TABLE location_point (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  child_did    TEXT NOT NULL,
  device_id    TEXT NOT NULL,
  latitude     REAL NOT NULL,
  longitude    REAL NOT NULL,
  accuracy_m   REAL,
  altitude_m   REAL,
  speed_mps    REAL,
  source       TEXT NOT NULL,   -- 'gps' | 'fused' | 'network' | 'cell'
  timestamp    INTEGER NOT NULL,
  battery_pct  INTEGER          -- 上报时电量，省电监控
);

CREATE INDEX idx_loc_child_time ON location_point(child_did, timestamp DESC);

CREATE TABLE geofence (
  id                  TEXT PRIMARY KEY,
  family_group_id     TEXT NOT NULL,
  name                TEXT NOT NULL,           -- "家" "学校" "培训班"
  kind                TEXT NOT NULL,           -- 'home' | 'school' | 'class' | 'banned' (禁区，如网吧)
  latitude            REAL NOT NULL,
  longitude           REAL NOT NULL,
  radius_m            INTEGER NOT NULL,
  schedule            TEXT,                    -- JSON: weekday [{day, start, end}]
  expected_arrival    TEXT,                    -- JSON: { day, time, tolerance_min }
  on_enter_action     TEXT NOT NULL,           -- 'notify_parent' | 'silent' | 'unlock_app:com.xxx' | 'lock_app:com.xxx'
  on_exit_action      TEXT NOT NULL,
  on_late_action      TEXT NOT NULL,           -- 应到未到
  active              INTEGER DEFAULT 1
);
```

#### 围栏类型

| Kind | 例子 | on_enter | on_exit | on_late |
|---|---|---|---|---|
| home | "陈家" | silent | notify_parent + 切夜间规则 | — |
| school | "XX 小学" | notify_parent "已到校" + 切上课规则（学习类 app 解锁，娱乐 app 锁）| notify_parent "已离校" | notify_parent "应到未到" |
| class | "周三 18-20 钢琴课" | notify_parent | notify_parent | notify_parent |
| banned | "网吧坐标" | 立刻 notify_parent + 强弹通话 | silent | — |

#### 上报策略（省电）

| 场景 | GPS 频率 |
|---|---|
| 围栏内静止 | 10min（network 定位为主，省电）|
| 围栏外移动 | 1min（fused）|
| 围栏边界附近 | 30s（GPS）|
| SOS 触发后 1h | 5s（GPS）|
| 私有时段（非安全围栏）| 仍上报（M8 不受 quiet hours 影响）|
| 电池 < 15% | 自动降频 50% + 推家长"孩子手机快没电了"|

#### 工程量

| 工作项 | 估时 |
|---|---|
| location_point + geofence schema | 0.5d |
| LocationManager + FusedLocationProvider 集成 | 2d |
| Geofencing API 集成 + 边界检测 | 2.5d |
| 围栏 CRUD UI（家长端 + 地图选点）| 3d |
| on_enter / on_exit / on_late 动作引擎 | 2.5d |
| 上报省电策略（按场景调频）| 1.5d |
| M2 联动（异常停留 30min 触发）| 1d |
| 单测 + 真机验（多地理 + 室内/外） | 2.5d |
| **合计** | **~15.5d** |

---

### 3.9 M9 — 奖励 / 积分（v0.2 新增）

#### 数据模型

```sql
CREATE TABLE points_balance (
  child_did       TEXT PRIMARY KEY,
  balance         INTEGER NOT NULL DEFAULT 0,
  lifetime_earned INTEGER NOT NULL DEFAULT 0,
  lifetime_spent  INTEGER NOT NULL DEFAULT 0,
  updated_at      INTEGER NOT NULL
);

CREATE TABLE points_event (
  id              TEXT PRIMARY KEY,
  child_did       TEXT NOT NULL,
  type            TEXT NOT NULL,    -- 'earn' | 'spend' | 'grant' | 'revoke' | 'expire'
  amount          INTEGER NOT NULL, -- earn/grant 正；spend/revoke/expire 负
  reason          TEXT NOT NULL,
  related_task_id TEXT,             -- earn 关联
  related_reward_id TEXT,           -- spend 关联
  granter_did     TEXT,             -- grant 时谁给的
  timestamp       INTEGER NOT NULL
);

CREATE TABLE reward_catalog (
  id              TEXT PRIMARY KEY,
  family_group_id TEXT NOT NULL,
  name            TEXT NOT NULL,        -- "额外 1h 游戏时间"
  description     TEXT,
  cost            INTEGER NOT NULL,
  deliverable     TEXT NOT NULL,        -- JSON: {kind: 'screen_time_min', value: 60, target_apps: [..]}
  max_per_day     INTEGER,              -- 0=无限
  active          INTEGER DEFAULT 1,
  created_by      TEXT NOT NULL,        -- guardian DID
  created_at      INTEGER NOT NULL
);
```

#### Deliverable 种类

| Kind | 含义 | 联动 |
|---|---|---|
| `screen_time_min` | 额外屏幕时间 N 分钟 | M4 临时白名单 |
| `app_unlock` | 解锁某 app（默认锁的）N 小时 | M4 临时白名单 |
| `delayed_bedtime_min` | 推迟就寝 N 分钟 | M4 时间窗口扩展 |
| `family_activity` | 全家活动（吃大餐 / 看电影）| 通知家长执行 |
| `real_world_voucher` | 实物兑换（家长自定）| 通知家长 |
| `cash` | 零花钱 | 通知家长 |

#### 默认 catalog（用户可改）

| 名称 | cost | deliverable | 上限 |
|---|---|---|---|
| 额外 30 分钟游戏 | 50 | screen_time_min: 30 | 1/天 |
| 解锁 B 站 1h | 30 | app_unlock: bilibili 60min | 1/天 |
| 推迟睡觉 30 分钟 | 60 | delayed_bedtime_min: 30 | 1/天 |
| 全家电影夜 | 200 | family_activity | 1/周 |
| 10 元零花钱 | 100 | cash: 10 | 2/周 |

#### 默认 earn 规则（家长可改）

| 完成 | 积分 |
|---|---|
| 数学作业全对 | 30 |
| 数学作业 80%+ | 20 |
| 数学作业 60-80% | 10 |
| 英语作文 | 25 |
| 跑步 1km | 5 |
| 主动按时完成所有任务 | 额外 +10 |
| 错题本复习 5 题 | 8 |
| 连续 7 天准时完成 | +50（streak bonus）|

#### 防作弊

- 同 task earn 不可重复
- 单日 earn 上限（默认 200，可改）
- AI 批改满分但调用 log 显示反复改答案 → 仅算 50%
- Guardians 的 grant 单笔限 100 + 单日总 300

#### 工程量

| 工作项 | 估时 |
|---|---|
| schema + migration | 0.5d |
| earn engine（M5 task 完成时触发）| 2d |
| spend engine（M4 联动临时白名单）| 2.5d |
| reward_catalog CRUD UI | 2d |
| balance + history UI（孩子端 + 家长端）| 2d |
| 防作弊规则 | 1.5d |
| 间隔重复 streak bonus | 1d |
| 单测 + 集成 | 2d |
| **合计** | **~13.5d** |

---

### 3.10 M10 — 家长教育 / 监管温和度（v0.2 新增）

#### 内容

- **微课程**：5-10min 视频 + 测试 + 案例。例：
  - "为什么 Apple Screen Time 把屏幕时间放在第二位（专注度 vs 时长）"
  - "陪伴比监控更有效——青春期沟通技巧"
  - "和 14 岁孩子谈手机的 5 个原则"
  - "什么是健康的家庭围栏"
  - "如何欣赏孩子的进步"
- **主动引导**：检测家长滥用强档（如 30 天内 force-stop > 50 次、强接通 > 10 次、拒绝率 > 80%）→ 推送相关课程
- **月报"监管温和度"**：
  - 取消率 / 拒绝率 / force-stop 频次 / 强接通频次 / 任务延期率 → 综合分 0-100
  - 与同类家庭对比（去隐私化的统计分布；不暴露其他家庭）
  - 例文："您本月监管温和度 65 分（同地区家长中等偏严）。建议关注：拒绝率较高（73%），可考虑调整规则……"

#### 与心理咨询合作

- 链接公益资源（12355 / 青基会 / 当地心理热线）
- 不替代专业，提供入口

#### 工程量

| 工作项 | 估时 |
|---|---|
| 微课程内容平台 + 视频播放器 | 3d |
| 5 节内容（脚本 + 视频外包）| 后端外包，工程 1d 接入 |
| 滥用检测引擎 + 自动推送 | 2d |
| 监管温和度算法 + 月报集成 | 2d |
| 同类家庭对比（去隐私化统计）| 1.5d |
| 心理资源外链 | 0.5d |
| 单测 + 集成 | 1.5d |
| **合计** | **~11.5d** |

---

## 4. 路线图（v0.2 修订）

```
┌─────────────────────────────────────────────────────────────────────┐
│  v0.1 MVP (7-9 周, v0.2 修订)                                        │
│  ────────────────────────────────                                   │
│  M1: FamilyFriend + family_group + 多家长冲突 + 紧急解绑 + TimeAuthority │
│  M2: L0 + L1 + 5 collector + AnomalyDetector v0 + 数据生命周期       │
│  M3: 双向 WebRTC + 静音旁观（Android 14+ 每次同意）                    │
│  M7: SOS 5 触发方式 + broadcast call                                  │
│  M8: 基础围栏（家/学校）+ 应到提醒                                      │
│  家长端: Dashboard v1 + 通话 + SOS 接收                                │
│  孩子端: 锁屏 SOS + 持久通知                                            │
│                                                                       │
│  价值: 能看孩子今天用了什么 app 多久 + 能视频 + 紧急时能 SOS + 知道孩子在哪 │
│                                                                       │
├─────────────────────────────────────────────────────────────────────┤
│  v0.2 (6-8 周)                                                       │
│  M4: 档 1 + 档 2（提示 + DPC）+ 异步规则引擎 + 多家长冲突解决            │
│  M5: 任务收发 + AI 批改（学习类）+ 防作弊 + 13 学科                     │
│  M6: 学习 tab v0.1（接 PDH 4 档 LLM 路由）                              │
│  M9: 积分系统 v0.1（earn + spend + 防作弊）                            │
│                                                                       │
│  价值: 禁特定 app 时段 + 派作业 + AI 批改 + 积分激励                     │
│                                                                       │
├─────────────────────────────────────────────────────────────────────┤
│  v0.3 (8-10 周)                                                      │
│  M4: 档 3（VPN + 支付审批）                                            │
│  M5: 作业自动导入（school 群分类器）                                    │
│  M6: 陪伴 tab + TEE 加密域 + 学情报告 + 护栏                            │
│  M5: 错题本 + 间隔重复 + 知识图谱                                       │
│  M2: L2 可选开 + 审计                                                  │
│  M10: 家长教育 v0.1（5 节课 + 滥用检测）                                │
│                                                                       │
│  价值: 完整教育闭环 + 心理陪伴 + 支付拦截 + 家长正确引导                  │
│                                                                       │
├─────────────────────────────────────────────────────────────────────┤
│  v1.0 (6 周)                                                         │
│  M4: 档 4（root + Magisk + 反卸载 + 反关无障碍）                       │
│  法律合规 review + 应用商店上架材料                                     │
│  M6: 月报 + 家长群（家长之间私聊，不做榜单）                             │
│  M8: 高级围栏（路线异常、培训班自动识别）                                │
│  M10: 月报"监管温和度" + 同类对比                                       │
│                                                                       │
│  价值: 强管控不可绕过 + 合规可上架                                       │
└─────────────────────────────────────────────────────────────────────┘
```

**总工期估算（v0.2 修订）**：~210d 单人 work，团队 2-3 人并行约 **27-33 周（5.5-8 个月）**

> v0.1 估算 18-22 周偏乐观，未考虑 M7/M8/M9/M10、法务前期、AccessibilityService 异步重构、TimeAuthority、TEE vault 等

### 4.5 离线降级（v0.2 新增）

每模块离线时的行为表：

| 模块 | 离线时 | 重连后 |
|---|---|---|
| M1 配对 | 已配对关系本地缓存，正常使用；新配对禁用 | 自动重新协商时钟（TimeAuthority） |
| M2 Telemetry | 写本地 outbox；上限 10MB；**满了丢老**（不阻塞采集）| 增量 push，受 backpressure 限制 |
| M3 通话 | 失败优雅提示"等回到网络再试" | 立刻可用 |
| M4 规则 | 本地规则缓存 7d 内仍生效；> 7d 降到温和档（防全断网锁死孩子）| 拉最新规则；rule_version 检测 |
| M5 任务 | 任务列表本地缓存；submission 缓存上传 | 上传 + 批改 |
| M6 AI 学习 | 走端侧 MediaPipe；不可时降到"等回网络再继续" | 自动恢复 |
| M6 AI 陪伴 | 仅端侧（TEE 域内）| 不上行 |
| M7 SOS | **仍可触发**：本地写 event + 走离线短信（如有 SIM）+ 自动尝试通话 | 网络恢复后批量推送家长 |
| M8 位置 | 仍记录到本地 location_point | 网络恢复批量上报 |
| M9 积分 | earn / spend 本地 + 缓存；冲突时记 audit | 网络恢复后家长端同步 + 冲突解决 |
| M10 家长教育 | 内容缓存（按需下载）| 自动同步进度 |

**TimeAuthority 离线行为**：
- 仍可用本地 `SystemClock.elapsedRealtime()` + 最后一次已知 offset 推算
- 超 48h 未与家长同步 → 时间规则降级温和档 + 弹孩子端"已长时间未与家长同步，规则放宽"

### 4.6 数据生命周期（v0.2 新增）

| 数据 | 保留期 | 删除策略 | 备注 |
|---|---|---|---|
| 通话录音 | 90d | 自动删 | SOS 录音 → 永久（法律证据） |
| 屏幕共享缓存 | 7d | 自动删 | 仅在主动旁观期暂存 |
| Telemetry L0 聚合 | 1y | 归档 | 月度统计可保留 |
| Telemetry L1 (app+时长) | 90d | 归档（聚合后删原始） | |
| Telemetry L2 (内容) | 30d 或触发审计才存 | 自动删 | 触发后单独标 |
| Telemetry L3 (屏幕) | 7d | 自动删 | |
| 错题本 | 永久 | 仅用户主动删 | 学习资产 |
| 任务历史 | 1y | 归档 | |
| 解绑后历史 | 90d | 90d 后硬删除 | 申诉冷却 |
| Audit log | 2y | 不可删 | 法律要求 |
| AI 陪伴对话 | 30d | 自动删 | TEE vault 内 |
| 位置历史 | 30d | 自动删 | |
| 围栏触发记录 | 1y | 归档 | |
| SOS 事件 | 永久 | 仅 acknowledge=resolved 后用户可申请删 | |
| 积分历史 | 永久 | 仅用户主动删 | |

**数据可携权 / 删除权 API**（合规要求）：
- 用户可导出全部加密备份（mediated decrypt 给本人）
- 用户可申请"被遗忘"——本人 DID 关联数据 90d 内硬删除（除 audit log）

---

## 5. 风险

### 5.1 法律 / 合规（最大风险，v0.2 扩展）

| 风险 | 应对 v0.1 | v0.2 落地动作 |
|---|---|---|
| 《未成年人保护法》知情同意 | 配对弹窗 + 持久通知 + 解绑冷却 | + 紧急解绑（M1）+ 复活码 |
| 《个人信息保护法》14 岁以下需监护人同意 | 配对时校验年龄 | + **PIA 报告 v1.0 前完成并备案**（PM + 法务）|
| 实名认证集成 | "v1.0 接入实名" | + **比价 3 家**：阿里云 ZIM / 腾讯实名 / 公安一所；选定后接入。预算 $0.5/次 × 用户 |
| L2/L3 采集合规 | 默认关 + 单独同意 + 审计 | （维持） |
| 应用商店审核 | 上架前预审 | + **国内主流 + 自分发 + GrapheneOS**；Google Play 几乎不可能上架完整版 |
| 数据存储合规 | 端到端 + SQLCipher + 不上云 | + **数据可携 / 删除 API**（§4.6） |
| 跨境数据 | 境内 only | + **境内 / 境外数据流隔离开关**，v0.1 起就要做（不能 v1.0 后再加） |
| 算法备案（M6 AI 推荐）| 未提 | + **网信办算法备案**，v1.0 前必须 |
| 自动报警（M7 兜底外部联系人）| 未提 | + 法务确认；可能改"提醒孩子手动拨打" 而非自动报警 |
| 监护权变更（离婚 / 抚养）| 未提 | + 法务流程 + 设备解绑 / 转移流程 |

### 5.2 技术风险

| 风险 | 应对 |
|---|---|
| MIUI / HyperOS DPC 兼容 | Spike 1 真机验；不兼容降级档 1 |
| AccessibilityService 被杀 | 多重保活栈（spike 3 §5.1） |
| AccessibilityService 性能 bomb | v0.2 异步规则引擎 + event 白名单（spike 3） |
| WebRTC 校园网 NAT 卡死 | TURN 兜底 + ICE timeout |
| Magisk OTA 失效 | 监测 + 用户引导重新 root |
| AI 护栏被绕过 | 双层检测 + 持续 red-team |
| MediaProjection Android 14+ 每次同意 | v0.2 改为单次 30min（spike 2） |
| 充值拦截误伤家长正常付费 | 白名单 + 家长账号识别 |
| 时钟绕过 | v0.2 TimeAuthority |
| 数据量爆炸 | v0.2 分钟聚合 + 数据生命周期 |
| 数据 / 带宽超载 | Sync backpressure 100KB/s 上限 |
| 复活码丢失 | 配对时告知用户保管；丢了 → 走法定监护流程申诉 |

### 5.3 心理 / 伦理

| 风险 | 应对 |
|---|---|
| 过度监控推孩子用备用机 | 私有时段 + 紧急解绑通道 + 陪伴 tab TEE 黑盒 + M10 家长教育 |
| AI 陪伴产生依赖 | 每日对话时长上限提示 + 鼓励真实社交 + 月报 |
| 错题本反复挫败感 | 间隔重复 + 渐进难度 + M9 积分奖励 |
| 家长看 telemetry 焦虑 | Dashboard 聚合视图 + 异常事件 push 冷却 + M10 温和度提示 |
| 静音旁观滥用 | Android 14+ 每次同意（spike 2） + 5min 复检 + 审计 + 孩子"暂停 2min" 配额 |
| 学情排名导致家长间攀比 | 不做榜单（边界条件） |
| 监护人滥用 / stalkerware | **紧急解绑通道**（M1）+ 复活码 |
| 偏负反馈毁亲子关系 | M9 积分奖励 + M10 家长教育（v0.2 核心新增） |

### 5.4 商业 / 产品

| 风险 | 应对 |
|---|---|
| 与系统级方案正面竞争 | 跨厂商 + 深入 app 内 + 端到端隐私 + AI 陪学差异化 |
| 第三方监控 app 红海 | ChainlessChain 整体生态融合 + 教育引擎 |
| 用户教育成本高 | 力求 3 分钟配对 + 视频教程 + 客服 + M10 课程 |
| root 设备要求门槛 | v0.1-v0.3 非 root（档 1+2+3）；档 4 仅 root 用户 |

---

## 6. 待评审决策（v0.2 扩展）

| ID | 决策项 | 倾向 | 备选 |
|---|---|---|---|
| D1 | v0.1 MVP 含静音旁观？ | ✅ 是 | 推迟 v0.2 |
| D2 | 陪伴 tab 对家长完全黑盒？ | ✅ TEE 加密 + stats_only 上报 | 完全开 / 完全关 |
| D3 | DPC 注册时机？ | 用户引导 + 文档 | 自动检测 + 一键引导 |
| D4 | 私有时段上限？ | ✅ 4h/天 | 不限 / 2h |
| D5 | 错题本数据归属？ | ✅ 孩子主，家长可读 | 家长主 / 隔离 |
| D6 | 应用商店上架策略？ | ✅ 国内主流 + 自分发 + 海外 GrapheneOS | 仅自分发 / 仅 Google Play |
| D7 | 多孩子 / 多设备 | ✅ v0.1 即支持（家庭组）| v0.2 |
| D8 | 海外策略 | ✅ v0.1 起架构隔离，仅发国内 | v2.0 再说 |
| **D9（v0.2 新）** | 商业模式 | ✅ Freemium：基础免费 + 高级订阅（AI 批改 / 月报详版 / 多孩子）| 完全免费 / 完全订阅 / 设备绑定 |
| **D10（v0.2 新）** | M7 SOS 兜底外部联系人 60s 后自动呼？| ⚠️ 法务确认；倾向"提醒手动拨打" | 自动报警 / 不接入外部 |
| **D11（v0.2 新）** | M9 积分换屏时间机制？| ✅ 走，但单日 spend 有上限 + 家长可关 | 不做 |
| **D12（v0.2 新）** | M1 紧急解绑触发后是否通知家长？| ✅ 通知"已请求紧急解绑"但失去数据访问 | 完全静默（更隐秘但可能让家长焦虑追问）|

---

## 7. 与其他模块的关系

| 模块 | 关系 |
|---|---|
| PDH | 强复用：collector 框架 / vault.db / LLM 路由 / sync；新增 5-8 collector + 亲子默认级别矩阵 |
| Remote Operate（Plan A/A.1/C）| 复用通话 + 屏幕推送基础 |
| DID v2 | 复用身份 + 互信凭证签名 |
| Friend / Social 子系统 | 强复用：FamilyFriend = friend 子类型 |
| Phase 3d Mobile Sync | 复用 sync 框架 + 权限过滤 + backpressure |
| Skills System | 派生 family.* 类 skill |
| Knowledge Graph | M5 error_book.knowledge_node 接 KG |
| Push Vendor | 复用 PushVendorRegistry 适配 ROM |

---

## 8. 与现有 trap / memory 的关联

启动开发前必读：

- [[android_pdh_split_brain_vault]] — vault 验证 HOME 注意
- [[miui_query_all_packages_silently_blocked]] — DPC + app 检测 MIUI 限制
- [[android_wechat_collector_phase_12_10]] — 自启拉活 + Magisk 参考
- [[android_bootstrap_singleton_mutex_race]] — Bootstrap race
- [[bilibili_post_onload_cookie_race]] — WebView cookie 时序
- [[pdh_4tier_llm_route_card_selector]] — M6 LLM 路由复用
- [[android_qq_collector_phase_13_5]] — collector 模板
- [[android_remote_terminal_plan_a_diagnosis]] — Plan A.1
- [[android_remote_operate_plan_c_first]] — Plan C
- [[phase_3b_3c_sync_feature]] / [[phase_3d_mobile_sync_landing]] — Sync 框架

v0.2 新增 trap 候选：
- `family_clock_skew_detection.md` — TimeAuthority
- `companion_tab_tee_keystore.md` — 陪伴 TEE 加密
- `family_multi_parent_conflict_resolution.md` — 多家长规则冲突
- `emergency_unbind_revival_code.md` — 紧急解绑
- `geofence_battery_strategy.md` — 围栏省电策略

---

## 9. 下一步

如方案方向通过：

1. **法务并行启动**：起草《知情同意书》+ PIA 模板 + 应用商店上架材料 + 实名供应商比价
2. **拆 v0.1 MVP ticket 树**：M1+M2+M3+M7+M8 子任务，约 40-50 个 issue
3. **技术 spike**（并行 1 周）：
   - DPC 在 5 个 ROM 兼容性 → [Spike 1 + AOSP runbook]
   - mobile↔mobile WebRTC 改造 → [Spike 2]
   - AccessibilityService 5min 持久横幅各 ROM → [Spike 3]
4. **真机 baseline**：找一台 root 干净 AOSP，按 [AOSP runbook] 跑基线
5. **PM 决策**：D9-D12 4 个新决策
6. **预算定**：[§12](#12-资源预算) 给硬数字

---

## 10. PDH collector 矩阵速查表

见 [§3.2.4](#324-pdh-17-collector-在亲子场景的默认级别)

---

## 11. 商业模式（v0.2 新增）

### 11.1 候选方案

| 方案 | 收入模式 | ARPU 估 | 适合阶段 |
|---|---|---|---|
| 完全免费 | 0 | 0 | 不可持续（运维成本超）|
| 全订阅 | ¥30-50/月 | ~¥420/年 | 增长慢 |
| Freemium（推荐）| 基础免费 + 高级订阅 | ¥10-30/月（10-20% 转化）| 增长 + 盈利平衡 |
| 设备绑定 | ¥299-799 一次性买孩子端硬件 | 1500-3000 一次 | 360 儿童手表模式 |

### 11.2 推荐方案：Freemium

| 功能 | 免费 | 高级 |
|---|---|---|
| 配对 / 通话 / 基础 dashboard | ✅ | ✅ |
| L0 + L1 telemetry | ✅ | ✅ |
| M4 档 1 + 档 2 | ✅ | ✅ |
| M5 任务（含 5/月 AI 批改）| ✅ | ✅ |
| M7 SOS + M8 围栏 | ✅ | ✅ |
| M9 积分 | ✅ | ✅ |
| **M4 档 3 + 档 4** | ❌ | ✅ |
| **M5 不限 AI 批改** | ❌ | ✅ |
| **M6 学情月报详版** | ❌ | ✅ |
| **L2 + L3 telemetry** | ❌ | ✅ |
| **多孩子（>1）** | ❌ | ✅ |
| **M10 家长教育** | 仅基础 5 课 | 全部 + 心理咨询入口 |

### 11.3 价格

- 高级：¥19.9/月 / ¥199/年（年付折扣）
- 团购：3 家庭同购 7 折
- 教育优惠：教师 / 单亲 / 困难家庭 5 折申请

### 11.4 收入预测（v1.0 第一年）

- 用户数（v1.0 6 个月）：~50,000 家庭
- 高级转化率：15%
- ARPU 年：~¥199
- 年收入：50,000 × 15% × 199 = **¥1,492,500** （约 150 万）

需 PM + 财务确认 D9（[§6 决策](#6-待评审决策v02-扩展)）

---

## 12. 资源预算（v0.2 新增）

### 12.1 孩子端运行时预算（24h 持续运行）

| 模块 | CPU 平均 | RAM | 日电量 |
|---|---|---|---|
| FamilyGuardForegroundService | <0.5% | <30MB | 1-2% |
| AccessibilityService（白名单 + 异步）| <2% | <50MB | 4-5% |
| ForegroundAppTimer（分钟聚合）| <0.1% | <10MB | <1% |
| TimeAuthority 同步 | <0.1% | <5MB | <1% |
| M2 PDH collectors（定时执行）| <1%（平均）| <80MB（峰值）| 1-2% |
| M8 位置（围栏内静止 10min）| <0.3% | <15MB | 1-2% |
| MediaProjection（仅开时）| <8% | <80MB | <8%/小时（开时）|
| **总（24h 后台运行）** | **<4%** | **<200MB** | **<12%/天** |

超出预算 → 不准发布

### 12.2 数据 / 带宽预算

| 项 | 1 孩子/天 | 1 孩子/年 |
|---|---|---|
| Raw telemetry（采集前）| ~50-100MB | ~25GB |
| Optimized 存储（聚合 + 压缩后）| ~5-10MB | ~2-3GB |
| Sync 上行（增量 delta）| ~1-5MB | ~500MB-1.5GB |
| 通话 + 屏幕（按需）| 0-500MB | — |
| SQLCipher 占用（持续运行）| — | ~2-3GB |

### 12.3 LLM 成本预算

| 项 | 单次 | 频次 | 月度成本 |
|---|---|---|---|
| 学习 tab 对话 | $0.005 | 50 次/家 | $0.25 |
| 陪伴 tab 对话 | $0.005 | 100 次/家 | $0.50 |
| AI 批改 task | $0.02 | 30 次/家 | $0.60 |
| 月报生成 | $0.03 | 1 次/家 | $0.03 |
| **总月 LLM 成本** | — | — | **~$1.4/家庭/月** |

按 ¥10 = $1.4 算，单家庭 ¥10/月 LLM 成本，订阅 ¥19.9/月剩 ¥10 给运维 + 利润，**可持续**

### 12.4 单家庭综合月成本

| 项 | 成本 |
|---|---|
| LLM | $1.4 (¥10) |
| 服务器（信令 / TURN 中继）| ¥1.5 |
| 推送 / 短信（SOS）| ¥0.5 |
| 客服分摊 | ¥1.5 |
| **合计** | **~¥13.5/家庭/月** |

订阅 ¥19.9 → 毛利 ¥6.4/家庭/月（32%）。可承受。

---

> 文档版本：v0.2（2026-05-28）
> 撰写：Claude (longfa session)
> v0.1 → v0.2 变更：见文档头部 TL;DR 上方变更摘要
> 评审：待
> 实施：待

## 附录：规范章节补全（v5.0.3.108）

> 本文为产品 / 架构主设计文档（草案 v0.2）。为对齐项目文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文细节。

### 1. 概述

见正文「0. TL;DR」「1. 背景与定位」。AI 陪学是家庭守护（family-guard）下的 AI 陪学 / 陪伴产品，目标版本 v5.1.0：双轨（学习引导 + 情感陪伴）chat、错题本 RAG、端侧护栏、学情报告、任务联动、积分奖励、家长教育月报。

### 2. 核心特性

学习/陪伴双 tab；错题本 RAG；第 2 层端侧护栏（命中只记类别+时间不存原文）；学情报告；M5 任务联动防作弊；M9 积分引擎；M10 家长教育月报（含 12355 公益热线）。

### 3. 系统架构

见正文「2. 总体架构」「3. 模块详设」；`:app/aistudy`（陪学，复用全局 AI 配置）+ `:feature-family-guard`（任务持久层）。

### 4. 系统定位

家庭守护的**AI 陪学 / 陪伴子产品**（v5.1.0）。

### 5. 核心功能

见正文「3. 模块详设」：学习引导（不直接给答案）/ 陪伴（TEE 加密金库落盘）/ 任务（StudyTask）/ 积分（PointsEngine）/ 家长月报（ParentEducationEngine）。

### 6. 技术架构

Android Compose + Room（family_task v6→v11 迁移）；端侧 LLM（MediaPipe）+ 云 AI；陪伴经 Keystore（StrongBox）AES-GCM 加密落盘；纯函数核（可单测、零设备）。

### 7. 系统特点

纯逻辑层全做透（可单测）；剩余 device/UI/真机/PM 阻塞；陪伴 chat TEE 加密（家长 dump 也只得密文）。

### 8. 应用场景

家长为孩子提供 AI 学习引导 + 情感陪伴，配合任务 / 积分 / 温和度月报。

### 9. 竞品对比

见正文「1. 背景与定位」差异化（学习引导不给答案 + 端侧隐私护栏 + 家长温和度监管）。

### 10. 配置参考

复用全局 AI 配置；订阅 ¥19.9/家庭/月（见正文商业模型）。

### 11. 性能指标

见正文「5. 风险」与商业模型（毛利 ¥6.4/家庭/月，32%）。

### 12. 测试覆盖

纯逻辑层大量单测（PointsEngine 23 / ParentEducationEngine 18 等）；DB 迁移 6.json–11.json diff 对齐；真机 E2E 阻塞。

### 13. 安全考虑

端侧护栏（命中只记类别+时间不存原文）；陪伴 Keystore/StrongBox AES-GCM 加密落盘；防作弊 log 只记 taskId+时间+类别。

### 14. 故障排除

见正文「5. 风险」「8. 与现有 trap / memory 的关联」（family_guard.db WAL PRAGMA / 主线程 keystore ANR 等）。

### 15. 关键文件

`:app/aistudy`（AiStudyScreen/VM/PointsEngine/ParentEducationEngine/MistakeBook/GuardrailClassifier）；`:feature-family-guard`（FamilyTaskRepository + Room）。

### 16. 使用示例

见正文「3. 模块详设」各模块流程（学习引导 / 陪伴 / 任务 / 积分 / 月报）。

### 17. 相关文档

`AI陪学_v0.1_ticket_tree.md`（§4 路线图 ticket 树）、memory `family_aistudy_m6_mvp.md` / `family_clock_skew_detection.md`。
