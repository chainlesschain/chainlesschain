# Android 端 WeChat 8.0+ 本机采集 — frida-in-app 方案

> **状态**: 设计 v0.1 — 2026-05-22。Scaffold 已 land，frida 真注入 + 真机 E2E 待做（5-7d）。
>
> **谁该读**：(1) 想完成 `HubLocalScreen.kt` "微信 placeholder" 那张卡的工程师 (2) 评估 Play Store 上架 / 反检测风险的产品 (3) 维护 [`Adapter_WeChat_SQLCipher.md`](./Adapter_WeChat_SQLCipher.md) 桌面侧 adapter 的人

---

## 0. 为什么需要这个

桌面侧 [`packages/personal-data-hub/lib/adapters/wechat/`](../../packages/personal-data-hub/lib/adapters/wechat/) 已经把"从 adb pull 出来的本地文件解密 + ingest"这条路打通了，但**用户体验上**有断点：

1. 用户必须在桌面侧装好 cc + Node 22 LTS + 跑 `cc ui` + 接 USB
2. WeChat 数据采集前要 `adb shell su -c "tar -czf ..."` + `adb pull` 整目录
3. 全程要桌面机干预

而 Android 端 `HubLocalScreen.kt` 已经有"微信" placeholder 卡，并列在 Bilibili 旁边。用户视角期望：**"我直接在 Android app 上点'同步'就把微信数据搞进 vault"**。这就是 in-app collector 的目标。

---

## 1. 与桌面侧 adapter 的关系

| 维度 | 桌面侧 (`packages/personal-data-hub/lib/adapters/wechat/`) | Android in-app collector |
|---|---|---|
| 物理位置 | 桌面机 Node.js 进程 | Android app 进程 |
| 数据源 | adb pull 出来的本地文件 | 直接读 `/data/data/com.tencent.mm/` |
| 密钥提取 | MD5 (uin+imei) for 7.x / **frida-server on device** for 8.0+ | MD5 for 7.x / **frida-gum embedded in app** for 8.0+ |
| 跨进程 hook | adb → frida-server → libWCDB.so | Magisk-su → frida-inject → libWCDB.so |
| 用户依赖 | USB、adb、桌面机、Node | Magisk-su（设备 root 一次即可） |
| Vault 落盘 | 桌面机 `~/.chainlesschain/vault.db` | Android `filesDir/vault.db` (SQLCipher) |
| Sync 触发 | `cc hub sync-adapter wechat` | Android HubLocal "立即同步" 按钮 |

**两者共存的 invariant**: normalize 逻辑、Person/Event/Item entity shape、audit log row format **完全一致**——这样未来想从 Android 同步到桌面 / 或者 cross-device merge 时数据互兼容。

复用策略：**Kotlin 侧只实现 (1) frida injection (2) DB extraction**；normalize 逻辑通过把原始 row 交给共享的 JS 实现（via `cc` subprocess + LocalCcRunner）。这避免在 Kotlin 里维护一份与 Node 侧并行漂移的 normalize。

---

## 2. 总体架构

