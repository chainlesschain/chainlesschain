# Phase 12.10.6 — Android WeChat In-App Collector 真机 E2E Runbook

> **范围**: 一旦 Phase 12.10.4 把 `frida-inject` 二进制塞进 APK 并跑通 stub→real 接通 (`WeChatFridaInjector.kt` 真实现)，本文是从"安装 APK 到 vault 真有 WeChat 数据"这条链上**手动验收**的 8 场景剧本。
>
> **状态**: v0.1 (2026-05-22, 与 Phase 12.10.1-5 同周期落地；12.10.4 实施后即可启用)。
>
> **谁该读**: 拿到 v0.2 Android APK + 一台真机 (rooted Xiaomi / OnePlus / vivo) + WeChat 账号的工程师 / 早期用户。
>
> **前置依赖**:
> - ✅ Android APK 已 build 含 `frida-inject-arm64`/`frida-inject-arm` 二进制 (Phase 12.10.4)
> - ✅ 真机已 root (Magisk ≥ 25 + Zygisk on + DenyList 含 `com.tencent.mm`)
> - ✅ WeChat 已登录主账号 + 至少 100 个联系人 + 6 个月聊天记录 (与桌面 12.9 runbook §1 等同)
> - ✅ ChainlessChain `productVersion ≥ v5.0.3.75` 且 `cc CLI 0.162.10+`（in-APK 版本）
>
> **不在范围**:
> - WeChat 7.x (md5 路径) — 用 §scenario 12.10.6.2 同步路径即可，无需 frida
> - 跨设备同步 (Android → Desktop) — 走 Phase 3d 同步通道，与本 runbook 解耦

---

## 0. 验收门禁

通过条件 (**全部**满足才算 Phase 12.10.6 PASS):

1. 8 个场景 (12.10.6.1 – 12.10.6.8) 全部 PASS；任意 1 fail = Phase 12.10.6 FAIL
2. 验收期间 APK **未崩**（`logcat -d | grep "FATAL\|TombstonedCrash\|AndroidRuntime: FATAL"` 全程为空）
3. WeChat 进程 **未崩 / 未弹"环境异常"**（Magisk DenyList 生效）
4. 验收结束 APK in-app vault.db **完整性**: `cc hub stats` 返回 `integrity: ok`
5. 4 性能基准命中或低于阈值

填记录模板见 §6。完整跑 ~3-4 小时（含 §12.10.6.8 长稳，可后台跑 2h）。

---

## 1. 测试机环境矩阵

| 维度 | 主测试机 | 备份机 (推荐) |
|---|---|---|
| 设备 | Xiaomi 24115RA8EC (Android 14 MIUI / HyperOS, arm64-v8a) | OnePlus / Samsung / vivo Android 11+ |
| WeChat 版本 | 8.0.50 – 8.0.55 (v0.1 验过的) | 8.0.40+ 任一 |
| Root | Magisk ≥ 25 + Zygisk on + DenyList(`com.tencent.mm`) | 同上 |
| frida-inject | 16.x asset bundle (随 APK ship; arm64 + arm32 双 ABI) | 同上 |
| 测试账号 | 个人微信，**≥ 6 个月聊天记录** + ≥ 100 联系人 | 个人微信 |
| ChainlessChain APK | 由 Phase 12.10.4 后 nightly build 出 | 同上 |
| Win/Mac/Linux 监控机 | 用于 `adb logcat` 观察 | optional |

> **数据量门槛**: §12.10.6.6 大库稳定性要求测试账号至少包含 **5 万 + 条 message**；不到这个量级，§12.10.6.6 标 `dataset:small` 跳过性能断言。

---

## 2. 全场景一览

