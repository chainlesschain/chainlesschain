/**
 * `cc perception` — CLI surface for Phase 84 Multimodal Perception Engine.
 */

import { Command } from "commander";

import {
  MODALITY,
  VOICE_STATUS,
  ANALYSIS_TYPE,
  ensurePerceptionTables,
  recordPerception,
  getPerception,
  listPerceptions,
  startVoice,
  updateVoiceStatus,
  setTranscript,
  getVoiceSession,
  listVoiceSessions,
  addIndexEntry,
  getIndexEntry,
  listIndexEntries,
  removeIndexEntry,
  crossModalQuery,
  getPerceptionContext,
  getPerceptionStats,

  // Phase 84 V2
  SENSOR_MATURITY_V2,
  CAPTURE_LIFECYCLE_V2,
  getDefaultMaxActiveSensorsPerOperatorV2,
  getMaxActiveSensorsPerOperatorV2,
  setMaxActiveSensorsPerOperatorV2,
  getDefaultMaxPendingCapturesPerSensorV2,
  getMaxPendingCapturesPerSensorV2,
  setMaxPendingCapturesPerSensorV2,
  getDefaultSensorIdleMsV2,
  getSensorIdleMsV2,
  setSensorIdleMsV2,
  getDefaultCaptureStuckMsV2,
  getCaptureStuckMsV2,
  setCaptureStuckMsV2,
  registerSensorV2,
  getSensorV2,
  setSensorMaturityV2,
  activateSensor,
  degradeSensor,
  offlineSensor,
  retireSensor,
  touchSensorHeartbeat,
  registerCaptureV2,
  getCaptureV2,
  setCaptureStatusV2,
  startProcessingCapture,
  markCaptureReady,
  failCapture,
  discardCapture,
  getActiveSensorCount,
  getPendingCaptureCount,
  autoOfflineStaleSensors,
  autoFailStuckProcessingCaptures,
  getPerceptionStatsV2,
} from "../lib/perception.js";

function _parseMetaV2(raw) {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("--metadata must be valid JSON");
  }
}

function _dbFromCtx(cmd) {
  const root = cmd?.parent?.parent ?? cmd?.parent;
  return root?._db;
}

