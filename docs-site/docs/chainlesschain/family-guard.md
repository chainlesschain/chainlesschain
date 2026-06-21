# Family Guard 家庭守护 / AI 陪学

> **版本: v0.2 (FAMILY Epic, 2026-06) | 状态: 🚧 MVP（纯逻辑层全量落地 + 真机/UI 接线进行中） | 模块 `:feature-family-guard`（223 Kotlin 文件）+ `:app` AI 陪学（21 文件）| 507 + 51 单元测试全绿（`family_guard.db` schema v11）**
>
> Family Guard 是 ChainlessChain 在 Android 端的家庭守护与「AI 陪学」子系统。它以**隐私优先**为核心设计原则——绝大多数敏感能力（家长时间源、遥测外发、护栏命中、生命周期审计）默认以 **NoOp seam** 实装，库层不依赖 `:app`/`:core-p2p`，真实接线一律在 `:app` 完成；陪伴聊天经设备 Keystore（AES-256-GCM + StrongBox）TEE 加密落盘，**家长 root + dump `/data` 也只能得到密文**。

## 概述

Family Guard（家庭守护）为家庭场景提供未成年人陪伴学习、健康使用引导与安全保障能力，由两部分组成：

1. **`:feature-family-guard`** — 守护核心库（223 个 Kotlin 文件 / 507 个单元测试），覆盖设备配对与解绑、遥测采集、家庭通话、SOS 一键求助、地理围栏、防改钟时间权威、数据生命周期审计等 7 个 Epic 的纯逻辑层。库**不依赖** `:app` 与 `:core-p2p`，全部跨设备能力通过依赖注入的 seam（默认 NoOp）暴露。
2. **`:app` AI 陪学** — 双轨（学习 / 陪伴）对话子系统（`presentation/aistudy`、`familytask`、`familyrewards`、`parentedu`），依赖 `:feature-ai` 的本地/云 LLM 配置，提供作业引导模式、错题本 RAG、端侧内容护栏、学情报告、积分激励与家长教育月报。

与「家长监控」类产品不同，Family Guard 的设计目标是**温和引导而非强控**：默认不锁、不上传聊天原文、以正向激励（积分）与家长成长（温和度月报、12355 公益热线入口）替代惩罚式管控。

## 核心特性

- 👨‍👩‍👧 **AI 陪学双轨**：学习轨（作业引导，不直接给答案）+ 陪伴轨（带未成年护栏的情感陪伴聊天），复用全局 AI 配置，无需单独选模型
- 📚 **错题本 RAG**：学科硬过滤 + 知识点/题面 2-gram 重叠打分 + 间隔重复排序，topK 检索注入学习 prompt
- 🛡️ **端侧内容护栏**：第 2 层关键词分类（自伤/霸凌/陌生人/成人内容 4 类），**只记录类别 + 时间戳，绝不存聊天原文**，命中不阻断对话
- 📝 **任务联动防作弊**：家长建作业 → 进入强制引导模式 → 提交 → AI 批改 → 完成/打回；AI 调用日志只记 `taskId + 时间 + ANSWER_SEEKING 类别`
- 🔐 **TEE 加密陪伴金库**：陪伴聊天经 `KeystoreFacade`（AES-256-GCM + StrongBox 分级降级）加密落盘，解密失败（密钥轮换/篡改）返回空列表不崩溃
- 🎁 **积分激励引擎（M9）**：作业分档赚分（30/20/10）+ 同任务去重 + 单日上限截断 + 满分但频繁索答案打 5 折 + 连续 7 天奖励
- 📊 **家长温和度月报（M10）**：温和度评分（0-100，5 项加权扣减）+ 同类家庭对比分位 + 滥用检测（强制结束/强接通）+ 推课建议 + 12355 公益热线入口
- 🔗 **设备配对与解绑**：扫码配对、M-of-N 协商、24h 解绑冷却（防孩子私自解绑）
- 📡 **遥测采集（Telemetry）**：前台应用使用、异常扫描快照，经 `SnapshotProvider`/`TelemetryOutbox` seam 外发（默认 NoOp）
- ☎️ **家庭通话**：信令、接通策略、强接通计数（计入温和度）
- 🆘 **SOS 一键求助**：触发、签名、安全外发（触发硬件/录音/UI 为真机阻塞）
- 📍 **地理围栏**：围栏进出判定纯逻辑（位置 API/地图/真机电量为设备阻塞）
- ⏰ **防改钟时间权威（TimeAuthority）**：Cristian 算法（`权威时间 = parentMs + RTT/2`，锚定单调钟），防孩子改墙钟绕过 quiet hours / 每日上限 / 24h 角色锁
- 🔏 **数据生命周期审计**：`DataLifecycleAuditLogger` 记录数据保留/删除事件（seam，默认 NoOp）
- 🧩 **NoOp seam 架构**：所有跨设备/跨进程能力默认 dormant，:app 覆盖后才真实生效，保证库层可单测、零设备依赖

