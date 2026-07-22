/**
 * Git branch bundling + result reflow for cloud handoff. A `git bundle` of the
 * current branch (base64) is the portable snapshot the private runner clones;
 * the runner returns a patch/plan/pr/artifacts which we apply/persist locally.
 *
 * All git calls go through the injectable `run` so the flow is testable without
 * a repo.
 */

import { writeFileSync, mkdtempSync } from "node:fs";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { executionBroker } from "../process-execution-broker/index.js";

function brokerExecFileSync(file, args, options) {
  const result = executionBroker.spawnSync(file, args, {
    ...options,
    origin: "cloud:git",
    policy: "allow",
    scope: "cloud",
    shell: false,
  });
  if (result?.error) throw result.error;
  if (result?.status != null && result.status !== 0) {
    const error = new Error(
      `Cloud git command failed (exit ${result.status}): ${args[0] || "git"}`,
    );
    error.status = result.status;
    error.stdout = result.stdout;
    error.stderr = result.stderr;
    throw error;
  }
  return result?.stdout || "";
}

export const _deps = { execFileSync: brokerExecFileSync };

function git(args, cwd, deps = _deps) {
  return deps
    .execFileSync("git", args, {
      cwd,
      encoding: "utf-8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    })
    .toString();
}

/**
 * Bundle the current branch into a base64 git bundle.
 * @returns {{ bundle:string, branch:string, baseSha:string, bytes:number }}
 */
export function bundleBranch(cwd = process.cwd(), deps = _deps) {
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"], cwd, deps).trim();
  const baseSha = git(["rev-parse", "HEAD"], cwd, deps).trim();
  const tmp = mkdtempSync(join(tmpdir(), "cc-cloud-bundle-"));
  const bundleFile = join(tmp, "branch.bundle");
  try {
    // Bundle the full branch history so the runner can clone a working repo.
    git(["bundle", "create", bundleFile, "HEAD", branch], cwd, deps);
    const buf = readFileSync(bundleFile);
    return {
      bundle: buf.toString("base64"),
      branch,
      baseSha,
      bytes: buf.length,
    };
  } finally {
    try {
      rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
}

/**
 * Apply a unified-diff patch the runner produced onto the local worktree.
 * Uses `git apply --3way` so it merges cleanly on top of local edits when
 * possible; returns { applied, reason }.
 */
export function applyResultPatch(patch, cwd = process.cwd(), deps = _deps) {
  if (!patch || !String(patch).trim()) {
    return { applied: false, reason: "no patch in result" };
  }
  const tmp = mkdtempSync(join(tmpdir(), "cc-cloud-patch-"));
  const patchFile = join(tmp, "result.patch");
  try {
    writeFileSync(patchFile, patch, "utf-8");
    git(["apply", "--3way", "--whitespace=nowarn", patchFile], cwd, deps);
    return { applied: true, reason: "patch applied (3way)" };
  } catch (err) {
    return {
      applied: false,
      reason: `patch did not apply cleanly: ${err.message.split("\n")[0]}`,
    };
  } finally {
    try {
      rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
}

/**
 * Persist non-patch result artifacts (plan text, artifact blobs) under the
 * job's local dir and return where they landed. `writeFile` injected.
 */
export function persistResultArtifacts(result, destDir, deps = {}) {
  const writeFile = deps.writeFileSync || writeFileSync;
  const written = [];
  if (result?.plan) {
    const p = join(destDir, "plan.md");
    writeFile(p, String(result.plan), "utf-8");
    written.push(p);
  }
  for (const art of Array.isArray(result?.artifacts) ? result.artifacts : []) {
    if (!art?.name || art.content == null) continue;
    const safe = String(art.name).replace(/[^\w.-]/g, "_");
    const p = join(destDir, safe);
    const content =
      art.encoding === "base64"
        ? Buffer.from(String(art.content), "base64")
        : String(art.content);
    writeFile(p, content);
    written.push(p);
  }
  return written;
}
