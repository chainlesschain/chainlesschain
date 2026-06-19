package com.chainlesschain.android.presentation.aistudy

import javax.inject.Qualifier

/**
 * 限定符：标记**底层真持久**积分账本 ([RoomPointsLedger])，区别于无限定符的同步装饰器
 * ([SyncingPointsLedger])。
 *
 * 收端 applier ([PointsLedgerSyncApplierImpl]) 注入 `@RawPointsLedger` 写库，避免经装饰器
 * 把"刚收到的"流水又上行回弹给发送方 (echo)。ViewModel 等本机写入方注入无限定符版本 →
 * 自动上行同步。
 */
@Qualifier
@Retention(AnnotationRetention.BINARY)
annotation class RawPointsLedger