| # | 场景 | 时长 | 关键判据 |
|---|---|---|---|
| 12.10.6.1 | 首次登录绑定 — uin 输入 + 凭据加密落 EncryptedSharedPreferences | ≤ 2 min | `WechatCardState.isLoggedIn=true` + 加密 prefs 落盘 |
| 12.10.6.2 | 首次同步 (frida 路径) — extract key + DB decrypt + cc ingest | ≤ 8 min / 5w 条 | vault `Person.subtype=wechat-contact` + `Event.subtype=wechat-message` 行数符合预期 |
| 12.10.6.3 | 解密正确性 spot-check (10 条已知 message 比对源 DB) | ≤ 5 min | 10/10 内容完全一致 (含 emoji / 换行 / @mention) |
| 12.10.6.4 | Ask 自然语言 (cc hub ask + 本地 LLM via A3 端侧引擎) | ≤ 5 min | 3 类问题返回正确答案 + ≥ 1 citation 指向 wechat-* event |
| 12.10.6.5 | 增量同步 — 第二次只拉新 message | ≤ 1 min / 100 新 | watermark 命中 + 0 重复 |
| 12.10.6.6 | 大库性能 — 5w 条 ingest 时长 + RSS 峰值 | ≤ 20 min | < 18 min wall + RSS < 800 MB (Android 端比桌面 1.2GB 严) |
| 12.10.6.7 | 失败恢复 — WeChat 杀进程 / Magisk-su 被 deny / frida-inject 超时 | ≤ 5 min | 3 错误码各自走对 banner 路径，不污染 vault |
| 12.10.6.8 | 长稳 — 2h 后台 + chunk 同步 + 反检测复检 | 2h | 0 crash + WeChat 不挂 + audit 累计条数 = 期望同步次数 × N |

---

## 3. 详细场景

### 12.10.6.1 — 首次登录绑定

**前提**: 全新装 APK 或 `adb shell pm clear com.chainlesschain.android`。

**步骤**:

1. 打开 ChainlessChain → 底 tab "本机数据" → 找"社交聊天" → "微信" 卡 (badge "scaffold v0.1+")
2. 点 "登录 / 授权"
3. 弹窗输 UIN (10 位纯数字) + 选 `keyProvider=frida` → 点 "绑定"
4. `adb shell logcat -d -s ChainlessChain:* | grep WeChat` 看 `saveAccount uin=... keyProvider=frida` 落

**通过判据**:
- 卡片状态变 "UIN: 1234567890 · keyProvider=frida"
- 加密 prefs 实际落盘: `adb shell run-as com.chainlesschain.android ls -la shared_prefs/pdh_social_wechat.xml` 存在
- `adb shell run-as com.chainlesschain.android cat shared_prefs/pdh_social_wechat.xml` 看到密文 (BASE64-AES) 不是明文 uin

**失败 SOP**:
- 弹窗输入 UIN 后无反应 → `logcat` 看 `WeChatCredentialsStore.saveAccount failed` → 检 Keystore 健康
- 卡片不变 → ViewModel `refreshWechatFromStore()` 没被叫 → 检 `confirmWechatUin` flow

### 12.10.6.2 — 首次同步 (frida 路径)

**前提**: WeChat 已在前台跑过一次 (libWCDB.so 已 lazy-load)；卡片 isLoggedIn=true。

**步骤**:

1. 打开 ChainlessChain → "本机数据" → 微信卡 → 点 "立即同步"
2. 同时 `adb logcat -v threadtime | grep -E "WeChatFridaInjector|WeChatDbExtractor|WeChatLocalCollector|frida-inject"` 监控
3. 等卡片状态变 "上次同步: ... · +N 事件" (3-8 min for 5w 条)
4. 切到 "审计" tab，看到新增 `action=ingest adapter=wechat eventId=batch-1` row

**通过判据**:
- frida-inject 进程**起+停**: `logcat` 看到 `spawn frida-inject pid=XXX` + `kind:"key" hex:... source:sqlite3_key_v2`
- SQLCipher 解密成功: `extractResult=Ok contactCount=N messageCount=M chatroomCount=K`
- cc 入库成功: `LocalCcRunner.syncAdapter wechat ok ingested=N+M`
- WeChat 仍在前台 (`pidof com.tencent.mm` 与同步开始时一致 — 未崩)

