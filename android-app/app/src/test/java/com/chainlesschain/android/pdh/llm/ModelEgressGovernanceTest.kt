package com.chainlesschain.android.pdh.llm

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class ModelEgressGovernanceTest {

    @Test
    fun `legacy local inference fails with the terminal ingress code`() {
        val error = assertFailsWith<ModelEgressGovernanceException> {
            rejectLegacyModelEgress()
        }

        assertEquals(MODEL_EGRESS_INGRESS_FAILED, error.code)
    }
}
