package com.chainlesschain.android.feature.familyguard.di

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.room.Room
import com.chainlesschain.android.core.security.KeyManager
import com.chainlesschain.android.feature.familyguard.data.FamilyGuardDatabase
import com.chainlesschain.android.feature.familyguard.data.FamilyGuardMigrations
import com.chainlesschain.android.feature.familyguard.data.dao.ChildEventDao
import com.chainlesschain.android.feature.familyguard.data.dao.EnforceRuleDao
import com.chainlesschain.android.feature.familyguard.data.dao.FamilyGroupDao
import com.chainlesschain.android.feature.familyguard.data.dao.FamilyMembershipDao
import com.chainlesschain.android.feature.familyguard.data.dao.FamilyRelationshipDao
import com.chainlesschain.android.feature.familyguard.data.dao.GeofenceDao
import com.chainlesschain.android.feature.familyguard.data.dao.LocationPointDao
import com.chainlesschain.android.feature.familyguard.data.dao.RevivalCodeDao
import com.chainlesschain.android.feature.familyguard.data.dao.SosEventDao
import com.chainlesschain.android.feature.familyguard.data.preferences.appRoleDataStore
import com.chainlesschain.android.feature.familyguard.data.telemetry.ForegroundAppAggregator
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import java.security.SecureRandom
import java.time.Clock
import java.time.ZoneId
import javax.inject.Singleton
import net.zetetic.database.sqlcipher.SupportOpenHelperFactory

/**
 * Hilt graph entry for :feature-family-guard.
 *
 * FAMILY-02: 提供 [FamilyGuardDatabase] + 7 DAOs。passphrase 共享
 * [KeyManager.getDatabaseKey] (M6 Companion TEE Vault 时再独立派生)。
 *
 * SupportOpenHelperFactory + System.loadLibrary("sqlcipher") 模式抄
 * :core-database/di/DatabaseModule.kt; sqlcipher native lib 已通过 :app
 * 的 useLegacyPackaging=true 解压保护 ([[android_native_lib_extract_w_x]])。
 */
@Module
@InstallIn(SingletonComponent::class)
object FamilyGuardModule {

    @Provides
    @Singleton
    fun provideFamilyGuardDatabase(
        @ApplicationContext context: Context,
        keyManager: KeyManager,
    ): FamilyGuardDatabase {
        val passphrase = keyManager.getDatabaseKey()
        // SQLCipher native lib — :core-database has already loaded it for
        // ChainlessChainDatabase; loadLibrary is idempotent so a duplicate call
        // here is safe. Kept defensive in case family-guard initializes earlier.
        runCatching { System.loadLibrary("sqlcipher") }
        val factory = SupportOpenHelperFactory(passphrase.toByteArray())
        return Room.databaseBuilder(
            context,
            FamilyGuardDatabase::class.java,
            FamilyGuardDatabase.DATABASE_NAME,
        )
            .openHelperFactory(factory)
            .addMigrations(*FamilyGuardMigrations.all())
            .addCallback(FamilyGuardMigrations.FamilyGuardMigrationCallback())
            // 仅 debug 用; 生产 build 走完整 migration 链 (v0.1 是 v1, 无迁移)。
            .fallbackToDestructiveMigrationOnDowngrade()
            .build()
    }

    @Provides
    @Singleton
    fun provideFamilyGroupDao(db: FamilyGuardDatabase): FamilyGroupDao = db.familyGroupDao()

    @Provides
    @Singleton
    fun provideFamilyMembershipDao(db: FamilyGuardDatabase): FamilyMembershipDao =
        db.familyMembershipDao()

    @Provides
    @Singleton
    fun provideFamilyRelationshipDao(db: FamilyGuardDatabase): FamilyRelationshipDao =
        db.familyRelationshipDao()

    @Provides
    @Singleton
    fun provideSosEventDao(db: FamilyGuardDatabase): SosEventDao = db.sosEventDao()

    @Provides
    @Singleton
    fun provideLocationPointDao(db: FamilyGuardDatabase): LocationPointDao = db.locationPointDao()

    @Provides
    @Singleton
    fun provideGeofenceDao(db: FamilyGuardDatabase): GeofenceDao = db.geofenceDao()

    @Provides
    @Singleton
    fun provideEnforceRuleDao(db: FamilyGuardDatabase): EnforceRuleDao = db.enforceRuleDao()

    @Provides
    @Singleton
    fun provideRevivalCodeDao(db: FamilyGuardDatabase): RevivalCodeDao = db.revivalCodeDao()

    @Provides
    @Singleton
    fun provideChildEventDao(db: FamilyGuardDatabase): ChildEventDao = db.childEventDao()

    // ─── FAMILY-04: role preferences + clock ───

    @Provides
    @Singleton
    fun provideAppRoleDataStore(
        @ApplicationContext context: Context,
    ): DataStore<Preferences> = context.appRoleDataStore

    /**
     * java.time.Clock injected so 24h-lock tests (FAMILY-04) and TimeAuthority
     * integration (FAMILY-60) can swap implementations. Currently the system
     * UTC clock; FAMILY-60 will replace with TimeAuthority-backed clock to
     * defend against arbitrary device clock skew (主文档 §3.4).
     */
    @Provides
    @Singleton
    fun provideClock(): Clock = Clock.systemUTC()

    /**
     * 设备本地时区 — [QuietHoursEngine] (FAMILY-24) 用其把事件 epoch 时间戳折成本地
     * 墙钟比对私有时段 ('20:00'-'06:00' 是用户感知的本地时间)。与 [provideClock] 的 UTC
     * epoch clock 正交: clock 管 "何时", zoneId 管 "墙钟几点"。单测传固定 ZoneId 直接构造。
     */
    @Provides
    @Singleton
    fun provideZoneId(): ZoneId = ZoneId.systemDefault()

    /**
     * SecureRandom for ULID 生成 (FAMILY-10 FamilyGroupRepositoryImpl / RevivalCode /
     * InvitePairing). 这些 Impl 的 `@Inject constructor(... secureRandom: SecureRandom
     * = SecureRandom())` 默认值 **不被 Dagger 识别** (Dagger 忽略 Kotlin 默认参数), 仍要求
     * 一个显式 binding; 否则 FamilyMembersViewModel(FAMILY-18) 把 FamilyGroupRepository 拉进
     * ViewModel 图时报 [Dagger/MissingBinding] java.security.SecureRandom。单测仍可用
     * fixed-seed SecureRandom 直接构造, 不走 DI。
     */
    @Provides
    @Singleton
    fun provideSecureRandom(): SecureRandom = SecureRandom()

    // ─── FAMILY-21: telemetry source ───

    /**
     * [ForegroundAppAggregator] binding for [ForegroundAppTelemetrySource].
     *
     * 同 [provideSecureRandom] 的坑: ForegroundAppTelemetrySource 的
     * `@Inject constructor(aggregator: ForegroundAppAggregator = ForegroundAppAggregator())`
     * 默认值 **不被 Dagger 识别** (Dagger 忽略 Kotlin 默认参数)。一旦 FAMILY-XX
     * CentralTelemetryDispatcher `@Inject ForegroundAppTelemetrySource` 把它拉进图,
     * 缺这个 binding 就会 [Dagger/MissingBinding] java.security... ForegroundAppAggregator。
     * aggregator 是 pure state machine, 单 source 独占, 故 @Singleton。单测仍直接构造
     * (走 Kotlin 默认值), 不经 DI。
     */
    @Provides
    @Singleton
    fun provideForegroundAppAggregator(): ForegroundAppAggregator = ForegroundAppAggregator()
}
