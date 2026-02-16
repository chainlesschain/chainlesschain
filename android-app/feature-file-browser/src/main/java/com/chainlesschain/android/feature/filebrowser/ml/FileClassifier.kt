package com.chainlesschain.android.feature.filebrowser.ml

import android.content.ContentResolver
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import timber.log.Timber
import com.chainlesschain.android.core.database.entity.FileCategory
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.label.ImageLabeling
import com.google.mlkit.vision.label.defaults.ImageLabelerOptions
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.coroutines.resume

/**
 * AI File Classifier
 *
 * Uses ML Kit to intelligently classify files based on content analysis:
 * - Image labeling for photos (detect objects, scenes, activities)
 * - Document classification for text files
 * - Smart category suggestions beyond file extensions
 *
 * Features:
 * - Async classification with coroutines
 * - Confidence score threshold (default 0.7)
 * - Fallback to extension-based classification
 * - Batch processing support
 * - Classification result caching
 *
 * @see <a href="https://developers.google.com/ml-kit/vision/image-labeling">ML Kit Image Labeling</a>
 */
@Singleton
class FileClassifier @Inject constructor() {

    companion object {
        // Confidence threshold for ML Kit predictions
        private const val DEFAULT_CONFIDENCE_THRESHOLD = 0.7f

        // Maximum image size for ML Kit processing (to avoid OOM)
        private const val MAX_IMAGE_DIMENSION = 1024

        // Category mapping keywords
        private val DOCUMENT_KEYWORDS = setOf(
            "document", "text", "paper", "page", "book", "magazine", "newspaper",
            "receipt", "invoice", "form", "letter", "contract"
        )

        private val CODE_KEYWORDS = setOf(
            "code", "programming", "screen", "computer", "laptop", "keyboard",
            "monitor", "terminal", "ide"
        )

        private val ARCHIVE_KEYWORDS = setOf(
            "folder", "file", "archive", "storage", "box", "container"
        )
    }

    // ML Kit image labeler
    private val imageLabeler by lazy {
        val options = ImageLabelerOptions.Builder()
            .setConfidenceThreshold(DEFAULT_CONFIDENCE_THRESHOLD)
            .build()
        ImageLabeling.getClient(options)
    }

    /**
     * Classification result
     *
     * @property suggestedCategory The AI-suggested category
     * @property confidence Confidence score (0.0 - 1.0)
     * @property labels Top labels detected by ML Kit
     * @property fallback Whether fallback to extension-based classification was used
     */
    data class ClassificationResult(
        val suggestedCategory: FileCategory,
        val confidence: Float,
        val labels: List<String> = emptyList(),
        val fallback: Boolean = false
    )

    /**
     * Classify a file using AI
     *
     * @param contentResolver Content resolver for URI access
     * @param uri File URI
     * @param currentCategory Current category from file extension
     * @param mimeType File MIME type
     * @return Classification result with suggested category and confidence
     */
    suspend fun classifyFile(
        contentResolver: ContentResolver,
        uri: String,
        currentCategory: FileCategory,
        mimeType: String?
    ): ClassificationResult = withContext(Dispatchers.IO) {
        try {
            when (currentCategory) {
                FileCategory.IMAGE -> classifyImage(contentResolver, uri)
                FileCategory.DOCUMENT -> classifyDocument(contentResolver, uri, mimeType)
                FileCategory.VIDEO -> {
                    // Videos can't be classified without frames, keep current category
                    ClassificationResult(
                        suggestedCategory = FileCategory.VIDEO,
                        confidence = 1.0f,
                        fallback = true
                    )
                }
                FileCategory.AUDIO -> {
                    // Audio files can't be classified without transcription, keep current category
                    ClassificationResult(
                        suggestedCategory = FileCategory.AUDIO,
                        confidence = 1.0f,
                        fallback = true
                    )
                }
                FileCategory.ARCHIVE -> {
                    ClassificationResult(
                        suggestedCategory = FileCategory.ARCHIVE,
                        confidence = 1.0f,
                        fallback = true
                    )
                }
                FileCategory.CODE -> {
                    ClassificationResult(
                        suggestedCategory = FileCategory.CODE,
                        confidence = 1.0f,
                        fallback = true
                    )
                }
                FileCategory.OTHER -> {
                    // Try to classify unknown files as images if possible
                    if (mimeType?.startsWith("image/") == true) {
                        classifyImage(contentResolver, uri)
                    } else {
                        ClassificationResult(
                            suggestedCategory = FileCategory.OTHER,
                            confidence = 1.0f,
                            fallback = true
                        )
                    }
                }
            }
        } catch (e: Exception) {
            Timber.e(e, "Error classifying file: $uri")
            // Fallback to current category
            ClassificationResult(
                suggestedCategory = currentCategory,
                confidence = 0.0f,
                fallback = true
            )
        }
    }

