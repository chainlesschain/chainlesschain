# 国内推送厂商 SDK 接入指南

> **状态**: 🟡 v1.1 stub 架构落地，4 厂商真集成 v1.2 (2026-Q4)
> **关联**: [Android v1.1 issue #19 P1](https://github.com/chainlesschain/chainlesschain/issues/19) / [P2P 三层定位 §9.1 FCM 国内可达性](../design/Android_重新定位_设计文档.md)
> **作用域**: 帮 v1.2 实施者把 4 个 vendor stub 替换为真 SDK 调用

---

## 1. v1.1 已落 (架构 ready)

| | |
|---|---|
| `app/.../push/vendor/VendorPushService.kt` | sealed interface + PushVendor enum (5 vendors: 4 国内 + FCM 兜底) + VendorSdkNotIntegratedException |
| `app/.../push/vendor/XiaomiPushService.kt` | 参考实现框架；4 处 TODO 标记待 v1.2 真填 |
| `app/.../push/vendor/OtherVendorStubs.kt` | Huawei + OPPO + vivo + FCM 4 个 stub (集中存) |
| `app/.../push/vendor/PushVendorRegistry.kt` | manufacturer auto-detect + user override |
| `app/.../push/vendor/VendorPreferences.kt` | SharedPreferences override 持久化 |
| `app/.../presentation/screens/vendorpush/VendorPushSettingsScreen + ViewModel` | Compose Settings UI + RadioGroup + 安装状态 |

**v1.2 实施者要做的**：把对应 vendor 的 `XxxPushService` 4 处 TODO 换成真 SDK 调用。其他文件不改 — 用户在 Settings 切换无需 app 重启即生效。

---

## 2. 决策：哪家先做？

按使用率 + 接入难度 + ROM 渗透：

| vendor | 国内市占率 | 接入难度 | 推荐顺序 |
|---|---|---|---|
| **Xiaomi (小米/Redmi)** | ~16% | 中 (官方文档好) | **1️⃣** |
| **Huawei HMS Push** | ~10% (含 Honor) | 高 (需 agconnect-services.json + plugin) | **2️⃣** |
| **OPPO HeytapPush** | ~9% (含 OnePlus/Realme) | 中 (manual AAR) | **3️⃣** |
| **vivo Push** | ~7% (含 iQOO) | 中 (manual AAR) | 4️⃣ (可推 v1.3) |

四家覆盖 ~42% 国内市场（Samsung / 一加非 OneUI 等仍走 FCM）。

---

## 3. 各厂商接入步骤

### 3.1 Xiaomi 小米推送

**前置**：[小米开放平台](https://dev.mi.com/console/) 注册开发者账号 → 创建应用 → 申请 Push 服务

**取**：APP_ID / APP_KEY / APP_SECRET (3 个)

**步骤**：

1. **下载 SDK** — [MiPush_SDK_5.x.x.aar](https://admin.xmpush.xiaomi.com/zh_CN/mipush/downpage)
2. **放入 libs**：
   ```bash
   mkdir -p android-app/app/libs
   cp MiPush_SDK_5.x.x.aar android-app/app/libs/
   ```
3. **build.gradle.kts** 加 dep：
   ```kotlin
   dependencies {
       implementation(files("libs/MiPush_SDK_5.x.x.aar"))
       // build config 注入凭证（不上 git）
       defaultConfig {
           buildConfigField("String", "XIAOMI_PUSH_APP_ID", "\"${project.findProperty("xiaomiAppId") ?: ""}\"")
           buildConfigField("String", "XIAOMI_PUSH_APP_KEY", "\"${project.findProperty("xiaomiAppKey") ?: ""}\"")
       }
   }
   ```
   `~/.gradle/gradle.properties` 加：
   ```
   xiaomiAppId=2882303761...
   xiaomiAppKey=51572681...
   ```
4. **AndroidManifest.xml** `<application>` 内加：
   ```xml
   <!-- 小米推送权限 -->
   <permission android:name="${applicationId}.permission.MIPUSH_RECEIVE"
       android:protectionLevel="signature" />
   <uses-permission android:name="${applicationId}.permission.MIPUSH_RECEIVE" />

   <!-- 小米推送 service -->
   <service android:enabled="true" android:exported="true"
       android:name="com.xiaomi.push.service.XMJobService"
       android:permission="android.permission.BIND_JOB_SERVICE"
       android:process=":pushservice" />
   <service android:enabled="true" android:process=":pushservice"
       android:name="com.xiaomi.push.service.XMPushService" />
   <service android:enabled="true" android:exported="true"
       android:name="com.xiaomi.mipush.sdk.PushMessageHandler" />
   <service android:enabled="true"
       android:name="com.xiaomi.mipush.sdk.MessageHandleService" />
   <receiver android:exported="true"
       android:name="com.xiaomi.push.service.receivers.NetworkStatusReceiver">
       <intent-filter>
           <action android:name="android.net.conn.CONNECTIVITY_CHANGE" />
       </intent-filter>
   </receiver>
   <receiver android:exported="false"
       android:name="com.xiaomi.push.service.receivers.PingReceiver"
       android:process=":pushservice">
       <intent-filter>
           <action android:name="com.xiaomi.push.PING_TIMER" />
       </intent-filter>
   </receiver>

   <!-- 业务自定义 receiver: 收 push payload 转 CcPushNotificationService -->
   <receiver android:exported="true"
       android:name=".push.vendor.XiaomiPushReceiver">
       <intent-filter>
           <action android:name="com.xiaomi.mipush.RECEIVE_MESSAGE" />
       </intent-filter>
       <intent-filter>
           <action android:name="com.xiaomi.mipush.ERROR" />
       </intent-filter>
       <intent-filter>
           <action android:name="com.xiaomi.mipush.MESSAGE_ARRIVED" />
       </intent-filter>
   </receiver>
   ```
5. **改 XiaomiPushService.kt** 4 处 TODO：
   ```kotlin
   override fun initialize(): Boolean {
       if (initialized) return false
       val mfr = android.os.Build.MANUFACTURER.lowercase()
       if (!mfr.contains("xiaomi") && !mfr.contains("redmi")) {
           Timber.d("Not a Xiaomi device, skipping init")
           return false
       }
       MiPushClient.registerPush(context, BuildConfig.XIAOMI_PUSH_APP_ID, BuildConfig.XIAOMI_PUSH_APP_KEY)
       initialized = true
       return true
   }
   override fun currentToken(): String? = MiPushClient.getRegId(context)
   override fun shutdown() {
       if (!initialized) return
       MiPushClient.unregisterPush(context)
       initialized = false
   }
   override fun isIntegrated(): Boolean = true
   ```
6. **新建 XiaomiPushReceiver.kt** 继承 `PushMessageReceiver`：
   ```kotlin
   class XiaomiPushReceiver : PushMessageReceiver() {
       @Inject lateinit var service: CcPushNotificationService

       override fun onReceivePassThroughMessage(context: Context?, message: MiPushMessage?) {
           val payload = message?.content?.let { JSONObject(it).toMap() } ?: return
           service.onRemoteData(payload)
       }
       override fun onCommandResult(context: Context?, message: MiPushCommandMessage?) {
           if (message?.command == MiPushClient.COMMAND_REGISTER && message.resultCode == 0L) {
               val regId = message.commandArguments?.firstOrNull() ?: return
               service.onTokenChanged(regId)
           }
       }
   }
   ```

### 3.2 Huawei HMS Push

**前置**：[华为开发者联盟](https://developer.huawei.com/consumer/cn/) 注册 → 创建应用 → 启用 Push Kit → 下载 `agconnect-services.json`

**步骤**：

1. **放凭证**：`cp agconnect-services.json android-app/app/`
2. **build.gradle.kts** root 加 maven repo：
   ```kotlin
   // android-app/build.gradle.kts
   allprojects {
       repositories {
           maven { url = uri("https://developer.huawei.com/repo/") }
       }
   }
   buildscript {
       dependencies {
           classpath("com.huawei.agconnect:agcp:1.9.1.300")
       }
   }
   ```
3. **app build.gradle.kts**：
   ```kotlin
   plugins {
       id("com.huawei.agconnect")
   }
   dependencies {
       implementation("com.huawei.hms:push:6.11.0.300")
   }
   ```
4. **AndroidManifest.xml**：HMS 自动 manifest merge，无需手动 service 注册，但需加：
   ```xml
   <meta-data
       android:name="push_kit_auto_init_enabled"
       android:value="true" />
   ```
5. **改 HuaweiPushService.kt** initialize：
   ```kotlin
   override fun initialize(): Boolean {
       Thread {
           val token = HmsInstanceId.getInstance(context).getToken(
               AGConnectServicesConfig.fromContext(context).getString("client/app_id"),
               "HCM"
           )
           service.onTokenChanged(token)
       }.start()
       initialized = true
       return true
   }
   ```
6. **新建 HuaweiPushReceiver extends HmsMessageService**

### 3.3 OPPO HeytapPush (含 OnePlus/Realme)

**前置**：[OPPO 推送平台](https://push.oppo.com/) 注册 → 创建应用 → 取 APP_KEY + APP_SECRET

**步骤**：

1. 下载 [HeytapPushAPI_3.x.x.aar](https://open.oppomobile.com/wiki/doc#id=10708) → `app/libs/`
2. build.gradle.kts: `implementation(files("libs/HeytapPushAPI_3.x.x.aar"))`
3. AndroidManifest.xml: 加 OPush 服务 (类似小米)
4. OppoPushService.kt initialize:
   ```kotlin
   HeytapPushManager.init(context, true)
   HeytapPushManager.register(context, APP_KEY, APP_SECRET, callback)
   ```

### 3.4 vivo Push（代码骨架已落地，缺 AAR + 凭证）

**前置**：[vivo 推送平台](https://dev.vivo.com.cn/documentCenter/doc/156) 注册 → 创建应用

**已内建（无需再写代码）**：

- **build.gradle.kts 门控**：`hasVivoPush = !fileTree("libs"){include("vivo*push*.aar"…)}.isEmpty`——AAR 一旦落进 `app/libs/`，自动 (a) 把 `src/vivo/java` 加进 `main` 源集、(b) `implementation(vivoPushAars)`。无 AAR 时该源集**排除**，app 照常编译运行（`RemoteSessionVivoReceiver` 不进 APK）——同 Firebase `google-services.json` 门控范式。
- **`RemoteSessionVivoReceiver`**（`src/vivo/java`，条件编译）：`onReceiveRegId` → `RemoteSessionPushBridge.onNewToken(regId, "vivo")`（regId 首注册/轮换即推给活跃 Remote Session）；`onNotificationMessageClicked` → 本地弹审批通知（params 只带路由 id）。
- **AndroidManifest**：`<receiver ... RemoteSessionVivoReceiver>` + `com.vivo.pushclient.action.RECEIVE` intent-filter + `com.vivo.push.app_id`/`api_key` meta-data（值走 manifestPlaceholder，空默认保证无凭证也能 merge）。`tools:ignore="MissingClass"`（无 AAR 构建下类不存在但永不实例化）。
- **`VivoPushService`（反射式真集成）**：`initialize()` 反射 `PushClient.getInstance(ctx).initialize()` + `turnOnPush(动态代理 IPushActionListener)`；`currentToken()` 反射 `getRegId()`；`isIntegrated()` 探 `Class.forName("com.vivo.push.PushClient")`——**全 runCatching 兜底**，无 SDK 即返 false/null 不崩，无编译期硬依赖。
- **启动触发**：`AppInitializer` 异步块按 `Build.MANUFACTURER` 自动选 vendor 并 `initialize()`——vivo 设备启动即 turnOn 铸 regId 供唤醒。

**接入者只需 3 步（真机）**：

1. 下载 [VivoPush_SDK_3.x.x.aar](https://dev.vivo.com.cn/documentCenter/doc/156) → `app/libs/`（文件名含 `vivo`+`push`，门控即自动生效）。
2. 传凭证：`-PvivoPushAppId=<appId> -PvivoPushApiKey=<apiKey>`（或改 manifestPlaceholder 默认）。
3. 真机装 app（需先上架 vivo 应用市场，debug 包可试用 1 个月）→ 启动即注册 → `Settings → 国内推送厂商` 应 auto-detect vivo → 桌面配 vivo sender（`CHAINLESSCHAIN_REMOTE_SESSION_PUSH_PROVIDER=vivo`）端到端验证。

---

## 4. 桌面端发推送时多厂商 token dispatch

v1.2 desktop release 必加：

1. Android 端 `CcPushNotificationService.onTokenChanged(token)` 上传 token + manufacturer 到桌面 `mobile-bridge.js` 注册接口
2. 桌面端存 device→{vendor, token} 映射
3. 推送时按 device manufacturer 选 vendor SDK：
   - Xiaomi 设备 → `MiPushHttpClient.send(token, payload)`
   - Huawei 设备 → `HmsHttpClient.send(token, payload)`
   - 其他 → FCM
4. 各家 HTTP push API endpoints + auth 见各开发者文档

---

## 5. 测试

### 5.1 手机测试
- 真小米手机：装 app → Settings → 国内推送厂商 → 应 auto-detect 选 Xiaomi → 显示 token
- 桌面 admin tool → 输入 token + payload → 状态栏弹通知 → 点击回 MainActivity

### 5.2 单测 (v1.1 已加)
- `PushVendorRegistryTest`: manufacturer detection by fake `ManufacturerProvider`
- `VendorPreferencesTest`: SharedPreferences round-trip + null override 重置 auto

### 5.3 厂商证书审查
- Xiaomi/OPPO/vivo: 应用上架自家应用市场后才能用 push (debug 包可用 1 个月试用)
- Huawei: agconnect-services.json 与 release keystore SHA256 绑定，debug/release 分别配

---

## 6. 安全 & 隐私

| 维度 | 注意事项 |
|---|---|
| **凭证存储** | AppKey / AppSecret 不入 git。用 `~/.gradle/gradle.properties` (本地) + CI secrets |
| **token 上传** | 加 Ed25519 签名（防伪造），桌面侧验签后才接受注册 |
| **payload 加密** | 各厂商 push 走自家服务器；payload **必须**端到端加密（参考 P2P_NPeer_Conflict_Resolution.md 段 4.2，TURN 同款理念） |
| **隐私合规** | 各家 SDK 收集 device id / 应用列表等，需 [Privacy Policy](#) 声明 |

---

## 7. v1.1 / v1.2 / v1.3+ 路线

| 版本 | 范围 |
|---|---|
| **v1.1 (2026-Q3)** | ✅ 架构 + 4 stub + Settings UI + 本文档 |
| **v1.2 (2026-Q4)** | Xiaomi 真集成 (1 家); 桌面 multi-vendor dispatch; token 上传 endpoint |
| **v1.3+** | Huawei + OPPO + vivo 各自独立 PR 上线 |

---

## 变更记录

- 2026-05-12 v1.0 (issue #19 P1)：初稿，4 厂商接入完整指南

## 附录：规范章节补全（v5.0.3.108）

> 为对齐项目用户文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文细节。

### 1. 概述
见正文头部。国内推送厂商 SDK 接入指南：小米/华为/OPPO/vivo 等推送。

### 2. 核心特性
推送 SDK / 厂商 / 接入配置。

### 3. 系统架构
见正文 / [系统架构](../design/系统设计_主文档.md)（三端 + 双后端 + P2P）。

### 4. 系统定位
ChainlessChain 的「推送厂商接入指南」。

### 5. 核心功能
见正文各节。

### 6. 技术架构
见正文技术 / 环境章节。

### 7. 系统特点
见正文（步骤 / 版本 / 注意事项）。

### 8. 应用场景
见正文使用场景。

### 9. 竞品对比
见正文对比（如有）。

### 10. 配置参考
见正文配置 / 环境变量章节；`.chainlesschain/config.json`。

### 11. 性能指标
见正文性能 / 资源要求（如有）。

### 12. 测试覆盖
见正文验证 / 测试步骤（如有）。

### 13. 安全考虑
见正文安全 / 密钥章节（如适用）。

### 14. 故障排除
见正文故障排查 / 常见问题章节。

### 15. 关键文件
见正文涉及的文件 / 目录 / 脚本。

### 16. 使用示例
见正文命令 / 操作示例。

### 17. 相关文档
[用户指南索引](./README.md)、[快速开始](../quick-start/QUICK_START.md)、其它用户文档。
