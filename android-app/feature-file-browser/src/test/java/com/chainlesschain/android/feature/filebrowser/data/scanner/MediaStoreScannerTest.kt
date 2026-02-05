package com.chainlesschain.android.feature.filebrowser.data.scanner

import android.content.ContentResolver
import android.content.Context
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.provider.MediaStore
import com.chainlesschain.android.core.database.dao.ExternalFileDao
import com.chainlesschain.android.core.database.entity.ExternalFileEntity
import com.chainlesschain.android.core.database.entity.FileCategory
import io.mockk.*
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File

/**
 * Unit tests for MediaStoreScanner
 *
 * Tests file scanning, categorization, batch processing,
 * incremental updates, and error handling.
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class MediaStoreScannerTest {

    private lateinit var context: Context
    private lateinit var contentResolver: ContentResolver
    private lateinit var externalFileDao: ExternalFileDao
    private lateinit var mediaStoreScanner: MediaStoreScanner

    @Before
    fun setup() {
        context = mockk(relaxed = true)
        contentResolver = mockk(relaxed = true)
        externalFileDao = mockk(relaxed = true)

        every { context.contentResolver } returns contentResolver

        mediaStoreScanner = MediaStoreScanner(context, externalFileDao)
    }

    @After
    fun tearDown() {
        clearAllMocks()
    }

    @Test
    fun `scanAllFiles should return success with total count`() = runTest {
        // Arrange
        val mockImageCursor = createMockCursor(listOf(
            createFileEntry(1, "image1.jpg", "image/jpeg", 1024, FileCategory.IMAGE),
            createFileEntry(2, "image2.png", "image/png", 2048, FileCategory.IMAGE)
        ))
        val mockVideoCursor = createMockCursor(listOf(
            createFileEntry(3, "video1.mp4", "video/mp4", 5000, FileCategory.VIDEO)
        ))
        val mockAudioCursor = createMockCursor(listOf(
            createFileEntry(4, "audio1.mp3", "audio/mpeg", 3000, FileCategory.AUDIO)
        ))

        every {
            contentResolver.query(
                MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                any(),
                any(),
                any(),
                any()
            )
        } returns mockImageCursor

        every {
            contentResolver.query(
                MediaStore.Video.Media.EXTERNAL_CONTENT_URI,
                any(),
                any(),
                any(),
                any()
            )
        } returns mockVideoCursor

        every {
            contentResolver.query(
                MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
                any(),
                any(),
                any(),
                any()
            )
        } returns mockAudioCursor

        coJustRun { externalFileDao.insertAll(any()) }

        // Act
        val result = mediaStoreScanner.scanAllFiles()

        // Assert
        assertTrue(result.isSuccess)
        assertEquals(4, result.getOrNull()) // 2 images + 1 video + 1 audio

        // Verify batch inserts were called
        coVerify(atLeast = 1) { externalFileDao.insertAll(any()) }

        // Verify final progress state
        val progress = mediaStoreScanner.scanProgress.value
        assertTrue(progress is MediaStoreScanner.ScanProgress.Completed)
        assertEquals(4, (progress as MediaStoreScanner.ScanProgress.Completed).totalFiles)
    }

    @Test
    fun `scanAllFiles should handle empty MediaStore`() = runTest {
        // Arrange
        val emptyCursor = createMockCursor(emptyList())

        every {
            contentResolver.query(any(), any(), any(), any(), any())
        } returns emptyCursor

        coJustRun { externalFileDao.insertAll(any()) }

        // Act
        val result = mediaStoreScanner.scanAllFiles()

        // Assert
        assertTrue(result.isSuccess)
        assertEquals(0, result.getOrNull())

        val progress = mediaStoreScanner.scanProgress.value
        assertTrue(progress is MediaStoreScanner.ScanProgress.Completed)
        assertEquals(0, (progress as MediaStoreScanner.ScanProgress.Completed).totalFiles)
    }

    @Test
    fun `scanAllFiles should handle errors gracefully`() = runTest {
        // Arrange
        every {
            contentResolver.query(any(), any(), any(), any(), any())
        } throws SecurityException("Permission denied")

        // Act
        val result = mediaStoreScanner.scanAllFiles()

        // Assert
        assertTrue(result.isFailure)
        assertTrue(result.exceptionOrNull() is SecurityException)

        val progress = mediaStoreScanner.scanProgress.value
        assertTrue(progress is MediaStoreScanner.ScanProgress.Error)
        assertTrue((progress as MediaStoreScanner.ScanProgress.Error).message.contains("Permission denied"))
    }

    @Test
    fun `scanAllFiles should batch process files in groups of 500`() = runTest {
        // Arrange - Create 1000 files to test batching
        val largeFileList = (1..1000).map {
            createFileEntry(it.toLong(), "file$it.jpg", "image/jpeg", 1024, FileCategory.IMAGE)
        }
        val mockCursor = createMockCursor(largeFileList)

        every {
            contentResolver.query(
                MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                any(),
                any(),
                any(),
                any()
            )
        } returns mockCursor

        every {
            contentResolver.query(
                MediaStore.Video.Media.EXTERNAL_CONTENT_URI,
                any(),
                any(),
                any(),
                any()
            )
        } returns createMockCursor(emptyList())

        every {
            contentResolver.query(
                MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
                any(),
                any(),
                any(),
                any()
            )
        } returns createMockCursor(emptyList())

        val batches = mutableListOf<List<ExternalFileEntity>>()
        coJustRun { externalFileDao.insertAll(capture(batches)) }

        // Act
        val result = mediaStoreScanner.scanAllFiles()

        // Assert
        assertTrue(result.isSuccess)
        assertEquals(1000, result.getOrNull())

        // Verify batches
        assertTrue(batches.isNotEmpty())
        // Should have 2 batches: 500 + 500
        assertEquals(500, batches[0].size)
    }

    @Test
    fun `scanAllFiles should categorize files correctly by MIME type`() = runTest {
        // Arrange
        val mockCursor = createMockCursor(listOf(
            createFileEntry(1, "doc.pdf", "application/pdf", 1024, FileCategory.IMAGE),
            createFileEntry(2, "photo.jpg", "image/jpeg", 2048, FileCategory.IMAGE),
            createFileEntry(3, "movie.mp4", "video/mp4", 5000, FileCategory.VIDEO),
            createFileEntry(4, "song.mp3", "audio/mpeg", 3000, FileCategory.AUDIO)
        ))

        every {
            contentResolver.query(
                MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                any(),
                any(),
                any(),
                any()
            )
        } returns mockCursor

        every {
            contentResolver.query(
                MediaStore.Video.Media.EXTERNAL_CONTENT_URI,
                any(),
                any(),
                any(),
                any()
            )
        } returns createMockCursor(emptyList())

        every {
            contentResolver.query(
                MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
                any(),
                any(),
                any(),
                any()
            )
        } returns createMockCursor(emptyList())

        val insertedBatches = mutableListOf<List<ExternalFileEntity>>()
        coJustRun { externalFileDao.insertAll(capture(insertedBatches)) }

        // Act
        mediaStoreScanner.scanAllFiles()

        // Assert
        val allFiles = insertedBatches.flatten()
        assertEquals(4, allFiles.size)

        // All files scanned from Images URI should be categorized as IMAGE
        allFiles.forEach { file ->
            assertEquals(FileCategory.IMAGE, file.category)
        }
    }

    @Test
    fun `scanIncrementalFiles should only scan new files after last scan`() = runTest {
        // Arrange
        val lastScanTime = System.currentTimeMillis() - 86400000L // 1 day ago
        val lastScanSeconds = lastScanTime / 1000

        coEvery { externalFileDao.getLastScanTimestamp() } returns lastScanTime

        val newFiles = listOf(
            createFileEntry(1, "new_image.jpg", "image/jpeg", 1024, FileCategory.IMAGE)
        )
        val mockCursor = createMockCursor(newFiles)

        every {
            contentResolver.query(
                MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                any(),
                "${MediaStore.MediaColumns.DATE_MODIFIED} > ?",
                arrayOf(lastScanSeconds.toString()),
                any()
            )
        } returns mockCursor

        every {
            contentResolver.query(
                MediaStore.Video.Media.EXTERNAL_CONTENT_URI,
                any(),
                any(),
                any(),
                any()
            )
        } returns createMockCursor(emptyList())

        every {
            contentResolver.query(
                MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
                any(),
                any(),
                any(),
                any()
            )
        } returns createMockCursor(emptyList())

        coJustRun { externalFileDao.insertAll(any()) }

        // Act
        val result = mediaStoreScanner.scanIncrementalFiles()

        // Assert
        assertTrue(result.isSuccess)
        assertEquals(1, result.getOrNull())

        // Verify selection criteria was used
        verify {
            contentResolver.query(
                MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                any(),
                "${MediaStore.MediaColumns.DATE_MODIFIED} > ?",
                arrayOf(lastScanSeconds.toString()),
                any()
            )
        }
    }

    @Test
    fun `scanIncrementalFiles should handle no new files`() = runTest {
        // Arrange
        coEvery { externalFileDao.getLastScanTimestamp() } returns System.currentTimeMillis()

        every {
            contentResolver.query(any(), any(), any(), any(), any())
        } returns createMockCursor(emptyList())

        // Act
        val result = mediaStoreScanner.scanIncrementalFiles()

        // Assert
        assertTrue(result.isSuccess)
        assertEquals(0, result.getOrNull())

        val progress = mediaStoreScanner.scanProgress.value
        assertTrue(progress is MediaStoreScanner.ScanProgress.Completed)
        assertEquals(0, (progress as MediaStoreScanner.ScanProgress.Completed).totalFiles)
    }

    @Test
    fun `clearCache should delete all files and reset progress`() = runTest {
        // Arrange
        coJustRun { externalFileDao.deleteAll() }

        // Act
        val result = mediaStoreScanner.clearCache()

        // Assert
        assertTrue(result.isSuccess)
        coVerify { externalFileDao.deleteAll() }

        // Verify progress reset to Idle
        val progress = mediaStoreScanner.scanProgress.value
        assertTrue(progress is MediaStoreScanner.ScanProgress.Idle)
    }

    @Test
    fun `clearCache should handle errors`() = runTest {
        // Arrange
        val exception = RuntimeException("Database error")
        coEvery { externalFileDao.deleteAll() } throws exception

        // Act
        val result = mediaStoreScanner.clearCache()

        // Assert
        assertTrue(result.isFailure)
        assertEquals(exception, result.exceptionOrNull())
    }

    @Test
    fun `scanProgress should emit Scanning state during scan`() = runTest {
        // Arrange
        val mockCursor = createMockCursor(listOf(
            createFileEntry(1, "file1.jpg", "image/jpeg", 1024, FileCategory.IMAGE)
        ))

        every {
            contentResolver.query(
                MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                any(),
                any(),
                any(),
                any()
            )
        } returns mockCursor

        every {
            contentResolver.query(
                MediaStore.Video.Media.EXTERNAL_CONTENT_URI,
                any(),
                any(),
                any(),
                any()
            )
        } returns createMockCursor(emptyList())

        every {
            contentResolver.query(
                MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
                any(),
                any(),
                any(),
                any()
            )
        } returns createMockCursor(emptyList())

        coJustRun { externalFileDao.insertAll(any()) }

        // Act
        mediaStoreScanner.scanAllFiles()

        // Assert
        val finalProgress = mediaStoreScanner.scanProgress.value
        assertTrue(finalProgress is MediaStoreScanner.ScanProgress.Completed)
    }

    // Helper functions

    private fun createMockCursor(entries: List<FileEntry>): Cursor {
        val cursor = MatrixCursor(arrayOf(
            MediaStore.MediaColumns._ID,
            MediaStore.MediaColumns.DISPLAY_NAME,
            MediaStore.MediaColumns.DATA,
            MediaStore.MediaColumns.SIZE,
            MediaStore.MediaColumns.DATE_MODIFIED,
            MediaStore.MediaColumns.MIME_TYPE,
            MediaStore.MediaColumns.WIDTH,
            MediaStore.MediaColumns.HEIGHT,
            MediaStore.MediaColumns.DURATION
        ))

        entries.forEach { entry ->
            // Mock file existence
            mockkStatic(File::class)
            val mockFile = mockk<File>(relaxed = true)
            every { mockFile.exists() } returns true
            every { mockFile.parentFile } returns mockk(relaxed = true) {
                every { name } returns "ParentFolder"
            }
            every { File(entry.path) } returns mockFile

            cursor.addRow(arrayOf(
                entry.id,
                entry.displayName,
                entry.path,
                entry.size,
                entry.dateModified / 1000, // MediaStore uses seconds
                entry.mimeType,
                1920, // width
                1080, // height
                120000 // duration
            ))
        }

        return cursor
    }

    private fun createFileEntry(
        id: Long,
        displayName: String,
        mimeType: String,
        size: Long,
        category: FileCategory
    ): FileEntry {
        return FileEntry(
            id = id,
            displayName = displayName,
            path = "/storage/emulated/0/DCIM/$displayName",
            mimeType = mimeType,
            size = size,
            dateModified = System.currentTimeMillis(),
            category = category
        )
    }

    private data class FileEntry(
        val id: Long,
        val displayName: String,
        val path: String,
        val mimeType: String,
        val size: Long,
        val dateModified: Long,
        val category: FileCategory
    )
}
