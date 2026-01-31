package com.chainlesschain.android.core.ui.markdown

import io.noties.prism4j.GrammarLocator
import io.noties.prism4j.Prism4j

/**
 * Minimal GrammarLocator implementation
 * Returns null for all languages to disable syntax highlighting
 * This avoids the complexity of manually defining Prism4j grammars
 */
class GrammarLocatorImpl : GrammarLocator {

    override fun grammar(prism4j: Prism4j, language: String): Prism4j.Grammar? {
        // Return null to disable syntax highlighting for now
        // This allows the build to succeed without complex grammar definitions
        return null
    }

    override fun languages(): MutableSet<String> {
        // Return empty set since we're not providing any grammars
        return mutableSetOf()
    }
}
