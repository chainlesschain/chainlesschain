package com.chainlesschain.android.feature.ai.data.llm

import com.chainlesschain.android.feature.ai.data.config.LLMConfigManager
import com.chainlesschain.android.feature.ai.data.rag.OnnxModelManager
import com.chainlesschain.android.feature.ai.data.rag.SentenceTransformerEmbedder
import com.chainlesschain.android.feature.ai.data.voice.VolcengineAsrClient
import io.mockk.mockk
import io.mockk.verify
import kotlinx.coroutines.test.runTest
import org.junit.Test
import java.io.File
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.fail

class ModelEgressGovernanceTest {

    @Test
    fun `legacy Android model egress fails with the terminal ingress code`() {
        val error = assertFailsWith<ModelEgressGovernanceException> {
            rejectLegacyModelEgress()
        }

        assertEquals(MODEL_EGRESS_INGRESS_FAILED, error.code)
    }

    @Test
    fun `SentenceTransformer rejects before probing or downloading the ONNX model`() = runTest {
        val modelManager = mockk<OnnxModelManager>()
        val embedder = SentenceTransformerEmbedder(modelManager)

        val error = try {
            embedder.embed("private embedding input")
            fail("Expected model egress denial")
        } catch (error: ModelEgressGovernanceException) {
            error
        }

        assertEquals(MODEL_EGRESS_INGRESS_FAILED, error.code)
        verify(exactly = 0) { modelManager.isModelAvailable() }
    }

    @Test
    fun `Volcengine ASR rejects before config lookup or audio acquisition`() = runTest {
        val configManager = mockk<LLMConfigManager>()
        val client = VolcengineAsrClient(configManager)

        val error = try {
            client.transcribe(File("private-audio.wav"))
            fail("Expected model egress denial")
        } catch (error: ModelEgressGovernanceException) {
            error
        }

        assertEquals(MODEL_EGRESS_INGRESS_FAILED, error.code)
        verify(exactly = 0) { configManager.load() }
    }
}
