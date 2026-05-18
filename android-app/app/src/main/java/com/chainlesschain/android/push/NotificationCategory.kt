package com.chainlesschain.android.push

import android.app.NotificationManager

/**
 * M3 D3 PushNotifier 4 类通知：Cowork 审批 / Marketplace 大额 / System 警报 / Share Inbox。
 *
 * 设计文档 §5.3 PushNotifier：「FCM + 本地 channel，4 类通知」。每个 category 对应一个
 * NotificationChannel（Android 8.0+ 强制），用户可在系统设置单独静音 / 弹横幅。
 *
 * Importance：
 *  - HIGH 横幅 + 振动 + 声音 — 大额审批 / 关键审批
 *  - DEFAULT 状态栏 + 声音 — Cowork 任务请求 / 系统警报
 *  - LOW 仅状态栏 — Share Inbox 摘要（被动入库的回执）
 */
enum class NotificationCategory(
    val channelId: String,
    val displayName: String,
    val importance: Int,
    val description: String,
) {
    Cowork(
        channelId = "cowork_request",
        displayName = "Cowork 任务",
        importance = NotificationManager.IMPORTANCE_DEFAULT,
        description = "桌面 Cowork 任务等待审批",
    ),
    Marketplace(
        channelId = "marketplace_approval",
        displayName = "Marketplace 审批",
        importance = NotificationManager.IMPORTANCE_HIGH,
        description = "大额数字资产购买 / DID 签名审批",
    ),
    SystemAlert(
        channelId = "system_alert",
        displayName = "系统警报",
        importance = NotificationManager.IMPORTANCE_DEFAULT,
        description = "桌面端推送的关键系统通知",
    ),
    ShareInbox(
        channelId = "share_inbox",
        displayName = "分享入箱",
        importance = NotificationManager.IMPORTANCE_LOW,
        description = "分享内容已入箱的回执",
    ),
}
