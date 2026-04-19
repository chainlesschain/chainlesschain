/**
 * Lightweight PDF text extractor.
 * Uses a simple built-in parser for basic PDF text extraction.
 * Falls back gracefully if text cannot be extracted.
 */

import { readFileSync } from "fs";
import { basename, extname } from "path";

/**
 * Extract text content from a PDF file.
 * Uses a basic approach: scan PDF stream for text operators.
 * This handles simple PDFs without requiring heavy external dependencies.
 *
 * @param {string} filePath - Path to the PDF file
 * @returns {{ title: string, content: string, pages: number|null }}
 */
export async function parsePdfText(filePath) {
  const buffer = readFileSync(filePath);
  const title = basename(filePath, extname(filePath));

  // Try to extract text from PDF binary
  const text = extractTextFromPdf(buffer);

  // Count pages by looking for /Type /Page objects
  const pdfStr = buffer.toString("latin1");
  const pageMatches = pdfStr.match(/\/Type\s*\/Page[^s]/g);
  const pages = pageMatches ? pageMatches.length : null;

  return {
    title,
    content: text,
    pages,
  };
}

/**
 * Basic PDF text extraction.
 * Scans for text between BT/ET operators and decodes common encodings.
 */
function extractTextFromPdf(buffer) {
  const pdfStr = buffer.toString("latin1");
  const textParts = [];

  // Find all stream sections and decode them
  const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let match;

  while ((match = streamRegex.exec(pdfStr)) !== null) {
    const streamContent = match[1];

    // Look for text showing operators: Tj, TJ, ', "
    const tjRegex = /\(([^)]*)\)\s*Tj/g;
    let tjMatch;
    while ((tjMatch = tjRegex.exec(streamContent)) !== null) {
      const decoded = decodePdfString(tjMatch[1]);
      if (decoded.trim()) textParts.push(decoded);
    }

    // TJ operator: array of strings and numbers
    const tjArrayRegex = /\[((?:\([^)]*\)|[^[\]])*)\]\s*TJ/gi;
    let tjArrMatch;
    while ((tjArrMatch = tjArrayRegex.exec(streamContent)) !== null) {
      const inner = tjArrMatch[1];
      const strRegex = /\(([^)]*)\)/g;
      let strMatch;
      const parts = [];
      while ((strMatch = strRegex.exec(inner)) !== null) {
        parts.push(decodePdfString(strMatch[1]));
      }
      if (parts.length > 0) textParts.push(parts.join(""));
    }
  }

  // Clean up and join
  const text = textParts
    .join("\n")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return text;
}

/**
 * Decode a PDF string (handle basic escape sequences).
 */
function decodePdfString(str) {
  return str
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\\(/g, "(")
    .replace(/\\\)/g, ")")
    .replace(/\\\\/g, "\\");
}