```
┌──────────────────────────────────────────────────────────────────┐
│ Android app (com.chainlesschain.android)                         │
│                                                                  │
│  HubLocalScreen.kt                                               │
│   └─ SocialAdapterCard("wechat")                                 │
│       └─ onLogin / onSync / onLogout                             │
│           │                                                      │
│  HubLocalViewModel.kt                                            │
│   └─ wechat: SocialCardState                                     │
│   └─ requestWechatLogin() / syncWechat() / logoutWechat()        │
│       │                                                          │
│  pdh/social/wechat/                                              │
│   ├─ WeChatCredentialsStore.kt                                   │
│   │   EncryptedSharedPreferences { uin / dbKeyHex / lastSyncAt } │
│   │                                                              │
│   ├─ WeChatFridaInjector.kt   ◄─── 真机才能验                    │
│   │   1. 检查 Magisk-su 可用                                     │
│   │   2. su -c "/data/local/tmp/frida-inject -p $(pidof com..mm) │
│   │              -l agent.js"                                    │
│   │   3. 监听 frida-message stdout → JSON parse                  │
│   │      获取 sqlite3_key_v2 第 2 个参数（kBytes hex）           │
│   │   4. 把 hex key 存到 CredentialsStore                        │
│   │                                                              │
│   ├─ WeChatDbExtractor.kt                                        │
│   │   1. su -c "cp /data/data/com.tencent.mm/MicroMsg/<md5>/     │
│   │              EnMicroMsg.db <app_cache>/wx-staging.db"        │
│   │   2. 用 net.zetetic:sqlcipher-android:4.12.0 打开            │
│   │   3. SELECT * FROM rcontact / message / chatroom / ...       │
│   │   4. 导出原始 row 到 JSON （不在 Kotlin 侧 normalize）        │
│   │                                                              │
│   └─ WeChatLocalCollector.kt   (orchestrator)                    │
│       1. 检 credentials store                                    │
│       2. 跑 Injector（如 8.0+）→ 拿 key                          │
│       3. 跑 DbExtractor → 出 raw JSON                            │
│       4. 写 staging file                                         │
│       5. LocalCcRunner.syncAdapter("wechat", path)               │
│          (cc 用桌面 wechat adapter normalize + 入本机 vault)     │
└──────────────────────────────────────────────────────────────────┘
```

---

## 3. 关键模块

### 3.1 WeChatCredentialsStore

镜像 `BilibiliCredentialsStore`：EncryptedSharedPreferences 存 (uin, dbKeyHex, lastSyncAt, lastSyncCount)。SharedPreferences 用 androidx Keystore-backed 加密，避免明文 key 落盘。

**字段**:
- `uin: String` — 用户的 WeChat 数字 UIN
- `dbKeyHex: String` — 32-byte (64 hex chars) SQLCipher key
- `keyProvider: String` — `md5` / `frida` (诊断用)
- `lastSyncAt: Long` — epoch ms
- `lastSyncCount: Int` — last successful ingest count
- `lastErrorCode: Int` — 失败诊断
- `lastErrorMessage: String?` — 失败诊断

**Trap 1**: EncryptedSharedPreferences 在某些 OEM ROM (MIUI 14) 上首次创建会失败，进 `KeystoreException`。fallback：plain SharedPreferences + 用 androidx security `MasterKey`。

### 3.2 WeChatFridaInjector

**这是整套方案的技术难点。需要真机验证才能确认可工作。**

#### 3.2.1 Approach A — bundled `frida-inject` binary

把 `frida-inject` (frida 16.x) 的 arm64-v8a + armeabi-v7a binaries 打包到 app 的 `assets/frida/`，运行时：
```kotlin
val arch = if (Build.SUPPORTED_ABIS.contains("arm64-v8a")) "arm64" else "arm"
val asset = "frida/frida-inject-${arch}"
copyAssetToFilesDir(asset, "frida-inject")
chmod("0755", "$filesDir/frida-inject")

val agentJs = copyAssetToFilesDir("frida/wechat-key-hook.js", "wechat-key-hook.js")

val cmd = "${filesDir}/frida-inject -p $(pidof com.tencent.mm) " +
    "-s ${agentJs} --runtime=v8"
val proc = Runtime.getRuntime().exec(arrayOf("su", "-c", cmd))
val reader = BufferedReader(InputStreamReader(proc.inputStream))
// parse frida-message lines → extract sqlite3_key_v2 args
```

复用桌面侧的 `wechat-key-hook.js` (`packages/personal-data-hub/lib/adapters/wechat/frida-agent/wechat-key-hook.js`)，因为 JS agent 在目标进程里跑 V8 runtime，跟桌面注入同一份代码。

