import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { getHomeDir } from "../lib/paths.js";
import { ensurePrivateDirectory } from "../lib/secure-fs.js";
import { redactSecrets } from "../lib/secret-scan.js";
import {
  TEAM_MERGE_REVIEW_SCHEMA,
  TEAM_MERGE_REVIEW_SCHEMA_VERSION,
  buildMergeReview,
  canonicalizeMergeReviewConflicts,
  canonicalMergeReviewJson,
  computeMergeReviewConflictsDigest,
  digestMergeReview,
  validateMergeReview,
} from "../lib/agent-team/team-merge-review.js";
import { TeamMergeReviewStore } from "../lib/agent-team/team-merge-review-store.js";
import {
  bindMergeReviewInspection,
  inspectMergeReviewRepository,
  mergeReviewInputFromInspection,
  prepareMergeReviewTransaction,
  publishPreparedMergeReview,
  readMergeReviewBaseState,
  resolveMergeReviewRepositoryRoot,
  rollbackPublishedMergeReview,
} from "../lib/agent-team/team-merge-review-transaction.js";

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const REVIEW_ID_PATTERN = /^tmr_[a-f0-9]{32}$/u;

export const _deps = {
  buildMergeReview,
  bindMergeReviewInspection,
  inspectMergeReviewRepository,
  mergeReviewInputFromInspection,
  prepareMergeReviewTransaction,
  publishPreparedMergeReview,
  readMergeReviewBaseState,
  resolveMergeReviewRepositoryRoot,
  rollbackPublishedMergeReview,
  createStore: (filePath) => new TeamMergeReviewStore({ filePath }),
  ensurePrivateDirectory,
  getHomeDir,
};

export class TeamMergeReviewCliError extends Error {
  constructor(code, message, details = null, cause = null) {
    super(message, cause ? { cause } : undefined);
    this.name = "TeamMergeReviewCliError";
    this.code = code;
    if (details != null) this.details = details;
  }
}

function fail(code, message, details = null, cause = null) {
  throw new TeamMergeReviewCliError(code, message, details, cause);
}

function collect(value, previous = []) {
  return [...previous, value];
}

