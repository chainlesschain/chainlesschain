package com.chainlesschain.android.presentation.aistudy

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.chainlesschain.android.feature.familyguard.data.FamilyGuardDatabase
import com.chainlesschain.android.feature.familyguard.data.entity.GuardrailEventEntity
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

/**
 * M6 护栏事件真持久 ([RoomGuardrailEventSink] ↔ guardrail_event)。
 * 验 落库只含类别+tab+时间 (隐私契约) / 重启回灌 / 未知枚举丢弃。
 */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [33])
class RoomGuardrailEventSinkTest {

    private lateinit var db: FamilyGuardDatabase

    @Before
    fun setUp() {
        db = Room.inMemoryDatabaseBuilder(
            ApplicationProvider.getApplicationContext(),
            FamilyGuardDatabase::class.java,
        )
            .allowMainThreadQueries()
            .build()
    }

    @After
    fun tearDown() = db.close()

    @Test
    fun `record lands in memory immediately and persists only metadata`() = runBlocking {
        val sink = RoomGuardrailEventSink(db.guardrailEventDao())
        sink.record(GuardrailFinding(RiskCategory.SELF_HARM, AiStudyTab.COMPANION, timestamp = 1_000L))

        assertEquals(1, sink.findings.value.size)
        sink.awaitIdle()
        val row = db.guardrailEventDao().getAll().single()
        assertEquals("SELF_HARM", row.category)
        assertEquals("COMPANION", row.tab)
        assertEquals(1_000L, row.timestamp)
    }

    @Test
    fun `restart restores persisted findings (the original gap)`() = runBlocking {
        val first = RoomGuardrailEventSink(db.guardrailEventDao())
        first.record(GuardrailFinding(RiskCategory.BULLYING, AiStudyTab.LEARNING, timestamp = 2_000L))
        first.awaitIdle()

        val second = RoomGuardrailEventSink(db.guardrailEventDao())
        second.awaitLoaded()
        val restored = second.findings.value.single()
        assertEquals(RiskCategory.BULLYING, restored.category)
        assertEquals(AiStudyTab.LEARNING, restored.tab)
    }

    @Test
    fun `unknown persisted enum rows are dropped instead of crashing`() = runBlocking {
        db.guardrailEventDao().insert(
            GuardrailEventEntity(category = "FUTURE_RISK", tab = "LEARNING", timestamp = 1_000L),
        )
        db.guardrailEventDao().insert(
            GuardrailEventEntity(category = "SELF_HARM", tab = "FUTURE_TAB", timestamp = 2_000L),
        )
        val sink = RoomGuardrailEventSink(db.guardrailEventDao())
        sink.awaitLoaded()
        assertTrue(sink.findings.value.isEmpty())
    }
}
