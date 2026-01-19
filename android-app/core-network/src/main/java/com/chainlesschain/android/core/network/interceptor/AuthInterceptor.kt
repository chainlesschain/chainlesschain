package com.chainlesschain.android.core.network.interceptor

import okhttp3.Interceptor
import okhttp3.Response
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 认证拦截器
 *
 * 为所有请求添加认证Token
 */
@Singleton
class AuthInterceptor @Inject constructor() : Interceptor {

    @Volatile
    private var authToken: String? = null

    fun setAuthToken(token: String?) {
        authToken = token
    }

    override fun intercept(chain: Interceptor.Chain): Response {
        val originalRequest = chain.request()

        // 如果没有Token，直接发送请求
        if (authToken.isNullOrEmpty()) {
            return chain.proceed(originalRequest)
        }

        // 添加Authorization头
        val authenticatedRequest = originalRequest.newBuilder()
            .header("Authorization", "Bearer $authToken")
            .build()

        return chain.proceed(authenticatedRequest)
    }
}
