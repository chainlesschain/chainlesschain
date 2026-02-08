package com.chainlesschain.android.feature.ai.data.rag

import android.content.Context
import android.util.Log
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.File
import java.net.URL
import javax.inject.Inject
import javax.inject.Singleton

/**
 * ONNX model manager for downloading, caching, and loading ML models
 */
@Singleton
class OnnxModelManager @Inject constructor(
    @ApplicationContext private val context: Context
) {
    companion object {
        private const val TAG = "OnnxModelManager"
        private const val MODELS_DIR = "onnx_models"
        private const val MODEL_FILENAME = "all-MiniLM-L6-v2.onnx"
        private const val VOCAB_FILENAME = "vocab.txt"

        // HuggingFace CDN URLs for model files
        private const val MODEL_URL =
            "https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/resolve/main/onnx/model.onnx"
        private const val VOCAB_URL =
            "https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/resolve/main/vocab.txt"
    }

    private val mutex = Mutex()
    private val modelsDir: File by lazy {
        File(context.filesDir, MODELS_DIR).also { it.mkdirs() }
    }

    val modelFile: File get() = File(modelsDir, MODEL_FILENAME)
    val vocabFile: File get() = File(modelsDir, VOCAB_FILENAME)

    /**
     * Check if model files are available locally
     */
    fun isModelAvailable(): Boolean {
        return modelFile.exists() && modelFile.length() > 0 &&
            vocabFile.exists() && vocabFile.length() > 0
    }

    /**
     * Download model files if not already cached
     *
     * @return true if model is ready to use
     */
    suspend fun ensureModelAvailable(): Boolean = mutex.withLock {
        if (isModelAvailable()) return true

        return try {
            withContext(Dispatchers.IO) {
                if (!vocabFile.exists() || vocabFile.length() == 0L) {
                    Log.i(TAG, "Downloading vocab file...")
                    downloadFile(VOCAB_URL, vocabFile)
                }

                if (!modelFile.exists() || modelFile.length() == 0L) {
                    Log.i(TAG, "Downloading ONNX model (~23MB)...")
                    downloadFile(MODEL_URL, modelFile)
                }

                Log.i(TAG, "Model files ready")
                true
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to download model files", e)
            // Clean up partial downloads
            if (modelFile.exists() && modelFile.length() == 0L) modelFile.delete()
            if (vocabFile.exists() && vocabFile.length() == 0L) vocabFile.delete()
            false
        }
    }

    private fun downloadFile(urlString: String, targetFile: File) {
        val tempFile = File(targetFile.parentFile, "${targetFile.name}.tmp")
        try {
            URL(urlString).openStream().use { input ->
                tempFile.outputStream().use { output ->
                    input.copyTo(output, bufferSize = 8192)
                }
            }
            tempFile.renameTo(targetFile)
        } finally {
            if (tempFile.exists()) tempFile.delete()
        }
    }

    /**
     * Delete cached model files
     */
    fun clearCache() {
        modelFile.delete()
        vocabFile.delete()
        Log.i(TAG, "Model cache cleared")
    }
}
