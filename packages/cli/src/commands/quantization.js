/**
 * `cc quantize` — CLI surface for Phase 20 Model Quantization.
 */

import { Command } from "commander";

import {
  JOB_STATUS,
  QUANT_TYPE,
  GGUF_LEVELS,
  GPTQ_BITS,
  ensureQuantizationTables,
  createJob,
  getJob,
  listJobs,
  startJob,
  updateProgress,
  completeJob,
  failJob,
  cancelJob,
  deleteJob,
  getQuantizationStats,
  /* V2 (Phase 20) */
  MODEL_MATURITY_V2,
  JOB_TICKET_V2,
  getDefaultMaxActiveModelsPerOwnerV2,
  getMaxActiveModelsPerOwnerV2,
  setMaxActiveModelsPerOwnerV2,
  getDefaultMaxRunningJobsPerOwnerV2,
  getMaxRunningJobsPerOwnerV2,
  setMaxRunningJobsPerOwnerV2,
  getDefaultModelIdleMsV2,
  getModelIdleMsV2,
  setModelIdleMsV2,
  getDefaultJobStuckMsV2,
  getJobStuckMsV2,
  setJobStuckMsV2,
  registerModelV2,
  getModelV2,
  setModelMaturityV2,
  activateModel,
  deprecateModel,
  retireModel,
  touchModelUsage,
  enqueueJobTicketV2,
  getJobTicketV2,
  setJobTicketStatusV2,
  startJobTicket,
  completeJobTicket,
  failJobTicket,
  cancelJobTicket,
  getActiveModelCount,
  getRunningJobCount,
  autoRetireIdleModels,
  autoFailStuckJobTickets,
  getQuantizationStatsV2,
} from "../lib/quantization.js";

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

