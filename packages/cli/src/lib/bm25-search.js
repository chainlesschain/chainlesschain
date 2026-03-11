/**
 * BM25 search engine for CLI
 *
 * Implements Okapi BM25 ranking algorithm for keyword-based search.
 * Lightweight port of desktop-app-vue/src/main/rag/bm25-search.js
 * No external dependencies — uses simple tokenization.
 */

/**
 * Simple tokenizer for text
 * Handles both Chinese and English text
 */
function tokenize(text, language = "auto") {
  if (!text || typeof text !== "string") return [];

  const normalized = text.toLowerCase().trim();

  // Detect language
  const hasChinese = /[\u4e00-\u9fff]/.test(normalized);
  const lang = language === "auto" ? (hasChinese ? "zh" : "en") : language;

  if (lang === "zh") {
    // Chinese: character-level + word-level bigrams
    const chars = normalized.match(/[\u4e00-\u9fff]/g) || [];
    const words = normalized.match(/[a-z0-9]+/g) || [];
    const bigrams = [];
    for (let i = 0; i < chars.length - 1; i++) {
      bigrams.push(chars[i] + chars[i + 1]);
    }
    return [...chars, ...bigrams, ...words];
  }

  // English: word tokenization with stop word removal
  const STOP_WORDS = new Set([
    "a",
    "an",
    "the",
    "is",
    "are",
    "was",
    "were",
    "be",
    "been",
    "being",
    "have",
    "has",
    "had",
    "do",
    "does",
    "did",
    "will",
    "would",
    "could",
    "should",
    "may",
    "might",
    "shall",
    "can",
    "to",
    "of",
    "in",
    "for",
    "on",
    "with",
    "at",
    "by",
    "from",
    "as",
    "into",
    "through",
    "during",
    "before",
    "after",
    "above",
    "below",
    "between",
    "but",
    "and",
    "or",
    "not",
    "no",
    "nor",
    "so",
    "if",
    "then",
    "than",
    "too",
    "very",
    "just",
    "about",
    "up",
    "out",
    "it",
    "its",
    "this",
    "that",
    "these",
    "those",
    "i",
    "me",
    "my",
    "we",
    "our",
    "you",
    "your",
    "he",
    "him",
    "his",
    "she",
    "her",
    "they",
    "them",
    "their",
    "what",
    "which",
  ]);

  return normalized
    .split(/[^a-z0-9\u4e00-\u9fff]+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
}

/**
 * BM25 Search Engine
 */
export class BM25Search {
  /**
   * @param {object} options
   * @param {number} [options.k1=1.5] - Term frequency saturation parameter
   * @param {number} [options.b=0.75] - Length normalization parameter
   * @param {string} [options.language="auto"] - Language for tokenization
   */
  constructor(options = {}) {
    this.k1 = options.k1 || 1.5;
    this.b = options.b || 0.75;
    this.language = options.language || "auto";

    // Index state
    this.documents = []; // Array of { id, tokens, originalDoc }
    this.df = new Map(); // document frequency per term
    this.avgDl = 0; // average document length
    this.totalDocs = 0;
  }

  /**
   * Index a batch of documents
   * @param {Array<{id: string, title?: string, content?: string}>} documents
   */
  indexDocuments(documents) {
    this.documents = [];
    this.df = new Map();

    for (const doc of documents) {
      const text = [doc.title || "", doc.content || ""].join(" ");
      const tokens = tokenize(text, this.language);

      this.documents.push({
        id: doc.id,
        tokens,
        originalDoc: doc,
      });

      // Count document frequency
      const seen = new Set();
      for (const token of tokens) {
        if (!seen.has(token)) {
          seen.add(token);
          this.df.set(token, (this.df.get(token) || 0) + 1);
        }
      }
    }

    this.totalDocs = this.documents.length;
    this.avgDl =
      this.totalDocs > 0
        ? this.documents.reduce((sum, d) => sum + d.tokens.length, 0) /
          this.totalDocs
        : 0;
  }

  /**
   * Add a single document to the index
   */
  addDocument(doc) {
    const text = [doc.title || "", doc.content || ""].join(" ");
    const tokens = tokenize(text, this.language);

    this.documents.push({
      id: doc.id,
      tokens,
      originalDoc: doc,
    });

    const seen = new Set();
    for (const token of tokens) {
      if (!seen.has(token)) {
        seen.add(token);
        this.df.set(token, (this.df.get(token) || 0) + 1);
      }
    }

    this.totalDocs = this.documents.length;
    this.avgDl =
      this.documents.reduce((sum, d) => sum + d.tokens.length, 0) /
      this.totalDocs;
  }

  /**
   * Remove a document from the index
   */
  removeDocument(docId) {
    const idx = this.documents.findIndex((d) => d.id === docId);
    if (idx === -1) return false;

    const doc = this.documents[idx];
    const seen = new Set();
    for (const token of doc.tokens) {
      if (!seen.has(token)) {
        seen.add(token);
        const count = this.df.get(token) || 0;
        if (count <= 1) {
          this.df.delete(token);
        } else {
          this.df.set(token, count - 1);
        }
      }
    }

    this.documents.splice(idx, 1);
    this.totalDocs = this.documents.length;
    this.avgDl =
      this.totalDocs > 0
        ? this.documents.reduce((sum, d) => sum + d.tokens.length, 0) /
          this.totalDocs
        : 0;

    return true;
  }

  /**
   * Search for documents matching a query
   * @param {string} query
   * @param {object} [options]
   * @param {number} [options.topK=10]
   * @param {number} [options.threshold=0]
   * @returns {Array<{id: string, score: number, doc: object}>}
   */
  search(query, options = {}) {
    const topK = options.topK || 10;
    const threshold = options.threshold || 0;

    if (this.totalDocs === 0) return [];

    const queryTokens = tokenize(query, this.language);
    if (queryTokens.length === 0) return [];

    const scores = [];

    for (let i = 0; i < this.documents.length; i++) {
      const score = this._calculateBM25(queryTokens, i);
      if (score > threshold) {
        scores.push({
          id: this.documents[i].id,
          score,
          doc: this.documents[i].originalDoc,
        });
      }
    }

    scores.sort((a, b) => b.score - a.score);
    return scores.slice(0, topK);
  }

  /**
   * Calculate BM25 score for a document
   */
  _calculateBM25(queryTokens, docIdx) {
    const doc = this.documents[docIdx];
    const dl = doc.tokens.length;
    let score = 0;

    // Build term frequency map for this document
    const tf = new Map();
    for (const token of doc.tokens) {
      tf.set(token, (tf.get(token) || 0) + 1);
    }

    for (const term of queryTokens) {
      const termFreq = tf.get(term) || 0;
      if (termFreq === 0) continue;

      const docFreq = this.df.get(term) || 0;
      if (docFreq === 0) continue;

      // IDF component
      const idf = Math.log(
        (this.totalDocs - docFreq + 0.5) / (docFreq + 0.5) + 1,
      );

      // TF component with length normalization
      const avgDl = this.avgDl || 1;
      const tfNorm =
        (termFreq * (this.k1 + 1)) /
        (termFreq + this.k1 * (1 - this.b + this.b * (dl / avgDl)));

      score += idf * tfNorm;
    }

    return score;
  }

  /**
   * Get index statistics
   */
  getStats() {
    return {
      totalDocuments: this.totalDocs,
      uniqueTerms: this.df.size,
      avgDocumentLength: Math.round(this.avgDl),
    };
  }
}
