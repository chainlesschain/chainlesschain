/**
 * Tolerant LLM-JSON parse for the renderer.
 *
 * A TypeScript port of the main-process `looseParseJSON`
 * (main/ai-engine/response-parser.js) — the renderer can't `require` a
 * main-process CommonJS module, so this mirrors its logic. Tries, in order:
 *   1. direct JSON.parse
 *   2. ```json fenced``` block
 *   3. each brace/bracket-BALANCED candidate (skipping string literals) — this is
 *      what fixes greedy over-capture when the LLM appends prose containing a
 *      stray `}` or emits several JSON objects
 *   4. greedy first-`{` to last-`}` as a final fallback
 * Throws `SyntaxError` when no JSON is found (mirrors the main-process contract).
 */

/** Balanced `{}`/`[]` candidates, left to right, ignoring chars inside strings. */
function extractBalancedJsonCandidates(text: string): string[] {
  const candidates: string[] = [];
  let i = 0;
  while (i < text.length) {
    const rel = text.slice(i).search(/[{[]/);
    if (rel === -1) {
      break;
    }
    const start = i + rel;
    let depth = 0;
    let inStr = false;
    let esc = false;
    let end = -1;
    for (let j = start; j < text.length; j++) {
      const ch = text[j];
      if (inStr) {
        if (esc) {
          esc = false;
        } else if (ch === "\\") {
          esc = true;
        } else if (ch === '"') {
          inStr = false;
        }
        continue;
      }
      if (ch === '"') {
        inStr = true;
      } else if (ch === "{" || ch === "[") {
        depth += 1;
      } else if (ch === "}" || ch === "]") {
        depth -= 1;
        if (depth === 0) {
          end = j;
          break;
        }
      }
    }
    if (end === -1) {
      break; // 从此处起括号未闭合 → 不再有完整候选
    }
    candidates.push(text.slice(start, end + 1));
    i = end + 1;
  }
  return candidates;
}

export function looseParseJSON(text: unknown): unknown {
  if (typeof text !== "string") {
    throw new TypeError("looseParseJSON: text must be a string");
  }
  try {
    return JSON.parse(text);
  } catch {
    const candidates: string[] = [];
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) {
      candidates.push(fence[1]);
    }
    candidates.push(...extractBalancedJsonCandidates(text));
    const greedy = (text.match(/\{[\s\S]*\}|\[[\s\S]*\]/) || [])[0];
    if (greedy) {
      candidates.push(greedy);
    }
    for (const candidate of candidates) {
      try {
        return JSON.parse(candidate);
      } catch {
        /* try the next candidate */
      }
    }
    throw new SyntaxError("looseParseJSON: no JSON found in text");
  }
}
