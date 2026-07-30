/**
 * Durable, multi-process `cc team queue` execution.
 *
 * The queue state coordinates leases and budgets, while git worktrees isolate
 * every real shell or Agent task. The queue file is deliberately required
 * outside the repository: a task running inside a worktree must not be able to
 * rewrite its own scheduling authority.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { TeamDistributedQueue } from "../lib/agent-team/team-distributed-queue.js";
import { TeamRunner } from "../lib/agent-team/team-runner.js";
import {
  summarizeWorktreeCheckpoint,
  TeamWorktreeCoordinator,
} from "../lib/agent-team/team-worktree.js";
import { TeamProcessCheckpointBroker } from "../lib/agent-team/team-process-checkpoint.js";
import { CostBudget } from "../lib/cost-budget.js";
import { resolveTeamTaskContract } from "../lib/agent-team/team-task-contract.js";
import executionBroker from "../lib/process-execution-broker/index.js";
import {
  SECURE_FILE_IDENTITY_ERROR,
  SecureFileIdentityError,
  sameFileStatIdentity,
  samePathHandleFileIdentity,
  withTrustedFileParentSync,
} from "../lib/secure-file-identity.js";

const MAX_GRAPH_BYTES = 64 * 1024 * 1024;
const MAX_AGENT_PROMPT_BYTES = 1024 * 1024;
const MAX_AGENT_EXECUTION_PROMPT_BYTES = 2 * 1024 * 1024;
const MAX_AGENT_USAGE_RECORDS = 64;
const SHELL_WORKTREE_MODE = "shell-worktree";
const AGENT_WORKTREE_MODE = "agent-worktree";
const DISTRIBUTED_MODES = new Set([SHELL_WORKTREE_MODE, AGENT_WORKTREE_MODE]);
const AGENT_OPTION_FIELDS = new Set([
  "permissionMode",
  "model",
  "maxTurns",
  "maxBudgetUsd",
  "maxTokens",
  "maxWallMs",
  "checkpointRequired",
  "worktreeRequired",
]);
const AGENT_PERMISSION_MODES = new Set([
  "manual",
  "auto",
  "dontAsk",
  "default",
  "plan",
  "acceptEdits",
  "bypassPermissions",
]);
const AGENT_USAGE_FIELDS = [
  "input_tokens",
  "output_tokens",
  "cache_read_input_tokens",
  "cache_creation_input_tokens",
];
const ADJUDICATION_DECISIONS = new Set(["retry", "accept", "cancel"]);
const EVIDENCE_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const AUTHORITY_KIND = "chainlesschain.team.distributed";
const AUTHORITY_VERSION = 1;

export class TeamDistributedCliError extends Error {
  constructor(code, message, details = null, cause = null) {
    super(message, cause ? { cause } : undefined);
    this.name = "TeamDistributedCliError";
    this.code = code;
    if (details != null) this.details = details;
  }
}

function fail(code, message, details, cause = null) {
  throw new TeamDistributedCliError(code, message, details, cause);
}

function samePath(left, right) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32"
    ? a.toLowerCase() === b.toLowerCase()
    : a === b;
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

function requireText(value, label) {
  const text = String(value || "");
  if (
    text.length === 0 ||
    text.length > 512 ||
    text !== text.trim() ||
    text.includes("\0")
  ) {
    fail(
      "TEAM_QUEUE_INVALID_OPTION",
      `${label} must be a stable non-empty value`,
    );
  }
  return text;
}

function optionalPositive(value, label, { integer = false } = {}) {
  if (value == null) return null;
  const parsed = Number(value);
  if (
    !Number.isFinite(parsed) ||
    parsed <= 0 ||
    (integer && !Number.isSafeInteger(parsed))
  ) {
    fail(
      "TEAM_QUEUE_INVALID_OPTION",
      `${label} must be a positive${integer ? " integer" : ""}`,
    );
  }
  return parsed;
}

function requireEvidenceDigest(value, label = "--evidence-digest") {
  const digest = String(value || "");
  if (!EVIDENCE_DIGEST_PATTERN.test(digest)) {
    fail(
      "TEAM_QUEUE_INVALID_OPTION",
      `${label} must be an exact sha256 evidence digest`,
    );
  }
  return digest;
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isPlainObject(value)) return value;
  const normalized = {};
  for (const key of Object.keys(value).sort()) {
    normalized[key] = canonicalize(value[key]);
  }
  return normalized;
}

function canonicalDigest(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

function distributedMode(value = SHELL_WORKTREE_MODE) {
  const mode = String(value || SHELL_WORKTREE_MODE);
  if (!DISTRIBUTED_MODES.has(mode)) {
    fail(
      "TEAM_QUEUE_MODE_UNSUPPORTED",
      `Distributed mode must be one of: ${Array.from(DISTRIBUTED_MODES).join(
        ", ",
      )}`,
    );
  }
  return mode;
}

function stableAgentText(
  value,
  label,
  { nullable = false, maxBytes = 512, trim = true } = {},
) {
  if (nullable && value == null) return null;
  if (typeof value !== "string") {
    fail("TEAM_QUEUE_INVALID_GRAPH", `${label} must be a string`);
  }
  const text = trim ? value.trim() : value;
  if (
    text.trim().length === 0 ||
    Buffer.byteLength(text, "utf8") > maxBytes ||
    text.includes("\0")
  ) {
    fail(
      "TEAM_QUEUE_INVALID_GRAPH",
      `${label} must be a stable non-empty value no larger than ${maxBytes} bytes`,
    );
  }
  return text;
}

function validateAgentOptionObject(value, label) {
  if (value == null) return;
  if (!isPlainObject(value)) {
    fail("TEAM_QUEUE_INVALID_GRAPH", `${label} must be an object`);
  }
  for (const field of Object.keys(value)) {
    if (!AGENT_OPTION_FIELDS.has(field)) {
      fail(
        "TEAM_QUEUE_INVALID_GRAPH",
        `${label}.${field} is not a supported distributed Agent option`,
      );
    }
  }
  if (
    Object.hasOwn(value, "permissionMode") &&
    !AGENT_PERMISSION_MODES.has(value.permissionMode)
  ) {
    fail(
      "TEAM_QUEUE_INVALID_GRAPH",
      `${label}.permissionMode is not supported`,
    );
  }
  if (Object.hasOwn(value, "model")) {
    stableAgentText(value.model, `${label}.model`, { maxBytes: 512 });
  }
  for (const field of ["maxTurns", "maxTokens", "maxWallMs"]) {
    if (Object.hasOwn(value, field)) {
      optionalPositive(value[field], `${label}.${field}`, { integer: true });
    }
  }
  if (Object.hasOwn(value, "maxBudgetUsd")) {
    optionalPositive(value.maxBudgetUsd, `${label}.maxBudgetUsd`);
  }
  for (const field of ["checkpointRequired", "worktreeRequired"]) {
    if (Object.hasOwn(value, field) && value[field] !== true) {
      fail(
        "TEAM_QUEUE_INVALID_GRAPH",
        `${label}.${field} cannot weaken agent-worktree isolation`,
      );
    }
  }
}

function normalizeAgentAuthority(value, { source = "authority" } = {}) {
  if (!isPlainObject(value)) {
    fail(
      "TEAM_QUEUE_AUTHORITY_MISMATCH",
      `Distributed Agent ${source} is missing`,
    );
  }
  const expectedFields = new Set([
    "permissionMode",
    "model",
    "maxTurns",
    "maxBudgetUsd",
    "maxTokens",
    "maxWallMs",
    "checkpointRequired",
    "worktreeRequired",
  ]);
  if (Object.keys(value).some((field) => !expectedFields.has(field))) {
    fail(
      "TEAM_QUEUE_AUTHORITY_MISMATCH",
      `Distributed Agent ${source} contains unsupported fields`,
    );
  }
  if (!AGENT_PERMISSION_MODES.has(value.permissionMode)) {
    fail(
      "TEAM_QUEUE_AUTHORITY_MISMATCH",
      `Distributed Agent ${source} has an invalid permission mode`,
    );
  }
  const normalized = {
    permissionMode: value.permissionMode,
    model:
      value.model == null
        ? null
        : stableAgentText(value.model, `Agent ${source} model`, {
            maxBytes: 512,
          }),
    maxTurns:
      value.maxTurns == null
        ? null
        : optionalPositive(value.maxTurns, `Agent ${source} maxTurns`, {
            integer: true,
          }),
    maxBudgetUsd:
      value.maxBudgetUsd == null
        ? null
        : optionalPositive(value.maxBudgetUsd, `Agent ${source} maxBudgetUsd`),
    maxTokens:
      value.maxTokens == null
        ? null
        : optionalPositive(value.maxTokens, `Agent ${source} maxTokens`, {
            integer: true,
          }),
    maxWallMs:
      value.maxWallMs == null
        ? null
        : optionalPositive(value.maxWallMs, `Agent ${source} maxWallMs`, {
            integer: true,
          }),
    checkpointRequired: value.checkpointRequired === true,
    worktreeRequired: value.worktreeRequired === true,
  };
  if (!normalized.checkpointRequired || !normalized.worktreeRequired) {
    fail(
      "TEAM_QUEUE_AUTHORITY_MISMATCH",
      `Distributed Agent ${source} must require checkpoint and worktree isolation`,
    );
  }
  return normalized;
}

function agentAuthorityForOptions(options, budget) {
  const permissionMode = String(options.permissionMode || "acceptEdits");
  if (!AGENT_PERMISSION_MODES.has(permissionMode)) {
    fail(
      "TEAM_QUEUE_INVALID_OPTION",
      `--permission-mode must be one of: ${Array.from(
        AGENT_PERMISSION_MODES,
      ).join(", ")}`,
    );
  }
  const model =
    options.model == null
      ? null
      : stableAgentText(options.model, "--model", { maxBytes: 512 });
  return {
    permissionMode,
    model,
    maxTurns: optionalPositive(options.agentMaxTurns, "--agent-max-turns", {
      integer: true,
    }),
    maxBudgetUsd:
      optionalPositive(options.agentMaxBudgetUsd, "--agent-max-budget-usd") ??
      budget.maxUsd,
    maxTokens:
      optionalPositive(options.agentMaxTokens, "--agent-max-tokens", {
        integer: true,
      }) ?? budget.maxTokens,
    maxWallMs:
      optionalPositive(options.agentMaxWallMs, "--agent-max-wall-ms", {
        integer: true,
      }) ?? budget.maxWallMs,
    checkpointRequired: true,
    worktreeRequired: true,
  };
}

function normalizeAgentUsage(value, label = "agent usage") {
  if (value == null) return null;
  if (!isPlainObject(value)) {
    fail("TEAM_QUEUE_AGENT_USAGE_INVALID", `${label} must be an object`);
  }
  const usage = {};
  let fields = 0;
  let total = 0;
  for (const field of AGENT_USAGE_FIELDS) {
    if (value[field] == null) continue;
    const amount = Number(value[field]);
    if (!Number.isSafeInteger(amount) || amount < 0) {
      fail(
        "TEAM_QUEUE_AGENT_USAGE_INVALID",
        `${label}.${field} must be a non-negative safe integer`,
      );
    }
    usage[field] = amount;
    total += amount;
    fields += 1;
  }
  if (fields === 0 || !Number.isSafeInteger(total)) {
    fail(
      "TEAM_QUEUE_AGENT_USAGE_INVALID",
      `${label} has no accountable token fields`,
    );
  }
  return usage;
}

function agentMetering(
  result,
  {
    requireUsage = false,
    requirePricing = false,
    maxTokens = null,
    maxBudgetUsd = null,
  } = {},
) {
  if (!isPlainObject(result)) {
    fail(
      "TEAM_QUEUE_AGENT_RESULT_INVALID",
      "Distributed Agent executor must return an object",
    );
  }
  const usage = normalizeAgentUsage(result.usage);
  if (requireUsage && usage == null) {
    fail(
      "TEAM_QUEUE_AGENT_USAGE_REQUIRED",
      "Budgeted distributed Agent execution returned no accountable usage",
    );
  }
  const provider =
    result.provider == null
      ? null
      : stableAgentText(result.provider, "agent result provider", {
          maxBytes: 512,
        });
  const model =
    result.model == null
      ? null
      : stableAgentText(result.model, "agent result model", { maxBytes: 512 });
  let usageRecords = null;
  if (result.usageRecords != null) {
    if (
      !Array.isArray(result.usageRecords) ||
      result.usageRecords.length === 0 ||
      result.usageRecords.length > MAX_AGENT_USAGE_RECORDS
    ) {
      fail(
        "TEAM_QUEUE_AGENT_USAGE_INVALID",
        `agent usageRecords must contain 1..${MAX_AGENT_USAGE_RECORDS} records`,
      );
    }
    usageRecords = result.usageRecords.map((record, index) => {
      if (!isPlainObject(record)) {
        fail(
          "TEAM_QUEUE_AGENT_USAGE_INVALID",
          `agent usageRecords[${index}] must be an object`,
        );
      }
      return {
        provider:
          record.provider == null
            ? null
            : stableAgentText(
                record.provider,
                `agent usageRecords[${index}].provider`,
                { maxBytes: 512 },
              ),
        model:
          record.model == null
            ? null
            : stableAgentText(
                record.model,
                `agent usageRecords[${index}].model`,
                { maxBytes: 512 },
              ),
        usage: normalizeAgentUsage(
          record.usage,
          `agent usageRecords[${index}].usage`,
        ),
      };
    });
    if (usage) {
      for (const field of AGENT_USAGE_FIELDS) {
        const aggregate = usageRecords.reduce(
          (total, record) => total + Number(record.usage[field] || 0),
          0,
        );
        if (aggregate !== Number(usage[field] || 0)) {
          fail(
            "TEAM_QUEUE_AGENT_USAGE_INVALID",
            `agent usageRecords do not match aggregate ${field}`,
          );
        }
      }
    }
  }
  const records =
    usageRecords ||
    (usage
      ? [
          {
            provider,
            model,
            usage,
          },
        ]
      : []);
  const pricing = new CostBudget({ limitUsd: Number.MAX_VALUE });
  for (const record of records) pricing.add(record);
  if (requirePricing && pricing.sawUnpriced) {
    fail(
      "TEAM_QUEUE_AGENT_USAGE_UNPRICED",
      "Distributed Agent USD cap cannot account for unpriced provider/model usage",
    );
  }
  const accountableTokens = AGENT_USAGE_FIELDS.reduce(
    (total, field) => total + Number(usage?.[field] || 0),
    0,
  );
  if (Number(maxTokens) > 0 && accountableTokens > Number(maxTokens)) {
    fail(
      "TEAM_QUEUE_AGENT_TOKEN_LIMIT",
      `Distributed Agent usage ${accountableTokens} exceeds its ${maxTokens}-token reservation`,
    );
  }
  if (
    Number(maxBudgetUsd) > 0 &&
    pricing.spentUsd - Number(maxBudgetUsd) > Number.EPSILON
  ) {
    fail(
      "TEAM_QUEUE_AGENT_COST_LIMIT",
      `Distributed Agent cost ${pricing.spentUsd} exceeds its $${maxBudgetUsd} reservation`,
    );
  }
  return {
    usage,
    provider,
    model,
    usageRecords,
    costUsd: pricing.sawUnpriced ? null : pricing.spentUsd,
  };
}

function applyAgentBudgetReservation(contract, reservation) {
  const effective = { ...contract };
  if (Number(reservation?.maxTokens) > 0) {
    effective.maxTokens =
      Number(contract.maxTokens) > 0
        ? Math.min(contract.maxTokens, reservation.maxTokens)
        : reservation.maxTokens;
  }
  if (Number(reservation?.maxBudgetUsd) > 0) {
    effective.maxBudgetUsd =
      Number(contract.maxBudgetUsd) > 0
        ? Math.min(contract.maxBudgetUsd, reservation.maxBudgetUsd)
        : reservation.maxBudgetUsd;
  }
  return effective;
}

function privateRegularRead(
  filePath,
  maxBytes,
  label,
  { runtimeFs = fs, secureFileParent = withTrustedFileParentSync } = {},
) {
  const absolute = path.resolve(filePath);
  try {
    return secureFileParent(
      runtimeFs,
      absolute,
      ({ canonicalPath, parentDevice }) => {
        let before;
        try {
          before = runtimeFs.lstatSync(canonicalPath, { bigint: true });
        } catch (error) {
          fail(
            "TEAM_QUEUE_INPUT_UNAVAILABLE",
            `Cannot inspect ${label} ${absolute}: ${error.message}`,
          );
        }
        if (
          !before.isFile() ||
          before.isSymbolicLink() ||
          Number(before.nlink) !== 1
        ) {
          fail(
            "TEAM_QUEUE_INSECURE_INPUT",
            `${label} must be a regular, single-link file: ${absolute}`,
          );
        }
        const expectedBytes = Number(before.size);
        if (expectedBytes <= 0 || expectedBytes > maxBytes) {
          fail(
            "TEAM_QUEUE_INPUT_TOO_LARGE",
            `${label} must be between 1 and ${maxBytes} bytes`,
          );
        }
        const descriptor = runtimeFs.openSync(
          canonicalPath,
          runtimeFs.constants.O_RDONLY | (runtimeFs.constants.O_NOFOLLOW || 0),
        );
        try {
          const opened = runtimeFs.fstatSync(descriptor, { bigint: true });
          if (
            !opened.isFile() ||
            Number(opened.nlink) !== 1 ||
            !samePathHandleFileIdentity(before, opened, parentDevice)
          ) {
            fail(
              "TEAM_QUEUE_INPUT_RACE",
              `${label} changed while it was being opened`,
            );
          }
          const body = runtimeFs.readFileSync(descriptor, "utf8");
          const after = runtimeFs.fstatSync(descriptor, { bigint: true });
          if (
            Buffer.byteLength(body, "utf8") !== expectedBytes ||
            !sameFileStatIdentity(opened, after)
          ) {
            fail(
              "TEAM_QUEUE_INPUT_RACE",
              `${label} changed while it was being read`,
            );
          }
          return body;
        } finally {
          runtimeFs.closeSync(descriptor);
        }
      },
    );
  } catch (error) {
    if (error instanceof TeamDistributedCliError) throw error;
    if (error instanceof SecureFileIdentityError) {
      const code =
        error.code === SECURE_FILE_IDENTITY_ERROR.PARENT_RACE
          ? "TEAM_QUEUE_INPUT_RACE"
          : "TEAM_QUEUE_INSECURE_INPUT";
      fail(
        code,
        `Cannot securely read ${label} ${absolute}: ${error.message}`,
        { secureFileIdentityCode: error.code },
        error,
      );
    }
    fail(
      "TEAM_QUEUE_INPUT_UNAVAILABLE",
      `Cannot securely read ${label} ${absolute}: ${error.message}`,
    );
  }
}

function normalizeTasks(
  document,
  { mode = SHELL_WORKTREE_MODE, agentAuthority = null } = {},
) {
  const source = Array.isArray(document) ? document : document?.tasks;
  if (!Array.isArray(source) || source.length === 0) {
    fail(
      "TEAM_QUEUE_INVALID_GRAPH",
      "Task graph must contain a non-empty `tasks` array",
    );
  }
  const keys = new Set();
  const tasks = source.map((task, index) => {
    if (!task || typeof task !== "object" || Array.isArray(task)) {
      fail(
        "TEAM_QUEUE_INVALID_GRAPH",
        `Task at index ${index} must be an object`,
      );
    }
    const key = requireText(task.key, `task[${index}].key`);
    if (keys.has(key)) {
      fail("TEAM_QUEUE_INVALID_GRAPH", `Duplicate task key "${key}"`);
    }
    keys.add(key);
    if (
      task.title !== undefined &&
      (typeof task.title !== "string" ||
        task.title.trim().length === 0 ||
        task.title.includes("\0"))
    ) {
      fail("TEAM_QUEUE_INVALID_GRAPH", `Task "${key}" has an invalid title`);
    }
    if (
      task.priority !== undefined &&
      !["high", "normal", "low"].includes(task.priority)
    ) {
      fail(
        "TEAM_QUEUE_INVALID_GRAPH",
        `Task "${key}" priority must be high, normal, or low`,
      );
    }
    if (task.retrySafe !== undefined && typeof task.retrySafe !== "boolean") {
      fail(
        "TEAM_QUEUE_INVALID_GRAPH",
        `Task "${key}" retrySafe must be boolean`,
      );
    }
    for (const field of ["sparsePaths", "symlinkDirectories"]) {
      if (task[field] == null) continue;
      if (
        !Array.isArray(task[field]) ||
        task[field].length > 128 ||
        task[field].some(
          (entry) =>
            typeof entry !== "string" ||
            entry.length === 0 ||
            entry !== entry.trim() ||
            entry.includes("\0"),
        )
      ) {
        fail(
          "TEAM_QUEUE_INVALID_GRAPH",
          `Task "${key}" ${field} must be a bounded array of stable paths`,
        );
      }
    }
    let executionMetadata;
    if (mode === SHELL_WORKTREE_MODE) {
      if (
        typeof task.command !== "string" ||
        task.command.trim().length === 0
      ) {
        fail(
          "TEAM_QUEUE_INVALID_GRAPH",
          `Task "${key}" needs a non-empty shell command`,
        );
      }
      executionMetadata = { command: task.command };
    } else {
      const allowedFields = new Set([
        "key",
        "title",
        "dependsOn",
        "deps",
        "priority",
        "retrySafe",
        "sparsePaths",
        "symlinkDirectories",
        "prompt",
        "agent",
        "policy",
      ]);
      const unsupported = Object.keys(task).filter(
        (field) => !allowedFields.has(field),
      );
      if (unsupported.length > 0) {
        fail(
          "TEAM_QUEUE_INVALID_GRAPH",
          `Task "${key}" contains unsupported agent-worktree fields: ${unsupported.join(
            ", ",
          )}`,
        );
      }
      if (Object.hasOwn(task, "command")) {
        fail(
          "TEAM_QUEUE_INVALID_GRAPH",
          `Task "${key}" cannot mix a shell command into agent-worktree mode`,
        );
      }
      const prompt = stableAgentText(task.prompt, `task "${key}".prompt`, {
        maxBytes: MAX_AGENT_PROMPT_BYTES,
        trim: false,
      });
      validateAgentOptionObject(task.agent, `task "${key}".agent`);
      validateAgentOptionObject(task.policy, `task "${key}".policy`);
      const contract = resolveTeamTaskContract({
        parent: agentAuthority,
        task,
      });
      if (contract.adjustments.length > 0) {
        fail(
          "TEAM_QUEUE_INVALID_GRAPH",
          `Task "${key}" Agent options cannot be honored exactly: ${contract.adjustments
            .map((adjustment) => adjustment.field)
            .join(", ")}`,
          { adjustments: contract.adjustments },
        );
      }
      if (
        contract.checkpointRequired !== true ||
        contract.worktreeRequired !== true
      ) {
        fail(
          "TEAM_QUEUE_INVALID_GRAPH",
          `Task "${key}" must require worktree and managed checkpoint isolation`,
        );
      }
      executionMetadata = {
        prompt,
        agentContract: {
          permissionMode: contract.permissionMode,
          model: contract.model,
          maxTurns: contract.maxTurns,
          maxBudgetUsd: contract.maxBudgetUsd,
          maxTokens: contract.maxTokens,
          maxWallMs: contract.maxWallMs,
          checkpointRequired: true,
          worktreeRequired: true,
        },
        managedCheckpointRequired: true,
      };
    }
    const dependencySource = task.dependsOn ?? task.deps ?? [];
    if (!Array.isArray(dependencySource)) {
      fail(
        "TEAM_QUEUE_INVALID_GRAPH",
        `Task "${key}" dependencies must be an array`,
      );
    }
    const dependsOn = [...dependencySource];
    if (
      dependsOn.some(
        (dependency) =>
          typeof dependency !== "string" || dependency.length === 0,
      )
    ) {
      fail(
        "TEAM_QUEUE_INVALID_GRAPH",
        `Task "${key}" has an invalid dependency`,
      );
    }
    return {
      key,
      title:
        typeof task.title === "string" && task.title.length > 0
          ? task.title
          : key,
      dependsOn,
      priority: task.priority || "normal",
      metadata: {
        ...executionMetadata,
        retrySafe: task.retrySafe === true,
        sparsePaths: task.sparsePaths || null,
        symlinkDirectories: task.symlinkDirectories || null,
      },
    };
  });
  for (const task of tasks) {
    for (const dependency of task.dependsOn) {
      if (!keys.has(dependency)) {
        fail(
          "TEAM_QUEUE_INVALID_GRAPH",
          `Task "${task.key}" depends on unknown task "${dependency}"`,
        );
      }
    }
  }
  return tasks;
}

function readTasks(
  filePath,
  options = {},
  { runtimeFs = fs, secureFileParent = withTrustedFileParentSync } = {},
) {
  let parsed;
  try {
    parsed = JSON.parse(
      privateRegularRead(filePath, MAX_GRAPH_BYTES, "task graph", {
        runtimeFs,
        secureFileParent,
      }),
    );
  } catch (error) {
    if (error instanceof TeamDistributedCliError) throw error;
    fail(
      "TEAM_QUEUE_INVALID_GRAPH",
      `Cannot parse task graph ${path.resolve(filePath)}: ${error.message}`,
    );
  }
  return normalizeTasks(parsed, options);
}

function defaultResolveRepoRoot(value = process.cwd()) {
  const cwd = fs.realpathSync.native(path.resolve(value));
  const output = executionBroker.execFileSync(
    "git",
    ["rev-parse", "--show-toplevel"],
    {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      windowsHide: true,
      origin: "team-distributed:repo-root",
      policy: "allow",
      scope: "team",
    },
  );
  return fs.realpathSync.native(String(output).trim());
}

function assertExternalStatePath(statePath, repoRoot) {
  const target = path.resolve(requireText(statePath, "--state"));
  if (pathInside(target, repoRoot)) {
    fail(
      "TEAM_QUEUE_STATE_INSIDE_REPOSITORY",
      "Distributed queue --state must be outside the agent-writable repository",
    );
  }
  let ancestor = path.dirname(target);
  while (!fs.existsSync(ancestor)) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }
  const realAncestor = fs.realpathSync.native(ancestor);
  const projected = path.resolve(
    realAncestor,
    path.relative(ancestor, path.dirname(target)),
    path.basename(target),
  );
  if (pathInside(projected, repoRoot)) {
    fail(
      "TEAM_QUEUE_STATE_INSIDE_REPOSITORY",
      "Distributed queue --state resolves inside the agent-writable repository",
    );
  }
  return projected;
}

function assertExternalCheckpointStateDir(stateDir, repoRoot, statePath) {
  const target = path.resolve(requireText(stateDir, "--checkpoint-state-dir"));
  if (pathInside(target, repoRoot)) {
    fail(
      "TEAM_QUEUE_CHECKPOINT_INSIDE_REPOSITORY",
      "Distributed checkpoint state must be outside the agent-writable repository",
    );
  }
  if (samePath(target, statePath)) {
    fail(
      "TEAM_QUEUE_CHECKPOINT_STATE_CONFLICT",
      "Distributed checkpoint state directory must differ from the queue state file",
    );
  }
  let ancestor = target;
  while (!fs.existsSync(ancestor)) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }
  const realAncestor = fs.realpathSync.native(ancestor);
  const projected = path.resolve(realAncestor, path.relative(ancestor, target));
  if (pathInside(projected, repoRoot)) {
    fail(
      "TEAM_QUEUE_CHECKPOINT_INSIDE_REPOSITORY",
      "Distributed checkpoint state resolves inside the agent-writable repository",
    );
  }
  if (samePath(projected, statePath)) {
    fail(
      "TEAM_QUEUE_CHECKPOINT_STATE_CONFLICT",
      "Distributed checkpoint state directory must differ from the queue state file",
    );
  }
  return projected;
}

function checkpointAuthority({ enabled = false, stateDir = null } = {}) {
  return {
    enabled: enabled === true,
    stateDir: enabled === true ? stateDir : null,
    coverageTarget: "partial",
    writerIsolation: "unknown",
    externalSideEffects: true,
  };
}

function authorityFor({
  repoRoot,
  runId,
  mode,
  baseTarget,
  checkpoint,
  agent = null,
}) {
  const authority = {
    kind: AUTHORITY_KIND,
    version: AUTHORITY_VERSION,
    repoRoot,
    runId,
    mode,
    baseTarget: {
      branch: baseTarget.branch ?? null,
      commitOid: baseTarget.commitOid,
    },
    checkpoint: checkpointAuthority(checkpoint),
  };
  if (mode === AGENT_WORKTREE_MODE) {
    authority.agent = normalizeAgentAuthority(agent, {
      source: "initialization contract",
    });
  }
  return authority;
}

function assertAuthority(
  snapshot,
  { repoRoot, runId, queueId, authorityDigest, statePath },
) {
  const authority = snapshot.authority;
  const checkpoint = authority?.checkpoint
    ? authority.checkpoint
    : checkpointAuthority();
  const checkpointValid =
    typeof checkpoint.enabled === "boolean" &&
    checkpoint.coverageTarget === "partial" &&
    checkpoint.writerIsolation === "unknown" &&
    checkpoint.externalSideEffects === true &&
    (checkpoint.enabled
      ? typeof checkpoint.stateDir === "string" &&
        checkpoint.stateDir.length > 0 &&
        path.isAbsolute(checkpoint.stateDir)
      : checkpoint.stateDir === null);
  const modeValid = DISTRIBUTED_MODES.has(authority?.mode);
  let agent = null;
  if (authority?.mode === AGENT_WORKTREE_MODE) {
    agent = normalizeAgentAuthority(authority.agent);
  } else if (authority?.agent != null) {
    fail(
      "TEAM_QUEUE_AUTHORITY_MISMATCH",
      "Shell distributed authority cannot carry Agent execution options",
    );
  }
  const valid =
    authority?.kind === AUTHORITY_KIND &&
    authority?.version === AUTHORITY_VERSION &&
    modeValid &&
    authority?.runId === runId &&
    samePath(authority?.repoRoot || "", repoRoot) &&
    typeof authority?.baseTarget?.commitOid === "string" &&
    checkpointValid &&
    (authority?.mode !== AGENT_WORKTREE_MODE || checkpoint.enabled === true);
  if (!valid) {
    fail(
      "TEAM_QUEUE_AUTHORITY_MISMATCH",
      "Distributed queue authority does not match this repository/run/mode",
    );
  }
  if (queueId && snapshot.queueId !== queueId) {
    fail(
      "TEAM_QUEUE_AUTHORITY_MISMATCH",
      "Distributed queue id does not match the pinned --queue-id",
    );
  }
  if (authorityDigest && snapshot.authorityDigest !== authorityDigest) {
    fail(
      "TEAM_QUEUE_AUTHORITY_MISMATCH",
      "Distributed queue authority digest does not match the pinned value",
    );
  }
  if (checkpoint.enabled) {
    const externalStateDir = assertExternalCheckpointStateDir(
      checkpoint.stateDir,
      repoRoot,
      statePath,
    );
    if (!samePath(externalStateDir, checkpoint.stateDir)) {
      fail(
        "TEAM_QUEUE_AUTHORITY_MISMATCH",
        "Distributed checkpoint state directory is not canonical",
      );
    }
  }
  return {
    ...authority,
    checkpoint: checkpointAuthority(checkpoint),
    ...(agent ? { agent } : {}),
  };
}

function coordinatorForAuthority(repoRoot, authority, deps, options = {}) {
  const coordinator = new deps.WorktreeCoordinator(repoRoot, {
    runId: authority.runId,
    checkpointBroker: options.checkpointBroker || null,
    onCheckpoint: options.onCheckpoint || null,
    snapshot: options.snapshot || {
      version: 5,
      runId: authority.runId,
      baseTarget: authority.baseTarget,
      records: [],
    },
  });
  if (!coordinator.isGitRepo()) {
    fail(
      "TEAM_QUEUE_GIT_REQUIRED",
      "Distributed shell workers require a git repository",
    );
  }
  return coordinator;
}

function completedResult(task) {
  return task?.status === "completed" ? task.metadata?.result || null : null;
}

function wallBudgetForQueueStats(queueStats, queue, deps) {
  const persisted = queueStats?.budget;
  const maxWallMs = Number(persisted?.maxWallMs);
  if (!Number.isFinite(maxWallMs) || maxWallMs <= 0) return null;

  const persistedStarted = Number.isFinite(persisted?.startedAt);
  let startedAt = persistedStarted ? persisted.startedAt : null;
  const status = () => {
    const elapsedMs =
      startedAt == null ? 0 : Math.max(0, deps.now() - startedAt);
    return {
      tasks: 0,
      maxTasks: null,
      tokens: 0,
      maxTokens: null,
      reservedTokens: 0,
      spentUsd: 0,
      maxUsd: null,
      reservedUsd: 0,
      reservations: 0,
      unpricedUsage: false,
      elapsedMs,
      maxWallMs,
      reason: elapsedMs >= maxWallMs ? "max-wall-ms" : null,
    };
  };

  // Durable queue transactions remain the sole authority for task/token/USD
  // reservations and settlement. This adapter carries only the wall
  // deadline so TeamRunner can abort an active claim (including worktree
  // commit/checkpoint work) instead of noticing the cap only at the next
  // acquire. Refresh an as-yet-unused queue immediately before Runner starts:
  // a peer that acquired before the refresh supplies the durable start, while
  // a peer that acquires after it cannot receive an earlier deadline.
  return {
    maxWallMs,
    start() {
      if (startedAt == null) {
        const refreshed = queue.budgetStatus();
        if (
          !Number.isFinite(refreshed?.startedAt) &&
          !Number.isFinite(refreshed?.observedAt)
        ) {
          fail(
            "TEAM_QUEUE_BUDGET_VIEW_INVALID",
            "Distributed queue wall budget lacks a linearized observation time",
          );
        }
        startedAt = Number.isFinite(refreshed.startedAt)
          ? refreshed.startedAt
          : refreshed.observedAt;
      }
      return this;
    },
    record() {
      return this;
    },
    releaseReservation() {
      return false;
    },
    status,
    reason() {
      return status().reason;
    },
    shouldStop() {
      return status().reason != null;
    },
  };
}

function distributedTasksDone(tasks) {
  return tasks.every(
    (task) =>
      ["completed", "cancelled"].includes(task.status) &&
      task.metadata?.adjudication?.required !== true,
  );
}

function importCompletedDependencies(coordinator, queue, task) {
  const imported = new Set(
    (coordinator.snapshot().records || []).map((record) => record.key),
  );
  const visit = (key, visiting = new Set()) => {
    if (imported.has(key)) return;
    if (visiting.has(key)) {
      fail("TEAM_QUEUE_INVALID_GRAPH", "Cyclic dependency result graph");
    }
    visiting.add(key);
    const dependency = queue.getTask(key);
    if (!dependency || dependency.status !== "completed") {
      fail(
        "TEAM_QUEUE_DEPENDENCY_UNAVAILABLE",
        `Completed dependency result for "${key}" is unavailable`,
      );
    }
    for (const parent of dependency.dependsOn || []) visit(parent, visiting);
    const result = completedResult(dependency);
    if (!result) {
      fail(
        "TEAM_QUEUE_DEPENDENCY_UNAVAILABLE",
        `Completed dependency "${key}" has no worktree result`,
      );
    }
    coordinator.registerCompletedDependency(key, result);
    imported.add(key);
    visiting.delete(key);
  };
  for (const dependency of task.dependsOn || []) visit(dependency);
}

function importRetryWorkspace(coordinator, task) {
  const existing = new Set(
    (coordinator.snapshot().records || []).map((record) => record.key),
  );
  if (existing.has(task.key)) return;
  const history = task.metadata?.workspaceExecutionHistory;
  if (!Array.isArray(history) || history.length === 0) return;
  const settled = [...history]
    .reverse()
    .find((entry) =>
      ["preparation-rolled-back", "rolled-back"].includes(entry?.phase),
    );
  if (!settled?.worktree) return;
  coordinator.seed([settled.worktree]);
}

function workerRegistry(queue, workerId, { settlementForLease = null } = {}) {
  const holder = (options = {}) => ({
    ...options,
    holder: `${workerId}:${options.holder || "teammate"}`,
  });
  return new Proxy(queue.asRegistry(), {
    get(target, property) {
      if (
        ["acquire", "renew", "release", "complete", "fail"].includes(property)
      ) {
        return (key, options = {}) => {
          const metering =
            ["complete", "fail"].includes(property) &&
            typeof settlementForLease === "function"
              ? settlementForLease(options.leaseId)
              : null;
          const result = target[property](
            key,
            holder({
              ...options,
              ...(metering?.usage ? { usage: metering.usage } : {}),
              ...(metering?.usageRecords
                ? { usageRecords: metering.usageRecords }
                : {}),
              ...(Number.isFinite(metering?.costUsd)
                ? { costUsd: metering.costUsd }
                : {}),
              ...(property === "complete" &&
              options.result &&
              Number.isFinite(metering?.costUsd)
                ? {
                    result: {
                      ...options.result,
                      costUsd: metering.costUsd,
                    },
                  }
                : {}),
            }),
          );
          if (result?.ok) metering?.settled?.();
          return result;
        };
      }
      const value = target[property];
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function defaultDependencies(overrides = {}) {
  return {
    Queue: TeamDistributedQueue,
    Runner: TeamRunner,
    WorktreeCoordinator: TeamWorktreeCoordinator,
    CheckpointBroker: TeamProcessCheckpointBroker,
    fileSystem: fs,
    secureFileParent: withTrustedFileParentSync,
    agentExecutor: null,
    buildAgentPrompt: (prompt) => prompt,
    onRunner: null,
    resolveRepoRoot: defaultResolveRepoRoot,
    now: () => Date.now(),
    git: (repoRoot, args) =>
      String(
        executionBroker.execFileSync("git", args, {
          cwd: repoRoot,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          shell: false,
          windowsHide: true,
          origin: "team-distributed:finalize",
          policy: "allow",
          scope: "team",
        }),
      ).trim(),
    sleep: (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
    ...overrides,
  };
}

function openPinnedQueue(options, deps) {
  const repoRoot = deps.resolveRepoRoot(options.repo || process.cwd());
  const runId = requireText(options.runId, "--run-id");
  const statePath = assertExternalStatePath(options.state, repoRoot);
  const queue = deps.Queue.open({
    filePath: statePath,
    runId,
    expectedQueueId: options.queueId || null,
    expectedAuthorityDigest: options.authorityDigest || null,
  });
  const snapshot = queue.snapshot();
  const authority = assertAuthority(snapshot, {
    repoRoot,
    runId,
    queueId: options.queueId || null,
    authorityDigest: options.authorityDigest || null,
    statePath,
  });
  const expectedMode =
    options.agent === true
      ? AGENT_WORKTREE_MODE
      : options.mode
        ? distributedMode(options.mode)
        : null;
  if (expectedMode && authority.mode !== expectedMode) {
    fail(
      "TEAM_QUEUE_AUTHORITY_MISMATCH",
      `Worker/finalizer requested ${expectedMode}, but the pinned queue authority is ${authority.mode}`,
    );
  }
  if (
    options.managedCheckpoint === true &&
    authority.checkpoint.enabled !== true
  ) {
    fail(
      "TEAM_QUEUE_CHECKPOINT_AUTHORITY_MISMATCH",
      "--managed-checkpoint cannot widen a queue created without checkpoint authority",
    );
  }
  if (options.checkpointStateDir) {
    const canonicalCheckpointStateDir = assertExternalCheckpointStateDir(
      options.checkpointStateDir,
      repoRoot,
      statePath,
    );
    if (
      authority.checkpoint.enabled !== true ||
      !samePath(canonicalCheckpointStateDir, authority.checkpoint.stateDir)
    ) {
      fail(
        "TEAM_QUEUE_CHECKPOINT_AUTHORITY_MISMATCH",
        "--checkpoint-state-dir must match the pinned queue authority",
      );
    }
  }
  return { queue, snapshot, authority, repoRoot, statePath, runId };
}

export function initDistributedQueue(options, dependencyOverrides = {}) {
  const deps = defaultDependencies(dependencyOverrides);
  const repoRoot = deps.resolveRepoRoot(options.repo || process.cwd());
  const runId = requireText(options.runId, "--run-id");
  const statePath = assertExternalStatePath(options.state, repoRoot);
  const mode = distributedMode(options.mode);
  if (options.checkpointStateDir && options.managedCheckpoint !== true) {
    fail(
      "TEAM_QUEUE_INVALID_OPTION",
      "--checkpoint-state-dir requires --managed-checkpoint",
    );
  }
  const managedCheckpointStateDir =
    options.managedCheckpoint === true
      ? assertExternalCheckpointStateDir(
          options.checkpointStateDir || `${statePath}.workspace-transactions`,
          repoRoot,
          statePath,
        )
      : null;
  if (mode === AGENT_WORKTREE_MODE && options.managedCheckpoint !== true) {
    fail(
      "TEAM_QUEUE_CHECKPOINT_REQUIRED",
      "agent-worktree queues require --managed-checkpoint",
    );
  }
  const probe = new deps.WorktreeCoordinator(repoRoot, { runId });
  if (!probe.isGitRepo()) {
    fail(
      "TEAM_QUEUE_GIT_REQUIRED",
      "Distributed shell workers require a git repository",
    );
  }
  const baseTarget = probe.snapshot().baseTarget;
  const budget = {
    maxTasks: optionalPositive(options.maxTasks, "--max-tasks", {
      integer: true,
    }),
    maxTokens: optionalPositive(options.maxTokens, "--max-tokens", {
      integer: true,
    }),
    maxUsd: optionalPositive(options.maxUsd, "--max-usd"),
    maxWallMs: optionalPositive(options.maxWallMs, "--max-wall-ms", {
      integer: true,
    }),
  };
  const agent =
    mode === AGENT_WORKTREE_MODE
      ? agentAuthorityForOptions(options, budget)
      : null;
  const tasks = readTasks(
    options.tasks,
    {
      mode,
      agentAuthority: agent,
    },
    {
      runtimeFs: deps.fileSystem,
      secureFileParent: deps.secureFileParent,
    },
  );
  if (budget.maxTasks == null) budget.maxTasks = tasks.length;
  const authority = authorityFor({
    repoRoot,
    runId,
    mode,
    baseTarget,
    checkpoint: {
      enabled: options.managedCheckpoint === true,
      stateDir: managedCheckpointStateDir,
    },
    agent,
  });
  const created = deps.Queue.create({
    filePath: statePath,
    runId,
    tasks,
    budget,
    defaultTtlMs:
      optionalPositive(options.ttlMs, "--ttl-ms", { integer: true }) ??
      undefined,
    authority,
  });
  return {
    ...created,
    statePath,
    repoRoot,
    runId,
    mode,
    authority,
    budget,
    checkpoint: checkpointAuthority({
      enabled: options.managedCheckpoint === true,
      stateDir: managedCheckpointStateDir,
    }),
  };
}

export function distributedQueueStatus(options, dependencyOverrides = {}) {
  const deps = defaultDependencies(dependencyOverrides);
  const opened = openPinnedQueue(options, deps);
  const view =
    typeof opened.queue.statusView === "function"
      ? opened.queue.statusView()
      : {
          queueId: opened.snapshot.queueId,
          revision: opened.snapshot.revision,
          graphDigest: opened.snapshot.graphDigest,
          authorityDigest: opened.snapshot.authorityDigest,
          stats: opened.queue.stats(),
          finalization: opened.queue.getFinalization(),
          pendingAdjudications: opened.queue.pendingAdjudications(),
          tasks: opened.queue.list(),
        };
  return {
    queueId: view.queueId,
    revision: view.revision,
    graphDigest: view.graphDigest,
    authorityDigest: view.authorityDigest,
    authority: view.authority ?? opened.authority,
    stats: view.stats,
    finalization: view.finalization,
    pendingAdjudications: view.pendingAdjudications,
    interruptions: view.interruptions ?? [],
    tasks: view.tasks,
  };
}

function requireQueueMutation(result, code, action) {
  if (result?.ok) return result;
  fail(
    code,
    `Distributed queue could not ${action}: ${result?.reason || "unknown"}${
      result?.error ? ` (${result.error})` : ""
    }`,
    result || null,
  );
}

export function interruptDistributedQueue(options, dependencyOverrides = {}) {
  const deps = defaultDependencies(dependencyOverrides);
  const opened = openPinnedQueue(options, deps);
  const key = requireText(options.task, "--task");
  const result = requireQueueMutation(
    opened.queue.requestInterrupt(key, {
      holder: requireText(options.holder, "--holder"),
      leaseId: requireText(options.leaseId, "--lease-id"),
      fencingToken: optionalPositive(options.fencingToken, "--fencing-token", {
        integer: true,
      }),
      requestId: requireText(options.requestId, "--request-id"),
      actor: requireText(options.actor || "human", "--actor"),
      reason:
        options.reason == null
          ? "human takeover requested"
          : requireText(options.reason, "--reason"),
    }),
    "TEAM_QUEUE_INTERRUPT_REJECTED",
    `interrupt task "${key}"`,
  );
  const view =
    typeof opened.queue.statusView === "function"
      ? opened.queue.statusView()
      : null;
  return {
    queueId: opened.snapshot.queueId,
    ...(view ? { revision: view.revision } : {}),
    task: key,
    ...result,
  };
}

function gitOid(repoRoot, ref, deps, label) {
  let oid;
  try {
    oid = deps.git(repoRoot, ["rev-parse", "--verify", ref]);
  } catch (error) {
    fail(
      "TEAM_QUEUE_RECOVERY_GIT_DRIFT",
      `Could not resolve ${label}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (!/^[a-f0-9]{40,64}$/u.test(oid || "")) {
    fail(
      "TEAM_QUEUE_RECOVERY_GIT_DRIFT",
      `${label} did not resolve to a stable Git object`,
    );
  }
  return oid.toLowerCase();
}

function assertCleanGitWorktree(
  worktreePath,
  deps,
  {
    code = "TEAM_QUEUE_RECOVERY_GIT_DRIFT",
    message = "Task worktree is not clean",
  } = {},
) {
  let status;
  try {
    status = deps.git(worktreePath, [
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
    ]);
  } catch (error) {
    fail(
      code,
      `Could not inspect task worktree: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (status !== "") {
    fail(code, message, { status });
  }
  return status;
}

function verifyCommittedRecoveryGit(opened, execution, deps) {
  const expected = execution?.verifiedCommitOid;
  if (
    !expected ||
    typeof execution?.worktree?.branch !== "string" ||
    typeof execution?.worktree?.path !== "string"
  ) {
    fail(
      "TEAM_QUEUE_RECOVERY_EVIDENCE_INCOMPLETE",
      "Committed checkpoint recovery lacks a verified worktree commit",
    );
  }
  const branchHead = gitOid(
    opened.repoRoot,
    execution.worktree.branch,
    deps,
    `task branch "${execution.worktree.branch}"`,
  );
  const worktreeHead = gitOid(
    execution.worktree.path,
    "HEAD",
    deps,
    `task worktree "${execution.worktree.path}"`,
  );
  const status = assertCleanGitWorktree(execution.worktree.path, deps, {
    message:
      "Committed checkpoint no longer matches the exact clean task branch/worktree",
  });
  if (
    branchHead !== expected.toLowerCase() ||
    worktreeHead !== expected.toLowerCase() ||
    status !== ""
  ) {
    fail(
      "TEAM_QUEUE_RECOVERY_GIT_DRIFT",
      "Committed checkpoint no longer matches the exact clean task branch/worktree",
      { expected, branchHead, worktreeHead, status },
    );
  }
}

function repairRolledBackGitBaseline(opened, execution, deps) {
  const baseline = execution.worktree.baselineCommitOid?.toLowerCase();
  if (!baseline) {
    fail(
      "TEAM_QUEUE_RECOVERY_EVIDENCE_INCOMPLETE",
      "Rolled-back checkpoint lacks a Git baseline",
    );
  }
  const branchHead = gitOid(
    opened.repoRoot,
    execution.worktree.branch,
    deps,
    `task branch "${execution.worktree.branch}"`,
  );
  const worktreeHead = gitOid(
    execution.worktree.path,
    "HEAD",
    deps,
    `task worktree "${execution.worktree.path}"`,
  );
  if (branchHead === baseline && worktreeHead === baseline) {
    assertCleanGitWorktree(execution.worktree.path, deps, {
      message: "Rolled-back task Git baseline contains residual writes",
    });
    return { repaired: false, baselineCommitOid: baseline };
  }
  const attemptedCommit = execution.verifiedCommitOid?.toLowerCase() || null;
  if (
    !attemptedCommit ||
    branchHead !== attemptedCommit ||
    worktreeHead !== attemptedCommit
  ) {
    fail(
      "TEAM_QUEUE_RECOVERY_GIT_DRIFT",
      "Task branch/worktree moved beyond the exact abandoned attempt",
      { baseline, attemptedCommit, branchHead, worktreeHead },
    );
  }
  try {
    deps.git(execution.worktree.path, ["diff", "--quiet", baseline, "--"]);
    const untracked = deps.git(execution.worktree.path, [
      "ls-files",
      "--others",
      "--exclude-standard",
    ]);
    if (untracked) {
      fail(
        "TEAM_QUEUE_RECOVERY_GIT_DRIFT",
        "Rolled-back worktree still contains untracked files",
        { untracked: untracked.split(/\r?\n/u).filter(Boolean) },
      );
    }
    deps.git(execution.worktree.path, ["reset", "--hard", baseline]);
  } catch (error) {
    if (error instanceof TeamDistributedCliError) throw error;
    fail(
      "TEAM_QUEUE_RECOVERY_GIT_DRIFT",
      `Could not prove and restore the exact task Git baseline: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  const repairedBranch = gitOid(
    opened.repoRoot,
    execution.worktree.branch,
    deps,
    `repaired task branch "${execution.worktree.branch}"`,
  );
  const repairedHead = gitOid(
    execution.worktree.path,
    "HEAD",
    deps,
    `repaired task worktree "${execution.worktree.path}"`,
  );
  if (repairedBranch !== baseline || repairedHead !== baseline) {
    fail(
      "TEAM_QUEUE_RECOVERY_GIT_DRIFT",
      "Task Git baseline repair did not settle the exact branch/worktree",
      { baseline, repairedBranch, repairedHead },
    );
  }
  assertCleanGitWorktree(execution.worktree.path, deps, {
    message: "Repaired task Git baseline contains residual writes",
  });
  return {
    repaired: true,
    baselineCommitOid: baseline,
    abandonedCommitOid: attemptedCommit,
  };
}

function requireExactCheckpointRecoverySweep(
  recoverySweep,
  transactionId,
  terminalState,
) {
  if (!Array.isArray(recoverySweep)) {
    fail(
      "TEAM_QUEUE_CHECKPOINT_RECOVERY_REQUIRED",
      "Checkpoint recovery did not return a durable transaction sweep",
    );
  }
  const matches = recoverySweep.filter((entry) => entry?.id === transactionId);
  const entry = matches.length === 1 ? matches[0] : null;
  if (
    !entry ||
    entry.manualRecoveryRequired === true ||
    entry.status !== terminalState
  ) {
    fail(
      "TEAM_QUEUE_CHECKPOINT_RECOVERY_REQUIRED",
      `Checkpoint "${transactionId}" recovery is not durably settled`,
      {
        transactionId,
        expectedStatus: terminalState,
        recoveryEntries: matches,
      },
    );
  }
  return entry;
}

export function recoverDistributedQueueCheckpoint(
  options,
  dependencyOverrides = {},
) {
  const deps = defaultDependencies(dependencyOverrides);
  const opened = openPinnedQueue(options, deps);
  const key = requireText(options.task, "--task");
  const recoveryId = requireText(options.recoveryId, "--recovery-id");
  const actor = requireText(options.actor || "recovery", "--actor");
  const reason =
    options.reason == null
      ? "recover abandoned managed workspace checkpoint"
      : requireText(options.reason, "--reason");
  const evidenceDigest = requireEvidenceDigest(options.evidenceDigest);
  const task = opened.queue.getTask(key);
  if (!task) {
    fail(
      "TEAM_QUEUE_TASK_NOT_FOUND",
      `Distributed task "${key}" was not found`,
    );
  }
  if (
    task.status !== "cancelled" ||
    task.metadata?.adjudication?.required !== true ||
    task.metadata.adjudication.evidenceDigest !== evidenceDigest
  ) {
    fail(
      "TEAM_QUEUE_RECOVERY_EVIDENCE_MISMATCH",
      `Task "${key}" is not awaiting the pinned adjudication evidence`,
    );
  }
  const current = task.metadata?.workspaceExecution;
  const checkpoint = current?.checkpoint;
  if (
    !current ||
    !checkpoint?.transactionId ||
    opened.authority.checkpoint.enabled !== true ||
    !samePath(checkpoint.stateDir, opened.authority.checkpoint.stateDir) ||
    !samePath(checkpoint.workspaceRoot, current.worktree?.path || "")
  ) {
    fail(
      "TEAM_QUEUE_RECOVERY_EVIDENCE_INCOMPLETE",
      `Task "${key}" has no pinned managed checkpoint execution`,
    );
  }
  const broker = new deps.CheckpointBroker({
    stateDir: opened.authority.checkpoint.stateDir,
    coverageTarget: "partial",
    writerIsolation: "unknown",
    externalSideEffects: true,
  });
  let recoverySweep;
  let snapshot;
  try {
    recoverySweep = broker.recoverPending({
      stateDir: checkpoint.stateDir,
      workspaceRoot: checkpoint.workspaceRoot,
      reason,
    });
    snapshot = broker.inspectCheckpoint(checkpoint.transactionId, {
      stateDir: checkpoint.stateDir,
    });
  } catch (error) {
    fail(
      "TEAM_QUEUE_CHECKPOINT_RECOVERY_FAILED",
      `Could not recover checkpoint "${checkpoint.transactionId}": ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (
    snapshot.id !== checkpoint.transactionId ||
    snapshot.checkpointId !== checkpoint.checkpointId ||
    snapshot.runId !== checkpoint.runId ||
    snapshot.taskKey !== key ||
    !samePath(snapshot.workspaceRoot, checkpoint.workspaceRoot) ||
    !samePath(snapshot.stateDir, checkpoint.stateDir)
  ) {
    fail(
      "TEAM_QUEUE_RECOVERY_EVIDENCE_MISMATCH",
      "Recovered workspace transaction changed its task/authority binding",
    );
  }
  const recoveredCheckpoint = summarizeWorktreeCheckpoint(snapshot, key);
  const rolledBack = ["rolled_back", "aborted"].includes(
    recoveredCheckpoint.state,
  );
  const committed = recoveredCheckpoint.state === "committed";
  if (!rolledBack && !committed) {
    fail(
      "TEAM_QUEUE_CHECKPOINT_RECOVERY_REQUIRED",
      `Checkpoint "${checkpoint.transactionId}" remains ${recoveredCheckpoint.state}`,
      { recoverySweep, checkpoint: recoveredCheckpoint },
    );
  }
  requireExactCheckpointRecoverySweep(
    recoverySweep,
    checkpoint.transactionId,
    recoveredCheckpoint.state,
  );
  for (const [field, value] of Object.entries({
    checkpointDigest: recoveredCheckpoint.checkpointDigest,
    writeManifestDigest: recoveredCheckpoint.writeManifestDigest,
    checkpointEvidenceDigest: recoveredCheckpoint.evidenceDigest,
  })) {
    if (!EVIDENCE_DIGEST_PATTERN.test(value || "")) {
      fail(
        "TEAM_QUEUE_RECOVERY_EVIDENCE_INCOMPLETE",
        `Recovered checkpoint lacks ${field}`,
      );
    }
  }

  const execution = {
    ...current,
    phase: committed
      ? "committed"
      : current.phase === "prepared"
        ? "preparation-rolled-back"
        : "rolled-back",
    worktree: {
      ...current.worktree,
      workspaceCheckpoint: recoveredCheckpoint,
    },
    checkpoint: recoveredCheckpoint,
    verifiedCommitOid: committed ? current.verifiedCommitOid : null,
  };
  let gitRecovery = null;
  if (committed) {
    verifyCommittedRecoveryGit(opened, execution, deps);
  } else if (options.repairGitBaseline === true) {
    gitRecovery = repairRolledBackGitBaseline(opened, current, deps);
  }
  const result = requireQueueMutation(
    opened.queue.reconcileWorkspaceExecution(key, {
      recoveryId,
      actor,
      reason,
      evidenceDigest,
      checkpointDigest: recoveredCheckpoint.checkpointDigest,
      writeManifestDigest: recoveredCheckpoint.writeManifestDigest,
      checkpointEvidenceDigest: recoveredCheckpoint.evidenceDigest,
      execution,
    }),
    "TEAM_QUEUE_CHECKPOINT_RECONCILIATION_REJECTED",
    `reconcile checkpoint for task "${key}"`,
  );
  return {
    queueId: opened.snapshot.queueId,
    task: key,
    recoverySweep,
    gitRecovery,
    ...result,
  };
}

function assertRetryGitReady(opened, task, deps) {
  const execution = task.metadata?.workspaceExecution;
  if (
    !execution ||
    !["preparation-rolled-back", "rolled-back"].includes(execution.phase)
  ) {
    return;
  }
  const baseline = execution.worktree?.baselineCommitOid?.toLowerCase();
  const branchHead = gitOid(
    opened.repoRoot,
    execution.worktree.branch,
    deps,
    `task branch "${execution.worktree.branch}"`,
  );
  const worktreeHead = gitOid(
    execution.worktree.path,
    "HEAD",
    deps,
    `task worktree "${execution.worktree.path}"`,
  );
  if (!baseline || branchHead !== baseline || worktreeHead !== baseline) {
    fail(
      "TEAM_QUEUE_RETRY_GIT_RECOVERY_REQUIRED",
      `Task "${task.key}" cannot retry until its exact Git baseline is restored`,
      { baseline, branchHead, worktreeHead },
    );
  }
  assertCleanGitWorktree(execution.worktree.path, deps, {
    code: "TEAM_QUEUE_RETRY_GIT_RECOVERY_REQUIRED",
    message: `Task "${task.key}" cannot retry with residual worktree writes`,
  });
}

export function adjudicateDistributedQueue(options, dependencyOverrides = {}) {
  const deps = defaultDependencies(dependencyOverrides);
  const opened = openPinnedQueue(options, deps);
  const key = requireText(options.task, "--task");
  const decision = requireText(options.decision, "--decision");
  if (!ADJUDICATION_DECISIONS.has(decision)) {
    fail(
      "TEAM_QUEUE_INVALID_OPTION",
      "--decision must be retry, accept, or cancel",
    );
  }
  const decisionId = requireText(options.decisionId, "--decision-id");
  const actor = requireText(options.actor || "human", "--actor");
  const reason =
    options.reason == null ? null : requireText(options.reason, "--reason");
  const evidenceDigest = requireEvidenceDigest(options.evidenceDigest);
  const task = opened.queue.getTask(key);
  if (!task) {
    fail(
      "TEAM_QUEUE_TASK_NOT_FOUND",
      `Distributed task "${key}" was not found`,
    );
  }
  if (decision === "retry") assertRetryGitReady(opened, task, deps);

  let acceptance = null;
  if (decision === "accept") {
    const prior = task.metadata?.adjudication?.decision || null;
    if (prior?.id === decisionId && prior.action === "accept") {
      acceptance = {
        result: task.metadata?.result,
        proof: task.metadata?.result?.workspaceExecutionEvidence || null,
        replay: true,
      };
    } else {
      verifyCommittedRecoveryGit(
        opened,
        task.metadata?.workspaceExecution,
        deps,
      );
      acceptance = requireQueueMutation(
        opened.queue.adjudicationAcceptance(key, { evidenceDigest }),
        "TEAM_QUEUE_ADJUDICATION_EVIDENCE_REJECTED",
        `derive acceptance evidence for task "${key}"`,
      );
    }
  }
  const result = requireQueueMutation(
    opened.queue.resolveAdjudication(key, {
      decision,
      decisionId,
      actor,
      reason,
      evidenceDigest,
      ...(acceptance ? { result: acceptance.result } : {}),
    }),
    "TEAM_QUEUE_ADJUDICATION_REJECTED",
    `adjudicate task "${key}"`,
  );
  return {
    queueId: opened.snapshot.queueId,
    task: key,
    ...(acceptance?.proof ? { acceptance: acceptance.proof } : {}),
    ...result,
  };
}

function attemptLease(task, key) {
  const lease = task?.lease || task?.metadata?.lease || null;
  if (
    !lease?.holder ||
    !lease?.leaseId ||
    !Number.isSafeInteger(lease?.fencingToken)
  ) {
    fail(
      "TEAM_QUEUE_AGENT_LEASE_MISSING",
      `Task "${key}" has no durable Agent lease/fence binding`,
    );
  }
  return lease;
}

function settlementAccessor(attempts, leaseId) {
  const attempt = attempts.get(leaseId);
  if (!attempt) return null;
  return {
    usage: attempt.metering.usage,
    usageRecords: attempt.metering.usageRecords,
    costUsd: attempt.metering.costUsd,
    settled: () => attempts.delete(leaseId),
  };
}

function attachAgentMetering(error, metering) {
  if (!error || !metering) return error;
  if (metering.usage) error.usage = metering.usage;
  if (metering.usageRecords) error.usageRecords = metering.usageRecords;
  if (metering.provider) error.provider = metering.provider;
  if (metering.model) error.model = metering.model;
  if (Number.isFinite(metering.costUsd)) error.costUsd = metering.costUsd;
  return error;
}

function agentExecutionEvidence({
  opened,
  workerId,
  key,
  lease,
  sourcePrompt,
  executionPrompt,
  contract,
  result,
  metering,
}) {
  const checkpoint = result.workspaceCheckpoint;
  if (
    checkpoint?.state !== "committed" ||
    !checkpoint.transactionId ||
    !checkpoint.evidenceDigest ||
    !result.commitOid
  ) {
    fail(
      "TEAM_QUEUE_AGENT_EVIDENCE_INCOMPLETE",
      `Task "${key}" completed without committed checkpoint/Git evidence`,
    );
  }
  const binding = {
    domain: "cc-team-distributed-agent-execution-v1",
    queueId: opened.snapshot.queueId,
    authorityDigest: opened.snapshot.authorityDigest,
    taskKey: key,
    workerId,
    holder: lease.holder,
    leaseId: lease.leaseId,
    fencingToken: lease.fencingToken,
    sourcePromptDigest: canonicalDigest({
      domain: "cc-team-distributed-agent-prompt-v1",
      prompt: sourcePrompt,
    }),
    executionPromptDigest: canonicalDigest({
      domain: "cc-team-distributed-agent-execution-prompt-v1",
      prompt: executionPrompt,
    }),
    contractDigest: canonicalDigest({
      domain: "cc-team-distributed-agent-contract-v1",
      contract,
    }),
    commitOid: result.commitOid,
    checkpointTransactionId: checkpoint.transactionId,
    checkpointEvidenceDigest: checkpoint.evidenceDigest,
    checkpointWriteManifestDigest: checkpoint.writeManifestDigest || null,
    usage: metering.usage,
    usageRecords: metering.usageRecords,
    provider: metering.provider,
    model: metering.model,
    costUsd: metering.costUsd,
  };
  return {
    version: 1,
    mode: AGENT_WORKTREE_MODE,
    ...binding,
    digest: canonicalDigest(binding),
  };
}

function makeDistributedAgentRunTask({
  opened,
  coordinator,
  deps,
  workerId,
  attempts,
}) {
  if (typeof deps.agentExecutor !== "function") {
    fail(
      "TEAM_QUEUE_AGENT_EXECUTOR_UNAVAILABLE",
      "agent-worktree worker has no injected Agent executor",
    );
  }
  if (typeof deps.buildAgentPrompt !== "function") {
    fail(
      "TEAM_QUEUE_AGENT_EXECUTOR_UNAVAILABLE",
      "agent-worktree worker has no injected prompt builder",
    );
  }
  const runInWorktree = async ({
    key,
    task,
    cwd,
    inbox = [],
    budgetReservation = null,
    signal = null,
    managedCheckpoint = false,
  }) => {
    if (managedCheckpoint !== true) {
      fail(
        "TEAM_QUEUE_CHECKPOINT_REQUIRED",
        `Task "${key}" Agent execution lacks its pinned managed checkpoint`,
      );
    }
    const lease = attemptLease(task, key);
    const prompt = stableAgentText(
      task.metadata?.prompt,
      `task "${key}".prompt`,
      {
        maxBytes: MAX_AGENT_PROMPT_BYTES,
        trim: false,
      },
    );
    const contract = normalizeAgentAuthority(task.metadata?.agentContract, {
      source: `task "${key}" contract`,
    });
    let effectiveContract = applyAgentBudgetReservation(
      contract,
      budgetReservation,
    );
    const queueBudget = opened.queue.budgetStatus();
    if (Number(queueBudget.maxWallMs) > 0) {
      const remainingWallMs = Math.floor(
        Number(queueBudget.maxWallMs) - Number(queueBudget.elapsedMs || 0),
      );
      if (remainingWallMs <= 0) {
        fail(
          "TEAM_QUEUE_AGENT_WALL_LIMIT",
          `Task "${key}" cannot start after the distributed wall-clock budget`,
        );
      }
      effectiveContract = {
        ...effectiveContract,
        maxWallMs:
          Number(effectiveContract.maxWallMs) > 0
            ? Math.min(effectiveContract.maxWallMs, remainingWallMs)
            : remainingWallMs,
      };
    }
    let rawResult;
    let executionPrompt = null;
    try {
      executionPrompt = deps.buildAgentPrompt(prompt, { inbox });
      if (
        typeof executionPrompt !== "string" ||
        executionPrompt.trim().length === 0 ||
        executionPrompt.includes("\0") ||
        Buffer.byteLength(executionPrompt, "utf8") >
          MAX_AGENT_EXECUTION_PROMPT_BYTES
      ) {
        fail(
          "TEAM_QUEUE_AGENT_PROMPT_INVALID",
          `Task "${key}" prompt builder returned an invalid prompt`,
        );
      }
      rawResult = await deps.agentExecutor(executionPrompt, cwd, {
        ...effectiveContract,
        checkpointRequired: false,
        worktreeRequired: true,
        managedCheckpoint: true,
        signal,
      });
    } catch (caught) {
      const error =
        caught instanceof Error ? caught : new Error(String(caught || ""));
      try {
        const metering = agentMetering(
          {
            usage: error.usage ?? null,
            usageRecords: error.usageRecords ?? null,
            provider: error.provider ?? null,
            model: error.model ?? null,
          },
          {},
        );
        if (metering.usage) {
          attempts.set(lease.leaseId, {
            key,
            lease,
            sourcePrompt: prompt,
            executionPrompt,
            contract: effectiveContract,
            metering,
          });
          attachAgentMetering(error, metering);
        }
      } catch {
        // The executor failure remains primary. The queue conservatively
        // consumes any reserved caps when trustworthy metering is unavailable.
      }
      throw error;
    }

    let metering;
    try {
      metering = agentMetering(rawResult, {
        requireUsage:
          Number(effectiveContract.maxTokens) > 0 ||
          Number(effectiveContract.maxBudgetUsd) > 0,
        requirePricing: Number(effectiveContract.maxBudgetUsd) > 0,
        maxTokens: effectiveContract.maxTokens,
        maxBudgetUsd: effectiveContract.maxBudgetUsd,
      });
    } catch (caught) {
      const error =
        caught instanceof Error ? caught : new Error(String(caught || ""));
      error.retryable = false;
      try {
        const partial = agentMetering(rawResult, {});
        if (partial.usage) {
          attempts.set(lease.leaseId, {
            key,
            lease,
            sourcePrompt: prompt,
            executionPrompt,
            contract: effectiveContract,
            metering: partial,
          });
          attachAgentMetering(error, partial);
        }
      } catch {
        // The strict validation error remains authoritative.
      }
      throw error;
    }
    attempts.set(lease.leaseId, {
      key,
      lease,
      sourcePrompt: prompt,
      executionPrompt,
      contract: effectiveContract,
      metering,
    });
    return {
      usage: metering.usage,
      provider: metering.provider,
      model: metering.model,
      ...(metering.usageRecords ? { usageRecords: metering.usageRecords } : {}),
    };
  };
  const worktreeRunTask = coordinator.makeRunTask({ runInWorktree });
  return async (context) => {
    const lease = attemptLease(context.task, context.key);
    const result = await worktreeRunTask(context);
    const attempt = attempts.get(lease.leaseId);
    if (!attempt) {
      fail(
        "TEAM_QUEUE_AGENT_EVIDENCE_INCOMPLETE",
        `Task "${context.key}" has no settled Agent metering evidence`,
      );
    }
    return {
      ...result,
      costUsd: attempt.metering.costUsd,
      agentExecution: agentExecutionEvidence({
        opened,
        workerId,
        key: context.key,
        lease,
        sourcePrompt: attempt.sourcePrompt,
        executionPrompt: attempt.executionPrompt,
        contract: attempt.contract,
        result,
        metering: attempt.metering,
      }),
    };
  };
}

export async function runDistributedWorker(options, dependencyOverrides = {}) {
  const deps = defaultDependencies(dependencyOverrides);
  const opened = openPinnedQueue(options, deps);
  const workerId = requireText(
    options.workerId || `worker-${process.pid}-${crypto.randomUUID()}`,
    "--worker-id",
  );
  const checkpointBroker = opened.authority.checkpoint.enabled
    ? new deps.CheckpointBroker({
        stateDir: opened.authority.checkpoint.stateDir,
        coverageTarget: "partial",
        writerIsolation: "unknown",
        externalSideEffects: true,
      })
    : null;
  const coordinator = coordinatorForAuthority(
    opened.repoRoot,
    opened.authority,
    deps,
    {
      checkpointBroker,
      onCheckpoint: checkpointBroker
        ? ({
            key,
            phase,
            checkpoint,
            worktree,
            verifiedCommitOid = null,
            lease,
          }) => {
            if (
              !lease?.holder ||
              !lease?.leaseId ||
              !Number.isSafeInteger(lease?.fencingToken)
            ) {
              fail(
                "TEAM_QUEUE_CHECKPOINT_LEASE_MISSING",
                `Task "${key}" has no checkpoint lease/fence binding`,
              );
            }
            const persisted = opened.queue.recordWorkspaceExecution(key, {
              holder: lease.holder,
              leaseId: lease.leaseId,
              fencingToken: lease.fencingToken,
              execution: {
                workerId,
                phase,
                checkpoint,
                worktree,
                verifiedCommitOid,
              },
            });
            if (!persisted.ok) {
              fail(
                "TEAM_QUEUE_CHECKPOINT_PERSIST_FAILED",
                `Could not persist checkpoint phase "${phase}" for task "${key}": ${persisted.reason}${
                  persisted.error ? ` (${persisted.error})` : ""
                }`,
                {
                  key,
                  phase,
                  reason: persisted.reason,
                  checkpoint,
                },
              );
            }
          }
        : null,
    },
  );
  const attempts = new Map();
  const registry = workerRegistry(opened.queue, workerId, {
    settlementForLease: (leaseId) => settlementAccessor(attempts, leaseId),
  });
  const runTask =
    opened.authority.mode === AGENT_WORKTREE_MODE
      ? makeDistributedAgentRunTask({
          opened,
          coordinator,
          deps,
          workerId,
          attempts,
        })
      : coordinator.makeRunTask();
  const events = [];
  const ttlMs =
    optionalPositive(options.ttlMs, "--ttl-ms", { integer: true }) ?? undefined;
  const renewEveryMs =
    optionalPositive(options.renewEveryMs, "--renew-every-ms", {
      integer: true,
    }) ?? undefined;
  const localMaxTasks =
    optionalPositive(options.maxTasks, "--max-tasks", { integer: true }) ??
    Number.MAX_SAFE_INTEGER;
  const pollMs =
    optionalPositive(options.pollMs, "--poll-ms", { integer: true }) ?? 250;
  let remainingExecutions = localMaxTasks;
  const summaries = [];
  const hasWallBudget = Number(opened.snapshot?.budget?.limits?.maxWallMs) > 0;
  // A runner exits when it sees no LOCAL in-flight work. In distributed mode
  // that may simply mean another process owns the dependency that will unlock
  // our next task. Keep observing the durable queue while a live lease exists,
  // then run another one-worker claim loop when the frontier advances.
  for (;;) {
    if (summaries.length > 0 && remainingExecutions <= 0) break;
    let queueStats = null;
    if (summaries.length > 0) {
      queueStats = opened.queue.stats();
      if (
        queueStats.completed + queueStats.cancelled === queueStats.total &&
        queueStats.adjudicationRequired === 0
      ) {
        break;
      }
      if (queueStats.budget?.reason || queueStats.adjudicationRequired > 0) {
        break;
      }
      // `claimable` and `leased` must come from the same durable queue
      // revision. A peer can claim between separate reads, and combining the
      // new claimable count with an older leased count would falsely report an
      // idle queue and make this worker exit while work is still in flight.
      if (queueStats.claimable === 0) {
        if (queueStats.leased > 0) {
          await deps.sleep(pollMs);
          continue;
        }
        break;
      }
    }
    if (hasWallBudget && queueStats == null) {
      queueStats = opened.queue.stats();
    }
    const runner = new deps.Runner(registry, {
      teammates: 1,
      ttlMs,
      renewEveryMs,
      maxTasks: remainingExecutions,
      budget:
        queueStats == null
          ? null
          : wallBudgetForQueueStats(queueStats, opened.queue, deps),
      emitHook: async () => {},
      beforeTask: ({ task }) => {
        importCompletedDependencies(coordinator, opened.queue, task);
        importRetryWorkspace(coordinator, task);
      },
      runTask,
      onEvent: (event) => events.push(event),
    });
    if (typeof deps.onRunner === "function") {
      await deps.onRunner(runner, {
        workerId,
        round: summaries.length,
        queue: opened.queue,
      });
    }
    const round = await runner.run();
    summaries.push(round);
    remainingExecutions -= round.executions;
    if (round.budgetStopped && round.executions === 0) break;
  }
  const status = distributedQueueStatus(options, deps);
  const lastSummary = summaries.at(-1);
  const done = distributedTasksDone(status.tasks);
  const durableBudgetReason = status.stats.budget?.reason || null;
  const durableStopReason = done ? null : durableBudgetReason;
  const localBudgetReason = lastSummary?.budgetReason || null;
  const summary = {
    ...lastSummary,
    done,
    success: done && status.stats.completed === status.stats.total,
    executions: summaries.reduce((total, round) => total + round.executions, 0),
    maxConcurrent: Math.max(
      0,
      ...summaries.map((round) => round.maxConcurrent || 0),
    ),
    rounds: summaries.length,
    budgetStopped:
      lastSummary?.budgetStopped === true || durableStopReason != null,
    budgetReason: localBudgetReason || durableStopReason,
    localBudgetReason,
    durableBudgetReason,
    stats: status.stats,
  };
  return {
    workerId,
    summary,
    queue: {
      queueId: status.queueId,
      revision: status.revision,
      stats: status.stats,
      pendingAdjudications: status.pendingAdjudications,
      interruptions: status.interruptions,
    },
    completed: status.tasks
      .filter((task) => task.status === "completed")
      .map((task) => ({ key: task.key, result: completedResult(task) })),
    events,
  };
}

function finalizationOperationId(snapshot, options) {
  if (options.operationId) {
    return requireText(options.operationId, "--operation-id");
  }
  const hash = crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        queueId: snapshot.queueId,
        graphDigest: snapshot.graphDigest,
        authorityDigest: snapshot.authorityDigest,
      }),
    )
    .digest("hex");
  return `finalize-${hash}`;
}

function gitHead(repoRoot, authority, deps) {
  let branch = null;
  try {
    branch =
      deps.git(repoRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"]) ||
      null;
  } catch {
    branch = null;
  }
  if (branch !== (authority.baseTarget.branch ?? null)) {
    fail(
      "TEAM_QUEUE_FINALIZE_GIT_DRIFT",
      `Finalization base branch changed from ${
        authority.baseTarget.branch || "detached HEAD"
      } to ${branch || "detached HEAD"}`,
    );
  }
  const commitOid = deps.git(repoRoot, ["rev-parse", "--verify", "HEAD"]);
  if (!/^[a-f0-9]{40,64}$/i.test(commitOid)) {
    fail(
      "TEAM_QUEUE_FINALIZE_GIT_DRIFT",
      "Finalization could not resolve a stable base HEAD",
    );
  }
  return commitOid.toLowerCase();
}

function isGitAncestor(repoRoot, ancestor, descendant, deps) {
  try {
    deps.git(repoRoot, ["merge-base", "--is-ancestor", ancestor, descendant]);
    return true;
  } catch {
    return false;
  }
}

function gitLines(repoRoot, args, deps) {
  const output = deps.git(repoRoot, args);
  return output ? output.split(/\r?\n/u).filter(Boolean) : [];
}

/**
 * Prove that HEAD after a dead finalizer is exactly the sequence that
 * coordinator.integrate({merge:true}) could have produced from its fenced
 * expected base. This accepts fast-forwards and the coordinator's exact merge
 * commits, while rejecting unrelated first-parent commits.
 */
