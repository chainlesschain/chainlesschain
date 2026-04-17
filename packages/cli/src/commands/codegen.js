/**
 * `cc codegen` — CLI surface for Phase 86 Code Generation Agent 2.0.
 */

import { Command } from "commander";

import {
  SCAFFOLD_TEMPLATE,
  REVIEW_SEVERITY,
  SECURITY_RULE,
  CICD_PLATFORM,
  ensureCodeAgentTables,
  createGeneration,
  getGeneration,
  listGenerations,
  reviewCode,
  getReview,
  listReviews,
  createScaffold,
  getScaffold,
  listScaffolds,
  getCodeAgentStats,
} from "../lib/code-agent.js";

function _dbFromCtx(cmd) {
  const root = cmd?.parent?.parent ?? cmd?.parent;
  return root?._db;
}

export function registerCodegenCommand(program) {
  const cg = new Command("codegen")
    .description("Code generation agent (Phase 86)")
    .hook("preAction", (thisCmd) => {
      const db = _dbFromCtx(thisCmd);
      if (db) ensureCodeAgentTables(db);
    });

  /* ── Catalogs ────────────────────────────────────── */

  cg.command("templates")
    .description("List scaffold templates")
    .option("--json", "JSON output")
    .action((opts) => {
      const templates = Object.values(SCAFFOLD_TEMPLATE);
      if (opts.json) return console.log(JSON.stringify(templates, null, 2));
      for (const t of templates) console.log(`  ${t}`);
    });

  cg.command("severities")
    .description("List review severity levels")
    .option("--json", "JSON output")
    .action((opts) => {
      const sevs = Object.values(REVIEW_SEVERITY);
      if (opts.json) return console.log(JSON.stringify(sevs, null, 2));
      for (const s of sevs) console.log(`  ${s}`);
    });

  cg.command("rules")
    .description("List security rules")
    .option("--json", "JSON output")
    .action((opts) => {
      const rules = Object.values(SECURITY_RULE);
      if (opts.json) return console.log(JSON.stringify(rules, null, 2));
      for (const r of rules) console.log(`  ${r}`);
    });

  cg.command("platforms")
    .description("List CI/CD platforms")
    .option("--json", "JSON output")
    .action((opts) => {
      const plats = Object.values(CICD_PLATFORM);
      if (opts.json) return console.log(JSON.stringify(plats, null, 2));
      for (const p of plats) console.log(`  ${p}`);
    });

  /* ── Code Generation ─────────────────────────────── */

  cg.command("generate")
    .description("Record a code generation session")
    .requiredOption("-p, --prompt <text>", "Generation prompt")
    .option("-l, --language <lang>", "Programming language")
    .option("-f, --framework <fw>", "Framework used")
    .option("--code <code>", "Generated code")
    .option("--files <n>", "Files generated", parseInt)
    .option("--tokens <n>", "Tokens consumed", parseInt)
    .option("-m, --metadata <json>", "Metadata JSON")
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(cg);
      const result = createGeneration(db, {
        prompt: opts.prompt,
        language: opts.language,
        framework: opts.framework,
        generatedCode: opts.code,
        fileCount: opts.files,
        tokenCount: opts.tokens,
        metadata: opts.metadata,
      });
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      if (result.generationId)
        console.log(`Generation recorded: ${result.generationId}`);
      else console.log(`Failed: ${result.reason}`);
    });

  cg.command("show <id>")
    .description("Show generation details")
    .option("--json", "JSON output")
    .action((id, opts) => {
      const db = _dbFromCtx(cg);
      const g = getGeneration(db, id);
      if (!g) return console.log("Generation not found.");
      if (opts.json) return console.log(JSON.stringify(g, null, 2));
      console.log(`ID:        ${g.id}`);
      console.log(`Prompt:    ${g.prompt.slice(0, 80)}`);
      if (g.language) console.log(`Language:  ${g.language}`);
      if (g.framework) console.log(`Framework: ${g.framework}`);
      console.log(`Files:     ${g.file_count}`);
      console.log(`Tokens:    ${g.token_count}`);
    });

  cg.command("list")
    .description("List code generations")
    .option("-l, --language <lang>", "Filter by language")
    .option("-f, --framework <fw>", "Filter by framework")
    .option("--limit <n>", "Max results", parseInt)
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(cg);
      const gens = listGenerations(db, {
        language: opts.language,
        framework: opts.framework,
        limit: opts.limit,
      });
      if (opts.json) return console.log(JSON.stringify(gens, null, 2));
      if (gens.length === 0) return console.log("No generations.");
      for (const g of gens) {
        console.log(
          `  ${(g.language || "?").padEnd(12)} ${(g.framework || "").padEnd(14)} ${g.prompt.slice(0, 40).padEnd(42)} ${g.id.slice(0, 8)}`,
        );
      }
    });

  /* ── Code Review ─────────────────────────────────── */

  cg.command("review")
    .description("Run heuristic code review")
    .requiredOption("-c, --code <code>", "Code to review")
    .option("-g, --generation <id>", "Link to generation ID")
    .option("-l, --language <lang>", "Programming language")
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(cg);
      const result = reviewCode(db, {
        generationId: opts.generation,
        code: opts.code,
        language: opts.language,
      });
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      if (result.reviewId) {
        console.log(`Review: ${result.reviewId}`);
        console.log(
          `Issues: ${result.issuesFound} (${result.securityIssues} security)`,
        );
        for (const [sev, count] of Object.entries(result.severitySummary)) {
          if (count > 0) console.log(`  ${sev}: ${count}`);
        }
      } else {
        console.log(`Failed: ${result.reason}`);
      }
    });

  cg.command("review-show <id>")
    .description("Show review details")
    .option("--json", "JSON output")
    .action((id, opts) => {
      const db = _dbFromCtx(cg);
      const r = getReview(db, id);
      if (!r) return console.log("Review not found.");
      if (opts.json) return console.log(JSON.stringify(r, null, 2));
      console.log(`ID:       ${r.id}`);
      if (r.generation_id) console.log(`Gen ID:   ${r.generation_id}`);
      console.log(`Hash:     ${r.code_hash}`);
      if (r.language) console.log(`Language: ${r.language}`);
      console.log(
        `Issues:   ${r.issues_found} (${r.security_issues} security)`,
      );
      try {
        const detail = JSON.parse(r.issues_detail);
        for (const issue of detail) {
          console.log(`  [${issue.severity}] ${issue.rule}: ${issue.match}`);
        }
      } catch (_e) {
        /* not JSON */
      }
    });

  cg.command("reviews")
    .description("List code reviews")
    .option("-l, --language <lang>", "Filter by language")
    .option("--limit <n>", "Max results", parseInt)
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(cg);
      const revs = listReviews(db, {
        language: opts.language,
        limit: opts.limit,
      });
      if (opts.json) return console.log(JSON.stringify(revs, null, 2));
      if (revs.length === 0) return console.log("No reviews.");
      for (const r of revs) {
        console.log(
          `  ${(r.language || "?").padEnd(12)} issues:${String(r.issues_found).padEnd(4)} sec:${String(r.security_issues).padEnd(4)} ${r.id.slice(0, 8)}`,
        );
      }
    });

  /* ── Scaffold ────────────────────────────────────── */

  cg.command("scaffold")
    .description("Record a scaffold generation")
    .requiredOption(
      "-t, --template <type>",
      "Template (react/vue/express/fastapi/spring_boot)",
    )
    .requiredOption("-n, --name <name>", "Project name")
    .option("-o, --options <json>", "Options JSON")
    .option("--files <n>", "Files generated", parseInt)
    .option("--output <path>", "Output path")
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(cg);
      const result = createScaffold(db, {
        template: opts.template,
        projectName: opts.name,
        options: opts.options,
        filesGenerated: opts.files,
        outputPath: opts.output,
      });
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      if (result.scaffoldId)
        console.log(`Scaffold created: ${result.scaffoldId}`);
      else console.log(`Failed: ${result.reason}`);
    });

  cg.command("scaffold-show <id>")
    .description("Show scaffold details")
    .option("--json", "JSON output")
    .action((id, opts) => {
      const db = _dbFromCtx(cg);
      const s = getScaffold(db, id);
      if (!s) return console.log("Scaffold not found.");
      if (opts.json) return console.log(JSON.stringify(s, null, 2));
      console.log(`ID:       ${s.id}`);
      console.log(`Template: ${s.template}`);
      console.log(`Project:  ${s.project_name}`);
      if (s.options) console.log(`Options:  ${s.options}`);
      console.log(`Files:    ${s.files_generated}`);
      if (s.output_path) console.log(`Output:   ${s.output_path}`);
    });

  cg.command("scaffolds")
    .description("List scaffolds")
    .option("-t, --template <type>", "Filter by template")
    .option("--limit <n>", "Max results", parseInt)
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(cg);
      const scfs = listScaffolds(db, {
        template: opts.template,
        limit: opts.limit,
      });
      if (opts.json) return console.log(JSON.stringify(scfs, null, 2));
      if (scfs.length === 0) return console.log("No scaffolds.");
      for (const s of scfs) {
        console.log(
          `  ${s.template.padEnd(14)} ${(s.project_name || "").padEnd(20)} files:${String(s.files_generated).padEnd(4)} ${s.id.slice(0, 8)}`,
        );
      }
    });

  /* ── Stats ───────────────────────────────────────── */

  cg.command("stats")
    .description("Code agent statistics")
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(cg);
      const s = getCodeAgentStats(db);
      if (opts.json) return console.log(JSON.stringify(s, null, 2));
      console.log(
        `Generations: ${s.generations.total}  (${s.generations.totalFiles} files, ${s.generations.totalTokens} tokens, ${s.generations.uniqueLanguages} languages)`,
      );
      console.log(
        `Reviews:     ${s.reviews.total}  (${s.reviews.totalIssues} issues, ${s.reviews.totalSecurityIssues} security, avg ${s.reviews.avgIssuesPerReview}/review)`,
      );
      console.log(`Scaffolds:   ${s.scaffolds.total}`);
      for (const [tmpl, count] of Object.entries(s.scaffolds.byTemplate)) {
        console.log(`  ${tmpl.padEnd(14)} ${count}`);
      }
    });

  program.addCommand(cg);
}
