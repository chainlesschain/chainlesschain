import Foundation
import CoreP2P

/// Phase 4.2 — PushNotificationManager 显式 conform `RemoteNotificationPushTarget`。
///
/// PushNotificationManager 已有方法签名 `scheduleSystemNotification(title:body:userInfo:)`
/// 与协议要求完全一致，仅需声明 conformance；无需新加 method body（既有 PushManager
/// 实现 zero 改动）。
///
/// 此 extension **必须放 app target**（不能放 CoreP2P 模块），因为 PushNotificationManager
/// 类定义在 app target；CoreP2P 反过来不允许引用 app target 类。
extension PushNotificationManager: RemoteNotificationPushTarget {}
