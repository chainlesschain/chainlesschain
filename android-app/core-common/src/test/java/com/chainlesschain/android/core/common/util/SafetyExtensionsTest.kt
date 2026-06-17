package com.chainlesschain.android.core.common.util

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/**
 * [SafetyExtensions] 单测：防崩溃/防泄漏安全包装器，此前零覆盖。
 * 重点钉住协程取消语义（tryCoSafely / launchSafely 必须重抛 CancellationException，不可吞）。
 * 依赖 Android 的 collectSafelyWithLifecycle 不在此覆盖（需 LifecycleOwner）。
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SafetyExtensionsTest {

    @Test
    fun `trySafely returns value or null and reports via onError`() {
        assertEquals(42, trySafely { 42 })

        var err: Throwable? = null
        val r = trySafely(onError = { err = it }) { throw RuntimeException("boom") }
        assertNull(r)
        assertEquals("boom", err?.message)
    }

    @Test
    fun `tryCoSafely returns value, null on error, and rethrows cancellation`() = runTest {
        assertEquals("v", tryCoSafely { "v" })

        var err: Throwable? = null
        assertNull(tryCoSafely(onError = { err = it }) { throw RuntimeException("e") })
        assertEquals("e", err?.message)

        // CancellationException 必须重抛，不能吞成 null（否则破坏协程取消）
        var rethrew = false
        try {
            tryCoSafely<Unit> { throw CancellationException("c") }
        } catch (e: CancellationException) {
            rethrew = true
        }
        assertTrue("tryCoSafely must rethrow CancellationException", rethrew)
    }

    @Test
    fun `launchSafely swallows block exceptions and reports via onError without cancelling scope`() = runTest {
        var err: Throwable? = null
        val job = launchSafely(onError = { err = it }) { throw RuntimeException("launch-boom") }
        job.join()
        // 异常被 launchSafely 内部吞掉并转 onError；未抛出（否则 runTest 会因未捕获异常失败）
        assertEquals("launch-boom", err?.message)
    }

    @Test
    fun `safeAccess returns null on null receiver or throwing accessor`() {
        val s: String? = "hello"
        assertEquals(5, s.safeAccess { it.length })

        val n: String? = null
        assertNull(n.safeAccess { it.length })

        assertNull(s.safeAccess<String, Int> { throw RuntimeException("x") })
    }

    @Test
    fun `safeCast returns value on type match and null otherwise`() {
        val any: Any = "hello"
        assertEquals("hello", any.safeCast<String>())
        assertNull(any.safeCast<Int>())
        assertNull((null as Any?).safeCast<String>())
    }

    @Test
    fun `requireNotBlank throws IllegalArgumentException on null or blank`() {
        assertEquals("x", "x".requireNotBlank { "msg" })
        try {
            (null as String?).requireNotBlank { "is null" }
            fail("should throw on null")
        } catch (e: IllegalArgumentException) {
            assertEquals("is null", e.message)
        }
        try {
            "   ".requireNotBlank { "is blank" }
            fail("should throw on blank")
        } catch (e: IllegalArgumentException) {
            assertEquals("is blank", e.message)
        }
    }

    @Test
    fun `requireNotNull extension throws on null and returns value otherwise`() {
        val x: Int? = 5
        assertEquals(5, x.requireNotNull { "msg" })

        val y: Int? = null
        try {
            y.requireNotNull { "was null" }
            fail("should throw on null")
        } catch (e: IllegalArgumentException) {
            assertEquals("was null", e.message)
        }
    }

    @Test
    fun `useSafely returns block result and closes resource, null on error`() {
        var closed = false
        val ok = object : AutoCloseable {
            override fun close() { closed = true }
        }.useSafely { "result" }
        assertEquals("result", ok)
        assertTrue(closed)

        // 异常时 use{} 仍在 finally 关闭资源，useSafely 捕获返回 null
        var closedOnError = false
        val r = object : AutoCloseable {
            override fun close() { closedOnError = true }
        }.useSafely { throw RuntimeException("x") }
        assertNull(r)
        assertTrue("resource must be closed even on error", closedOnError)
    }

    @Test
    fun `catchSafely passes values through and routes errors to onError`() = runTest {
        val collected = mutableListOf<Int>()
        flowOf(1, 2, 3).catchSafely(onError = {}) { }.collect { collected.add(it) }
        assertEquals(listOf(1, 2, 3), collected)

        var err: Throwable? = null
        flow<Int> {
            emit(1)
            throw RuntimeException("flow-boom")
        }.catchSafely(onError = { err = it }) { }.collect { }
        assertEquals("flow-boom", err?.message)
    }
}
