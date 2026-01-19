package com.chainlesschain.android.feature.auth.di

import android.content.Context
import com.chainlesschain.android.core.security.KeyManager
import com.chainlesschain.android.feature.auth.data.biometric.BiometricAuthenticator
import com.chainlesschain.android.feature.auth.data.repository.AuthRepository
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * 认证模块依赖注入
 */
@Module
@InstallIn(SingletonComponent::class)
object AuthModule {

    @Provides
    @Singleton
    fun provideAuthRepository(
        @ApplicationContext context: Context,
        keyManager: KeyManager
    ): AuthRepository {
        return AuthRepository(context, keyManager)
    }

    @Provides
    @Singleton
    fun provideBiometricAuthenticator(
        @ApplicationContext context: Context
    ): BiometricAuthenticator {
        return BiometricAuthenticator(context)
    }
}