function proveMergeRecovery(repoRoot, finalization, currentHead, deps) {
  const expectedBase = finalization.intent.expectedBaseOid;
  if (currentHead === expectedBase) return { ok: true, recoveredMerges: 0 };
  if (!isGitAncestor(repoRoot, expectedBase, currentHead, deps)) {
    return { ok: false, reason: "base_head_no_longer_descends_from_intent" };
  }
  const firstParentPath = gitLines(
    repoRoot,
    [
      "rev-list",
      "--first-parent",
      "--reverse",
      `${expectedBase}..${currentHead}`,
    ],
    deps,
  ).map((oid) => oid.toLowerCase());
  const records = finalization.coordinator.records || [];
  let cursor = expectedBase;
  let pathIndex = 0;
  let recoveredMerges = 0;

  for (const record of records) {
    if (record.committed !== true) continue;
    const branchOid = String(record.commitOid).toLowerCase();
    if (isGitAncestor(repoRoot, branchOid, cursor, deps)) continue;

    const fastForwardIndex = firstParentPath.indexOf(branchOid, pathIndex);
    if (fastForwardIndex >= pathIndex) {
      const segment = firstParentPath.slice(pathIndex, fastForwardIndex + 1);
      if (
        isGitAncestor(repoRoot, cursor, branchOid, deps) &&
        segment.every((oid) => isGitAncestor(repoRoot, oid, branchOid, deps))
      ) {
        cursor = branchOid;
        pathIndex = fastForwardIndex + 1;
        recoveredMerges += 1;
        continue;
      }
    }

    const mergeOid = firstParentPath[pathIndex];
    if (!mergeOid) {
      return { ok: false, reason: `missing_merge_for_${record.key}` };
    }
    const commit = gitLines(
      repoRoot,
      ["rev-list", "--parents", "-n", "1", mergeOid],
      deps,
    )[0]?.split(/\s+/u);
    const subject = deps.git(repoRoot, ["show", "-s", "--format=%s", mergeOid]);
    if (
      !commit ||
      commit[1]?.toLowerCase() !== cursor ||
      !commit
        .slice(2)
        .map((oid) => oid.toLowerCase())
        .includes(branchOid) ||
      subject !== `Merge team task ${record.key}`
    ) {
      return { ok: false, reason: `unexpected_merge_commit_${mergeOid}` };
    }
    cursor = mergeOid;
    pathIndex += 1;
    recoveredMerges += 1;
  }
  if (cursor !== currentHead || pathIndex !== firstParentPath.length) {
    return { ok: false, reason: "unaccounted_first_parent_commits" };
  }
  return { ok: true, recoveredMerges };
}