**失败 SOP**:
| Banner 文案 | 根因 | 排查 |
|---|---|---|
| "Frida 二进制未打包" | Phase 12.10.4 未跑 | rebuild APK 含 `assets/frida/frida-inject-arm64` |
| "WeChat 进程未运行" | pidof 返 0 | 打开 WeChat 主界面 → 点一个聊天 → 再点同步 |
| "Frida hook 30s 未触发" | libWCDB.so 未加载 | 在 WeChat 里再发一条消息 → 触发 DB 写 → libWCDB 加载 |
| "数据库提取失败 (decrypt-failed)" | PRAGMA profile 全部失败 | `adb pull /data/local/tmp/cc-wx-staging-*.db` 出来用桌面侧 `cc hub wechat probe --db ./cc-wx-staging-*.db` 单独验密钥 |
| "数据库提取失败 (source-db-missing)" | uin md5 路径错 | 检查 uin 真是数字 + 用 `adb shell su -c "ls /data/data/com.tencent.mm/MicroMsg/"` 列实际 md5 目录 |

### 12.10.6.3 — 解密正确性 spot-check

**前提**: §12.10.6.2 PASS。

**步骤**:

1. 在 WeChat 中找 10 条已知消息 (5 个不同好友 / 5 个不同时间段，含 emoji + 换行 + @mention 各 ≥ 1)
2. 手动记下 10 条 (`fromAccount`, `timestamp`, `content` 前 30 字符) 到 spreadsheet
3. APK 里搜: 本机数据 → 提问 → 输入 "show me last messages from <好友昵称>" → 看 citation chip
4. 点 citation chip → 跳 event detail bottom sheet → 比对内容

**通过判据**:
- 10/10 内容完全一致 (allow whitespace normalize)
- emoji 不显 `??` / `�` / 0x00 (decoded as UTF-8 OK)
- @mention 的 nickname 与 source 一致

**失败 SOP**: 任意 1/10 错 → 立即 stop + dump:
```bash
# 拉出 staging.json 看 raw 是否就错了 (decrypt 错) 还是 cc normalize 错
adb shell run-as com.chainlesschain.android cat files/.chainlesschain/staging/wechat-*.json | head -100
```
如 staging.json 也错 → SQLCipher 解密拿到的是脏数据，回 §12.10.6.2 失败 SOP "decrypt-failed" 项；如 staging.json 对但 vault 错 → cc adapter normalize bug，归到 packages/personal-data-hub/lib/adapters/wechat/normalize.js。

### 12.10.6.4 — Ask 自然语言 + 本地 LLM

**前提**: §12.10.6.2 PASS；端侧 LLM (A3) 已就绪 (Doubao / Kimi / 任一 cloud LLM via cc llm 也行，但桌面/在线模型不在本场景 — 本场景验**本地**)。

**步骤**:

1. 本机数据 → 提问 (HubAskCard) → 输 3 类问题:
   - **时间过滤**: "上周我和[好友昵称]聊了什么"
   - **群提取**: "[群名]里最近讨论的话题"
   - **关系图**: "我和[好友昵称]最早是哪天加的好友"
2. 每条都按 ≥ 30s 等 LLM 返回
3. 点返回里的 citation chip → bottom sheet 弹原 event

**通过判据**:
- 3/3 都给出像样的回答 (LLM 没说 "I don't have access to ...")
- 每条至少 1 个 citation chip 指向 `wechat-message-...` 或 `wechat-contact-...` event
- chip 点击后 bottom sheet 显示原 message 内容 + 时间

**失败 SOP**:
- 全部"无相关数据" → cc hub ask 没拿到 wechat 上下文 → 检 vault 真有 wechat events: `adb shell run-as com.chainlesschain.android files/.chainlesschain/bin/cc hub events --filter "subtype:wechat-message" --limit 5`
- citation 点击空白 → event-detail sheet 路径断 — 见 memory `pdh_a3_skeleton_landed.md` citation 接通历史

### 12.10.6.5 — 增量同步

**前提**: §12.10.6.2 PASS。