## 系统架构

### 整体架构

```
┌──────────────────────────── :app（接线层 / 真实实装） ────────────────────────────┐
│  presentation/aistudy   ── 双轨 chat / 错题本 / 护栏 / 学情报告 / 任务 / 金库         │
│  presentation/familytask ── 家长建作业 / 任务状态流转 UI（family_task 23 字段 Room） │
│  presentation/familyrewards ── 积分卡 / 兑换目录 / 历史                              │
│  presentation/parentedu  ── 温和度月报 / 同类对比 / 推课 / 12355                     │
│  （在此覆盖 NoOp seam：ParentTimeSource / TelemetryOutbox / SnapshotProvider …）     │
└────────────────────────────────────┬──────────────────────────────────────────────┘
                                      │ 依赖注入 seam（默认 NoOp）
┌────────────────────────── :feature-family-guard（守护核心库） ──────────────────────┐
│  domain/                                  data/                                      │
│   ├─ time（TimeAuthority/MonotonicClock）  ├─ time（CristianTimeAuthority/NoOp…）     │
│   ├─ unbind（解绑冷却）                     ├─ telemetry（ForegroundAppTimer …）       │
│   ├─ negotiation（M-of-N 协商）             ├─ anomaly（AnomalyScanTimer）             │
│   ├─ telemetry / anomaly / audit          ├─ emergency / sos / signer                │
│   ├─ emergency / sos（求助）                ├─ permission / preferences               │
│   ├─ geofence（围栏）                       ├─ repository / service / dao / entity     │
│   ├─ quiethours（免打扰）/ lifecycle        ├─ codec / lifecycle / boot               │
│   ├─ permission / merger / task            └─ di（Hilt 模块：TimeModule …）            │
│   └─ model（pairing / permissions）                                                  │
│  数据持久层：Room（family_guard.db，SQLCipher 加密）                                  │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### 7 个 Epic 与覆盖范围

| Epic | 主题                             | 纯逻辑层状态                         | 主要包                                     |
| ---- | -------------------------------- | ------------------------------------ | ------------------------------------------ |
| A    | 脚手架（FAMILY-01..09）          | ✅ 完成                              | `boot` / `di` / `model`                    |
| B    | 解绑 / 配对（FAMILY-10..19）     | ✅ 完成                              | `unbind` / `negotiation` / `model/pairing` |
| C    | 遥测（FAMILY-20..28）            | ✅ 完成                              | `telemetry` / `anomaly` / `audit`          |
| D    | 家庭通话（FAMILY-30..37）        | ✅ 5/7（剩真机 MediaProjection）     | `service` / `signer`                       |
| E    | SOS 一键求助（FAMILY-40..45）    | ✅ 部分（剩触发硬件/录音/UI）        | `emergency` / `sos`                        |
| F    | 地理围栏（FAMILY-50..55）        | ✅ 3/7（剩位置 API/地图/真机电量）   | `geofence`                                 |
| G    | 时间 / 生命周期（FAMILY-60..67） | ✅ 部分（剩 push vendor / 真机 E2E） | `time` / `lifecycle` / `quiethours`        |

### AI 陪学里程碑（M5–M10）

| 里程碑   | 内容                                                   | 状态           |
| -------- | ------------------------------------------------------ | -------------- |
| M5       | 任务联动 + family_task 23 字段 Room 持久 + 任务可见 UI | ✅ 真机已装验  |
| M6       | 双轨 chat MVP + 错题本 RAG + 端侧护栏 + 学情报告       | ✅ 落地        |
| 陪伴金库 | TEE 加密落盘（KeystoreFacade）                         | ✅ 落地        |
| M9       | 奖励/积分引擎 + 接入界面                               | ✅ 纯逻辑 + UI |
| M10      | 家长教育/温和度月报 + 接入界面                         | ✅ 纯逻辑 + UI |

### 数据库 Schema（family_guard.db，SQLCipher）

`:feature-family-guard` 使用 Room + SQLCipher 加密本地库（`@Database` 实体含家庭组/成员/关系、SOS 事件、位置点、地理围栏、执行规则、子事件遥测、任务/积分/错题本/护栏事件等），核心表 `family_task`（23 字段，状态机 `SUGGESTED → ASSIGNED → IN_PROGRESS → SUBMITTED → GRADED → DONE`，可打回/取消）。DB 版本随 schema 演进至 **v11**（`SCHEMA_VERSION = 11`），`MIGRATION_1_2 … MIGRATION_10_11` 链式迁移，各步对齐 `schemas/**/11.json` 导出的 DDL（含 AI 陪学 M5–M9 落地的任务/账本/错题本/护栏事件表）。

## 配置参考

AI 陪学**复用全局 AI 配置**（桌面/移动端「设置 → AI 配置」选定的 provider + model），不另起模型选择 UI。学情画像存于 SharedPreferences。

### AI 陪学画像（`StudyProfileStore`）

| 键         | 含义                   | 默认值 |
| ---------- | ---------------------- | ------ |
| `grade`    | 学段（P1..P6 / 初中…） | `P4`   |
| `subject`  | 学科                   | `MATH` |
| `nickname` | 昵称                   | `同学` |

> 存储位置：SharedPreferences `"ai_study_profile"`。陪伴轨聊天**不经此 store**，而是经 TEE 加密金库持久化。

### 积分引擎（M9，`PointsEngine`）

| 参数             | 默认         | 说明                         |
| ---------------- | ------------ | ---------------------------- |
| 作业分档         | 30 / 20 / 10 | 按成绩档赚分                 |
| 单日赚分上限     | 200          | 超出截断                     |
| 单日兑换上限     | 内部配置     | `decideSpend` 约束           |
| 家长单笔赠予上限 | 100          | `decideGrant` 截断           |
| 家长单日赠予上限 | 300          | `decideGrant` 截断           |
| 连续天数奖励     | +50（×倍数） | 连续 7 天 streak             |
| 索答案惩罚       | ×50%         | 满分但 answer-seeking ≥ 阈值 |

> 时间、随机数、单日聚合均由调用方注入 → 引擎为确定性纯函数，便于单测。

### 时间权威（`TimeAuthority`）

| 状态            | 含义                           | 是否锁定时间功能                      |
| --------------- | ------------------------------ | ------------------------------------- |
| `NEVER_SYNCED`  | 从未与家长同步（默认 dormant） | ❌ 否（退墙钟）                       |
| `STALE`         | 离线 > 48h                     | ❌ 否（温和档，避免离线娃被永久锁死） |
| `SKEW_DETECTED` | 偏移 > 5min                    | ✅ 是                                 |
| `TRUSTED`       | 已同步且可信                   | ❌ 否                                 |

> ⚠️ `ParentTimeSource` 默认 `NoOpParentTimeSource`（返回 null）→ 防改钟在 :app 接通 P2P（实装 `ParentTimeSource` + 周期 `sync()`）前形同 dormant，退化为旧墙钟行为。单调钟锚点**只存内存、绝不持久化**（重启归零，重启后回到 `NEVER_SYNCED`）。

## 性能指标

- **纯逻辑层零设备依赖**：积分引擎、温和度评分、错题本检索、时间权威算法均为确定性纯函数，单测毫秒级完成。
- **错题本检索**：内存态 2-gram token 重叠打分 + 间隔重复排序，topK 检索为 O(n·k)，规模为单用户错题数量级。
- **金库读写**：read-modify-write 全量重加密 + Mutex 串行；Keystore 操作走 IO 线程，避免主线程 StrongBox ANR。
- **遥测/异常扫描**：经定时器（`ForegroundAppTimer` / `AnomalyScanTimer`）周期采样，外发由 seam 节流（默认 NoOp 不外发）。

> 真机端到端性能指标（通话建链延迟、SOS 触达时延、围栏判定功耗）待真机 E2E 阶段补充。

## 测试覆盖率

- **`:feature-family-guard`**：507 个单元测试，0 失败（含状态机纯测 + Robolectric in-memory Room 真跑 SQL，`@RunWith(AndroidJUnit4)` + `@Config(sdk=[33])`，Windows 可跑，非 androidTest）。覆盖含 FAMILY-62 多家长规则分歧检测 `RuleConflictDetector`（取最严合并 + 分歧判定）、解绑/协商/遥测/异常/围栏等纯逻辑。
- **AI 陪学（`:app`）**：JVM 单元测试覆盖 Prompts / ViewModel / Guardrail / Retriever / Report / 积分引擎 / 温和度月报 / 金库（`FakeKeystoreFacade` 跑真 `javax.crypto` AES-GCM round-trip / 篡改→空 / 换 key→空 / reopen 持久）。
- **FAMILY-67 跨设备遥测 P2P 同步链路**（跨 `:core-p2p` / `:feature-p2p` / `:app`）：`SyncManager.changeSignal`（CONFLATED 即时推送信号）、`SyncCoordinator`（连上+pending→push / 无 pending 仍 flush / `changeSignal` 即时唤醒 / 断开停循环 / 幂等，注入 `@IoDispatcher` 确定性可测）、`FamilyGuardSyncConnector.connectOnce`（单连接守卫 + 连上即停）、`P2PChatViewModel`（会话就绪重建验证态）、`AppInitializer`（启动 `autoRestore` 恢复 E2EE 会话 + 组件启动非致命隔离）均有单测。

```bash
# feature-family-guard 全量单测
cd android-app && ./gradlew :feature-family-guard:testDebugUnitTest

