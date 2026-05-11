package com.chainlesschain.android.core.security.di

import android.content.Context
import com.chainlesschain.android.core.security.KeyManager
import com.chainlesschain.android.core.security.strongbox.AndroidKeystoreFacade
import com.chainlesschain.android.core.security.strongbox.KeystoreFacade
import com.chainlesschain.android.core.security.strongbox.StrongBoxKeyManager
import dagger.Binds
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * 安全模块依赖注入
 */
@Module
@InstallIn(SingletonComponent::class)
object SecurityModule {

    @Provides
    @Singleton
    fun provideKeyManager(@ApplicationContext context: Context): KeyManager {
        return KeyManager(context)
    }

    @Provides
    @Singleton
    fun provideStrongBoxKeyManager(keystore: KeystoreFacade): StrongBoxKeyManager {
        return StrongBoxKeyManager(keystore)
    }
}

/**
 * KeystoreFacade 与 AndroidKeystoreFacade 的绑定。
 * 单独 @Module 是因为 @Binds 必须在 abstract class / interface 上。
 */
@Module
@InstallIn(SingletonComponent::class)
abstract class KeystoreFacadeModule {

    @Binds
    @Singleton
    abstract fun bindKeystoreFacade(impl: AndroidKeystoreFacade): KeystoreFacade
}