**Trap 2**: `frida-inject` 二进制约 7-10MB，× 2 ABI = 14-20MB app size 涨幅。对 Play Store 不友好（rejection + APK 体积）。
**Trap 3**: 第一次启动要 `su -c` 把 binary 复制到 `/data/local/tmp/` 因为 W^X 限制 app filesDir 不能 exec。memory `android_native_lib_extract_w_x.md` 有同类讨论。
**Trap 4**: 直接走 `Runtime.getRuntime().exec("su", "-c", ...)` 在某些 MIUI ROM 上 silent 失败（即使 root）—— Magisk-su prompt 没弹。需要绕道 `libsu` 库。

#### 3.2.2 Approach B — frida-gum AAR 内嵌

理论上 frida 项目 ship 了 `frida-gum.aar` (用 frida-core 的 Java binding)，把它当成 dependency。这条路 in-process inject，**只能 hook 自己进程**——hooks 不到 com.tencent.mm。**否决**。

#### 3.2.3 Approach C — Magisk module 预装

用户预装 LSPosed 或 Riru-modulename module 永久 hook WeChat，app 跟 module 通过 ContentProvider 通讯拿 key。这条路 onboarding 复杂（需用户装 Magisk module），但运行时稳定。

**v0.1 决策**: Approach A，因为：
- 一次性集成（用户不需要装额外 Magisk module）
- 复用桌面侧的 wechat-key-hook.js 0 改动
- 失败时 fallback 到 "请用桌面端" 引导

**剩余风险**:
- App size +14-20MB
- 二进制可能被 Play Store 自动扫描 flag 为 "embeds debugging tools"
- WeChat 反检测可能识别 `frida-inject` 进程

### 3.3 WeChatDbExtractor

```kotlin
@Inject constructor(
    @ApplicationContext private val context: Context,
    private val credentialsStore: WeChatCredentialsStore,
) {
    suspend fun extract(uin: String): Result<File> = withContext(Dispatchers.IO) {
        // 1. 拿到 dbKeyHex
        val keyHex = credentialsStore.getDbKeyHex() ?: return@withContext Result.failure(...)

        // 2. 找 WeChat 数据目录（uin md5）
        val md5OfUin = md5("mm$uin").substring(0, 7)
        val srcPath = "/data/data/com.tencent.mm/MicroMsg/$md5OfUin/EnMicroMsg.db"

        // 3. su cp 到 app 自己的 cache（必须 cp 不能 mv，原数据库可能在用）
        val stagingFile = File(context.cacheDir, "wx-staging-$md5OfUin.db")
        val cpCmd = "cp $srcPath ${stagingFile.absolutePath} && chmod 644 ${stagingFile.absolutePath}"
        val proc = Runtime.getRuntime().exec(arrayOf("su", "-c", cpCmd))
        if (proc.waitFor() != 0) return@withContext Result.failure(...)

        // 4. SQLCipher open + dump rows to JSON
        // (net.zetetic:sqlcipher-android:4.12.0 已经在 core-database 里有 dep)
        SQLiteDatabase.openDatabase(
            stagingFile.absolutePath,
            keyHex.hexToByteArray(),  // SQLCipher binds raw bytes, not "x'...'" syntax
            null,
            SQLiteDatabase.OPEN_READONLY,
            ...
        ).use { db ->
            // SELECT * FROM rcontact / message / chatroom / userinfo
            // 写到 staging.json
        }

        Result.success(stagingJson)
    }
}
```

**Trap 5**: SQLCipher Android 库的 `openDatabase` 接 byte[] key，但 hex 字符串 → bytes 转换错的话报 `SQLiteException: file is not a database`。验证: hex 长度必须是 64（32 bytes），且字符全 [0-9a-fA-F]。
**Trap 6**: WeChat 在 8.0.50+ 启用了 PRAGMA cipher_compatibility=3 + cipher_kdf_iter=1。默认 SQLCipher Android 4.12 用 v4 (KDF 256000 iter)，必须显式 `PRAGMA cipher_compatibility=3` 否则解不开。桌面 `packages/personal-data-hub/lib/adapters/wechat/db-reader.js` `KNOWN_PRAGMA_PROFILES` 里有完整 PRAGMA 集，**Kotlin 侧必须 1:1 复用这个配置**。
**Trap 7**: `cp /data/data/com.tencent.mm/.../EnMicroMsg.db` 拿到的是 SQLite WAL mode 的主 db，但可能有 unflushed wal/shm 文件没拷过来 → 数据 stale 或者解密失败。**必须** 一起 cp `.db-wal` 和 `.db-shm`。