**步骤**:

1. 记当前 vault size: `adb shell run-as com.chainlesschain.android files/.chainlesschain/bin/cc hub stats --json | tee /tmp/stats-before.json`
2. 在 WeChat 中**手发** 5 条新消息给随便一个好友
3. 等 30s (确保 WeChat 把 message 落地 EnMicroMsg.db)
4. APK → 再次点 "立即同步"
5. 等卡片更新
6. `adb shell run-as com.chainlesschain.android files/.chainlesschain/bin/cc hub stats --json | tee /tmp/stats-after.json`

**通过判据**:
- `events.subtype=wechat-message` 增量 = 5 (±1 for system messages)
- audit_log 新增 `action=ingest adapter=wechat count=5..6` (不是又拉了 5w 条)
- 整次同步耗时 ≤ 1 min (incremental 比 full 快至少 10x)

**失败 SOP**:
- 增量 = 0 → watermark 没更新 / db-reader 重读全表 → 检 packages/personal-data-hub/lib/adapters/wechat/db-reader.js `since` 参数
- 增量 = 50050 (≈ full + 5) → idempotency 断了 → 检 normalize 输出的 originalId 字段唯一性

### 12.10.6.6 — 大库性能

**前提**: §12.10.6.2 PASS；测试账号有 **≥ 5 万条 message**。dataset:small 跳过此场景。

**步骤**:

1. APK → 微信卡 → 退出登录 → 重新绑定 + 同步 (full re-ingest)
2. 同时 `adb shell top -p $(pidof com.chainlesschain.android) -b -d 5 > /tmp/rss-watch.log &`
3. 等同步完
4. `wc -l /tmp/rss-watch.log` + `awk '{print $6}' /tmp/rss-watch.log | sort -n | tail -3` 看 RSS 峰值

**通过判据**:
- Wall clock < **18 min** (vs 桌面 25 min — Android 应更快因为没 RPC)
- RSS 峰值 < **800 MB** (Android 比桌面 1.2GB 严，因为部分机器只有 4GB RAM)
- 期间 APK 未被 OOM-killer 干掉 (`logcat | grep "lowmemorykiller\|OOM"` 必须空)

**失败 SOP**:
- RSS > 800 MB → 检 cc hub sync 是否一次性 batch 全 5w 条进内存 — 应分 chunk
- Wall > 18 min → frida-inject 重复 spawn / 每条 message 一次 cc IPC — 检 LocalCcRunner.syncAdapter 是否单次调用
- OOM → APK 配 largeHeap (manifest application 标签) 或 chunk size 调小

### 12.10.6.7 — 失败恢复

**子场景 a**: WeChat 杀进程后再同步
1. `adb shell am force-stop com.tencent.mm`
2. APK → 点 "立即同步"
3. **期望**: banner "WeChat 进程未运行 — 请先打开微信再同步" → 卡 isSyncing=false → 重打开 WeChat 后 retry sync 成功

**子场景 b**: Magisk-su 被 deny
1. 在 Magisk app 把 ChainlessChain 的 root 权限设 "deny"
2. APK → 点 "立即同步"
3. **期望**: banner "设备未 root — 改用桌面端" + Magisk 不弹 prompt

**子场景 c**: frida-inject 超时
1. WeChat 后台关 + 立刻同步 (libWCDB 没加载导致 30s timeout)
2. **期望**: banner "Frida hook 30s 未触发 — 请打开任意聊天后再同步" + 卡 isSyncing=false + audit 无 ingest row + vault 行数不变

**通过判据**: 3/3 子场景 banner 文案匹配 + 状态恢复正确 + vault 不污染 (`cc hub stats` events 数不变)。

### 12.10.6.8 — 长稳 + 反检测复检

**步骤**:

