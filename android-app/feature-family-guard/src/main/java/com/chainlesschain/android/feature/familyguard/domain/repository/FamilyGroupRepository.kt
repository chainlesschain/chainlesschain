package com.chainlesschain.android.feature.familyguard.domain.repository

import com.chainlesschain.android.feature.familyguard.data.entity.FamilyGroupEntity
import com.chainlesschain.android.feature.familyguard.domain.sync.FamilyGroupSyncRecord
import kotlinx.coroutines.flow.Flow

/**
 * FamilyGroup CRUD repository (FAMILY-10).
 *
 * 主文档 §3.1 v0.2: family_group 是 family_membership 共享容器, primary_did 表示
 * 创建人 (默认 primary guardian)。验证规则:
 *   - name: 非空 + 长度 ≤ [NAME_MAX_LEN]
 *   - primary_did: "did:" 开头 + 至少 8 字符方法+标识体
 *   - metadata_json: 可空; 非空时必须可被 [kotlinx.serialization.json.Json]
 *     解析为 JsonElement (不强求 object, 允许任意结构)
 *
 * 违反任一规则抛 [InvalidFamilyGroupException]。Repository 自负 ID 生成
 * (ULID-ish), 调用方不传 id。
 */
interface FamilyGroupRepository {

    suspend fun create(
        name: String,
        primaryDid: String,
        metadataJson: String? = null,
    ): FamilyGroupEntity

    suspend fun findById(id: String): FamilyGroupEntity?

    /**
     * FAMILY-26: 据同步/内嵌快照按**原始 id** 物化一个 family_group 副本 (insert-or-replace)。
     * 用于孩子端 acceptInvite 时从邀请内嵌快照物化组、或入站同步落库; 与自生成 id 的
     * [create] 区别在于保留来源 id 让两端 family_group 收敛。校验同 create。
     */
    suspend fun upsertReplica(record: FamilyGroupSyncRecord)

    fun observeAll(): Flow<List<FamilyGroupEntity>>

    suspend fun rename(id: String, newName: String): Boolean

    suspend fun updateMetadata(id: String, newMetadataJson: String?): Boolean

    suspend fun delete(id: String): Boolean

    companion object {
        const val NAME_MAX_LEN = 64
        const val DID_PREFIX = "did:"
        const val DID_MIN_LEN = 8 // "did:" + ≥4 chars
    }
}

/** 校验失败时抛; cause 字段可保留底层异常 (如 JSON parse error)。 */
class InvalidFamilyGroupException(
    message: String,
    cause: Throwable? = null,
) : IllegalArgumentException(message, cause)
