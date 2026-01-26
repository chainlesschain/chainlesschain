package com.chainlesschain.android.core.common

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.TestDispatcher
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.rules.TestWatcher
import org.junit.runner.Description
import java.util.UUID

/**
 * 测试工具类
 *
 * 提供测试中常用的辅助函数和工厂方法
 */
object TestUtils {

    /**
     * 生成随机 UUID 字符串
     */
    fun randomId(): String = UUID.randomUUID().toString()

    /**
     * 生成随机 DID
     */
    fun randomDid(): String = "did:test:${randomId()}"

    /**
     * 生成当前时间戳
     */
    fun now(): Long = System.currentTimeMillis()

    /**
     * 生成过去的时间戳
     * @param minutesAgo 多少分钟前
     */
    fun pastTime(minutesAgo: Long): Long = now() - (minutesAgo * 60 * 1000)

    /**
     * 等待协程执行完成
     * @param delayMs 延迟毫秒数
     */
    suspend fun delay(delayMs: Long = 100) {
        kotlinx.coroutines.delay(delayMs)
    }
}

/**
 * JUnit规则，用于在测试中使用TestDispatcher
 *
 * 使用方法：
 * ```
 * @get:Rule
 * val mainDispatcherRule = MainDispatcherRule()
 * ```
 */
@OptIn(ExperimentalCoroutinesApi::class)
class MainDispatcherRule(
    val testDispatcher: TestDispatcher = UnconfinedTestDispatcher()
) : TestWatcher() {
    override fun starting(description: Description) {
        Dispatchers.setMain(testDispatcher)
    }

    override fun finished(description: Description) {
        Dispatchers.resetMain()
    }
}

/**
 * Assertion extensions for custom Result class
 *
 * These extensions work with the custom Result sealed class defined in
 * core-common/src/main/java/com/chainlesschain/android/core/common/Result.kt
 */
fun <T> Result<T>.assertSuccess(): T {
    if (isError) {
        throw AssertionError("Expected success but was failure: ${exceptionOrNull()?.message}")
    }
    return getOrNull() ?: throw AssertionError("Result is not Success")
}

fun <T> Result<T>.assertFailure(): Throwable {
    if (isSuccess) {
        throw AssertionError("Expected failure but was success: ${getOrNull()}")
    }
    return exceptionOrNull() ?: throw AssertionError("Result is not Error")
}

fun <T> Result<T>.assertFailureMessage(expectedMessage: String) {
    val throwable = assertFailure()
    if (!throwable.message.isNullOrEmpty() && !throwable.message!!.contains(expectedMessage)) {
        throw AssertionError("Expected message to contain '$expectedMessage' but was '${throwable.message}'")
    }
}

/*
 * NOTE: TestDataFactory and MockSocialRepository have been removed from this file
 * as they were causing compilation errors and were not being used by unit tests.
 *
 * The actual TestDataFactory used by instrumented tests (E2E tests) is located in:
 * core-common/src/androidTest/java/com/chainlesschain/android/core/common/test/TestDataFactory.kt
 *
 * If you need test data factories or mock repositories for unit tests, please:
 * 1. Create them in the appropriate test package with correct imports
 * 2. Or use the androidTest version for instrumented tests
 */
