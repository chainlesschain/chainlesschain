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
} from "../lib/nl-programming.js";

function _dbFromCtx(cmd) {
  const root = cmd?.parent?.parent ?? cmd?.parent;
  return root?._db;
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
      const db = _dbFromCtx(nlp);
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
      const db = _dbFromCtx(nlp);
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
      const db = _dbFromCtx(nlp);
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
      const db = _dbFromCtx(nlp);
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
      const db = _dbFromCtx(nlp);
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
      const db = _dbFromCtx(nlp);
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
      const db = _dbFromCtx(nlp);
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
      const db = _dbFromCtx(nlp);
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
      const db = _dbFromCtx(nlp);
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
      const db = _dbFromCtx(nlp);
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
      const db = _dbFromCtx(nlp);
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

  program.addCommand(nlp);
}
