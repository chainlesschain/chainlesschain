package com.chainlesschain.android.feature.filebrowser.data.scanner

import android.content.ContentResolver
import android.content.Context
import android.database.Cursor
import android.provider.MediaStore
import android.util.Log
import com.chainlesschain.android.core.database.dao.ExternalFileDao
import com.chainlesschain.android.core.database.entity.ExternalFileEntity
import com.chainlesschain.android.core.database.entity.FileCategory
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton

/**
 * MediaStore Scanner
 *
 * Scans device media files (images, videos, audio) using MediaStore API
 * and stores metadata in local database for fast access.
 *
 * Features:
 * - Batch processing with configurable batch size
 * - Progress tracking via StateFlow
 * - Automatic parent folder extraction
 * - Duplicate detection and update
 */
@Singleton
class MediaStoreScanner @Inject constructor(
    @ApplicationContext private val context: Context,
    private val externalFileDao: ExternalFileDao
) {
    companion object {
        private const val TAG = "MediaStoreScanner"
        private const val BATCH_SIZE = 500
        private const val BATCH_DELAY_MS = 100L
    }

    /**
     * Scan Progress States
     */
    sealed class ScanProgress {
        object Idle : ScanProgress()
        data class Scanning(
            val current: Int,
            val total: Int,
            val currentType: String
        ) : ScanProgress()
        data class Completed(val totalFiles: Int) : ScanProgress()
        data class Error(val message: String) : ScanProgress()
    }

    private val _scanProgress = MutableStateFlow<ScanProgress>(ScanProgress.Idle)
    val scanProgress: StateFlow<ScanProgress> = _scanProgress.asStateFlow()

    /**
     * Scan all media files from MediaStore
     *
     * @return Result containing total number of files scanned
     */
    suspend fun scanAllFiles(): Result<Int> = withContext(Dispatchers.IO) {
        try {
            _scanProgress.value = ScanProgress.Scanning(0, 0, "Initializing")

            var totalScanned = 0

            // Scan images
            _scanProgress.value = ScanProgress.Scanning(totalScanned, 0, "Images")
            val imageCount = scanMediaType(
                MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                MediaType.IMAGE
            )
            totalScanned += imageCount
            Log.d(TAG, "Scanned $imageCount images")

            delay(BATCH_DELAY_MS)

            // Scan videos
            _scanProgress.value = ScanProgress.Scanning(totalScanned, 0, "Videos")
            val videoCount = scanMediaType(
                MediaStore.Video.Media.EXTERNAL_CONTENT_URI,
                MediaType.VIDEO
            )
            totalScanned += videoCount
            Log.d(TAG, "Scanned $videoCount videos")

            delay(BATCH_DELAY_MS)

            // Scan audio
            _scanProgress.value = ScanProgress.Scanning(totalScanned, 0, "Audio")
            val audioCount = scanMediaType(
                MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
                MediaType.AUDIO
            )
            totalScanned += audioCount
            Log.d(TAG, "Scanned $audioCount audio files")

            _scanProgress.value = ScanProgress.Completed(totalScanned)
            Log.d(TAG, "Total files scanned: $totalScanned")

            Result.success(totalScanned)
        } catch (e: Exception) {
            Log.e(TAG, "Error scanning files", e)
            _scanProgress.value = ScanProgress.Error(e.message ?: "Unknown error")
            Result.failure(e)
        }
    }

    /**
     * Scan specific media type from MediaStore
     *
     * @param contentUri MediaStore content URI
     * @param mediaType Type of media (IMAGE, VIDEO, AUDIO)
     * @return Number of files scanned
     */
    private suspend fun scanMediaType(
        contentUri: android.net.Uri,
        mediaType: MediaType
    ): Int = withContext(Dispatchers.IO) {
        val contentResolver: ContentResolver = context.contentResolver
        val projection = arrayOf(
            MediaStore.MediaColumns._ID,
            MediaStore.MediaColumns.DISPLAY_NAME,
            MediaStore.MediaColumns.DATA,
            MediaStore.MediaColumns.SIZE,
            MediaStore.MediaColumns.DATE_MODIFIED,
            MediaStore.MediaColumns.MIME_TYPE,
            MediaStore.MediaColumns.WIDTH,
            MediaStore.MediaColumns.HEIGHT,
            MediaStore.MediaColumns.DURATION
        )

        var totalCount = 0
        val batch = mutableListOf<ExternalFileEntity>()

        contentResolver.query(
            contentUri,
            projection,
            null,
            null,
            "${MediaStore.MediaColumns.DATE_MODIFIED} DESC"
        )?.use { cursor ->
            val idColumn = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns._ID)
            val nameColumn = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.DISPLAY_NAME)
            val pathColumn = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.DATA)
            val sizeColumn = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.SIZE)
            val dateColumn = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.DATE_MODIFIED)
            val mimeColumn = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.MIME_TYPE)
            val widthColumn = cursor.getColumnIndex(MediaStore.MediaColumns.WIDTH)
            val heightColumn = cursor.getColumnIndex(MediaStore.MediaColumns.HEIGHT)
            val durationColumn = cursor.getColumnIndex(MediaStore.MediaColumns.DURATION)

            val totalFiles = cursor.count

            while (cursor.moveToNext()) {
                try {
                    val filePath = cursor.getString(pathColumn)
                    val file = File(filePath)

                    if (!file.exists()) {
                        continue
                    }

                    val id = cursor.getLong(idColumn)
                    val uri = android.net.Uri.withAppendedPath(contentUri, id.toString()).toString()
                    val displayName = cursor.getString(nameColumn)
                    val mimeType = cursor.getString(mimeColumn) ?: ""
                    val extension = displayName.substringAfterLast('.', "")

                    val entity = ExternalFileEntity(
                        id = uri,
                        uri = uri,
                        displayName = displayName,
                        mimeType = mimeType,
                        size = cursor.getLong(sizeColumn),
                        category = mediaType.toFileCategory(),
                        lastModified = cursor.getLong(dateColumn) * 1000, // Convert to milliseconds
                        displayPath = filePath,
                        parentFolder = extractParentFolder(filePath),
                        scannedAt = System.currentTimeMillis(),
                        isFavorite = false,
                        extension = if (extension.isNotEmpty()) extension else null
                    )

                    batch.add(entity)
                    totalCount++

                    // Insert batch when size limit reached
                    if (batch.size >= BATCH_SIZE) {
                        externalFileDao.insertOrUpdateBatch(batch)
                        _scanProgress.value = ScanProgress.Scanning(
                            totalCount,
                            totalFiles,
                            mediaType.name
                        )
                        batch.clear()
                        delay(BATCH_DELAY_MS)
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Error processing file", e)
                }
            }

            // Insert remaining files
            if (batch.isNotEmpty()) {
                externalFileDao.insertOrUpdateBatch(batch)
                batch.clear()
            }
        }

        totalCount
    }

    /**
     * Extract parent folder from file path
     *
     * @param filePath Full file path
     * @return Parent folder name or path
     */
    private fun extractParentFolder(filePath: String): String {
        val file = File(filePath)
        val parent = file.parentFile
        return parent?.name ?: parent?.absolutePath ?: ""
    }

    /**
     * Clear all cached files from database
     *
     * @return Result indicating success or failure
     */
    suspend fun clearCache(): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            externalFileDao.deleteAll()
            _scanProgress.value = ScanProgress.Idle
            Log.d(TAG, "Cache cleared successfully")
            Result.success(Unit)
        } catch (e: Exception) {
            Log.e(TAG, "Error clearing cache", e)
            Result.failure(e)
        }
    }

    /**
     * Media type enumeration
     */
    private enum class MediaType(val category: String) {
        IMAGE("Images"),
        VIDEO("Videos"),
        AUDIO("Audio");

        fun toFileCategory(): FileCategory = when (this) {
            IMAGE -> FileCategory.IMAGE
            VIDEO -> FileCategory.VIDEO
            AUDIO -> FileCategory.AUDIO
        }
    }
}

/**
 * Extension function to safely get nullable Int from Cursor
 */
private fun Cursor.getIntOrNull(columnIndex: Int): Int? {
    return if (isNull(columnIndex)) null else getInt(columnIndex)
}

/**
 * Extension function to safely get nullable Long from Cursor
 */
private fun Cursor.getLongOrNull(columnIndex: Int): Long? {
    return if (isNull(columnIndex)) null else getLong(columnIndex)
}
