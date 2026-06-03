/**
 * Phase 5.5 — PDF text extractor with password-trial loop.
 *
 * Bank credit-card statements arrive as **encrypted** PDF attachments
 * (~80% of Chinese issuers). Common password formats:
 *   - 身份证后 6 位     (last 6 of national ID)
 *   - 手机后 6 位       (last 6 of registered phone)
 *   - 卡号尾 6 位       (last 6 of card number)
 *   - 卡号尾 4 位       (last 4 of card number)
 *   - 用户生日 YYYYMMDD (date of birth)
 *
 * Strategy (per design doc §6.2.1 + T4 in §12):
 *   1. Try ALL passwords in the supplied list (user-config'd + adapter
 *      heuristics) plus an empty-password attempt first (PDFs flagged
 *      as `/Encrypt` but with empty owner-password decrypt successfully).
 *   2. Return on FIRST success.
 *   3. If every password fails, return `{ decrypted:false, attempted:N }`
 *      so the caller can mark the bill as `unparsable` instead of
 *      silently dropping it. The user can later add a password to
 *      their list and re-run sync — the cached watermark plus
 *      reclassification on retry will pick it up.
 *
 * Implementation:
 *   - This module wraps `pdf-parse`. To avoid loading the heavy pdf.js
 *     bundle at hub require-time (cold start cost for non-email
 *     consumers), the dep is lazy-loaded on first call. `pdf-parse`
 *     itself imports pdfjs-dist v1.10 internally.
 *   - Callers may inject a custom `pdfParseImpl` for testing — this
 *     keeps the unit tests entirely free of pdf-parse / pdfjs deps
 *     (the real lib is pulled in only by integration / smoke).
 *   - Outputs the first 200_000 chars of extracted text (same cap as
 *     mailparser body output) so downstream LLM prompts stay sane.
 *
 * @typedef {object} PdfExtractResult
 * @property {boolean} decrypted   true if SOME password (or no-password)
 *                                 successfully opened the PDF.
 * @property {string}  text        extracted plain text (empty when !decrypted)
 * @property {string=} password    the password that worked, or undefined
 *                                 if the PDF was not encrypted to begin
 *                                 with. (Empty-string password used for
 *                                 owner-password-only PDFs is reported as "".)
 * @property {number}  attempted   count of password trials performed
 * @property {boolean} wasEncrypted whether the PDF was actually encrypted
 *                                  (vs `isEncrypted` heuristic returning
 *                                  a false-positive — pdf-parse reports
 *                                  this via `info.IsEncrypted`).
 * @property {number}  pageCount   pages, when known.
 * @property {string=} error       last error message if extraction failed
 */

"use strict";

/**
 * Extract text from a PDF buffer. Tries each candidate password until
 * one works (or the list is exhausted). Never throws on bad passwords —
 * returns `{decrypted:false}` so callers can mark the bill unparsable
 * and surface a "missing password" hint to the UI.
 *
 * @param {Buffer} buffer        PDF bytes (required)
 * @param {object} [opts]
 * @param {string[]} [opts.passwords=[]] candidate passwords to try, in order
 * @param {number}   [opts.maxTextChars=200000]
 * @param {Function} [opts.pdfParseImpl] DI seam: `async (buf, {password?}) => {text, numpages, info?}`.
 *                                       Defaults to lazy-loaded `pdf-parse`.
 * @returns {Promise<PdfExtractResult>}
 */
async function extractPdfText(buffer, opts = {}) {
  if (!Buffer.isBuffer(buffer)) {
    return {
      decrypted: false,
      text: "",
      attempted: 0,
      wasEncrypted: false,
      pageCount: 0,
      error: "buffer required",
    };
  }
  const maxTextChars = Number.isFinite(opts.maxTextChars) && opts.maxTextChars > 0
    ? opts.maxTextChars
    : 200_000;
  const userPasswords = Array.isArray(opts.passwords) ? opts.passwords.filter((p) => typeof p === "string") : [];
  const pdfParse = typeof opts.pdfParseImpl === "function" ? opts.pdfParseImpl : await loadPdfParse();

  // Always attempt empty-password FIRST — pdf-parse treats undefined as
  // "no password" and many "encrypted" bank PDFs use an empty owner
  // password (only restricts editing, not decryption).
  // Deduplicate while preserving order — user lists often include "".
  const trial = ["", ...userPasswords].filter((v, i, arr) => arr.indexOf(v) === i);

  let lastError = null;
  let attempted = 0;
  let wasEncrypted = false;

  for (const pw of trial) {
    attempted += 1;
    try {
      // pdf-parse accepts options.password (a string). Empty string is
      // a valid argument and means "no password" to pdf.js.
      const parsed = await pdfParse(buffer, { password: pw });
      const info = parsed && parsed.info ? parsed.info : {};
      if (info.IsEncrypted) wasEncrypted = true;
      const text = trim((parsed && parsed.text) || "", maxTextChars);
      return {
        decrypted: true,
        text,
        password: pw === "" ? undefined : pw,
        attempted,
        wasEncrypted,
        pageCount: (parsed && parsed.numpages) || 0,
      };
    } catch (err) {
      lastError = err && err.message ? err.message : String(err);
      // pdf-parse emits "PasswordException" / "InvalidPasswordException" on
      // wrong password. Anything else (corrupt file, unsupported features)
      // is also caught — we don't retry on those, but we mark wasEncrypted
      // if the error string hints at it so the UI shows the right reason.
      if (/password/i.test(lastError)) {
        wasEncrypted = true;
        continue; // try next candidate
      }
      // Non-password error → no point trying more passwords
      return {
        decrypted: false,
        text: "",
        attempted,
        wasEncrypted,
        pageCount: 0,
        error: lastError,
      };
    }
  }

  return {
    decrypted: false,
    text: "",
    attempted,
    wasEncrypted: wasEncrypted || true, // exhausted all passwords → must be encrypted
    pageCount: 0,
    error: lastError || "all passwords failed",
  };
}

/**
 * Generate candidate passwords from per-user hints. Each input is an
 * optional string from the user's profile (idCardLast6, phoneLast6,
 * etc.); the function returns the non-empty values in priority order,
 * deduplicated.
 *
 * @param {object} hints
 * @param {string} [hints.idCardLast6]
 * @param {string} [hints.phoneLast6]
 * @param {string} [hints.cardLast6]
 * @param {string} [hints.cardLast4]
 * @param {string} [hints.dobYYYYMMDD]
 * @returns {string[]}
 */
function passwordsFromHints(hints = {}) {
  const order = ["idCardLast6", "phoneLast6", "cardLast6", "cardLast4", "dobYYYYMMDD"];
  const out = [];
  for (const k of order) {
    const v = hints[k];
    if (typeof v === "string" && v.length > 0 && !out.includes(v)) out.push(v);
  }
  return out;
}

// ─── helpers ────────────────────────────────────────────────────────────

function trim(s, max) {
  if (typeof s !== "string") return "";
  if (s.length <= max) return s;
  return s.slice(0, max) + `…[truncated ${s.length - max} chars]`;
}

let _pdfParseCache = null;
async function loadPdfParse() {
  if (_pdfParseCache) return _pdfParseCache;
  try {
    // eslint-disable-next-line global-require
    _pdfParseCache = require("pdf-parse");
  } catch (err) {
    throw new Error(
      `pdf-parse not installed — Phase 5.5 PDF extraction needs it. ${err && err.message ? err.message : err}`
    );
  }
  return _pdfParseCache;
}

module.exports = {
  extractPdfText,
  passwordsFromHints,
};
