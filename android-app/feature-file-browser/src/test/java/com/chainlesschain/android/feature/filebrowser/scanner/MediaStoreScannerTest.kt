package com.chainlesschain.android.feature.filebrowser.scanner

import android.content.ContentResolver
import android.content.Context
import android.database.Cursor
import android.net.Uri
import android.provider.MediaStore
import app.cash.turbine.test
import com.chainlesschain.android.core.database.dao.ExternalFileDao
import com.chainlesschain.android.core.database.entity.ExternalFileEntity
import com.chainlesschain.android.core.database.entity.FileCategory
import com.chainlesschain.android.feature.filebrowser.data.scanner.MediaStoreScanner
import io.mockk.*
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Before
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Unit tests for MediaStoreScanner
 *
 * Tests:
 * - File scanning from MediaStore
 * - Batch processing
 * - Progress tracking
 * - Error handling
 * - Cache clearing
 */
@OptIn(ExperimentalCoroutinesApi::class)
class MediaStoreScannerTest {

    private lateinit var scanner: MediaStoreScanner
    private lateinit var mockContext: Context
    private lateinit var mockContentResolver: ContentResolver
    private lateinit var mockDao: ExternalFileDao
    private lateinit var mockCursor: Cursor

    @Before
    fun setup() {
        mockContext = mockk(relaxed = true)
        mockContentResolver = mockk(relaxed = true)
        mockDao = mockk(relaxed = true)
        mockCursor = mockk(relaxed = true)

        every { mockContext.contentResolver } returns mockContentResolver

        scanner = MediaStoreScanner(mockContext, mockDao)
    }

    @After
    fun tearDown() {
        clearAllMocks()
    }