1. 把 APK 放后台 (不杀)；在 WeChat 正常用 2h (发 50+ 条消息 / 加 1-2 个新好友 / 进退几个群)
2. 期间每 30 min 切回 APK → 微信卡 → "立即同步" → 看是否仍然成功
3. 期间持续 `adb logcat | grep -E "FATAL|TombstonedCrash|com.tencent.mm.*crash"` 跟踪 WeChat 是否被反检测干掉
4. 2h 结束: `adb shell run-as com.chainlesschain.android files/.chainlesschain/bin/cc hub audit --filter "adapter:wechat" --limit 10`

**通过判据**:
- WeChat 全程未崩 (no FATAL for `com.tencent.mm`)
- WeChat 未弹"环境异常" / "检测到调试" 对话框
- 4 次手动同步全部成功 (or 各 banner 文案正确)
- audit_log 4 个 `action=ingest adapter=wechat` row (与同步次数一致)

**失败 SOP**:
- WeChat 反检测干掉 → frida-inject 留下 `/proc/self/maps` 痕迹 → 见 Phase 12.10.7 anti-detection 加固 doc
- APK 崩 → `adb logcat -b crash` + bug report

---

## 4. 性能基准 + 监控指标

| 指标 | 阈值 | 测法 |
|---|---|---|
| frida key extract 时长 | ≤ **5s** (libWCDB 已加载) / ≤ **30s** (lazy load) | `logcat \| grep "WeChatFridaInjector.*duration"` |
| SQLCipher open 时长 | ≤ **3s** | `logcat \| grep "WeChatDbExtractor.*open ok"` |
| Full ingest 5w 条 | ≤ **18 min** | wall clock |
| 增量同步 100 条 | ≤ **30s** | wall clock |
| APK RSS 峰值 | ≤ **800 MB** | `adb shell top` |
| vault.db 完整性 | `integrity_check` 返 `ok` | `cc hub stats` |
| 反检测漏检率 | 0/8 场景 触发 WeChat 弹窗 | §12.10.6.8 |

---

## 5. 失败诊断材料 (issue 必附)

每条 fail issue 必须含:

1. **场景编号** (e.g. `12.10.6.4`)
2. **设备 fingerprint**: `adb shell getprop ro.build.fingerprint` + Magisk 版本 + WeChat 版本
3. **APK 版本** + frida-inject 版本 (`adb shell run-as com.chainlesschain.android files/frida-inject-arm64 --version` 如有)
4. **logcat 全程**: `adb logcat -v threadtime -d > issue-logcat.txt`
5. **vault 状态**: `adb shell run-as com.chainlesschain.android files/.chainlesschain/bin/cc hub stats --json > issue-stats.json`
6. **失败截图** (banner 文案 + 卡片状态全可见)
7. (如解密 fail) **staging.json**: `adb shell run-as com.chainlesschain.android cat files/.chainlesschain/staging/wechat-*.json > issue-staging.json`

---

## 6. 记录模板

```markdown
## Phase 12.10.6 PASS Record

**Tester**: <your name>
**Date**: 2026-MM-DD
**Device**: Xiaomi 24115RA8EC (Android 14 HyperOS, arm64-v8a)
**WeChat**: 8.0.55 / Magisk 27.0 + Zygisk on + DenyList com.tencent.mm
**APK**: `v5.0.3.<N>`  + frida-inject 16.5.9 arm64 (~8MB) + arm32 (~7MB)
**Account**: `<uin>` with ~`<N>` contacts + ~`<M>` messages (dataset:full|small)

| # | Scenario | Result | Notes |
|---|---|---|---|
| 12.10.6.1 | 登录绑定 | ✅ / ❌ | `<notes>` |
| 12.10.6.2 | 首次同步 | ✅ / ❌ | ingested=N, wall=`<min>` |
| 12.10.6.3 | 解密 spot-check | ✅ / ❌ | 10/10 match |
| 12.10.6.4 | Ask + LLM | ✅ / ❌ | 3/3 OK, citation N |
| 12.10.6.5 | 增量同步 | ✅ / ❌ | +5 events, <30s |
| 12.10.6.6 | 大库性能 | ✅ / ❌ / skip | wall=`<min>`, rss=`<MB>` |
| 12.10.6.7 | 失败恢复 | ✅ / ❌ | 3/3 子场景 |
| 12.10.6.8 | 长稳 + 反检测 | ✅ / ❌ | 2h no crash, 4/4 sync |

**Overall**: PASS / FAIL

**Follow-up issues**: <link to GitHub issues filed>
```

