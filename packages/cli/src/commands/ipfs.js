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
  // V2 (Phase 17 V2)
  GATEWAY_MATURITY_V2,
  PIN_LIFECYCLE_V2,
  getDefaultMaxActiveGatewaysPerOperatorV2,
  getMaxActiveGatewaysPerOperatorV2,
  setMaxActiveGatewaysPerOperatorV2,
  getDefaultMaxPendingPinsPerOwnerV2,
  getMaxPendingPinsPerOwnerV2,
  setMaxPendingPinsPerOwnerV2,
  getDefaultGatewayIdleMsV2,
  getGatewayIdleMsV2,
  setGatewayIdleMsV2,
  getDefaultPinPendingMsV2,
  getPinPendingMsV2,
  setPinPendingMsV2,
  registerGatewayV2,
  getGatewayV2,
  setGatewayMaturityV2,
  activateGateway,
  degradeGateway,
  offlineGateway,
  retireGateway,
  touchGatewayHeartbeat,
  registerPinV2,
  getPinV2,
  setPinStatusV2,
  confirmPin,
  failPin,
  unpinV2,
  getActiveGatewayCount,
  getPendingPinCount,
  autoOfflineStaleGateways,
  autoFailStalePendingPins,
  getIpfsStatsV2,
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

  /* ── V2 (Phase 17 V2) ────────────────────────────── */

  function _parseJsonFlag(value, label) {
    if (value === undefined) return undefined;
    try {
      return JSON.parse(value);
    } catch {
      throw new Error(`Invalid JSON for ${label}`);
    }
  }

  ipfs
    .command("gateway-maturities-v2")
    .option("--json", "JSON output")
    .description("List V2 gateway maturity states")
    .action((opts) => {
      const out = Object.values(GATEWAY_MATURITY_V2);
      if (opts.json) return console.log(JSON.stringify(out, null, 2));
      for (const s of out) console.log(`  ${s}`);
    });
  ipfs
    .command("pin-lifecycles-v2")
    .option("--json", "JSON output")
    .description("List V2 pin lifecycle states")
    .action((opts) => {
      const out = Object.values(PIN_LIFECYCLE_V2);
      if (opts.json) return console.log(JSON.stringify(out, null, 2));
      for (const s of out) console.log(`  ${s}`);
    });

  ipfs
    .command("default-max-active-gateways-per-operator")
    .description("Show V2 default per-operator active-gateway cap")
    .action(() =>
      console.log(String(getDefaultMaxActiveGatewaysPerOperatorV2())),
    );
  ipfs
    .command("max-active-gateways-per-operator")
    .description("Show current V2 per-operator active-gateway cap")
    .action(() => console.log(String(getMaxActiveGatewaysPerOperatorV2())));
  ipfs
    .command("set-max-active-gateways-per-operator <n>")
    .description("Set V2 per-operator active-gateway cap")
    .action((n) =>
      console.log(String(setMaxActiveGatewaysPerOperatorV2(Number(n)))),
    );

  ipfs
    .command("default-max-pending-pins-per-owner")
    .description("Show V2 default per-owner pending-pin cap")
    .action(() => console.log(String(getDefaultMaxPendingPinsPerOwnerV2())));
  ipfs
    .command("max-pending-pins-per-owner")
    .description("Show current V2 per-owner pending-pin cap")
    .action(() => console.log(String(getMaxPendingPinsPerOwnerV2())));
  ipfs
    .command("set-max-pending-pins-per-owner <n>")
    .description("Set V2 per-owner pending-pin cap")
    .action((n) => console.log(String(setMaxPendingPinsPerOwnerV2(Number(n)))));

  ipfs
    .command("default-gateway-idle-ms")
    .description("Show V2 default gateway-idle window (ms)")
    .action(() => console.log(String(getDefaultGatewayIdleMsV2())));
  ipfs
    .command("gateway-idle-ms")
    .description("Show current V2 gateway-idle window (ms)")
    .action(() => console.log(String(getGatewayIdleMsV2())));
  ipfs
    .command("set-gateway-idle-ms <ms>")
    .description("Set V2 gateway-idle window (ms)")
    .action((ms) => console.log(String(setGatewayIdleMsV2(Number(ms)))));

  ipfs
    .command("default-pin-pending-ms")
    .description("Show V2 default pin-pending window (ms)")
    .action(() => console.log(String(getDefaultPinPendingMsV2())));
  ipfs
    .command("pin-pending-ms")
    .description("Show current V2 pin-pending window (ms)")
    .action(() => console.log(String(getPinPendingMsV2())));
  ipfs
    .command("set-pin-pending-ms <ms>")
    .description("Set V2 pin-pending window (ms)")
    .action((ms) => console.log(String(setPinPendingMsV2(Number(ms)))));

  ipfs
    .command("active-gateway-count")
    .description("Count active V2 gateways (optionally scoped by operator)")
    .option("-o, --operator <operator>", "Scope by operator")
    .action((opts) =>
      console.log(String(getActiveGatewayCount(opts.operator))),
    );
  ipfs
    .command("pending-pin-count")
    .description("Count pending V2 pins (optionally scoped by owner)")
    .option("-o, --owner <owner>", "Scope by owner")
    .action((opts) => console.log(String(getPendingPinCount(opts.owner))));

  ipfs
    .command("register-gateway-v2 <gateway-id>")
    .description("Register a V2 gateway")
    .requiredOption("-o, --operator-id <operator>", "Operator id")
    .requiredOption("-e, --endpoint <url>", "Endpoint URL")
    .option("-i, --initial-status <status>", "Initial maturity status")
    .option("-m, --metadata <json>", "Metadata JSON")
    .action((gatewayId, opts) => {
      const db = _dbFromCtx(ipfs);
      const metadata = _parseJsonFlag(opts.metadata, "--metadata");
      console.log(
        JSON.stringify(
          registerGatewayV2(db, {
            gatewayId,
            operatorId: opts.operatorId,
            endpoint: opts.endpoint,
            initialStatus: opts.initialStatus,
            metadata,
          }),
          null,
          2,
        ),
      );
    });
  ipfs
    .command("gateway-v2 <gateway-id>")
    .description("Show a V2 gateway")
    .action((id) => {
      const out = getGatewayV2(id);
      console.log(out ? JSON.stringify(out, null, 2) : "null");
    });
  ipfs
    .command("set-gateway-maturity-v2 <gateway-id> <status>")
    .option("-r, --reason <reason>")
    .option("-m, --metadata <json>")
    .description("Set V2 gateway maturity status")
    .action((id, status, opts) => {
      const db = _dbFromCtx(ipfs);
      const metadata = _parseJsonFlag(opts.metadata, "--metadata");
      console.log(
        JSON.stringify(
          setGatewayMaturityV2(db, id, status, {
            reason: opts.reason,
            metadata,
          }),
          null,
          2,
        ),
      );
    });
  ipfs
    .command("activate-gateway <gateway-id>")
    .option("-r, --reason <reason>")
    .description("Activate a V2 gateway")
    .action((id, opts) => {
      const db = _dbFromCtx(ipfs);
      console.log(
        JSON.stringify(activateGateway(db, id, opts.reason), null, 2),
      );
    });
  ipfs
    .command("degrade-gateway <gateway-id>")
    .option("-r, --reason <reason>")
    .description("Degrade a V2 gateway")
    .action((id, opts) => {
      const db = _dbFromCtx(ipfs);
      console.log(JSON.stringify(degradeGateway(db, id, opts.reason), null, 2));
    });
  ipfs
    .command("offline-gateway <gateway-id>")
    .option("-r, --reason <reason>")
    .description("Offline a V2 gateway")
    .action((id, opts) => {
      const db = _dbFromCtx(ipfs);
      console.log(JSON.stringify(offlineGateway(db, id, opts.reason), null, 2));
    });
  ipfs
    .command("retire-gateway <gateway-id>")
    .option("-r, --reason <reason>")
    .description("Retire a V2 gateway")
    .action((id, opts) => {
      const db = _dbFromCtx(ipfs);
      console.log(JSON.stringify(retireGateway(db, id, opts.reason), null, 2));
    });
  ipfs
    .command("touch-gateway-heartbeat <gateway-id>")
    .description("Bump lastHeartbeatAt on a V2 gateway")
    .action((id) =>
      console.log(JSON.stringify(touchGatewayHeartbeat(id), null, 2)),
    );

  ipfs
    .command("register-pin-v2 <pin-id>")
    .description("Register a V2 pin request")
    .requiredOption("-o, --owner-id <owner>", "Owner id")
    .requiredOption("-c, --cid <cid>", "CID")
    .option("-i, --initial-status <status>", "Initial lifecycle status")
    .option("-m, --metadata <json>", "Metadata JSON")
    .action((pinId, opts) => {
      const db = _dbFromCtx(ipfs);
      const metadata = _parseJsonFlag(opts.metadata, "--metadata");
      console.log(
        JSON.stringify(
          registerPinV2(db, {
            pinId,
            ownerId: opts.ownerId,
            cid: opts.cid,
            initialStatus: opts.initialStatus,
            metadata,
          }),
          null,
          2,
        ),
      );
    });
  ipfs
    .command("pin-v2 <pin-id>")
    .description("Show a V2 pin record")
    .action((id) => {
      const out = getPinV2(id);
      console.log(out ? JSON.stringify(out, null, 2) : "null");
    });
  ipfs
    .command("set-pin-status-v2 <pin-id> <status>")
    .option("-r, --reason <reason>")
    .option("-m, --metadata <json>")
    .description("Set V2 pin lifecycle status")
    .action((id, status, opts) => {
      const db = _dbFromCtx(ipfs);
      const metadata = _parseJsonFlag(opts.metadata, "--metadata");
      console.log(
        JSON.stringify(
          setPinStatusV2(db, id, status, {
            reason: opts.reason,
            metadata,
          }),
          null,
          2,
        ),
      );
    });
  ipfs
    .command("confirm-pin <pin-id>")
    .option("-r, --reason <reason>")
    .description("Confirm a V2 pin (pending -> pinned)")
    .action((id, opts) => {
      const db = _dbFromCtx(ipfs);
      console.log(JSON.stringify(confirmPin(db, id, opts.reason), null, 2));
    });
  ipfs
    .command("fail-pin <pin-id>")
    .option("-r, --reason <reason>")
    .description("Fail a V2 pin")
    .action((id, opts) => {
      const db = _dbFromCtx(ipfs);
      console.log(JSON.stringify(failPin(db, id, opts.reason), null, 2));
    });
  ipfs
    .command("unpin-v2 <pin-id>")
    .option("-r, --reason <reason>")
    .description("Unpin a V2 pin (terminal)")
    .action((id, opts) => {
      const db = _dbFromCtx(ipfs);
      console.log(JSON.stringify(unpinV2(db, id, opts.reason), null, 2));
    });

  ipfs
    .command("auto-offline-stale-gateways")
    .description("Auto-flip stale ACTIVE/DEGRADED V2 gateways to OFFLINE")
    .action(() => {
      const db = _dbFromCtx(ipfs);
      console.log(JSON.stringify(autoOfflineStaleGateways(db), null, 2));
    });
  ipfs
    .command("auto-fail-stale-pending-pins")
    .description("Auto-flip stale PENDING V2 pins to FAILED")
    .action(() => {
      const db = _dbFromCtx(ipfs);
      console.log(JSON.stringify(autoFailStalePendingPins(db), null, 2));
    });
  ipfs
    .command("stats-v2")
    .description("V2 IPFS stats (counts by state + config)")
    .action(() => console.log(JSON.stringify(getIpfsStatsV2(), null, 2)));

  program.addCommand(ipfs);
}
