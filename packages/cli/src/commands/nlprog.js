/**
 * `cc nlprog` — CLI surface for Phase 28 Natural Language Programming.
 */

import { Command } from "commander";

import {
  INTENT,
  TRANSLATION_STATUS,
  STYLE_CATEGORY,
  ensureNlProgrammingTables,
  classifyIntent,
  extractEntities,
  detectTechStack,
  scoreCompleteness,
  translate,
  getTranslation,
  listTranslations,
  updateTranslationStatus,
  refineTranslation,
  removeTranslation,
  addConvention,
  getConvention,
  listConventions,
  removeConvention,
  getNlProgrammingStats,
  /* V2 (Phase 28) */
  SPEC_MATURITY_V2,
  DIALOGUE_TURN_V2,
  getDefaultMaxActiveSpecsPerAuthorV2,
  getMaxActiveSpecsPerAuthorV2,
  setMaxActiveSpecsPerAuthorV2,
  getDefaultMaxPendingTurnsPerSpecV2,
  getMaxPendingTurnsPerSpecV2,
  setMaxPendingTurnsPerSpecV2,
  getDefaultSpecIdleMsV2,
  getSpecIdleMsV2,
  setSpecIdleMsV2,
  getDefaultTurnPendingMsV2,
  getTurnPendingMsV2,
  setTurnPendingMsV2,
  registerSpecV2,
  getSpecV2,
  setSpecMaturityV2,
  refineSpec,
  approveSpec,
  implementSpec,
  archiveSpec,
  touchSpecActivity,
  registerDialogueTurnV2,
  getDialogueTurnV2,
  setDialogueTurnStatusV2,
  answerTurn,
  dismissTurn,
  escalateTurn,
  getActiveSpecCount,
  getPendingTurnCount,
  autoArchiveIdleSpecs,
  autoDismissStalePendingTurns,
  getNlProgrammingStatsV2,
} from "../lib/nl-programming.js";

function _parseMetaV2(s) {
  if (!s) return undefined;
  try {
    return JSON.parse(s);
  } catch {
    throw new Error(`--metadata must be valid JSON`);
  }
}

function _dbFromCtx(cmd) {
  const root = cmd?.parent?.parent ?? cmd?.parent;
  return root?._db;
}

function _requireDb(cmd) {
  const db = _dbFromCtx(cmd);
  if (!db) {
    throw new Error(
      "No ChainlessChain project database in this directory. Run `cc init` first, or run from a project root.",
    );
  }
  return db;
}

