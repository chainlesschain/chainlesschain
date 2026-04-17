/**
 * `cc multimodal` — CLI surface for Phase 27 多模态协作.
 *
 * Exposes 5-modality weighted fusion, doc parsing (txt/md/csv/json),
 * context building with 4000-token cap, and 6 output formats.
 */

import fs from "fs";
import { Command } from "commander";

import {
  MODALITIES,
  MODALITY_WEIGHTS,
  INPUT_FORMATS,
  NATIVE_FORMATS,
  OUTPUT_FORMATS,
  SESSION_STATUS,
  DEFAULT_MAX_TOKENS,
  ensureMultimodalTables,
  createSession,
  getSession,
  listSessions,
  completeSession,
  deleteSession,
  addModality,
  getSessionModalities,
  fuse,
  parseDocument,
  getSupportedFormats,
  buildContext,
  getContext,
  clearContext,
  trimContext,
  generateOutput,
  getOutputFormats,
  listArtifacts,
  getMultimodalStats,
  // V2 (Phase 27 V2)
  SESSION_MATURITY_V2,
  ARTIFACT_LIFECYCLE_V2,
  getDefaultMaxActiveSessionsPerOwnerV2,
  getMaxActiveSessionsPerOwnerV2,
  setMaxActiveSessionsPerOwnerV2,
  getDefaultMaxArtifactsPerSessionV2,
  getMaxArtifactsPerSessionV2,
  setMaxArtifactsPerSessionV2,
  getDefaultSessionIdleMsV2,
  getSessionIdleMsV2,
  setSessionIdleMsV2,
  getDefaultArtifactStaleMsV2,
  getArtifactStaleMsV2,
  setArtifactStaleMsV2,
  registerSessionV2,
  getSessionV2,
  setSessionMaturityV2,
  activateSession,
  pauseSession,
  completeSessionV2,
  archiveSession,
  touchSessionActivity,
  registerArtifactV2,
  getArtifactV2,
  setArtifactStatusV2,
  markArtifactReady,
  purgeArtifact,
  touchArtifactAccess,
  getActiveSessionCount,
  getArtifactCount,
  autoArchiveIdleSessions,
  autoPurgeStaleArtifacts,
  getMultimodalStatsV2,
} from "../lib/multimodal.js";

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

function _readData(opts) {
  if (opts.file) return fs.readFileSync(opts.file, "utf-8");
  if (opts.text != null) return opts.text;
  if (opts.data != null) return _parseJson(opts.data);
  return null;
}