function coordinatorWithCompletedResults(opened, tasks, deps) {
  const coordinator = coordinatorForAuthority(
    opened.repoRoot,
    opened.authority,
    deps,
  );
  const remaining = new Map(tasks.map((task) => [task.key, task]));
  while (remaining.size > 0) {
    let progressed = false;
    for (const [key, task] of [...remaining]) {
      if (
        (task.dependsOn || []).some((dependency) => remaining.has(dependency))
      ) {
        continue;
      }
      const result = completedResult(task);
      if (!result) {
        fail(
          "TEAM_QUEUE_RESULT_MISSING",
          `Completed task "${key}" has no durable worktree result`,
        );
      }
      coordinator.registerCompletedDependency(key, result);
      remaining.delete(key);
      progressed = true;
    }
    if (!progressed) {
      fail(
        "TEAM_QUEUE_INVALID_GRAPH",
        "Distributed queue result graph is cyclic",
      );
    }
  }
  return coordinator;
}

function finalizationGitAuthority(opened, tasks, coordinator, deps) {
  return {
    baseBranch: opened.authority.baseTarget.branch ?? null,
    initialBaseOid: opened.authority.baseTarget.commitOid,
    currentBaseOid: gitHead(opened.repoRoot, opened.authority, deps),
    branches: tasks
      .map((task) => {
        const result = completedResult(task);
        return {
          key: task.key,
          branch: result.branch,
          commitOid: result.commitOid,
          worktreePath: result.worktreePath,
        };
      })
      .sort((left, right) => left.key.localeCompare(right.key)),
    coordinator: coordinator.snapshot(),
  };
}

