/**
 * Email body parser — Phase 5.2 of the Personal Data Hub.
 *
 * Wraps `mailparser.simpleParser` to consume the raw RFC822 source we
 * now fetch via ImapSession.fetchFullSince, returning a normalized shape
 * the EmailAdapter can stuff into `payload.parsedBody` (so downstream
 * Phase 5.3 classifiers and 5.4 template extractors don't need to redo
 * the parsing).
 *
 * What we keep vs. drop from mailparser output:
 *
 *   headers      → Map<string, any>, flattened to a plain object
 *                  keyed by lowercased name. Useful for Phase 5.3 rules
 *                  (List-Unsubscribe, X-* mailer headers, etc.)
 *   textBody     → text/plain content (UTF-8 string)
 *   htmlBody     → text/html content (UTF-8 string)
 *   attachments  → Array<AttachmentMetadata> — METADATA ONLY in v0
 *                  per Adapter_Email_IMAP.md §3 OQ-3. Disk persistence
 *                  + image thumbnail localization land in v0.2.
 *   contentSha256→ hex digest of the entire raw source. Lets the vault
 *                  short-circuit duplicate ingest (same message-id
 *                  re-uploaded by a misconfigured server).
 *
 * Charset handling is delegated to mailparser + iconv-lite (transitively
 * via libmime). GBK / GB2312 / Big5 / ShiftJIS all "just work" — we
 * never see raw bytes for text content.
 */

"use strict";

const crypto = require("node:crypto");
const { simpleParser } = require("mailparser");

/**
 * @typedef {object} AttachmentMetadata
 * @property {string} filename             original filename (decoded; mailparser handles RFC 2231)
 * @property {string} contentType          MIME type, e.g. "application/pdf"
 * @property {string} contentDisposition   "attachment" | "inline" | ...
 * @property {string} [contentId]          for inline cid: references
 * @property {number} size                 byte length of decoded content
 * @property {string} sha256               hex digest of decoded content
 * @property {boolean} isInline
 * @property {boolean} isEncrypted         heuristic: PDF whose %PDF header is followed by /Encrypt
 * @property {boolean} [relatesTo]         contentId pointer of related Multipart/Related parent (if any)
 */

/**
 * @typedef {object} ParsedEmail
 * @property {object} headers              flat, lowercase-keyed
 * @property {string} textBody             may be ""
 * @property {string} htmlBody             may be ""
 * @property {AttachmentMetadata[]} attachments
 * @property {string} contentSha256        hex of the raw source
 * @property {number} sourceBytes          raw size
 * @property {string|null} subject         convenience copy (mailparser also lower-cases per-charset)
 * @property {Date|null} date              header Date (separate from envelope.internalDate)
 */

/**
 * Parse an RFC822 raw email (Buffer or string). Returns a ParsedEmail or
 * throws on a fatal parse failure (rare — mailparser is very lenient).
 *
 * @param {Buffer|string} rawSource
 * @param {object} [opts]
 * @param {boolean} [opts.keepAttachmentBuffers=false]
 *        if true, AttachmentMetadata.buffer (Buffer) is also attached.
 *        Default false — v0 saves only metadata to keep prompt + KG
 *        budgets sane. PDF decryption (Phase 5.5) will pass true.
 * @param {number} [opts.maxBodyChars=200000]
 *        soft cap on text/html body length. Long Newsletter html in
 *        particular can be megabytes; trimming here keeps vault row
 *        sizes reasonable. Truncated bodies get `…[truncated N chars]`
 *        appended.
 * @returns {Promise<ParsedEmail>}
 */
async function parseRawEmail(rawSource, opts = {}) {
  if (rawSource == null) {
    throw new Error("parseRawEmail: rawSource required (Buffer or string)");
  }
  const buf = Buffer.isBuffer(rawSource) ? rawSource : Buffer.from(String(rawSource), "utf8");
  const contentSha256 = crypto.createHash("sha256").update(buf).digest("hex");

  const keepBufs = !!opts.keepAttachmentBuffers;
  const maxBody = Number.isFinite(opts.maxBodyChars) && opts.maxBodyChars > 0
    ? opts.maxBodyChars
    : 200_000;

  // simpleParser handles charset, multipart, nested message/rfc822, etc.
  // skipImageLinks/skipHtmlToText: we want full content, so leave defaults.
  let parsed;
  try {
    parsed = await simpleParser(buf, { skipImageLinks: true });
  } catch (err) {
    const wrapped = new Error(
      `parseRawEmail: mailparser failed — ${err && err.message ? err.message : err}`
    );
    wrapped.cause = err;
    throw wrapped;
  }

  // Headers: mailparser returns a Map. Flatten to plain object,
  // lowercased keys. Multi-value headers become arrays.
  const headers = {};
  if (parsed.headers instanceof Map) {
    for (const [k, v] of parsed.headers.entries()) {
      headers[String(k).toLowerCase()] = v;
    }
  } else if (parsed.headers && typeof parsed.headers === "object") {
    for (const k of Object.keys(parsed.headers)) {
      headers[k.toLowerCase()] = parsed.headers[k];
    }
  }

  const textBody = trim(parsed.text || "", maxBody);
  const htmlBody = trim(parsed.html || "", maxBody);

  const attachments = Array.isArray(parsed.attachments)
    ? parsed.attachments.map((a) => attachmentMeta(a, keepBufs))
    : [];

  return {
    headers,
    textBody,
    htmlBody,
    attachments,
    contentSha256,
    sourceBytes: buf.length,
    subject: typeof parsed.subject === "string" ? parsed.subject : null,
    date: parsed.date instanceof Date ? parsed.date : (parsed.date ? new Date(parsed.date) : null),
  };
}

// ─── helpers ───────────────────────────────────────────────────────────

function trim(s, max) {
  if (typeof s !== "string") return "";
  if (s.length <= max) return s;
  return s.slice(0, max) + `…[truncated ${s.length - max} chars]`;
}

function attachmentMeta(a, keepBuf) {
  const content = Buffer.isBuffer(a.content) ? a.content : null;
  const size = a.size || (content ? content.length : 0);
  const sha256 = content
    ? crypto.createHash("sha256").update(content).digest("hex")
    : "";
  const out = {
    filename: typeof a.filename === "string" ? a.filename : "",
    contentType: typeof a.contentType === "string" ? a.contentType : "application/octet-stream",
    contentDisposition: typeof a.contentDisposition === "string" ? a.contentDisposition : "attachment",
    contentId: typeof a.contentId === "string" ? a.contentId.replace(/^<|>$/g, "") : undefined,
    size,
    sha256,
    isInline: a.contentDisposition === "inline" || !!a.cid,
    isEncrypted: detectEncryptedPdf(a, content),
  };
  if (a.related) out.relatesTo = String(a.related);
  if (keepBuf && content) out.buffer = content;
  return out;
}

/**
 * Cheap heuristic to flag encrypted PDFs (for Phase 5.5). Detects
 * `%PDF-` header followed by `/Encrypt` somewhere in the first 4 KB.
 * False positives are fine — the decryption pass will just no-op.
 */
function detectEncryptedPdf(a, content) {
  if (!content) return false;
  if (!a.contentType || !a.contentType.toLowerCase().includes("pdf")) return false;
  if (!content.slice(0, 8).toString("ascii").includes("%PDF-")) return false;
  const head = content.slice(0, 4096).toString("binary");
  return head.includes("/Encrypt");
}

module.exports = {
  parseRawEmail,
};
