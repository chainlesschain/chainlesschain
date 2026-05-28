# AI 陪学 v0.1 MVP — Ticket 树

> **撰写日期**：2026-05-28
> **关联**：[AI陪学_主文档.md](AI陪学_主文档.md) §4 路线图 v0.1
> **目标周期**：7-9 周（团队 2-3 人并行）
> **目标产物**：可演示的 v0.1 MVP（看 + 通话 + 配对 + SOS + 基础围栏）
> **Ticket 命名**：`FAMILY-NN` 占位（导入 Linear / Jira / GitHub Issues 后替换）

---

## Epic 索引

| Epic | 范围 | Ticket 数 | 估时 |
|---|---|---|---|
| **A. Foundation**（脚手架 / DID / 模块）| FAMILY-01..09 | 9 | ~12d |
| **B. M1 FamilyFriend** | FAMILY-10..19 | 10 | ~22d |
| **C. M2 Telemetry** | FAMILY-20..28 | 9 | ~23d |
| **D. M3 Live Comm** | FAMILY-30..37 | 8 | ~23.5d |
| **E. M7 SOS** | FAMILY-40..46 | 7 | ~15d |
| **F. M8 Geofence** | FAMILY-50..56 | 7 | ~15.5d |
| **G. Cross-cutting / Infra** | FAMILY-60..67 | 8 | ~14d |
| **总计** | | **58** | **~125d** |

按团队 2-3 人并行 → **7-9 周**

---

## 关键路径

```
A1 Module scaffold ─▶ A2 schema migration
                   │
A3 DID v2 reuse ───┼──▶ B1 family_group ─▶ B2 Flow C QR ─▶ B3 配对端到端
                   │                                      │
                   └──▶ G1 TimeAuthority ─────────────────┤
                                                          ▼
       ┌──────────────────┬───────────────────────────┬───┴───┬──────┐
       ▼                  ▼                           ▼       ▼      ▼
  C* Telemetry        D* WebRTC                    E* SOS  F* 围栏  B4-9
  (并行)               (并行)                       │       │
                          │                          │       │
                          └──────────────────────────┴───────┘
                                  (E1 SOS 依赖 D* + F1)
```

---

## Epic A — Foundation（脚手架 + 共享基础）

### FAMILY-01 — 新建 :feature-family-guard Gradle module

- **范围**：Android 创建 `:feature-family-guard` module；Hilt + Compose + Coroutine 标配；引入到 `:app/build.gradle.kts` 依赖
- **估时**：1d
- **依赖**：—
- **验收**：`./gradlew :feature-family-guard:assembleDebug` 绿；空 module 可被 `:app` import
- **owner 建议**：Android tech lead

### FAMILY-02 — SQLCipher schema migration 框架接入

- **范围**：在 `:feature-family-guard/data/` 加 Room/SQLCipher Database；migration framework 复用 PDH（vault.db 模式）；预留 7 个表（family_group / family_membership / family_relationship / sos_event / location_point / geofence / enforce_rules）的 placeholder
- **估时**：1.5d
- **依赖**：FAMILY-01
- **验收**：empty migration v1 跑通；schema dump 7 table 存在
- **trap 关联**：[[better_sqlite3_text_number_trap]] / [[pdh_partial_index_if_not_exists_drift]]

### FAMILY-03 — DID v2 + Friend 子系统复用接入

- **范围**：在 family-guard module 中通过 Hilt 注入 `DidManager` + `FriendRepository`；定义 `FamilyFriend = Friend with type='family'`
- **估时**：1d
- **依赖**：FAMILY-01
- **验收**：单测验证可读现有 friend list + 可标记/取消 family type

### FAMILY-04 — UI Shell：家长 / 孩子角色首启选择器

- **范围**：app 首启检测无 `family_relationship` → 弹角色选择"家长 / 孩子"；本地持久 `local_role` 字段；角色锁定 24h（防误选）
- **估时**：1.5d
- **依赖**：FAMILY-01
- **验收**：3 个 UI state（未选 / 已选锁定中 / 已锁）+ 单测验证 24h 锁

### FAMILY-05 — 持久化通知 Channel（FamilyGuardForegroundService 骨架）