// =====================================================================
// PDF Parser V2 governance overlay
// =====================================================================
export const PDFP_PROFILE_MATURITY_V2 = Object.freeze({ PENDING: "pending", ACTIVE: "active", STALE: "stale", ARCHIVED: "archived" });
export const PDFP_PARSE_LIFECYCLE_V2 = Object.freeze({ QUEUED: "queued", PARSING: "parsing", PARSED: "parsed", FAILED: "failed", CANCELLED: "cancelled" });
const _pdfpPTrans = new Map([
  [PDFP_PROFILE_MATURITY_V2.PENDING, new Set([PDFP_PROFILE_MATURITY_V2.ACTIVE, PDFP_PROFILE_MATURITY_V2.ARCHIVED])],
  [PDFP_PROFILE_MATURITY_V2.ACTIVE, new Set([PDFP_PROFILE_MATURITY_V2.STALE, PDFP_PROFILE_MATURITY_V2.ARCHIVED])],
  [PDFP_PROFILE_MATURITY_V2.STALE, new Set([PDFP_PROFILE_MATURITY_V2.ACTIVE, PDFP_PROFILE_MATURITY_V2.ARCHIVED])],
  [PDFP_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _pdfpPTerminal = new Set([PDFP_PROFILE_MATURITY_V2.ARCHIVED]);
const _pdfpJTrans = new Map([
  [PDFP_PARSE_LIFECYCLE_V2.QUEUED, new Set([PDFP_PARSE_LIFECYCLE_V2.PARSING, PDFP_PARSE_LIFECYCLE_V2.CANCELLED])],
  [PDFP_PARSE_LIFECYCLE_V2.PARSING, new Set([PDFP_PARSE_LIFECYCLE_V2.PARSED, PDFP_PARSE_LIFECYCLE_V2.FAILED, PDFP_PARSE_LIFECYCLE_V2.CANCELLED])],
  [PDFP_PARSE_LIFECYCLE_V2.PARSED, new Set()],
  [PDFP_PARSE_LIFECYCLE_V2.FAILED, new Set()],
  [PDFP_PARSE_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _pdfpPsV2 = new Map();
const _pdfpJsV2 = new Map();
let _pdfpMaxActive = 6, _pdfpMaxPending = 12, _pdfpIdleMs = 30 * 24 * 60 * 60 * 1000, _pdfpStuckMs = 60 * 1000;
function _pdfpPos(n, label) { const v = Math.floor(Number(n)); if (!Number.isFinite(v) || v <= 0) throw new Error(`${label} must be positive integer`); return v; }
function _pdfpCheckP(from, to) { const a = _pdfpPTrans.get(from); if (!a || !a.has(to)) throw new Error(`invalid pdfp profile transition ${from} → ${to}`); }
function _pdfpCheckJ(from, to) { const a = _pdfpJTrans.get(from); if (!a || !a.has(to)) throw new Error(`invalid pdfp parse transition ${from} → ${to}`); }
function _pdfpCountActive(owner) { let c = 0; for (const p of _pdfpPsV2.values()) if (p.owner === owner && p.status === PDFP_PROFILE_MATURITY_V2.ACTIVE) c++; return c; }
function _pdfpCountPending(profileId) { let c = 0; for (const j of _pdfpJsV2.values()) if (j.profileId === profileId && (j.status === PDFP_PARSE_LIFECYCLE_V2.QUEUED || j.status === PDFP_PARSE_LIFECYCLE_V2.PARSING)) c++; return c; }
export function setMaxActivePdfpProfilesPerOwnerV2(n) { _pdfpMaxActive = _pdfpPos(n, "maxActivePdfpProfilesPerOwner"); }
export function getMaxActivePdfpProfilesPerOwnerV2() { return _pdfpMaxActive; }
export function setMaxPendingPdfpParsesPerProfileV2(n) { _pdfpMaxPending = _pdfpPos(n, "maxPendingPdfpParsesPerProfile"); }
export function getMaxPendingPdfpParsesPerProfileV2() { return _pdfpMaxPending; }
export function setPdfpProfileIdleMsV2(n) { _pdfpIdleMs = _pdfpPos(n, "pdfpProfileIdleMs"); }
export function getPdfpProfileIdleMsV2() { return _pdfpIdleMs; }
export function setPdfpParseStuckMsV2(n) { _pdfpStuckMs = _pdfpPos(n, "pdfpParseStuckMs"); }
export function getPdfpParseStuckMsV2() { return _pdfpStuckMs; }
export function _resetStatePdfParserV2() { _pdfpPsV2.clear(); _pdfpJsV2.clear(); _pdfpMaxActive = 6; _pdfpMaxPending = 12; _pdfpIdleMs = 30 * 24 * 60 * 60 * 1000; _pdfpStuckMs = 60 * 1000; }
export function registerPdfpProfileV2({ id, owner, encoding, metadata } = {}) {
  if (!id || !owner) throw new Error("id and owner required");
  if (_pdfpPsV2.has(id)) throw new Error(`pdfp profile ${id} already exists`);
  const now = Date.now();
  const p = { id, owner, encoding: encoding || "utf-8", status: PDFP_PROFILE_MATURITY_V2.PENDING, createdAt: now, updatedAt: now, lastTouchedAt: now, activatedAt: null, archivedAt: null, metadata: { ...(metadata || {}) } };
  _pdfpPsV2.set(id, p); return { ...p, metadata: { ...p.metadata } };
}
export function activatePdfpProfileV2(id) {
  const p = _pdfpPsV2.get(id); if (!p) throw new Error(`pdfp profile ${id} not found`);
  const isInitial = p.status === PDFP_PROFILE_MATURITY_V2.PENDING;
  _pdfpCheckP(p.status, PDFP_PROFILE_MATURITY_V2.ACTIVE);
  if (isInitial && _pdfpCountActive(p.owner) >= _pdfpMaxActive) throw new Error(`max active pdfp profiles for owner ${p.owner} reached`);
  const now = Date.now(); p.status = PDFP_PROFILE_MATURITY_V2.ACTIVE; p.updatedAt = now; p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function stalePdfpProfileV2(id) { const p = _pdfpPsV2.get(id); if (!p) throw new Error(`pdfp profile ${id} not found`); _pdfpCheckP(p.status, PDFP_PROFILE_MATURITY_V2.STALE); p.status = PDFP_PROFILE_MATURITY_V2.STALE; p.updatedAt = Date.now(); return { ...p, metadata: { ...p.metadata } }; }
export function archivePdfpProfileV2(id) { const p = _pdfpPsV2.get(id); if (!p) throw new Error(`pdfp profile ${id} not found`); _pdfpCheckP(p.status, PDFP_PROFILE_MATURITY_V2.ARCHIVED); const now = Date.now(); p.status = PDFP_PROFILE_MATURITY_V2.ARCHIVED; p.updatedAt = now; if (!p.archivedAt) p.archivedAt = now; return { ...p, metadata: { ...p.metadata } }; }
export function touchPdfpProfileV2(id) { const p = _pdfpPsV2.get(id); if (!p) throw new Error(`pdfp profile ${id} not found`); if (_pdfpPTerminal.has(p.status)) throw new Error(`cannot touch terminal pdfp profile ${id}`); const now = Date.now(); p.lastTouchedAt = now; p.updatedAt = now; return { ...p, metadata: { ...p.metadata } }; }
export function getPdfpProfileV2(id) { const p = _pdfpPsV2.get(id); if (!p) return null; return { ...p, metadata: { ...p.metadata } }; }
export function listPdfpProfilesV2() { return [..._pdfpPsV2.values()].map((p) => ({ ...p, metadata: { ...p.metadata } })); }
export function createPdfpParseV2({ id, profileId, path, metadata } = {}) {
  if (!id || !profileId) throw new Error("id and profileId required");
  if (_pdfpJsV2.has(id)) throw new Error(`pdfp parse ${id} already exists`);
  if (!_pdfpPsV2.has(profileId)) throw new Error(`pdfp profile ${profileId} not found`);
  if (_pdfpCountPending(profileId) >= _pdfpMaxPending) throw new Error(`max pending pdfp parses for profile ${profileId} reached`);
  const now = Date.now();
  const j = { id, profileId, path: path || "", status: PDFP_PARSE_LIFECYCLE_V2.QUEUED, createdAt: now, updatedAt: now, startedAt: null, settledAt: null, metadata: { ...(metadata || {}) } };
  _pdfpJsV2.set(id, j); return { ...j, metadata: { ...j.metadata } };
}
export function parsingPdfpParseV2(id) { const j = _pdfpJsV2.get(id); if (!j) throw new Error(`pdfp parse ${id} not found`); _pdfpCheckJ(j.status, PDFP_PARSE_LIFECYCLE_V2.PARSING); const now = Date.now(); j.status = PDFP_PARSE_LIFECYCLE_V2.PARSING; j.updatedAt = now; if (!j.startedAt) j.startedAt = now; return { ...j, metadata: { ...j.metadata } }; }
export function parsePdfpParseV2(id) { const j = _pdfpJsV2.get(id); if (!j) throw new Error(`pdfp parse ${id} not found`); _pdfpCheckJ(j.status, PDFP_PARSE_LIFECYCLE_V2.PARSED); const now = Date.now(); j.status = PDFP_PARSE_LIFECYCLE_V2.PARSED; j.updatedAt = now; if (!j.settledAt) j.settledAt = now; return { ...j, metadata: { ...j.metadata } }; }
export function failPdfpParseV2(id, reason) { const j = _pdfpJsV2.get(id); if (!j) throw new Error(`pdfp parse ${id} not found`); _pdfpCheckJ(j.status, PDFP_PARSE_LIFECYCLE_V2.FAILED); const now = Date.now(); j.status = PDFP_PARSE_LIFECYCLE_V2.FAILED; j.updatedAt = now; if (!j.settledAt) j.settledAt = now; if (reason) j.metadata.failReason = String(reason); return { ...j, metadata: { ...j.metadata } }; }
export function cancelPdfpParseV2(id, reason) { const j = _pdfpJsV2.get(id); if (!j) throw new Error(`pdfp parse ${id} not found`); _pdfpCheckJ(j.status, PDFP_PARSE_LIFECYCLE_V2.CANCELLED); const now = Date.now(); j.status = PDFP_PARSE_LIFECYCLE_V2.CANCELLED; j.updatedAt = now; if (!j.settledAt) j.settledAt = now; if (reason) j.metadata.cancelReason = String(reason); return { ...j, metadata: { ...j.metadata } }; }
export function getPdfpParseV2(id) { const j = _pdfpJsV2.get(id); if (!j) return null; return { ...j, metadata: { ...j.metadata } }; }
export function listPdfpParsesV2() { return [..._pdfpJsV2.values()].map((j) => ({ ...j, metadata: { ...j.metadata } })); }
export function autoStaleIdlePdfpProfilesV2({ now } = {}) { const t = now ?? Date.now(); const flipped = []; for (const p of _pdfpPsV2.values()) if (p.status === PDFP_PROFILE_MATURITY_V2.ACTIVE && (t - p.lastTouchedAt) >= _pdfpIdleMs) { p.status = PDFP_PROFILE_MATURITY_V2.STALE; p.updatedAt = t; flipped.push(p.id); } return { flipped, count: flipped.length }; }
export function autoFailStuckPdfpParsesV2({ now } = {}) { const t = now ?? Date.now(); const flipped = []; for (const j of _pdfpJsV2.values()) if (j.status === PDFP_PARSE_LIFECYCLE_V2.PARSING && j.startedAt != null && (t - j.startedAt) >= _pdfpStuckMs) { j.status = PDFP_PARSE_LIFECYCLE_V2.FAILED; j.updatedAt = t; if (!j.settledAt) j.settledAt = t; j.metadata.failReason = "auto-fail-stuck"; flipped.push(j.id); } return { flipped, count: flipped.length }; }
export function getPdfParserGovStatsV2() {
  const profilesByStatus = {}; for (const v of Object.values(PDFP_PROFILE_MATURITY_V2)) profilesByStatus[v] = 0; for (const p of _pdfpPsV2.values()) profilesByStatus[p.status]++;
  const parsesByStatus = {}; for (const v of Object.values(PDFP_PARSE_LIFECYCLE_V2)) parsesByStatus[v] = 0; for (const j of _pdfpJsV2.values()) parsesByStatus[j.status]++;
  return { totalPdfpProfilesV2: _pdfpPsV2.size, totalPdfpParsesV2: _pdfpJsV2.size, maxActivePdfpProfilesPerOwner: _pdfpMaxActive, maxPendingPdfpParsesPerProfile: _pdfpMaxPending, pdfpProfileIdleMs: _pdfpIdleMs, pdfpParseStuckMs: _pdfpStuckMs, profilesByStatus, parsesByStatus };
}
