package com.chainlesschain.android.pdh.bridge

import com.chainlesschain.android.pdh.LocalCcRunner
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject

/**
 * Phase 1, L1 (local files) — `collect_files`. Walks on-device directories
 * (documents/downloads by default, or caller-supplied `roots`) and ingests them
 * into the vault via repeated `--root <path>` arguments to
 * `cc hub sync-adapter local-files`. The local-files adapter reads directories
 * directly, so there is no snapshot file (unlike L2/L3 which stage a snapshot
 * and pass --input).
 *
 * Android-bound (cc subprocess + storage access): the on-device cc bundle may
 * carry either legacy `--roots` or repeatable `--root` (module 101).
 * [LocalCcRunner] checks its version and fails closed when the legacy form
 * cannot represent an exact path. The app also needs READ_EXTERNAL_STORAGE /
 * MANAGE_EXTERNAL_STORAGE. Root resolution and argv logic are unit-tested.
 */
class CollectFilesTool(
    private val ccRunner: LocalCcRunner,
) : PdhTool {

    override val name = "collect_files"
    override val description =
        "Collect your local files (documents/downloads by default, or the given " +
            "roots) into the vault. Pass `roots` as a list of directory paths to override."
    override val inputSchema = buildJsonObject {
        put("type", "object")
        putJsonObject("properties") {
            putJsonObject("roots") {
                put("type", "array")
                put("description", "Directories to scan (default: Documents + Download)")
                putJsonObject("items") { put("type", "string") }
            }
        }
    }

    override fun call(args: JsonObject): JsonElement = runBlocking {
        val roots = resolveRoots(args)
        when (val cc = ccRunner.syncAdapter("local-files", inputPath = "", roots = roots)) {
            is LocalCcRunner.CcResult.Ok -> buildJsonObject {
                put("status", "ok")
                put("adapter", "local-files")
                putJsonArray("roots") { roots.forEach { add(it) } }
                put("ingested", cc.report.ingested)
                put("kgTriples", cc.report.kgTriples)
                put("ragDocs", cc.report.ragDocs)
            }
            is LocalCcRunner.CcResult.Failed ->
                throw RuntimeException("local-files sync failed: ${cc.reason}")
        }
    }

    companion object {
        /** Default personal-document roots when the caller supplies none. */
        val DEFAULT_ROOTS = listOf(
            "/sdcard/Documents",
            "/sdcard/Download",
        )

        /** Pure: explicit exact `roots`, or [DEFAULT_ROOTS] only when omitted. */
        fun resolveRoots(args: JsonObject): List<String> {
            val supplied = args["roots"] ?: return DEFAULT_ROOTS
            require(supplied is JsonArray && supplied.isNotEmpty()) {
                "roots must be a non-empty array of exact directory paths"
            }
            return supplied.map { element ->
                require(element is JsonPrimitive && element.isString) {
                    "every root must be a string"
                }
                element.content.also { root ->
                    require(root.isNotEmpty()) { "root path must not be empty" }
                }
            }
        }
    }
}
