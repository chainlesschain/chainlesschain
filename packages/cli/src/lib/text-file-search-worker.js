import fs from "node:fs";
import { parentPort, workerData } from "node:worker_threads";

// Large single lines are scanned in overlapping windows, never accumulated in
// full. Literal queries up to 2048 characters cross windows without omissions.
// Regex is explicitly window-scoped and isolated here so ReDoS cannot hang the
// agent. The parent enforces a deadline and a worker heap budget.
const WINDOW = 65536;
const OVERLAP = 4096;
const {
  file,
  pattern,
  regex,
  caseSensitive,
  offset,
  maxMatches,
  contextChars,
  encoding,
} = workerData;
const matches = [];
let position = 0;
let line = 1;
let column = 1;
let pending = "";
let matcher;
try {
  const source = regex
    ? pattern
    : pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  matcher = new RegExp(source, caseSensitive ? "gmu" : "gimu");
} catch (error) {
  parentPort.postMessage({
    error: error.message,
    code: "ERR_TEXT_SEARCH_PATTERN",
  });
  process.exit(0);
}

function result(hasMore, nextOffset = null) {
  return {
    matches,
    count: matches.length,
    hasMore,
    nextOffset,
    ...(regex
      ? {
          regexWindowChars: WINDOW + OVERLAP,
          hint: "Regular expressions are evaluated in overlapping text windows; matches spanning more than 4096 characters across a window boundary may be omitted. Use a literal keyword to locate the section, then read its context.",
        }
      : {}),
  };
}

function scan(text, committed) {
  // Prevent ^ from treating the middle of a long line as a new line.
  const prefix = column > 1 ? "\u0001" : "";
  const searchable = prefix + text;
  matcher.lastIndex = Math.max(
    prefix.length,
    offset - position + prefix.length,
  );
  let match;
  while ((match = matcher.exec(searchable)) !== null) {
    const start = match.index - prefix.length;
    if (start >= committed) break;
    const absolute = position + start;
    const before = text.slice(0, start);
    const newlines = (before.match(/\n/g) || []).length;
    const matchLine = line + newlines;
    const matchColumn = newlines
      ? start - before.lastIndexOf("\n")
      : column + start;
    const contextStart = Math.max(0, start - contextChars);
    const contextEnd = Math.min(
      text.length,
      start + Math.min(match[0].length, 512) + contextChars,
    );
    matches.push({
      line: matchLine,
      column: matchColumn,
      offset: absolute,
      text: match[0].slice(0, 512),
      context: text.slice(contextStart, contextEnd),
      ...(match[0].length > 512 ? { matchTruncated: true } : {}),
      nextRead: {
        offset: matchLine,
        column: Math.max(1, matchColumn - contextChars),
        limit: 5,
      },
    });
    const next = absolute + Math.max(1, match[0].length);
    if (matches.length >= maxMatches) return result(true, next);
    if (!match[0].length)
      matcher.lastIndex +=
        searchable.codePointAt(matcher.lastIndex) > 0xffff ? 2 : 1;
  }
  return null;
}

function advance(count) {
  const consumed = pending.slice(0, count);
  const newlines = (consumed.match(/\n/g) || []).length;
  if (newlines) {
    line += newlines;
    column = count - consumed.lastIndexOf("\n");
  } else column += count;
  position += count;
  pending = pending.slice(count);
}

try {
  const stream = fs.createReadStream(file, { encoding, highWaterMark: 65536 });
  let done = false;
  for await (const chunk of stream) {
    pending += chunk;
    while (pending.length >= WINDOW + OVERLAP) {
      let committed = WINDOW;
      if (/[\uD800-\uDBFF]/.test(pending[committed - 1])) committed--;
      const found =
        position + committed > offset
          ? scan(pending.slice(0, committed + OVERLAP), committed)
          : null;
      if (found) {
        parentPort.postMessage(found);
        done = true;
        break;
      }
      advance(committed);
      parentPort.postMessage({
        progress: { matches, nextOffset: Math.max(offset, position) },
      });
    }
    if (done) break;
  }
  if (!done) {
    const found = scan(pending, pending.length + 1);
    parentPort.postMessage(found || result(false));
  }
} catch (error) {
  parentPort.postMessage({ error: error.message, code: "ERR_TEXT_SEARCH" });
}
