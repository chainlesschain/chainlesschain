/**
 * `cc ipfs` — CLI surface for Phase 17 IPFS 去中心化存储.
 *
 * Exposes node lifecycle, content add/get/list, pin/unpin, storage
 * stats, garbage collection, quota, and knowledge attachment linkage.
 *
 * Note: CIDs are simulated sha256 hashes; real libp2p/Helia is not
 * ported. Content is local-only and encrypted with AES-256-GCM when
 * `--encrypt` is set.
 */

import fs from "fs";
import { Command } from "commander";

import {
  NODE_MODE,
  NODE_STATUS,
  ensureIpfsTables,
  startNode,
  stopNode,
  getNodeStatus,
  setMode,
  addContent,
  getContent,
  hasContent,
  listContent,
  pin,
  unpin,
  listPins,
  getStorageStats,
  garbageCollect,
  setQuota,
  addKnowledgeAttachment,
  getKnowledgeAttachments,
} from "../lib/ipfs-storage.js";

function _dbFromCtx(cmd) {
  const root = cmd?.parent?.parent ?? cmd?.parent;
  return root?._db;
}

function _parseJson(raw) {
  if (raw == null) return null;
  try {
    return JSON.parse(raw);
  } catch (_e) {
    return raw;
  }
}

function _readContent(opts) {
  if (opts.file) return fs.readFileSync(opts.file);
  if (opts.text != null) return opts.text;
  if (opts.json != null) return opts.json;
  return null;
}

