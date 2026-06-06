package com.chainlesschain.android.presentation.aistudy

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class GuardrailClassifierTest {

    private val classifier = KeywordGuardrailClassifier()

    @Test
    fun `detects self-harm signal`() {
        assertTrue(RiskCategory.SELF_HARM in classifier.classify("我不想活了"))
    }

    @Test
    fun `detects bullying signal`() {
        assertTrue(RiskCategory.BULLYING in classifier.classify("在学校被同学霸凌"))
    }

    @Test
    fun `detects stranger meetup signal`() {
        assertTrue(RiskCategory.STRANGER_MEETUP in classifier.classify("一个网友约我见面"))
    }

    @Test
    fun `normal study chat is not flagged`() {
        assertTrue(classifier.classify("帮我讲讲分数加减").isEmpty())
        assertTrue(classifier.classify("").isEmpty())
    }

    @Test
    fun `one message can hit multiple categories`() {
        val hits = classifier.classify("被欺负到不想活了")
        assertEquals(setOf(RiskCategory.SELF_HARM, RiskCategory.BULLYING), hits)
    }

    @Test
    fun `sink records findings in order`() {
        val sink = InMemoryGuardrailEventSink()
        sink.record(GuardrailFinding(RiskCategory.SELF_HARM, AiStudyTab.COMPANION, 1L))
        sink.record(GuardrailFinding(RiskCategory.BULLYING, AiStudyTab.LEARNING, 2L))
        assertEquals(2, sink.findings.value.size)
        assertEquals(RiskCategory.SELF_HARM, sink.findings.value[0].category)
    }
}
