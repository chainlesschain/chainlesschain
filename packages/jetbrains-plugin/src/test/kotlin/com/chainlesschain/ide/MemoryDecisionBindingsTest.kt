package com.chainlesschain.ide

import com.chainlesschain.agent.protocol.generated.MemoryCorrectionRequest
import com.chainlesschain.agent.protocol.generated.MemoryDecisionRequest
import com.chainlesschain.agent.protocol.generated.MemoryLifecycleDecisionRequest
import java.lang.reflect.Modifier
import org.junit.jupiter.api.Test

class MemoryDecisionBindingsTest {
    // Kotlin bindings are data classes consumed by host JSON adapters. Inspect
    // their actual serialized field names, not a manually reconstructed DTO.
    private fun wire(value: Any): Map<String, Any?> {
        val fields = linkedMapOf<String, Any?>()
        value.javaClass.declaredFields.filter { !Modifier.isStatic(it.modifiers) }.forEach {
            it.isAccessible = true
            val fieldValue = it.get(value)
            if (fieldValue != null) fields[it.name] = fieldValue
        }
        return MiniJson.parseObject(MiniJson.stringify(fields))
    }

    @Test
    fun legacyConstructorAndLifecycleAliasPreserveEncoding() {
        val legacy = MemoryDecisionRequest(
            "memory-1", "reinforce", 3L, 0.1, 0.8, null, listOf("tag"),
            "summary", null, "reason", "user-1", "2026-11-09T00:00:00Z"
        )
        check(legacy.javaClass.simpleName == "MemoryDecisionRequest")
        val (id, type, revision) = legacy
        check(id == "memory-1" && type == "reinforce" && revision == 3L)
        check(wire(legacy) == mapOf(
            "memoryId" to "memory-1", "type" to "reinforce", "expectedRevision" to 3L,
            "confidenceDelta" to 0.1, "importance" to 0.8, "tags" to listOf("tag"),
            "summary" to "summary", "reason" to "reason", "authority" to "user-1",
            "at" to "2026-11-09T00:00:00Z"
        ))
        val minimal = MemoryDecisionRequest(memoryId = "memory-1", type = "archive", expectedRevision = 4L)
        val lifecycle: MemoryLifecycleDecisionRequest = minimal.copy(expectedRevision = 5L)
        check(wire(lifecycle) == mapOf("memoryId" to "memory-1", "type" to "archive", "expectedRevision" to 5L))
    }

    @Test
    fun typedCorrectionEncodesItsOwnWireFields() {
        val correction = MemoryCorrectionRequest(
            memoryId = "memory-1", type = "correct", expectedRevision = 3L,
            content = "replacement", reason = "reason"
        )
        check(wire(correction) == mapOf(
            "memoryId" to "memory-1", "type" to "correct", "expectedRevision" to 3L,
            "content" to "replacement", "reason" to "reason"
        ))
    }
}

// Direct compiler diagnostic entry; the same two methods run under Gradle/JUnit.
fun main() {
    val tests = MemoryDecisionBindingsTest()
    tests.legacyConstructorAndLifecycleAliasPreserveEncoding()
    tests.typedCorrectionEncodesItsOwnWireFields()
    println("Kotlin memory decision constructor/encoding: 2 tests passed")
}