export function registerNlProgCommand(program) {
  const nlp = new Command("nlprog")
    .description("Natural language programming system (Phase 28)")
    .hook("preAction", (thisCmd) => {
      const db = _dbFromCtx(thisCmd);
      if (db) ensureNlProgrammingTables(db);
    });

  /* ── Catalogs ────────────────────────────────────── */

  nlp
    .command("intents")
    .description("List supported intent types")
    .option("--json", "JSON output")
    .action((opts) => {
      const intents = Object.values(INTENT);
      if (opts.json) return console.log(JSON.stringify(intents, null, 2));
      for (const i of intents) console.log(`  ${i}`);
    });

  nlp
    .command("statuses")
    .description("List translation statuses")
    .option("--json", "JSON output")
    .action((opts) => {
      const statuses = Object.values(TRANSLATION_STATUS);
      if (opts.json) return console.log(JSON.stringify(statuses, null, 2));
      for (const s of statuses) console.log(`  ${s}`);
    });

  nlp
    .command("style-categories")
    .description("List style analysis categories")
    .option("--json", "JSON output")
    .action((opts) => {
      const cats = Object.values(STYLE_CATEGORY);
      if (opts.json) return console.log(JSON.stringify(cats, null, 2));
      for (const c of cats) console.log(`  ${c}`);
    });

  /* ── Analysis (stateless) ───────────────────────── */

  nlp
    .command("classify <text>")
    .description("Classify intent of natural language input")
    .option("--json", "JSON output")
    .action((text, opts) => {
      const result = classifyIntent(text);
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      console.log(`Intent:     ${result.intent}`);
      console.log(`Confidence: ${result.confidence}`);
    });

  nlp
    .command("extract <text>")
    .description("Extract entities from natural language input")
    .option("--json", "JSON output")
    .action((text, opts) => {
      const result = extractEntities(text);
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      if (result.count === 0) return console.log("No entities found.");
      console.log(`Found ${result.count} entity(ies):`);
      for (const e of result.entities) {
        console.log(`  [${e.type}] ${e.value}`);
      }
    });

  nlp
    .command("detect-stack <text>")
    .description("Detect technology stack from text")
    .option("--json", "JSON output")
    .action((text, opts) => {
      const result = detectTechStack(text);
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      if (result.detected.length === 0)
        return console.log("No tech stack detected.");
      console.log(`Primary: ${result.primary}`);
      console.log(`All: ${result.detected.join(", ")}`);
    });

  /* ── Translation ────────────────────────────────── */

  nlp
    .command("translate <text>")
    .description("Translate natural language to spec (heuristic)")
    .option("-i, --intent <intent>", "Override intent classification")
    .option("-s, --spec <json>", "Attach spec JSON")
    .option("-a, --ambiguities <json>", "Ambiguity list JSON")
    .option("--json", "JSON output")
    .action((text, opts) => {
      const db = _requireDb(nlp);
      const result = translate(db, {
        text,
        intent: opts.intent,
        spec: opts.spec,
        ambiguities: opts.ambiguities,
      });
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      if (result.translated) {
        console.log(`Translation: ${result.translationId}`);
        console.log(`Intent:      ${result.intent}`);
        console.log(`Completeness: ${result.completeness}`);
      } else console.log(`Failed: ${result.reason}`);
    });

  nlp
    .command("show <id>")
    .description("Show translation details")
    .option("--json", "JSON output")
    .action((id, opts) => {
      const db = _requireDb(nlp);
      const t = getTranslation(db, id);
      if (!t) return console.log("Translation not found.");
      if (opts.json) return console.log(JSON.stringify(t, null, 2));
      console.log(`ID:           ${t.id}`);
      console.log(`Input:        ${t.input_text.slice(0, 80)}`);
      console.log(`Intent:       ${t.intent}`);
      console.log(`Status:       ${t.status}`);
      console.log(`Completeness: ${t.completeness_score}`);
      if (t.entities) console.log(`Entities:     ${t.entities.slice(0, 60)}`);
      if (t.tech_stack) console.log(`Tech Stack:   ${t.tech_stack}`);
      if (t.ambiguities)
        console.log(`Ambiguities:  ${t.ambiguities.slice(0, 60)}`);
    });

  nlp
    .command("list")
    .description("List translations")
    .option("-i, --intent <intent>", "Filter by intent")
    .option("-s, --status <status>", "Filter by status")
    .option("--limit <n>", "Max results", parseInt)
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _requireDb(nlp);
      const results = listTranslations(db, {
        intent: opts.intent,
        status: opts.status,
        limit: opts.limit,
      });
      if (opts.json) return console.log(JSON.stringify(results, null, 2));
      if (results.length === 0) return console.log("No translations.");
      for (const t of results) {
        console.log(
          `  ${t.intent.padEnd(18)} ${t.status.padEnd(10)} comp:${String(t.completeness_score).padEnd(6)} ${t.input_text.slice(0, 40).padEnd(42)} ${t.id.slice(0, 8)}`,
        );
      }
    });

  nlp
    .command("status <id> <status>")
    .description("Update translation status (draft/complete/refined)")
    .option("--json", "JSON output")
    .action((id, status, opts) => {
      const db = _requireDb(nlp);
      const result = updateTranslationStatus(db, id, status);
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      console.log(
        result.updated
          ? `Status updated to: ${result.status}`
          : `Failed: ${result.reason}`,
      );
    });

  nlp
    .command("refine <id>")
    .description("Refine a translation with updated spec")
    .option("-s, --spec <json>", "Updated spec JSON")
    .option("-a, --ambiguities <json>", "Updated ambiguities JSON")
    .option("--json", "JSON output")
    .action((id, opts) => {
      const db = _requireDb(nlp);
      const result = refineTranslation(db, id, {
        spec: opts.spec,
        ambiguities: opts.ambiguities,
      });
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      if (result.refined)
        console.log(`Refined (completeness: ${result.completeness})`);
      else console.log(`Failed: ${result.reason}`);
    });

  nlp
    .command("remove <id>")
    .description("Remove a translation")
    .option("--json", "JSON output")
    .action((id, opts) => {
      const db = _requireDb(nlp);
      const result = removeTranslation(db, id);
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      console.log(
        result.removed ? "Translation removed." : `Failed: ${result.reason}`,
      );
    });

  /* ── Conventions ────────────────────────────────── */

  nlp
    .command("convention-add")
    .description("Add a project convention")
    .requiredOption(
      "-c, --category <cat>",
      "Category (naming/architecture/testing/style/imports/components)",
    )
    .requiredOption("-p, --pattern <text>", "Pattern description")
    .option("-e, --examples <json>", "Examples JSON")
    .option("-f, --confidence <n>", "Confidence (0-1)", parseFloat)
    .option("-s, --source-files <json>", "Source files JSON")
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _requireDb(nlp);
      const result = addConvention(db, {
        category: opts.category,
        pattern: opts.pattern,
        examples: opts.examples,
        confidence: opts.confidence,
        sourceFiles: opts.sourceFiles,
      });
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      if (result.added) console.log(`Convention added: ${result.conventionId}`);
      else console.log(`Failed: ${result.reason}`);
    });

  nlp
    .command("convention-show <id>")
    .description("Show convention details")
    .option("--json", "JSON output")
    .action((id, opts) => {
      const db = _requireDb(nlp);
      const c = getConvention(db, id);
      if (!c) return console.log("Convention not found.");
      if (opts.json) return console.log(JSON.stringify(c, null, 2));
      console.log(`ID:         ${c.id}`);
      console.log(`Category:   ${c.category}`);
      console.log(`Pattern:    ${c.pattern}`);
      console.log(`Confidence: ${c.confidence}`);
      if (c.examples) console.log(`Examples:   ${c.examples.slice(0, 60)}`);
    });

  nlp
    .command("conventions")
    .description("List project conventions")
    .option("-c, --category <cat>", "Filter by category")
    .option("--limit <n>", "Max results", parseInt)
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _requireDb(nlp);
      const results = listConventions(db, {
        category: opts.category,
        limit: opts.limit,
      });
      if (opts.json) return console.log(JSON.stringify(results, null, 2));
      if (results.length === 0) return console.log("No conventions.");
      for (const c of results) {
        console.log(
          `  ${c.category.padEnd(14)} conf:${String(c.confidence).padEnd(5)} ${c.pattern.slice(0, 40).padEnd(42)} ${c.id.slice(0, 8)}`,
        );
      }
    });

  nlp
    .command("convention-remove <id>")
    .description("Remove a convention")
    .option("--json", "JSON output")
    .action((id, opts) => {
      const db = _requireDb(nlp);
      const result = removeConvention(db, id);
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      console.log(
        result.removed ? "Convention removed." : `Failed: ${result.reason}`,
      );
    });

  /* ── Stats ──────────────────────────────────────── */

  nlp
    .command("stats")
    .description("NL Programming statistics")
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _requireDb(nlp);
      const s = getNlProgrammingStats(db);
      if (opts.json) return console.log(JSON.stringify(s, null, 2));
      console.log(
        `Translations: ${s.translations.total} (avg completeness: ${s.translations.avgCompleteness})`,
      );
      for (const [intent, count] of Object.entries(s.translations.byIntent)) {
        if (count > 0) console.log(`  ${intent.padEnd(18)} ${count}`);
      }
      console.log(`Conventions: ${s.conventions.total}`);
      for (const [cat, count] of Object.entries(s.conventions.byCategory)) {
        if (count > 0) console.log(`  ${cat.padEnd(14)} ${count}`);
      }
    });

  /* ═════════════════════════════════════════════════════ *
   *  Phase 28 V2 — Spec Maturity + Dialogue Lifecycle
   * ═════════════════════════════════════════════════════ */

  nlp
    .command("spec-maturities-v2")
    .description("List Phase 28 V2 spec maturity states")
    .option("--json", "JSON output")
    .action((opts) => {
      const v = Object.values(SPEC_MATURITY_V2);
      if (opts.json) return console.log(JSON.stringify(v, null, 2));
      for (const s of v) console.log(s);
    });

  nlp
    .command("dialogue-turn-lifecycles-v2")
    .description("List Phase 28 V2 dialogue-turn lifecycle states")
    .option("--json", "JSON output")
    .action((opts) => {
      const v = Object.values(DIALOGUE_TURN_V2);
      if (opts.json) return console.log(JSON.stringify(v, null, 2));
      for (const s of v) console.log(s);
    });

  nlp
    .command("default-max-active-specs-per-author")
    .description("Show default V2 per-author active-spec cap")
    .action(() => console.log(getDefaultMaxActiveSpecsPerAuthorV2()));

  nlp
    .command("max-active-specs-per-author")
    .description("Show current V2 per-author active-spec cap")
    .action(() => console.log(getMaxActiveSpecsPerAuthorV2()));

  nlp
    .command("set-max-active-specs-per-author <n>")
    .description("Set V2 per-author active-spec cap")
    .action((n) => console.log(setMaxActiveSpecsPerAuthorV2(n)));

  nlp
    .command("default-max-pending-turns-per-spec")
    .description("Show default V2 per-spec pending-turn cap")
    .action(() => console.log(getDefaultMaxPendingTurnsPerSpecV2()));

  nlp
    .command("max-pending-turns-per-spec")
    .description("Show current V2 per-spec pending-turn cap")
    .action(() => console.log(getMaxPendingTurnsPerSpecV2()));

  nlp
    .command("set-max-pending-turns-per-spec <n>")
    .description("Set V2 per-spec pending-turn cap")
    .action((n) => console.log(setMaxPendingTurnsPerSpecV2(n)));

  nlp
    .command("default-spec-idle-ms")
    .description("Show default V2 spec idle threshold")
    .action(() => console.log(getDefaultSpecIdleMsV2()));

  nlp
    .command("spec-idle-ms")
    .description("Show current V2 spec idle threshold")
    .action(() => console.log(getSpecIdleMsV2()));

  nlp
    .command("set-spec-idle-ms <ms>")
    .description("Set V2 spec idle threshold (ms)")
    .action((ms) => console.log(setSpecIdleMsV2(ms)));

  nlp
    .command("default-turn-pending-ms")
    .description("Show default V2 turn-pending threshold")
    .action(() => console.log(getDefaultTurnPendingMsV2()));

  nlp
    .command("turn-pending-ms")
    .description("Show current V2 turn-pending threshold")
    .action(() => console.log(getTurnPendingMsV2()));

  nlp
    .command("set-turn-pending-ms <ms>")
    .description("Set V2 turn-pending threshold (ms)")
    .action((ms) => console.log(setTurnPendingMsV2(ms)));

  nlp
    .command("active-spec-count")
    .description("Count active V2 specs (optionally scoped by author)")
    .option("-a, --author <id>", "Author ID")
    .action((opts) => console.log(getActiveSpecCount(opts.author)));

  nlp
    .command("pending-turn-count")
    .description("Count pending V2 turns (optionally scoped by spec)")
    .option("-s, --spec <id>", "Spec ID")
    .action((opts) => console.log(getPendingTurnCount(opts.spec)));

  nlp
    .command("register-spec-v2 <spec-id>")
    .description("Register a V2 spec")
    .requiredOption("-a, --author <id>", "Author ID")
    .option("-t, --title <text>", "Title")
    .option("-i, --initial-status <status>", "Initial status")
    .option("-m, --metadata <json>", "Metadata JSON")
    .option("--json", "JSON output")
    .action((specId, opts) => {
      const db = _requireDb(nlp);
      const rec = registerSpecV2(db, {
        specId,
        authorId: opts.author,
        title: opts.title,
        initialStatus: opts.initialStatus,
        metadata: _parseMetaV2(opts.metadata),
      });
      if (opts.json) return console.log(JSON.stringify(rec, null, 2));
      console.log(`Registered spec ${specId} (${rec.status})`);
    });

  nlp
    .command("spec-v2 <spec-id>")
    .description("Show a V2 spec")
    .option("--json", "JSON output")
    .action((id, opts) => {
      const rec = getSpecV2(id);
      if (!rec) {
        console.error(`Unknown spec: ${id}`);
        process.exitCode = 1;
        return;
      }
      if (opts.json) return console.log(JSON.stringify(rec, null, 2));
      console.log(`${rec.specId} [${rec.status}] author=${rec.authorId}`);
    });

  nlp
    .command("set-spec-maturity-v2 <spec-id> <status>")
    .description("Transition V2 spec maturity")
    .option("-r, --reason <text>", "Reason")
    .option("-m, --metadata <json>", "Metadata patch (JSON)")
    .action((id, status, opts) => {
      const db = _requireDb(nlp);
      const rec = setSpecMaturityV2(db, id, status, {
        reason: opts.reason,
        metadata: _parseMetaV2(opts.metadata),
      });
      console.log(`${id} → ${rec.status}`);
    });

  nlp
    .command("refine-spec <spec-id>")
    .description("Transition a V2 spec to REFINING")
    .option("-r, --reason <text>", "Reason")
    .action((id, opts) => {
      const rec = refineSpec(_dbFromCtx(nlp), id, opts.reason);
      console.log(`${id} → ${rec.status}`);
    });

  nlp
    .command("approve-spec <spec-id>")
    .description("Transition a V2 spec to APPROVED")
    .option("-r, --reason <text>", "Reason")
    .action((id, opts) => {
      const rec = approveSpec(_dbFromCtx(nlp), id, opts.reason);
      console.log(`${id} → ${rec.status}`);
    });

  nlp
    .command("implement-spec <spec-id>")
    .description("Transition a V2 spec to IMPLEMENTED")
    .option("-r, --reason <text>", "Reason")
    .action((id, opts) => {
      const rec = implementSpec(_dbFromCtx(nlp), id, opts.reason);
      console.log(`${id} → ${rec.status}`);
    });

  nlp
    .command("archive-spec <spec-id>")
    .description("Transition a V2 spec to ARCHIVED")
    .option("-r, --reason <text>", "Reason")
    .action((id, opts) => {
      const rec = archiveSpec(_dbFromCtx(nlp), id, opts.reason);
      console.log(`${id} → ${rec.status}`);
    });

  nlp
    .command("touch-spec-activity <spec-id>")
    .description("Bump lastActivityAt for a V2 spec")
    .action((id) => {
      const rec = touchSpecActivity(id);
      console.log(`${id} lastActivityAt=${rec.lastActivityAt}`);
    });

  nlp
    .command("register-dialogue-turn-v2 <turn-id>")
    .description("Register a V2 dialogue turn")
    .requiredOption("-s, --spec <id>", "Spec ID")
    .option("-R, --role <role>", "Role (user/assistant)")
    .option("-q, --question <text>", "Question text")
    .option("-i, --initial-status <status>", "Initial status")
    .option("-m, --metadata <json>", "Metadata JSON")
    .option("--json", "JSON output")
    .action((turnId, opts) => {
      const db = _requireDb(nlp);
      const rec = registerDialogueTurnV2(db, {
        turnId,
        specId: opts.spec,
        role: opts.role,
        question: opts.question,
        initialStatus: opts.initialStatus,
        metadata: _parseMetaV2(opts.metadata),
      });
      if (opts.json) return console.log(JSON.stringify(rec, null, 2));
      console.log(`Registered turn ${turnId} (${rec.status})`);
    });

  nlp
    .command("dialogue-turn-v2 <turn-id>")
    .description("Show a V2 dialogue turn")
    .option("--json", "JSON output")
    .action((id, opts) => {
      const rec = getDialogueTurnV2(id);
      if (!rec) {
        console.error(`Unknown turn: ${id}`);
        process.exitCode = 1;
        return;
      }
      if (opts.json) return console.log(JSON.stringify(rec, null, 2));
      console.log(`${rec.turnId} [${rec.status}] spec=${rec.specId}`);
    });

  nlp
    .command("set-dialogue-turn-status-v2 <turn-id> <status>")
    .description("Transition V2 dialogue turn status")
    .option("-a, --answer <text>", "Answer text")
    .option("-r, --reason <text>", "Reason")
    .option("-m, --metadata <json>", "Metadata patch (JSON)")
    .action((id, status, opts) => {
      const db = _requireDb(nlp);
      const rec = setDialogueTurnStatusV2(db, id, status, {
        answer: opts.answer,
        reason: opts.reason,
        metadata: _parseMetaV2(opts.metadata),
      });
      console.log(`${id} → ${rec.status}`);
    });

  nlp
    .command("answer-turn <turn-id>")
    .description("Transition a V2 turn to ANSWERED (with answer)")
    .requiredOption("-a, --answer <text>", "Answer text")
    .option("-r, --reason <text>", "Reason")
    .action((id, opts) => {
      const rec = answerTurn(_dbFromCtx(nlp), id, opts.answer, opts.reason);
      console.log(`${id} → ${rec.status}`);
    });

  nlp
    .command("dismiss-turn <turn-id>")
    .description("Transition a V2 turn to DISMISSED")
    .option("-r, --reason <text>", "Reason")
    .action((id, opts) => {
      const rec = dismissTurn(_dbFromCtx(nlp), id, opts.reason);
      console.log(`${id} → ${rec.status}`);
    });

  nlp
    .command("escalate-turn <turn-id>")
    .description("Transition a V2 turn to ESCALATED")
    .option("-r, --reason <text>", "Reason")
    .action((id, opts) => {
      const rec = escalateTurn(_dbFromCtx(nlp), id, opts.reason);
      console.log(`${id} → ${rec.status}`);
    });

  nlp
    .command("auto-archive-idle-specs")
    .description(
      "Flip idle V2 specs (draft/refining/approved/implemented) → ARCHIVED",
    )
    .option("--json", "JSON output")
    .action((opts) => {
      const r = autoArchiveIdleSpecs(_dbFromCtx(nlp));
      if (opts.json) return console.log(JSON.stringify(r, null, 2));
      console.log(`Archived ${r.count} idle spec(s)`);
    });

  nlp
    .command("auto-dismiss-stale-pending-turns")
    .description("Flip stale PENDING V2 turns → DISMISSED")
    .option("--json", "JSON output")
    .action((opts) => {
      const r = autoDismissStalePendingTurns(_dbFromCtx(nlp));
      if (opts.json) return console.log(JSON.stringify(r, null, 2));
      console.log(`Dismissed ${r.count} stale turn(s)`);
    });

  nlp
    .command("stats-v2")
    .description("Phase 28 V2 statistics")
    .option("--json", "JSON output")
    .action((opts) => {
      const s = getNlProgrammingStatsV2();
      if (opts.json) return console.log(JSON.stringify(s, null, 2));
      console.log(
        `Specs(V2)=${s.totalSpecsV2} Turns(V2)=${s.totalTurnsV2} ` +
          `caps: active-specs/author=${s.maxActiveSpecsPerAuthor} pending-turns/spec=${s.maxPendingTurnsPerSpec}`,
      );
      console.log("specs-by-status:");
      for (const [k, v] of Object.entries(s.specsByStatus))
        console.log(`  ${k.padEnd(12)} ${v}`);
      console.log("turns-by-status:");
      for (const [k, v] of Object.entries(s.turnsByStatus))
        console.log(`  ${k.padEnd(12)} ${v}`);
    });

  program.addCommand(nlp);
}

