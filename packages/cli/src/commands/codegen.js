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

  // Phase 86 V2
  AGENT_MATURITY_V2,
  GEN_JOB_V2,
  getDefaultMaxActiveAgentsPerOwnerV2,
  getMaxActiveAgentsPerOwnerV2,
  setMaxActiveAgentsPerOwnerV2,
  getDefaultMaxRunningJobsPerOwnerV2,
  getMaxRunningJobsPerOwnerV2,
  setMaxRunningJobsPerOwnerV2,
  getDefaultAgentIdleMsV2,
  getAgentIdleMsV2,
  setAgentIdleMsV2,
  getDefaultJobStuckMsV2,
  getJobStuckMsV2,
  setJobStuckMsV2,
  registerAgentV2,
  getAgentV2,
  setAgentMaturityV2,
  activateAgent,
  deprecateAgent,
  retireAgent,
  touchAgentInvocation,
  enqueueGenJobV2,
  getGenJobV2,
  setGenJobStatusV2,
  startGenJob,
  succeedGenJob,
  failGenJob,
  cancelGenJob,
  getActiveAgentCount,
  getRunningJobCount,
  autoRetireIdleAgents,
  autoFailStuckGenJobs,
  getCodeAgentStatsV2,
} from "../lib/code-agent.js";

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

  /* ═══════════════════════════════════════════════════ *
   *  Phase 86 V2
   * ═══════════════════════════════════════════════════ */

  cg.command("agent-maturities-v2")
    .description("List V2 agent maturity states")
    .option("--json", "JSON")
    .action((opts) => {
      const xs = Object.values(AGENT_MATURITY_V2);
      if (opts.json) return console.log(JSON.stringify(xs, null, 2));
      for (const x of xs) console.log(`  ${x}`);
    });

  cg.command("gen-jobs-v2")
    .description("List V2 generation-job states")
    .option("--json", "JSON")
    .action((opts) => {
      const xs = Object.values(GEN_JOB_V2);
      if (opts.json) return console.log(JSON.stringify(xs, null, 2));
      for (const x of xs) console.log(`  ${x}`);
    });

  cg.command("default-max-active-agents-per-owner").action(() =>
    console.log(getDefaultMaxActiveAgentsPerOwnerV2()),
  );
  cg.command("max-active-agents-per-owner").action(() =>
    console.log(getMaxActiveAgentsPerOwnerV2()),
  );
  cg.command("set-max-active-agents-per-owner <n>").action((n) =>
    console.log(setMaxActiveAgentsPerOwnerV2(n)),
  );

  cg.command("default-max-running-jobs-per-owner").action(() =>
    console.log(getDefaultMaxRunningJobsPerOwnerV2()),
  );
  cg.command("max-running-jobs-per-owner").action(() =>
    console.log(getMaxRunningJobsPerOwnerV2()),
  );
  cg.command("set-max-running-jobs-per-owner <n>").action((n) =>
    console.log(setMaxRunningJobsPerOwnerV2(n)),
  );

  cg.command("default-agent-idle-ms").action(() =>
    console.log(getDefaultAgentIdleMsV2()),
  );
  cg.command("agent-idle-ms").action(() => console.log(getAgentIdleMsV2()));
  cg.command("set-agent-idle-ms <ms>").action((ms) =>
    console.log(setAgentIdleMsV2(ms)),
  );

  cg.command("default-job-stuck-ms").action(() =>
    console.log(getDefaultJobStuckMsV2()),
  );
  cg.command("job-stuck-ms").action(() => console.log(getJobStuckMsV2()));
  cg.command("set-job-stuck-ms <ms>").action((ms) =>
    console.log(setJobStuckMsV2(ms)),
  );

  cg.command("active-agent-count")
    .option("-o, --owner <id>")
    .action((opts) => console.log(getActiveAgentCount(opts.owner)));
  cg.command("running-job-count")
    .option("-o, --owner <id>")
    .action((opts) => console.log(getRunningJobCount(opts.owner)));

  cg.command("register-agent-v2 <agent-id>")
    .requiredOption("-o, --owner <id>")
    .option("-n, --name <name>")
    .option("-i, --initial-status <s>")
    .option("--metadata <json>")
    .action((id, opts) => {
      const r = registerAgentV2(null, {
        agentId: id,
        ownerId: opts.owner,
        name: opts.name,
        initialStatus: opts.initialStatus,
        metadata: _parseMetaV2(opts.metadata),
      });
      console.log(JSON.stringify(r, null, 2));
    });

  cg.command("agent-v2 <agent-id>").action((id) => {
    const r = getAgentV2(id);
    if (!r) {
      console.error(`Unknown agent: ${id}`);
      process.exitCode = 1;
      return;
    }
    console.log(JSON.stringify(r, null, 2));
  });

  cg.command("set-agent-maturity-v2 <agent-id> <status>")
    .option("-r, --reason <text>")
    .option("--metadata <json>")
    .action((id, status, opts) => {
      const r = setAgentMaturityV2(null, id, status, {
        reason: opts.reason,
        metadata: _parseMetaV2(opts.metadata),
      });
      console.log(JSON.stringify(r, null, 2));
    });

  for (const [name, fn] of [
    ["activate-agent", activateAgent],
    ["deprecate-agent", deprecateAgent],
    ["retire-agent", retireAgent],
  ]) {
    cg.command(`${name} <agent-id>`)
      .option("-r, --reason <text>")
      .action((id, opts) => {
        const r = fn(null, id, opts.reason);
        console.log(JSON.stringify(r, null, 2));
      });
  }

  cg.command("touch-agent-invocation <agent-id>").action((id) =>
    console.log(JSON.stringify(touchAgentInvocation(id), null, 2)),
  );

  cg.command("enqueue-gen-job-v2 <job-id>")
    .requiredOption("-o, --owner <id>")
    .requiredOption("-a, --agent <id>")
    .requiredOption("-p, --prompt <text>")
    .option("--metadata <json>")
    .action((id, opts) => {
      const r = enqueueGenJobV2(null, {
        jobId: id,
        ownerId: opts.owner,
        agentId: opts.agent,
        prompt: opts.prompt,
        metadata: _parseMetaV2(opts.metadata),
      });
      console.log(JSON.stringify(r, null, 2));
    });

  cg.command("gen-job-v2 <job-id>").action((id) => {
    const r = getGenJobV2(id);
    if (!r) {
      console.error(`Unknown job: ${id}`);
      process.exitCode = 1;
      return;
    }
    console.log(JSON.stringify(r, null, 2));
  });

  cg.command("set-gen-job-status-v2 <job-id> <status>")
    .option("-r, --reason <text>")
    .option("--metadata <json>")
    .action((id, status, opts) => {
      const r = setGenJobStatusV2(null, id, status, {
        reason: opts.reason,
        metadata: _parseMetaV2(opts.metadata),
      });
      console.log(JSON.stringify(r, null, 2));
    });

  for (const [name, fn] of [
    ["start-gen-job", startGenJob],
    ["succeed-gen-job", succeedGenJob],
    ["fail-gen-job", failGenJob],
    ["cancel-gen-job", cancelGenJob],
  ]) {
    cg.command(`${name} <job-id>`)
      .option("-r, --reason <text>")
      .action((id, opts) => {
        const r = fn(null, id, opts.reason);
        console.log(JSON.stringify(r, null, 2));
      });
  }

  cg.command("auto-retire-idle-agents").action(() =>
    console.log(JSON.stringify(autoRetireIdleAgents(null), null, 2)),
  );
  cg.command("auto-fail-stuck-gen-jobs").action(() =>
    console.log(JSON.stringify(autoFailStuckGenJobs(null), null, 2)),
  );
  cg.command("stats-v2").action(() =>
    console.log(JSON.stringify(getCodeAgentStatsV2(), null, 2)),
  );

  program.addCommand(cg);
}

