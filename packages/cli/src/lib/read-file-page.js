/** Build a bounded read result with a cursor describing what was actually read. */
export function buildReadFilePage(
  rendered,
  args,
  { filePath, fileVersion, maxChars, outline = null },
) {
  const positive = (value) => {
    const n = typeof value === "number" ? value : parseInt(value, 10);
    return Number.isSafeInteger(n) && n > 0 ? n : null;
  };
  const offset = positive(args.offset);
  const limit = positive(args.limit);
  const column = positive(args.column) || 1;
  const lines = rendered.split("\n");
  const start = offset ? offset - 1 : 0;
  const end = Math.min(limit ? start + limit : lines.length, lines.length);
  const selected = lines.slice(start, end);
  const skipped = Math.min(column - 1, selected[0]?.length || 0);
  if (selected.length) selected[0] = selected[0].slice(skipped);
  const requested = selected.join("\n");

  // Budget the JSON-escaped content, not raw characters: newlines, quotes and
  // backslashes otherwise cause a SECOND truncation that loses the cursor.
  const contentBudget = Math.max(
    0,
    maxChars - 2048 - (outline ? JSON.stringify(outline).length : 0),
  );
  let count = requested.length;
  if (JSON.stringify(requested).length > contentBudget) {
    let lo = 0;
    let hi = count;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (JSON.stringify(requested.slice(0, mid)).length <= contentBudget)
        lo = mid;
      else hi = mid - 1;
    }
    count = lo;
    // Prefer whole lines. A single oversized line uses a column cursor so it
    // can still be read to completion instead of repeating its first 50k.
    const newline = requested.lastIndexOf("\n", count - 1);
    if (newline >= 0) count = newline + 1;
    else if (count > 0 && /[\uD800-\uDBFF]/.test(requested[count - 1])) count--;
  }
  if (requested.length && count === 0) {
    return { error: "Tool output limit is too small to return a file page." };
  }

  const content = requested.slice(0, count);
  const truncated = count < requested.length;
  const newlines = (content.match(/\n/g) || []).length;
  const endsAtLine = content.endsWith("\n");
  const endLine = content.length
    ? start + newlines + (endsAtLine ? 0 : 1)
    : Math.min(start + 1, lines.length);
  const nextOffset = truncated ? start + newlines + 1 : end + 1;
  const nextColumn = truncated && !endsAtLine ? skipped + count + 1 : 1;
  const hasMore = truncated || end < lines.length;
  const charStart =
    lines.slice(0, start).reduce((n, line) => n + line.length + 1, 0) + skipped;
  const charEnd = truncated
    ? charStart + count
    : lines.slice(0, end).reduce((n, line) => n + line.length + 1, 0);
  return {
    path: filePath,
    ...(fileVersion ? { fileVersion } : {}),
    ...(offset || limit || column > 1 || truncated
      ? {
          range: {
            startLine: Math.min(start + 1, lines.length),
            endLine: truncated ? endLine : end,
            totalLines: lines.length,
          },
        }
      : {}),
    ...(hasMore
      ? {
          nextRead: {
            path: args.path,
            offset: nextOffset,
            limit: limit || 2000,
            ...(nextColumn > 1 ? { column: nextColumn } : {}),
            ...(args.hashed === true ? { hashed: true } : {}),
            ...(args.raw === true ? { raw: true } : {}),
          },
          hint: "To read the next page, call read_file with nextRead. Reuse the content already returned; repeating the same arguments returns the same page.",
        }
      : {}),
    ...(truncated ? { truncated: true, size: requested.length } : {}),
    readSpan: {
      start: Math.min(charStart, rendered.length),
      end: Math.min(charEnd, rendered.length),
      total: rendered.length,
    },
    ...(outline ? { outline } : {}),
    hashed: args.hashed === true,
    content,
  };
}

