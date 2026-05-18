package com.chainlesschain.android.feature.filebrowser.ml

import android.content.ContentResolver
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Rect
import android.net.Uri
import timber.log.Timber
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.coroutines.resume

/**
 * Text Recognizer using ML Kit
 *
 * Extracts text from images using Google ML Kit Text Recognition API.
 *
 * Features:
 * - Latin script text recognition
 * - Block, line, and element-level text extraction
 * - Bounding box coordinates for each text element
 * - Language detection
 * - Confidence scoring
 * - Async processing with coroutines
 *
 * Use cases:
 * - Document scanning
 * - Business card reading
 * - Screenshot text extraction
 * - Sign and label reading
 * - Receipt processing
 *
 * @see <a href="https://developers.google.com/ml-kit/vision/text-recognition">ML Kit Text Recognition</a>
 */
@Singleton
class TextRecognizer @Inject constructor() {

    companion object {
        // Maximum image dimension for processing (to avoid OOM)
        private const val MAX_IMAGE_DIMENSION = 2048
    }

    // ML Kit text recognizer
    private val recognizer by lazy {
        TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
    }

    /**
     * Recognition result
     *
     * Contains extracted text with structural and spatial information.
     *
     * @property text Full recognized text
     * @property blocks List of text blocks (paragraphs)
     * @property confidence Overall confidence score (0.0 - 1.0)
     * @property language Detected language code (e.g., "en", "zh")
     */
    data class RecognitionResult(
        val text: String,
        val blocks: List<TextBlock>,
        val confidence: Float,
        val language: String?
    ) {
        /**
         * Check if any text was recognized
         */
        fun isEmpty(): Boolean = text.isBlank()

        /**
         * Check if text was recognized
         */
        fun isNotEmpty(): Boolean = text.isNotBlank()

        /**
         * Get text blocks with high confidence (≥0.8)
         */
        fun getHighConfidenceBlocks(): List<TextBlock> {
            return blocks.filter { it.confidence >= 0.8f }
        }

        /**
         * Get all lines from all blocks
         */
        fun getAllLines(): List<TextLine> {
            return blocks.flatMap { it.lines }
        }

        /**
         * Search for text pattern
         */
        fun contains(query: String, ignoreCase: Boolean = true): Boolean {
            return text.contains(query, ignoreCase)
        }
    }

    /**
     * Text block (paragraph)
     *
     * @property text Block text content
     * @property lines List of text lines in this block
     * @property boundingBox Bounding rectangle
     * @property confidence Confidence score (0.0 - 1.0)
     * @property recognizedLanguage Language code
     */
    data class TextBlock(
        val text: String,
        val lines: List<TextLine>,
        val boundingBox: Rect?,
        val confidence: Float,
        val recognizedLanguage: String?
    )

    /**
     * Text line
     *
     * @property text Line text content
     * @property elements List of text elements (words/symbols)
     * @property boundingBox Bounding rectangle
     * @property confidence Confidence score (0.0 - 1.0)
     * @property recognizedLanguage Language code
     */
    data class TextLine(
        val text: String,
        val elements: List<TextElement>,
        val boundingBox: Rect?,
        val confidence: Float,
        val recognizedLanguage: String?
    )

    /**
     * Text element (word/symbol)
     *
     * @property text Element text content
     * @property boundingBox Bounding rectangle
     * @property confidence Confidence score (0.0 - 1.0)
     */
    data class TextElement(
        val text: String,
        val boundingBox: Rect?,
        val confidence: Float
    )

    /**
     * Recognize text from image URI
     *
     * @param contentResolver Content resolver for URI access
     * @param uri Image URI
     * @return Recognition result with extracted text
     */
    suspend fun recognizeText(
        contentResolver: ContentResolver,
        uri: String
    ): RecognitionResult = withContext(Dispatchers.IO) {
        try {
            // Load and prepare image
            val bitmap = loadAndScaleImage(contentResolver, uri)
            if (bitmap == null) {
                Timber.e("Failed to load image: $uri")
                return@withContext RecognitionResult(
                    text = "",
                    blocks = emptyList(),
                    confidence = 0.0f,
                    language = null
                )
            }

            // Recognize text
            val result = recognizeTextFromBitmap(bitmap)

            // Clean up bitmap
            if (!bitmap.isRecycled) {
                bitmap.recycle()
            }

            result
        } catch (e: Exception) {
            Timber.e(e, "Error recognizing text from $uri")
            RecognitionResult(
                text = "",
                blocks = emptyList(),
                confidence = 0.0f,
                language = null
            )
        }
    }

