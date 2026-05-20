package com.chainlesschain.android.remote.registry

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject

/**
 * Minimal RFC 8785 (JSON Canonicalization Scheme) for SkillMetadata signing input.
 *
 * Scope:
 *  - Sorts JsonObject keys lexicographically (UTF-16 code-unit order, matches
 *    kotlin String.compareTo and RFC 8785 §3.2.3).
 *  - Preserves JsonArray order (arrays are sequences, not sorted).
 *  - Leaves JsonPrimitive serialization to kotlinx.serialization (default
 *    encoding is RFC 8259 compatible for the value types SkillMetadata uses:
 *    String, Int, Boolean, null).
 *
 * Limitations vs full RFC 8785:
 *  - Numbers: we do NOT implement I-JSON 7.1 number canonicalization. SkillMetadata
 *    today has only Int / Boolean / String / nested objects/arrays — no Double /
 *    Float. If a future field introduces a non-integer number, this must be
 *    revisited (and a test added that asserts cross-platform round-trip).
 *  - Strings: kotlinx.serialization escapes per RFC 8259, which matches JCS for
 *    our character set (BMP printable + Chinese display names already handled).
 *
 * Used by [Ed25519ManifestVerifier] to compute the signing input for skill
 * manifest signatures (#21 A.3 AI-5 pre-stage for marketplace M0).
 */
internal object JcsCanonicalizer {
    fun canonicalize(element: JsonElement): JsonElement = when (element) {
        is JsonObject -> buildJsonObject {
            for (key in element.keys.sorted()) {
                put(key, canonicalize(element.getValue(key)))
            }
        }
        is JsonArray -> buildJsonArray {
            for (value in element) add(canonicalize(value))
        }
        is JsonPrimitive -> element
    }
}
