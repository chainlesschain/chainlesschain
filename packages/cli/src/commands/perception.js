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
} from "../lib/perception.js";

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

  program.addCommand(perc);
}