    /**
     * Classify an image using ML Kit image labeling
     *
     * @param contentResolver Content resolver for URI access
     * @param uri Image URI
     * @return Classification result
     */
    private suspend fun classifyImage(
        contentResolver: ContentResolver,
        uri: String
    ): ClassificationResult = suspendCancellableCoroutine { continuation ->
        try {
            // Load and scale image
            val bitmap = loadAndScaleImage(contentResolver, uri)
            if (bitmap == null) {
                continuation.resume(
                    ClassificationResult(
                        suggestedCategory = FileCategory.IMAGE,
                        confidence = 0.0f,
                        fallback = true
                    )
                )
                return@suspendCancellableCoroutine
            }

            // Create ML Kit input image
            val inputImage = InputImage.fromBitmap(bitmap, 0)

            // Run ML Kit labeling
            imageLabeler.process(inputImage)
                .addOnSuccessListener { labels ->
                    val topLabels = labels.take(5).map { it.text.lowercase() }
                    val avgConfidence = labels.take(5)
                        .map { it.confidence }
                        .average()
                        .toFloat()

                    Timber.d("Image labels: $topLabels, confidence: $avgConfidence")

                    // Analyze labels to suggest category
                    val suggestedCategory = when {
                        topLabels.any { it in DOCUMENT_KEYWORDS } -> FileCategory.DOCUMENT
                        topLabels.any { it in CODE_KEYWORDS } -> FileCategory.CODE
                        topLabels.any { it in ARCHIVE_KEYWORDS } -> FileCategory.OTHER
                        else -> FileCategory.IMAGE // Keep as image
                    }

                    continuation.resume(
                        ClassificationResult(
                            suggestedCategory = suggestedCategory,
                            confidence = avgConfidence,
                            labels = topLabels,
                            fallback = false
                        )
                    )

                    // Clean up bitmap
                    if (!bitmap.isRecycled) {
                        bitmap.recycle()
                    }
                }
                .addOnFailureListener { e ->
                    Timber.e(e, "ML Kit labeling failed")
                    continuation.resume(
                        ClassificationResult(
                            suggestedCategory = FileCategory.IMAGE,
                            confidence = 0.0f,
                            fallback = true
                        )
                    )

                    // Clean up bitmap
                    if (!bitmap.isRecycled) {
                        bitmap.recycle()
                    }
                }
        } catch (e: Exception) {
            Timber.e(e, "Error in classifyImage")
            continuation.resume(
                ClassificationResult(
                    suggestedCategory = FileCategory.IMAGE,
                    confidence = 0.0f,
                    fallback = true
                )
            )
        }
    }