# AI 陪学单测（JDK17 via JAVA_HOME）
cd android-app && ./gradlew :app:testDebugUnitTest \
  --tests "com.chainlesschain.android.presentation.aistudy.*"
```

> 真机 E2E（StrongBox 验金库密文、家长 dump 验密文、通话 MediaProjection、SOS 触发、围栏功耗、`MigrationTestHelper` 验 5→6）属设备阻塞，待真机阶段执行。

## 安全考虑

### 隐私优先的 NoOp seam 架构

所有跨设备/跨进程能力（`ParentTimeSource` / `TelemetryOutbox` / `SnapshotProvider` / `GuardianAnomalyNotifier` / `DataLifecycleAuditLogger`）默认以 **NoOp** 实装，库层不外发任何数据；真实外发实装一律在 `:app` 接线层完成。库层可在 Windows JVM 上完整单测，零设备、零网络。

### 端侧护栏不留痕

第 2 层内容护栏（`GuardrailClassifier`）命中后，`GuardrailFinding` **只包含 `category + tab + timestamp`，绝不存储聊天原文**；命中**不阻断**对话，仅 post-hoc 记录类别供学情报告聚合（「需要关注 = 仅报类别 + 次数」）。

### 陪伴聊天 TEE 加密落盘

陪伴轨聊天经 `core-security` 的 `KeystoreFacade`（`AndroidKeystoreFacade` 真 AES-256-GCM + StrongBox tier 降级）加密后落盘（别名 `cc_companion_tee_vault`）。**家长 root + dump `/data` 也只能得到密文**；金库目录带 `SYNC_EXCLUDE_DIR_NAME` 哨兵，同步引擎整目录跳过，密文不上云。解密失败（密钥轮换/被篡改）→ 返回空列表，不崩溃。

### 防改钟（TimeAuthority）

防孩子修改设备墙钟绕过 quiet hours / 每日上限 / 24h 角色锁。`STALE` 优先于 `SKEW` 判定——全断网时墙钟必然漂移，若先判 skew 会把离线娃永久锁死。仅 `SKEW_DETECTED` 才锁定时间功能；`STALE` / `NEVER_SYNCED` 均为温和档不锁。

### 防私自解绑

解绑设 24h 冷却（`75965d32c`，走 `authoritativeNow()`），并支持 M-of-N 多方协商解绑，防孩子单方面私自解绑。

## 故障排查

### 常见问题

| 现象                              | 可能原因                                                 | 处理                                                                     |
| --------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------ |
| 防改钟不生效（改钟后仍能用）      | `ParentTimeSource` 仍是默认 NoOp，:app 未接 P2P 家长时间 | 需在 :app 实装 `ParentTimeSource` + 周期 `sync()`（boot/keepalive 路径） |
| 重启后时间权威回到「从未同步」    | 单调钟锚点只存内存、重启归零（设计如此）                 | 等下次 `sync()` 重新锚定，**不要**把 offset 持久化跨重启                 |
| 陪伴历史打开后为空                | 密钥轮换/金库被篡改 → 解密失败安全降级                   | 预期行为（不崩溃）；确认未跨设备恢复密钥                                 |
| AI 陪学回复报错而非崩溃           | 全局 AI 配置未设置 provider/key                          | 到「设置 → AI 配置」配置可用模型                                         |
| `family_guard.db` WAL PRAGMA 报错 | SQLCipher 要求 PRAGMA 走 `rawQuery` 而非 `execSQL`       | 见 `FamilyGuardMigrations` onOpen 改用 `query`                           |
| 单测构建 KSP 缓存损坏             | 并行 build 同写 `build/kspCaches`                        | `./gradlew --stop` + 整删模块 `build/kspCaches` 后重跑                   |

### 调试

- AI 陪学未配置模型时返回 `StreamChunk(error=...)`，检查全局 LLM 配置而非陪学模块。
- 时间权威以 `isTimeTrusted()`（== `TRUSTED`，更严）与 `shouldLockTimeFeatures()`（== `SKEW_DETECTED`，决定是否锁）区分，调试时勿混用。

## 关键文件

### 守护核心库（`:feature-family-guard`）

| 路径（`…/feature/familyguard/`）                                                             | 说明                                         |
| -------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `domain/time/TimeAuthority.kt` · `MonotonicClock.kt` · `ParentTimeSource.kt`                 | 防改钟时间权威接口与状态机                   |
| `data/time/CristianTimeAuthority.kt` · `NoOpParentTimeSource.kt` · `SystemMonotonicClock.kt` | Cristian 算法实现 + 默认 NoOp 家长时间源     |
| `domain/unbind/` · `domain/negotiation/`                                                     | 解绑冷却 + M-of-N 协商                       |
| `data/telemetry/` · `data/anomaly/` · `domain/audit/`                                        | 遥测采集 / 异常扫描 / 审计                   |
| `domain/emergency/` · `domain/sos/` · `data/sos/` · `data/signer/`                           | SOS 求助与签名                               |
| `domain/geofence/`                                                                           | 地理围栏判定                                 |
| `domain/quiethours/` · `data/lifecycle/`                                                     | 免打扰 + 数据生命周期                        |
| `data/repository/` · `data/dao/` · `data/entity/`                                            | Room 持久层（family_guard.db / family_task） |
| `di/TimeModule.kt` 等                                                                        | Hilt 依赖注入（seam 绑定 NoOp 默认）         |

### AI 陪学（`:app/presentation/`）

| 路径                                                | 说明                                       |
| --------------------------------------------------- | ------------------------------------------ |
| `aistudy/AiStudyViewModel.kt` · `AiStudyScreen.kt`  | 双轨 chat 状态机与界面                     |
| `aistudy/AiStudyLlm.kt` · `AiStudyPrompts.kt`       | LLM seam（复用全局配置）+ 角色/护栏 prompt |
| `aistudy/MistakeBook.kt` · `MistakeRetriever.kt`    | 错题本 RAG                                 |
| `aistudy/GuardrailClassifier.kt`                    | 第 2 层端侧内容护栏                        |
| `aistudy/StudyReport.kt` · `StudyTask.kt`           | 学情报告 + 任务联动                        |
| `aistudy/CompanionVault.kt` · `FileVaultStorage.kt` | 陪伴聊天 TEE 加密金库                      |
| `aistudy/PointsEngine.kt`                           | M9 积分激励引擎（纯函数）                  |
| `aistudy/ParentEducation.kt`                        | M10 家长温和度月报（纯函数）               |
| `familytask/` · `familyrewards/` · `parentedu/`     | 任务可见 UI / 积分入口 / 家长成长入口      |

## 使用示例

AI 陪学与家庭守护为 Android 端 App 内功能，主要通过家庭 Tab 的卡片入口使用：

1. **学习陪伴**：家庭 Tab →「AI 陪学」卡 → 学习轨（作业引导，不直接给答案）/ 陪伴轨（情感陪伴，本机 TEE 加密）。
2. **布置作业**：家庭 Tab →「任务」卡 → 家长建作业（标题 + 学科 + 说明）→ 孩子「开始学习」自动进入引导模式 → 提交 → AI 批改 → 完成/打回。
3. **积分激励**：家庭 Tab →「积分」卡 → 查看余额 / 完成作业赚分 / 兑换目录兑换 / 查看历史。
4. **家长成长**：家庭 Tab →「家长成长」卡 → 温和度评分 + 同类家庭对比 + 关注点提醒 + 推课建议 + 12355 公益热线入口。

```kotlin
// 积分引擎为确定性纯函数，调用方注入时间/单日聚合
val decision = PointsEngine.decideEarn(
    task = completedTask,
    todayEarned = ledger.todayEarned(childDid),
    alreadyAwardedForTask = ledger.hasAward(taskId),
    now = injectedNow,
)
// → EarnDecision(points = 30, capped = false, reason = …)
```

## 相关文档

- [Cowork 多智能体协作系统](./cowork.md)
- [移动端 Android v1.0 GA 用户文档](/guide/mobile-android)
- [Personal Data Hub](./personal-data-hub.md)
- [移动端同步](./mobile-sync.md)
- [SIMKey / U-Key 硬件密钥](./simkey.md)
