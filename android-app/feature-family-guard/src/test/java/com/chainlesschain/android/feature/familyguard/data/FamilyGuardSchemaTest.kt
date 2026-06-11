package com.chainlesschain.android.feature.familyguard.data

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * FAMILY-02 验收: 7 张 placeholder 表 schema 存在 + Room migration v1 跑通。
 *
 * 用 Room in-memory builder 旁路 SQLCipher (passphrase 在 Hilt 注入路径才需要,
 * schema dump 测试无需真加密)。SQLCipher 端到端测试见 FAMILY-09 androidTest 框架。
 */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [33])
class FamilyGuardSchemaTest {

    private lateinit var db: FamilyGuardDatabase

    private val expectedTables = setOf(
        "family_group",
        "family_membership",
        "family_relationship",
        "sos_event",
        "location_point",
        "geofence",
        "enforce_rules",
        // FAMILY-08 (v2)
        "revival_code",
        // FAMILY-20 (v3) Epic C M2
        "child_event",
        // FAMILY-27 (v4) Epic C M2 异常事件
        "anomaly",
        // FAMILY-63 (v5) 不可删审计日志
        "audit_log",
        // M5 (v6) 任务/作业
        "family_task",
        // M9 (v7) 积分流水
        "points_event",
        // M9 (v9) 兑换目录
        "reward_catalog",
    )

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
    fun tearDown() {
        db.close()
    }

    @Test
    fun `schema version constant is 9 (M9 reward_catalog bumped from 8)`() {
        assertEquals(9, FamilyGuardDatabase.SCHEMA_VERSION)
    }

    @Test
    fun `all 14 tables exist in schema`() {
        val cursor = db.openHelper.readableDatabase.query(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'room_%' AND name NOT LIKE 'android_metadata'"
        )
        val actual = mutableSetOf<String>()
        cursor.use { c ->
            while (c.moveToNext()) actual.add(c.getString(0))
        }
        // 删 android_metadata + room_master_table (Room 自有 housekeeping 表)。
        val filteredActual = actual.filterNot { it.startsWith("room_") || it == "android_metadata" }.toSet()
        assertEquals(
            expectedTables,
            filteredActual,
            "Expected exactly ${expectedTables.size} family-guard tables, got: $filteredActual",
        )
    }

    @Test
    fun `family_relationship has unique index on group+friend+roles`() {
        val cursor = db.openHelper.readableDatabase.query(
            "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='family_relationship'"
        )
        val indices = mutableSetOf<String>()
        cursor.use { c ->
            while (c.moveToNext()) indices.add(c.getString(0))
        }
        assertTrue(
            indices.any { it == "ux_family_rel_group_friend_roles" },
            "ux_family_rel_group_friend_roles missing; indices=$indices",
        )
    }

    @Test
    fun `family_membership has unique index on group+member+device`() {
        val cursor = db.openHelper.readableDatabase.query(
            "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='family_membership'"
        )
        val indices = mutableSetOf<String>()
        cursor.use { c ->
            while (c.moveToNext()) indices.add(c.getString(0))
        }
        assertTrue(
            indices.any { it == "ux_family_membership_group_member_device" },
            "ux_family_membership_group_member_device missing; indices=$indices",
        )
    }
}