function finalizationLeaseOptions(finalization, operationId, owner) {
  if (!finalization.lease) {
    fail(
      "TEAM_QUEUE_FINALIZE_LEASE_LOST",
      `Finalization phase "${finalization.phase}" has no active lease`,
    );
  }
  return {
    operationId,
    owner,
    leaseId: finalization.lease.leaseId,
    fencingToken: finalization.lease.fencingToken,
    expectedPhase: finalization.phase,
    expectedRevision: finalization.revision,
  };
}

function requireFinalizationMutation(result, action) {
  if (!result?.ok) {
    fail(
      "TEAM_QUEUE_FINALIZE_STATE_REJECTED",
      `Could not persist finalization ${action}: ${
        result?.reason || "unknown reason"
      }${result?.error ? ` (${result.error})` : ""}`,
      result,
    );
  }
  return result.finalization;
}

function finalizationOutput(opened, finalization, extra = {}) {
  return {
    queueId: opened.snapshot.queueId,
    runId: opened.runId,
    preview: finalization.result.preview || [],
    merged: finalization.phase === "completed",
    integration:
      finalization.result.integration || finalization.result.preview || [],
    cleanup: finalization.result.cleanup || [],
    worktrees: finalization.coordinator,
    finalization,
    ...extra,
  };
}

