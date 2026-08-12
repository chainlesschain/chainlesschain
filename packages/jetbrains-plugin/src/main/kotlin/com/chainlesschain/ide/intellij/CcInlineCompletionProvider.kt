package com.chainlesschain.ide.intellij

import com.chainlesschain.ide.CcCompletion
import com.chainlesschain.ide.CcAutomaticCompletionPolicy
import com.intellij.codeInsight.inline.completion.InlineCompletionEvent
import com.intellij.codeInsight.inline.completion.InlineCompletionProvider
import com.intellij.codeInsight.inline.completion.InlineCompletionProviderID
import com.intellij.codeInsight.inline.completion.InlineCompletionRequest
import com.intellij.codeInsight.inline.completion.elements.InlineCompletionGrayTextElement
import com.intellij.codeInsight.inline.completion.suggestion.InlineCompletionSingleSuggestion
import com.intellij.codeInsight.inline.completion.suggestion.InlineCompletionSuggestion
import com.intellij.openapi.application.readAction
import com.intellij.openapi.diagnostic.Logger
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.runInterruptible
import java.io.File

/**
 * Inline code-completion (ghost-text) provider — the JetBrains counterpart of the
 * VS Code InlineCompletionItemProvider. This is the ONLY Kotlin in the plugin: the
 * platform's inline-completion API is a Kotlin `suspend`/`Flow`/value-class surface
 * that can't be implemented from Java. All real logic (context slicing, spawning
 * `cc complete --json`, parsing) lives in the pure Java [CcCompletion] so it stays
 * JUnit-testable; this class is a thin adapter.
 *
 * Manual [InlineCompletionEvent.DirectCall] remains available. Document changes
 * are accepted only when the persisted governed-auto setting is explicitly on;
 * its independent budget, debounce, dedupe/cache, SLO and quality policy prevent
 * uncontrolled background model traffic. Everything fails quiet: a backend
 * hiccup yields an empty flow (no ghost text), never an editor error.
 */
class CcInlineCompletionProvider : InlineCompletionProvider {

    override val id: InlineCompletionProviderID =
        InlineCompletionProviderID("ChainlessChain.cc")

    override fun isEnabled(event: InlineCompletionEvent): Boolean =
        event is InlineCompletionEvent.DirectCall ||
            (event is InlineCompletionEvent.DocumentChange &&
                CcSettings.getInstance().isAutomaticCompletionEnabled)

    override suspend fun getSuggestion(request: InlineCompletionRequest): InlineCompletionSuggestion {
        // Read document text / caret / language under a read action (thread-safe),
        // then do the blocking spawn off the EDT on the IO dispatcher. The suspend
        // `readAction {}` is the coroutine-native, non-deprecated form (the
        // ReadAction.compute(ThrowableComputable) overload is deprecated for removal).
        val ctx = readAction {
            val text = request.document.immutableCharSequence.toString()
            val offset = request.startOffset.coerceIn(0, text.length)
            val language = request.file?.language?.id ?: ""
            val cwd = request.editor.project?.basePath
                ?: request.file?.virtualFile?.parent?.path
            Ctx(text, offset, language, cwd)
        }

        val prefix = ctx.text.substring(maxOf(0, ctx.offset - MAX_CONTEXT), ctx.offset)
        val suffix = ctx.text.substring(ctx.offset, minOf(ctx.text.length, ctx.offset + MAX_CONTEXT))
        val automatic = request.event is InlineCompletionEvent.DocumentChange

        if (automatic) {
            return automaticSuggestion(prefix, suffix, ctx)
        }

        // runInterruptible (not plain withContext): when the platform cancels
        // this suggestion (user typed on / dismissed), the coroutine
        // cancellation interrupts the blocking waitFor inside fetch — fetch's
        // InterruptedException path + finally destroyForcibly then KILL the
        // in-flight cc child instead of letting it run the full LLM call for
        // a result nobody will render. Mirrors the VS Code twin's
        // token.onCancellationRequested → child.kill wiring.
        val completion = runInterruptible(Dispatchers.IO) {
            CcCompletion.fetch(prefix, suffix, ctx.language, ctx.cwd?.let(::File), TIMEOUT_MS)
        }

        // The non-deprecated single-variant factory (the abstract
        // InlineCompletionSuggestion is deprecated for removal). An empty flow
        // means "no ghost text" — the fail-quiet path.
        return suggestion(completion)
    }

