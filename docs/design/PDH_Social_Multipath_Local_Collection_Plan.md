# PDH 社交平台多路径本地数据采集方案

> 版本：v0.1（待审核）  日期：2026-05-25  作者：Claude + longfa
>
> **状态**：方案待审 — 用户审核后才进入 v1.0 实施
>
> 关联：
> - [[android-wechat-collector-phase-12-10]] WeChat root + frida + SQLCipher 模板
> - [[android-qq-collector-phase-13-5]] QQ root + XOR-IMEI 模板
> - [[pdh-websign-bridge-pattern]] Toutiao v0.3 WebView 签名注入模板
> - [[pdh-social-webview-deeplink-cookie-capture]] 5 平台同手机一键登录 cookie 采集
> - `desktop-app-vue/src/main/personal-data-hub/desktop-adb-bridge.js`（**已存在**）
> - `packages/cli/src/lib/host-adb-bridge.js`（**已存在**，ESM 镜像）

---

## 1. TL;DR

为已有 6 个 WebView+HTTP 社交平台（Bilibili / Weibo / Xhs / Douyin / Toutiao / Kuaishou）补齐 **2 条新采集路径**，类似 WeChat / QQ 已有的 root 直读：

- **路径 B（APK 内 root 直读）**：collector 跑在 Android APK 里，需手机 root。复用 `WeChat*Collector` 四件套架构。
- **路径 C（PC + ADB）**：collector 跑在桌面侧，需手机开发者模式 + USB 连接。**已有 host-adb-bridge.js 7 method 基础设施**，只需扩展平台 method。

**关键决策建议**（来自 Web 调研）：

| 平台 | 路径 A (现有 WebView) | 路径 B (APK 内 root) | 路径 C (PC + ADB root) | **本方案推荐** |
|---|---|---|---|---|
| Bilibili | ✅ 已 land | ❌ 不做（本地 db 太弱）| ✅ cookie + 服务端 API | A + C cookie API |
| Weibo | ✅ 已 land | ⚠️ 可做，工程量 4 周（零参考） | ✅ Web cookie scrape | **A + C cookie**，B 推 v0.3 |
| Xhs | ✅ 已 land | ⚠️ 可做，工程量 4 周（零参考） | ✅ X-S 签名 WebView 灌注 | **A 改造**（[[pdh-websign-bridge-pattern]]） |
| Douyin | ✅ 已 land | ✅ **做**（明文 sqlite，DFIR 取证有参考）| ✅ ADB 拉 db | **A + B + C 全做**，明星案例 |
| Toutiao | ✅ 已 land | ⚠️ 可做，工程量 3 周（schema 待逆向）| ✅ cookie + Web API | A + C cookie API，B 推 v0.4 |
| Kuaishou | ✅ 已 land | ⚠️ 可做，工程量 4 周（零参考） | ✅ NS_sig3 WebView 灌注 | **A 改造**（[[pdh-websign-bridge-pattern]]） |

**净落地量**：路径 B 只在 Douyin 真正可行（有公开 DFIR 取证资料）；路径 C 全 6 个都可做（基础设施已成熟）。其余 5 个平台的"路径 B"工程量 ≥ 4 周/家，公开调研为零，**不建议作为 v1.0 目标**。

---

## 2. 现状盘点

### 2.1 已 land 的本地数据路径（2/8）

| 平台 | 路径 | 关键文件 | 关键 trap |
|---|---|---|---|
| WeChat | SQLCipher + frida sqlite3_key_v2 hook | `pdh/social/wechat/{CredentialsStore, DbExtractor, FridaInjector, LocalCollector}.kt` | 7 trap（[[android-wechat-collector-phase-12-10]]） |
| QQ | XOR-IMEI 算法（无 frida） | `pdh/messaging/qq/{CredentialsStore, DbExtractor, XorDecryptor, LocalCollector}.kt` | 10 trap（[[android-qq-collector-phase-13-5]]） |

### 2.2 已 land 的 PC+ADB 基础设施（**重要发现**）

`packages/cli/src/lib/host-adb-bridge.js`（ESM）+ `desktop-app-vue/src/main/personal-data-hub/desktop-adb-bridge.js`（CJS 镜像）已暴露 7 个 method：

