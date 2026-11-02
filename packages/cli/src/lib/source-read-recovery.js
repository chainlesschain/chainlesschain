import { parse } from "acorn";
import { canProjectHostToolExcerpt } from "./tool-result-preview.js";

/**
 * A cut source container is not safe evidence. Recover its complete top-level
 * statements from the very same read snapshot, with explicit range metadata.
 * This does not exempt source from either projection or provider sanitization.
 */
export function recoverCompleteSourceRead(page, source, args, maxChars) {
  if (
    typeof page?.content !== "string" ||
    typeof page.fileVersion !== "string" ||
    !/\.(?:[cm]?js)$/iu.test(page.path || "") ||
    args.hashed === true ||
    !page.range ||
    !page.readSpan ||
    source.length > 512 * 1024 ||
    canProjectHostToolExcerpt(page.content, "read_file")
  )
    return page;

  let program;
  let tokens = 0;
  try {
    program = parse(source, {
      ecmaVersion: "latest",
      sourceType: "module",
      allowReturnOutsideFunction: true,
      onToken() {
        if (++tokens > 32768)
          throw new RangeError("Source recovery token bound");
      },
    });
  } catch {
    // Malformed or oversized source retains the ordinary omission boundary.
    return page;
  }
  const statements = program.body.filter(
    (node) => node.start < page.readSpan.end && node.end > page.readSpan.start,
  );
  if (!statements.length) return page;
  const start = Math.min(
    page.readSpan.start,
    source.lastIndexOf("\n", statements[0].start - 1) + 1,
  );
  const followingNewline = source.indexOf("\n", statements.at(-1).end);
  const end = Math.max(
    page.readSpan.end,
    followingNewline < 0 ? source.length : followingNewline + 1,
  );
  const content = source.slice(start, end);
  if (
    content === page.content ||
    !canProjectHostToolExcerpt(content, "read_file")
  )
    return page;
  const startLine = 1 + (source.slice(0, start).match(/\n/gu) || []).length;
  const endLine =
    startLine +
    (content.match(/\n/gu) || []).length -
    (content.endsWith("\n") ? 1 : 0);
  const recovered = {
    ...page,
    content,
    range: { startLine, endLine, totalLines: page.range.totalLines },
    readSpan: { start, end, total: source.length },
    sourceRecovery: {
      action: "complete-source-container",
      fileVersion: page.fileVersion,
      requestedRange: { ...page.range },
      requestedSpan: { ...page.readSpan },
      note: "The requested excerpt cut a source container. These complete surrounding statements come from the same file version; the range and readSpan describe the content actually returned.",
    },
  };
  delete recovered.truncated;
  delete recovered.size;
  delete recovered.nextRead;
  delete recovered.hint;
  if (end < source.length) {
    recovered.nextRead = { ...args, offset: endLine + 1, column: 1 };
    recovered.hint = "Continue with nextRead only if more source is needed.";
  }
  // The read guard, host telemetry and delivery envelope still add metadata.
  // Reuse the ordinary page's headroom: an almost-full recovery would be
  // projected back to an omission by the final cap before reaching a provider.
  return JSON.stringify(recovered).length <= Math.max(0, maxChars - 2048)
    ? recovered
    : page;
}
