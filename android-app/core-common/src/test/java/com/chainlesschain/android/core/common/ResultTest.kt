package com.chainlesschain.android.core.common

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/**
 * [Result] 单测：项目通用 Result 类型贯穿全仓使用，此前零覆盖。
 * 重点钉住易错边界：fold/`.data` 在 Loading/Error 抛错、map 在 Error 保留 exception+message、
 * asResult 必须**重抛 CancellationException**（不可吞成 Error，否则破坏协程取消语义）。
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ResultTest {

    @Test
    fun `state flags and accessors`() {
        val s: Result<Int> = Result.success(7)
        assertTrue(s.isSuccess); assertFalse(s.isError); assertFalse(s.isLoading)
        assertEquals(7, s.getOrNull()); assertNull(s.exceptionOrNull())

        val ex = RuntimeException("e")
        val er: Result<Int> = Result.error(ex)
        assertFalse(er.isSuccess); assertTrue(er.isError)
        assertNull(er.getOrNull()); assertSame(ex, er.exceptionOrNull())

        val l: Result<Int> = Result.loading()
        assertTrue(l.isLoading); assertNull(l.getOrNull()); assertNull(l.exceptionOrNull())
    }

    @Test
    fun `map transforms success, preserves error exception+message, keeps loading`() {
        assertEquals(Result.Success(10), (Result.Success(5) as Result<Int>).map { it * 2 })

        val ex = RuntimeException("x")
        val mappedErr = (Result.Error(ex, "msg") as Result<Int>).map { it * 2 }
        assertTrue(mappedErr is Result.Error)
        assertSame(ex, (mappedErr as Result.Error).exception)
        assertEquals("msg", mappedErr.message)

        assertTrue((Result.Loading as Result<Int>).map { it * 2 } is Result.Loading)
    }

    @Test
    fun `onSuccess and onError run only on matching state and return self`() {
        var s = 0; var e = 0
        val success: Result<Int> = Result.Success(1)
        val returned = success.onSuccess { s++ }.onError { e++ }
        assertSame(success, returned); assertEquals(1, s); assertEquals(0, e)

        var s2 = 0; var e2 = 0
        val error: Result<Int> = Result.Error(RuntimeException())
        error.onSuccess { s2++ }.onError { e2++ }
        assertEquals(0, s2); assertEquals(1, e2)
    }

    @Test
    fun `fold maps success and error but throws on loading`() {
        assertEquals("ok:5", (Result.Success(5) as Result<Int>).fold({ "ok:$it" }, { "err" }))
        assertEquals(
            "err:bad",
            (Result.Error(RuntimeException("bad")) as Result<Int>).fold({ "ok" }, { "err:${it.message}" }),
        )
        try {
            (Result.Loading as Result<Int>).fold({ "ok" }, { "err" })
            fail("fold on Loading should throw")
        } catch (e: IllegalStateException) { /* expected */ }
    }

    @Test
    fun `data extension returns value on success and throws otherwise`() {
        val ok: Result<Int> = Result.Success(42)
        assertEquals(42, ok.data)

        val ex = IllegalArgumentException("bad")
        val err: Result<Int> = Result.Error(ex)
        try {
            err.data; fail("data on Error should throw")
        } catch (e: IllegalArgumentException) {
            assertSame(ex, e) // 抛出的就是原始 exception
        }

        val loading: Result<Int> = Result.Loading
        try {
            loading.data; fail("data on Loading should throw")
        } catch (e: IllegalStateException) { /* expected */ }
    }

    @Test
    fun `asResult wraps values in Success and trailing exception in Error`() = runTest {
        val ok = flowOf(1, 2, 3).asResult().toList()
        assertEquals(3, ok.size)
        assertEquals(listOf(1, 2, 3), ok.map { (it as Result.Success).data })

        val withError = flow {
            emit(1)
            throw RuntimeException("boom")
        }.asResult().toList()
        assertEquals(2, withError.size)
        assertTrue(withError[0] is Result.Success)
        assertTrue(withError[1] is Result.Error)
        assertEquals("boom", (withError[1] as Result.Error).exception.message)
    }

    @Test
    fun `asResult rethrows CancellationException instead of swallowing it as Error`() = runTest {
        var propagated = false
        try {
            flow<Int> { throw CancellationException("cancelled") }.asResult().toList()
        } catch (e: CancellationException) {
            propagated = true
        }
        assertTrue("CancellationException must propagate (coroutine cancellation)", propagated)
    }
}
