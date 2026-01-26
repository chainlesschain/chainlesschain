package com.chainlesschain.android.feature.filebrowser.data.scanner

import android.content.ContentResolver
import android.content.Context
import android.provider.MediaStore
import android.util.Log
import com.chainlesschain.android.core.database.dao.ExternalFileDao
import com.chainlesschain.android.core.database.entity.ExternalFileEntity
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Incremental Update Manager
 *
 * Manages incremental scanning of media files to avoid re-scanning
 * unchanged files, improving performance and reducing battery usage.
 *
 * Features:
 * - Detects new files since last scan
 * - Detects modified files (by lastModified timestamp)
 * - Detects deleted files (file no longer exists)
 * - Batch processing for efficiency
 */
@Singleton
class IncrementalUpdateManager @Inject constructor(
    @ApplicationContext private val context: Context,
    private val externalFileDao: ExternalFileDao
) {

    companion object {
        private const val TAG = "IncrementalUpdateManager"
        private const val BATCH_SIZE = 200
        private const val PREFS_NAME = "file_browser_prefs"
        private const val KEY_LAST_SCAN_TIMESTAMP = "last_scan_timestamp"
    }

    /**
     * Perform incremental update
     *
     * Only scans files that have been added or modified since the last scan.
     *
     * @return IncrementalUpdateResult with statistics
     */
    suspend fun performIncrementalUpdate(): IncrementalUpdateResult = withContext(Dispatchers.IO) {
        try {
            val lastScanTime = getLastScanTimestamp()
            val currentTime = System.currentTimeMillis()

            Log.d(TAG, "Starting incremental update. Last scan: $lastScanTime")

            // Step 1: Find new and modified files
            val (newFiles, modifiedFiles) = findNewAndModifiedFiles(lastScanTime)

            // Step 2: Find and remove deleted files
            val deletedCount = removeDeletedFiles()

            // Step 3: Update files in database
            if (newFiles.isNotEmpty()) {
                externalFileDao.insertAll(newFiles)
            }

            if (modifiedFiles.isNotEmpty()) {
                modifiedFiles.forEach { file ->
                    externalFileDao.update(file)
                }
            }

            // Step 4: Update last scan timestamp
            saveLastScanTimestamp(currentTime)

            Log.d(
                TAG,
                "Incremental update complete. New: ${newFiles.size}, Modified: ${modifiedFiles.size}, Deleted: $deletedCount"
            )

            IncrementalUpdateResult(
                newFilesCount = newFiles.size,
                modifiedFilesCount = modifiedFiles.size,
                deletedFilesCount = deletedCount,
                totalProcessed = newFiles.size + modifiedFiles.size + deletedCount
            )
        } catch (e: Exception) {
            Log.e(TAG, "Error during incremental update", e)
            IncrementalUpdateResult(
                newFilesCount = 0,
                modifiedFilesCount = 0,
                deletedFilesCount = 0,
                totalProcessed = 0,
                error = e.message
            )
        }
    }

    /**
     * Find new and modified files since last scan
     *
     * @param lastScanTime Timestamp of last scan in milliseconds
     * @return Pair of (new files, modified files)
     */
    private suspend fun findNewAndModifiedFiles(
        lastScanTime: Long
    ): Pair<List<ExternalFileEntity>, List<ExternalFileEntity>> {
        val newFiles = mutableListOf<ExternalFileEntity>()
        val modifiedFiles = mutableListOf<ExternalFileEntity>()

        // Convert to seconds (MediaStore uses seconds)
        val lastScanSeconds = lastScanTime / 1000

        // Query MediaStore for files modified after last scan
        val contentResolver: ContentResolver = context.contentResolver
        val projection = arrayOf(
            MediaStore.MediaColumns._ID,
            MediaStore.MediaColumns.DISPLAY_NAME,
            MediaStore.MediaColumns.DATA,
            MediaStore.MediaColumns.SIZE,
            MediaStore.MediaColumns.DATE_MODIFIED,
            MediaStore.MediaColumns.MIME_TYPE
        )

        // Query images, videos, and audio
        val uris = listOf(
            MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
            MediaStore.Video.Media.EXTERNAL_CONTENT_URI,
            MediaStore.Audio.Media.EXTERNAL_CONTENT_URI
        )

        for (uri in uris) {
            contentResolver.query(
                uri,
                projection,
                "${MediaStore.MediaColumns.DATE_MODIFIED} > ?",
                arrayOf(lastScanSeconds.toString()),
                "${MediaStore.MediaColumns.DATE_MODIFIED} DESC"
            )?.use { cursor ->
                val idColumn = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns._ID)
                val nameColumn = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.DISPLAY_NAME)
                val pathColumn = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.DATA)
                val sizeColumn = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.SIZE)
                val dateColumn = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.DATE_MODIFIED)
                val mimeColumn = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.MIME_TYPE)

                while (cursor.moveToNext()) {
                    try {
                        val id = cursor.getLong(idColumn)
                        val fileUri = android.net.Uri.withAppendedPath(uri, id.toString()).toString()
                        val filePath = cursor.getString(pathColumn)

                        // Check if file exists in database
                        val existingFile = externalFileDao.getByUri(fileUri)

                        val fileEntity = createFileEntity(
                            uri = fileUri,
                            displayName = cursor.getString(nameColumn),
                            mimeType = cursor.getString(mimeColumn) ?: "",
                            size = cursor.getLong(sizeColumn),
                            lastModified = cursor.getLong(dateColumn) * 1000,
                            displayPath = filePath
                        )

                        if (existingFile == null) {
                            // New file
                            newFiles.add(fileEntity)
                        } else if (existingFile.lastModified != fileEntity.lastModified) {
                            // Modified file
                            modifiedFiles.add(fileEntity.copy(id = existingFile.id))
                        }
                    } catch (e: Exception) {
                        Log.e(TAG, "Error processing file", e)
                    }
                }
            }
        }

        return Pair(newFiles, modifiedFiles)
    }

    /**
     * Remove deleted files from database
     *
     * Files that no longer exist in the file system are removed from the database.
     *
     * @return Number of deleted files
     */
    private suspend fun removeDeletedFiles(): Int {
        var deletedCount = 0

        // Get all files from database
        val allFiles = getAllFilesFromDb()

        // Check each file exists
        for (file in allFiles) {
            if (file.displayPath != null) {
                val fileExists = java.io.File(file.displayPath).exists()
                if (!fileExists) {
                    externalFileDao.deleteById(file.id)
                    deletedCount++
                }
            }
        }

        return deletedCount
    }

    /**
     * Get all files from database for deletion check
     *
     * Uses pagination to avoid loading too many files at once.
     */
    private suspend fun getAllFilesFromDb(): List<ExternalFileEntity> {
        val allFiles = mutableListOf<ExternalFileEntity>()
        var offset = 0
        val limit = 500

        while (true) {
            val batch = externalFileDao.getFiles(
                categories = null,
                since = null,
                limit = limit,
                offset = offset
            )

            if (batch.isEmpty()) break

            allFiles.addAll(batch)
            offset += limit

            if (batch.size < limit) break
        }

        return allFiles
    }

    /**
     * Create ExternalFileEntity from cursor data
     */
    private fun createFileEntity(
        uri: String,
        displayName: String,
        mimeType: String,
        size: Long,
        lastModified: Long,
        displayPath: String
    ): ExternalFileEntity {
        val category = com.chainlesschain.android.core.database.entity.FileCategory.fromMimeType(mimeType)
        val parentFolder = java.io.File(displayPath).parentFile?.name ?: ""
        val extension = displayName.substringAfterLast('.', "")

        return ExternalFileEntity(
            id = UUID.randomUUID().toString(),
            uri = uri,
            displayName = displayName,
            mimeType = mimeType,
            size = size,
            category = category,
            lastModified = lastModified,
            displayPath = displayPath,
            parentFolder = parentFolder,
            scannedAt = System.currentTimeMillis(),
            isFavorite = false,
            extension = if (extension.isNotEmpty()) extension else null
        )
    }

    /**
     * Get last scan timestamp from SharedPreferences
     */
    private fun getLastScanTimestamp(): Long {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getLong(KEY_LAST_SCAN_TIMESTAMP, 0L)
    }

    /**
     * Save last scan timestamp to SharedPreferences
     */
    private fun saveLastScanTimestamp(timestamp: Long) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putLong(KEY_LAST_SCAN_TIMESTAMP, timestamp).apply()
    }

    /**
     * Check if incremental update is needed
     *
     * @param threshold Time threshold in milliseconds (default: 1 hour)
     * @return true if update is needed
     */
    fun isUpdateNeeded(threshold: Long = 3600_000L): Boolean {
        val lastScan = getLastScanTimestamp()
        val now = System.currentTimeMillis()
        return (now - lastScan) > threshold
    }

    /**
     * Result of incremental update operation
     */
    data class IncrementalUpdateResult(
        val newFilesCount: Int,
        val modifiedFilesCount: Int,
        val deletedFilesCount: Int,
        val totalProcessed: Int,
        val error: String? = null
    ) {
        val isSuccess: Boolean
            get() = error == null

        val hasChanges: Boolean
            get() = totalProcessed > 0
    }
}
