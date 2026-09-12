package com.chainlesschain.android.feature.filebrowser.ml

import android.content.ContentResolver
import com.chainlesschain.android.core.database.entity.FileCategory
import com.chainlesschain.android.feature.ai.data.llm.MODEL_EGRESS_INGRESS_FAILED
import com.chainlesschain.android.feature.ai.data.llm.ModelEgressGovernanceException
import com.google.mlkit.vision.label.ImageLabeler
import com.google.mlkit.vision.text.TextRecognizer as MlKitTextRecognizer
import io.mockk.Called
import io.mockk.mockk
import io.mockk.verify
import kotlinx.coroutines.runBlocking
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class ModelEgressGovernanceTest {

    @Test
    fun `text recognition rejects before it reads a caller image`() = runBlocking {
        val contentResolver = mockk<ContentResolver>()

        val error = assertFailsWith<ModelEgressGovernanceException> {
            TextRecognizer().recognizeText(contentResolver, "content://private-image")
        }

        assertEquals(MODEL_EGRESS_INGRESS_FAILED, error.code)
        verify(exactly = 0) { contentResolver.openInputStream(any()) }
    }

    @Test
    fun `file classification rejects before it reads a caller file`() = runBlocking {
        val contentResolver = mockk<ContentResolver>()

        val error = assertFailsWith<ModelEgressGovernanceException> {
            FileClassifier().classifyFile(
                contentResolver,
                "content://private-image",
                FileCategory.IMAGE,
                "image/png",
            )
        }

        assertEquals(MODEL_EGRESS_INGRESS_FAILED, error.code)
        verify(exactly = 0) { contentResolver.openInputStream(any()) }
    }

    @Test
    fun `denied OCR and cleanup never construct a model client`() = runBlocking {
        val contentResolver = mockk<ContentResolver>()
        val createClient = mockk<() -> MlKitTextRecognizer>()
        val recognizer = TextRecognizer(createClient)

        val error = assertFailsWith<ModelEgressGovernanceException> {
            recognizer.recognizeText(contentResolver, "content://private-image")
        }
        recognizer.close()

        assertEquals(MODEL_EGRESS_INGRESS_FAILED, error.code)
        verify { contentResolver wasNot Called }
        verify(exactly = 0) { createClient() }
    }

    @Test
    fun `denied classification and cleanup never construct a model client`() = runBlocking {
        val contentResolver = mockk<ContentResolver>()
        val createClient = mockk<() -> ImageLabeler>()
        val classifier = FileClassifier(createClient)

        val error = assertFailsWith<ModelEgressGovernanceException> {
            classifier.classifyFile(
                contentResolver,
                "content://private-image",
                FileCategory.IMAGE,
                "image/png",
            )
        }
        classifier.close()

        assertEquals(MODEL_EGRESS_INGRESS_FAILED, error.code)
        verify { contentResolver wasNot Called }
        verify(exactly = 0) { createClient() }
    }

    @Test
    fun `batch OCR rejects without enumerating caller URIs or constructing a model`() = runBlocking {
        val contentResolver = mockk<ContentResolver>()
        val uris = mockk<List<String>>()
        val createClient = mockk<() -> MlKitTextRecognizer>()
        val recognizer = TextRecognizer(createClient)

        val error = assertFailsWith<ModelEgressGovernanceException> {
            recognizer.batchRecognize(contentResolver, uris)
        }
        recognizer.close()

        assertEquals(MODEL_EGRESS_INGRESS_FAILED, error.code)
        verify { listOf(contentResolver, uris) wasNot Called }
        verify(exactly = 0) { createClient() }
    }

    @Test
    fun `batch classification rejects without enumerating caller files or constructing a model`() = runBlocking {
        val contentResolver = mockk<ContentResolver>()
        val files = mockk<List<Triple<String, FileCategory, String?>>>()
        val createClient = mockk<() -> ImageLabeler>()
        val classifier = FileClassifier(createClient)

        val error = assertFailsWith<ModelEgressGovernanceException> {
            classifier.batchClassify(contentResolver, files)
        }
        classifier.close()

        assertEquals(MODEL_EGRESS_INGRESS_FAILED, error.code)
        verify { listOf(contentResolver, files) wasNot Called }
        verify(exactly = 0) { createClient() }
    }

    @Test
    fun `empty batches still reject without creating a model client`() = runBlocking {
        val contentResolver = mockk<ContentResolver>()
        val createRecognizer = mockk<() -> MlKitTextRecognizer>()
        val createLabeler = mockk<() -> ImageLabeler>()

        assertFailsWith<ModelEgressGovernanceException> {
            TextRecognizer(createRecognizer).batchRecognize(contentResolver, emptyList())
        }
        assertFailsWith<ModelEgressGovernanceException> {
            FileClassifier(createLabeler).batchClassify(contentResolver, emptyList())
        }

        verify { contentResolver wasNot Called }
        verify(exactly = 0) { createRecognizer() }
        verify(exactly = 0) { createLabeler() }
    }

    @Test
    fun `closing unused services never constructs model clients`() {
        val createRecognizer = mockk<() -> MlKitTextRecognizer>()
        val createLabeler = mockk<() -> ImageLabeler>()
        val recognizer = TextRecognizer(createRecognizer)
        val classifier = FileClassifier(createLabeler)

        repeat(2) {
            recognizer.close()
            classifier.close()
        }

        verify(exactly = 0) { createRecognizer() }
        verify(exactly = 0) { createLabeler() }
    }
}
