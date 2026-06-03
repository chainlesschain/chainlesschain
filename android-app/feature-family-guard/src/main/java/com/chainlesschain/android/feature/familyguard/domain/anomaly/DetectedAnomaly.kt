package com.chainlesschain.android.feature.familyguard.domain.anomaly

/**
 * 一条被检出的异常 (FAMILY-27). [AnomalyDetector] 的输出 + [AnomalyRepository] 的入参。
 *
 * @property dedupKey 幂等键 — 同一异常 (同 app 同日 / 同夜 / 同充值日) 每 15min 扫描复检
 *   都生成同 key; anomaly 表对该列建 UNIQUE INDEX + insert OnConflict IGNORE, 故重复扫描
 *   不重复落库, 家长也只收一次推送 (rowId ≤ 0 即去重命中, 见 [AnomalyScanTimer])。
 * @property summary 一句话人读摘要 (推送标题); [detail] 为补充明细 (可空字符串)。
 * @property detectedAtMs 检出时刻 epoch ms (= 扫描时的 now)。
 */
data class DetectedAnomaly(
    val type: AnomalyType,
    val severity: AnomalySeverity,
    val childDid: String,
    val dedupKey: String,
    val summary: String,
    val detail: String,
    val detectedAtMs: Long,
)