- **范围**：参考 `LocationForegroundService` 模板，新建 `FamilyGuardForegroundService`；2 个 NotificationChannel（LOW 普通 / HIGH 旁观）；启动后桌面图标可见
- **估时**：1.5d
- **依赖**：FAMILY-01
- **验收**：服务启动 + 通知显示 + 滑掉后立刻重新 attach（24h 不丢）

### FAMILY-06 — DocApp Routing 接入

- **范围**：app 内底部 tab 注册"家人" / "AI 陪学" / "任务"（v0.1 只激活"家人"+"AI 陪学" + SOS 大红按钮，其他灰显）
- **估时**：1d
- **依赖**：FAMILY-01

### FAMILY-07 — AndroidManifest 权限声明 batch

- **范围**：补声明所有新权限：FOREGROUND_SERVICE_SPECIAL_USE / ACCESS_FINE_LOCATION / ACCESS_COARSE_LOCATION / ACCESS_BACKGROUND_LOCATION / FOREGROUND_SERVICE_LOCATION / RECORD_AUDIO / SYSTEM_ALERT_WINDOW / POST_NOTIFICATIONS / BIND_ACCESSIBILITY_SERVICE（不实装）
- **估时**：0.5d
- **依赖**：FAMILY-01

### FAMILY-08 — 复活码生成器（M1 紧急解绑前置）

- **范围**：实现 6 位数字复活码生成（CSPRNG）+ 配对时一次性显示 + 离线保管 UI 提示；本地存 SHA256(salt+code)
- **估时**：1d
- **依赖**：FAMILY-02

### FAMILY-09 — 测试 fixture / mock 框架

- **范围**：新建 `:feature-family-guard/src/test/.../fixtures/FamilyFixtures.kt`；提供 fakeFamilyGroup / fakeChild / fakeParent / fakeRelationship 生成器；mockk + Hilt test injection 框架对齐 [[android_phase_6_quarantine_infra]]
- **估时**：1.5d
- **依赖**：FAMILY-02 / FAMILY-03
- **验收**：3 个 fixture builder 跑通 + 1 个端到端冒烟测试

---

## Epic B — M1 FamilyFriend

### FAMILY-10 — family_group 表实装 + Repository

- **范围**：`family_group` schema 落地 + Room DAO + Repository CRUD；含 primary_did 校验 + metadata JSON 校验
- **估时**：1d
- **依赖**：FAMILY-02
- **验收**：8 个单测覆盖 CRUD / 边界

### FAMILY-11 — family_membership 表 + 多孩子 / 多家长支持

- **范围**：schema + Repo；唯一约束 `(group, member, device)`；查询 API "获取本组所有 children / 本组所有 guardians by tier"
- **估时**：1.5d
- **依赖**：FAMILY-10
- **验收**：1 group 加 2 parent (primary) + 2 child + 1 secondary guardian 不重复

### FAMILY-12 — family_relationship 表 + permissions JSON schema

- **范围**：schema + Repo；permissions JSON Kotlin 类型化封装；20+ 权限字段；validator
- **估时**：2d
- **依赖**：FAMILY-10
- **验收**：JSON 序列化 round-trip + 默认权限模板（family/parent）测试

### FAMILY-13 — Flow C QR 配对端到端

- **范围**：家长端 QR 生成（含 invite_token TTL 10min Ed25519 sig）+ 孩子端扫码 + 校验 sig + 二次密码 + KYC 提示（<14 岁）+ 双方签互信凭证 + 双方写库
- **估时**：3d
- **依赖**：FAMILY-03 / FAMILY-08 / FAMILY-10 / FAMILY-11 / FAMILY-12
- **验收**：模拟器端到端配对 OK + 凭证签名验证 + KYC 提示分支

### FAMILY-14 — 权限矩阵 + Permission Engine

- **范围**：实现 `FamilyPermissionChecker` Hilt 服务；每个 action 单点调用 `check(action, targetDid)`；返回 allow / deny + reason
- **估时**：2d
- **依赖**：FAMILY-12
- **验收**：21 个 action 全覆盖单测（参考主文档 §3.1 权限矩阵表）