// === Iter19 V2 governance overlay ===
export function registerCdagovV2Commands(program) {
  const parent = program.commands.find((c) => c.name() === "codegen");
  if (!parent) return;
  const L = async () => await import("../lib/code-agent.js");
  parent
    .command("cdagov-enums-v2")
    .description("Show V2 enums")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            profileMaturity: m.CDAGOV_PROFILE_MATURITY_V2,
            editLifecycle: m.CDAGOV_EDIT_LIFECYCLE_V2,
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("cdagov-config-v2")
    .description("Show V2 config")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            maxActive: m.getMaxActiveCdagovProfilesPerOwnerV2(),
            maxPending: m.getMaxPendingCdagovEditsPerProfileV2(),
            idleMs: m.getCdagovProfileIdleMsV2(),
            stuckMs: m.getCdagovEditStuckMsV2(),
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("cdagov-set-max-active-v2 <n>")
    .description("Set max active")
    .action(async (n) => {
      (await L()).setMaxActiveCdagovProfilesPerOwnerV2(Number(n));
      console.log("ok");
    });
  parent
    .command("cdagov-set-max-pending-v2 <n>")
    .description("Set max pending")
    .action(async (n) => {
      (await L()).setMaxPendingCdagovEditsPerProfileV2(Number(n));
      console.log("ok");
    });
  parent
    .command("cdagov-set-idle-ms-v2 <n>")
    .description("Set idle threshold ms")
    .action(async (n) => {
      (await L()).setCdagovProfileIdleMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("cdagov-set-stuck-ms-v2 <n>")
    .description("Set stuck threshold ms")
    .action(async (n) => {
      (await L()).setCdagovEditStuckMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("cdagov-register-v2 <id> <owner>")
    .description("Register V2 profile")
    .option("--language <v>", "language")
    .action(async (id, owner, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.registerCdagovProfileV2({ id, owner, language: o.language }),
          null,
          2,
        ),
      );
    });
  parent
    .command("cdagov-activate-v2 <id>")
    .description("Activate profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).activateCdagovProfileV2(id), null, 2),
      );
    });
  parent
    .command("cdagov-stale-v2 <id>")
    .description("Stale profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).staleCdagovProfileV2(id), null, 2),
      );
    });
  parent
    .command("cdagov-archive-v2 <id>")
    .description("Archive profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).archiveCdagovProfileV2(id), null, 2),
      );
    });
  parent
    .command("cdagov-touch-v2 <id>")
    .description("Touch profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).touchCdagovProfileV2(id), null, 2),
      );
    });
  parent
    .command("cdagov-get-v2 <id>")
    .description("Get profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getCdagovProfileV2(id), null, 2));
    });
  parent
    .command("cdagov-list-v2")
    .description("List profiles")
    .action(async () => {
      console.log(JSON.stringify((await L()).listCdagovProfilesV2(), null, 2));
    });
  parent
    .command("cdagov-create-edit-v2 <id> <profileId>")
    .description("Create edit")
    .option("--target <v>", "target")
    .action(async (id, profileId, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.createCdagovEditV2({ id, profileId, target: o.target }),
          null,
          2,
        ),
      );
    });
  parent
    .command("cdagov-editing-edit-v2 <id>")
    .description("Mark edit as editing")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).editingCdagovEditV2(id), null, 2));
    });
  parent
    .command("cdagov-complete-edit-v2 <id>")
    .description("Complete edit")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).completeEditCdagovV2(id), null, 2),
      );
    });
  parent
    .command("cdagov-fail-edit-v2 <id> [reason]")
    .description("Fail edit")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).failCdagovEditV2(id, reason), null, 2),
      );
    });
  parent
    .command("cdagov-cancel-edit-v2 <id> [reason]")
    .description("Cancel edit")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).cancelCdagovEditV2(id, reason), null, 2),
      );
    });
  parent
    .command("cdagov-get-edit-v2 <id>")
    .description("Get edit")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getCdagovEditV2(id), null, 2));
    });
  parent
    .command("cdagov-list-edits-v2")
    .description("List edits")
    .action(async () => {
      console.log(JSON.stringify((await L()).listCdagovEditsV2(), null, 2));
    });
  parent
    .command("cdagov-auto-stale-idle-v2")
    .description("Auto-stale idle")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoStaleIdleCdagovProfilesV2(), null, 2),
      );
    });
  parent
    .command("cdagov-auto-fail-stuck-v2")
    .description("Auto-fail stuck edits")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoFailStuckCdagovEditsV2(), null, 2),
      );
    });
  parent
    .command("cdagov-gov-stats-v2")
    .description("V2 gov stats")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).getCodeAgentGovStatsV2(), null, 2),
      );
    });
}