### 3.4 WeChatLocalCollector

orchestrator 镜像 `BilibiliLocalCollector`，sealed result types:
```kotlin
sealed class SnapshotResult {
    data class Ok(
        val snapshotPath: String,
        val contactCount: Int,
        val messageCount: Int,
        val chatroomCount: Int,
        val totalEvents: Int,
        val keyProvider: String,
        val snapshottedAt: Long,
    ) : SnapshotResult()

    object NoCredentials : SnapshotResult()
    object NoRoot : SnapshotResult()
    object FridaInjectFailed : SnapshotResult()  // 8.0+ key extract failed
    data class Failed(val reason: String, val message: String? = null) : SnapshotResult()
}
```

调用顺序：

```kotlin
suspend fun snapshot(): SnapshotResult = withContext(Dispatchers.IO) {
    if (!credentialsStore.hasCredentials()) return@withContext SnapshotResult.NoCredentials
    if (!suChecker.isSuAvailable()) return@withContext SnapshotResult.NoRoot

    // 8.0+ 需要 frida 提取 key（如未提取过）
    if (credentialsStore.getKeyProvider() == "frida" && credentialsStore.getDbKeyHex() == null) {
        val keyResult = fridaInjector.extractKey(credentialsStore.getUin()!!)
        if (keyResult.isFailure) return@withContext SnapshotResult.FridaInjectFailed
        credentialsStore.setDbKeyHex(keyResult.getOrThrow())
    }

    val extractResult = dbExtractor.extract(credentialsStore.getUin()!!)
    if (extractResult.isFailure) {
        return@withContext SnapshotResult.Failed("db-extract", extractResult.exceptionOrNull()?.message)
    }

    // 写 staging.json + hand off to LocalCcRunner
    SnapshotResult.Ok(...)
}
```

---

## 4. UI/UX 流程

### 4.1 用户第一次同步

```
HubLocalScreen "微信" 卡 (未登录态)
  → 按 "登录/授权"
  → 弹引导对话框:
      "微信数据采集需要 Magisk root + WeChat 在本机已登录"
      [ ] 我确认设备已 root
      [ ] 我确认 WeChat 已登录主账号
      [取消] [继续]
  → "继续"
  → 弹 UIN 输入框（暂时手填，未来可以从 WeChat shared pref 自动读）
  → 提交 UIN → CredentialsStore 存
  → 卡片状态变 "已登录 (uin=...)" + "立即同步" 可点
```

### 4.2 用户点 "立即同步"

```
collector.snapshot()
  ├─ key 已存 → DbExtractor.extract() → cc syncAdapter wechat staging.json
  └─ key 未存（8.0+ 第一次）→ FridaInjector.extractKey()
        ├─ 成功 → 存 key → 继续 extract
        └─ 失败 → 弹 banner "frida 注入失败 — 你的 ROM 或 WeChat 版本可能不兼容"
                  → 引导切桌面端
```

### 4.3 失败时

| 失败 | 卡片 banner |
|---|---|
| `NoRoot` | "需要 Magisk root — 你的设备未 root；改用桌面端 (cc ui + 个人数据中台)" |
| `FridaInjectFailed` | "Frida 注入失败 — 可能是 ROM 不兼容 / WeChat 反检测命中。改用桌面端" |
| `Failed("db-extract", msg)` | "数据库读取失败：$msg — 报告 issue 时附本卡截图" |

---

## 5. Sub-phase 拆分（5-7d 工程量）