### FAMILY-15 — 解绑状态机 + 24h 冷却

- **范围**：unbind_request / cooldown / 撤销 / 强制解绑（>30h 单方）全状态流转；后台 worker 跑定时器
- **估时**：2.5d
- **依赖**：FAMILY-12
- **验收**：5 个状态转换 happy path + 3 个边界（双方撤销 / 一方撤销 / 超时）单测

### FAMILY-16 — 紧急解绑通道（复活码触发）

- **范围**：登录页隐藏入口"输复活码" + 验证 + 立刻 freeze 上行 + 失败 3 次锁 24h；触发后写 `emergency_unbind_*` + 通知外部联系人（外部联系人接入留 stub）
- **估时**：2d
- **依赖**：FAMILY-08 / FAMILY-15
- **验收**：复活码正确 → freeze；错 3 次 → 24h 锁；锁中拒绝服务

### FAMILY-17 — 多家长冲突解决引擎

- **范围**：`RuleMerger` 工具类：app_time_limit 取最严 / blocklist 并集 / payment_cap 取最严 / approval 一票否决；source_priority 字段
- **估时**：2d
- **依赖**：FAMILY-11 / FAMILY-12
- **验收**：5 种冲突场景单测全覆盖

### FAMILY-18 — UI：家人页 + 角色徽章 + 持久通知文案

- **范围**：Compose 家人 tab：列表显示所有 family member + 角色徽章（👨‍🦱 爸/👩 妈/👶 娃/👴 爷）+ 状态点（online/offline/SOS）；FamilyGuardForegroundService 通知文案按 family_relationship 状态动态变（监管中 / 旁观中 / 待机 / 紧急）
- **估时**：3d
- **依赖**：FAMILY-05 / FAMILY-11
- **验收**：手动验证 4 角色 + 4 状态 UI snapshot

### FAMILY-19 — 自启拉活 + 反卸载（复用 WeChat collector 模式）

- **范围**：BootReceiver + AlarmManager 兜底；监测 self 包被卸载 → 自动从 `/data/local/tmp/recovery.apk` 重装（root 需）；复用 [[android_wechat_collector_phase_12_10]] 模式
- **估时**：3d
- **依赖**：FAMILY-05
- **验收**：开机自启 < 60s；卸载后自动恢复（root 真机）

---

## Epic C — M2 Telemetry

### FAMILY-20 — ForegroundAppTimer 后台服务 + 分钟聚合

- **范围**：复用 UsageStatsManager；每分钟一次轮询；同 app 连续 30min 聚合为一行；写 `child_events`
- **估时**：1.5d
- **依赖**：FAMILY-02
- **验收**：1h 录制 → 数据正确 + 聚合压缩比 ≥ 25x

### FAMILY-21 — child_events schema + telemetry source 抽象

- **范围**：schema（id, child_did, source, kind, payload, timestamp, level）+ TelemetrySource interface（PDH / Foreground / Snapshot / Accessibility）
- **估时**：1.5d
- **依赖**：FAMILY-02

### FAMILY-22 — Plan C snapshot writer 接 child_did 维度

- **范围**：复用现有 Plan C snapshot writer + 加 child_did 维度；通讯录 / 通话记录 / 短信 / 通知历史
- **估时**：1d
- **依赖**：FAMILY-21

### FAMILY-23 — PDH 5 个新 collector（王者/原神/作业帮/支付宝/华为学习中心）

- **范围**：参照 [[android_qq_collector_phase_13_5]] 模板加 5 个 collector；每个含 ApiClient + Store + Collector + JVM unit test；ApiClient 仅 cookie scrape（v0.1 不做签名）
- **估时**：8d（每 1.5-2d）
- **依赖**：FAMILY-21
- **验收**：5 collector 各跑通 dry-run；events 入 vault
- **可并行**：5 个 collector 可由不同 dev 并行

### FAMILY-24 — Quiet Hours engine + 4h/天上限

- **范围**：实现 quiet_hours 解析 + 命中判断 + 单日累计上限校验（默认 240min）；超上限 → 拒绝设置 + UI 提示
- **估时**：1d
- **依赖**：FAMILY-12

### FAMILY-25 — Telemetry 上行权限过滤层

