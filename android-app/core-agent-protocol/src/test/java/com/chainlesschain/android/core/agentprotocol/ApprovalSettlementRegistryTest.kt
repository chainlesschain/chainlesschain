package com.chainlesschain.android.core.agentprotocol

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ApprovalSettlementRegistryTest {
    @Test
    fun `replays Android surface from shared HumanTask fixture`() {
        val fixture = javaClass.classLoader!!
            .getResourceAsStream("human-task-settlement-conformance.json")!!
            .bufferedReader()
            .use { Json.parseToJsonElement(it.readText()).jsonObject }
        var replayed = 0
        for (scenarioValue in fixture.getValue("scenarios").jsonArray) {
            val scenario = scenarioValue.jsonObject
            val surfaces = scenario.getValue("surfaces").jsonArray
                .map { it.jsonPrimitive.content }
            if ("android" !in surfaces) continue
            replayed += 1
            val name = scenario.getValue("name").jsonPrimitive.content
            val requestId = "approval-$name"
            val registry = ApprovalSettlementRegistry()
            assertTrue(name, registry.open(requestId))
            var sentDecisions = 0
            var interrupts = 0
            var rejectedResponses = 0
            var unresolvedDecision = false

            for (stepValue in scenario.getValue("steps").jsonArray) {
                val step = stepValue.jsonObject
                val action = step.getValue("action").jsonPrimitive.content
                val expected = step.getValue("expect").jsonObject
                    .getValue("android").jsonPrimitive.content
                when (action) {
                    "restart" -> {
                        if (unresolvedDecision) registry.resolve(requestId)
                        unresolvedDecision = false
                        registry.invalidateAll()
                        assertEquals(name, "settled", expected)
                    }
                    "cancel" -> {
                        val reserved = registry.beginInterrupt()
                        interrupts += 1
                        reserved.forEach {
                            assertTrue(
                                name,
                                registry.complete(
                                    it,
                                    ApprovalSettlementRegistry.Status.INTERRUPTING,
                                    true,
                                ),
                            )
                        }
                        assertEquals(name, "settled", expected)
                    }
                    "approve", "decline" -> {
                        val accepted = registry.beginDecision(requestId)
                        if (accepted) {
                            assertTrue(
                                name,
                                registry.complete(
                                    requestId,
                                    ApprovalSettlementRegistry.Status.RESPONDING,
                                    true,
                                ),
                            )
                            sentDecisions += 1
                            unresolvedDecision = true
                        } else {
                            rejectedResponses += 1
                        }
                        assertEquals(name, expected == "settled", accepted)
                    }
                    else -> error("unsupported Android action $action")
                }
            }
            if (unresolvedDecision) registry.resolve(requestId)
            val expected = scenario.getValue("expected").jsonObject
                .getValue("android").jsonObject
            assertEquals(name, expected.int("pending_approvals"), registry.size())
            assertEquals(name, expected.int("sent_decisions"), sentDecisions)
            assertEquals(name, expected.int("interrupts"), interrupts)
            assertEquals(name, expected.int("rejected_responses"), rejectedResponses)
        }
        assertEquals(4, replayed)
    }

    @Test
    fun `failed send rolls back and concurrent decision has one winner`() {
        val registry = ApprovalSettlementRegistry()
        assertTrue(registry.open("approval-race"))
        val winners = java.util.concurrent.atomic.AtomicInteger()
        val threads = List(64) {
            Thread {
                if (registry.beginDecision("approval-race")) winners.incrementAndGet()
            }
        }
        threads.forEach(Thread::start)
        threads.forEach(Thread::join)
        assertEquals(1, winners.get())
        assertTrue(
            registry.complete(
                "approval-race",
                ApprovalSettlementRegistry.Status.RESPONDING,
                false,
            ),
        )
        assertEquals(
            ApprovalSettlementRegistry.Status.PENDING,
            registry.status("approval-race"),
        )
        assertTrue(registry.beginDecision("approval-race"))
        assertFalse(registry.open("approval-race"))
    }

    private fun kotlinx.serialization.json.JsonObject.int(name: String): Int =
        getValue(name).jsonPrimitive.content.toInt()
}
