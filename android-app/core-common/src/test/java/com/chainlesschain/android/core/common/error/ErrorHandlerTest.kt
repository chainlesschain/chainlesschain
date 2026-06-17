package com.chainlesschain.android.core.common.error

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException
import java.net.SocketTimeoutException
import java.net.UnknownHostException

/**
 * [ErrorHandler] 纯逻辑单测：异常分类 + 用户消息 + 重试/需用户操作判定（此前零覆盖）。
 *
 * 这些判定驱动全局重试策略与 UX，分错=不该重试的重试 / 该提示用户的没提示。
 * SQLiteException→DatabaseError 路径不测（android.database stub 在 JVM 单测里无法实例化）。
 */
class ErrorHandlerTest {

    @Test
    fun `handleError maps network exceptions to NetworkError and preserves cause`() {
        assertTrue(ErrorHandler.handleError(UnknownHostException("no host")) is AppError.NetworkError)
        assertTrue(ErrorHandler.handleError(SocketTimeoutException("timeout")) is AppError.NetworkError)
        val io = IOException("io down")
        val err = ErrorHandler.handleError(io)
        assertTrue(err is AppError.NetworkError)
        assertSame(io, err.cause)
    }

    @Test
    fun `handleError maps SecurityException to PermissionError`() {
        assertTrue(ErrorHandler.handleError(SecurityException("denied")) is AppError.PermissionError)
    }

    @Test
    fun `handleError maps IllegalArgument and IllegalState to ValidationError preserving message`() {
        val e = ErrorHandler.handleError(IllegalArgumentException("bad arg"))
        assertTrue(e is AppError.ValidationError)
        assertEquals("bad arg", e.message)
        assertTrue(ErrorHandler.handleError(IllegalStateException("bad state")) is AppError.ValidationError)
    }

    @Test
    fun `handleError maps unrecognized exceptions to UnknownError`() {
        val e = ErrorHandler.handleError(RuntimeException("weird"))
        assertTrue(e is AppError.UnknownError)
        assertEquals("weird", e.message)
    }

    @Test
    fun `getUserMessage maps network status codes to specific messages`() {
        assertEquals("认证失败，请重新登录", ErrorHandler.getUserMessage(AppError.NetworkError(statusCode = 401)))
        assertEquals("认证失败，请重新登录", ErrorHandler.getUserMessage(AppError.NetworkError(statusCode = 403)))
        assertEquals("请求的资源不存在", ErrorHandler.getUserMessage(AppError.NetworkError(statusCode = 404)))
        assertEquals("服务器错误，请稍后重试", ErrorHandler.getUserMessage(AppError.NetworkError(statusCode = 500)))
        // 未识别状态码 / 无状态码 → 回落到 error.message
        val defaultMsg = "网络连接失败，请检查网络设置"
        assertEquals(defaultMsg, ErrorHandler.getUserMessage(AppError.NetworkError(statusCode = 418)))
        assertEquals(defaultMsg, ErrorHandler.getUserMessage(AppError.NetworkError()))
    }

    @Test
    fun `requiresUserAction true only for auth permission and validation`() {
        assertTrue(ErrorHandler.requiresUserAction(AppError.AuthError()))
        assertTrue(ErrorHandler.requiresUserAction(AppError.PermissionError()))
        assertTrue(ErrorHandler.requiresUserAction(AppError.ValidationError("v")))
        assertFalse(ErrorHandler.requiresUserAction(AppError.NetworkError()))
        assertFalse(ErrorHandler.requiresUserAction(AppError.UnknownError()))
        assertFalse(ErrorHandler.requiresUserAction(AppError.DatabaseError()))
    }

    @Test
    fun `isRetryable true for network unknown file but not the rest`() {
        assertTrue(ErrorHandler.isRetryable(AppError.NetworkError()))
        assertTrue(ErrorHandler.isRetryable(AppError.UnknownError()))
        assertTrue(ErrorHandler.isRetryable(AppError.FileError()))
        assertFalse(ErrorHandler.isRetryable(AppError.DatabaseError()))
        assertFalse(ErrorHandler.isRetryable(AppError.AuthError()))
        assertFalse(ErrorHandler.isRetryable(AppError.ValidationError("v")))
        assertFalse(ErrorHandler.isRetryable(AppError.BusinessError("b")))
        assertFalse(ErrorHandler.isRetryable(AppError.PermissionError()))
    }
}
