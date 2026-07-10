package com.chainlesschain.ide.intellij

import com.chainlesschain.ide.CcCompletion
import com.intellij.codeInsight.inline.completion.InlineCompletionEvent
import com.intellij.codeInsight.inline.completion.InlineCompletionProvider
import com.intellij.codeInsight.inline.completion.InlineCompletionProviderID
import com.intellij.codeInsight.inline.completion.InlineCompletionRequest
import com.intellij.codeInsight.inline.completion.elements.InlineCompletionGrayTextElement
import com.intellij.codeInsight.inline.completion.suggestion.InlineCompletionSingleSuggestion
import com.intellij.codeInsight.inline.completion.suggestion.InlineCompletionSuggestion
import com.intellij.openapi.application.readAction
import kotlinx.coroutines.Dispatchers
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
 * Manual-only: [isEnabled] returns true solely for [InlineCompletionEvent.DirectCall]
 * (the "Trigger ChainlessChain Completion" action / keybinding), never on
 * per-keystroke typing — so there is no background LLM traffic. Everything fails
 * quiet: a backend hiccup yields an empty flow (no ghost text), never an error.
 */
class CcInlineCompletionProvider : InlineCompletionProvider {

    override val id: InlineCompletionProviderID =
        InlineCompletionProviderID("ChainlessChain.cc")

    override fun isEnabled(event: InlineCompletionEvent): Boolean =
        event is InlineCompletionEvent.DirectCall

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
        return InlineCompletionSingleSuggestion.build {
            if (completion.isNotEmpty()) {
                emit(InlineCompletionGrayTextElement(completion))
            }
        }
    }

    private data class Ctx(
        val text: String,
        val offset: Int,
        val language: String,
        val cwd: String?,
    )

    private companion object {
        /** Per-side context budget — mirrors the VS Code provider (CONTEXT_CHARS). */
        const val MAX_CONTEXT = 4000

        /** Manual trigger, so a slow chat model is acceptable; matches VS Code. */
        const val TIMEOUT_MS = 12_000L
    }
}