export function registerMultimodalCommand(program) {
  const mm = new Command("multimodal")
    .alias("mm")
    .description("Multimodal collaboration (Phase 27)")
    .hook("preAction", (thisCmd) => {
      const db = _dbFromCtx(thisCmd);
      if (db) ensureMultimodalTables(db);
    });

  /* ── Catalogs ─────────────────────────────────────── */

  mm.command("modalities")
    .description("List 5 input modalities with weights")
    .option("--json", "JSON output")
    .action((opts) => {
      const rows = MODALITIES.map((m) => ({
        modality: m,
        weight: MODALITY_WEIGHTS[m],
      }));
      if (opts.json) return console.log(JSON.stringify(rows, null, 2));
      for (const r of rows)
        console.log(`  ${r.modality.padEnd(10)} weight=${r.weight}`);
    });

  mm.command("input-formats")
    .description("List 7 supported document formats (4 native)")
    .option("--json", "JSON output")
    .action((opts) => {
      const r = getSupportedFormats();
      if (opts.json) return console.log(JSON.stringify(r, null, 2));
      console.log("Formats:", r.formats.join(", "));
      console.log("Native:  ", r.native.join(", "));
    });

  mm.command("output-formats")
    .description("List 6 output formats")
    .option("--json", "JSON output")
    .action((opts) => {
      const r = getOutputFormats();
      if (opts.json) return console.log(JSON.stringify(r, null, 2));
      for (const f of r) console.log(`  ${f}`);
    });

  mm.command("statuses")
    .description("List session statuses")
    .option("--json", "JSON output")
    .action((opts) => {
      const s = Object.values(SESSION_STATUS);
      if (opts.json) return console.log(JSON.stringify(s, null, 2));
      for (const x of s) console.log(`  ${x}`);
    });

  /* ── Sessions ─────────────────────────────────────── */

  mm.command("session-create")
    .description("Create a multimodal session")
    .option("-t, --title <title>", "Session title")
    .option("-m, --meta <json>", "Metadata JSON")
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(mm);
      const r = createSession(db, {
        title: opts.title,
        metadata: _parseJson(opts.meta),
      });
      if (opts.json) return console.log(JSON.stringify(r, null, 2));
      console.log(`Session created: ${r.sessionId}`);
    });

  mm.command("session-show <sessionId>")
    .description("Show session details")
    .option("--json", "JSON output")
    .action((sessionId, opts) => {
      const db = _dbFromCtx(mm);
      const s = getSession(db, sessionId);
      if (!s) return console.log("Not found");
      if (opts.json) return console.log(JSON.stringify(s, null, 2));
      console.log(`ID:         ${s.id}`);
      console.log(`Status:     ${s.status}`);
      console.log(`Modalities: ${s.modalities.join(", ") || "-"}`);
      console.log(`Tokens:     ${s.tokenCount}`);
      console.log(`Created:    ${new Date(s.createdAt).toISOString()}`);
    });

  mm.command("sessions")
    .description("List sessions")
    .option("-s, --status <status>", "Filter by status")
    .option("-n, --limit <n>", "Limit", (v) => parseInt(v, 10), 50)
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(mm);
      const rows = listSessions(db, { status: opts.status, limit: opts.limit });
      if (opts.json) return console.log(JSON.stringify(rows, null, 2));
      if (rows.length === 0) return console.log("No sessions");
      for (const r of rows)
        console.log(
          `  ${r.id.slice(0, 8)}…  ${r.status.padEnd(10)}  tok=${String(r.tokenCount).padStart(5)}  [${r.modalities.join(",")}]`,
        );
    });

  mm.command("session-complete <sessionId>")
    .description("Mark session as completed")
    .option("--json", "JSON output")
    .action((sessionId, opts) => {
      const db = _dbFromCtx(mm);
      const r = completeSession(db, sessionId);
      if (opts.json) return console.log(JSON.stringify(r, null, 2));
      if (!r.completed) return console.log(`Failed: ${r.reason}`);
      console.log("Session completed");
    });

  mm.command("session-delete <sessionId>")
    .description("Delete session and all artifacts")
    .option("--json", "JSON output")
    .action((sessionId, opts) => {
      const db = _dbFromCtx(mm);
      const r = deleteSession(db, sessionId);
      if (opts.json) return console.log(JSON.stringify(r, null, 2));
      if (!r.deleted) return console.log(`Failed: ${r.reason}`);
      console.log("Session deleted");
    });

  /* ── Modalities ───────────────────────────────────── */

  mm.command("add <sessionId>")
    .description("Add a modality input to a session")
    .requiredOption(
      "-m, --modality <type>",
      "Modality (text|document|image|audio|screen)",
    )
    .option("-f, --file <path>", "Read content from file")
    .option("-t, --text <text>", "Inline text content")
    .option("-d, --data <json>", "Inline JSON content")
    .option("--meta <json>", "Metadata JSON")
    .option("--json", "JSON output")
    .action((sessionId, opts) => {
      const db = _dbFromCtx(mm);
      const data = _readData(opts);
      if (data == null)
        return console.log("Must provide --file, --text, or --data");
      const r = addModality(db, sessionId, opts.modality, data, {
        metadata: _parseJson(opts.meta),
      });
      if (opts.json) return console.log(JSON.stringify(r, null, 2));
      if (!r.added) return console.log(`Failed: ${r.reason}`);
      console.log(`Added ${r.modality} modality (artifact=${r.artifactId})`);
    });

  mm.command("modalities-of <sessionId>")
    .description("List modalities added to a session")
    .option("--json", "JSON output")
    .action((sessionId, opts) => {
      const db = _dbFromCtx(mm);
      const r = getSessionModalities(db, sessionId);
      if (opts.json) return console.log(JSON.stringify(r, null, 2));
      for (const [m, items] of Object.entries(r))
        console.log(`  ${m.padEnd(10)} ${items.length} item(s)`);
    });

  mm.command("fuse <sessionId>")
    .description("Weighted fusion of all input artifacts")
    .option("--json", "JSON output")
    .action((sessionId, opts) => {
      const db = _dbFromCtx(mm);
      const r = fuse(db, sessionId);
      if (opts.json) return console.log(JSON.stringify(r, null, 2));
      if (!r.fused) return console.log(`Failed: ${r.reason}`);
      console.log(
        `Fused ${r.summary.length} modalities (weight=${r.totalWeight}, tokens~${r.tokenEstimate})`,
      );
      for (const s of r.summary)
        console.log(`  ${s.modality.padEnd(10)} n=${s.count} w=${s.weight}`);
    });

  /* ── Parsing ──────────────────────────────────────── */

  mm.command("parse <filePath>")
    .description("Parse a document (txt/md/csv/json native)")
    .option("--json", "JSON output")
    .action((filePath, opts) => {
      const r = parseDocument(filePath);
      if (opts.json) return console.log(JSON.stringify(r, null, 2));
      if (!r.parsed)
        return console.log(
          `Failed: ${r.reason}${r.hint ? `\n  ${r.hint}` : ""}`,
        );
      console.log(
        `Parsed ${r.format}: length=${r.length}, tokens~${r.tokenEstimate}`,
      );
      if (r.rowCount != null) console.log(`Rows: ${r.rowCount}`);
    });

  /* ── Context ──────────────────────────────────────── */

  mm.command("build-context <sessionId>")
    .description("Build context from session artifacts")
    .option(
      "-t, --max-tokens <n>",
      "Max tokens",
      (v) => parseInt(v, 10),
      DEFAULT_MAX_TOKENS,
    )
    .option("--json", "JSON output")
    .action((sessionId, opts) => {
      const db = _dbFromCtx(mm);
      const r = buildContext(db, sessionId, { maxTokens: opts.maxTokens });
      if (opts.json) return console.log(JSON.stringify(r, null, 2));
      if (!r.built) return console.log(`Failed: ${r.reason}`);
      console.log(
        `Built context: ${r.tokens}/${r.maxTokens} tokens across ${r.itemCount} items`,
      );
    });

  mm.command("get-context <sessionId>")
    .description("Get cached/stored context")
    .option("--json", "JSON output")
    .action((sessionId, opts) => {
      const db = _dbFromCtx(mm);
      const r = getContext(db, sessionId);
      if (!r) return console.log("No context built yet");
      if (opts.json) return console.log(JSON.stringify(r, null, 2));
      console.log(`Tokens: ${r.tokens}/${r.maxTokens}`);
      console.log(`Items:  ${r.items?.length || 0}`);
      if (r.content) console.log(`\n--- content ---\n${r.content}`);
    });

  mm.command("clear-context <sessionId>")
    .description("Clear the session's context")
    .option("--json", "JSON output")
    .action((sessionId, opts) => {
      const db = _dbFromCtx(mm);
      const r = clearContext(db, sessionId);
      if (opts.json) return console.log(JSON.stringify(r, null, 2));
      if (!r.cleared) return console.log(`Failed: ${r.reason}`);
      console.log("Context cleared");
    });

  mm.command("trim-context <sessionId>")
    .description("Trim current context to max tokens")
    .requiredOption("-t, --max-tokens <n>", "Max tokens", (v) =>
      parseInt(v, 10),
    )
    .option("--json", "JSON output")
    .action((sessionId, opts) => {
      const db = _dbFromCtx(mm);
      const ctx = getContext(db, sessionId);
      if (!ctx) return console.log("No context built yet");
      const r = trimContext(ctx, opts.maxTokens);
      if (opts.json) return console.log(JSON.stringify(r, null, 2));
      if (!r.trimmed) return console.log(`Failed: ${r.reason}`);
      console.log(
        `Trimmed to ${r.tokens}/${r.maxTokens} tokens (${r.items.length} items)`,
      );
    });

  /* ── Output generation ────────────────────────────── */

  mm.command("generate")
    .description("Generate output in one of 6 formats")
    .requiredOption("-f, --format <format>", "Output format")
    .option("-s, --session <id>", "Session to attach artifact")
    .option("-c, --content <text>", "Inline content")
    .option("--file <path>", "Read content from file")
    .option("--data <json>", "Inline JSON content")
    .option("-o, --out <path>", "Write output to file")
    .option("--title <title>", "Optional title")
    .option("--chart-type <type>", "Chart type for chart format", "line")
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(mm);
      let content;
      if (opts.file) content = fs.readFileSync(opts.file, "utf-8");
      else if (opts.data) content = _parseJson(opts.data);
      else content = opts.content ?? "";
      const r = generateOutput(db, opts.session, content, opts.format, {
        title: opts.title,
        chartType: opts.chartType,
      });
      if (!r.generated)
        return console.log(
          `Failed: ${r.reason}${r.format ? ` (format=${r.format})` : ""}`,
        );
      if (opts.out) {
        fs.writeFileSync(opts.out, r.content);
        console.log(`Wrote ${r.size} bytes to ${opts.out}`);
        return;
      }
      if (opts.json) return console.log(JSON.stringify(r, null, 2));
      console.log(`--- ${r.format} (${r.size} bytes) ---`);
      console.log(r.content);
    });

  /* ── Artifacts ────────────────────────────────────── */

  mm.command("artifacts <sessionId>")
    .description("List artifacts for a session")
    .option("-t, --type <type>", "input|output")
    .option("-m, --modality <m>", "Filter by modality")
    .option("-n, --limit <n>", "Limit", (v) => parseInt(v, 10), 100)
    .option("--json", "JSON output")
    .action((sessionId, opts) => {
      const db = _dbFromCtx(mm);
      const rows = listArtifacts(db, sessionId, {
        type: opts.type,
        modality: opts.modality,
        limit: opts.limit,
      });
      if (opts.json) return console.log(JSON.stringify(rows, null, 2));
      if (rows.length === 0) return console.log("No artifacts");
      for (const a of rows) {
        const head =
          typeof a.content === "string"
            ? a.content.slice(0, 40).replace(/\n/g, " ")
            : "(json)";
        console.log(
          `  ${a.id.slice(0, 8)}…  ${a.type.padEnd(6)}  ${(a.modality || a.format || "-").padEnd(10)}  ${head}`,
        );
      }
    });

  /* ── Stats ────────────────────────────────────────── */

  mm.command("stats")
    .description("Multimodal system statistics")
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(mm);
      const s = getMultimodalStats(db);
      if (opts.json) return console.log(JSON.stringify(s, null, 2));
      console.log(`Sessions:  ${s.sessions}`);
      console.log(
        `Artifacts: ${s.artifacts} (in=${s.inputs}, out=${s.outputs})`,
      );
      console.log(`Tokens:    ${s.totalTokens}`);
      console.log("By status:");
      for (const [k, v] of Object.entries(s.byStatus))
        console.log(`  ${k}: ${v}`);
      console.log("By modality:");
      for (const [k, v] of Object.entries(s.byModality))
        console.log(`  ${k}: ${v}`);
    });

  /* ── V2 (Phase 27 V2) ────────────────────────────── */

  function _parseJsonFlag(value, label) {
    if (value === undefined) return undefined;
    try {
      return JSON.parse(value);
    } catch {
      throw new Error(`Invalid JSON for ${label}`);
    }
  }

  mm.command("session-maturities-v2")
    .option("--json", "JSON output")
    .description("List V2 session maturity states")
    .action((opts) => {
      const out = Object.values(SESSION_MATURITY_V2);
      if (opts.json) return console.log(JSON.stringify(out, null, 2));
      for (const s of out) console.log(`  ${s}`);
    });

  mm.command("artifact-lifecycles-v2")
    .option("--json", "JSON output")
    .description("List V2 artifact lifecycle states")
    .action((opts) => {
      const out = Object.values(ARTIFACT_LIFECYCLE_V2);
      if (opts.json) return console.log(JSON.stringify(out, null, 2));
      for (const s of out) console.log(`  ${s}`);
    });

  mm.command("default-max-active-sessions-per-owner")
    .description("Show V2 default per-owner active-session cap")
    .action(() => console.log(String(getDefaultMaxActiveSessionsPerOwnerV2())));
  mm.command("max-active-sessions-per-owner")
    .description("Show current V2 per-owner active-session cap")
    .action(() => console.log(String(getMaxActiveSessionsPerOwnerV2())));
  mm.command("set-max-active-sessions-per-owner <n>")
    .description("Set V2 per-owner active-session cap")
    .action((n) =>
      console.log(String(setMaxActiveSessionsPerOwnerV2(Number(n)))),
    );

  mm.command("default-max-artifacts-per-session")
    .description("Show V2 default per-session artifact cap")
    .action(() => console.log(String(getDefaultMaxArtifactsPerSessionV2())));
  mm.command("max-artifacts-per-session")
    .description("Show current V2 per-session artifact cap")
    .action(() => console.log(String(getMaxArtifactsPerSessionV2())));
  mm.command("set-max-artifacts-per-session <n>")
    .description("Set V2 per-session artifact cap")
    .action((n) => console.log(String(setMaxArtifactsPerSessionV2(Number(n)))));

  mm.command("default-session-idle-ms")
    .description("Show V2 default session-idle window (ms)")
    .action(() => console.log(String(getDefaultSessionIdleMsV2())));
  mm.command("session-idle-ms")
    .description("Show current V2 session-idle window (ms)")
    .action(() => console.log(String(getSessionIdleMsV2())));
  mm.command("set-session-idle-ms <ms>")
    .description("Set V2 session-idle window (ms)")
    .action((ms) => console.log(String(setSessionIdleMsV2(Number(ms)))));

  mm.command("default-artifact-stale-ms")
    .description("Show V2 default artifact-stale window (ms)")
    .action(() => console.log(String(getDefaultArtifactStaleMsV2())));
  mm.command("artifact-stale-ms")
    .description("Show current V2 artifact-stale window (ms)")
    .action(() => console.log(String(getArtifactStaleMsV2())));
  mm.command("set-artifact-stale-ms <ms>")
    .description("Set V2 artifact-stale window (ms)")
    .action((ms) => console.log(String(setArtifactStaleMsV2(Number(ms)))));

  mm.command("active-session-count")
    .description("Count active V2 sessions (optionally scoped by owner)")
    .option("-o, --owner <owner>", "Scope by owner")
    .action((opts) => console.log(String(getActiveSessionCount(opts.owner))));

  mm.command("artifact-count")
    .description("Count open V2 artifacts (optionally scoped by session)")
    .option("-s, --session <session>", "Scope by session")
    .action((opts) => console.log(String(getArtifactCount(opts.session))));

  mm.command("register-session-v2 <session-id>")
    .description("Register a V2 session")
    .requiredOption("-o, --owner-id <owner>", "Owner id")
    .option("-t, --title <title>", "Title")
    .option("-i, --initial-status <status>", "Initial maturity status")
    .option("-m, --metadata <json>", "Metadata JSON")
    .action((sessionId, opts) => {
      const db = _dbFromCtx(mm);
      const metadata = _parseJsonFlag(opts.metadata, "--metadata");
      console.log(
        JSON.stringify(
          registerSessionV2(db, {
            sessionId,
            ownerId: opts.ownerId,
            title: opts.title,
            initialStatus: opts.initialStatus,
            metadata,
          }),
          null,
          2,
        ),
      );
    });

  mm.command("session-v2 <session-id>")
    .description("Show a V2 session")
    .action((sessionId) => {
      const out = getSessionV2(sessionId);
      console.log(out ? JSON.stringify(out, null, 2) : "null");
    });

  mm.command("set-session-maturity-v2 <session-id> <status>")
    .description("Set V2 session maturity status")
    .option("-r, --reason <reason>", "Reason")
    .option("-m, --metadata <json>", "Metadata JSON (merged)")
    .action((sessionId, status, opts) => {
      const db = _dbFromCtx(mm);
      const metadata = _parseJsonFlag(opts.metadata, "--metadata");
      console.log(
        JSON.stringify(
          setSessionMaturityV2(db, sessionId, status, {
            reason: opts.reason,
            metadata,
          }),
          null,
          2,
        ),
      );
    });

  mm.command("activate-session <session-id>")
    .option("-r, --reason <reason>")
    .description("Activate a V2 session")
    .action((id, opts) => {
      const db = _dbFromCtx(mm);
      console.log(
        JSON.stringify(activateSession(db, id, opts.reason), null, 2),
      );
    });
  mm.command("pause-session <session-id>")
    .option("-r, --reason <reason>")
    .description("Pause a V2 session")
    .action((id, opts) => {
      const db = _dbFromCtx(mm);
      console.log(JSON.stringify(pauseSession(db, id, opts.reason), null, 2));
    });
  mm.command("complete-session-v2 <session-id>")
    .option("-r, --reason <reason>")
    .description("Complete a V2 session")
    .action((id, opts) => {
      const db = _dbFromCtx(mm);
      console.log(
        JSON.stringify(completeSessionV2(db, id, opts.reason), null, 2),
      );
    });
  mm.command("archive-session <session-id>")
    .option("-r, --reason <reason>")
    .description("Archive a V2 session")
    .action((id, opts) => {
      const db = _dbFromCtx(mm);
      console.log(JSON.stringify(archiveSession(db, id, opts.reason), null, 2));
    });
  mm.command("touch-session-activity <session-id>")
    .description("Bump lastActivityAt on a V2 session")
    .action((id) =>
      console.log(JSON.stringify(touchSessionActivity(id), null, 2)),
    );

  mm.command("register-artifact-v2 <artifact-id>")
    .description("Register a V2 artifact")
    .requiredOption("-s, --session-id <session>", "Session id")
    .requiredOption(
      "-M, --modality <modality>",
      "Modality (text/document/image/audio/screen)",
    )
    .option("-z, --size <bytes>", "Size in bytes", (v) => Number(v))
    .option("-i, --initial-status <status>", "Initial lifecycle status")
    .option("-m, --metadata <json>", "Metadata JSON")
    .action((artifactId, opts) => {
      const db = _dbFromCtx(mm);
      const metadata = _parseJsonFlag(opts.metadata, "--metadata");
      console.log(
        JSON.stringify(
          registerArtifactV2(db, {
            artifactId,
            sessionId: opts.sessionId,
            modality: opts.modality,
            size: opts.size,
            initialStatus: opts.initialStatus,
            metadata,
          }),
          null,
          2,
        ),
      );
    });

  mm.command("artifact-v2 <artifact-id>")
    .description("Show a V2 artifact")
    .action((id) => {
      const out = getArtifactV2(id);
      console.log(out ? JSON.stringify(out, null, 2) : "null");
    });

  mm.command("set-artifact-status-v2 <artifact-id> <status>")
    .option("-r, --reason <reason>")
    .option("-m, --metadata <json>")
    .description("Set V2 artifact lifecycle status")
    .action((id, status, opts) => {
      const db = _dbFromCtx(mm);
      const metadata = _parseJsonFlag(opts.metadata, "--metadata");
      console.log(
        JSON.stringify(
          setArtifactStatusV2(db, id, status, {
            reason: opts.reason,
            metadata,
          }),
          null,
          2,
        ),
      );
    });

  mm.command("mark-artifact-ready <artifact-id>")
    .option("-r, --reason <reason>")
    .description("Mark V2 artifact ready")
    .action((id, opts) => {
      const db = _dbFromCtx(mm);
      console.log(
        JSON.stringify(markArtifactReady(db, id, opts.reason), null, 2),
      );
    });
  mm.command("purge-artifact <artifact-id>")
    .option("-r, --reason <reason>")
    .description("Purge a V2 artifact")
    .action((id, opts) => {
      const db = _dbFromCtx(mm);
      console.log(JSON.stringify(purgeArtifact(db, id, opts.reason), null, 2));
    });
  mm.command("touch-artifact-access <artifact-id>")
    .description("Bump lastAccessAt on a V2 artifact")
    .action((id) =>
      console.log(JSON.stringify(touchArtifactAccess(id), null, 2)),
    );

  mm.command("auto-archive-idle-sessions")
    .description("Auto-flip idle V2 sessions to ARCHIVED")
    .action(() => {
      const db = _dbFromCtx(mm);
      console.log(JSON.stringify(autoArchiveIdleSessions(db), null, 2));
    });
  mm.command("auto-purge-stale-artifacts")
    .description("Auto-flip stale READY V2 artifacts to PURGED")
    .action(() => {
      const db = _dbFromCtx(mm);
      console.log(JSON.stringify(autoPurgeStaleArtifacts(db), null, 2));
    });
  mm.command("stats-v2")
    .description("V2 multimodal stats (counts by state + config)")
    .action(() => console.log(JSON.stringify(getMultimodalStatsV2(), null, 2)));

  program.addCommand(mm);
}