```javascript
{
  caps()  // sync: { available: true }
  invoke(method, params)  // async
    // - contacts.query     content://com.android.contacts/contacts
    // - app.list           pm list packages -3
    // - sms.query          content://sms
    // - call.query         content://call_log/calls
    // - media.list         find /sdcard/{DCIM,Pictures,Movies,Download,Documents}
    // - snapshot.list      run-as com.chainlesschain.android.debug ls staging/
    // - snapshot.read      run-as ... cat staging/<file>.json
}
```

**已踩过的 trap**（含在源码注释）：
- Windows CRLF：JS `$` 不匹配 `\r` 前，全部 parse 必先 `.replace(/\r+$/, "")`
- adb stderr 包含 info 行，只有匹配 `error:|failed:|protocol fault` 才报错
- `run-as` 仅对 debuggable 包（即 `<pkg>.debug` 变种），release 包必须用 `su -c`
- 0/多设备场景必报清晰 typed error，绝不 silent 取第一个
- `_bridgeAvailable()` 必须 sync 返回 true，真实失败延迟到 `invoke()` 抛 typed error

**结论**：路径 C 不需要 Phase 0 重做 infra，只需扩展 method。

### 2.3 待补全的 6 平台 collector 当前状态

| 平台 | A 路径（WebView）| 工程量预估（B + C 全做）|
|---|---|---|
| Bilibili | `pdh/social/bilibili/` 5 文件 + WBI 签名已修 (`fbb125295`) | C 路径 1 周 / 不建议 B |
| Weibo | `pdh/social/weibo/` 含 SocialCookieWebView 接通 | C 路径 1 周 / B 路径 4 周（零参考）|
| Xhs | `pdh/social/xiaohongshu/` 含 X-S 签名（[[pdh-websign-bridge-pattern]] 加固待跟 v0.3）| C 路径 1.5 周 / B 路径 4-6 周 |
| Douyin | `pdh/social/douyin/` v0.1 placeholder（5 卡）| **B 路径 2 周（DFIR 有参考）+ C 路径 1 周** |
| Toutiao | `pdh/social/toutiao/` v0.1 placeholder（5 卡）+ 签名 stub | C 路径 1 周 / B 路径 3 周（schema 待逆向）|
| Kuaishou | `pdh/social/kuaishou/` v0.1 placeholder（6 卡）+ NS_sig3 stub | C 路径 1.5 周 / B 路径 4 周 |

---

## 3. 三模式架构

```
┌────────────────────────────────────────────────────────────────────┐
│ 用户端选择                                                          │
│                                                                    │
│  ┌──────────┐    ┌────────────┐    ┌─────────────┐                 │
│  │ 模式 A   │    │  模式 B    │    │  模式 C     │                 │
│  │ WebView  │    │ APK + root │    │ PC + ADB    │                 │
│  └────┬─────┘    └─────┬──────┘    └──────┬──────┘                 │
│       │                │                  │                        │
│       ▼                ▼                  ▼                        │
│  HubLocalScreen   Android APK 内          desktop-app-vue          │
│  + WebView         pdh/social/<plat>/      + adb shell             │
│  + Api Client      四件套                  + host-adb-bridge       │
│  + cookie scrape   + frida/sql/key       + DevicePicker UI         │
│                    + SnapshotJson →       + 桌面侧 decrypt         │
│                      vault.db             + → vault.db            │
└────────────────────────────────────────────────────────────────────┘
```

### 3.1 模式 A（现状）— WebView Cookie + HTTP API

- **触发**：手机内 APK 用户登录目标平台
- **依赖**：cookie scrape + HTTP 签名 + WBI/X-S/X-Bogus
- **不要求**：root
- **限制**：受平台反爬限制，silent `{code:0,data:[]}` 风险
- **保留原因**：广覆盖（多数用户非 root），是 fallback baseline

### 3.2 模式 B（新）— APK 内 root + 本地 db 直读