export function registerQuantizationCommand(program) {
  const quant = new Command("quantize")
    .description("Model quantization system (Phase 20)")
    .hook("preAction", (thisCmd) => {
      const db = _dbFromCtx(thisCmd);
      if (db) ensureQuantizationTables(db);
    });

  /* ── Catalogs ────────────────────────────────────── */

  quant
    .command("statuses")
    .description("List job statuses")
    .option("--json", "JSON output")
    .action((opts) => {
      const statuses = Object.values(JOB_STATUS);
      if (opts.json) return console.log(JSON.stringify(statuses, null, 2));
      for (const s of statuses) console.log(`  ${s}`);
    });

  quant
    .command("types")
    .description("List quantization types (gguf/gptq)")
    .option("--json", "JSON output")
    .action((opts) => {
      const types = Object.values(QUANT_TYPE);
      if (opts.json) return console.log(JSON.stringify(types, null, 2));
      for (const t of types) console.log(`  ${t}`);
    });

  quant
    .command("levels")
    .description("List GGUF quantization levels (14 levels)")
    .option("--json", "JSON output")
    .action((opts) => {
      if (opts.json) return console.log(JSON.stringify(GGUF_LEVELS, null, 2));
      for (const l of GGUF_LEVELS) {
        console.log(
          `  ${l.level.padEnd(8)} ${String(l.bits).padEnd(4)}bit  ${l.description}`,
        );
      }
    });

  quant
    .command("gptq-bits")
    .description("List GPTQ bit widths")
    .option("--json", "JSON output")
    .action((opts) => {
      if (opts.json) return console.log(JSON.stringify(GPTQ_BITS, null, 2));
      for (const b of GPTQ_BITS) console.log(`  ${b}-bit`);
    });

  /* ── Job Lifecycle ─────────────────────────────────── */

  quant
    .command("create")
    .description("Create a quantization job")
    .requiredOption("-i, --input <path>", "Source model path")
    .option("-o, --output <path>", "Output path")
    .requiredOption("-t, --type <gguf|gptq>", "Quantization type")
    .option("-l, --level <level>", "GGUF quantization level (e.g. Q4_K_M)")
    .option(
      "-c, --config <json>",
      "Config JSON (for GPTQ: bits, groupSize, etc.)",
    )
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(quant);
      let config = null;
      if (opts.config) {
        try {
          config = JSON.parse(opts.config);
        } catch (_e) {
          config = opts.config;
        }
      }
      const result = createJob(db, {
        inputPath: opts.input,
        outputPath: opts.output,
        quantType: opts.type,
        quantLevel: opts.level,
        config,
      });
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      if (result.created) console.log(`Job created: ${result.jobId}`);
      else console.log(`Failed: ${result.reason}`);
    });

  quant
    .command("start <id>")
    .description("Start a pending job (simulated)")
    .option("--json", "JSON output")
    .action((id, opts) => {
      const db = _dbFromCtx(quant);
      const result = startJob(db, id);
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      console.log(
        result.started ? `Job started: ${id}` : `Failed: ${result.reason}`,
      );
    });

  quant
    .command("progress <id> <percent>")
    .description("Update job progress (0-100)")
    .option("--json", "JSON output")
    .action((id, percent, opts) => {
      const db = _dbFromCtx(quant);
      const result = updateProgress(db, id, Number(percent));
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      console.log(
        result.updated
          ? `Progress: ${result.progress}%`
          : `Failed: ${result.reason}`,
      );
    });

  quant
    .command("complete <id>")
    .description("Mark a running job as completed")
    .option("-o, --output <path>", "Output file path")
    .option("-s, --size <bytes>", "Output file size in bytes", parseInt)
    .option("--json", "JSON output")
    .action((id, opts) => {
      const db = _dbFromCtx(quant);
      const result = completeJob(db, id, {
        outputPath: opts.output,
        fileSizeBytes: opts.size,
      });
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      console.log(
        result.completed ? "Job completed." : `Failed: ${result.reason}`,
      );
    });

  quant
    .command("fail <id>")
    .description("Mark a job as failed")
    .option("-e, --error <message>", "Error message")
    .option("--json", "JSON output")
    .action((id, opts) => {
      const db = _dbFromCtx(quant);
      const result = failJob(db, id, opts.error);
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      console.log(
        result.failed ? "Job marked as failed." : `Failed: ${result.reason}`,
      );
    });

  quant
    .command("cancel <id>")
    .description("Cancel a pending or running job")
    .option("--json", "JSON output")
    .action((id, opts) => {
      const db = _dbFromCtx(quant);
      const result = cancelJob(db, id);
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      console.log(
        result.cancelled ? "Job cancelled." : `Failed: ${result.reason}`,
      );
    });

  quant
    .command("delete <id>")
    .description("Delete a non-running job")
    .option("--json", "JSON output")
    .action((id, opts) => {
      const db = _dbFromCtx(quant);
      const result = deleteJob(db, id);
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      console.log(result.deleted ? "Job deleted." : `Failed: ${result.reason}`);
    });

  /* ── Query ─────────────────────────────────────────── */

  quant
    .command("show <id>")
    .description("Show job details")
    .option("--json", "JSON output")
    .action((id, opts) => {
      const db = _dbFromCtx(quant);
      const j = getJob(db, id);
      if (!j) return console.log("Job not found.");
      if (opts.json) return console.log(JSON.stringify(j, null, 2));
      console.log(`ID:         ${j.id}`);
      console.log(`Input:      ${j.input_path}`);
      if (j.output_path) console.log(`Output:     ${j.output_path}`);
      console.log(`Type:       ${j.quant_type}`);
      if (j.quant_level) console.log(`Level:      ${j.quant_level}`);
      console.log(`Status:     ${j.status}`);
      console.log(`Progress:   ${j.progress}%`);
      if (j.file_size_bytes)
        console.log(`Size:       ${j.file_size_bytes} bytes`);
      if (j.error_message) console.log(`Error:      ${j.error_message}`);
      if (j.config) console.log(`Config:     ${j.config}`);
    });

  quant
    .command("list")
    .description("List quantization jobs")
    .option("-s, --status <status>", "Filter by status")
    .option("-t, --type <type>", "Filter by quant type (gguf/gptq)")
    .option("--limit <n>", "Max results", parseInt)
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(quant);
      const results = listJobs(db, {
        status: opts.status,
        quantType: opts.type,
        limit: opts.limit,
      });
      if (opts.json) return console.log(JSON.stringify(results, null, 2));
      if (results.length === 0) return console.log("No jobs.");
      for (const j of results) {
        console.log(
          `  ${j.status.padEnd(10)} ${j.quant_type.padEnd(5)} ${(j.quant_level || "-").padEnd(8)} ${String(j.progress).padEnd(6)}% ${j.input_path.slice(0, 30).padEnd(32)} ${j.id.slice(0, 8)}`,
        );
      }
    });

  /* ── Stats ─────────────────────────────────────────── */

  quant
    .command("stats")
    .description("Quantization statistics")
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(quant);
      const s = getQuantizationStats(db);
      if (opts.json) return console.log(JSON.stringify(s, null, 2));
      console.log(`Total jobs: ${s.total} (completed: ${s.completed})`);
      for (const [status, count] of Object.entries(s.byStatus)) {
        if (count > 0) console.log(`  ${status.padEnd(10)} ${count}`);
      }
      console.log(`By type:`);
      for (const [type, count] of Object.entries(s.byType)) {
        if (count > 0) console.log(`  ${type.padEnd(6)} ${count}`);
      }
      if (Object.keys(s.byLevel).length > 0) {
        console.log(`By level:`);
        for (const [level, count] of Object.entries(s.byLevel)) {
          console.log(`  ${level.padEnd(8)} ${count}`);
        }
      }
      if (s.totalSizeBytes > 0)
        console.log(`Total output: ${s.totalSizeBytes} bytes`);
      if (s.avgDurationMs > 0)
        console.log(`Avg duration: ${s.avgDurationMs}ms`);
    });

  /* ═════════════════════════════════════════════════════ *
   *  Phase 20 V2 — Model Maturity + Job Ticket Lifecycle
   * ═════════════════════════════════════════════════════ */

  quant
    .command("model-maturities-v2")
    .description("List Phase 20 V2 model maturity states")
    .option("--json", "JSON output")
    .action((opts) => {
      const v = Object.values(MODEL_MATURITY_V2);
      if (opts.json) return console.log(JSON.stringify(v, null, 2));
      for (const s of v) console.log(s);
    });

  quant
    .command("job-ticket-lifecycles-v2")
    .description("List Phase 20 V2 job-ticket lifecycle states")
    .option("--json", "JSON output")
    .action((opts) => {
      const v = Object.values(JOB_TICKET_V2);
      if (opts.json) return console.log(JSON.stringify(v, null, 2));
      for (const s of v) console.log(s);
    });

  quant
    .command("default-max-active-models-per-owner")
    .description("Show default V2 per-owner active-model cap")
    .action(() => console.log(getDefaultMaxActiveModelsPerOwnerV2()));

  quant
    .command("max-active-models-per-owner")
    .description("Show current V2 per-owner active-model cap")
    .action(() => console.log(getMaxActiveModelsPerOwnerV2()));

  quant
    .command("set-max-active-models-per-owner <n>")
    .description("Set V2 per-owner active-model cap")
    .action((n) => console.log(setMaxActiveModelsPerOwnerV2(n)));

  quant
    .command("default-max-running-jobs-per-owner")
    .description("Show default V2 per-owner running-job cap")
    .action(() => console.log(getDefaultMaxRunningJobsPerOwnerV2()));

  quant
    .command("max-running-jobs-per-owner")
    .description("Show current V2 per-owner running-job cap")
    .action(() => console.log(getMaxRunningJobsPerOwnerV2()));

  quant
    .command("set-max-running-jobs-per-owner <n>")
    .description("Set V2 per-owner running-job cap")
    .action((n) => console.log(setMaxRunningJobsPerOwnerV2(n)));

  quant
    .command("default-model-idle-ms")
    .description("Show default V2 model-idle threshold")
    .action(() => console.log(getDefaultModelIdleMsV2()));

  quant
    .command("model-idle-ms")
    .description("Show current V2 model-idle threshold")
    .action(() => console.log(getModelIdleMsV2()));

  quant
    .command("set-model-idle-ms <ms>")
    .description("Set V2 model-idle threshold (ms)")
    .action((ms) => console.log(setModelIdleMsV2(ms)));

  quant
    .command("default-job-stuck-ms")
    .description("Show default V2 job-stuck threshold")
    .action(() => console.log(getDefaultJobStuckMsV2()));

  quant
    .command("job-stuck-ms")
    .description("Show current V2 job-stuck threshold")
    .action(() => console.log(getJobStuckMsV2()));

  quant
    .command("set-job-stuck-ms <ms>")
    .description("Set V2 job-stuck threshold (ms)")
    .action((ms) => console.log(setJobStuckMsV2(ms)));

  quant
    .command("active-model-count")
    .description("Count active V2 models (optionally scoped by owner)")
    .option("-o, --owner <id>", "Owner ID")
    .action((opts) => console.log(getActiveModelCount(opts.owner)));

  quant
    .command("running-job-count")
    .description("Count running V2 job tickets (optionally scoped by owner)")
    .option("-o, --owner <id>", "Owner ID")
    .action((opts) => console.log(getRunningJobCount(opts.owner)));

  quant
    .command("register-model-v2 <model-id>")
    .description("Register a V2 model")
    .requiredOption("-o, --owner <id>", "Owner ID")
    .option("-f, --family <name>", "Model family (e.g. llama)")
    .option("-i, --initial-status <status>", "Initial status")
    .option("-m, --metadata <json>", "Metadata JSON")
    .option("--json", "JSON output")
    .action((modelId, opts) => {
      const db = _dbFromCtx(quant);
      const rec = registerModelV2(db, {
        modelId,
        ownerId: opts.owner,
        family: opts.family,
        initialStatus: opts.initialStatus,
        metadata: _parseMetaV2(opts.metadata),
      });
      if (opts.json) return console.log(JSON.stringify(rec, null, 2));
      console.log(`Registered model ${modelId} (${rec.status})`);
    });

  quant
    .command("model-v2 <model-id>")
    .description("Show a V2 model")
    .option("--json", "JSON output")
    .action((id, opts) => {
      const rec = getModelV2(id);
      if (!rec) {
        console.error(`Unknown model: ${id}`);
        process.exitCode = 1;
        return;
      }
      if (opts.json) return console.log(JSON.stringify(rec, null, 2));
      console.log(`${rec.modelId} [${rec.status}] owner=${rec.ownerId}`);
    });

  quant
    .command("set-model-maturity-v2 <model-id> <status>")
    .description("Transition V2 model maturity")
    .option("-r, --reason <text>", "Reason")
    .option("-m, --metadata <json>", "Metadata patch (JSON)")
    .action((id, status, opts) => {
      const db = _dbFromCtx(quant);
      const rec = setModelMaturityV2(db, id, status, {
        reason: opts.reason,
        metadata: _parseMetaV2(opts.metadata),
      });
      console.log(`${id} → ${rec.status}`);
    });

  quant
    .command("activate-model <model-id>")
    .description("Transition a V2 model to ACTIVE")
    .option("-r, --reason <text>", "Reason")
    .action((id, opts) => {
      const rec = activateModel(_dbFromCtx(quant), id, opts.reason);
      console.log(`${id} → ${rec.status}`);
    });

  quant
    .command("deprecate-model <model-id>")
    .description("Transition a V2 model to DEPRECATED")
    .option("-r, --reason <text>", "Reason")
    .action((id, opts) => {
      const rec = deprecateModel(_dbFromCtx(quant), id, opts.reason);
      console.log(`${id} → ${rec.status}`);
    });

  quant
    .command("retire-model <model-id>")
    .description("Transition a V2 model to RETIRED")
    .option("-r, --reason <text>", "Reason")
    .action((id, opts) => {
      const rec = retireModel(_dbFromCtx(quant), id, opts.reason);
      console.log(`${id} → ${rec.status}`);
    });

  quant
    .command("touch-model-usage <model-id>")
    .description("Bump lastUsedAt for a V2 model")
    .action((id) => {
      const rec = touchModelUsage(id);
      console.log(`${id} lastUsedAt=${rec.lastUsedAt}`);
    });

  quant
    .command("enqueue-job-ticket-v2 <ticket-id>")
    .description("Enqueue a V2 quantization job ticket")
    .requiredOption("-o, --owner <id>", "Owner ID")
    .requiredOption("-M, --model <id>", "Model ID")
    .requiredOption("-t, --quant-type <type>", "Quant type (gguf/gptq)")
    .option("-l, --level <lvl>", "Level (e.g. Q4_K_M)")
    .option("-m, --metadata <json>", "Metadata JSON")
    .option("--json", "JSON output")
    .action((ticketId, opts) => {
      const db = _dbFromCtx(quant);
      const rec = enqueueJobTicketV2(db, {
        ticketId,
        ownerId: opts.owner,
        modelId: opts.model,
        quantType: opts.quantType,
        level: opts.level,
        metadata: _parseMetaV2(opts.metadata),
      });
      if (opts.json) return console.log(JSON.stringify(rec, null, 2));
      console.log(`Enqueued ticket ${ticketId} (${rec.status})`);
    });

  quant
    .command("job-ticket-v2 <ticket-id>")
    .description("Show a V2 job ticket")
    .option("--json", "JSON output")
    .action((id, opts) => {
      const rec = getJobTicketV2(id);
      if (!rec) {
        console.error(`Unknown ticket: ${id}`);
        process.exitCode = 1;
        return;
      }
      if (opts.json) return console.log(JSON.stringify(rec, null, 2));
      console.log(`${rec.ticketId} [${rec.status}] owner=${rec.ownerId}`);
    });

  quant
    .command("set-job-ticket-status-v2 <ticket-id> <status>")
    .description("Transition V2 job ticket status")
    .option("-r, --reason <text>", "Reason")
    .option("-m, --metadata <json>", "Metadata patch (JSON)")
    .action((id, status, opts) => {
      const db = _dbFromCtx(quant);
      const rec = setJobTicketStatusV2(db, id, status, {
        reason: opts.reason,
        metadata: _parseMetaV2(opts.metadata),
      });
      console.log(`${id} → ${rec.status}`);
    });

  quant
    .command("start-job-ticket <ticket-id>")
    .description("Transition a V2 job ticket to RUNNING")
    .option("-r, --reason <text>", "Reason")
    .action((id, opts) => {
      const rec = startJobTicket(_dbFromCtx(quant), id, opts.reason);
      console.log(`${id} → ${rec.status}`);
    });

  quant
    .command("complete-job-ticket <ticket-id>")
    .description("Transition a V2 job ticket to COMPLETED")
    .option("-r, --reason <text>", "Reason")
    .action((id, opts) => {
      const rec = completeJobTicket(_dbFromCtx(quant), id, opts.reason);
      console.log(`${id} → ${rec.status}`);
    });

  quant
    .command("fail-job-ticket <ticket-id>")
    .description("Transition a V2 job ticket to FAILED")
    .option("-r, --reason <text>", "Reason")
    .action((id, opts) => {
      const rec = failJobTicket(_dbFromCtx(quant), id, opts.reason);
      console.log(`${id} → ${rec.status}`);
    });

  quant
    .command("cancel-job-ticket <ticket-id>")
    .description("Transition a V2 job ticket to CANCELED")
    .option("-r, --reason <text>", "Reason")
    .action((id, opts) => {
      const rec = cancelJobTicket(_dbFromCtx(quant), id, opts.reason);
      console.log(`${id} → ${rec.status}`);
    });

  quant
    .command("auto-retire-idle-models")
    .description("Flip idle V2 models (active+deprecated) → RETIRED")
    .option("--json", "JSON output")
    .action((opts) => {
      const r = autoRetireIdleModels(_dbFromCtx(quant));
      if (opts.json) return console.log(JSON.stringify(r, null, 2));
      console.log(`Retired ${r.count} idle model(s)`);
    });

  quant
    .command("auto-fail-stuck-job-tickets")
    .description("Flip stuck RUNNING V2 tickets → FAILED")
    .option("--json", "JSON output")
    .action((opts) => {
      const r = autoFailStuckJobTickets(_dbFromCtx(quant));
      if (opts.json) return console.log(JSON.stringify(r, null, 2));
      console.log(`Failed ${r.count} stuck ticket(s)`);
    });

  quant
    .command("stats-v2")
    .description("Phase 20 V2 statistics")
    .option("--json", "JSON output")
    .action((opts) => {
      const s = getQuantizationStatsV2();
      if (opts.json) return console.log(JSON.stringify(s, null, 2));
      console.log(
        `Models(V2)=${s.totalModelsV2} Tickets(V2)=${s.totalTicketsV2} ` +
          `caps: active-models/owner=${s.maxActiveModelsPerOwner} running-jobs/owner=${s.maxRunningJobsPerOwner}`,
      );
      console.log("models-by-status:");
      for (const [k, v] of Object.entries(s.modelsByStatus))
        console.log(`  ${k.padEnd(12)} ${v}`);
      console.log("tickets-by-status:");
      for (const [k, v] of Object.entries(s.ticketsByStatus))
        console.log(`  ${k.padEnd(12)} ${v}`);
    });

  program.addCommand(quant);
}

