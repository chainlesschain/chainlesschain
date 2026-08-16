/**
 * Production DeliveryCoordinator adapter for a local git worktree + GitHub.
 *
 * Every process is launched with an argv array through ProcessExecutionBroker;
 * no shell command strings are accepted. Provider mutations are correlated to
 * the coordinator effect id, and any ambiguous process/provider failure is
 * thrown so the crash-safe runner leaves the effect pending for reconciliation.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ArtifactStore, publicArtifactMetadata } from "./artifact-store.js";
import { captureState } from "./chrome-connector.js";
import {
  assessDeliveryEvidence,
  canonicalDeliveryJson,
  verifyDeliveryEvidenceRecord,
} from "./delivery-evidence.js";
import { executionBroker } from "./process-execution-broker/index.js";
import { containsSecret, redactSecrets } from "./secret-scan.js";
import { runReview as runCliReview } from "../commands/review.js";

const EXACT_COMMIT_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;
const SHA256_RE = /^sha256:[0-9a-f]{64}$/i;
const MERGE_METHODS = new Set(["squash", "merge", "rebase"]);
const MAX_OUTPUT_CHARS = 16_000;

// Production delivery fixes are intentionally file-tool-only. This immutable
// ceiling is paired with `exactToolNames: true`, so shell/code/git and any
// dynamically registered MCP or external tools are unavailable to the fixer.
export const DELIVERY_FIXER_ALLOWED_TOOLS = Object.freeze([
  "read_file",
  "list_dir",
  "write_file",
  "edit_file",
  "edit_file_hashed",
]);

const WINDOWS_RESERVED_PATH_SEGMENT =
  /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu;

function exactPortableRepoFilePath(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.trim() !== value
  ) {
    return null;
  }
  const segments = value.split("/");
  if (
    value.includes("\0") ||
    value.includes("\\") ||
    path.posix.isAbsolute(value) ||
    /^[A-Za-z]:/u.test(value) ||
    path.posix.normalize(value) !== value ||
    value === "." ||
    value === ".." ||
    value.startsWith("../") ||
    segments.some(
      (segment) =>
        segment === "" ||
        segment === "." ||
        segment === ".." ||
        /[<>:"|?*]/u.test(segment) ||
        [...segment].some((character) => character.charCodeAt(0) <= 0x1f) ||
        /[ .]$/u.test(segment) ||
        WINDOWS_RESERVED_PATH_SEGMENT.test(segment),
    )
  ) {
    return null;
  }
  return value;
}

function sameCanonicalPath(left, right) {
  return path.relative(left, right) === "" && path.relative(right, left) === "";
}

function defaultRunProcess(file, args, options) {
  return executionBroker.spawnSync(file, args, options);
}

async function defaultReviewRunner(options) {
  return runCliReview(options, {
    writeOut: () => {},
    writeErr: () => {},
  });
}

function jsonClone(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function boundedText(value, maximum = MAX_OUTPUT_CHARS) {
  return redactSecrets(String(value || "").slice(0, maximum));
}

function parseJson(value, label) {
  try {
    return JSON.parse(String(value || ""));
  } catch (error) {
    throw new Error(`${label} returned invalid JSON: ${error.message}`);
  }
}

function sha256(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(String))];
}

function normalizedRepoPath(value) {
  return String(value || "")
    .replaceAll("\\", "/")
    .replace(/^\.\//u, "")
    .trim();
}

function githubRepositoryFromRemoteUrl(value) {
  const remoteUrl = String(value || "").trim();
  const match = remoteUrl.match(
    /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/u,
  );
  return match ? `${match[1]}/${match[2]}` : null;
}

function normalizedPathSet(values) {
  return uniqueStrings(values).map(normalizedRepoPath).filter(Boolean).sort();
}

function sameStringArray(left, right) {
  const a = normalizedPathSet(left);
  const b = normalizedPathSet(right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** Validate the complete fail-closed policy used by the production adapter. */
export function validateGitHubDeliveryProductionConfig(config) {
  const unmet = [];
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return {
      valid: false,
      reason: "provider-config-invalid",
      unmet: ["provider-config-invalid"],
    };
  }
  if (containsSecret(JSON.stringify(config))) unmet.push("raw-secret-detected");

  const gates = Array.isArray(config.gates) ? config.gates : [];
  const gateIds = gates.map((gate) => String(gate?.id || "").trim());
  if (gates.length === 0) unmet.push("gate-config-missing");
  if (gateIds.some((id) => !id)) unmet.push("gate-id-invalid");
  if (new Set(gateIds).size !== gateIds.length) {
    unmet.push("gate-id-duplicate");
  }
  gates.forEach((gate, gateIndex) => {
    const executions = Array.isArray(gate?.executions) ? gate.executions : [];
    const executionIds = executions.map((item) =>
      String(item?.id || "").trim(),
    );
    if (executions.length === 0) {
      unmet.push(`gate-executions-missing:${gateIds[gateIndex] || gateIndex}`);
    }
    if (
      executionIds.some((id) => !id) ||
      new Set(executionIds).size !== executionIds.length
    ) {
      unmet.push(
        `gate-execution-id-invalid:${gateIds[gateIndex] || gateIndex}`,
      );
    }
    if (executions.some((item) => !commandSpec(item))) {
      unmet.push(`gate-command-invalid:${gateIds[gateIndex] || gateIndex}`);
    }
  });

  if (
    !config.preview ||
    typeof config.preview !== "object" ||
    Array.isArray(config.preview)
  ) {
    unmet.push("preview-config-missing");
  }
  if (
    !config.review ||
    typeof config.review !== "object" ||
    Array.isArray(config.review)
  ) {
    unmet.push("review-config-missing");
  }
  const allowedPaths = Array.isArray(config.fix?.allowedPaths)
    ? config.fix.allowedPaths.map(exactPortableRepoFilePath)
    : [];
  if (
    allowedPaths.length === 0 ||
    new Set(allowedPaths).size !== allowedPaths.length ||
    allowedPaths.some((item) => !item)
  ) {
    unmet.push("fix-allowed-paths-invalid");
  }
  if (!EXACT_COMMIT_RE.test(String(config.fix?.baseCommitSha || ""))) {
    unmet.push("fix-base-commit-invalid");
  }
  if (
    !String(config.pullRequest?.base || "").trim() ||
    !String(config.pullRequest?.title || "").trim()
  ) {
    unmet.push("pull-request-config-invalid");
  }
  if (
    !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9_.-]{1,100}$/u.test(
      String(config.github?.repo || ""),
    )
  ) {
    unmet.push("github-repo-invalid");
  }
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(
      String(config.git?.remote || "origin").trim(),
    )
  ) {
    unmet.push("git-remote-invalid");
  }
  const requiredChecks = Array.isArray(config.ci?.requiredChecks)
    ? config.ci.requiredChecks.map((item) => String(item).trim())
    : [];
  if (
    requiredChecks.length === 0 ||
    requiredChecks.some((item) => !item) ||
    new Set(requiredChecks).size !== requiredChecks.length
  ) {
    unmet.push("ci-required-checks-invalid");
  }
  if (
    !config.merge ||
    typeof config.merge.enabled !== "boolean" ||
    !MERGE_METHODS.has(String(config.merge.method || "squash").toLowerCase())
  ) {
    unmet.push("merge-config-invalid");
  }

  const uniqueUnmet = [...new Set(unmet)];
  return {
    valid: uniqueUnmet.length === 0,
    reason: uniqueUnmet[0] || "ok",
    unmet: uniqueUnmet,
  };
}

