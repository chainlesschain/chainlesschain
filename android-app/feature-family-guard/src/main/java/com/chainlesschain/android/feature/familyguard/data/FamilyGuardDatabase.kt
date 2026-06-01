package com.chainlesschain.android.feature.familyguard.data

import androidx.room.Database
import androidx.room.RoomDatabase
import com.chainlesschain.android.feature.familyguard.data.dao.AnomalyDao
import com.chainlesschain.android.feature.familyguard.data.dao.ChildEventDao
import com.chainlesschain.android.feature.familyguard.data.dao.EnforceRuleDao
import com.chainlesschain.android.feature.familyguard.data.dao.FamilyGroupDao
import com.chainlesschain.android.feature.familyguard.data.dao.FamilyMembershipDao
import com.chainlesschain.android.feature.familyguard.data.dao.FamilyRelationshipDao
import com.chainlesschain.android.feature.familyguard.data.dao.GeofenceDao
import com.chainlesschain.android.feature.familyguard.data.dao.LocationPointDao
import com.chainlesschain.android.feature.familyguard.data.dao.RevivalCodeDao
import com.chainlesschain.android.feature.familyguard.data.dao.SosEventDao
import com.chainlesschain.android.feature.familyguard.data.entity.AnomalyEntity
import com.chainlesschain.android.feature.familyguard.data.entity.ChildEventEntity
import com.chainlesschain.android.feature.familyguard.data.entity.EnforceRuleEntity
import com.chainlesschain.android.feature.familyguard.data.entity.FamilyGroupEntity
import com.chainlesschain.android.feature.familyguard.data.entity.FamilyMembershipEntity
import com.chainlesschain.android.feature.familyguard.data.entity.FamilyRelationshipEntity
import com.chainlesschain.android.feature.familyguard.data.entity.GeofenceEntity
import com.chainlesschain.android.feature.familyguard.data.entity.LocationPointEntity
import com.chainlesschain.android.feature.familyguard.data.entity.RevivalCodeEntity
import com.chainlesschain.android.feature.familyguard.data.entity.SosEventEntity

/**
 * SQLCipher-backed Room database for AI 陪学 (family guard) feature.
 *
 * 由 [com.chainlesschain.android.feature.familyguard.di.FamilyGuardModule] 注入。
 * 文件名 [DATABASE_NAME], 与 ChainlessChainDatabase 分离 (端到端隔离 + 独立 migration
 * 链 + 可选 TEE 加密域升级路径)。passphrase 走 KeyManager.getDatabaseKey()
 * (FAMILY-02 共享主 key, M6 Companion TEE Vault 时再派生独立 key)。
 *
 * v0.1 仅落 schema; entity 字段全, DAO body 留待对应业务 ticket (FAMILY-10..67) 填充。
 *
 * Migration 链入口: [FamilyGuardMigrations.ALL_MIGRATIONS] (v1 即首版, 无迁移项)。
 */
@Database(
    entities = [
        FamilyGroupEntity::class,
        FamilyMembershipEntity::class,
        FamilyRelationshipEntity::class,
        SosEventEntity::class,
        LocationPointEntity::class,
        GeofenceEntity::class,
        EnforceRuleEntity::class,
        // v2 (FAMILY-08): 复活码 — 紧急解绑前置 (主文档 §3.1 v0.2)
        RevivalCodeEntity::class,
        // v3 (FAMILY-20, Epic C M2): child telemetry 事件 (主文档 §3.2)
        ChildEventEntity::class,
        // v4 (FAMILY-27, Epic C M2): AnomalyDetector v0 检出的异常事件 (主文档 §3.2)
        AnomalyEntity::class,
    ],
    version = FamilyGuardDatabase.SCHEMA_VERSION,
    exportSchema = true,
)
abstract class FamilyGuardDatabase : RoomDatabase() {

    abstract fun familyGroupDao(): FamilyGroupDao
    abstract fun familyMembershipDao(): FamilyMembershipDao
    abstract fun familyRelationshipDao(): FamilyRelationshipDao
    abstract fun sosEventDao(): SosEventDao
    abstract fun locationPointDao(): LocationPointDao
    abstract fun geofenceDao(): GeofenceDao
    abstract fun enforceRuleDao(): EnforceRuleDao
    abstract fun revivalCodeDao(): RevivalCodeDao
    abstract fun childEventDao(): ChildEventDao
    abstract fun anomalyDao(): AnomalyDao

    companion object {
        const val DATABASE_NAME = "family_guard.db"
        const val SCHEMA_VERSION = 4
    }
}
