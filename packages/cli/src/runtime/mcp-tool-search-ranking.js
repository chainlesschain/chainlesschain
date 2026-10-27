// Keyword ranking only: admission, schema loading and executor generations
// remain owned by mcp-tool-search.js. No provider or embedding calls.
const segmenter = new Intl.Segmenter("zh", { granularity: "word" });
const documents = new WeakMap();
const stopWords = new Set([
  "a",
  "an",
  "the",
  "to",
  "of",
  "for",
  "in",
  "on",
  "with",
  "and",
  "please",
  "help",
  "me",
  "how",
  "can",
  "i",
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

const normalize = (text) => text.normalize("NFKC").toLowerCase();

export function compileMcpToolSearchQuery(query) {
  const scoring = new Set();
  const required = new Set();
  const chunks = normalize(query)
    .split(/[\s,，、;；!?！？。:：]+/u)
    .filter(Boolean);
  for (const chunk of chunks) {
    if (!chunk) continue;
    if (chunk.startsWith("+") && chunk.length > 1) {
      // A required name fragment is literal, never split or stop-word filtered.
      required.add(chunk.slice(1));
      scoring.add(chunk.slice(1));
    } else if (/\p{Script=Han}/u.test(chunk)) {
      for (const part of segmenter.segment(chunk)) {
        if (part.isWordLike && !stopWords.has(part.segment))
          scoring.add(part.segment);
      }
    } else if (
      (!stopWords.has(chunk) || chunks.length === 1) &&
      /[\p{L}\p{N}]/u.test(chunk)
    ) {
      scoring.add(chunk);
    }
  }
  return { scoring: [...scoring], required: [...required] };
}

function documentFor(name, entry) {
  const description = String(entry.definition?.function?.description || "");
  const cached = documents.get(entry);
  if (cached?.name === name && cached.description === description)
    return cached;
  // Preserve exact identifier fragments and expose camel-case word boundaries
  // for natural-language queries such as "read file" against readFile.
  const words = name.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  const document = {
    name,
    description,
    lowerName: normalize(name),
    nameWords: words === name ? null : normalize(words),
    lowerDescription: normalize(description),
  };
  documents.set(entry, document);
  return document;
}

function compare(left, right) {
  return (
    right.score - left.score ||
    (left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
  );
}

export function rankMcpToolSearchEntries(entries, query, maxResults) {
  const { scoring, required } = compileMcpToolSearchQuery(query);
  if (!scoring.length) return [];
  const results = [];
  for (const [name, entry] of entries) {
    if (entry.stale === true) continue;
    const doc = documentFor(name, entry);
    if (required.some((term) => !doc.lowerName.includes(term))) continue;
    let coverage = 0,
      nameHits = 0,
      descriptionHits = 0;
    for (const term of scoring) {
      const inName =
        doc.lowerName.includes(term) || Boolean(doc.nameWords?.includes(term));
      const inDescription = doc.lowerDescription.includes(term);
      if (inName || inDescription) coverage++;
      if (inName) nameHits++;
      if (inDescription) descriptionHits++;
    }
    if (!coverage) continue;
    // Intent coverage wins over repetition of one broad word. At equal
    // coverage retain the existing 3:1 name/description preference.
    const score =
      coverage * (scoring.length * 4 + 1) + nameHits * 3 + descriptionHits;
    const result = { name, entry, score };
    // Keep only top K, rather than allocating and sorting every matching tool.
    let low = 0,
      high = results.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (compare(result, results[mid]) < 0) high = mid;
      else low = mid + 1;
    }
    if (low < maxResults) {
      results.splice(low, 0, result);
      if (results.length > maxResults) results.pop();
    }
  }
  return results;
}