| Sub | 标题 | 工期 | Win 上能做？ |
|---|---|---|---|
| 12.10.1 | Kotlin scaffold (4 文件 + UI swap + ViewModel hooks) | 0.5d | ✅ |
| 12.10.2 | WeChatCredentialsStore 实现 + unit tests | 0.5d | ✅ |
| 12.10.3 | WeChatDbExtractor SQLCipher 解密 + raw dump | 1d | ⚠️ 可写但需真机 fixture |
| 12.10.4 | WeChatFridaInjector — frida-inject binary embed + agent dispatch | 2d | ❌ 真机必需 |
| 12.10.5 | LocalCcRunner.syncAdapter("wechat", path) wire + cc CLI 加 `--input` flag for wechat | 0.5d | ✅ |
| 12.10.6 | 真机 E2E — Xiaomi + Magisk + WeChat 8.0.50+ + 5 个场景 | 1.5d | ❌ 真机必需 |
| 12.10.7 | Anti-detection 加固 — frida-inject binary 改名 / hide process / WeChat 启动检测绕过 | 1d | ❌ 真机必需 |

**这次 session 落地**: 12.10.1 + 12.10.2 partial (scaffold + UI swap + unit tests for stubs)。

**TODO（user 拿真机时启）**: 12.10.3 - 12.10.7。

---

## 6. 风险评估

### 6.1 Play Store 上架

**几乎肯定被 Play Console 拒绝**：
- frida-inject binary 命中 "Embeds executable code that modifies other apps' behavior" policy
- 即使 com.tencent.mm 是用户主动选的，Google 也不会过审

**应对**: Android app 走 sideload / 国内 OEM 应用商店（华为/小米/OPPO/vivo）。不上 Play Store。

### 6.2 WeChat 反检测

WeChat 8.x 持续加强反 hook 检测：
- 启动时检 `/proc/self/maps` 找 `frida` / `libgum`
- 检测进程列表里有无 `frida-inject` / `frida-server`
- 检测 ptrace 状态

**应对**: frida-inject binary 改名 + 内嵌 frida-magisk-anti-detection patch。但这是猫鼠游戏 — WeChat 改一次我们就要追一次。

### 6.3 维护成本

WeChat 每个大版本（8.0.x 滚动）都可能改：
- libWCDB.so 的 sqlite3_key_v2 签名
- PRAGMA 配置（v4 KDF + iter）
- 数据库 schema (字段重命名 / 表拆分)

**应对**: 桌面侧 `wechat-key-hook.js` 和 `db-reader.js` 已经在维护 — Android 侧只是复用，新增的维护面只有 frida-inject binary 升级（每 6-12 月 1 次 frida 主版本）。

---

## 7. 验收门禁（v0.1 ship 条件）

scaffold + UI swap 这次 land 后，**v0.1 PASS = 满足下列**：

1. `HubLocalScreen.kt` "微信" 卡从 `PlaceholderCategoryCard` 改成 `SocialAdapterCard`
2. ViewModel 加 wechat state + 3 个 action (`requestWechatLogin / syncWechat / logoutWechat`)
3. 4 个 Kotlin 文件 scaffold 编译通过（即使 frida 部分是 stub 抛 `NotImplementedError`）
4. CredentialsStore unit tests ≥ 3
5. Collector orchestrator unit tests ≥ 3（覆盖 NoCredentials / NoRoot / 成功路径 with mocked extractor）
6. 设计文档（这份）有 §5 sub-phase + §6 风险 + §7 验收 + §A 真机 E2E reproducer

**v0.2 PASS = 真机 12.10.3-12.10.7 全过**（这个目标进 ChainlessChain Phase 12.10 实施 milestone）。

---

## 8. 相关

