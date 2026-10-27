// Descriptor retrieval only. Skill bodies and execution admission never enter
// this tokenizer. Keep the generic RAG tokenizer unchanged.
const segmenter = new Intl.Segmenter("zh", { granularity: "word" });
const stopWords = new Set([
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
  "please",
  "help",
  "请",
  "请问",
  "帮",
  "帮我",
  "我",
  "我要",
  "需要",
  "如何",
  "怎么",
  "一下",
  "一个",
  "的",
  "在",
  "中",
  "和",
  "并",
  "给",
  "为",
  "从",
  "将",
  "把",
  "进行",
  "可以",
  "使用",
]);

export function tokenizeSkillSearchText(text) {
  if (typeof text !== "string" || !text) return [];
  const unicodeNormalized = text.normalize("NFKC");
  const identifiers = [];
  for (const part of segmenter.segment(unicodeNormalized)) {
    if (
      part.isWordLike &&
      /_|[\p{Ll}\p{N}]\p{Lu}|\p{Lu}\p{Lu}\p{Ll}/u.test(part.segment)
    ) {
      identifiers.push(part.segment.toLowerCase());
    }
  }
  // Split acronym and camel-case boundaries before lowercasing; punctuation
  // already separates kebab/snake identifiers in the word segmenter.
  const normalized = unicodeNormalized
    .replace(/([\p{Lu}])([\p{Lu}][\p{Ll}])/gu, "$1 $2")
    .replace(/([\p{Ll}\p{N}])([\p{Lu}])/gu, "$1 $2")
    .toLowerCase();
  const tokens = [];
  for (const part of segmenter.segment(normalized)) {
    if (!part.isWordLike) continue;
    // Intl keeps snake_case as a single word, while user queries use spaces.
    for (const word of part.segment.split("_")) {
      if (word && !stopWords.has(word)) tokens.push(word);
    }
  }
  // Retain literal compound names too, so lowercase exact-name searches still
  // work after adding their natural-language word boundaries.
  return [...tokens, ...identifiers];
}
