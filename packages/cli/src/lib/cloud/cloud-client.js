/**
 * Self-hosted cloud handoff (gap-2026-07-11 P1#7) — the private-runner version
 * of Claude Code's --cloud/--teleport. `cc cloud run "<task>"` bundles the
 * current git branch, POSTs it to a configured private runner, and records the
 * job locally; `cc cloud status/attach` poll and reflow the runner's result
 * (plan / patch / PR / artifacts) back into the local workspace.
 *
 * No Anthropic cloud dependency: the runner is any HTTP endpoint speaking the
 * small protocol below (a reference runner can be a box running `cc agent`).
 *
 *   POST   {base}/v1/jobs           {task, bundle(base64), branch, baseSha}     → {jobId}
 *   GET    {base}/v1/jobs/{id}       → {status: queued|running|done|failed, summary?}
 *   GET    {base}/v1/jobs/{id}/result → {patch?, plan?, pr?, artifacts?, log?}
 *
 * Auth: Bearer token (config cloud.token / CC_CLOUD_TOKEN). Transport (fetch)
 * and the bundle builder are injected so this is unit-testable offline.
 *
 * Local job ledger: ~/.chainlesschain/cloud-jobs/<jobId>.json
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { getHomeDir } from "../paths.js";

export const _deps = { fetch: (...a) => globalThis.fetch(...a) };

export function cloudJobsDir() {
  const dir = join(getHomeDir(), "cloud-jobs");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function jobPath(jobId) {
  if (!/^[\w.-]+$/.test(String(jobId || ""))) {
    throw new Error(`invalid job id: ${jobId}`);
  }
  return join(cloudJobsDir(), `${jobId}.json`);
}

export function saveJob(job) {
  writeFileSync(jobPath(job.jobId), JSON.stringify(job, null, 2), "utf-8");
  return job;
}

export function readJob(jobId) {
  try {
    return JSON.parse(readFileSync(jobPath(jobId), "utf-8"));
  } catch {
    return null;
  }
}

export function listJobs() {
  const dir = cloudJobsDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        return JSON.parse(readFileSync(join(dir, f), "utf-8"));
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => (b.submittedAt || 0) - (a.submittedAt || 0));
}

export class CloudClient {
  /**
   * @param {object} opts { baseUrl, token, deps? }
   */
  constructor(opts = {}) {
    this.baseUrl = String(opts.baseUrl || "").replace(/\/+$/, "");
    if (!this.baseUrl) {
      throw new Error(
        "no cloud runner configured — set cloud.baseUrl / CC_CLOUD_URL",
      );
    }
    this.token = opts.token || null;
    this.deps = { ..._deps, ...(opts.deps || {}) };
  }

  _headers(extra = {}) {
    return {
      "Content-Type": "application/json",
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      ...extra,
    };
  }

  async _json(method, path, body) {
    const res = await this.deps.fetch(`${this.baseUrl}${path}`, {
      method,
      headers: this._headers(),
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) {
      throw new Error(`cloud runner ${method} ${path} → HTTP ${res.status}`);
    }
    return res.json();
  }

  /** Submit a job. `bundle` is a base64 git bundle of the branch. */
  async submit({ task, bundle, branch, baseSha }) {
    const data = await this._json("POST", "/v1/jobs", {
      task,
      bundle,
      branch,
      baseSha,
    });
    if (!data?.jobId) throw new Error("runner did not return a jobId");
    return data;
  }

  async status(jobId) {
    return this._json("GET", `/v1/jobs/${encodeURIComponent(jobId)}`);
  }

  async result(jobId) {
    return this._json("GET", `/v1/jobs/${encodeURIComponent(jobId)}/result`);
  }
}

export const TERMINAL_CLOUD_STATUS = new Set(["done", "failed"]);

/**
 * Poll a job until terminal or the deadline. `onTick(status)` reports progress.
 * `sleep`/`now` injected for tests.
 */
export async function pollUntilDone(client, jobId, opts = {}) {
  const intervalMs = opts.intervalMs ?? 3000;
  const timeoutMs = opts.timeoutMs ?? 30 * 60_000;
  const sleep = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const now = opts.now || (() => Date.now());
  const deadline = now() + timeoutMs;
  for (;;) {
    const status = await client.status(jobId);
    opts.onTick?.(status);
    if (TERMINAL_CLOUD_STATUS.has(status.status)) return status;
    if (now() >= deadline) {
      return { status: "timeout", summary: "poll deadline reached" };
    }
    await sleep(intervalMs);
  }
}