// === Iter18 V2 governance overlay ===
export function registerQntgovV2Commands(program) {
  const parent = program.commands.find((c) => c.name() === "quantize");
  if (!parent) return;
  const L = async () => await import("../lib/quantization.js");
  parent
    .command("qntgov-enums-v2")
    .description("Show V2 enums")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            profileMaturity: m.QNTGOV_PROFILE_MATURITY_V2,
            jobLifecycle: m.QNTGOV_JOB_LIFECYCLE_V2,
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("qntgov-config-v2")
    .description("Show V2 config")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            maxActive: m.getMaxActiveQntgovProfilesPerOwnerV2(),
            maxPending: m.getMaxPendingQntgovJobsPerProfileV2(),
            idleMs: m.getQntgovProfileIdleMsV2(),
            stuckMs: m.getQntgovJobStuckMsV2(),
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("qntgov-set-max-active-v2 <n>")
    .description("Set max active")
    .action(async (n) => {
      (await L()).setMaxActiveQntgovProfilesPerOwnerV2(Number(n));
      console.log("ok");
    });
  parent
    .command("qntgov-set-max-pending-v2 <n>")
    .description("Set max pending")
    .action(async (n) => {
      (await L()).setMaxPendingQntgovJobsPerProfileV2(Number(n));
      console.log("ok");
    });
  parent
    .command("qntgov-set-idle-ms-v2 <n>")
    .description("Set idle threshold ms")
    .action(async (n) => {
      (await L()).setQntgovProfileIdleMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("qntgov-set-stuck-ms-v2 <n>")
    .description("Set stuck threshold ms")
    .action(async (n) => {
      (await L()).setQntgovJobStuckMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("qntgov-register-v2 <id> <owner>")
    .description("Register V2 profile")
    .option("--precision <v>", "precision")
    .action(async (id, owner, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.registerQntgovProfileV2({ id, owner, precision: o.precision }),
          null,
          2,
        ),
      );
    });
  parent
    .command("qntgov-activate-v2 <id>")
    .description("Activate profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).activateQntgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("qntgov-stale-v2 <id>")
    .description("Stale profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).staleQntgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("qntgov-archive-v2 <id>")
    .description("Archive profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).archiveQntgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("qntgov-touch-v2 <id>")
    .description("Touch profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).touchQntgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("qntgov-get-v2 <id>")
    .description("Get profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getQntgovProfileV2(id), null, 2));
    });
  parent
    .command("qntgov-list-v2")
    .description("List profiles")
    .action(async () => {
      console.log(JSON.stringify((await L()).listQntgovProfilesV2(), null, 2));
    });
  parent
    .command("qntgov-create-job-v2 <id> <profileId>")
    .description("Create job")
    .option("--model <v>", "model")
    .action(async (id, profileId, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.createQntgovJobV2({ id, profileId, model: o.model }),
          null,
          2,
        ),
      );
    });
  parent
    .command("qntgov-quantizing-job-v2 <id>")
    .description("Mark job as quantizing")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).quantizingQntgovJobV2(id), null, 2),
      );
    });
  parent
    .command("qntgov-complete-job-v2 <id>")
    .description("Complete job")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).completeJobQntgovV2(id), null, 2));
    });
  parent
    .command("qntgov-fail-job-v2 <id> [reason]")
    .description("Fail job")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).failQntgovJobV2(id, reason), null, 2),
      );
    });
  parent
    .command("qntgov-cancel-job-v2 <id> [reason]")
    .description("Cancel job")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).cancelQntgovJobV2(id, reason), null, 2),
      );
    });
  parent
    .command("qntgov-get-job-v2 <id>")
    .description("Get job")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getQntgovJobV2(id), null, 2));
    });
  parent
    .command("qntgov-list-jobs-v2")
    .description("List jobs")
    .action(async () => {
      console.log(JSON.stringify((await L()).listQntgovJobsV2(), null, 2));
    });
  parent
    .command("qntgov-auto-stale-idle-v2")
    .description("Auto-stale idle")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoStaleIdleQntgovProfilesV2(), null, 2),
      );
    });
  parent
    .command("qntgov-auto-fail-stuck-v2")
    .description("Auto-fail stuck jobs")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoFailStuckQntgovJobsV2(), null, 2),
      );
    });
  parent
    .command("qntgov-gov-stats-v2")
    .description("V2 gov stats")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).getQuantizationGovStatsV2(), null, 2),
      );
    });
}
