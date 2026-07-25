package com.chainlesschain.android.pdh.messaging.qq

import android.database.sqlite.SQLiteDatabase
import org.json.JSONObject
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class QQNTDbExtractorTest {

    private lateinit var outDir: File

    @Before
    fun setUp() {
        outDir = createTempDir(prefix = "qqnt-extractor-")
    }

    @After
    fun tearDown() {
        outDir.deleteRecursively()
    }

    @Test
    fun `extract maps QQNT numeric columns and preserves 19 digit message id`() {
        val db = SQLiteDatabase.create(null)
        db.execSQL(
            """
            CREATE TABLE c2c_msg_table (
              "40001" INTEGER PRIMARY KEY,
              "40003" INTEGER,
              "40020" TEXT,
              "40021" TEXT,
              "40030" INTEGER,
              "40033" INTEGER,
              "40011" INTEGER,
              "40040" INTEGER,
              "40050" INTEGER,
              "40800" BLOB
            )
            """.trimIndent(),
        )
        val messageId = "9007199254740993123"
        db.execSQL(
            """
            INSERT INTO c2c_msg_table (
              "40001", "40003", "40020", "40021", "40030",
              "40033", "40011", "40040", "40050", "40800"
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """.trimIndent(),
            arrayOf<Any>(
                messageId,
                3003L,
                "u_sender_from_40020",
                "peer-from-40021",
                30L,
                400330033L,
                11L,
                40L,
                1_716_000_000L,
                "hello from qqnt".toByteArray(Charsets.UTF_8),
            ),
        )
        db.execSQL(
            """
            CREATE TABLE group_msg_table (
              "40001" INTEGER PRIMARY KEY,
              "40050" INTEGER,
              "40800" BLOB
            )
            """.trimIndent(),
        )
        val baselineOnlyMessageId = "9007199254740993124"
        db.execSQL(
            """
            INSERT INTO group_msg_table ("40001", "40050", "40800")
            VALUES (?, ?, ?)
            """.trimIndent(),
            arrayOf<Any>(
                baselineOnlyMessageId,
                1_716_000_001L,
                "baseline only message".toByteArray(Charsets.UTF_8),
            ),
        )

        val extractor = QQNTDbExtractor().apply {
            openDatabase = { db }
        }

        val result = extractor.extract("ignored.db", outDir, "400330033")

        val ok = assertIs<QQNTDbExtractor.Result.Ok>(result)
        assertEquals(2, ok.messageCount)
        val rawSnapshot = File(ok.stagingJsonPath).readText()
        assertTrue(rawSnapshot.contains("\"msgId\":\"$messageId\""))
        val events = JSONObject(rawSnapshot).getJSONArray("events")
        val event = events.getJSONObject(0)

        assertEquals("msg-$messageId", event.getString("id"))
        assertEquals(messageId, event.getString("msgId"))
        assertEquals("3003", event.getString("sequence"))
        assertEquals("u_sender_from_40020", event.getString("senderUid"))
        assertEquals("peer-from-40021", event.getString("peerUin"))
        assertEquals(30L, event.getLong("senderType"))
        assertEquals("400330033", event.getString("senderUin"))
        assertEquals(11L, event.getLong("msgType"))
        assertEquals(40L, event.getLong("readState"))
        assertEquals(false, event.getBoolean("isGroup"))
        assertEquals(true, event.getBoolean("isSend"))
        assertEquals("hello from qqnt", event.getString("text"))

        val baselineOnlyEvent = events.getJSONObject(1)
        assertEquals(baselineOnlyMessageId, baselineOnlyEvent.getString("msgId"))
        assertEquals(0L, baselineOnlyEvent.getLong("msgType"))
        assertEquals("", baselineOnlyEvent.getString("senderUin"))
        assertEquals("", baselineOnlyEvent.getString("peerUin"))
        assertEquals(true, baselineOnlyEvent.getBoolean("isGroup"))
        assertEquals(false, baselineOnlyEvent.getBoolean("isSend"))
        assertEquals("baseline only message", baselineOnlyEvent.getString("text"))
    }
}
