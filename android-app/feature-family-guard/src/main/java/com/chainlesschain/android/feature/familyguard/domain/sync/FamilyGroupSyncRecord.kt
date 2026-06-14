package com.chainlesschain.android.feature.familyguard.domain.sync

import com.chainlesschain.android.feature.familyguard.data.entity.FamilyGroupEntity
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

/**
 * family_group 的 P2P 同步记录 (FAMILY-26 同步核, 主文档 §3.1 v0.2 多家长/多设备)。
 *
 * 真实双机绑定的前置：孩子端 [com.chainlesschain.android.feature.familyguard.domain
 * .service.InvitePairingService.acceptInvite] 校验 family_group 必须存在, 否则返
 * [com.chainlesschain.android.feature.familyguard.domain.model.pairing.PairingResult.UnknownFamilyGroup]。
 * 家长端创建组/邀请时把本记录排入 [FamilyGroupOutbox], 由 sync engine 传到对端,
 * 对端经 [FamilyGroupSyncApplier] 落库, 两端的 family_group 即收敛。
 *
 * 序列化用 [encode]/[decode] (kotlinx JSON), 与 telemetry / task 同步记录一致;
 * SerialName 固定列名保证跨版本兼容。**承载的是 family_group 身份+可变字段**,
 * membership / relationship 的镜像是各自独立的同步记录 (后续 follow-up)。
 */
@Serializable
data class FamilyGroupSyncRecord(
    val id: String,
    val name: String,
    @SerialName("primary_did")
    val primaryDid: String,
    @SerialName("created_at")
    val createdAtMs: Long,
    @SerialName("metadata_json")
    val metadataJson: String? = null,
) {
    companion object {
        val codec: Json = Json {
            ignoreUnknownKeys = true
            encodeDefaults = true
        }

        fun decode(json: String): FamilyGroupSyncRecord =
            codec.decodeFromString(serializer(), json)

        fun encode(record: FamilyGroupSyncRecord): String =
            codec.encodeToString(record)
    }
}

/** entity → 同步记录 (家长端排 outbox 时用)。 */
fun FamilyGroupEntity.toSyncRecord(): FamilyGroupSyncRecord = FamilyGroupSyncRecord(
    id = id,
    name = name,
    primaryDid = primaryDid,
    createdAtMs = createdAt,
    metadataJson = metadataJson,
)

/** 同步记录 → entity (对端 [FamilyGroupSyncApplier] 落库时用)。 */
fun FamilyGroupSyncRecord.toEntity(): FamilyGroupEntity = FamilyGroupEntity(
    id = id,
    name = name,
    primaryDid = primaryDid,
    createdAt = createdAtMs,
    metadataJson = metadataJson,
)
