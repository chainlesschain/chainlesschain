package com.chainlesschain.android.di

import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Qualifier
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers

/**
 * 限定符 — 注入 IO `CoroutineDispatcher`。
 *
 * @HiltViewModel/@Inject 类不能给构造参数写 Kotlin 默认值
 * (`= Dispatchers.IO`)，否则会生成第二个合成构造器，Hilt 报
 * "may only contain one injected constructor"（见 memory
 * `android_inject_default_param_dual_ctor`）。因此 dispatcher 走
 * 限定符 + Hilt 绑定提供，单测则手动传入 TestDispatcher。
 */
@Qualifier
@Retention(AnnotationRetention.BINARY)
annotation class IoDispatcher

/**
 * 提供协程 dispatcher 的 Hilt 模块。
 */
@Module
@InstallIn(SingletonComponent::class)
object DispatchersModule {

    @Provides
    @IoDispatcher
    fun provideIoDispatcher(): CoroutineDispatcher = Dispatchers.IO
}
