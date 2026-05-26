package com.chainlesschain.android.pdh.social.common

import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * 2026-05-26 — Hilt @Binds 把 [DefaultRootShellRunner] 具体类绑到
 * [RootShellRunner] 接口。Toutiao Mode B (path B) 的 [ToutiaoRootDbExtractor]
 * + Douyin path B 的 DouyinRootDbExtractor + DbCohortCopier 都 @Inject 这个
 * 接口；Default 实现自己 @Inject ctor 但没 @Binds 就解析不到 interface →
 * MissingBinding 编译错。
 */
@Module
@InstallIn(SingletonComponent::class)
abstract class RootShellRunnerModule {
    @Binds
    @Singleton
    abstract fun bindRootShellRunner(impl: DefaultRootShellRunner): RootShellRunner
}
