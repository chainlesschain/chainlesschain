/**
 * Normalize an Ollama server URL for native `/api/*` requests.
 *
 * Ollama's OpenAI-compatible examples commonly use a `/v1` base path, while
 * this CLI provider speaks Ollama's native API. Accept both forms in saved
 * settings and remove trailing OpenAI/native API suffixes before appending a
 * native `/api/*` path.
 */
export function normalizeOllamaBaseUrl(value) {
  return String(value || "http://localhost:11434")
    .trim()
    .replace(/\/+$/, "")
    .replace(/(?:\/(?:v1|api))+$/i, "");
}