// === Iter18 V2 governance overlay ===
export function registerNlpgovV2Commands(program) {
  const parent = program.commands.find((c) => c.name() === "nlprog");
  if (!parent) return;
  const L = async () => await import("../lib/nl-programming.js");
  parent
    .command("nlpgov-enums-v2")
    .description("Show V2 enums")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            profileMaturity: m.NLPGOV_PROFILE_MATURITY_V2,
            translationLifecycle: m.NLPGOV_TRANSLATION_LIFECYCLE_V2,
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("nlpgov-config-v2")
    .description("Show V2 config")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            maxActive: m.getMaxActiveNlpgovProfilesPerOwnerV2(),
            maxPending: m.getMaxPendingNlpgovTranslationsPerProfileV2(),
            idleMs: m.getNlpgovProfileIdleMsV2(),
            stuckMs: m.getNlpgovTranslationStuckMsV2(),
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("nlpgov-set-max-active-v2 <n>")
    .description("Set max active")
    .action(async (n) => {
      (await L()).setMaxActiveNlpgovProfilesPerOwnerV2(Number(n));
      console.log("ok");
    });
  parent
    .command("nlpgov-set-max-pending-v2 <n>")
    .description("Set max pending")
    .action(async (n) => {
      (await L()).setMaxPendingNlpgovTranslationsPerProfileV2(Number(n));
      console.log("ok");
    });
  parent
    .command("nlpgov-set-idle-ms-v2 <n>")
    .description("Set idle threshold ms")
    .action(async (n) => {
      (await L()).setNlpgovProfileIdleMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("nlpgov-set-stuck-ms-v2 <n>")
    .description("Set stuck threshold ms")
    .action(async (n) => {
      (await L()).setNlpgovTranslationStuckMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("nlpgov-register-v2 <id> <owner>")
    .description("Register V2 profile")
    .option("--style <v>", "style")
    .action(async (id, owner, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.registerNlpgovProfileV2({ id, owner, style: o.style }),
          null,
          2,
        ),
      );
    });
  parent
    .command("nlpgov-activate-v2 <id>")
    .description("Activate profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).activateNlpgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("nlpgov-stale-v2 <id>")
    .description("Stale profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).staleNlpgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("nlpgov-archive-v2 <id>")
    .description("Archive profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).archiveNlpgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("nlpgov-touch-v2 <id>")
    .description("Touch profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).touchNlpgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("nlpgov-get-v2 <id>")
    .description("Get profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getNlpgovProfileV2(id), null, 2));
    });
  parent
    .command("nlpgov-list-v2")
    .description("List profiles")
    .action(async () => {
      console.log(JSON.stringify((await L()).listNlpgovProfilesV2(), null, 2));
    });
  parent
    .command("nlpgov-create-translation-v2 <id> <profileId>")
    .description("Create translation")
    .option("--intent <v>", "intent")
    .action(async (id, profileId, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.createNlpgovTranslationV2({ id, profileId, intent: o.intent }),
          null,
          2,
        ),
      );
    });
  parent
    .command("nlpgov-translating-translation-v2 <id>")
    .description("Mark translation as translating")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).translatingNlpgovTranslationV2(id), null, 2),
      );
    });
  parent
    .command("nlpgov-complete-translation-v2 <id>")
    .description("Complete translation")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).completeTranslationNlpgovV2(id), null, 2),
      );
    });
  parent
    .command("nlpgov-fail-translation-v2 <id> [reason]")
    .description("Fail translation")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify(
          (await L()).failNlpgovTranslationV2(id, reason),
          null,
          2,
        ),
      );
    });
  parent
    .command("nlpgov-cancel-translation-v2 <id> [reason]")
    .description("Cancel translation")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify(
          (await L()).cancelNlpgovTranslationV2(id, reason),
          null,
          2,
        ),
      );
    });
  parent
    .command("nlpgov-get-translation-v2 <id>")
    .description("Get translation")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).getNlpgovTranslationV2(id), null, 2),
      );
    });
  parent
    .command("nlpgov-list-translations-v2")
    .description("List translations")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).listNlpgovTranslationsV2(), null, 2),
      );
    });
  parent
    .command("nlpgov-auto-stale-idle-v2")
    .description("Auto-stale idle")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoStaleIdleNlpgovProfilesV2(), null, 2),
      );
    });
  parent
    .command("nlpgov-auto-fail-stuck-v2")
    .description("Auto-fail stuck translations")
    .action(async () => {
      console.log(
        JSON.stringify(
          (await L()).autoFailStuckNlpgovTranslationsV2(),
          null,
          2,
        ),
      );
    });
  parent
    .command("nlpgov-gov-stats-v2")
    .description("V2 gov stats")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).getNlProgrammingGovStatsV2(), null, 2),
      );
    });
}
