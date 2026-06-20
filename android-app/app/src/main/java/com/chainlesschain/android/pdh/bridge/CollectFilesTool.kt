package com.chainlesschain.android.pdh.bridge

import com.chainlesschain.android.pdh.LocalCcRunner
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject

/**
 * Phase 1, L1 (local files) — `collect_files`. Walks on-device directories
 * (documents/downloads by default, or caller-supplied `roots`) and ingests them
 * into the vault via `cc hub sync-adapter local-files --roots <dirs>` — the
 * local-files adapter reads directories directly, so there is no snapshot file
 * (unlike L2/L3 which stage a snapshot and pass --input).
 *
 * Android-bound (cc subprocess + storage access): the on-device cc bundle must
 * carry the `--roots` flag (landed CLI-side, module 101) and the app needs
 * READ_EXTERNAL_STORAGE / MANAGE_EXTERNAL_STORAGE — so full walk+ingest is
 * validated on-device after a bundle refresh. The pure root-resolution logic
 * ([resolveRoots]) is unit-tested headlessly.
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

        /** Pure: caller-supplied non-blank `roots`, else [DEFAULT_ROOTS]. */
        fun resolveRoots(args: JsonObject): List<String> {
            val given = (args["roots"] as? JsonArray)
                ?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull?.trim() }
                ?.filter { it.isNotEmpty() }
            return if (given.isNullOrEmpty()) DEFAULT_ROOTS else given
        }
    }
}