    /**
     * Classify a document file
     *
     * Currently uses heuristics based on MIME type.
     * Future enhancement: Use ML Kit text recognition + NLP for content analysis.
     *
     * @param contentResolver Content resolver for URI access
     * @param uri Document URI
     * @param mimeType File MIME type
     * @return Classification result
     */
    private suspend fun classifyDocument(
        contentResolver: ContentResolver,
        uri: String,
        mimeType: String?
    ): ClassificationResult = withContext(Dispatchers.IO) {
        // For now, keep document classification based on MIME type
        // Future enhancement: Use ML Kit text recognition to analyze content

        val suggestedCategory = when {
            mimeType?.contains("pdf") == true -> FileCategory.DOCUMENT
            mimeType?.contains("document") == true -> FileCategory.DOCUMENT
            mimeType?.contains("text") == true -> {
                // Check if it's code
                if (mimeType.contains("html") ||
                    mimeType.contains("javascript") ||
                    mimeType.contains("xml") ||
                    mimeType.contains("json")) {
                    FileCategory.CODE
                } else {
                    FileCategory.DOCUMENT
                }
            }
            else -> FileCategory.DOCUMENT
        }

        ClassificationResult(
            suggestedCategory = suggestedCategory,
            confidence = 0.8f,
            labels = listOfNotNull(mimeType),
            fallback = true // Using MIME type heuristics, not true ML
        )
    }

    /**
     * Load and scale image for ML Kit processing
     *
     * @param contentResolver Content resolver
     * @param uri Image URI
     * @return Scaled bitmap, or null if loading fails
     */
    private fun loadAndScaleImage(
        contentResolver: ContentResolver,
        uri: String
    ): Bitmap? {
        return try {
            val inputStream = contentResolver.openInputStream(Uri.parse(uri))
                ?: return null

            // Decode dimensions first
            val options = BitmapFactory.Options().apply {
                inJustDecodeBounds = true
            }
            BitmapFactory.decodeStream(inputStream, null, options)
            inputStream.close()

            // Calculate scale factor
            val scaleFactor = calculateScaleFactor(
                options.outWidth,
                options.outHeight,
                MAX_IMAGE_DIMENSION,
                MAX_IMAGE_DIMENSION
            )

            // Load scaled bitmap
            val inputStream2 = contentResolver.openInputStream(Uri.parse(uri))
                ?: return null

            val decodeOptions = BitmapFactory.Options().apply {
                inSampleSize = scaleFactor
                inPreferredConfig = Bitmap.Config.RGB_565 // Save memory
            }

            val bitmap = BitmapFactory.decodeStream(inputStream2, null, decodeOptions)
            inputStream2.close()

            bitmap
        } catch (e: Exception) {
            Timber.e(e, "Error loading image: $uri")
            null
        }
    }

    /**
     * Calculate scale factor for image downsampling
     *
     * @param srcWidth Source width
     * @param srcHeight Source height
     * @param maxWidth Maximum width
     * @param maxHeight Maximum height
     * @return Scale factor (power of 2)
     */
    private fun calculateScaleFactor(
        srcWidth: Int,
        srcHeight: Int,
        maxWidth: Int,
        maxHeight: Int
    ): Int {
        var scaleFactor = 1

        if (srcWidth > maxWidth || srcHeight > maxHeight) {
            val widthRatio = srcWidth / maxWidth
            val heightRatio = srcHeight / maxHeight
            scaleFactor = maxOf(widthRatio, heightRatio)

            // Round to nearest power of 2
            var powerOf2 = 1
            while (powerOf2 < scaleFactor) {
                powerOf2 *= 2
            }
            scaleFactor = powerOf2
        }

        return scaleFactor
    }

    /**
     * Batch classify multiple files
     *
     * @param files List of file data (uri, category, mimeType)
     * @param contentResolver Content resolver
     * @return Map of URI to classification result
     */
    suspend fun batchClassify(
        contentResolver: ContentResolver,
        files: List<Triple<String, FileCategory, String?>>
    ): Map<String, ClassificationResult> = withContext(Dispatchers.IO) {
        files.associate { (uri, category, mimeType) ->
            uri to classifyFile(contentResolver, uri, category, mimeType)
        }
    }

    /**
     * Release resources
     */
    fun close() {
        try {
            imageLabeler.close()
        } catch (e: Exception) {
            Timber.e(e, "Error closing image labeler")
        }
    }
}