- **范围**：Sync Engine outbox 写入前调 `FamilyPermissionChecker` + quiet_hours 命中 + apps_blocklist 命中 → drop；redact L2/L3 字段
- **估时**：2d
- **依赖**：FAMILY-14 / FAMILY-21 / FAMILY-24

### FAMILY-26 — Sync engine backpressure（100KB/s）

- **范围**：Sync outbox 加 backpressure；outbox 上限 10MB，满了 DROP_OLDEST；上行速率限制 100KB/s（token bucket）
- **估时**：2d
- **依赖**：FAMILY-25
- **验收**：人造 100MB outbox → 上行不超速 + 老数据被丢弃

### FAMILY-27 — AnomalyDetector v0（5 条规则）

- **范围**：后台 Worker 每 15min 跑；规则：单 app > 90min / 凌晨亮屏 / 单日游戏 > 3h / 未知 app 首次进入 / 充值 intent 高频；触发后写 anomaly 表 + 推家长
- **估时**：3d
- **依赖**：FAMILY-21
- **验收**：5 规则单测全覆盖 + 触发后家长端收 push

### FAMILY-28 — 数据生命周期清理 Worker

- **范围**：每日 03:00 跑清理 Worker；按主文档 §4.6 表删 / 归档；含 audit log 写入
- **估时**：2d
- **依赖**：FAMILY-21 / FAMILY-22

---

## Epic D — M3 Live Comm

### FAMILY-30 — WebRTCClient mobile↔mobile 对等改造

- **范围**：按 Spike 2 §5.1 加 `isInitiator: Boolean` 分岔；createOffer / waitForOffer 双路径；pcPeerId → targetPeerId 重命名
- **估时**：2.5d
- **依赖**：FAMILY-01
- **验收**：两台模拟器同 LAN 跑通 offer/answer/ICE/媒体

### FAMILY-31 — CallNegotiator 角色协商（字典序 + collision）

- **范围**：双方同时 connect → 按 peerId 字典序选 initiator；200ms collision 重试；echo-loop 防御（localPeerId != targetPeerId assert）
- **估时**：1d
- **依赖**：FAMILY-30
- **验收**：人造 collision 测试通过

### FAMILY-32 — CallKind 枚举 + 5 类 track 配置

- **范围**：AUDIO / VIDEO / SILENT_OBSERVE / URGENT / SOS_BROADCAST；每个 addTrack 前调 FamilyPermissionChecker；红色横幅 / 持久横幅按需挂
- **估时**：2d
- **依赖**：FAMILY-30 / FAMILY-14
- **验收**：5 类 call 启动 + 权限拒绝路径都跑通

### FAMILY-33 — IceServerConfig 双向化 + PairedPeersStore 重命名

- **范围**：`PairedDesktopsStore` → `PairedPeersStore`；ICE config 双端各自存；ephemeral token mode prep
- **估时**：1d
- **依赖**：FAMILY-30

### FAMILY-34 — family.call.* envelope 6 method 实装

- **范围**：family.call.invite / accept / reject / silent_observe / urgent_force / hangup；TerminalRpcClient 模板派生 `FamilyCallRpcClient`；LRU 去重 callId|seq
- **估时**：2d
- **依赖**：FAMILY-30

### FAMILY-35 — 静音旁观：Android 14+ 每次同意 + 30min 自动断

- **范围**：MediaProjection 启动每次弹系统对话框；启动后 30min 倒计时自动断；显示 SilentObserveOverlay + 5min 复检；记审计
- **估时**：3.5d
- **依赖**：FAMILY-32
- **验收**：Pixel 8 (Android 14) 真机验证

### FAMILY-36 — 强接通配额（24h 限 3 次）

- **范围**：UrgentCallQuota 服务；持久化 SharedPreferences；超额降级普通呼叫；UI 显示剩余配额
- **估时**：1.5d
- **依赖**：FAMILY-32

### FAMILY-37 — ParentCallScreen + ChildIncomingCallScreen UI

- **范围**：Compose 双端通话 UI；显示对方角色 / kind / 剩余时间 / 持久横幅；含 5 类 CallKind 区分 UI
- **估时**：4d
- **依赖**：FAMILY-32