- **触发**：手机 root + APK 内 collector
- **依赖**：su / frida / SQLCipher binding / sqlite jdbc
- **架构模板**：WeChat（SQLCipher + frida）或 QQ（纯算法）
- **限制**：
  - APK 体积涨 14-80 MB（frida-inject 14 MB + WCDB native 16 MB + SQLCipher 50 MB）
  - 仅 Douyin 有现成 DFIR 取证参考（abrignoni）；其余 5 家需从零逆向
  - 每个平台版本升级都要重新 sanity check（key 派生 / schema 漂移）
- **优势**：完全离线 / 不受平台反爬 / 全量历史数据

### 3.3 模式 C（新）— PC + ADB 桌面侧采集

- **触发**：手机开发者模式 + USB 调试 + 桌面端启 PDH 同步
- **依赖**：`adb` 二进制（PATH 或 vendor）+ `host-adb-bridge` invoke()
- **架构模板**：复用 `system-data-android` adapter 套路（已 land），加平台 method
- **子路径**：
  - **C1 非 root**：cookie scrape + `/sdcard/Android/data/<pkg>/` + content provider
  - **C2 root**：`adb shell su -c base64 /data/data/<pkg>/.../foo.db` 或 stage-via-sdcard
- **优势**：
  - decrypt 逻辑跑 PC 端，迭代调试 100× 快（不用 build/install APK）
  - APK 干净，不引入 frida / SQLCipher 重依赖
  - 桌面用户专属强能力（差异化卖点）
- **限制**：
  - 需手机 + PC 物理连接（mobile-only 用户拿不到）
  - SELinux / MIUI 安全设置等 vendor-specific trap（[[android-runas-loopback-selinux-split]]）

---

## 4. 关键技术发现（来自 Web 调研）

### 4.1 公开 db 资料密度（决定逆向工作量）

| 平台 | 公开本地 db 资料 | 主要资料类型 |
|---|---|---|
| WeChat | **高** | sjqz 项目 / 美亚杯取证 / EnMicroMsg.db key 派生 |
| QQ | **高** | sjqz / slowtable.db / XOR-IMEI 公开 |
| Douyin | **高** | abrignoni DFIR-SQL-Query-Repo + ACM 论文 + 明文 sqlite + 19位UID命名 |
| Bilibili | 极低 | 本地 db 几乎不用，BilibiliHistoryFetcher 走 cookie API |
| Weibo | **零** | 公开调研全是协议层签名（s/p/gsid/RSA），无 db |
| Xhs | **零** | 公开调研全是协议层 X-S/shield，无 db |
| Toutiao | **零** | 公开仅协议层 cookie + iMeiji/Toutiao Web API |
| Kuaishou | **零** | 公开仅 libmsaoaidsec.so / NS_sig3 协议层 |

**结论**：模式 B 真正能 ship 的只有 Douyin。其余 5 家做模式 B 等于从零逆向 4 周 × 5 家 = 20 周工程量。

### 4.2 反检测强度（决定能不能 hook）

| 平台 | 反 frida | anti-root | SO 检测 |
|---|---|---|---|
| Douyin | ⭐⭐⭐⭐⭐ libmsaoaidsec.so 主动 TracerPid | 强 | 加固 |
| Kuaishou | ⭐⭐⭐⭐ 同名 libmsaoaidsec.so | 强 | 加固 |
| Weibo | ⭐⭐⭐ 360 加固 + libjiagu.so | 中 | 加固 |
| Xhs | ⭐⭐⭐ libshield.so | 中 | 加固 |
| Toutiao | ⭐ | 弱 | 弱 |
| Bilibili | ⭐ libbili.so 仅签名 | 弱 | 弱 |

**结论**：模式 B 在 Douyin/Kuaishou 必须 spawn 模式 + libmsaoaidsec.so bypass JS（公开可得）。

### 4.3 ADB 工具链（决定模式 C 难度）

- **Node 库**：`@devicefarmer/adbkit` 维护中（v3.3.8 / 2024-11），但项目已用 `execFile(adb)` 直跑，**短期不切**
- **adb 二进制**：用户系统 PATH 优先 + 可选 vendor platform-tools (12-15MB/OS) 兜底
- **非 root yield**：sandbox-external 媒体 + content provider + 公共目录；**不含**社交 app 私有 db
- **root yield**：`su -c base64` streaming 或 stage-via-sdcard，注意 MIUI SELinux label 重映射
- **adb backup**：Android 12+ 已死，platform-tools r34 删除，**不在考虑范围**
- **参考架构**：escrcpy（Electron + Vue + adbkit + bundled binary，无强制 device APK）—— 跟本项目最契合