- **桌面侧 adapter** → [`Adapter_WeChat_SQLCipher.md`](./Adapter_WeChat_SQLCipher.md)
- **桌面侧 frida setup** → [`Adapter_WeChat_SQLCipher_Frida_Setup.md`](./Adapter_WeChat_SQLCipher_Frida_Setup.md)
- **桌面侧 E2E runbook** → [`Personal_Data_Hub_Phase_12_9_WeChat_RealDevice_E2E_Runbook.md`](./Personal_Data_Hub_Phase_12_9_WeChat_RealDevice_E2E_Runbook.md)
- **桌面侧 E2E 准备包** → [`Personal_Data_Hub_Phase_12_9_WeChat_E2E_PrepKit.md`](./Personal_Data_Hub_Phase_12_9_WeChat_E2E_PrepKit.md)
- **Bilibili Android pattern (参考实现)** → [`packages/personal-data-hub/lib/adapters/social-bilibili/`](../../packages/personal-data-hub/lib/adapters/social-bilibili/) + [`android-app/.../pdh/social/bilibili/`](../../android-app/app/src/main/java/com/chainlesschain/android/pdh/social/bilibili/)
- **PDH Android Standalone (架构上下文)** → [`Personal_Data_Hub_Android_Standalone_Cc.md`](./Personal_Data_Hub_Android_Standalone_Cc.md)

## 附录：规范章节补全（v5.0.3.108）

> 本文为设计文档（采集器）。为对齐项目文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文细节。

### 1. 概述

见正文「0. 为什么需要这个」。Android 端 WeChat 8.0+ 本机采集采用 frida-in-app 方案，scaffold 已 land，frida 真注入 + 真机 E2E 待做（5–7d），用于完成 `HubLocalScreen.kt` 微信卡。

### 2. 核心特性

frida-in-app 注入；SQLCipher 解密；接通微信卡；反检测风险评估。

### 3. 系统架构

见正文「2. 总体架构」；与桌面侧 `Adapter_WeChat_SQLCipher.md` 对应（复用 SQLCipher PRAGMA / KDF profile）。

### 4. 系统定位

Personal Data Hub 的**Android 端微信 frida-in-app 采集器**（Phase 12.10）。

### 5. 核心功能

见正文「3. 关键模块」+「4. UI/UX 流程」（frida 注入 → key → 解密 → vault）。

### 6. 技术架构

frida-inject（in-app）hook 取 SQLCipher key；微信 8.0+；Bilibili Android pattern 参考实现。

### 7. 系统特点

frida 真注入待做（5–7d）；Play Store 上架 / 反检测风险高（见正文 6）。

### 8. 应用场景

完成 HubLocalScreen 微信 placeholder 卡，取回本机微信语料。

### 9. 竞品对比

与 QQ XOR 方案同形（`Android_QQ_InApp_XorDecrypt_Collector.md`）；桌面走 frida-server。

### 10. 配置参考

桌面 adapter `Adapter_WeChat_SQLCipher.md`；frida setup 见 `Adapter_WeChat_SQLCipher_Frida_Setup.md`。

### 11. 性能指标

解密随 5+ 年消息库线性；注入耗时见真机 runbook。

### 12. 测试覆盖

真机 E2E 见 `Android_WeChat_Phase_12_10_6_RealDevice_E2E_Runbook.md`（8 场景）；v0.1 验收门禁见正文 7。

### 13. 安全考虑

微信语料极高敏感；frida 注入触发微信反检测——见 `Android_WeChat_Phase_12_10_7_AntiDetection.md`；需 root。

### 14. 故障排除

反检测 fail（环境异常 / 自杀进程）→ `Android_WeChat_Phase_12_10_7_AntiDetection.md`；hook traps → memory `wechat_frida_hook_audit_traps.md`。

### 15. 关键文件

`WeChatFridaInjector.kt`；frida-inject 二进制；桌面 `Adapter_WeChat_SQLCipher.md`。

### 16. 使用示例

见正文 UI/UX 流程与真机 runbook 8 场景。

### 17. 相关文档

见正文头部链接：`Adapter_WeChat_SQLCipher.md`、`Adapter_WeChat_SQLCipher_Frida_Setup.md`、`Android_WeChat_Phase_12_10_6_RealDevice_E2E_Runbook.md`、`Personal_Data_Hub_Android_Standalone_Cc.md`。