---

## Epic E — M7 SOS

### FAMILY-40 — sos_event schema + Repository

- **范围**：schema + DAO + Repo；trigger_source enum；status 状态机
- **估时**：0.5d
- **依赖**：FAMILY-02

### FAMILY-41 — 5 触发方式实装

- **范围**：
  - 音量减键 5 连击：注册 `dispatchKeyEvent` + counter + 500ms 重置
  - 锁屏 SOS 按钮：Notification action + lock-screen widget
  - 应用内大红按钮：Compose 在 home tab 固定位
  - 密语关键词：陪伴 tab 输入触发，user 自定密语
  - 智能手表配对手势：v1.0+ 留 stub
- **估时**：4d
- **依赖**：FAMILY-40 / FAMILY-06
- **验收**：4 种触发方式各跑通（手表留 stub）

### FAMILY-42 — 静音录音 + 30s 限时 + 加密存

- **范围**：MediaRecorder 32kbps AAC；30s 后停止；写本地 SQLCipher 加密文件；上传 P2P
- **估时**：1.5d
- **依赖**：FAMILY-40
- **验收**：30s 录音文件 < 200KB + 加密存储

### FAMILY-43 — broadcast call（家长端任一接通）

- **范围**：复用 FAMILY-34；同时向所有 guardian 发 family.call.invite；任一接通即 status=acknowledged；其他 guardian 收 "已接通" 提示
- **估时**：2d
- **依赖**：FAMILY-34 / FAMILY-40
- **验收**：2 guardian 并发，第一个接通后第二个收提示

### FAMILY-44 — 误触撤销 + 状态机

- **范围**：5min 内可撤销 + 输入原因；写 status=false_alarm；通知 guardian 撤销
- **估时**：1d
- **依赖**：FAMILY-40

### FAMILY-45 — 60s 兜底外部联系人推送

- **范围**：60s 内无 guardian acknowledge → 推 emergency_contacts；含位置 + 联系方式；推送方式 v0.1 用 SMS（云厂商短信 API）；自动报警留 D10 决策
- **估时**：1.5d
- **依赖**：FAMILY-43 / FAMILY-12

### FAMILY-46 — SOS UI + 高优 push

- **范围**：孩子端"SOS 已发送"全屏提示 + 5min 撤销按钮 + 倒计时；guardian 端锁屏全屏弹"⚠️ [孩子] SOS 求助" + 接通按钮（绕过勿扰）
- **估时**：2.5d
- **依赖**：FAMILY-40 / FAMILY-43

---

## Epic F — M8 Geofence

### FAMILY-50 — location_point + geofence schema

- **范围**：两表 schema + DAO + Repo；geofence kind enum（home/school/class/banned）
- **估时**：0.5d
- **依赖**：FAMILY-02

### FAMILY-51 — LocationManager + FusedLocationProvider 集成

- **范围**：复用 Google Play Services LocationServices；按场景调频（围栏内 10min / 围栏外 1min / SOS 后 5s）；省电策略
- **估时**：2d
- **依赖**：FAMILY-50
- **验收**：3 种场景频率切换正确 + 电量 < 1.5%/天

### FAMILY-52 — Geofencing API 集成 + 边界检测

- **范围**：复用 Android Geofencing API；on_enter / on_exit / on_dwell 事件；批量注册（API 限单 app 100 围栏）
- **估时**：2.5d
- **依赖**：FAMILY-51

### FAMILY-53 — Geofence CRUD UI（家长端 + 地图选点）

- **范围**：家长端 Compose 围栏列表 + 创建（地图选点 / 半径滑块）/ 编辑 / 删除；schedule 编辑（按 weekday + 时段）；高德 SDK 或 OSM Compose tile
- **估时**：3d
- **依赖**：FAMILY-50
- **验收**：手动验证创建"家"+"学校" 2 围栏

### FAMILY-54 — on_enter / on_exit / on_late 动作引擎

- **范围**：动作 dispatcher：notify_parent / silent / unlock_app / lock_app / 切规则；on_late 比较 expected_arrival 时间
- **估时**：2.5d
- **依赖**：FAMILY-52 / FAMILY-14