export function registerPerceptionCommand(program) {
  const perc = new Command("perception")
    .description("Multimodal perception engine (Phase 84)")
    .hook("preAction", (thisCmd) => {
      const db = _dbFromCtx(thisCmd);
      if (db) ensurePerceptionTables(db);
    });

  /* ── Catalogs ────────────────────────────────────── */

  perc
    .command("modalities")
    .description("List supported modalities")
    .option("--json", "JSON output")
    .action((opts) => {
      const mods = Object.values(MODALITY);
      if (opts.json) return console.log(JSON.stringify(mods, null, 2));
      for (const m of mods) console.log(`  ${m}`);
    });

  perc
    .command("voice-statuses")
    .description("List voice session statuses")
    .option("--json", "JSON output")
    .action((opts) => {
      const sts = Object.values(VOICE_STATUS);
      if (opts.json) return console.log(JSON.stringify(sts, null, 2));
      for (const s of sts) console.log(`  ${s}`);
    });

  perc
    .command("analysis-types")
    .description("List analysis types")
    .option("--json", "JSON output")
    .action((opts) => {
      const types = Object.values(ANALYSIS_TYPE);
      if (opts.json) return console.log(JSON.stringify(types, null, 2));
      for (const t of types) console.log(`  ${t}`);
    });

  /* ── Perception Results ──────────────────────────── */

  perc
    .command("record")
    .description("Record a perception result")
    .requiredOption(
      "-m, --modality <type>",
      "Modality (screen/voice/document/video)",
    )
    .option(
      "-a, --analysis <type>",
      "Analysis type (ocr/object_detection/scene_recognition/action_detection)",
    )
    .option("-i, --input <source>", "Input source (file path or session id)")
    .option("-r, --result <json>", "Result data JSON")
    .option("-c, --confidence <n>", "Confidence score (0-1)", parseFloat)
    .option("--metadata <json>", "Metadata JSON")
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(perc);
      const result = recordPerception(db, {
        modality: opts.modality,
        analysisType: opts.analysis,
        inputSource: opts.input,
        resultData: opts.result,
        confidence: opts.confidence,
        metadata: opts.metadata,
      });
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      if (result.recorded)
        console.log(`Perception recorded: ${result.resultId}`);
      else console.log(`Failed: ${result.reason}`);
    });

  perc
    .command("show <id>")
    .description("Show perception result details")
    .option("--json", "JSON output")
    .action((id, opts) => {
      const db = _dbFromCtx(perc);
      const r = getPerception(db, id);
      if (!r) return console.log("Result not found.");
      if (opts.json) return console.log(JSON.stringify(r, null, 2));
      console.log(`ID:         ${r.id}`);
      console.log(`Modality:   ${r.modality}`);
      if (r.analysis_type) console.log(`Analysis:   ${r.analysis_type}`);
      if (r.input_source) console.log(`Source:     ${r.input_source}`);
      console.log(`Confidence: ${r.confidence}`);
      if (r.result_data)
        console.log(`Data:       ${r.result_data.slice(0, 80)}`);
    });

  perc
    .command("results")
    .description("List perception results")
    .option("-m, --modality <type>", "Filter by modality")
    .option("-a, --analysis <type>", "Filter by analysis type")
    .option("--limit <n>", "Max results", parseInt)
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(perc);
      const results = listPerceptions(db, {
        modality: opts.modality,
        analysisType: opts.analysis,
        limit: opts.limit,
      });
      if (opts.json) return console.log(JSON.stringify(results, null, 2));
      if (results.length === 0) return console.log("No results.");
      for (const r of results) {
        console.log(
          `  ${r.modality.padEnd(10)} ${(r.analysis_type || "").padEnd(20)} conf:${String(r.confidence).padEnd(5)} ${(r.input_source || "").padEnd(20)} ${r.id.slice(0, 8)}`,
        );
      }
    });

  /* ── Voice Sessions ──────────────────────────────── */

  perc
    .command("voice-start")
    .description("Start a voice session")
    .option("-l, --language <lang>", "Language code", "zh-CN")
    .option("-m, --model <model>", "ASR model name")
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(perc);
      const result = startVoice(db, {
        language: opts.language,
        model: opts.model,
      });
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      console.log(
        `Voice session started: ${result.sessionId} [${result.status}]`,
      );
    });

  perc
    .command("voice-status <id> <status>")
    .description("Update voice session status")
    .option("--json", "JSON output")
    .action((id, status, opts) => {
      const db = _dbFromCtx(perc);
      const result = updateVoiceStatus(db, id, status);
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      if (result.updated)
        console.log(`Voice session ${id.slice(0, 8)}: ${result.status}`);
      else
        console.log(
          `Failed: ${result.reason}${result.from ? ` (${result.from} → ${result.to})` : ""}`,
        );
    });

  perc
    .command("voice-transcript <id> <text>")
    .description("Set voice session transcript")
    .option("--json", "JSON output")
    .action((id, text, opts) => {
      const db = _dbFromCtx(perc);
      const result = setTranscript(db, id, text);
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      console.log(
        result.updated ? "Transcript set." : `Failed: ${result.reason}`,
      );
    });

  perc
    .command("voice-show <id>")
    .description("Show voice session details")
    .option("--json", "JSON output")
    .action((id, opts) => {
      const db = _dbFromCtx(perc);
      const s = getVoiceSession(db, id);
      if (!s) return console.log("Session not found.");
      if (opts.json) return console.log(JSON.stringify(s, null, 2));
      console.log(`ID:        ${s.id}`);
      console.log(`Status:    ${s.status}`);
      console.log(`Language:  ${s.language}`);
      if (s.model) console.log(`Model:     ${s.model}`);
      if (s.transcript) console.log(`Transcript: ${s.transcript.slice(0, 80)}`);
      console.log(`Duration:  ${s.duration_ms}ms`);
    });

  perc
    .command("voice-sessions")
    .description("List voice sessions")
    .option("-s, --status <status>", "Filter by status")
    .option("-l, --language <lang>", "Filter by language")
    .option("--limit <n>", "Max results", parseInt)
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(perc);
      const sessions = listVoiceSessions(db, {
        status: opts.status,
        language: opts.language,
        limit: opts.limit,
      });
      if (opts.json) return console.log(JSON.stringify(sessions, null, 2));
      if (sessions.length === 0) return console.log("No sessions.");
      for (const s of sessions) {
        console.log(
          `  ${s.status.padEnd(12)} ${s.language.padEnd(8)} ${String(s.duration_ms).padEnd(8)}ms ${s.id.slice(0, 8)}`,
        );
      }
    });

  /* ── Multimodal Index ────────────────────────────── */

  perc
    .command("index-add")
    .description("Add a multimodal index entry")
    .requiredOption("-m, --modality <type>", "Modality")
    .requiredOption("-s, --source <id>", "Source perception result ID")
    .option("-c, --summary <text>", "Content summary")
    .option("-t, --tags <csv>", "Comma-separated tags")
    .option("-e, --embedding <json>", "Embedding vector JSON")
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(perc);
      const tags = opts.tags
        ? opts.tags.split(",").map((t) => t.trim())
        : undefined;
      const result = addIndexEntry(db, {
        modality: opts.modality,
        sourceId: opts.source,
        contentSummary: opts.summary,
        tags,
        embedding: opts.embedding,
      });
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      if (result.added) console.log(`Index entry added: ${result.indexId}`);
      else console.log(`Failed: ${result.reason}`);
    });

  perc
    .command("index-show <id>")
    .description("Show index entry details")
    .option("--json", "JSON output")
    .action((id, opts) => {
      const db = _dbFromCtx(perc);
      const e = getIndexEntry(db, id);
      if (!e) return console.log("Entry not found.");
      if (opts.json) return console.log(JSON.stringify(e, null, 2));
      console.log(`ID:       ${e.id}`);
      console.log(`Modality: ${e.modality}`);
      console.log(`Source:   ${e.source_id}`);
      if (e.content_summary)
        console.log(`Summary:  ${e.content_summary.slice(0, 80)}`);
      if (e.tags) console.log(`Tags:     ${e.tags}`);
    });

  perc
    .command("index-list")
    .description("List index entries")
    .option("-m, --modality <type>", "Filter by modality")
    .option("--limit <n>", "Max results", parseInt)
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(perc);
      const entries = listIndexEntries(db, {
        modality: opts.modality,
        limit: opts.limit,
      });
      if (opts.json) return console.log(JSON.stringify(entries, null, 2));
      if (entries.length === 0) return console.log("No index entries.");
      for (const e of entries) {
        console.log(
          `  ${e.modality.padEnd(10)} ${(e.content_summary || "").slice(0, 40).padEnd(42)} ${e.id.slice(0, 8)}`,
        );
      }
    });

  perc
    .command("index-remove <id>")
    .description("Remove an index entry")
    .option("--json", "JSON output")
    .action((id, opts) => {
      const db = _dbFromCtx(perc);
      const result = removeIndexEntry(db, id);
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      console.log(
        result.removed ? "Entry removed." : `Failed: ${result.reason}`,
      );
    });

  /* ── Cross-Modal Query ───────────────────────────── */

  perc
    .command("query <text>")
    .description("Cross-modal search across index entries")
    .option("-m, --modalities <csv>", "Filter modalities (comma-separated)")
    .option("--limit <n>", "Max results", parseInt)
    .option("--json", "JSON output")
    .action((text, opts) => {
      const db = _dbFromCtx(perc);
      const modalities = opts.modalities
        ? opts.modalities.split(",").map((m) => m.trim())
        : undefined;
      const result = crossModalQuery(db, {
        query: text,
        modalities,
        limit: opts.limit,
      });
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      if (result.results.length === 0) return console.log("No matches.");
      console.log(`Found ${result.total} result(s):`);
      for (const r of result.results) {
        console.log(
          `  score:${String(r.score).padEnd(6)} ${r.modality.padEnd(10)} ${(r.content_summary || "").slice(0, 50)} ${r.id.slice(0, 8)}`,
        );
      }
    });

  /* ── Context & Stats ─────────────────────────────── */

  perc
    .command("context")
    .description("Show current perception context")
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(perc);
      const ctx = getPerceptionContext(db);
      if (opts.json) return console.log(JSON.stringify(ctx, null, 2));
      console.log(`Active sessions: ${ctx.activeSessions}`);
      console.log(`Total results:   ${ctx.totalResults}`);
      console.log(`Index entries:   ${ctx.totalIndexEntries}`);
      console.log("Modality coverage:");
      for (const [mod, count] of Object.entries(ctx.modalityCoverage)) {
        if (count > 0) console.log(`  ${mod.padEnd(10)} ${count}`);
      }
    });

  perc
    .command("stats")
    .description("Perception engine statistics")
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(perc);
      const s = getPerceptionStats(db);
      if (opts.json) return console.log(JSON.stringify(s, null, 2));
      console.log(
        `Results:  ${s.results.total}  (avg confidence: ${s.results.avgConfidence})`,
      );
      for (const [mod, count] of Object.entries(s.results.byModality)) {
        if (count > 0) console.log(`  ${mod.padEnd(10)} ${count}`);
      }
      console.log(
        `Voice:    ${s.voiceSessions.total} total, ${s.voiceSessions.active} active, avg ${s.voiceSessions.avgDurationMs}ms`,
      );
      console.log(`Index:    ${s.index.total} entries`);
    });

  /* ═══════════════════════════════════════════════════ *
   *  Phase 84 V2 — Sensor Maturity + Capture Lifecycle
   * ═══════════════════════════════════════════════════ */

  perc
    .command("sensor-maturities-v2")
    .description("List V2 sensor maturity states")
    .option("--json", "JSON output")
    .action((opts) => {
      const xs = Object.values(SENSOR_MATURITY_V2);
      if (opts.json) return console.log(JSON.stringify(xs, null, 2));
      for (const x of xs) console.log(`  ${x}`);
    });

  perc
    .command("capture-lifecycles-v2")
    .description("List V2 capture lifecycle states")
    .option("--json", "JSON output")
    .action((opts) => {
      const xs = Object.values(CAPTURE_LIFECYCLE_V2);
      if (opts.json) return console.log(JSON.stringify(xs, null, 2));
      for (const x of xs) console.log(`  ${x}`);
    });

  // ── Config defaults/getters/setters ────────────────

  perc
    .command("default-max-active-sensors-per-operator")
    .description("Default cap")
    .action(() => console.log(getDefaultMaxActiveSensorsPerOperatorV2()));
  perc
    .command("max-active-sensors-per-operator")
    .description("Current cap")
    .action(() => console.log(getMaxActiveSensorsPerOperatorV2()));
  perc
    .command("set-max-active-sensors-per-operator <n>")
    .description("Set cap")
    .action((n) => console.log(setMaxActiveSensorsPerOperatorV2(n)));

  perc
    .command("default-max-pending-captures-per-sensor")
    .description("Default cap")
    .action(() => console.log(getDefaultMaxPendingCapturesPerSensorV2()));
  perc
    .command("max-pending-captures-per-sensor")
    .description("Current cap")
    .action(() => console.log(getMaxPendingCapturesPerSensorV2()));
  perc
    .command("set-max-pending-captures-per-sensor <n>")
    .description("Set cap")
    .action((n) => console.log(setMaxPendingCapturesPerSensorV2(n)));

  perc
    .command("default-sensor-idle-ms")
    .description("Default idle ms")
    .action(() => console.log(getDefaultSensorIdleMsV2()));
  perc
    .command("sensor-idle-ms")
    .description("Current idle ms")
    .action(() => console.log(getSensorIdleMsV2()));
  perc
    .command("set-sensor-idle-ms <ms>")
    .description("Set idle ms")
    .action((ms) => console.log(setSensorIdleMsV2(ms)));

  perc
    .command("default-capture-stuck-ms")
    .description("Default stuck ms")
    .action(() => console.log(getDefaultCaptureStuckMsV2()));
  perc
    .command("capture-stuck-ms")
    .description("Current stuck ms")
    .action(() => console.log(getCaptureStuckMsV2()));
  perc
    .command("set-capture-stuck-ms <ms>")
    .description("Set stuck ms")
    .action((ms) => console.log(setCaptureStuckMsV2(ms)));

  // ── Counts ─────────────────────────────────────────

  perc
    .command("active-sensor-count")
    .description("Count of ACTIVE sensors")
    .option("-o, --operator <id>", "filter by operator")
    .action((opts) => console.log(getActiveSensorCount(opts.operator)));

  perc
    .command("pending-capture-count")
    .description("Count of PENDING captures")
    .option("-s, --sensor <id>", "filter by sensor")
    .action((opts) => console.log(getPendingCaptureCount(opts.sensor)));

  // ── Sensor lifecycle ───────────────────────────────

  perc
    .command("register-sensor-v2 <sensor-id>")
    .description("Register a V2 sensor")
    .requiredOption("-o, --operator <id>", "operator id")
    .requiredOption("-m, --modality <mod>", "modality")
    .option("-i, --initial-status <status>", "initial status")
    .option("--metadata <json>", "metadata JSON")
    .action((id, opts) => {
      const r = registerSensorV2(null, {
        sensorId: id,
        operatorId: opts.operator,
        modality: opts.modality,
        initialStatus: opts.initialStatus,
        metadata: _parseMetaV2(opts.metadata),
      });
      console.log(JSON.stringify(r, null, 2));
    });

  perc
    .command("sensor-v2 <sensor-id>")
    .description("Get a V2 sensor")
    .action((id) => {
      const r = getSensorV2(id);
      if (!r) {
        console.error(`Unknown sensor: ${id}`);
        process.exitCode = 1;
        return;
      }
      console.log(JSON.stringify(r, null, 2));
    });

  perc
    .command("set-sensor-maturity-v2 <sensor-id> <status>")
    .description("Transition sensor maturity")
    .option("-r, --reason <text>", "reason")
    .option("--metadata <json>", "metadata JSON")
    .action((id, status, opts) => {
      const r = setSensorMaturityV2(null, id, status, {
        reason: opts.reason,
        metadata: _parseMetaV2(opts.metadata),
      });
      console.log(JSON.stringify(r, null, 2));
    });

  for (const [name, fn] of [
    ["activate-sensor", activateSensor],
    ["degrade-sensor", degradeSensor],
    ["offline-sensor", offlineSensor],
    ["retire-sensor", retireSensor],
  ]) {
    perc
      .command(`${name} <sensor-id>`)
      .description(`Transition to ${name.split("-")[0]}`)
      .option("-r, --reason <text>", "reason")
      .action((id, opts) => {
        const r = fn(null, id, opts.reason);
        console.log(JSON.stringify(r, null, 2));
      });
  }

  perc
    .command("touch-sensor-heartbeat <sensor-id>")
    .description("Bump lastHeartbeatAt")
    .action((id) => {
      const r = touchSensorHeartbeat(id);
      console.log(JSON.stringify(r, null, 2));
    });

  // ── Capture lifecycle ──────────────────────────────

  perc
    .command("register-capture-v2 <capture-id>")
    .description("Register a V2 capture")
    .requiredOption("-s, --sensor <id>", "sensor id")
    .option("-i, --initial-status <status>", "initial status")
    .option("--metadata <json>", "metadata JSON")
    .action((id, opts) => {
      const r = registerCaptureV2(null, {
        captureId: id,
        sensorId: opts.sensor,
        initialStatus: opts.initialStatus,
        metadata: _parseMetaV2(opts.metadata),
      });
      console.log(JSON.stringify(r, null, 2));
    });

  perc
    .command("capture-v2 <capture-id>")
    .description("Get a V2 capture")
    .action((id) => {
      const r = getCaptureV2(id);
      if (!r) {
        console.error(`Unknown capture: ${id}`);
        process.exitCode = 1;
        return;
      }
      console.log(JSON.stringify(r, null, 2));
    });

  perc
    .command("set-capture-status-v2 <capture-id> <status>")
    .description("Transition capture lifecycle")
    .option("-r, --reason <text>", "reason")
    .option("--metadata <json>", "metadata JSON")
    .action((id, status, opts) => {
      const r = setCaptureStatusV2(null, id, status, {
        reason: opts.reason,
        metadata: _parseMetaV2(opts.metadata),
      });
      console.log(JSON.stringify(r, null, 2));
    });

  for (const [name, fn] of [
    ["start-processing-capture", startProcessingCapture],
    ["mark-capture-ready", markCaptureReady],
    ["fail-capture", failCapture],
    ["discard-capture", discardCapture],
  ]) {
    perc
      .command(`${name} <capture-id>`)
      .description(`Transition capture (${name})`)
      .option("-r, --reason <text>", "reason")
      .action((id, opts) => {
        const r = fn(null, id, opts.reason);
        console.log(JSON.stringify(r, null, 2));
      });
  }

  // ── Auto-flips + stats ─────────────────────────────

  perc
    .command("auto-offline-stale-sensors")
    .description("Flip stale ACTIVE/DEGRADED sensors → OFFLINE")
    .action(() =>
      console.log(JSON.stringify(autoOfflineStaleSensors(null), null, 2)),
    );

  perc
    .command("auto-fail-stuck-processing-captures")
    .description("Flip stuck PROCESSING captures → FAILED")
    .action(() =>
      console.log(
        JSON.stringify(autoFailStuckProcessingCaptures(null), null, 2),
      ),
    );

  perc
    .command("stats-v2")
    .description("V2 stats snapshot")
    .action(() => console.log(JSON.stringify(getPerceptionStatsV2(), null, 2)));

  program.addCommand(perc);
}