function pathInside(child, root) {
  const relative = path.relative(root, child);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`))
  );
}

function normalizeForIdentity(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function repoStoreName(repoRoot) {
  return `reviews-${createHash("sha256")
    .update(normalizeForIdentity(repoRoot), "utf8")
    .digest("hex")
    .slice(0, 32)}.jsonl`;
}

export function resolveTeamMergeReviewState(
  { stateDir = null, repoDir = process.cwd() } = {},
  dependencies = _deps,
) {
  const repoRoot = dependencies.resolveMergeReviewRepositoryRoot(repoDir);
  const requested = path.resolve(
    stateDir || path.join(dependencies.getHomeDir(), "team-merge-reviews"),
  );
  if (pathInside(requested, repoRoot)) {
    fail(
      "TEAM_MERGE_REVIEW_STATE_UNSAFE",
      "merge-review state must be outside the agent-writable repository",
    );
  }
  dependencies.ensurePrivateDirectory(requested, {
    applyWindowsAcl: true,
    failIfUnavailable: true,
  });
  const canonicalStateDir = fs.realpathSync.native(requested);
  if (pathInside(canonicalStateDir, repoRoot)) {
    fail(
      "TEAM_MERGE_REVIEW_STATE_UNSAFE",
      "merge-review state resolves inside the agent-writable repository",
    );
  }
  const filePath = path.join(canonicalStateDir, repoStoreName(repoRoot));
  return {
    repoRoot,
    stateDir: canonicalStateDir,
    actionStateDir: stateDir == null ? null : String(stateDir),
    filePath,
    store: dependencies.createStore(filePath),
  };
}

function expectedRevision(value) {
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < 0) {
    fail(
      "TEAM_MERGE_REVIEW_INVALID_REVISION",
      "--revision must be a non-negative integer",
    );
  }
  return revision;
}

function expectedDigest(value, label) {
  const digest = String(value || "").toLowerCase();
  if (!DIGEST_PATTERN.test(digest)) {
    fail("TEAM_MERGE_REVIEW_INVALID_DIGEST", `${label} must be sha256:<hex>`);
  }
  return digest;
}

function reviewId(value) {
  const id = String(value || "").toLowerCase();
  if (!REVIEW_ID_PATTERN.test(id)) {
    fail("TEAM_MERGE_REVIEW_INVALID_ID", "merge-review ID is invalid");
  }
  return id;
}

function requireStoredReview(store, id) {
  const review = store.get(reviewId(id));
  if (!review) {
    fail("TEAM_MERGE_REVIEW_NOT_FOUND", `merge-review not found: ${id}`);
  }
  return validateMergeReview(review);
}

function assertRequestBinding(review, options) {
  const revision = expectedRevision(options.revision);
  const planDigest = expectedDigest(options.planDigest, "--plan-digest");
  if (review.revision + 1 !== revision) {
    fail(
      "TEAM_MERGE_REVIEW_STALE",
      `merge-review revision ${revision} is stale; current revision is ${review.revision + 1}`,
    );
  }
  if (review.planDigest !== planDigest) {
    fail(
      "TEAM_MERGE_REVIEW_PLAN_STALE",
      "--plan-digest does not bind the stored review",
    );
  }
}

function sameSelection(decision, fileIds, hunkIds) {
  if (!decision) return false;
  const sameSet = (left, right) => {
    const leftSet = new Set(left);
    const rightSet = new Set(right);
    return (
      left.length === right.length &&
      leftSet.size === left.length &&
      rightSet.size === right.length &&
      leftSet.size === rightSet.size &&
      [...leftSet].every((value) => rightSet.has(value))
    );
  };
  return (
    sameSet(decision.selectedFileIds, fileIds) &&
    sameSet(decision.selectedHunkIds, hunkIds)
  );
}

function decisionActor(value) {
  const actor = String(value || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(actor)) {
    fail(
      "TEAM_MERGE_REVIEW_INVALID_ACTOR",
      "merge-review actor must be a stable 1..160 character identifier",
    );
  }
  return actor;
}

function decisionReason(value) {
  const reason = String(value || "").trim();
  if (!reason || reason.length > 500 || /[\0\r\n]/u.test(reason)) {
    fail(
      "TEAM_MERGE_REVIEW_INVALID_REASON",
      "merge-review reason must be one line of at most 500 characters",
    );
  }
  return reason;
}

function transitionEvidence(review, operation, evidence = {}) {
  return digestMergeReview("cc-team-merge-review-transition-evidence-v1", {
    reviewId: review.reviewId,
    revision: review.revision,
    state: review.state,
    operation,
    evidence,
  });
}

function stateArgs(stateDir) {
  return stateDir == null ? ["--json"] : ["--state-dir", stateDir, "--json"];
}

function applyArgv(review, stateDir) {
  if (!review.decision) return [];
  const argv = [
    "team",
    "merge-review",
    "apply",
    review.reviewId,
    "--revision",
    String(review.revision + 1),
    "--plan-digest",
    review.planDigest,
  ];
  if (stateDir != null) argv.push("--state-dir", stateDir);
  for (const id of review.decision.selectedFileIds) {
    argv.push("--file-id", id);
  }
  for (const id of review.decision.selectedHunkIds) {
    argv.push("--hunk-id", id);
  }
  argv.push(
    "--actor",
    review.decision.actor,
    "--reason",
    review.decision.reason,
  );
  argv.push("--json");
  return argv;
}

function actionsFor(review, stateDir) {
  const actions = [
    {
      id: "show",
      enabled: true,
      argv: [
        "team",
        "merge-review",
        "show",
        review.reviewId,
        ...stateArgs(stateDir),
      ],
      reason: null,
    },
  ];
  const resumable = ["planned", "prepared", "publishing"].includes(
    review.state,
  );
  actions.push({
    id: "apply",
    enabled: resumable && review.decision != null,
    argv: resumable
      ? review.decision
        ? applyArgv(review, stateDir)
        : ["team", "merge-review", "apply", review.reviewId]
      : ["team", "merge-review", "apply", review.reviewId],
    reason:
      resumable && review.decision == null
        ? "Select at least one reviewed file or hunk first."
        : resumable
          ? null
          : `Review state ${review.state} cannot be applied.`,
  });
  const rollbackEnabled = [
    "published",
    "conflicted",
    "rollback_required",
  ].includes(review.state);
  actions.push({
    id: "rollback",
    enabled: rollbackEnabled,
    argv: rollbackEnabled
      ? [
          "team",
          "merge-review",
          "rollback",
          review.reviewId,
          "--revision",
          String(review.revision + 1),
          "--evidence-digest",
          review.evidenceDigest,
          "--confirm",
          review.reviewId,
          ...stateArgs(stateDir),
        ]
      : ["team", "merge-review", "rollback", review.reviewId],
    reason: rollbackEnabled
      ? null
      : `Review state ${review.state} has no controlled rollback action.`,
  });
  return actions;
}

function projectedConflict(conflict) {
  return {
    candidateKey: conflict.candidateKey,
    path: conflict.path,
    type: conflict.type,
    explanation: conflict.explanation,
    suggestion: conflict.suggestion ?? null,
    hunkIds: [...(conflict.hunkIds || [])],
  };
}

function projectedReview(review, conflicts = review.conflicts || []) {
  const selectedFileIds = review.decision?.selectedFileIds || [];
  const selectedHunkIds = review.decision?.selectedHunkIds || [];
  const selectedFiles = new Set(selectedFileIds);
  const selectedHunks = new Set(selectedHunkIds);
  return {
    reviewId: review.reviewId,
    revision: review.revision + 1,
    state: review.state,
    base: { branch: review.base.branch, oid: review.base.commitOid },
    candidates: review.candidates.map((candidate) => ({
      key: candidate.key,
      branch: candidate.branch,
      oid: candidate.commitOid,
    })),
    files: review.files.map((file) => ({
      id: file.id,
      candidateKey: file.candidateKey,
      path: file.path,
      status: file.status,
      binary: file.binary,
      selected: selectedFiles.has(file.id),
      hunks: file.hunks.map((hunk) => ({
        id: hunk.id,
        header:
          `@@ -${hunk.oldStart},${hunk.oldLines} ` +
          `+${hunk.newStart},${hunk.newLines} @@`,
        oldStart: hunk.oldStart,
        oldLines: hunk.oldLines,
        newStart: hunk.newStart,
        newLines: hunk.newLines,
        selected: selectedHunks.has(hunk.id),
      })),
    })),
    selection: {
      fileIds: [...selectedFileIds],
      hunkIds: [...selectedHunkIds],
    },
    conflicts: conflicts.map(projectedConflict),
    decision: review.decision
      ? {
          actor: review.decision.actor,
          reason: review.decision.reason,
          host: review.decision.host,
          decidedAt: review.decision.decidedAt,
        }
      : null,
    planDigest: review.planDigest,
    evidenceDigest: review.evidenceDigest,
    createdAt: review.createdAt,
    updatedAt: review.updatedAt,
    details: {},
  };
}

function envelope(operation, review, stateDir, extra = {}) {
  const conflicts = extra.conflicts ?? review.conflicts ?? [];
  return {
    schema: TEAM_MERGE_REVIEW_SCHEMA,
    schemaVersion: TEAM_MERGE_REVIEW_SCHEMA_VERSION,
    operation,
    review: projectedReview(validateMergeReview(review), conflicts),
    actions: actionsFor(review, stateDir),
  };
}

function inspectExactReview(review, repoRoot, dependencies) {
  const inspection = dependencies.inspectMergeReviewRepository({
    repoDir: repoRoot,
    baseBranch: review.base.branch,
    branches: review.candidates.map((candidate) => candidate.branch),
    keys: review.candidates.map((candidate) => candidate.key),
  });
  const rebuilt = dependencies.buildMergeReview({
    ...dependencies.mergeReviewInputFromInspection(inspection),
    createdAt: review.createdAt,
  });
  if (
    rebuilt.reviewId !== review.reviewId ||
    rebuilt.planDigest !== review.planDigest ||
    canonicalMergeReviewJson(rebuilt.files) !==
      canonicalMergeReviewJson(review.files)
  ) {
    fail(
      "TEAM_MERGE_REVIEW_PLAN_STALE",
      "candidate/base Git evidence changed after preview",
    );
  }
  return dependencies.bindMergeReviewInspection(inspection, review);
}

export function previewTeamMergeReview(
  {
    branches,
    base = null,
    stateDir = null,
    repoDir = process.cwd(),
    createdAt = null,
  } = {},
  dependencies = _deps,
) {
  const context = resolveTeamMergeReviewState(
    { stateDir, repoDir },
    dependencies,
  );
  const inspection = dependencies.inspectMergeReviewRepository({
    repoDir: context.repoRoot,
    baseBranch: base,
    branches,
  });
  const review = dependencies.buildMergeReview({
    ...dependencies.mergeReviewInputFromInspection(inspection),
    ...(createdAt ? { createdAt } : {}),
  });
  const persisted = context.store.create(review).review;
  return envelope("preview", persisted, context.actionStateDir);
}

export function showTeamMergeReview(
  { id, stateDir = null, repoDir = process.cwd() } = {},
  dependencies = _deps,
) {
  const context = resolveTeamMergeReviewState(
    { stateDir, repoDir },
    dependencies,
  );
  const review = requireStoredReview(context.store, id);
  return envelope("show", review, context.actionStateDir);
}

function transitionToRollbackRequired(store, review, reason) {
  if (review.state === "rollback_required") return review;
  const evidence = transitionEvidence(review, "rollback-required", { reason });
  return store.transition(review.reviewId, {
    expectedRevision: review.revision,
    to: "rollback_required",
    transitionEvidenceDigest: evidence,
  }).review;
}

function publishPreparedReview(context, review, dependencies) {
  if (review.state === "prepared") {
    review = context.store.transition(review.reviewId, {
      expectedRevision: review.revision,
      to: "publishing",
      transitionEvidenceDigest: transitionEvidence(review, "publishing", {
        preparedOid: review.settlement.preparedOid,
      }),
    }).review;
  }
  const preparedOid = review.settlement.preparedOid;
  const repository = dependencies.readMergeReviewBaseState({
    repoDir: context.repoRoot,
    branch: review.base.branch,
  });
  if (repository.currentBranch !== review.base.branch) {
    const current = transitionToRollbackRequired(
      context.store,
      review,
      "base branch checkout changed before publish",
    );
    const error = new TeamMergeReviewCliError(
      "TEAM_MERGE_REVIEW_PUBLISH_STALE",
      "checked-out branch changed before reviewed publish",
      { review: current },
    );
    throw error;
  }
  if (![review.base.commitOid, preparedOid].includes(repository.oid)) {
    const current = transitionToRollbackRequired(
      context.store,
      review,
      "base branch advanced outside reviewed transaction",
    );
    throw new TeamMergeReviewCliError(
      "TEAM_MERGE_REVIEW_PUBLISH_STALE",
      "base branch advanced outside the reviewed transaction",
      { review: current },
    );
  }
  if (repository.oid === preparedOid && repository.dirty) {
    const current = transitionToRollbackRequired(
      context.store,
      review,
      "published ref has an unclean or incomplete worktree",
    );
    throw new TeamMergeReviewCliError(
      "TEAM_MERGE_REVIEW_PUBLISH_AMBIGUOUS",
      "reviewed commit reached the base ref, but the worktree is not clean",
      { review: current },
    );
  }
  if (repository.oid === review.base.commitOid) {
    try {
      dependencies.publishPreparedMergeReview({
        inspection: {
          repoRoot: context.repoRoot,
          base: { branch: review.base.branch, oid: review.base.commitOid },
        },
        prepared: {
          success: true,
          state: "prepared",
          resultOid: preparedOid,
        },
      });
    } catch (cause) {
      const current = transitionToRollbackRequired(
        context.store,
        review,
        "reviewed fast-forward publish failed or became ambiguous",
      );
      throw new TeamMergeReviewCliError(
        "TEAM_MERGE_REVIEW_PUBLISH_FAILED",
        redactSecrets(cause?.message || "reviewed publish failed"),
        { review: current },
        cause,
      );
    }
  }
  return context.store.transition(review.reviewId, {
    expectedRevision: review.revision,
    to: "published",
    publishedOid: preparedOid,
    transitionEvidenceDigest: transitionEvidence(review, "published", {
      baseOid: review.base.commitOid,
      publishedOid: preparedOid,
    }),
  }).review;
}

export function applyTeamMergeReview(
  {
    id,
    revision,
    planDigest,
    fileIds = [],
    hunkIds = [],
    actor = "local-operator",
    reason = "reviewed multi-agent merge",
    stateDir = null,
    repoDir = process.cwd(),
  } = {},
  dependencies = _deps,
) {
  const context = resolveTeamMergeReviewState(
    { stateDir, repoDir },
    dependencies,
  );
  let review = requireStoredReview(context.store, id);
  assertRequestBinding(review, { revision, planDigest });
  if (review.state === "published") {
    return envelope("apply", review, context.actionStateDir);
  }
  if (!["planned", "prepared", "publishing"].includes(review.state)) {
    fail(
      "TEAM_MERGE_REVIEW_STATE_INVALID",
      `merge-review state ${review.state} cannot be applied`,
    );
  }
  if (review.decision) {
    if (!sameSelection(review.decision, fileIds, hunkIds)) {
      fail(
        "TEAM_MERGE_REVIEW_DECISION_IMMUTABLE",
        "requested selection differs from the persisted decision",
      );
    }
  } else {
    review = context.store.decide(review.reviewId, {
      expectedRevision: review.revision,
      actor: decisionActor(actor),
      reason: decisionReason(reason),
      host: os.hostname().slice(0, 256) || "local-host",
      selectedFileIds: fileIds,
      selectedHunkIds: hunkIds,
    }).review;
  }
  if (review.state === "planned") {
    const inspection = inspectExactReview(
      review,
      context.repoRoot,
      dependencies,
    );
    const prepared = dependencies.prepareMergeReviewTransaction({
      inspection,
      fileIds: review.decision.selectedFileIds,
      hunkIds: review.decision.selectedHunkIds,
      reviewId: review.reviewId,
      stateDir: context.stateDir,
      actor: review.decision.actor,
      reason: review.decision.reason,
      decidedAt: review.updatedAt,
    });
    if (!prepared.success) {
      const durableConflicts = canonicalizeMergeReviewConflicts(
        review,
        prepared.conflicts.map(projectedConflict),
      );
      const conflictDigest =
        computeMergeReviewConflictsDigest(durableConflicts);
      review = context.store.transition(review.reviewId, {
        expectedRevision: review.revision,
        to: "conflicted",
        conflicts: durableConflicts,
        conflictDigest,
        transitionEvidenceDigest: transitionEvidence(review, "conflicted", {
          conflictDigest,
          selection: prepared.selection,
        }),
      }).review;
      return envelope("apply", review, context.actionStateDir);
    }
    review = context.store.transition(review.reviewId, {
      expectedRevision: review.revision,
      to: "prepared",
      preparedOid: prepared.resultOid,
      transitionEvidenceDigest: transitionEvidence(review, "prepared", {
        resultOid: prepared.resultOid,
        selection: prepared.selection,
      }),
    }).review;
  }
  review = publishPreparedReview(context, review, dependencies);
  return envelope("apply", review, context.actionStateDir);
}

export function rollbackTeamMergeReview(
  {
    id,
    revision,
    evidenceDigest,
    confirm,
    stateDir = null,
    repoDir = process.cwd(),
  } = {},
  dependencies = _deps,
) {
  const context = resolveTeamMergeReviewState(
    { stateDir, repoDir },
    dependencies,
  );
  let review = requireStoredReview(context.store, id);
  const requestedRevision = expectedRevision(revision);
  const requestedEvidence = expectedDigest(evidenceDigest, "--evidence-digest");
  if (
    confirm !== review.reviewId ||
    review.revision + 1 !== requestedRevision ||
    review.evidenceDigest !== requestedEvidence
  ) {
    fail(
      "TEAM_MERGE_REVIEW_ROLLBACK_STALE",
      "controlled rollback confirmation, revision, or evidence is stale",
    );
  }
  if (review.state === "rolled_back") {
    return envelope("rollback", review, context.actionStateDir);
  }
  if (
    ![
      "prepared",
      "publishing",
      "published",
      "conflicted",
      "rollback_required",
    ].includes(review.state)
  ) {
    fail(
      "TEAM_MERGE_REVIEW_STATE_INVALID",
      `merge-review state ${review.state} cannot be rolled back`,
    );
  }
  if (review.state === "conflicted") {
    review = context.store.transition(review.reviewId, {
      expectedRevision: review.revision,
      to: "rolled_back",
      rollbackOid: review.base.commitOid,
      transitionEvidenceDigest: transitionEvidence(
        review,
        "conflict-dismissed",
        { baseOid: review.base.commitOid },
      ),
    }).review;
    return envelope("rollback", review, context.actionStateDir);
  }
  review = transitionToRollbackRequired(
    context.store,
    review,
    "operator authorized controlled rollback",
  );
  const repository = dependencies.readMergeReviewBaseState({
    repoDir: context.repoRoot,
    branch: review.base.branch,
  });
  const resultOid =
    review.settlement.publishedOid || review.settlement.preparedOid;
  if (repository.currentBranch !== review.base.branch) {
    fail(
      "TEAM_MERGE_REVIEW_ROLLBACK_STALE",
      "controlled rollback refused because the base branch advanced or changed",
    );
  }
  let rollbackOid = review.base.commitOid;
  if (repository.oid === review.base.commitOid) {
    if (repository.dirty) {
      fail(
        "TEAM_MERGE_REVIEW_ROLLBACK_DIRTY",
        "controlled rollback cannot settle an unclean base worktree",
      );
    }
  } else {
    const rollback = dependencies.rollbackPublishedMergeReview({
      repoDir: context.repoRoot,
      base: { branch: review.base.branch, oid: review.base.commitOid },
      resultOid,
      reviewId: review.reviewId,
      decidedAt: review.updatedAt,
      actor: review.decision?.actor || "local-operator",
      reason: "operator authorized controlled merge-review rollback",
      evidenceDigest: review.evidenceDigest,
      expectedEvidenceDigest: review.evidenceDigest,
    });
    rollbackOid = rollback.rollbackOid;
  }
  review = context.store.transition(review.reviewId, {
    expectedRevision: review.revision,
    to: "rolled_back",
    rollbackOid,
    transitionEvidenceDigest: transitionEvidence(review, "rolled-back", {
      baseOid: review.base.commitOid,
      publishedOid: resultOid,
      rollbackOid,
    }),
  }).review;
  return envelope("rollback", review, context.actionStateDir);
}

function printResult(result, { json = false, logger = console } = {}) {
  if (json) {
    (logger.log || console.log)(JSON.stringify(result, null, 2));
    return;
  }
  const review = result.review;
  (logger.log || console.log)(
    `${result.operation}: ${review.reviewId} r${review.revision} ${review.state}`,
  );
  (logger.log || console.log)(
    `base ${review.base.branch}@${review.base.oid.slice(0, 12)}; ` +
      `${review.candidates.length} branch(es), ${review.files.length} file(s)`,
  );
  for (const conflict of result.review.conflicts || []) {
    (logger.warn || console.warn)(
      `conflict ${conflict.path}: ${conflict.explanation}`,
    );
  }
}

function handleAction(operation, options, callback, logger) {
  try {
    const result = callback();
    printResult(result, { json: options.json === true, logger });
  } catch (error) {
    const message = redactSecrets(error?.message || String(error)).slice(
      0,
      4096,
    );
    if (options.json === true) {
      (logger.log || console.log)(
        JSON.stringify({
          schema: TEAM_MERGE_REVIEW_SCHEMA,
          schemaVersion: TEAM_MERGE_REVIEW_SCHEMA_VERSION,
          operation,
          error: {
            code: error?.code || "TEAM_MERGE_REVIEW_FAILED",
            message,
          },
        }),
      );
    } else {
      (logger.error || console.error)(message);
    }
    process.exitCode = 1;
  }
}

export function registerTeamMergeReviewCommands(
  team,
  { logger = console, dependencies = _deps } = {},
) {
  const mergeReview = team
    .command("merge-review")
    .description(
      "Review, atomically publish, and safely roll back multi-agent branches",
    );

  mergeReview
    .command("preview")
    .description("Create an exact-base file/hunk selection review")
    .requiredOption(
      "--branch <name>",
      "Candidate branch (repeatable)",
      collect,
      [],
    )
    .option("--base <branch>", "Base branch (defaults to current branch)")
    .option("--state-dir <dir>", "External owner-only review state directory")
    .option("--actor <id>", "Reserved operator identity for IDE callers")
    .option("--reason <text>", "Reserved review reason for IDE callers")
    .option("--json", "Output the strict v1 envelope")
    .action((options) =>
      handleAction(
        "preview",
        options,
        () =>
          previewTeamMergeReview(
            {
              branches: options.branch,
              base: options.base,
              stateDir: options.stateDir,
            },
            dependencies,
          ),
        logger,
      ),
    );

  mergeReview
    .command("show <review-id>")
    .description("Show one persisted merge review and its exact next actions")
    .option("--state-dir <dir>", "External owner-only review state directory")
    .option("--json", "Output the strict v1 envelope")
    .action((id, options) =>
      handleAction(
        "show",
        options,
        () =>
          showTeamMergeReview({ id, stateDir: options.stateDir }, dependencies),
        logger,
      ),
    );

  mergeReview
    .command("apply <review-id>")
    .description("Prepare and publish one exact reviewed selection atomically")
    .requiredOption("--revision <n>", "Exact review revision")
    .requiredOption("--plan-digest <digest>", "Exact reviewed plan digest")
    .option("--file-id <id>", "Select a whole file (repeatable)", collect, [])
    .option("--hunk-id <id>", "Select a text hunk (repeatable)", collect, [])
    .option("--actor <id>", "Decision actor", "local-operator")
    .option("--reason <text>", "Decision reason", "reviewed multi-agent merge")
    .option("--state-dir <dir>", "External owner-only review state directory")
    .option("--json", "Output the strict v1 envelope")
    .action((id, options) =>
      handleAction(
        "apply",
        options,
        () =>
          applyTeamMergeReview(
            {
              id,
              revision: options.revision,
              planDigest: options.planDigest,
              fileIds: options.fileId,
              hunkIds: options.hunkId,
              actor: options.actor,
              reason: options.reason,
              stateDir: options.stateDir,
            },
            dependencies,
          ),
        logger,
      ),
    );

  mergeReview
    .command("rollback <review-id>")
    .description(
      "Restore the exact pre-publish base under revision/evidence CAS",
    )
    .requiredOption("--revision <n>", "Exact review revision")
    .requiredOption(
      "--evidence-digest <digest>",
      "Exact current evidence digest",
    )
    .requiredOption("--confirm <review-id>", "Repeat the exact review ID")
    .option("--state-dir <dir>", "External owner-only review state directory")
    .option("--json", "Output the strict v1 envelope")
    .action((id, options) =>
      handleAction(
        "rollback",
        options,
        () =>
          rollbackTeamMergeReview(
            {
              id,
              revision: options.revision,
              evidenceDigest: options.evidenceDigest,
              confirm: options.confirm,
              stateDir: options.stateDir,
            },
            dependencies,
          ),
        logger,
      ),
    );

  return mergeReview;
}
