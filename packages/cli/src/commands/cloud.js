/**
 * `cc cloud` — self-hosted cloud handoff (gap-2026-07-11 P1#7).
 *
 *   cc cloud run "<task>"    bundle branch → submit to the private runner → record job
 *   cc cloud status [id]     poll job(s) (last job when id omitted)
 *   cc cloud attach <id>     wait for completion, reflow patch/plan/pr/artifacts locally
 *   cc cloud list            local job ledger
 *
 * Runner endpoint + token come from config (cloud.baseUrl / cloud.token) or
 * env (CC_CLOUD_URL / CC_CLOUD_TOKEN). See src/lib/cloud/cloud-client.js for
 * the runner protocol.
 */

import { join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import chalk from "chalk";
import { logger } from "../lib/logger.js";

async function resolveRunner() {
  let cfg = {};
  try {
    cfg = (await import("../lib/config-manager.js")).loadConfig()?.cloud || {};
  } catch {
    cfg = {};
  }
  const baseUrl = process.env.CC_CLOUD_URL || cfg.baseUrl || "";
  const token = process.env.CC_CLOUD_TOKEN || cfg.token || null;
  return { baseUrl, token };
}

function statusColor(status) {
  if (status === "done") return chalk.green;
  if (status === "failed" || status === "timeout") return chalk.red;
  if (status === "running") return chalk.cyan;
  return chalk.gray;
}

export function registerCloudCommand(program) {
  const cloud = program
    .command("cloud")
    .description(
      "Self-hosted cloud handoff — offload a task to a private runner (bundle → run → reflow)",
    );

  cloud
    .command("run <task...>")
    .description(
      "Bundle the current branch and submit a task to the private runner",
    )
    .option("--json", "Output as JSON")
    .option("--attach", "Wait for completion and reflow the result")
    .action(async (taskWords, options) => {
      try {
        const task = taskWords.join(" ");
        const { baseUrl, token } = await resolveRunner();
        const { CloudClient, saveJob } =
          await import("../lib/cloud/cloud-client.js");
        const { bundleBranch } = await import("../lib/cloud/bundle.js");
        const client = new CloudClient({ baseUrl, token });

        logger.log(chalk.gray("Bundling current branch…"));
        const snap = bundleBranch(process.cwd());
        logger.log(
          chalk.gray(
            `  ${snap.branch} @ ${snap.baseSha.slice(0, 8)} (${(snap.bytes / 1024).toFixed(0)} KB)`,
          ),
        );

        const submitted = await client.submit({
          task,
          bundle: snap.bundle,
          branch: snap.branch,
          baseSha: snap.baseSha,
        });
        const job = saveJob({
          jobId: submitted.jobId,
          task,
          branch: snap.branch,
          baseSha: snap.baseSha,
          baseUrl,
          status: "queued",
          submittedAt: Date.now(),
          cwd: process.cwd(),
        });
        if (options.json && !options.attach) {
          return console.log(JSON.stringify(job, null, 2));
        }
        logger.success(`Submitted cloud job ${job.jobId} → ${baseUrl}`);
        logger.log(chalk.gray(`  cc cloud attach ${job.jobId}`));
        if (options.attach) await attachJob(job.jobId, options);
      } catch (err) {
        logger.error(err.message);
        process.exitCode = 1;
      }
    });

  cloud
    .command("status [id]")
    .description("Poll a cloud job's status (most recent when id omitted)")
    .option("--json", "Output as JSON")
    .action(async (id, options) => {
      try {
        const { CloudClient, readJob, listJobs, saveJob } =
          await import("../lib/cloud/cloud-client.js");
        const job = id ? readJob(id) : listJobs()[0];
        if (!job)
          throw new Error(id ? `job not found: ${id}` : "no cloud jobs");
        const client = new CloudClient({
          baseUrl: job.baseUrl,
          token: (await resolveRunner()).token,
        });
        const status = await client.status(job.jobId);
        saveJob({ ...job, status: status.status, lastSummary: status.summary });
        if (options.json) return console.log(JSON.stringify(status, null, 2));
        logger.log(
          `${statusColor(status.status)(status.status)} ${job.jobId}  ${chalk.gray(job.task)}`,
        );
        if (status.summary) logger.log(chalk.gray(`  ${status.summary}`));
      } catch (err) {
        logger.error(err.message);
        process.exitCode = 1;
      }
    });

  cloud
    .command("attach <id>")
    .description("Wait for a cloud job to finish and reflow its result locally")
    .option("--json", "Output as JSON")
    .option("--no-apply", "Fetch the result but do not apply the patch")
    .action(async (id, options) => {
      try {
        await attachJob(id, options);
      } catch (err) {
        logger.error(err.message);
        process.exitCode = 1;
      }
    });

  cloud
    .command("list", { isDefault: true })
    .description("List local cloud jobs")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const { listJobs } = await import("../lib/cloud/cloud-client.js");
        const jobs = listJobs();
        if (options.json) return console.log(JSON.stringify(jobs, null, 2));
        if (jobs.length === 0) {
          logger.log(
            chalk.gray("No cloud jobs. Submit one with `cc cloud run`."),
          );
          return;
        }
        for (const j of jobs) {
          logger.log(
            `${statusColor(j.status)((j.status || "?").padEnd(8))} ${j.jobId}  ${chalk.gray(j.branch)}  ${j.task}`,
          );
        }
      } catch (err) {
        logger.error(err.message);
        process.exitCode = 1;
      }
    });
}

