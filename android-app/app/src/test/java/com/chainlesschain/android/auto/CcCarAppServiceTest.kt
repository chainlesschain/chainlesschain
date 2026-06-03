package com.chainlesschain.android.auto

import androidx.car.app.validation.HostValidator
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import kotlin.test.assertNotNull
import kotlin.test.assertSame

/**
 * v1.2 #1 Android Auto Phase 0 — CcCarAppService 烟测。
 *
 * 验证 service 端 lifecycle hook 行为：
 *   1. createHostValidator() 返 ALLOW_ALL（debug 期；Phase 3 polish 切真名单）
 *   2. onCreateSession() 返 [CcCarSession] 实例（onCreateScreen 留给 Session 单测）
 *
 * Robolectric 让 CarAppService 抽象 ctor 不抛 ("CarContext not attached")。
 * @AndroidEntryPoint Hilt 入口在测试器里被 Hilt-test 库 stub 掉；这里不验 DI 链路。
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class CcCarAppServiceTest {

    @Test
    fun `createHostValidator returns ALLOW_ALL_HOSTS_VALIDATOR (debug default)`() {
        val service = CcCarAppService()
        // 引用比较：ALLOW_ALL 是 singleton
        assertSame(HostValidator.ALLOW_ALL_HOSTS_VALIDATOR, service.createHostValidator())
    }

    @Test
    fun `onCreateSession returns CcCarSession instance`() {
        val service = CcCarAppService()
        val session = service.onCreateSession()
        assertNotNull(session)
        assert(session is CcCarSession) {
            "Expected CcCarSession, got ${session::class.simpleName}"
        }
    }
}