    private suspend fun automaticSuggestion(
        prefix: String,
        suffix: String,
        ctx: Ctx,
    ): InlineCompletionSuggestion {
        val options = CcSettings.getInstance().automaticCompletionOptions
        if (!CcAutomaticCompletionPolicy.isContextEligible(prefix)) return suggestion("")
        val key = CcAutomaticCompletionPolicy.key(prefix, suffix, ctx.language)
        val cached = AUTO_POLICY.cached(key, options)
        if (cached.isNotEmpty()) return suggestion(cached)

        var inFlight = false
        // Published latency is end-to-end from the settled edit, including
        // debounce, not only the backend call after it.
        val started = System.nanoTime()
        try {
            // Coroutine delay is cancellable: continued typing prevents both the
            // budget reservation and the cc child process from starting.
            delay(options.debounceMs.toLong())
            val postDebounceCached = AUTO_POLICY.cached(key, options)
            if (postDebounceCached.isNotEmpty()) return suggestion(postDebounceCached)
            if (!AUTO_POLICY.begin(key)) {
                LOG.debug("auto completion duplicate suppressed: ${AUTO_POLICY.metrics()}")
                return suggestion("")
            }
            inFlight = true
            if (!AUTO_POLICY.reserve(prefix.length + suffix.length, options)) {
                LOG.debug("auto completion budget rejected: ${AUTO_POLICY.metrics()}")
                return suggestion("")
            }
            val completion = runInterruptible(Dispatchers.IO) {
                CcCompletion.fetch(
                    prefix,
                    suffix,
                    ctx.language,
                    ctx.cwd?.let(::File),
                    maxOf(100L, CcAutomaticCompletionPolicy.SLO_P95_MS - options.debounceMs),
                )
            }
            val latencyMs = (System.nanoTime() - started) / 1_000_000
            if (!AUTO_POLICY.recordLatency(latencyMs)) {
                LOG.debug("auto completion SLO rejected: ${AUTO_POLICY.metrics()}")
                return suggestion("")
            }
            if (!CcAutomaticCompletionPolicy.isCompletionUsable(completion, suffix, options)) {
                AUTO_POLICY.recordQualityReject()
                LOG.debug("auto completion quality rejected: ${AUTO_POLICY.metrics()}")
                return suggestion("")
            }
            AUTO_POLICY.store(key, completion, options)
            LOG.debug("auto completion metrics: ${AUTO_POLICY.metrics()}")
            return suggestion(completion)
        } catch (cancelled: CancellationException) {
            AUTO_POLICY.recordCancellation()
            throw cancelled
        } catch (error: Exception) {
            LOG.debug("auto completion failed quiet", error)
            return suggestion("")
        } finally {
            if (inFlight) AUTO_POLICY.end(key)
        }
    }

    private fun suggestion(completion: String): InlineCompletionSuggestion =
        InlineCompletionSingleSuggestion.build {
            if (completion.isNotEmpty()) {
                emit(InlineCompletionGrayTextElement(completion))
            }
        }

    private data class Ctx(
        val text: String,
        val offset: Int,
        val language: String,
        val cwd: String?,
    )

    private companion object {
        val AUTO_POLICY = CcAutomaticCompletionPolicy()
        val LOG = Logger.getInstance(CcInlineCompletionProvider::class.java)
        /** Per-side context budget — mirrors the VS Code provider (CONTEXT_CHARS). */
        const val MAX_CONTEXT = 4000

        /** Manual trigger, so a slow chat model is acceptable; matches VS Code. */
        const val TIMEOUT_MS = 12_000L

    }
}
