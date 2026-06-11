package com.chainlesschain.android.feature.familyguard.domain.enforce

import com.chainlesschain.android.feature.familyguard.data.entity.EnforceRuleEntity
import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

/**
 * M9 → M4 联动：积分兑换 (spend) 批准后下发**临时白名单/例外** (主文档 §3.9
 * deliverable → §3.4 enforce_rules)。
 *
 * 纯逻辑、可单测：把兑换 deliverable 折算成带 [EnforceRuleEntity.expiresAt] 的
 * `temp_exception` 行，评估引擎 (Epic D v0.2) 经 observeActiveNonExpired 消费——
 * 临时例外**放宽**同 target 的管控；到期由 deactivateExpired 批量下线。
 *
 * deliverable kind 契约 (与 :app aistudy DeliverableKind.name 对齐, value 一律分钟):
 *   - SCREEN_TIME_MIN   → target "screen_time"，时长 value 分钟
 *   - APP_UNLOCK        → 每个 targetApp 包名一行，时长 value 分钟
 *   - DELAYED_BEDTIME_MIN → target "bedtime"，config 携带推迟分钟数；
 *     例外行当天有效 (24h 窗口内的就寝评估读取它)
 *   - 其余 (FAMILY_ACTIVITY / REAL_WORLD_VOUCHER / CASH) → 家长执行/通知，
 *     不下发设备规则，返回空
 */
object RewardTempException {

    const val RULE_TYPE = "temp_exception"
    const val TARGET_SCREEN_TIME = "screen_time"
    const val TARGET_BEDTIME = "bedtime"

    const val KIND_SCREEN_TIME_MIN = "SCREEN_TIME_MIN"
    const val KIND_APP_UNLOCK = "APP_UNLOCK"
    const val KIND_DELAYED_BEDTIME_MIN = "DELAYED_BEDTIME_MIN"

    private const val MINUTE_MS = 60_000L
    private const val DAY_MS = 24 * 60 * 60 * 1000L

    /** enforce_rules.config 的结构化载荷 (审计 + 评估引擎读)。 */
    @Serializable
    data class Config(
        val kind: String,
        val valueMinutes: Int,
        val rewardId: String,
        val childDid: String,
    )

    private val json = Json { ignoreUnknownKeys = true }

    fun decodeConfig(raw: String): Config? =
        runCatching { json.decodeFromString<Config>(raw) }.getOrNull()

    /**
     * 兑换批准 → 临时例外行。空列表 = 该 deliverable 不下发设备规则 (家长执行类)。
     * [valueMinutes] ≤ 0 同样不下发 (坏目录项防御)。
     */
    fun fromRedemption(
        kind: String,
        valueMinutes: Int,
        targetApps: List<String>,
        childDid: String,
        rewardId: String,
        now: Long,
    ): List<EnforceRuleEntity> {
        if (valueMinutes <= 0) return emptyList()
        val config = json.encodeToString(
            Config(kind = kind, valueMinutes = valueMinutes, rewardId = rewardId, childDid = childDid),
        )

        fun row(target: String, expiresAt: Long) = EnforceRuleEntity(
            ruleType = RULE_TYPE,
            target = target,
            config = config,
            // 例外只需 DPC 档放行 (不动 VPN/root 档)。
            enforceLevel = 2,
            active = true,
            // 受益人即孩子; 真家长 DID 由配对流程 (FAMILY-13) 后接入兑换审计。
            sourceDid = childDid,
            createdAt = now,
            expiresAt = expiresAt,
        )

        return when (kind) {
            KIND_SCREEN_TIME_MIN ->
                listOf(row(TARGET_SCREEN_TIME, now + valueMinutes * MINUTE_MS))

            KIND_APP_UNLOCK ->
                targetApps.filter { it.isNotBlank() }
                    .map { pkg -> row(pkg, now + valueMinutes * MINUTE_MS) }

            KIND_DELAYED_BEDTIME_MIN ->
                // 当天就寝评估读 config.valueMinutes 推迟窗口; 行本身 24h 后过期。
                listOf(row(TARGET_BEDTIME, now + DAY_MS))

            else -> emptyList()
        }
    }
}