---

## 5. 共享四件套接口（来自 WeChat + QQ 提炼）

### 5.1 抽象接口 `LocalRootCollector<Result>`（Kotlin）

```kotlin
// 路径 B 统一接口 — 6 平台 collector 都实现
interface LocalRootCollector {
    suspend fun snapshot(): SnapshotResult
}

// 标准化的 SnapshotResult 等价类
sealed class SnapshotResult {
    data class Ok(
        val snapshotPath: String,        // staging JSON
        val totalEvents: Int,
        val perCategoryCounts: Map<String, Int>,  // 替换 WeChat 的 contactCount/messageCount/chatroomCount
        val snapshottedAt: Long,
        val diagnosticFields: Map<String, String> = emptyMap(),  // platform-specific (pragmaProfile / keyProvider)
    ) : SnapshotResult()
    object NoCredentials : SnapshotResult()
    object NoRoot : SnapshotResult()
    data class NoDbKey(val provider: String) : SnapshotResult()    // 仅 SQLCipher 路径
    data class FridaInjectFailed(val reason: String) : SnapshotResult()  // 仅 frida 路径
    data class ExtractFailed(val reason: String, val message: String? = null) : SnapshotResult()
    data class Failed(val reason: String, val message: String? = null) : SnapshotResult()
}
```

### 5.2 路径 B 四件套（来自 WeChat / QQ 提炼）

| 文件 | 职责 | 平台差异点 |
|---|---|---|
| `<Plat>CredentialsStore.kt` | EncryptedSharedPreferences 存 uid/imei/dbKeyHex/lastSync/error | 完全可复用，只换 prefs filename |
| `<Plat>DbExtractor.kt` | 检 root → cohort copy db+wal+shm → 解密 → 表 probe → JSON dump | **核心分歧**：SQLCipher (WeChat 模板) vs 明文 (QQ/Douyin) vs 加密变种 |
| `<Plat>KeyProvider.kt`（可选）| key 派生算法（IMEI XOR / MD5 / Frida hook） | 仅 SQLCipher 路径有 |
| `<Plat>LocalCollector.kt` | 编排 CredentialsStore → KeyProvider → DbExtractor → 写 vault | 模板完全镜像 WeChat |

### 5.3 路径 C bridgeProvider 扩展（来自 host-adb-bridge 提炼）

```javascript
// 现有 host-adb-bridge.js invoke() switch 加平台分支
invoke(method, params) {
  switch (method) {
    // ── 现有 ───
    case "contacts.query": ...
    case "app.list": ...
    case "sms.query": ...
    case "call.query": ...
    case "media.list": ...
    case "snapshot.list": ...
    case "snapshot.read": ...

    // ── 新加（每平台 2-3 个 method）───
    case "douyin.snapshot":  // root: su -c base64 /data/data/.../<uid>_im.db
    case "douyin.cookies":   // non-root: read webview_cookies.db via content provider
    case "weibo.cookies":    // non-root: 同上
    case "weibo.cache":      // non-root: pull /sdcard/Android/data/com.sina.weibo/
    case "bilibili.cookies": // non-root: standard chromium WebView cookies db
    case "bilibili.download":// non-root: pull /sdcard/Android/data/.../download/
    case "xhs.cookies": ...
    case "toutiao.cookies": ...
    case "kuaishou.cookies": ...
  }
}
```

---

## 6. 6 平台 per-platform 推荐路径

### 6.1 Douyin（明星案例 — 完整三路径）