    @Test
    fun `scanAllFiles should emit Idle initially`() = runTest {
        scanner.scanProgress.test {
            assertEquals(MediaStoreScanner.ScanProgress.Idle, awaitItem())
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `scanAllFiles should scan images, videos, and audio`() = runTest {
        // Mock cursor with no files
        every { mockCursor.moveToNext() } returns false
        every { mockCursor.count } returns 0
        every { mockCursor.close() } just Runs
        every { mockContentResolver.query(any(), any(), any(), any(), any()) } returns mockCursor
        coEvery { mockDao.insertAll(any()) } returns listOf()

        val result = scanner.scanAllFiles()

        assertTrue(result.isSuccess)
        assertEquals(0, result.getOrNull())

        // Verify all three media types were queried
        verify(exactly = 1) {
            mockContentResolver.query(
                MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                any(),
                any(),
                any(),
                any()
            )
        }
        verify(exactly = 1) {
            mockContentResolver.query(
                MediaStore.Video.Media.EXTERNAL_CONTENT_URI,
                any(),
                any(),
                any()
            )
        }
        verify(exactly = 1) {
            mockContentResolver.query(
                MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
                any(),
                any(),
                any()
            )
        }
    }

    @Test
    fun `scanAllFiles should emit Scanning progress`() = runTest {
        // Mock cursor with 2 image files
        setupMockCursorWithFiles(2, FileCategory.IMAGE)
        every { mockContentResolver.query(any(), any(), any(), any(), any()) } returns mockCursor
        coEvery { mockDao.insertAll(any()) } returns listOf(1L, 2L)

        scanner.scanProgress.test {
            // Skip initial Idle
            assertEquals(MediaStoreScanner.ScanProgress.Idle, awaitItem())

            // Start scan
            scanner.scanAllFiles()

            // Should emit Scanning for each media type
            var item = awaitItem()
            assertTrue(item is MediaStoreScanner.ScanProgress.Scanning)

            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `scanAllFiles should emit Completed with total count`() = runTest {
        // Mock 5 files total (2 images, 2 videos, 1 audio)
        setupMockCursorWithFiles(2, FileCategory.IMAGE)
        val videoCursor = mockk<Cursor>(relaxed = true)
        setupMockCursorWithFiles(videoCursor, 2, FileCategory.VIDEO)
        val audioCursor = mockk<Cursor>(relaxed = true)
        setupMockCursorWithFiles(audioCursor, 1, FileCategory.AUDIO)

        every {
            mockContentResolver.query(
                MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                any(),
                any(),
                any(),
                any()
            )
        } returns mockCursor
        every {
            mockContentResolver.query(
                MediaStore.Video.Media.EXTERNAL_CONTENT_URI,
                any(),
                any(),
                any()
            )
        } returns videoCursor
        every {
            mockContentResolver.query(
                MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
                any(),
                any(),
                any()
            )
        } returns audioCursor

        coEvery { mockDao.insertAll(any()) } returns listOf(1L, 2L)

        scanner.scanProgress.test {
            skipItems(1) // Skip Idle

            val result = scanner.scanAllFiles()

            // Find Completed event
            var completed: MediaStoreScanner.ScanProgress.Completed? = null
            while (completed == null) {
                val item = awaitItem()
                if (item is MediaStoreScanner.ScanProgress.Completed) {
                    completed = item
                }
            }

            assertEquals(5, completed.totalFiles)
            assertTrue(result.isSuccess)
            assertEquals(5, result.getOrNull())

            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `scanAllFiles should handle query errors gracefully`() = runTest {
        // Simulate ContentResolver query throwing exception
        every {
            mockContentResolver.query(any(), any(), any(), any(), any())
        } throws SecurityException("Permission denied")

        val result = scanner.scanAllFiles()

        assertTrue(result.isFailure)

        scanner.scanProgress.test {
            val item = expectMostRecentItem()
            assertTrue(item is MediaStoreScanner.ScanProgress.Error)
            assertEquals("Permission denied", (item as MediaStoreScanner.ScanProgress.Error).message)
        }
    }

    @Test
    fun `scanAllFiles should batch insert files (500 per batch)`() = runTest {
        // Mock 1500 files to test batching
        setupMockCursorWithFiles(1500, FileCategory.IMAGE)
        every { mockContentResolver.query(any(), any(), any(), any(), any()) } returns mockCursor
        coEvery { mockDao.insertAll(any()) } returns List(500) { it.toLong() }

        scanner.scanAllFiles()

        // Should call insertAll 3 times (1500 / 500 = 3 batches)
        coVerify(exactly = 3) { mockDao.insertAll(any()) }
    }

    @Test
    fun `clearCache should delete all files and reset progress`() = runTest {
        coEvery { mockDao.deleteAll() } just Runs

        val result = scanner.clearCache()

        assertTrue(result.isSuccess)
        coVerify(exactly = 1) { mockDao.deleteAll() }

        scanner.scanProgress.test {
            assertEquals(MediaStoreScanner.ScanProgress.Idle, expectMostRecentItem())
        }
    }

    @Test
    fun `clearCache should handle errors`() = runTest {
        coEvery { mockDao.deleteAll() } throws Exception("Database error")

        val result = scanner.clearCache()

        assertTrue(result.isFailure)
    }

    @Test
    fun `should skip non-existent files during scan`() = runTest {
        // Mock cursor returning a file path that doesn't exist
        setupMockCursorWithNonExistentFile()
        every { mockContentResolver.query(any(), any(), any(), any(), any()) } returns mockCursor
        coEvery { mockDao.insertAll(any()) } returns listOf()

        val result = scanner.scanAllFiles()

        // Should complete but skip the non-existent file
        assertTrue(result.isSuccess)
        assertEquals(0, result.getOrNull())

        // Should not insert any files
        coVerify(exactly = 0) { mockDao.insertAll(match { it.isNotEmpty() }) }
    }

    // Helper methods

    private fun setupMockCursorWithFiles(count: Int, category: FileCategory) {
        setupMockCursorWithFiles(mockCursor, count, category)
    }

    private fun setupMockCursorWithFiles(cursor: Cursor, count: Int, category: FileCategory) {
        var callCount = 0
        every { cursor.moveToNext() } answers { callCount++ < count }
        every { cursor.count } returns count

        // Mock column indices
        every { cursor.getColumnIndexOrThrow(MediaStore.MediaColumns._ID) } returns 0
        every { cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.DISPLAY_NAME) } returns 1
        every { cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.DATA) } returns 2
        every { cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.SIZE) } returns 3
        every { cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.DATE_MODIFIED) } returns 4
        every { cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.MIME_TYPE) } returns 5
        every { cursor.getColumnIndex(MediaStore.MediaColumns.WIDTH) } returns 6
        every { cursor.getColumnIndex(MediaStore.MediaColumns.HEIGHT) } returns 7
        every { cursor.getColumnIndex(MediaStore.MediaColumns.DURATION) } returns 8

        // Mock file data
        every { cursor.getLong(0) } returns 12345L
        every { cursor.getString(1) } returns "test_file.${getExtensionForCategory(category)}"
        every { cursor.getString(2) } returns "/storage/emulated/0/test_file.${getExtensionForCategory(category)}"
        every { cursor.getLong(3) } returns 1024L
        every { cursor.getLong(4) } returns System.currentTimeMillis() / 1000
        every { cursor.getString(5) } returns getMimeTypeForCategory(category)

        every { cursor.close() } just Runs
    }

    private fun setupMockCursorWithNonExistentFile() {
        every { mockCursor.moveToNext() } returnsMany listOf(true, false)
        every { mockCursor.count } returns 1

        // Mock column indices
        every { mockCursor.getColumnIndexOrThrow(MediaStore.MediaColumns._ID) } returns 0
        every { mockCursor.getColumnIndexOrThrow(MediaStore.MediaColumns.DISPLAY_NAME) } returns 1
        every { mockCursor.getColumnIndexOrThrow(MediaStore.MediaColumns.DATA) } returns 2
        every { mockCursor.getColumnIndexOrThrow(MediaStore.MediaColumns.SIZE) } returns 3
        every { mockCursor.getColumnIndexOrThrow(MediaStore.MediaColumns.DATE_MODIFIED) } returns 4
        every { mockCursor.getColumnIndexOrThrow(MediaStore.MediaColumns.MIME_TYPE) } returns 5
        every { mockCursor.getColumnIndex(MediaStore.MediaColumns.WIDTH) } returns 6
        every { mockCursor.getColumnIndex(MediaStore.MediaColumns.HEIGHT) } returns 7
        every { mockCursor.getColumnIndex(MediaStore.MediaColumns.DURATION) } returns 8

        // Return a path that doesn't exist
        every { mockCursor.getLong(0) } returns 12345L
        every { mockCursor.getString(1) } returns "nonexistent.jpg"
        every { mockCursor.getString(2) } returns "/nonexistent/path/file.jpg"
        every { mockCursor.getLong(3) } returns 1024L
        every { mockCursor.getLong(4) } returns System.currentTimeMillis() / 1000
        every { mockCursor.getString(5) } returns "image/jpeg"

        every { mockCursor.close() } just Runs
    }

    private fun getExtensionForCategory(category: FileCategory): String {
        return when (category) {
            FileCategory.IMAGE -> "jpg"
            FileCategory.VIDEO -> "mp4"
            FileCategory.AUDIO -> "mp3"
            FileCategory.DOCUMENT -> "pdf"
            FileCategory.ARCHIVE -> "zip"
            FileCategory.CODE -> "kt"
            FileCategory.OTHER -> "bin"
        }
    }

    private fun getMimeTypeForCategory(category: FileCategory): String {
        return when (category) {
            FileCategory.IMAGE -> "image/jpeg"
            FileCategory.VIDEO -> "video/mp4"
            FileCategory.AUDIO -> "audio/mpeg"
            FileCategory.DOCUMENT -> "application/pdf"
            FileCategory.ARCHIVE -> "application/zip"
            FileCategory.CODE -> "text/plain"
            FileCategory.OTHER -> "application/octet-stream"
        }
    }
}
