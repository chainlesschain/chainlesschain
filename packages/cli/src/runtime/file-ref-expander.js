/**
 * `@file` reference expander — Claude-Code-style prompt file injection.
 *
 * Scans a prompt for `@<path>` tokens and, for each one that resolves to a real
 * file/dir under the working directory, appends the file contents (or a dir
 * listing) as a `<referenced-files>` context block. The original `@token` stays
 * in the prose so the message remains readable and the model knows what the
 * user pointed at.
 *
 * Design notes:
 *  - A token only matches when `@` is at start-of-input or preceded by
 *    whitespace / an opening bracket-quote. That skips email addresses
 *    (`foo@bar.com`) and decorative `@` — the `@` there is preceded by a word
 *    char and never matches.
 *  - Non-existent paths are NOT expanded and are surfaced as warnings (so a
 *    typo'd path is visible rather than silently dropped). Decorative `@words`
 *    that happen not to be files simply produce no ref and no warning unless
 *    they look path-like (contain a slash or a dot-extension).
 *  - Files are read as UTF-8 (encoding.md rule). Binary files are skipped with
 *    a note. Oversized files are truncated with a marker.
 *  - All filesystem access goes through an injectable `deps` seam so unit tests
 *    never touch the real disk (mirrors the project's `_deps` philosophy).
 */

import fsDefault from "fs";
import pathDefault from "path";

export const DEFAULT_MAX_BYTES = 100 * 1024; // 100 KB per referenced file
export const DEFAULT_MAX_DIR_ENTRIES = 200;

