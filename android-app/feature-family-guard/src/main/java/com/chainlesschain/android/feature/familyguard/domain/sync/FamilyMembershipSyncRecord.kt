package com.chainlesschain.android.feature.familyguard.domain.sync

import com.chainlesschain.android.feature.familyguard.data.entity.FamilyMembershipEntity
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

/**
 * family_membership 的 P2P 同步记录 (FAMILY-26 双向同步)。
 *
 * 让"家长端看到孩子"成立的关键: 孩子 acceptInvite 写自己的 membership 后, 把本记录推给
 * 家长端 → 家长端落库 → 家人页 (buildState 按 membership 列成员) 即显示孩子。
 *
 * 去重按**自然键 (familyGroupId, memberDid)**, 不带本地自增 id (两端 id 不同);
 * 入站 [com.chainlesschain.android.feature.familyguard.domain.repository.FamilyMembershipRepository.upsertReplica]
 * 按自然键 upsert。
 */
@Serializable
data class FamilyMembershipSyncRecord(
    @SerialName("family_group_id")
    val familyGroupId: String,
    @SerialName("member_did")
    val memberDid: String,
    val role: String,
    @SerialName("guardian_tier")
    val guardianTier: String? = null,
    @SerialName("device_id")
    val deviceId: String,
    @SerialName("joined_at")
    val joinedAtMs: Long,
    val status: String = "active",
) {
    companion object {
        val codec: Json = Json {
            ignoreUnknownKeys = true
            encodeDefaults = true
        }

        fun decode(json: String): FamilyMembershipSyncRecord =
            codec.decodeFromString(serializer(), json)

        fun encode(record: FamilyMembershipSyncRecord): String =
            codec.encodeToString(record)
    }
}

fun FamilyMembershipEntity.toSyncRecord(): FamilyMembershipSyncRecord = FamilyMembershipSyncRecord(
    familyGroupId = familyGroupId,
    memberDid = memberDid,
    role = role,
    guardianTier = guardianTier,
    deviceId = deviceId,
    joinedAtMs = joinedAt,
    status = status,
)

/** 同步记录 → entity (id=0 让 Room 自增; 落库按自然键去重)。 */
fun FamilyMembershipSyncRecord.toEntity(): FamilyMembershipEntity = FamilyMembershipEntity(
    familyGroupId = familyGroupId,
    memberDid = memberDid,
    role = role,
    guardianTier = guardianTier,
    deviceId = deviceId,
    joinedAt = joinedAtMs,
    status = status,
)
