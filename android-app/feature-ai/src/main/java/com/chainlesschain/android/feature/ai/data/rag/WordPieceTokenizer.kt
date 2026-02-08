package com.chainlesschain.android.feature.ai.data.rag

import java.io.File

/**
 * WordPiece tokenizer for BERT-based models
 *
 * Tokenizes text into subword tokens using a vocabulary file
 */
class WordPieceTokenizer(vocabFile: File) {

    companion object {
        private const val UNK_TOKEN = "[UNK]"
        private const val CLS_TOKEN = "[CLS]"
        private const val SEP_TOKEN = "[SEP]"
        private const val PAD_TOKEN = "[PAD]"
        private const val MAX_WORD_LENGTH = 200
        const val MAX_SEQ_LENGTH = 128
    }

    private val vocab: Map<String, Int>
    private val unkId: Int

    init {
        vocab = vocabFile.readLines()
            .withIndex()
            .associate { (index, token) -> token.trim() to index }
        unkId = vocab[UNK_TOKEN] ?: 0
    }

    /**
     * Tokenize text and return input IDs and attention mask
     */
    fun tokenize(text: String): TokenizerOutput {
        val tokens = mutableListOf(CLS_TOKEN)
        val words = basicTokenize(text)

        for (word in words) {
            val subTokens = wordPieceTokenize(word)
            tokens.addAll(subTokens)
        }

        tokens.add(SEP_TOKEN)

        // Truncate to max length
        val truncated = if (tokens.size > MAX_SEQ_LENGTH) {
            tokens.subList(0, MAX_SEQ_LENGTH - 1) + SEP_TOKEN
        } else {
            tokens
        }

        val inputIds = LongArray(MAX_SEQ_LENGTH)
        val attentionMask = LongArray(MAX_SEQ_LENGTH)

        for (i in truncated.indices) {
            inputIds[i] = (vocab[truncated[i]] ?: unkId).toLong()
            attentionMask[i] = 1L
        }

        // Padding is already 0 (default for LongArray)

        return TokenizerOutput(
            inputIds = inputIds,
            attentionMask = attentionMask,
            tokenCount = truncated.size
        )
    }

    /**
     * Basic tokenization: lowercase, split on whitespace and punctuation
     */
    private fun basicTokenize(text: String): List<String> {
        val cleaned = text.lowercase().trim()
        val words = mutableListOf<String>()
        val current = StringBuilder()

        for (char in cleaned) {
            when {
                char.isWhitespace() -> {
                    if (current.isNotEmpty()) {
                        words.add(current.toString())
                        current.clear()
                    }
                }
                isPunctuation(char) -> {
                    if (current.isNotEmpty()) {
                        words.add(current.toString())
                        current.clear()
                    }
                    words.add(char.toString())
                }
                else -> current.append(char)
            }
        }

        if (current.isNotEmpty()) {
            words.add(current.toString())
        }

        return words
    }

    /**
     * WordPiece tokenization for a single word
     */
    private fun wordPieceTokenize(word: String): List<String> {
        if (word.length > MAX_WORD_LENGTH) {
            return listOf(UNK_TOKEN)
        }

        val tokens = mutableListOf<String>()
        var start = 0

        while (start < word.length) {
            var end = word.length
            var found = false

            while (start < end) {
                val substr = if (start > 0) "##${word.substring(start, end)}" else word.substring(start, end)
                if (vocab.containsKey(substr)) {
                    tokens.add(substr)
                    found = true
                    break
                }
                end--
            }

            if (!found) {
                tokens.add(UNK_TOKEN)
                break
            }

            start = end
        }

        return tokens
    }

    private fun isPunctuation(char: Char): Boolean {
        val code = char.code
        return (code in 33..47) || (code in 58..64) || (code in 91..96) || (code in 123..126)
    }
}

/**
 * Output from the tokenizer
 */
data class TokenizerOutput(
    val inputIds: LongArray,
    val attentionMask: LongArray,
    val tokenCount: Int
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is TokenizerOutput) return false
        return inputIds.contentEquals(other.inputIds) &&
            attentionMask.contentEquals(other.attentionMask) &&
            tokenCount == other.tokenCount
    }

    override fun hashCode(): Int {
        var result = inputIds.contentHashCode()
        result = 31 * result + attentionMask.contentHashCode()
        result = 31 * result + tokenCount
        return result
    }
}