// `@` preceded by start / whitespace / opening bracket-quote, then a path run.
// We capture greedily up to the next whitespace or a closing bracket-quote and
// trim trailing sentence punctuation afterwards.
const TOKEN_RE = /(^|[\s("'`[{])@([^\s"'`)\]}]+)/g;

/** A raw token looks path-like if it has a directory separator or a file ext. */
function looksPathLike(raw) {
  return /[\\/]/.test(raw) || /\.[A-Za-z0-9]+$/.test(raw);
}

/** Whether a resolved path is a PDF (text extraction is async, opt-in). */
function isPdf(p) {
  return /\.pdf$/i.test(String(p || ""));
}

/** Strip trailing sentence punctuation that is unlikely to be part of a path. */
function trimTrailingPunct(raw) {
  return raw.replace(/[),;:!?'".]+$/g, "");
}

/**
 * Split a token into its path and an optional trailing line range — Claude-Code
 * `@file#L5-10` parity. Accepts `#L5-10`, `#5-10`, `#L5`, `#5` (1-based,
 * inclusive). Returns `{ path, start, end }`, or null when there is no valid
 * range suffix (so plain `@path` falls through to whole-file expansion).
 */
export function parseLineRange(raw) {
  const m = /^(.+?)#[Ll]?(\d+)(?:-(\d+))?$/.exec(String(raw || ""));
  if (!m) return null;
  const start = parseInt(m[2], 10);
  if (!Number.isFinite(start) || start < 1) return null;
  let end = m[3] != null ? parseInt(m[3], 10) : start;
  if (!Number.isFinite(end) || end < start) end = start;
  return { path: m[1], start, end };
}

/**
 * Take lines [start, end] (1-based, inclusive) from `content`, clamped to the
 * file, then cap the slice at `maxBytes`. Returns the text plus the actual
 * (clamped) line bounds and whether the byte cap truncated it.
 */
function sliceLines(content, start, end, maxBytes) {
  const lines = content.split("\n");
  const total = lines.length;
  const s = Math.max(1, Math.min(start, total));
  const e = Math.min(Math.max(end, s), total);
  let text = lines.slice(s - 1, e).join("\n");
  let truncated = false;
  if (Buffer.byteLength(text, "utf-8") > maxBytes) {
    text = text.slice(0, maxBytes);
    truncated = true;
  }
  return { text, start: s, end: e, truncated };
}

/**
 * Find unique `@path` candidates in the text, in first-seen order.
 * @returns {Array<{raw:string}>}
 */
export function findFileRefTokens(text) {
  const seen = new Set();
  const out = [];
  let m;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(text)) !== null) {
    const raw = m[2];
    if (!raw || seen.has(raw)) continue;
    seen.add(raw);
    out.push({ raw });
  }
  return out;
}

/** True when a buffer/string looks binary (has a NUL in the sampled prefix). */
function looksBinary(buf) {
  const sample = buf.slice(0, 8000);
  for (let i = 0; i < sample.length; i++) {
    if (sample[i] === 0) return true;
  }
  return false;
}

/**
 * Resolve a single raw token to an injectable ref descriptor, or null when it
 * does not resolve to an existing path. Tries the literal path first, then a
 * trailing-punctuation-stripped variant (handles "see @config.json.").
 */
function resolveRef(raw, { cwd, fs, path, maxBytes, maxDirEntries }) {
  const candidates = [raw];
  const trimmed = trimTrailingPunct(raw);
  if (trimmed && trimmed !== raw) candidates.push(trimmed);

  for (const cand of candidates) {
    // `@path#L5-10` → resolve the bare path, slice the lines below.
    const range = parseLineRange(cand);
    const fsPath = range ? range.path : cand;
    const abs = path.resolve(cwd, fsPath);
    let stat;
    try {
      stat = fs.statSync(abs);
    } catch {
      continue; // not this candidate
    }
    if (stat.isDirectory()) {
      // A line range on a directory is meaningless — ignore it and list the dir.
      let entries;
      try {
        entries = fs.readdirSync(abs, { withFileTypes: true });
      } catch (err) {
        return {
          kind: "error",
          raw: cand,
          rel: fsPath,
          message: `cannot read directory: ${err.message}`,
        };
      }
      const names = entries
        .slice(0, maxDirEntries)
        .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
        .sort();
      const truncated = entries.length > maxDirEntries;
      return {
        kind: "dir",
        raw: cand,
        rel: fsPath,
        entries: names,
        total: entries.length,
        truncated,
      };
    }
    if (stat.isFile()) {
      let buf;
      try {
        buf = fs.readFileSync(abs);
      } catch (err) {
        return {
          kind: "error",
          raw: cand,
          rel: fsPath,
          message: `cannot read file: ${err.message}`,
        };
      }
      if (isPdf(fsPath)) {
        // PDF text extraction is async (pdf-parse). Return a deferred marker
        // carrying the bytes + requested page range; expandFileRefsAsync fills
        // in `content`. The sync path renders it as a note (no extraction).
        return {
          kind: "pdf",
          raw: cand,
          rel: fsPath,
          buf,
          bytes: stat.size,
          pageStart: range ? range.start : null,
          pageEnd: range ? range.end : null,
        };
      }
      if (looksBinary(buf)) {
        return {
          kind: "binary",
          raw: cand,
          rel: fsPath,
          bytes: stat.size,
        };
      }
      if (range) {
        // Slice the requested lines (clamped to the file), then byte-cap them.
        const sl = sliceLines(buf.toString("utf-8"), range.start, range.end, maxBytes);
        return {
          kind: "file",
          raw: cand,
          rel: fsPath,
          bytes: stat.size,
          content: sl.text,
          truncated: sl.truncated,
          lineStart: sl.start,
          lineEnd: sl.end,
        };
      }
      const truncated = buf.length > maxBytes;
      const content = (truncated ? buf.slice(0, maxBytes) : buf).toString(
        "utf-8",
      );
      return {
        kind: "file",
        raw: cand,
        rel: fsPath,
        bytes: stat.size,
        content,
        truncated,
      };
    }
    // Something exotic (socket/fifo) — treat as non-expandable.
    return null;
  }
  return null;
}

function escapeAttr(s) {
  return String(s).replace(/"/g, "&quot;");
}

/** Render the resolved refs into a single `<referenced-files>` block. */
function renderBlock(refs) {
  const parts = [
    '<referenced-files note="auto-injected from @path references">',
  ];
  for (const ref of refs) {
    if (ref.kind === "file") {
      const lineAttr = ref.lineStart
        ? ` lines="${ref.lineStart}-${ref.lineEnd}"`
        : "";
      const attrs =
        `path="${escapeAttr(ref.rel)}" bytes="${ref.bytes}"` +
        lineAttr +
        (ref.truncated
          ? ` truncated="true" shown-bytes="${DEFAULT_MAX_BYTES}"`
          : "");
      parts.push(`<file ${attrs}>`);
      parts.push(ref.content);
      if (ref.truncated) {
        parts.push(
          ref.lineStart
            ? `\n… [truncated — line range exceeds ${DEFAULT_MAX_BYTES} bytes]`
            : `\n… [truncated — file is ${ref.bytes} bytes]`,
        );
      }
      parts.push("</file>");
    } else if (ref.kind === "dir") {
      const attrs =
        `path="${escapeAttr(ref.rel)}" entries="${ref.total}"` +
        (ref.truncated ? ` truncated="true"` : "");
      parts.push(`<dir ${attrs}>`);
      parts.push(ref.entries.join("\n"));
      if (ref.truncated) {
        parts.push(`… [truncated — ${ref.total} entries total]`);
      }
      parts.push("</dir>");
    } else if (ref.kind === "pdf") {
      if (typeof ref.content === "string") {
        const pageAttr =
          ref.pageStart != null ? ` pages="${ref.pageStart}-${ref.pageEnd}"` : "";
        const attrs =
          `path="${escapeAttr(ref.rel)}" bytes="${ref.bytes}" type="pdf"` +
          pageAttr +
          (ref.truncated
            ? ` truncated="true" shown-bytes="${DEFAULT_MAX_BYTES}"`
            : "");
        parts.push(`<file ${attrs}>`);
        parts.push(ref.content);
        if (ref.truncated) {
          parts.push(`\n… [truncated — PDF text exceeds ${DEFAULT_MAX_BYTES} bytes]`);
        }
        parts.push("</file>");
      } else {
        // Sync context (or extraction failed): no page text inlined.
        const note =
          ref.pdfNote || "PDF — page text not extracted in this context";
        parts.push(
          `<file path="${escapeAttr(ref.rel)}" bytes="${ref.bytes}" type="pdf" note="${escapeAttr(note)}" />`,
        );
      }
    } else if (ref.kind === "binary") {
      parts.push(
        `<file path="${escapeAttr(ref.rel)}" bytes="${ref.bytes}" binary="true" note="binary file — contents omitted" />`,
      );
    }
  }
  parts.push("</referenced-files>");
  return parts.join("\n");
}

/**
 * Expand `@file` references in a prompt.
 *
 * @param {string} prompt
 * @param {object} [opts]
 * @param {string} [opts.cwd=process.cwd()]
 * @param {number} [opts.maxBytes]
 * @param {number} [opts.maxDirEntries]
 * @param {object} [opts.deps]            Injection seam: { fs, path }.
 * @returns {{ prompt:string, refs:Array, warnings:string[] }}
 *          `prompt` is unchanged when nothing resolved; otherwise it is the
 *          original text + a trailing `<referenced-files>` block.
 */
/** Resolve every @token to a ref (no rendering). Shared by sync + async. */
function _resolveAllRefs(text, opts) {
  const fs = opts.deps?.fs || fsDefault;
  const path = opts.deps?.path || pathDefault;
  const cwd = opts.cwd || process.cwd();
  const maxBytes = Number.isFinite(opts.maxBytes)
    ? opts.maxBytes
    : DEFAULT_MAX_BYTES;
  const maxDirEntries = Number.isFinite(opts.maxDirEntries)
    ? opts.maxDirEntries
    : DEFAULT_MAX_DIR_ENTRIES;

  const tokens = findFileRefTokens(text);
  const refs = [];
  const warnings = [];

  for (const { raw } of tokens) {
    const ref = resolveRef(raw, { cwd, fs, path, maxBytes, maxDirEntries });
    if (!ref) {
      // Only warn for path-like tokens; bare @mentions are left alone.
      if (looksPathLike(raw)) {
        warnings.push(`@${raw} — no such file or directory (left as-is)`);
      }
      continue;
    }
    if (ref.kind === "error") {
      warnings.push(`@${ref.raw} — ${ref.message} (left as-is)`);
      continue;
    }
    refs.push(ref);
  }
  return { refs, warnings, maxBytes };
}

export function expandFileRefs(prompt, opts = {}) {
  const text = typeof prompt === "string" ? prompt : "";
  if (!text || !text.includes("@")) {
    return { prompt: text, refs: [], warnings: [] };
  }
  const { refs, warnings } = _resolveAllRefs(text, opts);
  if (refs.length === 0) {
    return { prompt: text, refs: [], warnings };
  }
  return { prompt: `${text}\n\n${renderBlock(refs)}`, refs, warnings };
}

/**
 * Async superset of {@link expandFileRefs} that ALSO extracts text from
 * `@file.pdf` (optionally a page range, e.g. `@doc.pdf#1-3`). Needs the optional
 * `pdf-parse` dependency; when it's absent each PDF ref degrades to a note and a
 * warning (never throws). Used by the agent / REPL paths; the sync expandFileRefs
 * leaves PDFs un-extracted.
 */
export async function expandFileRefsAsync(prompt, opts = {}) {
  const text = typeof prompt === "string" ? prompt : "";
  if (!text || !text.includes("@")) {
    return { prompt: text, refs: [], warnings: [] };
  }
  const { refs, warnings, maxBytes } = _resolveAllRefs(text, opts);
  const extractPdf = opts.deps?.extractPdfPages || _extractPdfPages;

  for (const ref of refs) {
    if (ref.kind !== "pdf" || !ref.buf) continue;
    try {
      const out = await extractPdf(ref.buf, {
        firstPage: ref.pageStart,
        lastPage: ref.pageEnd,
        maxBytes,
      });
      ref.content = String(out?.text || "");
      ref.truncated = !!out?.truncated;
    } catch (err) {
      if (err && err.code === "PDF_LIB_MISSING") {
        ref.pdfNote =
          "PDF — install the optional `pdf-parse` dependency to extract page text";
        warnings.push(
          `@${ref.raw} — PDF extraction needs the optional \`pdf-parse\` dep (left as a reference)`,
        );
      } else {
        ref.pdfNote = `PDF — could not extract text (${err?.message || "error"})`;
        warnings.push(
          `@${ref.raw} — PDF extraction failed: ${err?.message || "error"} (left as a reference)`,
        );
      }
    }
    delete ref.buf; // don't keep the raw bytes around once consumed
  }

  if (refs.length === 0) {
    return { prompt: text, refs: [], warnings };
  }
  return { prompt: `${text}\n\n${renderBlock(refs)}`, refs, warnings };
}

/**
 * Default PDF text extractor (optional `pdf-parse`). Returns
 * `{ text, numpages, truncated }` for pages [firstPage, lastPage] (all pages
 * when those are null), byte-capped at maxBytes. Throws code `PDF_LIB_MISSING`
 * when the optional dependency is not installed.
 */
async function _extractPdfPages(buffer, { firstPage, lastPage, maxBytes } = {}) {
  let pdfParse;
  try {
    // pdf-parse's index.js runs debug code under ESM (no module.parent), so
    // import the lib entry directly to avoid it.
    const mod = await import("pdf-parse/lib/pdf-parse.js");
    pdfParse = mod.default || mod;
  } catch {
    const e = new Error("pdf-parse not installed");
    e.code = "PDF_LIB_MISSING";
    throw e;
  }
  const data = await pdfParse(buffer, {
    pagerender: (pageData) => {
      const n = pageData && pageData.pageNumber;
      if (typeof n === "number") {
        if (firstPage && n < firstPage) return "";
        if (lastPage && n > lastPage) return "";
      }
      return pageData.getTextContent().then((tc) =>
        (tc.items || []).map((it) => it.str).join(" "),
      );
    },
  });
  let out = String(data?.text || "").trim();
  let truncated = false;
  const cap = Number.isFinite(maxBytes) ? maxBytes : DEFAULT_MAX_BYTES;
  if (Buffer.byteLength(out, "utf-8") > cap) {
    out = out.slice(0, cap);
    truncated = true;
  }
  return { text: out, numpages: data?.numpages || 0, truncated };
}

export const _deps = { fs: fsDefault, path: pathDefault };