### FAMILY-55 — M2 联动：异常停留 30min 触发

- **范围**：围栏外停留 30min → 写 anomaly + 推家长（AnomalyDetector 加 1 规则）
- **估时**：1d
- **依赖**：FAMILY-27 / FAMILY-52

### FAMILY-56 — 上报省电策略 + 电池低时降频

- **范围**：电池 < 15% → 频率 × 50%；推家长"孩子手机快没电了"；location_point 加 battery_pct 字段
- **估时**：1.5d
- **依赖**：FAMILY-51

---

## Epic G — Cross-cutting / Infra

### FAMILY-60 — TimeAuthority 服务（防时钟绕过）

- **范围**：NTP-style 时间同步：每 30min 拉家长端时间 + Cristian 算法估单程；本地 `SystemClock.elapsedRealtime()` + offset；检测到 wall clock skew > 5min → 锁所有时间约束功能
- **估时**：2d
- **依赖**：FAMILY-13（配对完成后才能拉对方时间）
- **验收**：单测验证 NTP 算法 + 人造时钟跳变触发锁定
- **新增 trap memory**：`family_clock_skew_detection.md`

### FAMILY-61 — 推送通道适配（FCM / 国内 PushVendor）

- **范围**：复用 `PushVendorRegistry`；高优消息（SOS / 异常）走厂商通道；其他走 P2P；PRIORITY_MAX + bypass_dnd 配置
- **估时**：2d
- **依赖**：FAMILY-07

### FAMILY-62 — Family Group Chat 协商频道（多家长私聊）

- **范围**：复用现有 friend chat；为 family_group 创建群聊；guardians 间冲突自动推到该频道；不开放给 child
- **估时**：2d
- **依赖**：FAMILY-11

### FAMILY-63 — Audit log + 持久审计

- **范围**：所有家庭动作（配对 / 解绑 / 规则修改 / SOS / 强接通 / 静音旁观 / 暂停）写不可删 audit_log；2 年保留；提供查询 API
- **估时**：1.5d
- **依赖**：FAMILY-02

### FAMILY-64 — 法律合规前置（PIA 模板 + 知情同意书）

- **范围**：法务 + PM 主导；起草《未成年信息采集与使用知情同意书》+ PIA 模板；配对 UI 必经知情同意页
- **估时**：3d（法务 2d + 工程对接 1d）
- **依赖**：—
- **owner 建议**：PM + 法务，工程协助

### FAMILY-65 — 实名认证供应商比价 + 接入预研

- **范围**：调研阿里云 ZIM / 腾讯实名 / 公安一所；价格 / 调用 / 隐私协议对比；选 1 家做 spike 接入；为 <14 岁 KYC 留接口
- **估时**：2d
- **依赖**：—
- **owner 建议**：PM + 后端
- **注**：v0.1 不强求实装，只做对接接口；v1.0 前必接

### FAMILY-66 — 端到端集成测试套件

- **范围**：5 个端到端场景：
  1. 家长端 + 孩子端 模拟器配对
  2. Telemetry 上行 + 家长端 dashboard 显示
  3. 家长发起视频通话 + 孩子接听
  4. 孩子触发 SOS + 家长 broadcast 接通
  5. 围栏触发 on_enter + on_late
- **估时**：3d
- **依赖**：FAMILY-13 / FAMILY-21 / FAMILY-30 / FAMILY-40 / FAMILY-52

### FAMILY-67 — Dashboard v1 + 5 块 UI

- **范围**：家长端 home tab 5 块：
  - 今日时长聚合（M2）
  - 当前位置 + 围栏状态（M8）
  - 待处理 SOS（M7）
  - 异常事件（AnomalyDetector）
  - 一键呼叫
- **估时**：4d
- **依赖**：FAMILY-21 / FAMILY-43 / FAMILY-52
- **验收**：5 块独立加载 + 整体 < 1s

---

## 并行规划（建议）

