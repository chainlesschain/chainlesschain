package com.chainlesschain.android.feature.familyguard.di

import com.chainlesschain.android.feature.familyguard.data.FamilyGuardDatabase
import com.chainlesschain.android.feature.familyguard.data.dao.PointsEventDao
import com.chainlesschain.android.feature.familyguard.data.dao.RewardCatalogDao
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * M9 points_event DI 图 (主文档 §3.9)。
 *
 * 独立成文件 (同 [FamilyTaskModule] 的取向) 以减少并行 ticket 的合并冲突面。
 * PointsLedger 接口与实现在 :app/presentation/aistudy (依赖 PointsEngine 域类型),
 * 这里只提供 DAO。
 */
@Module
@InstallIn(SingletonComponent::class)
object PointsLedgerModule {

    @Provides
    @Singleton
    fun providePointsEventDao(db: FamilyGuardDatabase): PointsEventDao = db.pointsEventDao()

    @Provides
    @Singleton
    fun provideRewardCatalogDao(db: FamilyGuardDatabase): RewardCatalogDao = db.rewardCatalogDao()
}
