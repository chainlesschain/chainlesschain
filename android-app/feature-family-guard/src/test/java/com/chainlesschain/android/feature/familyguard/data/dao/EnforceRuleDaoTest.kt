package com.chainlesschain.android.feature.familyguard.data.dao

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.chainlesschain.android.feature.familyguard.data.FamilyGuardDatabase
import com.chainlesschain.android.feature.familyguard.data.entity.EnforceRuleEntity
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import kotlin.test.assertEquals

/** v8 enforce_rules expires_at 查询语义 (M9→M4 临时白名单)。Room in-memory 真 SQL。 */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [33])
class EnforceRuleDaoTest {

    private lateinit var db: FamilyGuardDatabase
    private lateinit var dao: EnforceRuleDao

    @Before
    fun setUp() {
        db = Room.inMemoryDatabaseBuilder(
            ApplicationProvider.getApplicationContext(),
            FamilyGuardDatabase::class.java,
        )
            .allowMainThreadQueries()
            .build()
        dao = db.enforceRuleDao()
    }

    @After
    fun tearDown() = db.close()

    private fun rule(
        target: String,
        expiresAt: Long? = null,
        active: Boolean = true,
        ruleType: String = "temp_exception",
    ) = EnforceRuleEntity(
        ruleType = ruleType,
        target = target,
        config = "{}",
        enforceLevel = 2,
        active = active,
        sourceDid = "did:chain:child",
        createdAt = 1_000L,
        expiresAt = expiresAt,
    )

    @Test
    fun `observeActiveNonExpired keeps permanent and future rules, drops expired`() = runBlocking {
        dao.upsert(rule("permanent", expiresAt = null))
        dao.upsert(rule("future", expiresAt = 5_000L))
        dao.upsert(rule("expired", expiresAt = 2_000L))
        dao.upsert(rule("inactive", expiresAt = 9_000L, active = false))

        val visible = dao.observeActiveNonExpired(now = 3_000L).first().map { it.target }
        assertEquals(setOf("permanent", "future"), visible.toSet())
    }

    @Test
    fun `findActiveNonExpiredBy filters by type target and expiry`() = runBlocking {
        dao.upsert(rule("tv.danmaku.bili", expiresAt = 5_000L))
        dao.upsert(rule("tv.danmaku.bili", expiresAt = 2_000L))
        dao.upsert(rule("tv.danmaku.bili", expiresAt = null, ruleType = "app_blocklist"))

        val hits = dao.findActiveNonExpiredBy("temp_exception", "tv.danmaku.bili", now = 3_000L)
        assertEquals(1, hits.size)
        assertEquals(5_000L, hits[0].expiresAt)
    }

    @Test
    fun `deactivateExpired flips only expired active rows`() = runBlocking {
        dao.upsert(rule("a", expiresAt = 2_000L))
        dao.upsert(rule("b", expiresAt = 5_000L))
        dao.upsert(rule("c", expiresAt = null))

        val flipped = dao.deactivateExpired(now = 3_000L)
        assertEquals(1, flipped)
        val visible = dao.observeActiveNonExpired(now = 3_000L).first().map { it.target }
        assertEquals(setOf("b", "c"), visible.toSet())
        // 再跑无新到期 → 0 (幂等)
        assertEquals(0, dao.deactivateExpired(now = 3_000L))
    }
}
