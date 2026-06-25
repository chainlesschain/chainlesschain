package com.chainlesschain.android.feature.enterprise.data.engine

import com.chainlesschain.android.feature.enterprise.domain.model.Permission
import com.chainlesschain.android.feature.enterprise.domain.model.PermissionCheckResult
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * PermissionCache key 单测：userId / resourceType / resourceId 可能含 ":"（DID、复合 id），
 * 拼 key 时必须编码，否则不同 (rtype, rid) 组合会碰撞成同一个 key → 误返回他者的权限
 * 缓存结果（权限判定错误）。feature-enterprise 此前零单测。
 */
class PermissionCacheKeyTest {

    private val cache = PermissionCache()
    private val P = Permission.KNOWLEDGE_VIEW

    @Test
    fun `colon-containing fields do not collide across (rtype,rid) splits`() {
        // 旧实现两者都拼成 "u:KNOWLEDGE_VIEW:a:b:c"。
        val k1 = cache.generateKey("u", P, "a:b", "c")
        val k2 = cache.generateKey("u", P, "a", "b:c")
        assertNotEquals(k1, k2)
    }

    @Test
    fun `distinct colon-split ids round-trip to distinct cached results (regression)`() = runTest {
        val k1 = cache.generateKey("u", P, "a:b", "c")
        val k2 = cache.generateKey("u", P, "a", "b:c")
        cache.put(k1, PermissionCheckResult(hasPermission = true))
        cache.put(k2, PermissionCheckResult(hasPermission = false))
        // 旧实现 k1==k2，第二次 put 覆盖第一次 → get(k1) 会错返 false。
        assertEquals(true, cache.get(k1)?.hasPermission)
        assertEquals(false, cache.get(k2)?.hasPermission)
    }

    @Test
    fun `invalidateResource still targets a colon-containing resource id`() = runTest {
        val keep = cache.generateKey("u", P, "proj", "keep")
        val drop = cache.generateKey("u", P, "proj", "did:key:xyz")
        cache.put(keep, PermissionCheckResult(hasPermission = true))
        cache.put(drop, PermissionCheckResult(hasPermission = true))
        cache.invalidateResource("proj", "did:key:xyz")
        assertNull(cache.get(drop))
        assertEquals(true, cache.get(keep)?.hasPermission)
    }
}