    /**
     * Recognize text from bitmap
     *
     * @param bitmap Source bitmap
     * @return Recognition result
     */
    private suspend fun recognizeTextFromBitmap(
        bitmap: Bitmap
    ): RecognitionResult = suspendCancellableCoroutine { continuation ->
        try {
            // Create ML Kit input image
            val inputImage = InputImage.fromBitmap(bitmap, 0)

            // Run text recognition
            recognizer.process(inputImage)
                .addOnSuccessListener { visionText ->
                    // Extract text blocks
                    val blocks = visionText.textBlocks.map { block ->
                        TextBlock(
                            text = block.text,
                            lines = block.lines.map { line ->
                                TextLine(
                                    text = line.text,
                                    elements = line.elements.map { element ->
                                        TextElement(
                                            text = element.text,
                                            boundingBox = element.boundingBox,
                                            confidence = 1.0f // ML Kit removed confidence in newer versions
                                        )
                                    },
                                    boundingBox = line.boundingBox,
                                    confidence = 1.0f, // ML Kit removed confidence in newer versions
                                    recognizedLanguage = line.recognizedLanguage
                                )
                            },
                            boundingBox = block.boundingBox,
                            confidence = 1.0f, // ML Kit removed confidence in newer versions
                            recognizedLanguage = block.recognizedLanguage
                        )
                    }

                    // Calculate overall confidence
                    val avgConfidence = if (blocks.isNotEmpty()) {
                        blocks.map { it.confidence }.average().toFloat()
                    } else {
                        0.0f
                    }

                    // Detect language (use most common language from blocks)
                    val language = blocks
                        .mapNotNull { it.recognizedLanguage }
                        .groupingBy { it }
                        .eachCount()
                        .maxByOrNull { it.value }
                        ?.key

                    val result = RecognitionResult(
                        text = visionText.text,
                        blocks = blocks,
                        confidence = avgConfidence,
                        language = language
                    )

                    Timber.d("Recognized ${blocks.size} blocks, ${result.text.length} characters")
                    continuation.resume(result)
                }
                .addOnFailureListener { e ->
                    Timber.e(e, "Text recognition failed")
                    continuation.resume(
                        RecognitionResult(
                            text = "",
                            blocks = emptyList(),
                            confidence = 0.0f,
                            language = null
                        )
                    )
                }
        } catch (e: Exception) {
            Timber.e(e, "Error in recognizeTextFromBitmap")
            continuation.resume(
                RecognitionResult(
                    text = "",
                    blocks = emptyList(),
                    confidence = 0.0f,
                    language = null
                )
            )
        }
    }

    /**
     * Load and scale image for processing
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
                inPreferredConfig = Bitmap.Config.ARGB_8888 // Higher quality for OCR
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
     * Batch recognize text from multiple images
     *
     * @param contentResolver Content resolver
     * @param uris List of image URIs
     * @return Map of URI to recognition result
     */
    suspend fun batchRecognize(
        contentResolver: ContentResolver,
        uris: List<String>
    ): Map<String, RecognitionResult> = withContext(Dispatchers.IO) {
        uris.associate { uri ->
            uri to recognizeText(contentResolver, uri)
        }
    }

    /**
     * Extract structured data from text
     *
     * Common patterns for emails, phone numbers, URLs, dates, etc.
     *
     * @param text Source text
     * @return Map of data type to extracted values
     */
    fun extractStructuredData(text: String): Map<String, List<String>> {
        val result = mutableMapOf<String, MutableList<String>>()

        // Email pattern
        val emailPattern = Regex("[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}")
        emailPattern.findAll(text).forEach {
            result.getOrPut("email") { mutableListOf() }.add(it.value)
        }

        // Phone number pattern (simple)
        val phonePattern = Regex("\\+?\\d[\\d\\s-]{7,}\\d")
        phonePattern.findAll(text).forEach {
            result.getOrPut("phone") { mutableListOf() }.add(it.value)
        }

        // URL pattern
        val urlPattern = Regex("https?://[\\w\\-._~:/?#\\[\\]@!$&'()*+,;=]+")
        urlPattern.findAll(text).forEach {
            result.getOrPut("url") { mutableListOf() }.add(it.value)
        }

        // Date pattern (YYYY-MM-DD)
        val datePattern = Regex("\\d{4}-\\d{2}-\\d{2}")
        datePattern.findAll(text).forEach {
            result.getOrPut("date") { mutableListOf() }.add(it.value)
        }

        return result
    }

    /**
     * Release resources
     */
    fun close() {
        try {
            recognizer.close()
        } catch (e: Exception) {
            Timber.e(e, "Error closing recognizer")
        }
    }
}