---

## 7. 相关

- [`Android_WeChat_InApp_Frida_Collector.md`](./Android_WeChat_InApp_Frida_Collector.md) — 总设计 + 7 trap + sub-phase 拆分
- [`Personal_Data_Hub_Phase_12_9_WeChat_RealDevice_E2E_Runbook.md`](./Personal_Data_Hub_Phase_12_9_WeChat_RealDevice_E2E_Runbook.md) — 桌面侧等同 runbook (11 场景，参考)
- [`Adapter_WeChat_SQLCipher.md`](./Adapter_WeChat_SQLCipher.md) — 桌面 adapter 设计；SQLCipher PRAGMA / KDF profile 这边复用
- Memory `android_wechat_collector_phase_12_10.md` — 8 trap，跑前必看
- Memory `wechat_frida_hook_audit_traps.md` — JS hook 3 audit trap (libWCDB 大小写 / args index / hex format)
- Phase 12.10.7 anti-detection 文档 — 长稳验证 §12.10.6.8 fail 时跳这去查

## 附录：规范章节补全（v5.0.3.108）

> 本文为真机 E2E runbook。为对齐项目文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文场景。

### 1. 概述

见正文「范围」。Phase 12.10.6 Android WeChat In-App Collector 真机 E2E runbook：从安装 APK 到 vault 真有 WeChat 数据的 8 场景手动验收剧本（Phase 12.10.4 frida-inject 接通后启用）。

### 2. 核心特性

8 场景手动验收；测试机环境矩阵；性能基准 + 监控；失败诊断材料；记录模板。

### 3. 系统架构

见 `Android_WeChat_InApp_Frida_Collector.md`（总设计）；复用 `Adapter_WeChat_SQLCipher.md` SQLCipher PRAGMA / KDF profile。

### 4. 系统定位

Android 微信采集器的**真机 E2E 验收 runbook**（Phase 12.10.6）。

### 5. 核心功能

见正文 0–6：验收门禁 / 环境矩阵 / 全场景一览 / 详细场景 / 性能基准 / 失败诊断 / 记录模板。

### 6. 技术架构

frida-inject（WeChatFridaInjector）+ SQLCipher 解密；adb 监控。

### 7. 系统特点

12.10.4 实施后即可启用；长稳 §12.10.6.8 fail 跳 Phase 12.10.7 反检测。

### 8. 应用场景

微信采集器发版前 8 场景真机验收。

### 9. 竞品对比

桌面侧等同 runbook（`Personal_Data_Hub_Phase_12_9_WeChat_RealDevice_E2E_Runbook.md`，11 场景参考）。

### 10. 配置参考

见正文 1「测试机环境矩阵」（root / 微信版本 / 设备）。

### 11. 性能指标

见正文 4「性能基准 + 监控指标」。

### 12. 测试覆盖

8 场景（见正文 2/3）；本文即真机验收剧本。

### 13. 安全考虑

微信语料极高敏感；frida 注入触发反检测（§12.10.6.8 长稳）；见 Phase 12.10.7。

### 14. 故障排除

见正文 5「失败诊断材料」；反检测 fail → `Android_WeChat_Phase_12_10_7_AntiDetection.md`；hook traps → memory。

### 15. 关键文件

`WeChatFridaInjector.kt`；`Android_WeChat_InApp_Frida_Collector.md`；`Adapter_WeChat_SQLCipher.md`。

### 16. 使用示例

见正文 3「详细场景」与 6「记录模板」。

### 17. 相关文档

见正文相关链接：`Android_WeChat_InApp_Frida_Collector.md`、`Adapter_WeChat_SQLCipher.md`、`Android_WeChat_Phase_12_10_7_AntiDetection.md`。
