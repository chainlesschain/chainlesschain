package com.chainlesschain.android.capture.location

/**
 * 一次 GPS 位置快照。
 *
 * 设计文档 v0.2 §5.3 L2 LocationTagger 模块：GPS + 时间戳标记笔记 / DID 凭证。
 * 桌面无 GPS，是手机独占场景之一。
 *
 * @property latitude 纬度（北纬正，南纬负），范围 [-90, 90]
 * @property longitude 经度（东经正，西经负），范围 [-180, 180]
 * @property accuracyMeters 水平精度，单位米（0 = 未知，正值 = 圆形误差半径）
 * @property timestampMs 取样时间（System.currentTimeMillis()）
 * @property altitude 海拔（米），null 时表示未提供
 * @property provider 数据源标识，如 "gps"/"network"/"fused"/"fake"
 */
data class LocationTag(
    val latitude: Double,
    val longitude: Double,
    val accuracyMeters: Float,
    val timestampMs: Long,
    val altitude: Double? = null,
    val provider: String = "fused",
) {
    init {
        require(latitude in -90.0..90.0) { "latitude must be in [-90, 90], got $latitude" }
        require(longitude in -180.0..180.0) { "longitude must be in [-180, 180], got $longitude" }
        require(accuracyMeters >= 0f) { "accuracyMeters must be non-negative, got $accuracyMeters" }
        require(timestampMs > 0) { "timestampMs must be positive, got $timestampMs" }
    }

    /** Returns true if accuracy is good enough for usable location pin (< 100m). */
    fun isPrecise(): Boolean = accuracyMeters in 0.01f..100f
}