function commandSpec(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const file = String(value.file || value.command || "").trim();
  const args = Array.isArray(value.args) ? value.args.map(String) : null;
  if (!file || !args) return null;
  const timeout = Number(value.timeoutMs);
  return {
    file,
    args,
    timeoutMs: Number.isFinite(timeout)
      ? Math.min(60 * 60 * 1000, Math.max(1000, timeout))
      : 15 * 60 * 1000,
  };
}

function definitiveFailure(error, extras = {}) {
  return {
    ok: false,
    error: String(error || "delivery provider configuration is invalid"),
    sideEffects: [],
    ...extras,
  };
}

function committedEffect(id, kind, details = {}) {
  return {
    id,
    kind,
    status: "committed",
    ...jsonClone(details),
  };
}

function noEffect(id, kind, details = {}) {
  return {
    id,
    kind,
    status: "no_effect",
    ...jsonClone(details),
  };
}

function failedEffect(id, kind, details = {}) {
  return {
    id,
    kind,
    status: "failed",
    ...jsonClone(details),
  };
}

function unknownEffect(id, kind, details = {}) {
  return {
    id,
    kind,
    status: "unknown",
    ...jsonClone(details),
  };
}

function boundEffectId(context) {
  const id = String(context?.effect?.id || "");
  if (!SHA256_RE.test(id)) {
    throw new Error(
      "production delivery provider requires an exact effect binding",
    );
  }
  return id;
}

function findingFromReport(finding = {}) {
  return {
    path: String(finding.path || finding.file || ""),
    line: Number(finding.line) || null,
    title: boundedText(finding.title || finding.failure_scenario || "finding"),
    severity: String(finding.severity || "Note"),
    confidence: Number.isFinite(Number(finding.confidence))
      ? Number(finding.confidence)
      : 1,
    category: String(finding.category || "correctness"),
    failureScenario: boundedText(
      finding.failure_scenario ||
        finding.failureScenario ||
        finding.title ||
        finding.body ||
        "finding",
    ),
    evidence: boundedText(
      finding.evidence || finding.body || finding.title || "",
    ),
  };
}

function checkState(value) {
  const raw = String(value || "").toUpperCase();
  if (["SUCCESS", "PASSED"].includes(raw)) return "success";
  if (["FAILURE", "FAILED", "ERROR", "TIMED_OUT", "CANCELLED"].includes(raw)) {
    return "failure";
  }
  if (["NEUTRAL", "SKIPPED"].includes(raw)) return "neutral";
  return "pending";
}

