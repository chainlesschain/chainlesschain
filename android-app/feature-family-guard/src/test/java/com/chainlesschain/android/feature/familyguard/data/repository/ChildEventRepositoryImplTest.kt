package com.chainlesschain.android.feature.familyguard.data.repository

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.chainlesschain.android.feature.familyguard.data.FamilyGuardDatabase
import com.chainlesschain.android.feature.familyguard.data.entity.ChildEventEntity
import com.chainlesschain.android.feature.familyguard.domain.telemetry.ForegroundAppRun
import com.chainlesschain.android.feature.familyguard.fixtures.FamilyFixtures
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * FAMILY-20 验收: 端到端 ForegroundAppRun → child_event 写库; 数据生命周期 / 查询.
 *
 * Room in-memory 真跑 SQL; 验 payload JSON 转义 + 索引查询 + 过期清理。
 */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [33])
class ChildEventRepositoryImplTest {

    private lateinit var db: FamilyGuardDatabase
    private lateinit var repo: ChildEventRepositoryImpl
    private val childDid = FamilyFixtures.FIXTURE_CHILD_DID
    private val baseMs = FamilyFixtures.FIXTURE_TIME_MS

    @Before
    fun setUp() {
        db = Room.inMemoryDatabaseBuilder(
            ApplicationProvider.getApplicationContext(),
            FamilyGuardDatabase::class.java,
        )
            .allowMainThreadQueries()
            .build()
        repo = ChildEventRepositoryImpl(db.childEventDao())
    }

    @After
    fun tearDown() {
        db.close()
    }

    @Test
    fun `saveForegroundAppRun writes child_event with correct schema`(): Unit = runBlocking {
        val run = ForegroundAppRun(
            packageName = "com.tencent.tmgp.sgame",
            startMs = baseMs,
            endMs = baseMs + 1_800_000L, // 30min
        )
        val id = repo.saveForegroundAppRun(childDid, run)
        assertTrue(id > 0)

        val rows = db.childEventDao().querySince(childDid, baseMs - 1)
        assertEquals(1, rows.size)
        val event = rows[0]
        assertEquals("foreground_app", event.source)
        assertEquals("run", event.kind)
        assertEquals(baseMs, event.timestamp)
        assertEquals(1_800_000L, event.durationMs)
        assertEquals("L1", event.level)
        assertTrue(event.payload.contains("com.tencent.tmgp.sgame"))
        assertTrue(event.payload.contains("1800000"))
    }

    @Test
    fun `saveForegroundAppRun escapes special chars in package name`(): Unit = runBlocking {
        val run = ForegroundAppRun(
            packageName = """com.bad\".package""", // 含 \ 和 "
            startMs = baseMs,
            endMs = baseMs + 60_000L,
        )
        repo.saveForegroundAppRun(childDid, run)
        val event = db.childEventDao().querySince(childDid, 0L)[0]
        // payload 必须仍是合法 JSON 字面值; 含转义 \\ 和 \"
        assertTrue(event.payload.contains("\\\\"))
        assertTrue(event.payload.contains("\\\""))
    }

    @Test
    fun `saveEvent passes through for generic source`(): Unit = runBlocking {
        val custom = ChildEventEntity(
            childDid = childDid,
            source = "pdh_wechat",
            kind = "message",
            payload = """{"chat":"abc"}""",
            timestamp = baseMs,
            durationMs = 0L,
            level = "L2",
        )
        val id = repo.saveEvent(custom)
        assertTrue(id > 0)
        val found = db.childEventDao().querySince(childDid, 0L)[0]
        assertEquals("pdh_wechat", found.source)
        assertEquals("message", found.kind)
        assertEquals("L2", found.level)
    }

    @Test
    fun `querySince filters by timestamp`(): Unit = runBlocking {
        repo.saveForegroundAppRun(
            childDid,
            ForegroundAppRun("com.a", baseMs - 1000L, baseMs - 500L),
        )
        repo.saveForegroundAppRun(
            childDid,
            ForegroundAppRun("com.b", baseMs + 1000L, baseMs + 2000L),
        )
        val recent = repo.querySince(childDid, baseMs)
        assertEquals(1, recent.size)
        assertTrue(recent[0].payload.contains("com.b"))
    }

    @Test
    fun `observeRecent returns most recent N events`(): Unit = runBlocking {
        repeat(5) { i ->
            repo.saveForegroundAppRun(
                childDid,
                ForegroundAppRun("com.app$i", baseMs + i * 1000L, baseMs + i * 1000L + 500L),
            )
        }
        val recent = repo.observeRecent(childDid, limit = 3).first()
        assertEquals(3, recent.size)
        // ORDER BY timestamp DESC → 最近的在前
        assertTrue(recent[0].payload.contains("com.app4"))
    }

    @Test
    fun `deleteOlderThan removes events before cutoff`(): Unit = runBlocking {
        repo.saveForegroundAppRun(childDid, ForegroundAppRun("com.old", 100L, 200L))
        repo.saveForegroundAppRun(childDid, ForegroundAppRun("com.new", baseMs, baseMs + 1L))

        val deleted = repo.deleteOlderThan(baseMs)
        assertEquals(1, deleted)
        val remaining = repo.querySince(childDid, 0L)
        assertEquals(1, remaining.size)
        assertTrue(remaining[0].payload.contains("com.new"))
    }

    @Test
    fun `countForChild reflects per-child events`(): Unit = runBlocking {
        repo.saveForegroundAppRun(childDid, ForegroundAppRun("com.a", baseMs, baseMs + 1L))
        repo.saveForegroundAppRun(childDid, ForegroundAppRun("com.b", baseMs + 100L, baseMs + 200L))
        repo.saveForegroundAppRun(
            "did:chain:other-kid",
            ForegroundAppRun("com.c", baseMs, baseMs + 1L),
        )
        assertEquals(2, db.childEventDao().countForChild(childDid))
        assertEquals(1, db.childEventDao().countForChild("did:chain:other-kid"))
    }
}
