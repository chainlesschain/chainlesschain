package com.chainlesschain.android.core.database.migration

import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import io.mockk.*
import org.junit.After
import org.junit.Before
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * 数据库迁移单元测试
 */
class DatabaseMigrationsTest {

    private lateinit var mockDatabase: SupportSQLiteDatabase

    @Before
    fun setup() {
        mockDatabase = mockk(relaxed = true)
    }

    @After
    fun tearDown() {
        clearAllMocks()
    }

    @Test
    fun `getAllMigrations returns all migrations`() {
        // When
        val migrations = DatabaseMigrations.getAllMigrations()

        // Then
        assertNotNull(migrations)
        assertTrue(migrations.isNotEmpty())
        assertEquals(2, migrations.size)
    }

    @Test
    fun `MIGRATION_1_2 has correct version range`() {
        // When
        val migration = DatabaseMigrations.MIGRATION_1_2

        // Then
        assertEquals(1, migration.startVersion)
        assertEquals(2, migration.endVersion)
    }

    @Test
    fun `MIGRATION_1_2 creates p2p_messages table`() {
        // When
        DatabaseMigrations.MIGRATION_1_2.migrate(mockDatabase)

        // Then
        verify {
            mockDatabase.execSQL(match {
                it.contains("CREATE TABLE IF NOT EXISTS `p2p_messages`") &&
                it.contains("`id` TEXT NOT NULL PRIMARY KEY") &&
                it.contains("`peerId` TEXT NOT NULL") &&
                it.contains("`fromDeviceId` TEXT NOT NULL") &&
                it.contains("`toDeviceId` TEXT NOT NULL") &&
                it.contains("`type` TEXT NOT NULL") &&
                it.contains("`content` TEXT NOT NULL") &&
                it.contains("`timestamp` INTEGER NOT NULL") &&
                it.contains("`isOutgoing` INTEGER NOT NULL") &&
                it.contains("`sendStatus` TEXT NOT NULL")
            })
        }
    }

    @Test
    fun `MIGRATION_1_2 creates indexes`() {
        // When
        DatabaseMigrations.MIGRATION_1_2.migrate(mockDatabase)

        // Then
        verify {
            mockDatabase.execSQL(match {
                it.contains("CREATE INDEX IF NOT EXISTS `index_p2p_messages_peerId`")
            })
        }
        verify {
            mockDatabase.execSQL(match {
                it.contains("CREATE INDEX IF NOT EXISTS `index_p2p_messages_timestamp`")
            })
        }
        verify {
            mockDatabase.execSQL(match {
                it.contains("CREATE INDEX IF NOT EXISTS `index_p2p_messages_peerId_timestamp`")
            })
        }
    }

    @Test
    fun `MIGRATION_2_3 has correct version range`() {
        // When
        val migration = DatabaseMigrations.MIGRATION_2_3

        // Then
        assertEquals(2, migration.startVersion)
        assertEquals(3, migration.endVersion)
    }

    @Test
    fun `MIGRATION_2_3 adds isRecalled column`() {
        // When
        DatabaseMigrations.MIGRATION_2_3.migrate(mockDatabase)

        // Then
        verify {
            mockDatabase.execSQL(match {
                it.contains("ALTER TABLE `p2p_messages`") &&
                it.contains("ADD COLUMN `isRecalled` INTEGER NOT NULL DEFAULT 0")
            })
        }
    }

    @Test
    fun `MIGRATION_2_3 adds editedAt column`() {
        // When
        DatabaseMigrations.MIGRATION_2_3.migrate(mockDatabase)

        // Then
        verify {
            mockDatabase.execSQL(match {
                it.contains("ALTER TABLE `p2p_messages`") &&
                it.contains("ADD COLUMN `editedAt` INTEGER")
            })
        }
    }

    @Test
    fun `MIGRATION_2_3 adds embedding column to knowledge_items`() {
        // When
        DatabaseMigrations.MIGRATION_2_3.migrate(mockDatabase)

        // Then
        verify {
            mockDatabase.execSQL(match {
                it.contains("ALTER TABLE `knowledge_items`") &&
                it.contains("ADD COLUMN `embedding` TEXT")
            })
        }
    }

    @Test
    fun `MigrationCallback enables WAL mode on open`() {
        // Given
        val callback = DatabaseMigrations.MigrationCallback()

        // When
        callback.onOpen(mockDatabase)

        // Then
        verify {
            mockDatabase.execSQL("PRAGMA journal_mode=WAL")
        }
    }

    @Test
    fun `MigrationCallback enables foreign keys on open`() {
        // Given
        val callback = DatabaseMigrations.MigrationCallback()

        // When
        callback.onOpen(mockDatabase)

        // Then
        verify {
            mockDatabase.execSQL("PRAGMA foreign_keys=ON")
        }
    }

    @Test
    fun `migrations are ordered correctly`() {
        // When
        val migrations = DatabaseMigrations.getAllMigrations()

        // Then
        for (i in 0 until migrations.size - 1) {
            assertTrue(
                migrations[i].endVersion <= migrations[i + 1].startVersion,
                "Migration ${migrations[i].startVersion}->${migrations[i].endVersion} should come before ${migrations[i + 1].startVersion}->${migrations[i + 1].endVersion}"
            )
        }
    }

    @Test
    fun `migrations cover consecutive versions`() {
        // When
        val migrations = DatabaseMigrations.getAllMigrations()

        // Then
        var expectedStart = 1
        for (migration in migrations) {
            assertEquals(
                expectedStart,
                migration.startVersion,
                "Expected migration starting from version $expectedStart"
            )
            expectedStart = migration.endVersion
        }
    }
}