async function attachJob(id, options = {}) {
  const { CloudClient, readJob, saveJob, pollUntilDone } =
    await import("../lib/cloud/cloud-client.js");
  const { applyResultPatch, persistResultArtifacts } =
    await import("../lib/cloud/bundle.js");
  const { token } = await resolveRunner();

  const job = readJob(id);
  if (!job) throw new Error(`job not found: ${id}`);
  const client = new CloudClient({ baseUrl: job.baseUrl, token });

  logger.log(chalk.gray(`Waiting for ${id}…`));
  const final = await pollUntilDone(client, id, {
    onTick: (s) =>
      logger.log(
        chalk.gray(`  ${s.status}${s.summary ? `: ${s.summary}` : ""}`),
      ),
  });
  saveJob({ ...job, status: final.status, lastSummary: final.summary });

  if (final.status !== "done") {
    logger.error(`Job ${id} ended ${final.status}: ${final.summary || ""}`);
    process.exitCode = 1;
    return;
  }

  const result = await client.result(id);

  // Persist plan/artifacts under the job's local dir.
  const { cloudJobsDir } = await import("../lib/cloud/cloud-client.js");
  const destDir = join(cloudJobsDir(), `${id}-result`);
  if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
  const written = persistResultArtifacts(result, destDir);

  let applied = null;
  if (result.patch && options.apply !== false) {
    applied = applyResultPatch(result.patch, job.cwd || process.cwd());
  }

  if (options.json) {
    return console.log(
      JSON.stringify(
        { jobId: id, status: final.status, applied, written, pr: result.pr },
        null,
        2,
      ),
    );
  }
  logger.success(`Job ${id} done`);
  if (result.pr)
    logger.log(chalk.magenta(`  PR: ${result.pr.url || result.pr}`));
  if (applied) {
    logger.log(
      applied.applied
        ? chalk.green(`  patch: ${applied.reason}`)
        : chalk.yellow(`  patch: ${applied.reason} (saved under ${destDir})`),
    );
    if (!applied.applied) {
      // Save the unapplied patch so the user can resolve it by hand.
      persistResultArtifacts(
        { artifacts: [{ name: "result.patch", content: result.patch }] },
        destDir,
      );
    }
  }
  for (const w of written) logger.log(chalk.gray(`  wrote ${w}`));
}
