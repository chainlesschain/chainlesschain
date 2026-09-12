package com.chainlesschain.android.feature.filebrowser.ml

import android.content.ContentResolver
import com.chainlesschain.android.core.database.entity.FileCategory
import com.chainlesschain.android.feature.ai.data.llm.MODEL_EGRESS_INGRESS_FAILED
import com.chainlesschain.android.feature.ai.data.llm.ModelEgressGovernanceException
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
}