| 周次 | Dev A（Android tech lead）| Dev B（Android | 后端）| Dev C（PM + 法务 + 设计）|
|---|---|---|---|
| 1 | FAMILY-01 / 02 / 03 / 09 | FAMILY-04 / 05 / 06 / 07 | FAMILY-64 / 65 启动 |
| 2 | FAMILY-10 / 11 / 12 | FAMILY-08 / 60（TimeAuthority）/ 20 | FAMILY-64 收尾 + 设计 dashboard mock |
| 3 | FAMILY-13（核心）+ 14 | FAMILY-21 / 22 / 25 | 法律 review + 实名供应商决策 |
| 4 | FAMILY-15 / 16 / 17 | FAMILY-23 (start 5 collector) / 24 / 26 | 应用商店预审材料 |
| 5 | FAMILY-30 / 31 / 32 / 33 | FAMILY-23 (continue) / 27 / 28 | 真机测试机准备 |
| 6 | FAMILY-34 / 35 / 36 | FAMILY-40 / 41 / 42 / 50 / 51 | 端到端场景脚本 |
| 7 | FAMILY-37 / 18 / 19 | FAMILY-43 / 44 / 45 / 46 / 52 | FAMILY-66 主导 |
| 8 | FAMILY-53 / 54 / 55 / 56 | FAMILY-61 / 62 / 63 | FAMILY-67 dashboard 联调 |
| 9 | 真机回归 + bug bash | 真机回归 + 性能验证 + spike 真机 | 法务终审 + 应用商店预提交 |

---

## 风险登记

| 风险 | 概率 | 影响 | 应对 |
|---|---|---|---|
| FAMILY-23（5 collector）实际超时 | 中 | 中 | 优先级排序，最迟 v0.1 ship 1-2 个 collector，其余推 v0.2 |
| FAMILY-35 MediaProjection 真机弹窗体验差 | 高 | 中 | spike 2 真机预验；不行则 v0.1 不 ship 静音旁观，推 v0.2 |
| FAMILY-19 反卸载在 MIUI 失败 | 高 | 中 | 已知 trap；v0.1 接受 MIUI 上反卸载弱；记入 [[android_wechat_collector_phase_12_10]] |
| FAMILY-65 实名 KYC 无法 v0.1 落地 | 高 | 低 | v0.1 不强求；UI 留入口，<14 岁绑定走人工审核 |
| FAMILY-64 法律 review 卡 v1.0 上架 | 中 | 高 | v0.1 起就并行，不可压缩；最小版"知情同意"v0.1 必有 |
| FAMILY-13 配对 UX 太复杂导致用户流失 | 中 | 高 | 力求 3 分钟完成；UX team 跟踪每步 funnel |
| FAMILY-60 TimeAuthority 在 Wi-Fi 切 4G 时同步失败 | 中 | 中 | 加重试 + 容忍窗口；24h 内不同步 → 降级温和档 |

---

## 验收 / Ship 标准

v0.1 MVP ship 必须满足：

- [ ] 58 ticket 全 done（含 FAMILY-64/65 法务前置）
- [ ] 端到端 5 场景（FAMILY-66）全绿
- [ ] 真机回归：Pixel 6 + 小米 + 华为 三机型基本场景 OK
- [ ] 资源预算硬指标达成（参考主文档 §12.1）：
  - CPU 24h 平均 < 4%
  - RAM < 200MB
  - 电量 < 12%/天
- [ ] AccessibilityService 24h TC9 通过（spike 3）
- [ ] 知情同意书法务签字
- [ ] 应用商店预审材料齐（至少国内 1 家）
- [ ] [[github_release_pipeline_constraints]] / [[android_in_app_update_5_traps]] 走通

---

## 下一步动作

1. **导入 issue 系统**：把 FAMILY-01..67 导入 Linear / Jira / GitHub Issues；命名替换 `FAMILY-` 前缀
2. **owner 分配**：按 §并行规划填实 dev 名
3. **第 1 周启动**：Dev A 拉 FAMILY-01 → 通过开发环境验证；Dev C 起 PIA 模板
4. **每周 standup**：跟踪 burndown；FAMILY-23 / FAMILY-35 / FAMILY-19 高风险项每周复盘

---

> 文档版本：v1.0（2026-05-28）
> 评审：待 PM 拍板 + Dev 估时复核
> 与 [[AI陪学_主文档.md]] §4 路线图保持同步
