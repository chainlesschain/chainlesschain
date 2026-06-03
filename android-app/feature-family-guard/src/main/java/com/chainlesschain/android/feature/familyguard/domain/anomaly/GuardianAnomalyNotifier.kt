package com.chainlesschain.android.feature.familyguard.domain.anomaly

/**
 * 异常 → 家长推送 seam (FAMILY-27; 真实推送 FAMILY-61).
 *
 * [AnomalyScanTimer] 对**新落库**的异常 (去重未命中) 调本接口一次。默认实装
 * [com.chainlesschain.android.feature.familyguard.data.anomaly.NoOpGuardianAnomalyNotifier]
 * 仅记日志; :app 层提供接 PushVendor + 上行高优 (主文档 §异常事件触发: "本地 push →
 * 上行高优 → 家长端推送 → 可选自动开 L3 屏幕采集 15min") 的真实适配器覆盖本绑定。
 */
interface GuardianAnomalyNotifier {

    /** 推送一条新检出的异常给家长 (按 [DetectedAnomaly.severity] 选通道优先级)。 */
    suspend fun notifyGuardians(anomaly: DetectedAnomaly)
}