function verifyFinalizationBranchRefs(opened, finalization, deps) {
  for (const binding of finalization.git.branches) {
    let current;
    try {
      current = deps
        .git(opened.repoRoot, ["rev-parse", "--verify", binding.branch])
        .toLowerCase();
    } catch {
      fail(
        "TEAM_QUEUE_FINALIZE_GIT_DRIFT",
        `Finalization branch "${binding.branch}" is missing`,
      );
    }
    if (current !== binding.commitOid) {
      fail(
        "TEAM_QUEUE_FINALIZE_GIT_DRIFT",
        `Finalization branch "${binding.branch}" moved after it was fenced`,
      );
    }
  }
}

export function finalizeDistributedQueue(options, dependencyOverrides = {}) {
  const deps = defaultDependencies(dependencyOverrides);
  const opened = openPinnedQueue(options, deps);
  const tasks = opened.queue.list();
  const pendingAdjudications = opened.queue.pendingAdjudications();
  const unfinished = tasks.filter((task) => task.status !== "completed");
  if (pendingAdjudications.length > 0 || unfinished.length > 0) {
    const keys = [
      ...new Set([
        ...pendingAdjudications.map((item) => item.key),
        ...unfinished.map((item) => item.key),
      ]),
    ];
    fail(
      "TEAM_QUEUE_FINALIZE_BLOCKED",
      `Distributed queue cannot finalize while tasks require work or adjudication: ${keys.join(", ")}. Inspect with \`cc team queue status\`; resolve adjudication before retrying finalize.`,
      { keys, pendingAdjudications },
    );
  }
  const operationId = finalizationOperationId(opened.snapshot, options);
  const owner = requireText(
    options.finalizerId || `finalizer-${process.pid}`,
    "--finalizer-id",
  );
  const ttlMs =
    optionalPositive(options.ttlMs, "--ttl-ms", { integer: true }) ?? undefined;
  const requestedMode = options.merge === true ? "merge" : "preview";
  let persisted = opened.queue.getFinalization();
  let coordinator = null;
  let git = persisted.git;
  let coordinatorSnapshot = persisted.coordinator;

  if (persisted.phase === "idle") {
    coordinator = coordinatorWithCompletedResults(opened, tasks, deps);
    const authority = finalizationGitAuthority(
      opened,
      tasks,
      coordinator,
      deps,
    );
    coordinatorSnapshot = authority.coordinator;
    delete authority.coordinator;
    git = authority;
  }

  let begun = opened.queue.beginFinalization({
    operationId,
    owner,
    mode: requestedMode,
    ttlMs,
    git,
    coordinator: coordinatorSnapshot,
  });
  if (!begun.ok && begun.takeoverRequired === true) {
    begun = opened.queue.takeoverFinalization({
      operationId,
      owner,
      ttlMs,
      reason: `resuming ${begun.phase || "unknown"} after unavailable finalizer`,
    });
  }
  if (!begun.ok) {
    const code =
      begun.reason === "finalization_busy"
        ? "TEAM_QUEUE_FINALIZE_BUSY"
        : "TEAM_QUEUE_FINALIZE_DRIFT";
    fail(
      code,
      `Distributed finalization could not start: ${begun.reason}${
        begun.error ? ` (${begun.error})` : ""
      }`,
      begun,
    );
  }
  persisted = begun.finalization;
  verifyFinalizationBranchRefs(opened, persisted, deps);

  if (persisted.phase === "blocked") {
    fail(
      "TEAM_QUEUE_INTEGRATION_CONFLICT",
      persisted.blocked?.message ||
        "Distributed queue finalization is durably blocked",
      finalizationOutput(opened, persisted),
    );
  }
  if (persisted.phase === "completed") {
    const head = gitHead(opened.repoRoot, opened.authority, deps);
    if (head !== persisted.git.currentBaseOid) {
      fail(
        "TEAM_QUEUE_FINALIZE_GIT_DRIFT",
        "Completed finalization base HEAD moved after cleanup",
      );
    }
    return finalizationOutput(opened, persisted, { idempotent: true });
  }

  coordinator =
    coordinator ||
    coordinatorForAuthority(opened.repoRoot, opened.authority, deps, {
      snapshot: persisted.coordinator,
    });

  const leaseOptions = () =>
    finalizationLeaseOptions(persisted, operationId, owner);
  const renewFinalizationLease = (progress = null) => {
    const lease = persisted.lease;
    if (!lease) {
      fail(
        "TEAM_QUEUE_FINALIZE_LEASE_LOST",
        `Finalization phase "${persisted.phase}" no longer has an active lease`,
        { progress, finalization: persisted },
      );
    }
    const renewed = opened.queue.renewFinalization({
      operationId,
      owner,
      leaseId: lease.leaseId,
      fencingToken: lease.fencingToken,
      ttlMs,
      progress,
    });
    if (!renewed.ok) {
      fail(
        "TEAM_QUEUE_FINALIZE_LEASE_LOST",
        `Could not renew distributed finalization lease: ${renewed.reason}${
          renewed.error ? ` (${renewed.error})` : ""
        }`,
        { progress, renewal: renewed, finalization: persisted },
      );
    }
    // Renewal increments the durable CAS revision. Keep the live coordinator:
    // its per-worktree progress is intentionally persisted by the next phase
    // transition, while the queue snapshot still carries the pre-phase copy.
    persisted = renewed.finalization;
  };
  const persistPhase = (toPhase, fields, suffix) => {
    const expectedCoordinator = fields.coordinator || coordinator.snapshot();
    const result = opened.queue.recordFinalizationPhase({
      ...leaseOptions(),
      transitionId: `${operationId}:${suffix}`,
      toPhase,
      ...fields,
    });
    persisted = requireFinalizationMutation(result, suffix);
    if (
      canonicalDigest(expectedCoordinator) !==
      canonicalDigest(persisted.coordinator)
    ) {
      fail(
        "TEAM_QUEUE_FINALIZE_DRIFT",
        `Persisted coordinator changed while recording finalization phase "${toPhase}"`,
      );
    }
    return persisted;
  };
  const persistBlocked = (code, message, details = {}) => {
    const result = opened.queue.recordFinalizationPhase({
      ...leaseOptions(),
      transitionId: `${operationId}:blocked:${persisted.revision}`,
      toPhase: "blocked",
      coordinator: coordinator.snapshot(),
      currentBaseOid:
        details.currentBaseOid ||
        gitHead(opened.repoRoot, opened.authority, deps),
      result: details.result || undefined,
      block: {
        code,
        message,
        evidenceDigest: details.evidenceDigest || null,
      },
    });
    persisted = requireFinalizationMutation(result, "blocked result");
    fail(code, message, finalizationOutput(opened, persisted, details));
  };
  const persistRecovery = (error, result = null) => {
    const message = error instanceof Error ? error.message : String(error);
    const recovery = opened.queue.recordFinalizationPhase({
      ...leaseOptions(),
      transitionId: `${operationId}:recovery:${persisted.phase}:${persisted.revision}`,
      toPhase: "recovery_required",
      coordinator: coordinator.snapshot(),
      currentBaseOid: gitHead(opened.repoRoot, opened.authority, deps),
      result: result || undefined,
      recoveryReason: message,
    });
    persisted = requireFinalizationMutation(recovery, "recovery requirement");
    fail(
      "TEAM_QUEUE_FINALIZE_RECOVERY_REQUIRED",
      `Distributed finalization requires a fenced recovery retry: ${message}`,
      finalizationOutput(opened, persisted),
    );
  };

  const recoveryFrom =
    persisted.phase === "recovery_required"
      ? persisted.recovery?.fromPhase
      : null;
  if (persisted.phase === "previewing" || recoveryFrom === "previewing") {
    let preview;
    try {
      renewFinalizationLease({ phase: "previewing", timing: "start" });
      const expectedHead = persisted.intent.expectedBaseOid;
      if (gitHead(opened.repoRoot, opened.authority, deps) !== expectedHead) {
        persistBlocked(
          "TEAM_QUEUE_FINALIZE_GIT_DRIFT",
          "Base HEAD moved after preview intent was persisted",
        );
      }
      preview = coordinator.integrate({
        merge: false,
        onProgress: renewFinalizationLease,
      });
      const currentHead = gitHead(opened.repoRoot, opened.authority, deps);
      if (currentHead !== expectedHead) {
        persistBlocked(
          "TEAM_QUEUE_FINALIZE_GIT_DRIFT",
          "Base HEAD moved while previewing distributed worktrees",
          { currentBaseOid: currentHead, result: { preview } },
        );
      }
      if (preview.some((item) => item.error || item.clean !== true)) {
        persistBlocked(
          "TEAM_QUEUE_INTEGRATION_CONFLICT",
          "Distributed queue merge preview is not clean; worktrees were retained",
          { currentBaseOid: currentHead, result: { preview } },
        );
      }
      persistPhase(
        "previewed",
        {
          coordinator: coordinator.snapshot(),
          currentBaseOid: currentHead,
          result: { preview },
          releaseLease: requestedMode === "preview",
        },
        "previewed",
      );
    } catch (error) {
      if (error instanceof TeamDistributedCliError) throw error;
      persistRecovery(error, preview ? { preview } : null);
    }
  }

  if (persisted.phase === "previewed") {
    if (requestedMode === "preview") {
      return finalizationOutput(opened, persisted);
    }
    const currentHead = gitHead(opened.repoRoot, opened.authority, deps);
    if (currentHead !== persisted.git.currentBaseOid) {
      persistBlocked(
        "TEAM_QUEUE_FINALIZE_GIT_DRIFT",
        "Base HEAD moved after the durable merge preview",
        { currentBaseOid: currentHead },
      );
    }
    persistPhase(
      "merging",
      {
        coordinator: coordinator.snapshot(),
        currentBaseOid: currentHead,
        intentKind: "merge",
      },
      "merging",
    );
  }

  const mergeRecovery =
    persisted.phase === "recovery_required" &&
    persisted.recovery?.fromPhase === "merging";
  if (persisted.phase === "merging" || mergeRecovery) {
    let integration;
    try {
      renewFinalizationLease({ phase: "merging", timing: "start" });
      const currentHead = gitHead(opened.repoRoot, opened.authority, deps);
      const proof = mergeRecovery
        ? proveMergeRecovery(opened.repoRoot, persisted, currentHead, deps)
        : {
            ok: currentHead === persisted.intent.expectedBaseOid,
            reason: "base_head_moved_before_merge",
          };
      if (!proof.ok) {
        persistBlocked(
          "TEAM_QUEUE_FINALIZE_GIT_DRIFT",
          `Cannot prove the fenced merge recovery: ${proof.reason}`,
          { currentBaseOid: currentHead },
        );
      }
      integration = coordinator.integrate({
        merge: true,
        onProgress: renewFinalizationLease,
      });
      const mergedHead = gitHead(opened.repoRoot, opened.authority, deps);
      const mergeFailed = integration.some(
        (item) =>
          item.error ||
          item.clean !== true ||
          (item.committed === true && item.merged !== true),
      );
      if (mergeFailed) {
        persistBlocked(
          "TEAM_QUEUE_INTEGRATION_CONFLICT",
          "Distributed queue merge failed closed; worktrees were retained",
          {
            currentBaseOid: mergedHead,
            result: { integration },
          },
        );
      }
      persistPhase(
        "merged",
        {
          coordinator: coordinator.snapshot(),
          currentBaseOid: mergedHead,
          result: { integration },
        },
        "merged",
      );
    } catch (error) {
      if (error instanceof TeamDistributedCliError) throw error;
      persistRecovery(error, integration ? { integration } : null);
    }
  }

  if (persisted.phase === "merged") {
    try {
      renewFinalizationLease({ phase: "merged", timing: "start" });
      coordinator.prepareCleanupAll({
        requireMerged: true,
        onProgress: renewFinalizationLease,
      });
      persistPhase(
        "cleanup_prepared",
        {
          coordinator: coordinator.snapshot(),
          currentBaseOid: gitHead(opened.repoRoot, opened.authority, deps),
        },
        "cleanup-prepared",
      );
    } catch (error) {
      if (error instanceof TeamDistributedCliError) throw error;
      persistBlocked(
        "TEAM_QUEUE_CLEANUP_PREPARE_FAILED",
        `Could not durably prepare distributed worktree cleanup: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  if (persisted.phase === "cleanup_prepared") {
    persistPhase(
      "cleaning",
      {
        coordinator: coordinator.snapshot(),
        currentBaseOid: gitHead(opened.repoRoot, opened.authority, deps),
        intentKind: "cleanup",
      },
      "cleaning",
    );
  }

  const cleanupRecovery =
    persisted.phase === "recovery_required" &&
    persisted.recovery?.fromPhase === "cleaning";
  if (persisted.phase === "cleaning" || cleanupRecovery) {
    let cleanup;
    try {
      renewFinalizationLease({ phase: "cleaning", timing: "start" });
      const currentHead = gitHead(opened.repoRoot, opened.authority, deps);
      if (currentHead !== persisted.intent.expectedBaseOid) {
        persistBlocked(
          "TEAM_QUEUE_FINALIZE_GIT_DRIFT",
          "Base HEAD moved after cleanup intent was persisted",
          { currentBaseOid: currentHead },
        );
      }
      cleanup = coordinator.cleanupAll({
        deleteBranch: false,
        onProgress: renewFinalizationLease,
      });
      if (cleanup.some((item) => item.ok !== true)) {
        persistRecovery(
          new Error("one or more distributed worktrees could not be cleaned"),
          { cleanup },
        );
      }
      const completed = opened.queue.completeFinalization({
        ...leaseOptions(),
        transitionId: `${operationId}:completed`,
        coordinator: coordinator.snapshot(),
        cleanup,
        currentBaseOid: gitHead(opened.repoRoot, opened.authority, deps),
      });
      persisted = requireFinalizationMutation(completed, "completion");
    } catch (error) {
      if (error instanceof TeamDistributedCliError) throw error;
      persistRecovery(error, cleanup ? { cleanup } : null);
    }
  }

  return finalizationOutput(opened, persisted);
}

function emitResult(result, options, log) {
  if (options.json) {
    (log.log || console.log)(JSON.stringify(result, null, 2));
    return;
  }
  (log.log || console.log)(`Distributed queue ${result.queueId || ""}`.trim());
  if (result.stats) {
    (log.log || console.log)(
      `  ${result.stats.completed}/${result.stats.total} completed, ${result.stats.leased} leased`,
    );
  }
}

function action(handler, log) {
  return async (options) => {
    try {
      const result = await handler(options);
      emitResult(result, options, log);
    } catch (error) {
      (log.error || console.error)(
        `${error.code ? `${error.code}: ` : ""}${error.message}`,
      );
      if (error.details && options.json) {
        (log.error || console.error)(JSON.stringify(error.details, null, 2));
      }
      process.exitCode = 1;
    }
  };
}

function commonAuthorityOptions(command) {
  return command
    .requiredOption("--state <file>", "Queue state outside the repository")
    .requiredOption("--run-id <id>", "Pinned distributed run id")
    .option("--repo <dir>", "Repository (defaults to current repository)")
    .option("--queue-id <id>", "Pinned queue id")
    .option("--authority-digest <sha256>", "Pinned authority digest")
    .option("--json", "Output JSON");
}

/** Register beneath the existing `cc team` Commander command. */
export function registerTeamDistributedCommands(
  team,
  { logger, agentExecutor = null, buildAgentPrompt = null } = {},
) {
  const log = logger || console;
  const agentDependencies = {
    agentExecutor,
    buildAgentPrompt: buildAgentPrompt || ((prompt) => prompt),
  };
  const queue = team
    .command("queue")
    .description("Coordinate durable multi-process worktree teammates");

  commonAuthorityOptions(
    queue
      .command("init")
      .description("Create a pinned distributed task queue")
      .requiredOption("--tasks <file>", "Task graph JSON")
      .option(
        "--mode <mode>",
        "shell-worktree or agent-worktree",
        SHELL_WORKTREE_MODE,
      )
      .option("--max-tasks <n>", "Global task-attempt cap")
      .option("--max-tokens <n>", "Global token cap")
      .option("--max-usd <amount>", "Global USD cap")
      .option("--max-wall-ms <ms>", "Global wall-clock cap")
      .option("--model <model>", "Pinned model for agent-worktree tasks")
      .option(
        "--permission-mode <mode>",
        "Pinned permission mode for agent-worktree tasks",
        "acceptEdits",
      )
      .option("--agent-max-turns <n>", "Per-Agent turn cap")
      .option("--agent-max-tokens <n>", "Per-Agent token cap")
      .option("--agent-max-budget-usd <amount>", "Per-Agent USD cap")
      .option("--agent-max-wall-ms <ms>", "Per-Agent wall-clock cap")
      .option(
        "--managed-checkpoint",
        "Capture each task worktree in a Process Broker checkpoint",
      )
      .option(
        "--checkpoint-state-dir <dir>",
        "External checkpoint store (defaults beside --state)",
      )
      .option("--ttl-ms <ms>", "Lease TTL"),
  ).action(action(initDistributedQueue, log));

  commonAuthorityOptions(
    queue
      .command("status")
      .description("Inspect a pinned distributed queue")
      .option("--mode <mode>", "Verify the pinned execution mode"),
  ).action(action(distributedQueueStatus, log));

  commonAuthorityOptions(
    queue
      .command("interrupt")
      .description("Interrupt one exact leased distributed task attempt")
      .requiredOption("--task <key>", "Pinned task key")
      .requiredOption("--holder <id>", "Expected lease holder")
      .requiredOption("--lease-id <id>", "Expected lease id")
      .requiredOption("--fencing-token <n>", "Expected fencing token")
      .requiredOption("--request-id <id>", "Globally stable interrupt id")
      .option("--actor <name>", "Interrupting operator", "human")
      .option("--reason <text>", "Durable interrupt reason"),
  ).action(action(interruptDistributedQueue, log));

  commonAuthorityOptions(
    queue
      .command("recover")
      .description("Recover and reconcile one abandoned managed checkpoint")
      .requiredOption("--task <key>", "Pinned task key")
      .requiredOption("--recovery-id <id>", "Globally stable recovery id")
      .requiredOption(
        "--evidence-digest <sha256>",
        "Pinned abandonment evidence digest",
      )
      .option("--actor <name>", "Recovery operator", "recovery")
      .option("--reason <text>", "Durable recovery reason")
      .option(
        "--repair-git-baseline",
        "Reset only the exact proven abandoned task commit to its baseline",
      ),
  ).action(action(recoverDistributedQueueCheckpoint, log));

  commonAuthorityOptions(
    queue
      .command("adjudicate")
      .description("Resolve one evidence-pinned distributed task outcome")
      .requiredOption("--task <key>", "Pinned task key")
      .requiredOption("--decision <action>", "retry, accept, or cancel")
      .requiredOption("--decision-id <id>", "Globally stable decision id")
      .requiredOption(
        "--evidence-digest <sha256>",
        "Pinned abandonment evidence digest",
      )
      .option("--actor <name>", "Adjudicating operator", "human")
      .option("--reason <text>", "Durable adjudication reason"),
  ).action(action(adjudicateDistributedQueue, log));

  commonAuthorityOptions(
    queue
      .command("worker")
      .description("Run claimable shell or Agent tasks in isolated worktrees")
      .option("--worker-id <id>", "Stable process worker id")
      .option("--mode <mode>", "Verify the pinned execution mode")
      .option("--ttl-ms <ms>", "Lease TTL")
      .option("--renew-every-ms <ms>", "Lease heartbeat interval")
      .option("--max-tasks <n>", "Local execution cap")
      .option(
        "--managed-checkpoint",
        "Require the queue's pinned managed checkpoint authority",
      )
      .option(
        "--checkpoint-state-dir <dir>",
        "Verify the queue's pinned external checkpoint store",
      )
      .option("--agent", "Require pinned agent-worktree authority"),
  ).action(
    action((options) => runDistributedWorker(options, agentDependencies), log),
  );

  commonAuthorityOptions(
    queue
      .command("finalize")
      .description("Preview completed branches and optionally merge them")
      .option("--mode <mode>", "Verify the pinned execution mode")
      .option("--merge", "Merge only after a clean preview")
      .option("--operation-id <id>", "Stable finalization operation id")
      .option("--finalizer-id <id>", "Stable finalizer owner id")
      .option("--ttl-ms <ms>", "Finalization lease TTL"),
  ).action(action(finalizeDistributedQueue, log));

  return queue;
}
