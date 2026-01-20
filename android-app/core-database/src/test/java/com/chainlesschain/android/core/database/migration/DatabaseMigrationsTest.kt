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
        assertEquals(6, migrations.size)
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
    fun `MIGRATION_3_4 has correct version range`() {
        // When
        val migration = DatabaseMigrations.MIGRATION_3_4

        // Then
        assertEquals(3, migration.startVersion)
        assertEquals(4, migration.endVersion)
    }

    @Test
    fun `MIGRATION_3_4 creates offline_message_queue table`() {
        // When
        DatabaseMigrations.MIGRATION_3_4.migrate(mockDatabase)

        // Then
        verify {
            mockDatabase.execSQL(match {
                it.contains("CREATE TABLE IF NOT EXISTS `offline_message_queue`") &&
                it.contains("`id` TEXT NOT NULL PRIMARY KEY") &&
                it.contains("`peerId` TEXT NOT NULL") &&
                it.contains("`messageType` TEXT NOT NULL") &&
                it.contains("`payload` TEXT NOT NULL")
            })
        }
    }

    @Test
    fun `MIGRATION_4_5 has correct version range`() {
        // When
        val migration = DatabaseMigrations.MIGRATION_4_5

        // Then
        assertEquals(4, migration.startVersion)
        assertEquals(5, migration.endVersion)
    }

    @Test
    fun `MIGRATION_4_5 creates file_transfers table`() {
        // When
        DatabaseMigrations.MIGRATION_4_5.migrate(mockDatabase)

        // Then
        verify {
            mockDatabase.execSQL(match {
                it.contains("CREATE TABLE IF NOT EXISTS `file_transfers`") &&
                it.contains("`id` TEXT NOT NULL PRIMARY KEY") &&
                it.contains("`peerId` TEXT NOT NULL") &&
                it.contains("`fileName` TEXT NOT NULL") &&
                it.contains("`fileSize` INTEGER NOT NULL")
            })
        }
    }

    @Test
    fun `MIGRATION_5_6 has correct version range`() {
        // When
        val migration = DatabaseMigrations.MIGRATION_5_6

        // Then
        assertEquals(5, migration.startVersion)
        assertEquals(6, migration.endVersion)
    }

    @Test
    fun `MIGRATION_5_6 creates projects table`() {
        // When
        DatabaseMigrations.MIGRATION_5_6.migrate(mockDatabase)

        // Then
        verify {
            mockDatabase.execSQL(match {
                it.contains("CREATE TABLE IF NOT EXISTS `projects`") &&
                it.contains("`id` TEXT NOT NULL PRIMARY KEY") &&
                it.contains("`name` TEXT NOT NULL") &&
                it.contains("`userId` TEXT NOT NULL")
            })
        }
    }

    @Test
    fun `MIGRATION_5_6 creates project_files table`() {
        // When
        DatabaseMigrations.MIGRATION_5_6.migrate(mockDatabase)

        // Then
        verify {
            mockDatabase.execSQL(match {
                it.contains("CREATE TABLE IF NOT EXISTS `project_files`") &&
                it.contains("`id` TEXT NOT NULL PRIMARY KEY") &&
                it.contains("`projectId` TEXT NOT NULL") &&
                it.contains("`name` TEXT NOT NULL")
            })
        }
    }

    @Test
    fun `MIGRATION_5_6 creates project_activities table`() {
        // When
        DatabaseMigrations.MIGRATION_5_6.migrate(mockDatabase)

        // Then
        verify {
            mockDatabase.execSQL(match {
                it.contains("CREATE TABLE IF NOT EXISTS `project_activities`") &&
                it.contains("`id` TEXT NOT NULL PRIMARY KEY") &&
                it.contains("`projectId` TEXT NOT NULL") &&
                it.contains("`type` TEXT NOT NULL")
            })
        }
    }

    @Test
    fun `MIGRATION_6_7 has correct version range`() {
        // When
        val migration = DatabaseMigrations.MIGRATION_6_7

        // Then
        assertEquals(6, migration.startVersion)
        assertEquals(7, migration.endVersion)
    }

    @Test
    fun `MIGRATION_6_7 creates FTS virtual table`() {
        // When
        DatabaseMigrations.MIGRATION_6_7.migrate(mockDatabase)

        // Then
        verify {
            mockDatabase.execSQL(match {
                it.contains("CREATE VIRTUAL TABLE IF NOT EXISTS `knowledge_items_fts` USING FTS4")
            })
        }
    }

    @Test
    fun `MIGRATION_6_7 creates FTS triggers`() {
        // When
        DatabaseMigrations.MIGRATION_6_7.migrate(mockDatabase)

        // Then
        verify {
            mockDatabase.execSQL(match {
                it.contains("CREATE TRIGGER IF NOT EXISTS knowledge_items_fts_ai")
            })
        }
        verify {
            mockDatabase.execSQL(match {
                it.contains("CREATE TRIGGER IF NOT EXISTS knowledge_items_fts_ad")
            })
        }
        verify {
            mockDatabase.execSQL(match {
                it.contains("CREATE TRIGGER IF NOT EXISTS knowledge_items_fts_au")
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