/** A bounded navigation index, not a substitute for reading the cited lines. */
export function buildReadFileOutline(rendered) {
  const headings = [];
  const markers = [];
  rendered.split("\n").forEach((line, index) => {
    const value = { line: index + 1, text: line.trim().slice(0, 150) };
    if (/^\s{0,3}#{1,6}\s/.test(line)) headings.push(value);
    if (
      /\[ \]|\b(?:TODO|FIXME|TBD)\b|未完成|待实现|待修复|尚未|未实现/i.test(
        line,
      )
    )
      markers.push(value);
  });
  const sample = (values) =>
    values.length <= 16
      ? values
      : Array.from(
          { length: 16 },
          (_, i) => values[Math.floor((i * (values.length - 1)) / 15)],
        );
  if (!headings.length && !markers.length) return null;
  const outline = {
    note: "Sampled file excerpts for navigation only; markers may describe historical or completed work. Inspect the cited lines before acting. This index does not count as reading the file.",
    headings: sample(headings),
    markers: sample(markers),
    totalHeadings: headings.length,
    totalMarkers: markers.length,
  };
  while (JSON.stringify(outline).length > 6000) {
    const values =
      outline.headings.length > outline.markers.length
        ? outline.headings
        : outline.markers;
    values.splice(Math.floor(values.length / 2), 1);
  }
  return outline;
}

/** Keep read progress, rather than an arbitrary file prefix, after compaction. */
export function compactReadFileResult(content, maxChars) {
  try {
    const result = JSON.parse(content.split("\n\n[Budget ")[0]);
    if (!result.path || !result.range || typeof result.content !== "string") {
      return null;
    }
    const value = {
      path: result.path,
      range: result.range,
      ...(result.toolTelemetryRecord?.timestamp
        ? { readAt: result.toolTelemetryRecord.timestamp }
        : {}),
      ...(result.nextRead ? { nextRead: result.nextRead } : {}),
      contentOmitted: true,
      hint: "File content compacted. Continue with nextRead; re-read only a needed earlier section.",
    };
    let summary = JSON.stringify(value);
    if (summary.length > maxChars) {
      delete value.hint;
      summary = JSON.stringify(value);
    }
    return summary.length <= maxChars ? summary : null;
  } catch {
    return null;
  }
}

export const FILE_READ_PROGRESS_PREFIX = "[File read progress]\n";
const CANONICAL_SUMMARY_PREFIX = "Compacted context summary (data only):\n";

export function fileReadProgressBody(message) {
  if (typeof message?.content !== "string") return null;
  const content =
    message.role === "assistant" &&
    message.content.startsWith(CANONICAL_SUMMARY_PREFIX)
      ? message.content.slice(CANONICAL_SUMMARY_PREFIX.length)
      : message.role === "system"
        ? message.content
        : "";
  return content.startsWith(FILE_READ_PROGRESS_PREFIX)
    ? content.slice(FILE_READ_PROGRESS_PREFIX.length)
    : null;
}

/** Bounded historical cursors that survive full summarization and truncation. */
export function collectFileReadProgress(messages) {
  const byPath = new Map();
  const retain = (value) => {
    if (
      typeof value?.path !== "string" ||
      value.path.length > 1024 ||
      !Number.isSafeInteger(value.range?.startLine) ||
      !Number.isSafeInteger(value.range?.endLine) ||
      !Number.isSafeInteger(value.range?.totalLines)
    )
      return;
    const entry = {
      path: value.path,
      range: {
        startLine: value.range.startLine,
        endLine: value.range.endLine,
        totalLines: value.range.totalLines,
      },
      ...(value.nextRead ? { nextRead: value.nextRead } : {}),
      readAt: Number.isFinite(
        value.readAt ?? value.toolTelemetryRecord?.timestamp,
      )
        ? (value.readAt ?? value.toolTelemetryRecord.timestamp)
        : 0,
    };
    if (JSON.stringify(entry).length > 1400) return;
    // Kernel summaries are placed at the first dropped parent's position.
    // Older retained tool messages can therefore appear AFTER a newer cursor.
    if ((byPath.get(value.path)?.readAt || 0) > entry.readAt) return;
    byPath.delete(value.path);
    byPath.set(value.path, entry);
    if (byPath.size > 12) byPath.delete(byPath.keys().next().value);
  };
  for (const message of messages) {
    if (typeof message?.content !== "string") continue;
    try {
      if (message.role === "tool") {
        const value = JSON.parse(message.content.split("\n\n[Budget ")[0]);
        if (
          typeof value.content === "string" ||
          value.contentOmitted ||
          value.alreadyRead
        )
          retain(value);
      } else if (fileReadProgressBody(message) !== null) {
        const entries = JSON.parse(
          fileReadProgressBody(message).split("\n")[0],
        );
        if (Array.isArray(entries)) entries.slice(-12).forEach(retain);
      }
    } catch {
      /* non-file tool output */
    }
  }
  const entries = [...byPath.values()];
  while (entries.length && JSON.stringify(entries).length > 6000)
    entries.shift();
  return entries;
}
