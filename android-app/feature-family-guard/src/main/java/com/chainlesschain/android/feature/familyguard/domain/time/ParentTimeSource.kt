package com.chainlesschain.android.feature.familyguard.domain.time

/**
 * 家长端权威时间拉取 seam (FAMILY-60). [TimeAuthority.sync] 在 monotonic t0/t2 之间调本
 * 接口拉一次家长端当前 epoch ms, 配合 Cristian 算法估单程延迟 (主文档 §3.4: "每 30min
 * 从家长端拉一次时间 + 跑 Cristian 算法估单程")。
 *
 * 真实实装走 P2P (孩子端 ↔ 家长端 family.time.* envelope) 在 :app 层提供 —— family-guard
 * 库不依赖 :core-p2p 传输细节, 故默认 [com.chainlesschain.android.feature.familyguard.data.time.NoOpParentTimeSource]
 * 返 null (无法同步); :app 覆盖本绑定接通真实拉取。同 TelemetryOutbox / GuardianAnomalyNotifier
 * 的 seam 模式。
 */
interface ParentTimeSource {

    /**
     * 拉家长端当前 epoch ms; 不可达 (离线 / 未配对 / 超时) 返 null。
     * 返回值应是家长端**响应那一刻**的 wall-clock epoch ms (Cristian 据此 + RTT/2 校正)。
     */
    suspend fun fetchParentEpochMs(): Long?
}