export function registerIpfsCommand(program) {
  const ipfs = new Command("ipfs")
    .description("IPFS decentralized storage (Phase 17)")
    .hook("preAction", (thisCmd) => {
      const db = _dbFromCtx(thisCmd);
      if (db) ensureIpfsTables(db);
    });

  /* ── Catalogs ─────────────────────────────────────── */

  ipfs
    .command("modes")
    .description("List node modes (embedded/external)")
    .option("--json", "JSON output")
    .action((opts) => {
      const modes = Object.values(NODE_MODE);
      if (opts.json) return console.log(JSON.stringify(modes, null, 2));
      for (const m of modes) console.log(`  ${m}`);
    });

  ipfs
    .command("statuses")
    .description("List node statuses")
    .option("--json", "JSON output")
    .action((opts) => {
      const statuses = Object.values(NODE_STATUS);
      if (opts.json) return console.log(JSON.stringify(statuses, null, 2));
      for (const s of statuses) console.log(`  ${s}`);
    });

  /* ── Node lifecycle ───────────────────────────────── */

  ipfs
    .command("node-start")
    .description("Start the IPFS node")
    .option("-m, --mode <embedded|external>", "Node mode")
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(ipfs);
      const r = startNode(db, { mode: opts.mode });
      if (opts.json) return console.log(JSON.stringify(r, null, 2));
      if (!r.started) return console.log(`Failed to start node: ${r.reason}`);
      console.log(`Node started (mode=${r.mode}, peerId=${r.peerId})`);
    });

  ipfs
    .command("node-stop")
    .description("Stop the IPFS node")
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(ipfs);
      const r = stopNode(db);
      if (opts.json) return console.log(JSON.stringify(r, null, 2));
      if (!r.stopped) return console.log(`Failed to stop node: ${r.reason}`);
      console.log("Node stopped");
    });

  ipfs
    .command("node-status")
    .description("Show node status and uptime")
    .option("--json", "JSON output")
    .action((opts) => {
      const r = getNodeStatus();
      if (opts.json) return console.log(JSON.stringify(r, null, 2));
      console.log(`Status:   ${r.status}`);
      console.log(`Mode:     ${r.mode}`);
      console.log(`PeerId:   ${r.peerId || "-"}`);
      console.log(`Uptime:   ${r.uptimeMs}ms`);
    });

  ipfs
    .command("set-mode <mode>")
    .description("Set node mode (stop node first)")
    .option("--json", "JSON output")
    .action((mode, opts) => {
      const db = _dbFromCtx(ipfs);
      const r = setMode(db, mode);
      if (opts.json) return console.log(JSON.stringify(r, null, 2));
      if (!r.set) return console.log(`Failed: ${r.reason}`);
      console.log(`Mode set to ${r.mode}`);
    });

  /* ── Content operations ───────────────────────────── */

  ipfs
    .command("add")
    .description("Add content to the store")
    .option("-f, --file <path>", "Read content from file")
    .option("-t, --text <text>", "Inline text content")
    .option("--json-body <json>", "Inline JSON body (stored as JSON)")
    .option("--filename <name>", "Filename metadata")
    .option("--mime <type>", "MIME type")
    .option("--encrypt", "Encrypt payload with AES-256-GCM")
    .option("--pin", "Pin after add")
    .option("--knowledge <id>", "Associate with knowledge item")
    .option("--meta <json>", "Metadata JSON")
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(ipfs);
      const content = _readContent({
        file: opts.file,
        text: opts.text,
        json: opts.jsonBody,
      });
      if (content == null)
        return console.log(
          "Must provide one of --file, --text, or --json-body",
        );
      const r = addContent(db, content, {
        filename: opts.filename,
        mimeType: opts.mime,
        encrypt: Boolean(opts.encrypt),
        pin: Boolean(opts.pin),
        knowledgeId: opts.knowledge,
        metadata: _parseJson(opts.meta),
      });
      if (opts.json) return console.log(JSON.stringify(r, null, 2));
      if (!r.added) return console.log(`Failed: ${r.reason}`);
      console.log(
        `Added cid=${r.cid} size=${r.size}${r.duplicate ? " (duplicate)" : ""}${r.pinned ? " [pinned]" : ""}${r.encrypted ? " [encrypted]" : ""}`,
      );
    });

  ipfs
    .command("get <cid>")
    .description("Get content by CID")
    .option("-o, --out <path>", "Write to file")
    .option("-s, --string", "Decode as UTF-8 string")
    .option("--json", "JSON output (includes base64 body)")
    .action((cid, opts) => {
      const db = _dbFromCtx(ipfs);
      const r = getContent(db, cid, { asString: Boolean(opts.string) });
      if (!r) return console.log("Not found (node running?)");
      if (opts.out) {
        const buf = Buffer.from(r.base64, "base64");
        fs.writeFileSync(opts.out, buf);
        console.log(`Wrote ${buf.length} bytes to ${opts.out}`);
        return;
      }
      if (opts.json) return console.log(JSON.stringify(r, null, 2));
      console.log(`CID:      ${r.cid}`);
      console.log(`Size:     ${r.size}`);
      console.log(`Filename: ${r.filename || "-"}`);
      console.log(`MIME:     ${r.mimeType || "-"}`);
      console.log(`Pinned:   ${r.pinned}`);
      console.log(`Encrypted:${r.encrypted}`);
      if (opts.string)
        console.log(`\n--- content ---\n${r.content.toString()}`);
    });

  ipfs
    .command("show <cid>")
    .description("Show content metadata (no payload)")
    .option("--json", "JSON output")
    .action((cid, opts) => {
      const db = _dbFromCtx(ipfs);
      const exists = hasContent(db, cid);
      if (!exists)
        return opts.json
          ? console.log(JSON.stringify({ exists: false }, null, 2))
          : console.log("Not found");
      const rows = listContent(db, { limit: 10000 });
      const r = rows.find((c) => c.cid === cid);
      if (opts.json) return console.log(JSON.stringify(r, null, 2));
      console.log(`CID:       ${r.cid}`);
      console.log(`Size:      ${r.size}`);
      console.log(`Filename:  ${r.filename || "-"}`);
      console.log(`MIME:      ${r.mime_type || "-"}`);
      console.log(`Pinned:    ${Boolean(r.pinned)}`);
      console.log(`Encrypted: ${Boolean(r.encrypted)}`);
      console.log(`Knowledge: ${r.knowledge_id || "-"}`);
    });

  ipfs
    .command("list")
    .description("List content entries")
    .option("-p, --pinned", "Only pinned")
    .option("-u, --unpinned", "Only unpinned")
    .option("-k, --knowledge <id>", "Filter by knowledge id")
    .option("-n, --limit <n>", "Limit", (v) => parseInt(v, 10), 50)
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(ipfs);
      let pinnedFilter;
      if (opts.pinned) pinnedFilter = true;
      else if (opts.unpinned) pinnedFilter = false;
      const rows = listContent(db, {
        pinned: pinnedFilter,
        knowledgeId: opts.knowledge,
        limit: opts.limit,
      });
      if (opts.json) return console.log(JSON.stringify(rows, null, 2));
      if (rows.length === 0) return console.log("No content");
      for (const r of rows) {
        const flags =
          `${r.pinned ? "P" : "-"}${r.encrypted ? "E" : "-"}` +
          (r.knowledge_id ? "K" : "-");
        console.log(
          `  ${r.cid.slice(0, 16)}…  ${flags}  ${String(r.size).padStart(7)}  ${r.filename || "(unnamed)"}`,
        );
      }
    });

  /* ── Pin management ───────────────────────────────── */

  ipfs
    .command("pin <cid>")
    .description("Pin a CID (quota-checked)")
    .option("--json", "JSON output")
    .action((cid, opts) => {
      const db = _dbFromCtx(ipfs);
      const r = pin(db, cid);
      if (opts.json) return console.log(JSON.stringify(r, null, 2));
      if (!r.pinned) return console.log(`Failed: ${r.reason}`);
      console.log(`Pinned ${r.cid}`);
    });

  ipfs
    .command("unpin <cid>")
    .description("Unpin a CID")
    .option("--json", "JSON output")
    .action((cid, opts) => {
      const db = _dbFromCtx(ipfs);
      const r = unpin(db, cid);
      if (opts.json) return console.log(JSON.stringify(r, null, 2));
      if (!r.unpinned) return console.log(`Failed: ${r.reason}`);
      console.log(`Unpinned ${r.cid}`);
    });

  ipfs
    .command("pins")
    .description("List pinned content")
    .option("-n, --limit <n>", "Limit", (v) => parseInt(v, 10), 50)
    .option(
      "-s, --sort <field>",
      "Sort by (created_at|size|filename)",
      "created_at",
    )
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(ipfs);
      const rows = listPins(db, { limit: opts.limit, sortBy: opts.sort });
      if (opts.json) return console.log(JSON.stringify(rows, null, 2));
      if (rows.length === 0) return console.log("No pinned content");
      for (const r of rows)
        console.log(
          `  ${r.cid.slice(0, 16)}…  ${String(r.size).padStart(7)}  ${r.filename || "(unnamed)"}`,
        );
    });

  /* ── Stats / GC / quota ───────────────────────────── */

  ipfs
    .command("stats")
    .description("Storage statistics")
    .option("--json", "JSON output")
    .action((opts) => {
      const r = getStorageStats();
      if (opts.json) return console.log(JSON.stringify(r, null, 2));
      console.log(`Total content:  ${r.totalContent}`);
      console.log(`Pinned:         ${r.pinnedCount}`);
      console.log(`Encrypted:      ${r.encryptedCount}`);
      console.log(`Total bytes:    ${r.totalBytes}`);
      console.log(`Pinned bytes:   ${r.pinnedBytes}`);
      console.log(`Quota:          ${r.quotaBytes}`);
      console.log(`Usage:          ${r.usagePercent}%`);
    });

  ipfs
    .command("gc")
    .description("Garbage-collect unpinned content")
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(ipfs);
      const r = garbageCollect(db);
      if (opts.json) return console.log(JSON.stringify(r, null, 2));
      console.log(
        `Removed ${r.removed} entries, freed ${r.freedBytes} bytes (${r.before} → ${r.after})`,
      );
    });

  ipfs
    .command("set-quota <bytes>")
    .description("Set storage quota (bytes)")
    .option("--json", "JSON output")
    .action((bytes, opts) => {
      const db = _dbFromCtx(ipfs);
      const r = setQuota(db, bytes);
      if (opts.json) return console.log(JSON.stringify(r, null, 2));
      if (!r.set) return console.log(`Failed: ${r.reason}`);
      console.log(`Quota set to ${r.quotaBytes} bytes`);
    });

  /* ── Knowledge attachments ────────────────────────── */

  ipfs
    .command("attach <knowledgeId>")
    .description("Attach content to a knowledge item (auto-pinned)")
    .option("-f, --file <path>", "Read content from file")
    .option("-t, --text <text>", "Inline text content")
    .option("--filename <name>", "Filename metadata")
    .option("--mime <type>", "MIME type")
    .option("--json", "JSON output")
    .action((knowledgeId, opts) => {
      const db = _dbFromCtx(ipfs);
      const content = _readContent({ file: opts.file, text: opts.text });
      if (content == null) return console.log("Must provide --file or --text");
      const r = addKnowledgeAttachment(db, knowledgeId, content, {
        filename: opts.filename,
        mimeType: opts.mime,
      });
      if (opts.json) return console.log(JSON.stringify(r, null, 2));
      if (!r.added) return console.log(`Failed: ${r.reason}`);
      console.log(
        `Attached cid=${r.cid} size=${r.size} to knowledge=${knowledgeId}`,
      );
    });

  ipfs
    .command("attachments <knowledgeId>")
    .description("List attachments for a knowledge item")
    .option("--json", "JSON output")
    .action((knowledgeId, opts) => {
      const db = _dbFromCtx(ipfs);
      const rows = getKnowledgeAttachments(db, knowledgeId);
      if (opts.json) return console.log(JSON.stringify(rows, null, 2));
      if (rows.length === 0) return console.log("No attachments");
      for (const r of rows)
        console.log(
          `  ${r.cid.slice(0, 16)}…  ${String(r.size).padStart(7)}  ${r.filename || "(unnamed)"}`,
        );
    });

  program.addCommand(ipfs);
}
