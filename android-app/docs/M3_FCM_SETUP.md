# M3 D3 FCM 接入指南

> 设计文档 `docs/design/Android_重新定位_设计文档.md` §5.3 PushNotifier。
> 本 doc 配合 `app/.../push/` 一组类使用 — 当 `google-services.json` 到位后按本表接入 FCM 真实装配。

## 现状

v1.0 已落地的部分（**不依赖 FCM**）：

| 文件 | 作用 |
|---|---|
| `push/NotificationCategory.kt` | 4 类 channel: Cowork / Marketplace / SystemAlert / ShareInbox |
| `push/NotificationPayload.kt` | 4 类型化 payload + notificationId 稳定 hash |
| `push/FcmRemoteMessageParser.kt` | 纯函数 `parse(data: Map<String,String>)` |
| `push/NotificationRender.kt` | 纯函数 `renderPayload` 把 payload → title/body/deepLink |
| `push/NotificationCenter.kt` | `ensureChannels()` + `dispatch(payload)` 接 NotificationManagerCompat |
| `push/CcPushNotificationService.kt` | 协议中立入口 `onRemoteData(data)` 兼容 FCM/HMS/Mi/桌面 fallback |

**没接 FCM** 的根本原因：v1.0 范围内 `google-services.json` 是用户侧任务（Firebase Console 创建项目 + 下载凭证）。本 commit 提供 FCM-ready 骨架，**用户加凭证后只需 4 步即可激活**。

## 接入 FCM（按顺序做）

### 1. 在 Firebase Console 创建 Android 项目

1. 打开 https://console.firebase.google.com
2. 新建项目（命名: `chainlesschain` 或贵司命名约定）
3. 添加 Android 应用，包名 `com.chainlesschain.android`，SHA-1 用 debug keystore（或 release keystore for prod）
4. 下载 `google-services.json`

### 2. 放置 google-services.json

- Debug: `android-app/app/src/debug/google-services.json`
- Release: `android-app/app/src/release/google-services.json`
- 或全局: `android-app/app/google-services.json`

`build.gradle.kts` line 26-30 已配置 conditional 检测 — 文件存在时自动启用 firebase plugins。

### 3. 加 firebase-messaging 依赖

编辑 `android-app/app/build.gradle.kts` line ~394-400 conditional Firebase block：

```kotlin
if (hasGoogleServices) {
    implementation(platform("com.google.firebase:firebase-bom:32.7.0"))
    implementation("com.google.firebase:firebase-crashlytics-ktx")
    implementation("com.google.firebase:firebase-analytics-ktx")
    implementation("com.google.firebase:firebase-messaging-ktx")  // 加这一行
}
```

### 4. 新建 CcFirebaseMessagingService

`android-app/app/src/main/java/com/chainlesschain/android/push/CcFirebaseMessagingService.kt`:

```kotlin
package com.chainlesschain.android.push

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject

@AndroidEntryPoint
class CcFirebaseMessagingService : FirebaseMessagingService() {
    @Inject lateinit var service: CcPushNotificationService

    override fun onMessageReceived(msg: RemoteMessage) {
        service.onRemoteData(msg.data)
    }

    override fun onNewToken(token: String) {
        service.onTokenChanged(token)
    }
}
```

### 5. AndroidManifest.xml 加 <service>

在 `<application>` 内：

```xml
<service
    android:name=".push.CcFirebaseMessagingService"
    android:exported="false"
    android:directBootAware="false">
    <intent-filter>
        <action android:name="com.google.firebase.MESSAGING_EVENT"/>
    </intent-filter>
</service>
```

## 测试 push（接入完成后）

桌面端在 Firebase Console → Cloud Messaging → "Send your first message"，**目标必须用 data-only**（不含 notification 字段），data 字段示例：

```json
{
  "type": "cowork.request",
  "taskId": "task-test-001",
  "summary": "审批一个测试任务",
  "agentName": "test-agent"
}
```

4 种 type 协议见 `FcmRemoteMessageParser.kt` 注释；任何缺字段都会 silently 丢（log 警告）。

## 协议字段表

| type | 必填 | 可选 |
|---|---|---|
| `cowork.request` | `taskId`, `summary` | `agentName` |
| `marketplace.purchase` | `orderId`, `total` | `currency` (默认 CNY), `itemName` |
| `system.alert` | `title`, `body` | `severity` (info\|warning\|critical) |
| `share.inbox` | `count` (正整数) | - |

## 国内可达性兜底（v1.1 计划）

设计文档 §9.1 + Q2：FCM 国内不稳定。v1.1 计划接 OPPO / 小米 / 华为统一推送 SDK；本 commit 提供的 [CcPushNotificationService.onRemoteData] 是协议中立入口，加任何 push 厂商 SDK 时只要把 data Map 喂进来即可。同时桌面 P2P 通道（mobile-bridge）也可走这条路径 — 当 FCM 不可用时桌面端直接 RPC 推送。
