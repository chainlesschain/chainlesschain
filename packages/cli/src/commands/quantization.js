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
} from "../lib/quantization.js";

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

  program.addCommand(quant);
}
