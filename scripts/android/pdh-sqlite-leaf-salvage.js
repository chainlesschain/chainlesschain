#!/usr/bin/env node
"use strict";
/*
 * PDH SQLite leaf-page record salvager.
 *
 * Method B (`/proc/<pid>/mem` 内存扫描) dumps decrypted pages, but for DBs whose
 * page cache is SCATTERED (not contiguous mmap) the rebuilt file is "malformed"
 * (valid header, broken b-tree). This tool salvages the DATA anyway: it scans a
 * dump (or concatenated dumps) for SQLite **table b-tree leaf pages** (type 0x0D)
 * and parses each page's records directly — order-independent, exactly what
 * sqlite3 `.recover` does, but standalone (platform-tools sqlite3 lacks .recover).
 *
 * Usage:
 *   node pdh-sqlite-leaf-salvage.js <dumpfile> [--page-size 4096] [--min-cols N] [--json]
 *   # scan a whole dir of dumps:
 *   for f in dumps/*.db; do node pdh-sqlite-leaf-salvage.js "$f"; done
 *
 * Output: one JSON record per line: {rowid, cols:[...]}.  Records are the raw
 * column tuples; map to a schema (e.g. Douyin msg: sender/created_time/content)
 * by column position/heuristics downstream.
 *
 * Authorization: only on data you are entitled to (your own device/account).
 * Docs: docs/internal/pdh-db-decryption-runbook.md (Method B + reconstruction).
 */
const fs = require("node:fs");

function readVarint(buf, off) {
  // SQLite varint: up to 9 bytes, big-endian, high bit = continuation.
  let result = 0n;
  let i = 0;
  for (; i < 8; i++) {
    const b = buf[off + i];
    if (b === undefined) return [null, off + i];
    result = (result << 7n) | BigInt(b & 0x7f);
    if ((b & 0x80) === 0) return [result, off + i + 1];
  }
  // 9th byte uses all 8 bits
  const b9 = buf[off + 8];
  if (b9 === undefined) return [null, off + 9];
  result = (result << 8n) | BigInt(b9);
  return [result, off + 9];
}

function serialTypeSize(t) {
  // t is a BigInt
  const n = Number(t);
  if (n === 0 || n === 8 || n === 9 || n === 12 || n === 13) {
    return n >= 12 ? (n % 2 === 0 ? (n - 12) / 2 : (n - 13) / 2) : 0;
  }
  if (n === 1) return 1;
  if (n === 2) return 2;
  if (n === 3) return 3;
  if (n === 4) return 4;
  if (n === 5) return 6;
  if (n === 6) return 8;
  if (n === 7) return 8;
  if (n >= 12) return n % 2 === 0 ? (n - 12) / 2 : (n - 13) / 2;
  return 0;
}

function readValue(buf, off, t) {
  const n = Number(t);
  const sz = serialTypeSize(t);
  if (n === 0) return [null, off];
  if (n === 8) return [0, off];
  if (n === 9) return [1, off];
  if (n >= 1 && n <= 6) {
    let v = 0n;
    for (let i = 0; i < sz; i++) v = (v << 8n) | BigInt(buf[off + i] || 0);
    // sign-extend
    const bits = BigInt(sz * 8);
    if (v >= 1n << (bits - 1n)) v -= 1n << bits;
    const num = Number(v);
    return [Number.isSafeInteger(num) ? num : v.toString(), off + sz];
  }
  if (n === 7) return [buf.readDoubleBE(off), off + 8];
  if (n >= 13 && n % 2 === 1) {
    // text
    return [buf.toString("utf8", off, off + sz), off + sz];
  }
  // blob (n>=12 even) — return length marker, not raw bytes
  return [`<blob:${sz}>`, off + sz];
}

// Parse one table-leaf page at `base`. Returns array of {rowid, cols} or null.
function parseLeafPage(buf, base, pageSize, minCols) {
  if (buf[base] !== 0x0d) return null; // 0x0D = table b-tree leaf
  const numCells = (buf[base + 3] << 8) | buf[base + 4];
  if (numCells <= 0 || numCells > Math.floor(pageSize / 4)) return null;
  const out = [];
  const ptrBase = base + 8;
  for (let c = 0; c < numCells; c++) {
    const ptr = (buf[ptrBase + c * 2] << 8) | buf[ptrBase + c * 2 + 1];
    if (ptr < 8 || ptr >= pageSize) continue;
    let off = base + ptr;
    try {
      const [payloadLen, o1] = readVarint(buf, off); off = o1;
      if (payloadLen === null || payloadLen <= 0n || payloadLen > BigInt(pageSize)) continue;
      const [rowid, o2] = readVarint(buf, off); off = o2;
      // record header
      const recStart = off;
      const [hdrLen, o3] = readVarint(buf, off); off = o3;
      if (hdrLen === null || hdrLen <= 0n) continue;
      const hdrEnd = recStart + Number(hdrLen);
      const serials = [];
      while (off < hdrEnd) {
        const [st, oN] = readVarint(buf, off); off = oN;
        if (st === null) break;
        serials.push(st);
      }
      let vOff = hdrEnd;
      const cols = [];
      for (const st of serials) {
        const [val, vN] = readValue(buf, vOff, st);
        cols.push(val); vOff = vN;
      }
      if (cols.length >= minCols) out.push({ rowid: rowid === null ? null : rowid.toString(), cols });
    } catch (_e) { /* skip malformed cell */ }
  }
  return out.length ? out : null;
}

function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  if (!file) { console.error("usage: pdh-sqlite-leaf-salvage.js <dumpfile> [--page-size N] [--min-cols N]"); process.exit(1); }
  const pageSize = Number((args.find((a) => a.startsWith("--page-size=")) || "").split("=")[1]) || 4096;
  const minCols = Number((args.find((a) => a.startsWith("--min-cols=")) || "").split("=")[1]) || 3;
  const buf = fs.readFileSync(file);
  let pages = 0, records = 0;
  // scan on page-size boundaries (where SQLite pages align in the cache)
  for (let base = 0; base + pageSize <= buf.length; base += pageSize) {
    const recs = parseLeafPage(buf, base, pageSize, minCols);
    if (!recs) continue;
    pages++;
    for (const r of recs) { process.stdout.write(JSON.stringify(r) + "\n"); records++; }
  }
  console.error(`[salvage] ${file}: ${pages} leaf pages, ${records} records`);
}

if (require.main === module) main();
module.exports = { readVarint, serialTypeSize, readValue, parseLeafPage };
