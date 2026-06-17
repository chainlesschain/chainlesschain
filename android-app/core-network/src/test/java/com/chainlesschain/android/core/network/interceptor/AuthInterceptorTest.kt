package com.chainlesschain.android.core.network.interceptor

import io.mockk.every
import io.mockk.mockk
import io.mockk.slot
import okhttp3.Interceptor
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * [AuthInterceptor] 单测：按 token 条件注入 Authorization 头（安全相关），此前零覆盖。
 * 用 mockk 假 Interceptor.Chain 捕获实际下发的 Request。
 */
class AuthInterceptorTest {

    private fun dummyResponse(req: Request): Response =
        Response.Builder()
            .request(req)
            .protocol(Protocol.HTTP_1_1)
            .code(200)
            .message("OK")
            .build()

    /** 用给定 token 跑一次 intercept，返回实际下发到 chain.proceed 的 Request。 */
    private fun proceededRequestWith(token: String?): Request {
        val interceptor = AuthInterceptor().apply { setAuthToken(token) }
        val chain = mockk<Interceptor.Chain>()
        every { chain.request() } returns Request.Builder().url("https://api.example.com/resource").build()
        val captured = slot<Request>()
        every { chain.proceed(capture(captured)) } answers { dummyResponse(captured.captured) }

        interceptor.intercept(chain)
        return captured.captured
    }

    @Test
    fun `no token leaves request without Authorization header`() {
        assertNull(proceededRequestWith(null).header("Authorization"))
    }

    @Test
    fun `empty token is treated as no token`() {
        assertNull(proceededRequestWith("").header("Authorization"))
    }

    @Test
    fun `token adds Bearer Authorization header`() {
        assertEquals("Bearer abc123", proceededRequestWith("abc123").header("Authorization"))
    }

    @Test
    fun `clearing token after set reverts to no header`() {
        val interceptor = AuthInterceptor()
        interceptor.setAuthToken("abc")
        interceptor.setAuthToken(null)

        val chain = mockk<Interceptor.Chain>()
        every { chain.request() } returns Request.Builder().url("https://api.example.com/x").build()
        val captured = slot<Request>()
        every { chain.proceed(capture(captured)) } answers { dummyResponse(captured.captured) }

        interceptor.intercept(chain)
        assertNull(captured.captured.header("Authorization"))
    }
}
