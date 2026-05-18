package com.chainlesschain.android.core.network.di

import com.chainlesschain.android.core.network.config.NetworkConfig
import com.chainlesschain.android.core.network.interceptor.AuthInterceptor
import com.chainlesschain.android.core.network.interceptor.LoggingInterceptor
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import java.util.concurrent.TimeUnit
import javax.inject.Singleton

/**
 * 网络模块依赖注入
 */
@Module
@InstallIn(SingletonComponent::class)
object NetworkModule {

    /**
     * 提供Json序列化器
     */
    @Provides
    @Singleton
    fun provideJson(): Json = Json {
        ignoreUnknownKeys = true
        isLenient = true
        encodeDefaults = true
    }

    /**
     * 提供OkHttpClient
     */
    @Provides
    @Singleton
    fun provideOkHttpClient(
        authInterceptor: AuthInterceptor,
        loggingInterceptor: LoggingInterceptor,
        networkConfig: NetworkConfig
    ): OkHttpClient {
        val timeoutMs = networkConfig.requestTimeoutMs
        return OkHttpClient.Builder()
            .connectTimeout(timeoutMs, TimeUnit.MILLISECONDS)
            .readTimeout(timeoutMs, TimeUnit.MILLISECONDS)
            .writeTimeout(timeoutMs, TimeUnit.MILLISECONDS)
            // WebSocket ping interval for keep-alive.
            // 注意：OkHttp 的 pingInterval 是**主动发 PING**（不只是被动回 server PING）；
            // PONG 必须在同样的 pingInterval 内回来，否则 connection 整个被 fail 掉。
            // 20s 在桌面 signaling server 处理慢命令时（如 PtyManager 冷启 / system.getInfo
            // 拉一堆系统信息 ~3s）会误判：PING 走得太快，server 排队中没来得及回 PONG → WS
            // 死亡 → 所有挂在该 WS 上的 peerId 集体 Unregistered → in-flight response 找
            // 不到投递地址 → 用户 UI spinner 永远转。把窗口拉到 60s。
            .pingInterval(60, TimeUnit.SECONDS)
            .addInterceptor(authInterceptor)
            .addInterceptor(loggingInterceptor)
            .build()
    }

    /**
     * 提供Retrofit实例（通用）
     */
    @Provides
    @Singleton
    fun provideRetrofit(
        okHttpClient: OkHttpClient,
        json: Json,
        networkConfig: NetworkConfig
    ): Retrofit {
        return Retrofit.Builder()
            .baseUrl(networkConfig.apiBaseUrl)
            .client(okHttpClient)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()
    }
}