**路径 B（APK 内 root）— 推荐做 v0.2**
- DB：`<uid>_im.db` + `db_im_xx`（明文 SQLite，无 SQLCipher）
- 表：`msg`(sender, created_time, content json) + `SIMPLE_USER`(UID, nickname)
- 参考：[abrignoni DFIR](https://abrignoni.blogspot.com/2018/11/finding-tiktok-messages-in-android.html) + [DFIR-SQL-Query-Repo/TIKTOK](https://github.com/abrignoni/DFIR-SQL-Query-Repo/blob/master/Android/TIKTOK/TikTokMessages.sql)
- frida：spawn 模式 + libmsaoaidsec.so bypass（公开 hook 脚本可得）
- 工程量：**2 周**（有 DFIR 参考起手）

**路径 C（PC + ADB root）— 推荐做 v0.2 同期**
- 桌面侧加 `douyin.snapshot` method：`adb shell su -c "base64 /data/data/com.ss.android.ugc.aweme/databases/<uid>_im.db"` → 桌面 sqlite-jdbc 直读
- 优势：iterate 比 APK 内快 10×，不用 build/install
- 工程量：1 周（共享 sqlite-jdbc 解析逻辑）

**路径 A 现状保留**：cookie + a_bogus/_signature 签名（[[pdh-websign-bridge-pattern]] v0.2 待跟）

### 6.2 Weibo（C 优先 + B v0.3）

**路径 C（PC + ADB）— v0.1 立即做**
- 非 root 路径：`adb pull /sdcard/Android/data/com.sina.weibo/` 取视频缓存
- root 路径：`su -c base64 ...` 拉 weibo.db（schema 需真机 frida hook 一次性 dump）
- 工程量：1 周（非 root）+ 2 周（root + schema 探测）

**路径 B（APK 内 root）— v0.3 增强**
- 零公开资料 → 从零逆向（jadx + frida hook SQLiteOpenHelper）
- 工程量：**4 周**（不推荐 v1.0 必做）

### 6.3 Xhs（A 路径加固 + C 增强）

**路径 A 加固优先**：用 [[pdh-websign-bridge-pattern]] Toutiao 模板把 X-S 签名 JS 灌注到隐藏 WebView，**不要**纯 Kotlin 复刻（libshield.so 每 4-8 周 rotate）

**路径 C**：`adb pull /sdcard/Android/data/com.xingin.xhs/` 取缓存图 + cookie

**路径 B**：零参考 → 4-6 周从零（不推荐 v1.0）

### 6.4 Bilibili（仅 A + C cookie，不做 B）

**关键洞察**：BilibiliHistoryFetcher 等社区项目全走 `SESSDATA` cookie + `api.bilibili.com/x/web-interface/history/cursor`，**本地 db 几乎不用**。

**路径 C**：标准 Chromium WebView `/data/data/tv.danmaku.bili/app_webview/Default/Cookies` (明文 sqlite) → 提 SESSDATA / bili_jct → 桌面侧调云端 API
工程量：1 周

**路径 B**：**不做**（投入产出比极差）

### 6.5 Toutiao（C cookie 优先 + B v0.4）

**路径 C**：同 Bilibili 走 cookie + Web API（is.snssdk.com endpoint，参考 iMeiji/Toutiao）
工程量：1 周

**路径 B**：字节系共用 sqlite 框架推论（同抖音明文）但无明确取证 schema 资料 → 3 周

### 6.6 Kuaishou（A 加固 + C 增强）

**路径 A 加固**：[[pdh-websign-bridge-pattern]] 灌注 NS_sig3 签名 JS（待 v0.2）

**路径 C**：`adb pull /sdcard/Android/data/com.smile.gifmaker/cache/.cache` + cookie
工程量：1.5 周

**路径 B**：零参考 + libmsaoaidsec.so 反 frida → 4 周

---

## 7. 串行 Phase 计划

按用户已定串行顺序 + 调研结果调整后的优先级：

### Phase B0 — 共享脚手架（1 周）

- 抽象 `LocalRootCollector` interface + `SnapshotResult` sealed class
- 抽象 `<Plat>CredentialsStore<T>` 模板基类（uid/lastSync/error 共有字段）
- 抽象 `DbCohortCopier`（su -c cp + WAL/SHM 三件套）— 把 WeChat/QQ 的 `copyDbCohortViaSu()` 提到 base class
- 抽象 `BridgeProviderExtension` 桌面侧 method 注册接口
- JVM 单测：fixture in-memory sqlite + mock su + mock frida

### Phase 1 — Bilibili C 路径（1 周）

- host-adb-bridge 加 `bilibili.cookies` + `bilibili.download`
- desktop SystemDataAndroidAdapter 复制为 BilibiliAdapter（snapshot mode 已成熟）
- Vault 写入 + UI 卡更新
- 真机 E2E：root + non-root 各跑一遍
- **里程碑 1**：第一个 C 路径跑通

### Phase 2 — Douyin B + C 双路径（3 周）

- B 路径：DouyinDbExtractor + DouyinLocalCollector（明文 sqlite + DFIR 参考）+ libmsaoaidsec.so bypass JS
- C 路径：`douyin.snapshot` method + 桌面 sqlite-jdbc 解析
- 真机 E2E：测两路径
- **里程碑 2**：B + C 双路径模板成型，可复制到其它平台

### Phase 3 — Weibo C + Xhs A 加固（2 周）

- Weibo C：`weibo.cookies` + `weibo.cache`（先非 root，root schema 探测推 v0.2）
- Xhs A 加固：[[pdh-websign-bridge-pattern]] 灌注 X-S 签名
- 真机 E2E
- **里程碑 3**：Weibo C 跑通，Xhs A 抗 rotate

### Phase 4 — Toutiao C + Kuaishou A 加固（1.5 周）

- Toutiao C：cookie + Web API
- Kuaishou A 加固：NS_sig3 灌注
- **里程碑 4**：4 平台 C 路径全 ship

### Phase 5 — Weibo / Xhs C root schema 真机探测（1 周，可选）

- 用户 root 真机 frida hook `SQLiteOpenHelper` dump CREATE TABLE
- 归档 schema 到 `docs/design/<plat>_db_schema_snapshot.md`
- 决定是否 Phase 6 做 B 路径

### Phase 6 — Weibo / Xhs / Toutiao / Kuaishou 路径 B（可选 + 长尾，4 × 4 周）

- 仅当 Phase 5 schema 探测成功才启动
- 单平台 4 周 / 家 = 总 ~16 周
- **建议 defer 到 v2.0+**

**总工时（v1.0 目标 Phase B0-4）**：≈ **8.5 周**

---

## 8. Trap 清单（来自 WeChat / QQ + ADB infra + 新增）

### 8.1 来自 WeChat / QQ 已落实的 18 trap（必复用）

WeChat 7 trap：
1. MIUI 14 EncryptedSharedPreferences 首创建失败（`WeChatCredentialsStore.kt:69-78`）
2. frida-inject 二进制 14-20MB 增 APK 体积（`WeChatFridaInjector.kt:103-113`）
3. W^X 禁 filesDir exec，必须 /data/local/tmp（`WeChatFridaInjector.kt:131-145`）
4. Runtime.exec("su") 在 MIUI silent 失败（`WeChatFridaInjector.kt:335-352`）
5. SQLCipher hex → bytes 错报"file is not a database"（`WeChatDbExtractor.kt:120-125`）
6. PRAGMA cipher_compatibility 必须先于 key（`WeChatDbExtractor.kt:255-261`）
7. WAL .db-wal/.db-shm 未一起复制 → 数据 stale（`WeChatDbExtractor.kt:336-346`）

QQ 10 trap：
1-10. 见 [[android-qq-collector-phase-13-5]]，含 IMEI 输入校验 / 三表 probe 顺序 / GBK fallback / Byte 有符号 XOR 等

### 8.2 来自 ADB infra 已落实的 5 trap（必复用）

- Windows CRLF：JS `$` 不匹配 `\r`，必 `.replace(/\r+$/, "")`
- adb stderr 含 info 行：只匹配 `error:|failed:|protocol fault` 才报错
- `run-as` 仅 debuggable 包：release `<pkg>` 不可用，必判 `package not debuggable`
- 0/多设备：必报 typed error，禁 silent 第一个
- `_bridgeAvailable()` 必 sync：真实失败延迟到 invoke() 抛 typed error

### 8.3 模式 C 新增预期 trap（方案预判）

| Trap | 描述 | 缓解 |
|---|---|---|
| **#26 候选** | MIUI/HyperOS FUSE 重映射 SELinux label，`su -c cp ... /sdcard/` 静默丢标 | 改用 `cat \| base64` streaming，不走 sdcard 中转 |
| **#27 候选** | adb 双 server 冲突：用户系统 adb + vendor adb 协议版本不一致互杀 | `ADB_SERVER_PORT=5038` 隔离 |
| **#28 候选** | 抖音 `libmsaoaidsec.so` TracerPid 检测，attach 模式 frida 立刻被杀 | 必 spawn 模式 + `--no-pause` |
| **#29 候选** | Windows + 中文路径下 adb pull 落地文件名 GBK 乱码 | 桌面侧落地时强制 UTF-8 文件名 + `chcp 65001`（按 [[encoding.md]] 规则）|
| **#30 候选** | 平台版本升级 silent schema 漂移（B 站 / 抖音都见过）| 每次 sync 必 `PRAGMA table_info(<tab>)` validate，列对不上跳过并 `recordError` |

### 8.4 合规护栏 trap（法律侧）

- Play Store / 国内应用市场：companion APK 不得通过应用市场分发（侵犯第三方 app ToS 灰区），仅自己网站 sideload（项目 SeedRegistry 已对齐此 posture）
- 个人信息保护法：必须 UI 显式 per-category 同意 + 同意日志 + 数据仅本地（PDH vault 已对齐）
- 抖音 `aweme_user.xml` 留存已注销账号痕迹：UI 必须告知"会读取你已注销的历史数据"
- 私信 db 涉及对端用户隐私：默认 opt-out + 二级确认

---

## 9. 真机 E2E Plan（必走，Win 跑不动）

### 9.1 设备需求

- 真 root 手机 ×1（推荐 Pixel + Magisk + LineageOS 或 一加 + ColorOS root）
- 非 root 手机 ×1（验证模式 C1 fallback）
- Mac 或 Linux 桌面（部分 adb 行为 Win 与 Mac/Linux 不一致）

### 9.2 测试矩阵

| 平台 | 模式 A | 模式 B | 模式 C-root | 模式 C-nonroot | 测试场景 |
|---|---|---|---|---|---|
| Bilibili | - | - | 1 case | 1 case | cookie → 历史 / 收藏 / 关注 |
| Douyin | - | 3 case | 3 case | 1 case | 私信 / 浏览 / 关注 |
| Weibo | - | - | 2 case | 1 case | cookie → 私信 / 时间线 / 收藏 |
| Xhs | 2 case（X-S rotate 抗性） | - | - | 1 case | 笔记收藏 / 私信 |
| Toutiao | - | - | 2 case | 1 case | 阅读历史 / 收藏 |
| Kuaishou | 2 case（NS_sig3 抗性）| - | - | 1 case | 视频缓存 |

**累计**：约 21 个真机 E2E case，分散到 Phase 1-4 每个 milestone 末。

### 9.3 桌面侧 E2E（Vitest + 真 adb，CI on Mac runner）

- mock device 用 emulator + 预 push fixture db
- assertEqual snapshot JSON 期望产物
- 不需要真 social account（fixture 即可）

---

## 10. Open Questions（需要用户审核时回答）

1. **Phase 6 是否进入 v1.0 scope？**
   - 进 = 加 ~16 周（Weibo/Xhs/Toutiao/Kuaishou 从零逆向 B 路径）
   - 不进 = v1.0 总工时 8.5 周，路径 B 仅 Douyin
   - **建议**：不进 v1.0，defer 到 v2.0+（公开调研为零，每家平台改一次就重逆向，性价比差）

2. **路径 C 的 adb 二进制 vendor 还是 detect？**
   - vendor：每 OS +12-15 MB 安装包，零配置
   - detect：用户自己装 platform-tools，安装包不涨
   - **建议**：detect 优先（开发者用户基本都装了），找不到时 UI 给一键下载链接（不 ship）

3. **模式 C 的 DevicePicker UI 落在哪？**
   - 桌面 V6 新页面 `/personal-data-hub/devices`（推荐）
   - 还是 V5 Settings 子页

4. **Companion APK 策略？**
   - 像 scrcpy 走 transient JAR push（无安装）
   - 还是像 Vysor 装一个 helper APK
   - **建议**：transient 优先，零应用市场政策风险

5. **抖音 B 路径优先级**：现在排 Phase 2（第 2-4 周），还是先把 6 个 C 路径全跑通再回头做 B？
   - 现在做 B：明星案例早出
   - 推后：先广覆盖再深耕

6. **真机测试**：用户提到有 root 真机，但具体型号 / Android 版本 / 是否 MIUI？这影响 trap #26 是否实际发生

---

## 11. 文档变更预算

本方案落地后需新增/更新：

- `docs/design/PDH_Social_Multipath_Local_Collection_Plan.md`（本文，已写）
- `docs/design/Android_Douyin_InApp_PlainSqlite_Collector.md`（Phase 2 v0.2 时写）
- `docs/design/PDH_Desktop_Adb_Bridge_Platform_Extension.md`（Phase B0 时写）
- `docs/internal/hidden-risk-traps.md` 新增 #26-#30
- memory 新增 5 条：`pdh_douyin_dfir_template` / `pdh_pc_adb_collector_pattern` / `pdh_libmsaoaidsec_bypass` / `pdh_selinux_label_remap_miui` / `pdh_adb_server_port_isolation`
- `CLAUDE.local.md` Phase 1-4 commit pointers

---

## 12. 待用户审核反馈点

请在下次回复中明确：

- [ ] **整体方案方向** OK / 调整方向 / 否决
- [ ] **Open Questions #1**（Phase 6 是否进 v1.0）
- [ ] **Open Questions #2**（adb vendor or detect）
- [ ] **Open Questions #3**（DevicePicker UI 位置）
- [ ] **Open Questions #4**（companion APK 策略）
- [ ] **Open Questions #5**（抖音 B 路径优先级）
- [ ] **Open Questions #6**（root 真机型号 / Android 版本 / ROM）
- [ ] **是否启动 Phase B0 共享脚手架实施**

审核通过后我才开始写代码。

## 附录：规范章节补全（v5.0.3.108）

> 本文为采集方案（待审核）。为对齐项目文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文细节。

### 1. 概述

见正文头部。PDH 社交平台多路径本地数据采集方案（v0.1 待审核）：规划社交平台「多路径」（cookie/HTTP C 路径 + 本机 DB Mode B + frida）本地采集的统一方案与共享脚手架（Phase B0）。

### 2. 核心特性

多路径采集（C 路径 / Mode B / frida）；共享脚手架（Phase B0）；DevicePicker UI；companion APK 策略。

### 3. 系统架构

见正文架构；各平台多路径写同一 adapter（schemaVersion + 跨路径 dedup）。

### 4. 系统定位

PDH 社交多平台本地采集的**总方案 / 上游设计**（Mode B Phase 7 等的上游）。

### 5. 核心功能

见正文：多路径定义 / 共享脚手架 / DevicePicker / 各平台路径优先级。

### 6. 技术架构

C 路径（cookie/HTTP）+ Mode B（root 本机 DB）+ frida（v2.0）；共享 adb su sqlite3 流程。

### 7. 系统特点

Open Questions 待拍板（DevicePicker UI / companion APK / 抖音 B 优先级 / root 真机型号 / Phase B0 启动）；审核通过才写代码。

### 8. 应用场景

社交多平台本地采集的统一规划与脚手架。

### 9. 竞品对比

多路径（C / Mode B / frida）覆盖度 vs 单路径。

### 10. 配置参考

DevicePicker UI 位置；companion APK 策略；root 真机型号 / Android / ROM（见 Open Questions）。

### 11. 性能指标

各路径覆盖率 / 成功率（按平台）。

### 12. 测试覆盖

下游 Mode B Phase 7 各平台 E2E（`PDH_Mode_B_*`）。

### 13. 安全考虑

cookie / 本机 DB / frida 均高敏感；root 依赖；SQLCipher 加密。

### 14. 故障排除

各路径失败 → 见下游各平台 E2E doc。

### 15. 关键文件

共享脚手架（Phase B0，`pdh/social/common/`）；各平台 adapter。

### 16. 使用示例

见正文多路径采集流程与 DevicePicker。

### 17. 相关文档

下游：`PDH_Mode_B_Phase_7_Plan.md`、`PDH_Mode_B_Phase_7_Complete.md`、各 `PDH_*_Real_Device_E2E.md`；memory `pdh_multipath_phase_b0_scaffold.md`。