function statusPaths(output) {
  return uniqueStrings(
    String(output || "")
      .split("\0")
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

/** GitHub-backed implementation of all nine DeliveryCoordinator effects. */
export class GitHubDeliveryProductionAdapter {
  constructor(options = {}, deps = {}) {
    this.cwd = path.resolve(options.cwd || process.cwd());
    this.config =
      options.config && typeof options.config === "object"
        ? jsonClone(options.config)
        : {};
    const validation = validateGitHubDeliveryProductionConfig(this.config);
    if (!validation.valid) {
      throw new Error(
        `invalid production delivery provider config: ${validation.unmet.join(", ")}`,
      );
    }
    this._runProcess = deps.runProcess || defaultRunProcess;
    this._capturePreview = deps.capturePreview || captureState;
    this._runReview = deps.runReview || defaultReviewRunner;
    this._runFix = deps.runFix || defaultReviewRunner;
    this._artifactStore = deps.artifactStore || new ArtifactStore();
    this._readFileSync = deps.readFileSync || fs.readFileSync;
    this._tmpdir = deps.tmpdir || os.tmpdir;
  }

  _process(file, args, { timeoutMs = 30_000, origin, input } = {}) {
    return this._runProcess(String(file), args.map(String), {
      cwd: this.cwd,
      encoding: "utf8",
      input,
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
      origin: origin || "delivery:production",
      policy: "allow",
      scope: "delivery",
      shell: false,
    });
  }

  _read(file, args, label) {
    const result = this._process(file, args, {
      origin: `delivery:read:${label}`,
    });
    if (result?.error) throw result.error;
    if (Number(result?.status) !== 0) {
      throw new Error(
        boundedText(result?.stderr || result?.stdout) ||
          `${label} failed with exit ${result?.status}`,
      );
    }
    return String(result?.stdout || "");
  }

  _mutate(file, args, label, options = {}) {
    const result = this._process(file, args, {
      ...options,
      origin: `delivery:mutation:${label}`,
    });
    // A transport error or non-zero mutation can be ambiguous: the remote may
    // have accepted it before the client lost its response. Throwing preserves
    // the pending effect instead of authorizing a blind retry.
    if (result?.error) throw result.error;
    if (Number(result?.status) !== 0) {
      throw new Error(
        boundedText(result?.stderr || result?.stdout) ||
          `${label} failed with exit ${result?.status}`,
      );
    }
    return String(result?.stdout || "");
  }

  _git(args, label = args[0]) {
    return this._read("git", args, `git-${label}`);
  }

  _verifiedPushRemote() {
    const remote = String(this.config.git?.remote || "origin").trim();
    const remoteUrl = this._git(
      ["remote", "get-url", "--push", remote],
      "push-remote",
    ).trim();
    const actualRepository = githubRepositoryFromRemoteUrl(remoteUrl);
    const expectedRepository = String(this.config.github?.repo || "").trim();
    if (
      !actualRepository ||
      actualRepository.toLowerCase() !== expectedRepository.toLowerCase()
    ) {
      throw new Error(
        "configured Git push remote is not bound to the authoritative GitHub repository",
      );
    }
    return remote;
  }

  _gh(args, label = args[0]) {
    const repo = String(this.config.github?.repo || "").trim();
    const fullArgs =
      repo && !args.includes("--repo") ? [...args, "--repo", repo] : args;
    return this._read("gh", fullArgs, `gh-${label}`);
  }

  _ghMutate(args, label, options = {}) {
    const repo = String(this.config.github?.repo || "").trim();
    const fullArgs =
      repo && !args.includes("--repo") ? [...args, "--repo", repo] : args;
    return this._mutate("gh", fullArgs, `gh-${label}`, options);
  }

  _head() {
    return this._git(["rev-parse", "HEAD"], "head").trim();
  }

  _worktreeIdentity() {
    return {
      root: path.resolve(
        this._git(["rev-parse", "--show-toplevel"], "worktree-root").trim(),
      ),
      branch: this._git(["branch", "--show-current"], "branch").trim(),
      head: this._head(),
    };
  }

  _sameWorktreeIdentity(expected) {
    const actual = this._worktreeIdentity();
    return {
      ok:
        actual.root === expected.root &&
        actual.branch === expected.branch &&
        actual.head === expected.head,
      expected,
      actual,
    };
  }

  _verifyAllowedPathScope(allowedPaths, worktreeRoot) {
    try {
      const realpath = fs.realpathSync.native || fs.realpathSync;
      const root = path.resolve(realpath(worktreeRoot));
      if (!sameCanonicalPath(root, path.resolve(worktreeRoot))) {
        return {
          ok: false,
          error: "worktree root must be its canonical physical path",
        };
      }
      for (const relativePath of allowedPaths) {
        const exactPath = exactPortableRepoFilePath(relativePath);
        if (!exactPath) {
          return {
            ok: false,
            error: `allowed path is not portable and canonical: ${relativePath}`,
          };
        }
        const target = path.resolve(root, ...exactPath.split("/"));
        const lexical = path.relative(root, target);
        if (
          !lexical ||
          lexical === ".." ||
          lexical.startsWith(`..${path.sep}`) ||
          path.isAbsolute(lexical)
        ) {
          return {
            ok: false,
            error: `allowed path escapes worktree: ${relativePath}`,
          };
        }
        if (!fs.existsSync(target)) {
          return {
            ok: false,
            error: `allowed path must already exist: ${relativePath}`,
          };
        }
        const linkStats = fs.lstatSync(target, { bigint: true });
        if (linkStats.isSymbolicLink() || !linkStats.isFile()) {
          return {
            ok: false,
            error: `allowed path must be a non-link regular file: ${relativePath}`,
          };
        }
        if (linkStats.nlink !== 1n) {
          return {
            ok: false,
            error: `allowed path must not have hard links: ${relativePath}`,
          };
        }
        const physicalTarget = path.resolve(realpath(target));
        if (!sameCanonicalPath(physicalTarget, target)) {
          return {
            ok: false,
            error: `allowed path traverses a filesystem alias: ${relativePath}`,
          };
        }
      }
      return { ok: true, worktreeRoot: root };
    } catch (error) {
      return { ok: false, error: boundedText(error.message) };
    }
  }

  _freshness(expected) {
    const wanted = String(expected || "").trim();
    if (!EXACT_COMMIT_RE.test(wanted)) {
      return { ok: false, expected: wanted || null, actual: null };
    }
    try {
      const actual = this._head();
      return { ok: actual === wanted, expected: wanted, actual };
    } catch (error) {
      return {
        ok: false,
        expected: wanted,
        actual: null,
        error: error.message,
      };
    }
  }

  _cleanFreshness(expected) {
    const freshness = this._freshness(expected);
    if (!freshness.ok) return freshness;
    try {
      const status = this._git(["status", "--porcelain"], "clean-status");
      if (status.trim()) {
        return {
          ...freshness,
          ok: false,
          error: "worktree is not clean at the exact delivery head",
        };
      }
      return freshness;
    } catch (error) {
      return { ...freshness, ok: false, error: error.message };
    }
  }

  _freshnessFailure(freshness, phase, extras = {}) {
    return definitiveFailure(
      freshness.error ||
        `${phase} exact-head mismatch: expected ${freshness.expected || "unverified"}, found ${freshness.actual || "unverified"}`,
      { commitSha: freshness.actual, ...extras },
    );
  }

  _verifyBoundDiff(payload, phase) {
    const baseCommitSha = String(payload?.baseCommitSha || "").trim();
    const commitSha = String(payload?.commitSha || "").trim();
    const expectedDigest = String(payload?.diffDigest || "").trim();
    const expectedFiles = payload?.changedFiles;
    if (
      !EXACT_COMMIT_RE.test(baseCommitSha) ||
      !EXACT_COMMIT_RE.test(commitSha) ||
      !SHA256_RE.test(expectedDigest) ||
      !Array.isArray(expectedFiles)
    ) {
      return {
        ok: false,
        error: `${phase} requires an exact coordinator-owned diff binding`,
      };
    }
    try {
      const resolvedBase = this._git(
        ["rev-parse", "--verify", `${baseCommitSha}^{commit}`],
        `${phase}-base`,
      ).trim();
      if (resolvedBase !== baseCommitSha) {
        return {
          ok: false,
          error: `${phase} base commit did not resolve exactly`,
        };
      }
      const range = `${baseCommitSha}...${commitSha}`;
      const diff = this._git(["diff", "--binary", range], `${phase}-diff`);
      const changedFiles = statusPaths(
        this._git(
          ["diff", "--name-only", "-z", range],
          `${phase}-changed-files`,
        ),
      );
      const actualDigest = sha256(diff);
      if (
        actualDigest !== expectedDigest ||
        !sameStringArray(changedFiles, expectedFiles)
      ) {
        return {
          ok: false,
          error: `${phase} diff digest or changed-file set no longer matches the exact base/head range`,
          actualDigest,
          changedFiles,
        };
      }
      return {
        ok: true,
        baseCommitSha,
        commitSha,
        diff,
        diffDigest: actualDigest,
        changedFiles: normalizedPathSet(changedFiles),
      };
    } catch (error) {
      return { ok: false, error: boundedText(error.message) };
    }
  }

  _gateConfiguration(id) {
    const gates = Array.isArray(this.config.gates) ? this.config.gates : [];
    return gates.filter((gate) => String(gate?.id || "") === id);
  }

  async runGates(payload, context = {}) {
    const freshness = this._cleanFreshness(payload.commitSha);
    if (!freshness.ok) return this._freshnessFailure(freshness, "gates");
    const effectId = boundEffectId(context);
    const diffBinding = this._verifyBoundDiff(payload, "gates");
    if (!diffBinding.ok) {
      return definitiveFailure(diffBinding.error, {
        commitSha: payload.commitSha,
        actualDiffDigest: diffBinding.actualDigest || null,
        actualChangedFiles: diffBinding.changedFiles || [],
      });
    }

    const selected = uniqueStrings(payload.gateSelection?.selectedGateIds);
    const definitions = new Map(
      (Array.isArray(payload.requiredGates) ? payload.requiredGates : []).map(
        (gate) => [String(gate?.id || ""), gate],
      ),
    );
    if (selected.length === 0) {
      return definitiveFailure("selected gate set is empty", {
        commitSha: payload.commitSha,
      });
    }

    const plan = [];
    for (const gateId of selected) {
      const matches = this._gateConfiguration(gateId);
      const requiredMatrix = Array.isArray(definitions.get(gateId)?.matrix)
        ? definitions.get(gateId).matrix.map(String)
        : null;
      if (matches.length !== 1 || !requiredMatrix) {
        return definitiveFailure(
          `production gate configuration is missing or ambiguous: ${gateId}`,
          { commitSha: payload.commitSha },
        );
      }
      const executions = Array.isArray(matches[0].executions)
        ? matches[0].executions
        : [];
      const cells = [];
      for (const cellId of requiredMatrix) {
        const cellMatches = executions.filter(
          (item) => String(item?.id || "") === cellId,
        );
        const spec =
          cellMatches.length === 1 ? commandSpec(cellMatches[0]) : null;
        if (!spec) {
          return definitiveFailure(
            `production gate execution is missing or ambiguous: ${gateId}/${cellId}`,
            { commitSha: payload.commitSha },
          );
        }
        cells.push({ id: cellId, spec });
      }
      plan.push({ id: gateId, cells });
    }

    const results = [];
    const failures = [];
    const sideEffects = [];
    for (const gate of plan) {
      const cells = [];
      for (const cell of gate.cells) {
        const gateId = gate.id;
        const cellId = cell.id;
        const spec = cell.spec;
        const before = this._cleanFreshness(payload.commitSha);
        if (!before.ok) {
          return this._freshnessFailure(before, "gates", { sideEffects });
        }
        const processResult = this._process(spec.file, spec.args, {
          timeoutMs: spec.timeoutMs,
          origin: `delivery:gate:${gateId}:${cellId}`,
        });
        const after = this._cleanFreshness(payload.commitSha);
        const passed =
          !processResult?.error &&
          Number(processResult?.status) === 0 &&
          after.ok;
        const message = boundedText(
          processResult?.error?.message ||
            processResult?.stderr ||
            after.error ||
            processResult?.stdout,
        );
        cells.push({
          id: cellId,
          status: passed ? "passed" : "failed",
          commitSha: after.actual || payload.commitSha,
          ...(message ? { message } : {}),
        });
        if (!passed) {
          failures.push({
            id: `${gateId}:${cellId}`,
            gateId,
            test: cellId,
            message: message || "gate process failed or changed HEAD",
          });
        }
        sideEffects.push(
          (passed ? committedEffect : failedEffect)(
            `${effectId}:gate:${gateId}:${cellId}`,
            "gate-process",
            { gateId, cellId, exitCode: processResult?.status ?? null },
          ),
        );
      }
      results.push({
        id: gate.id,
        status: cells.every((cell) => cell.status === "passed")
          ? "passed"
          : "failed",
        commitSha: payload.commitSha,
        matrix: cells,
      });
    }
    const after = this._cleanFreshness(payload.commitSha);
    if (!after.ok) {
      return this._freshnessFailure(after, "gates", { sideEffects });
    }
    return {
      commitSha: after.actual,
      results,
      failures,
      sideEffects,
    };
  }

  async runPreview(payload, context = {}) {
    const freshness = this._cleanFreshness(payload.commitSha);
    if (!freshness.ok) return this._freshnessFailure(freshness, "preview");
    const preview = this.config.preview;
    if (!preview || typeof preview !== "object") {
      return definitiveFailure("production preview configuration is missing", {
        commitSha: payload.commitSha,
      });
    }
    const effectId = boundEffectId(context);
    const captureScreenshot = preview.screenshot !== false;
    const requestedName = path.basename(
      String(preview.screenshotPath || "preview.png"),
    );
    const screenshotName = path.extname(requestedName)
      ? requestedName
      : `${requestedName}.png`;
    // Browser output never lands in the git worktree. Its bytes are published
    // below and the evidence keeps the content digest, not a mutable local path.
    const screenshotPath = captureScreenshot
      ? path.join(
          path.resolve(this._tmpdir()),
          `cc-delivery-${effectId.slice("sha256:".length, 18)}-${screenshotName}`,
        )
      : null;
    const captured = await this._capturePreview({
      port: preview.port,
      tab: preview.tab,
      watchMs: preview.watchMs,
      domCap: preview.domCap,
      includeDom: preview.includeDom !== false,
      screenshotPath,
      reload: preview.reload === true,
    });
    const captureEffect =
      captured?.ok === true
        ? committedEffect(`${effectId}:capture`, "preview-capture", {
            reloaded: preview.reload === true,
            screenshotRef:
              captured.screenshotRef ||
              (captured.screenshotPath
                ? path.basename(captured.screenshotPath)
                : null),
          })
        : unknownEffect(`${effectId}:capture`, "preview-capture");
    const sideEffects = [captureEffect];
    let screenshotArtifact = null;
    if (captured?.ok === true && screenshotPath && !captured.screenshotError) {
      const returnedPath = captured.screenshotPath
        ? path.resolve(String(captured.screenshotPath))
        : null;
      if (returnedPath !== path.resolve(screenshotPath)) {
        return definitiveFailure(
          "preview did not return the exact out-of-worktree screenshot path",
          { commitSha: payload.commitSha, sideEffects },
        );
      }
      const entry = this._artifactStore.publishData({
        data: this._readFileSync(returnedPath),
        fileName: screenshotName,
        title: captured.title || "Delivery preview screenshot",
        kind: "screenshot",
        mime: "image/png",
        immutable: true,
      });
      const integrity = this._artifactStore.verifyIntegrity(entry);
      if (integrity.ok !== true) {
        throw new Error(
          "published preview screenshot failed integrity readback",
        );
      }
      screenshotArtifact = publicArtifactMetadata(entry);
      sideEffects.push(
        committedEffect(`${effectId}:screenshot`, "immutable-artifact", {
          artifactId: entry.id,
          sha256: entry.sha256,
        }),
      );
    }
    const after = this._cleanFreshness(payload.commitSha);
    if (!after.ok) {
      return definitiveFailure(
        after.error || "preview exact-head freshness was lost",
        { commitSha: after.actual, sideEffects },
      );
    }
    if (captured?.ok !== true) {
      return definitiveFailure(captured?.error || "preview capture failed", {
        commitSha: payload.commitSha,
        sideEffects,
      });
    }
    const consoleFailures = (captured.console || []).filter((entry) =>
      ["error", "assert"].includes(String(entry?.type || "").toLowerCase()),
    );
    const networkFailures = Array.isArray(captured.network)
      ? captured.network
      : [];
    const failures = [
      ...consoleFailures.map((entry, index) => ({
        id: `preview-console-${index + 1}`,
        message: entry.text || "browser console error",
      })),
      ...networkFailures.map((entry, index) => ({
        id: `preview-network-${index + 1}`,
        message:
          entry.error ||
          `${entry.kind || "network"} ${entry.status || "failure"}: ${entry.url || "unknown URL"}`,
      })),
    ];
    if (captured.screenshotError) {
      failures.push({
        id: "preview-screenshot",
        message: captured.screenshotError,
      });
    }
    if (screenshotPath && !screenshotArtifact && !captured.screenshotError) {
      failures.push({
        id: "preview-screenshot",
        message: "preview screenshot bytes were not published",
      });
    }
    const artifacts = [
      {
        kind: "dom-summary",
        data: {
          tier: "dom-assert",
          label: captured.title || "Preview DOM",
          summary: JSON.stringify({
            url: captured.url,
            title: captured.title,
            html: captured.html,
            htmlTruncated: captured.htmlTruncated === true,
            console: captured.console || [],
            network: captured.network || [],
          }),
        },
      },
      {
        kind: "test-result",
        data: {
          tier: "dom-assert",
          label: "Preview console/network assertions",
          passed: failures.length === 0,
          total: consoleFailures.length + networkFailures.length,
          failed: failures.length,
          output: failures.map((item) => item.message).join("\n") || "clean",
        },
      },
    ];
    if (screenshotArtifact) {
      artifacts.push({
        kind: "screenshot",
        data: {
          tier: "visual-screenshot",
          label: captured.title || "Preview screenshot",
          ref: screenshotArtifact.id,
          digest: `sha256:${screenshotArtifact.sha256}`,
        },
      });
    }
    return {
      commitSha: payload.commitSha,
      passed: failures.length === 0,
      failures,
      artifacts,
      sideEffects,
    };
  }

  async runReview(payload, context = {}) {
    const freshness = this._cleanFreshness(payload.commitSha);
    if (!freshness.ok) return this._freshnessFailure(freshness, "review");
    const effectId = boundEffectId(context);
    const diffBinding = this._verifyBoundDiff(payload, "review");
    if (!diffBinding.ok) {
      return definitiveFailure(diffBinding.error, {
        commitSha: payload.commitSha,
      });
    }
    const review = this.config.review || {};
    const result = await this._runReview({
      cwd: this.cwd,
      base: payload.baseCommitSha,
      effort: review.effort || "high",
      multi: true,
      verify: review.verify !== false,
      outputFormat: "json",
      maxTurns: review.maxTurns,
      model: review.model,
      provider: review.provider,
    });
    const reviewEffect = committedEffect(
      `${effectId}:review`,
      "structured-review",
    );
    const after = this._cleanFreshness(payload.commitSha);
    if (!after.ok) {
      return this._freshnessFailure(after, "review", {
        sideEffects: [reviewEffect],
      });
    }
    if (
      result?.isError !== false ||
      !result?.report ||
      !Array.isArray(result.report.findings)
    ) {
      return definitiveFailure("structured production review failed", {
        commitSha: payload.commitSha,
        sideEffects: [failedEffect(`${effectId}:review`, "structured-review")],
      });
    }
    return {
      commitSha: payload.commitSha,
      rawFindings: result.report.findings.map(findingFromReport),
      sideEffects: [reviewEffect],
    };
  }

  async applyFix(payload, context = {}) {
    const freshness = this._cleanFreshness(payload.commitSha);
    if (!freshness.ok) return this._freshnessFailure(freshness, "fix");
    const effectId = boundEffectId(context);
    const fix = this.config.fix;
    const allowedPaths = uniqueStrings(fix?.allowedPaths).map(
      normalizedRepoPath,
    );
    const baseCommitSha = String(fix?.baseCommitSha || "").trim();
    if (
      !fix ||
      allowedPaths.length === 0 ||
      !EXACT_COMMIT_RE.test(baseCommitSha)
    ) {
      return definitiveFailure(
        "fix requires explicit allowedPaths and an exact baseCommitSha",
        { commitSha: payload.commitSha },
      );
    }
    if (baseCommitSha !== String(payload.baseCommitSha || "")) {
      return definitiveFailure(
        "fix config baseCommitSha does not match the coordinator diff base",
        {
          commitSha: payload.commitSha,
        },
      );
    }
    const diffBinding = this._verifyBoundDiff(payload, "fix");
    if (!diffBinding.ok) {
      return definitiveFailure(diffBinding.error, {
        commitSha: payload.commitSha,
        actualDiffDigest: diffBinding.actualDigest || null,
        actualChangedFiles: diffBinding.changedFiles || [],
      });
    }
    const beforeIdentity = this._worktreeIdentity();
    if (!beforeIdentity.branch) {
      return definitiveFailure("fix requires an attached worktree branch", {
        commitSha: payload.commitSha,
      });
    }
    const allowedScope = this._verifyAllowedPathScope(
      allowedPaths,
      beforeIdentity.root,
    );
    if (!allowedScope.ok) {
      return definitiveFailure(allowedScope.error, {
        commitSha: payload.commitSha,
      });
    }
    const exactAllowedPaths = Object.freeze([...allowedPaths]);
    const fileMutationScope = Object.freeze({
      exact: true,
      worktreeRoot: allowedScope.worktreeRoot,
      allowedPaths: exactAllowedPaths,
    });
    const outcome = await this._runFix({
      cwd: allowedScope.worktreeRoot,
      base: baseCommitSha,
      effort: fix.effort || "high",
      fix: true,
      single: true,
      checkpoint: true,
      paths: exactAllowedPaths,
      allowedPaths: exactAllowedPaths,
      allowedTools: DELIVERY_FIXER_ALLOWED_TOOLS,
      exactToolNames: true,
      fileMutationScope,
      hermeticExecution: true,
      // The fixer has no MCP tools in its exact capability set. Suppress
      // registered/plugin/IDE discovery as defense in depth; headless also
      // skips MCP startup entirely for this exact built-in-only ceiling.
      useRegisteredMcp: false,
      strictMcpConfig: true,
      ide: false,
      pdh: false,
      jetbrains: false,
      failureContext: jsonClone(payload.failures || []),
      reviewContext: jsonClone(payload.review || null),
      maxTurns: fix.maxTurns,
      model: fix.model,
      provider: fix.provider,
    });
    if (
      outcome?.isError !== false ||
      (Number.isFinite(Number(outcome?.exitCode)) &&
        Number(outcome.exitCode) !== 0)
    ) {
      throw new Error(
        "review fixer failed after it may have changed the worktree",
      );
    }
    if (!this._sameWorktreeIdentity(beforeIdentity).ok) {
      throw new Error(
        "fixer changed worktree, branch, or HEAD identity outside the delivery commit transaction",
      );
    }
    const afterAllowedScope = this._verifyAllowedPathScope(
      allowedPaths,
      beforeIdentity.root,
    );
    if (!afterAllowedScope.ok) {
      throw new Error(
        `fixer violated the physical allowed-path boundary: ${afterAllowedScope.error}`,
      );
    }
    const fixerEffect = committedEffect(`${effectId}:fixer`, "review-fixer");
    const unstaged = statusPaths(
      this._git(["diff", "--name-only", "-z"], "changed-files"),
    );
    const staged = statusPaths(
      this._git(
        ["diff", "--cached", "--name-only", "-z"],
        "staged-changed-files",
      ),
    );
    const untracked = statusPaths(
      this._git(
        ["ls-files", "--others", "--exclude-standard", "-z"],
        "untracked-files",
      ),
    );
    const changed = uniqueStrings([...unstaged, ...staged, ...untracked]);
    if (changed.length === 0) {
      const unchanged = this._cleanFreshness(payload.commitSha);
      if (!unchanged.ok) {
        throw new Error(
          unchanged.error ||
            "fixer changed worktree identity without an allowed edit",
        );
      }
      return {
        changed: false,
        commitSha: payload.commitSha,
        diffDigest: payload.diffDigest,
        changedFiles: [],
        sideEffects: [fixerEffect],
      };
    }
    const outside = changed.filter(
      (item) => !allowedPaths.includes(normalizedRepoPath(item)),
    );
    if (outside.length > 0) {
      throw new Error(
        `fix changed paths outside its explicit allowlist: ${outside.join(", ")}`,
      );
    }
    if (!this._sameWorktreeIdentity(beforeIdentity).ok) {
      throw new Error(
        "worktree identity changed before the fix could be staged",
      );
    }
    this._mutate("git", ["add", "--", ...changed], "git-stage-fix");
    if (!this._sameWorktreeIdentity(beforeIdentity).ok) {
      throw new Error(
        "worktree identity changed while the allowed fix was staged",
      );
    }
    this._mutate(
      "git",
      [
        "commit",
        "-m",
        String(fix.commitMessage || "fix(delivery): apply reviewed fixes"),
      ],
      "git-commit-fix",
    );
    const nextCommit = this._head();
    if (!EXACT_COMMIT_RE.test(nextCommit) || nextCommit === payload.commitSha) {
      throw new Error("fix commit did not produce a new exact HEAD");
    }
    const parentCommit = this._git(
      ["rev-parse", "--verify", `${nextCommit}^`],
      "fix-parent",
    ).trim();
    if (parentCommit !== payload.commitSha) {
      throw new Error(
        "fix commit parent is not the exact pre-fix delivery head",
      );
    }
    const committedFixFiles = statusPaths(
      this._git(
        ["diff", "--name-only", "-z", `${payload.commitSha}...${nextCommit}`],
        "fix-commit-changed-files",
      ),
    );
    const committedOutside = committedFixFiles.filter(
      (item) => !allowedPaths.includes(normalizedRepoPath(item)),
    );
    if (committedFixFiles.length === 0 || committedOutside.length > 0) {
      throw new Error(
        committedOutside.length > 0
          ? `fix commit contains paths outside its explicit allowlist: ${committedOutside.join(", ")}`
          : "fix commit does not contain an attributable allowed-path change",
      );
    }
    if (this._git(["status", "--porcelain"], "post-fix-status").trim()) {
      throw new Error("fix commit left uncommitted worktree changes");
    }
    const diff = this._git(
      ["diff", "--binary", `${baseCommitSha}...${nextCommit}`],
      "fixed-diff",
    );
    const changedFiles = statusPaths(
      this._git(
        ["diff", "--name-only", "-z", `${baseCommitSha}...${nextCommit}`],
        "fixed-changed-files",
      ),
    );
    const sideEffects = [
      fixerEffect,
      committedEffect(`${effectId}:commit`, "git-commit", {
        commitSha: nextCommit,
      }),
    ];
    if (context.state?.pr?.number) {
      const branch = this._git(["branch", "--show-current"], "branch").trim();
      if (!branch) throw new Error("cannot push a fix from detached HEAD");
      const remote = this._verifiedPushRemote();
      this._mutate(
        "git",
        ["push", remote, `${nextCommit}:refs/heads/${branch}`],
        "git-push-fix",
      );
      const pr = this._readPr(context.state.pr.number);
      if (
        String(pr.state || "").toUpperCase() !== "OPEN" ||
        String(pr.headRefOid || "") !== nextCommit
      ) {
        throw new Error("pushed fix did not become the PR's exact remote head");
      }
      sideEffects.push(
        committedEffect(`${effectId}:push`, "git-push", {
          commitSha: nextCommit,
          prNumber: context.state.pr.number,
        }),
      );
    }
    return {
      changed: true,
      commitSha: nextCommit,
      diffDigest: sha256(diff),
      changedFiles,
      progressDigest: sha256(`${nextCommit}\0${diff}`),
      sideEffects,
    };
  }

  _readPr(target) {
    return parseJson(
      this._gh(
        [
          "pr",
          "view",
          String(target),
          "--json",
          "number,state,isDraft,baseRefName,headRefName,headRefOid,url,reviewDecision,reviewRequests,mergeStateStatus,statusCheckRollup,mergeCommit",
        ],
        "pr-view",
      ),
      "gh pr view",
    );
  }

  _readBranchProtection(baseRefName) {
    const repo = String(this.config.github?.repo || "").trim();
    const branch = String(baseRefName || "").trim();
    if (!repo || !branch) {
      throw new Error(
        "branch protection lookup requires an exact repository and base branch",
      );
    }
    const protection = parseJson(
      this._read(
        "gh",
        [
          "api",
          `repos/${repo}/branches/${encodeURIComponent(branch)}/protection`,
        ],
        "gh-branch-protection",
      ),
      "GitHub branch protection",
    );
    const statusRule = protection?.required_status_checks;
    const protectedChecks = uniqueStrings([
      ...(Array.isArray(statusRule?.contexts) ? statusRule.contexts : []),
      ...(Array.isArray(statusRule?.checks)
        ? statusRule.checks.map((item) => item?.context)
        : []),
    ]);
    const requiredChecks = uniqueStrings(this.config.ci?.requiredChecks);
    return {
      protected: protection && typeof protection === "object",
      requiredChecksProtected: requiredChecks.every((name) =>
        protectedChecks.includes(name),
      ),
      reviewRequired:
        protection?.required_pull_request_reviews != null &&
        typeof protection.required_pull_request_reviews === "object",
      enforcedForAdmins: protection?.enforce_admins?.enabled === true,
      protectedChecks,
    };
  }

  _ciSnapshot(pr, commitSha, protection) {
    const requiredChecks = uniqueStrings(this.config.ci?.requiredChecks);
    const rollup = Array.isArray(pr?.statusCheckRollup)
      ? pr.statusCheckRollup
      : [];
    const checks = rollup.map((check) => ({
      name: String(check.name || check.context || ""),
      state: checkState(check.conclusion || check.state || check.status),
      commitSha,
      url: check.detailsUrl || check.targetUrl || null,
    }));
    const requiredMatrixComplete = requiredChecks.every(
      (name) => checks.filter((check) => check.name === name).length === 1,
    );
    const requiredChecksSuccessful =
      requiredMatrixComplete &&
      requiredChecks.every(
        (name) =>
          checks.filter(
            (check) => check.name === name && check.state === "success",
          ).length === 1,
      );
    const reviewApproved =
      String(pr?.reviewDecision || "").toUpperCase() === "APPROVED";
    const pendingApprovals = Array.isArray(pr?.reviewRequests)
      ? pr.reviewRequests.length
      : null;
    const branchProtectionSatisfied =
      protection?.protected === true &&
      protection.requiredChecksProtected === true &&
      protection.reviewRequired === true &&
      protection.enforcedForAdmins === true &&
      String(pr?.mergeStateStatus || "").toUpperCase() === "CLEAN";
    return {
      requiredChecks,
      checks,
      requiredMatrixComplete,
      requiredChecksSuccessful,
      reviewApproved,
      pendingApprovals,
      branchProtectionSatisfied,
      protectedChecks: protection?.protectedChecks || [],
    };
  }

  _verifyPublishedEvidence(evidence, commitSha, diffDigest) {
    const recordDigest = String(evidence?.recordDigest || "");
    const supplied = evidence?.artifact;
    if (
      !SHA256_RE.test(recordDigest) ||
      !supplied?.id ||
      supplied.immutable !== true ||
      supplied.recordDigest !== recordDigest ||
      typeof this._artifactStore.get !== "function" ||
      typeof this._artifactStore.storedPath !== "function"
    ) {
      return { ok: false, error: "published evidence binding is incomplete" };
    }
    const canonical = this._artifactStore.get(supplied.id);
    if (
      !canonical ||
      canonical.id !== supplied.id ||
      canonical.file !== supplied.file ||
      canonical.sha256 !== supplied.sha256 ||
      canonical.immutable !== true ||
      canonical.recordDigest !== recordDigest
    ) {
      return {
        ok: false,
        error:
          "published evidence metadata no longer matches the artifact store",
      };
    }
    const integrity = this._artifactStore.verifyIntegrity(canonical);
    if (integrity?.ok !== true) {
      return {
        ok: false,
        error: `published evidence integrity failed: ${integrity?.reason || "unknown"}`,
      };
    }
    try {
      const body = this._readFileSync(
        this._artifactStore.storedPath(canonical),
      );
      const actualSha256 = crypto
        .createHash("sha256")
        .update(body)
        .digest("hex");
      if (actualSha256 !== canonical.sha256) {
        return {
          ok: false,
          error: "published evidence bytes changed during merge verification",
        };
      }
      const record = parseJson(body, "published evidence artifact");
      const verification = verifyDeliveryEvidenceRecord(record);
      if (
        !verification.valid ||
        record.recordDigest !== recordDigest ||
        String(record.commit?.sha || "") !== commitSha ||
        String(record.diff?.digest || "") !== diffDigest
      ) {
        return {
          ok: false,
          error:
            "published evidence record digest or exact commit/diff binding is invalid",
        };
      }
      return { ok: true, integrity };
    } catch (error) {
      return { ok: false, error: boundedText(error.message) };
    }
  }

  async createPr(payload, context = {}) {
    const freshness = this._cleanFreshness(payload.commitSha);
    if (!freshness.ok) return this._freshnessFailure(freshness, "PR creation");
    const effectId = boundEffectId(context);
    const prConfig = this.config.pullRequest;
    if (!prConfig?.base || !prConfig?.title) {
      return definitiveFailure("PR creation requires explicit base and title", {
        commitSha: payload.commitSha,
      });
    }
    const branch = this._git(["branch", "--show-current"], "branch").trim();
    if (!branch || branch === prConfig.base) {
      return definitiveFailure("PR creation requires a non-base branch", {
        commitSha: payload.commitSha,
      });
    }
    const existing = parseJson(
      this._gh(
        [
          "pr",
          "list",
          "--head",
          branch,
          "--state",
          "open",
          "--json",
          "number,headRefOid,url",
        ],
        "pr-list",
      ),
      "gh pr list",
    );
    if (!Array.isArray(existing) || existing.length > 1) {
      return definitiveFailure("open PR lookup is ambiguous", {
        commitSha: payload.commitSha,
      });
    }
    const remote = this._verifiedPushRemote();
    this._mutate(
      "git",
      ["push", remote, `${payload.commitSha}:refs/heads/${branch}`],
      "git-push-pr",
    );
    const sideEffects = [
      committedEffect(`${effectId}:push`, "git-push", {
        commitSha: payload.commitSha,
        branch,
      }),
    ];
    let pr;
    if (existing.length === 1) {
      pr = this._readPr(existing[0].number);
      sideEffects.push(
        noEffect(`${effectId}:pr`, "github-pr-existing", {
          prNumber: existing[0].number,
        }),
      );
    } else {
      const marker = `<!-- chainlesschain-delivery-effect:${effectId} -->`;
      const body = `${String(prConfig.body || "").trim()}\n\n${marker}`.trim();
      this._ghMutate(
        [
          "pr",
          "create",
          "--base",
          String(prConfig.base),
          "--head",
          branch,
          "--title",
          String(prConfig.title),
          "--body",
          body,
          ...(prConfig.draft === true ? ["--draft"] : []),
        ],
        "pr-create",
      );
      pr = this._readPr(branch);
      sideEffects.push(
        committedEffect(`${effectId}:pr`, "github-pr-create", {
          prNumber: pr.number,
        }),
      );
    }
    const after = this._freshness(payload.commitSha);
    if (
      !after.ok ||
      String(pr.state || "").toUpperCase() !== "OPEN" ||
      String(pr.headRefOid || "") !== payload.commitSha ||
      String(pr.baseRefName || "") !== String(prConfig.base) ||
      !Number.isInteger(Number(pr.number))
    ) {
      throw new Error(
        "created/reused PR is not open at the exact delivery head",
      );
    }
    return {
      number: Number(pr.number),
      hasOpenPr: true,
      headCommitSha: payload.commitSha,
      url: pr.url,
      headRefName: pr.headRefName || branch,
      sideEffects,
    };
  }

  async refreshCi(payload, context = {}) {
    const freshness = this._cleanFreshness(payload.commitSha);
    if (!freshness.ok) return this._freshnessFailure(freshness, "CI refresh");
    boundEffectId(context);
    const number = Number(context.state?.pr?.number);
    const requiredChecks = uniqueStrings(this.config.ci?.requiredChecks);
    if (
      !Number.isInteger(number) ||
      number <= 0 ||
      requiredChecks.length === 0
    ) {
      return definitiveFailure(
        "CI refresh requires an exact PR number and authoritative requiredChecks",
        { commitSha: payload.commitSha },
      );
    }
    const pr = this._readPr(number);
    const after = this._cleanFreshness(payload.commitSha);
    if (!after.ok) return this._freshnessFailure(after, "CI refresh");
    const headCommitSha = String(pr.headRefOid || "");
    if (
      String(pr.state || "").toUpperCase() !== "OPEN" ||
      headCommitSha !== payload.commitSha ||
      String(pr.baseRefName || "") !== String(this.config.pullRequest?.base)
    ) {
      return definitiveFailure("CI is not bound to the open exact-head PR", {
        commitSha: payload.commitSha,
      });
    }
    let protection;
    try {
      protection = this._readBranchProtection(pr.baseRefName);
    } catch (error) {
      return definitiveFailure(
        `branch protection could not be verified: ${boundedText(error.message)}`,
        { commitSha: payload.commitSha },
      );
    }
    const snapshot = this._ciSnapshot(pr, headCommitSha, protection);
    return {
      hasOpenPr: String(pr.state || "").toUpperCase() === "OPEN",
      headCommitSha,
      ciCommitSha: headCommitSha,
      ...snapshot,
      sideEffects: [],
    };
  }

  async publishEvidence(payload, context = {}) {
    const freshness = this._cleanFreshness(payload.commitSha);
    if (!freshness.ok) {
      return this._freshnessFailure(freshness, "evidence publication");
    }
    const effectId = boundEffectId(context);
    const diffBinding = this._verifyBoundDiff(payload, "evidence");
    if (!diffBinding.ok) {
      return definitiveFailure(diffBinding.error, {
        commitSha: payload.commitSha,
        actualDiffDigest: diffBinding.actualDigest || null,
        actualChangedFiles: diffBinding.changedFiles || [],
      });
    }
    if (
      !payload.record ||
      !SHA256_RE.test(String(payload.record.recordDigest || "")) ||
      String(payload.record.commit?.sha || "") !== payload.commitSha
    ) {
      return definitiveFailure(
        "evidence record is not bound to the exact head",
        {
          commitSha: payload.commitSha,
        },
      );
    }
    const verification = verifyDeliveryEvidenceRecord(payload.record);
    const readiness = assessDeliveryEvidence(payload.record);
    const containsRawSecret = containsSecret(
      canonicalDeliveryJson(payload.record),
    );
    const readinessMatches =
      canonicalDeliveryJson(readiness) ===
      canonicalDeliveryJson(payload.readiness || null);
    if (!verification.valid || containsRawSecret || !readinessMatches) {
      const reason = !verification.valid
        ? verification.reason
        : containsRawSecret
          ? "record-secret-detected"
          : "readiness-mismatch";
      return definitiveFailure(
        `evidence record failed authoritative verification: ${reason}`,
        { commitSha: payload.commitSha },
      );
    }
    const suffix = payload.record.recordDigest.slice("sha256:".length, 16);
    const entry = this._artifactStore.publishData({
      data: `${JSON.stringify(payload.record, null, 2)}\n`,
      fileName: `delivery-evidence-v1-${suffix}.json`,
      title: `Delivery evidence ${suffix}`,
      kind: "data",
      mime: "application/json",
      immutable: true,
      recordDigest: payload.record.recordDigest,
    });
    const integrity = this._artifactStore.verifyIntegrity(entry);
    if (integrity.ok !== true) {
      throw new Error("published evidence failed immediate integrity readback");
    }
    const after = this._cleanFreshness(payload.commitSha);
    if (!after.ok) {
      throw new Error("HEAD changed while immutable evidence was published");
    }
    return {
      artifact: publicArtifactMetadata(entry),
      artifactIntegrity: integrity,
      sideEffects: [
        committedEffect(`${effectId}:artifact`, "immutable-artifact", {
          artifactId: entry.id,
          recordDigest: payload.record.recordDigest,
        }),
      ],
    };
  }

  async merge(payload, context = {}) {
    const freshness = this._cleanFreshness(payload.commitSha);
    if (!freshness.ok) return this._freshnessFailure(freshness, "merge");
    const effectId = boundEffectId(context);
    const merge = this.config.merge;
    const method = String(merge?.method || "squash").toLowerCase();
    const number = Number(payload.pr?.number);
    if (
      merge?.enabled !== true ||
      !MERGE_METHODS.has(method) ||
      context.state?.pr?.mergeAllowed !== true ||
      Number(context.state?.pr?.number) !== number ||
      String(payload.pr?.headCommitSha || "") !== payload.commitSha ||
      String(payload.pr?.ciCommitSha || "") !== payload.commitSha ||
      !Number.isInteger(number) ||
      number <= 0
    ) {
      return definitiveFailure(
        "merge is not explicitly enabled, authorized, and bound to a PR",
        { commitSha: payload.commitSha },
      );
    }
    const diffBinding = this._verifyBoundDiff(payload, "merge");
    if (!diffBinding.ok) {
      return definitiveFailure(diffBinding.error, {
        commitSha: payload.commitSha,
      });
    }
    const before = this._readPr(number);
    if (
      String(before.state || "").toUpperCase() !== "OPEN" ||
      before.isDraft === true ||
      String(before.headRefOid || "") !== payload.commitSha ||
      String(before.baseRefName || "") !== String(this.config.pullRequest?.base)
    ) {
      return definitiveFailure("PR is no longer mergeable at the exact head", {
        commitSha: payload.commitSha,
      });
    }
    let protection;
    try {
      protection = this._readBranchProtection(before.baseRefName);
    } catch (error) {
      return definitiveFailure(
        `branch protection could not be re-verified before merge: ${boundedText(error.message)}`,
        { commitSha: payload.commitSha },
      );
    }
    const ci = this._ciSnapshot(before, payload.commitSha, protection);
    if (
      ci.requiredMatrixComplete !== true ||
      ci.requiredChecksSuccessful !== true ||
      ci.reviewApproved !== true ||
      ci.pendingApprovals !== 0 ||
      ci.branchProtectionSatisfied !== true
    ) {
      return definitiveFailure(
        "PR checks, review approval, or branch protection changed before merge",
        { commitSha: payload.commitSha },
      );
    }
    const evidence = this._verifyPublishedEvidence(
      payload.evidence,
      payload.commitSha,
      payload.diffDigest,
    );
    if (!evidence.ok) {
      return definitiveFailure(
        `published evidence could not be re-verified before merge: ${evidence.error}`,
        { commitSha: payload.commitSha },
      );
    }
    const beforeMutation = this._cleanFreshness(payload.commitSha);
    if (!beforeMutation.ok) {
      return this._freshnessFailure(beforeMutation, "merge");
    }
    this._ghMutate(
      [
        "pr",
        "merge",
        String(number),
        `--${method}`,
        "--match-head-commit",
        payload.commitSha,
      ],
      "pr-merge",
    );
    const after = this._readPr(number);
    const localAfter = this._cleanFreshness(payload.commitSha);
    const mergeCommitSha = String(
      after.mergeCommit?.oid || after.mergeCommit || "",
    );
    if (
      !localAfter.ok ||
      String(after.state || "").toUpperCase() !== "MERGED" ||
      String(after.headRefOid || "") !== payload.commitSha ||
      !EXACT_COMMIT_RE.test(mergeCommitSha)
    ) {
      throw new Error("merge provider did not prove a merged exact-head PR");
    }
    return {
      merged: true,
      headCommitSha: payload.commitSha,
      mergeCommitSha,
      method,
      sideEffects: [
        committedEffect(`${effectId}:merge`, "github-pr-merge", {
          prNumber: number,
          headCommitSha: payload.commitSha,
          mergeCommitSha,
        }),
      ],
    };
  }

  async archive(payload, context = {}) {
    const freshness = this._freshness(payload.commitSha);
    if (!freshness.ok) return this._freshnessFailure(freshness, "archive");
    const effectId = boundEffectId(context);
    // Production archive is intentionally non-destructive. The coordinator's
    // final snapshot is the archive record; retaining the worktree proves that
    // uncommitted or unpushed user work cannot be deleted by this action.
    const status = this._git(["status", "--porcelain"], "archive-status");
    const after = this._freshness(payload.commitSha);
    if (!after.ok) return this._freshnessFailure(after, "archive");
    const uncommitted = status
      .split(/\r?\n/u)
      .filter(Boolean)
      .filter((line) => !line.startsWith("??")).length;
    const untracked = status
      .split(/\r?\n/u)
      .filter((line) => line.startsWith("??")).length;
    return {
      archived: true,
      preservedUncommitted: true,
      preservedUnpushed: true,
      workspaceDisposition: "retained",
      observedUncommittedEntries: uncommitted,
      observedUntrackedEntries: untracked,
      sideEffects: [noEffect(`${effectId}:archive`, "worktree-retained")],
    };
  }
}

export function createGitHubDeliveryProductionAdapter(options = {}, deps = {}) {
  return new GitHubDeliveryProductionAdapter(options, deps);
}
