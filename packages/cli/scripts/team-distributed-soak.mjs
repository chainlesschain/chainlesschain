#!/usr/bin/env node

import { execFileSync, spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const workerPath = path.join(
  scriptDirectory,
  "team-distributed-soak-worker.mjs",
);
const repositoryRoot = path.resolve(scriptDirectory, "../../..");
const activeChildren = new Set();
const MIB = 1024 * 1024;
const SOURCE_OVERRIDE_ROOTS = [
  "packages/cli/bin",
  "packages/cli/scripts",
  "packages/cli/src",
  "packages/agent-sdk/src",
];
let adjudicateDistributedQueue;
let distributedQueueStatus;
let finalizeDistributedQueue;
let initDistributedQueue;
let TeamDistributedQueue;
let TeamProcessCheckpointBroker;
let stopBackgroundAgentChildTree;
let executionBroker;
let runtimeModulesPromise;

export async function loadSoakRuntimeModules() {
  runtimeModulesPromise ||= Promise.all([
    import("../src/commands/team-distributed.js"),
    import("../src/lib/agent-team/team-distributed-queue.js"),
    import("../src/lib/agent-team/team-process-checkpoint.js"),
    import("../src/lib/background-agent-supervisor.js"),
    import("../src/lib/process-execution-broker/index.js"),
  ]).then(([commands, queue, checkpoint, supervisor, broker]) => {
    adjudicateDistributedQueue = commands.adjudicateDistributedQueue;
    distributedQueueStatus = commands.distributedQueueStatus;
    finalizeDistributedQueue = commands.finalizeDistributedQueue;
    initDistributedQueue = commands.initDistributedQueue;
    TeamDistributedQueue = queue.TeamDistributedQueue;
    TeamProcessCheckpointBroker = checkpoint.TeamProcessCheckpointBroker;
    stopBackgroundAgentChildTree = supervisor.stopBackgroundAgentChildTree;
    executionBroker = broker.default;
  });
  await runtimeModulesPromise;
}

function sanitizeGitEnvironment(environment) {
  for (const key of Object.keys(environment)) {
    if (/^GIT_/iu.test(key)) delete environment[key];
  }
  environment.GIT_OPTIONAL_LOCKS = "0";
  environment.GIT_TERMINAL_PROMPT = "0";
  return environment;
}

function safeGitEnvironment(environment = process.env, extraEnvironment = {}) {
  const sanitized = {};
  for (const [key, value] of Object.entries(environment)) {
    if (!/^GIT_/iu.test(key)) sanitized[key] = value;
  }
  return {
    ...sanitized,
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0",
    ...extraEnvironment,
  };
}

function safeGitArguments(repo, args) {
  const safeDirectory = path.resolve(repo).replaceAll("\\", "/");
  return [
    "-c",
    `safe.directory=${safeDirectory}`,
    "-c",
    "core.fsmonitor=false",
    ...args,
  ];
}

function readArgument(argv, index) {
  const argument = argv[index];
  const separator = argument.indexOf("=");
  if (separator >= 0) {
    return {
      name: argument.slice(0, separator),
      value: argument.slice(separator + 1),
      consumed: 1,
    };
  }
  return {
    name: argument,
    value: argv[index + 1],
    consumed: 2,
  };
}

function positiveNumber(value, label, { integer = false, minimum = 0 } = {}) {
  const parsed = Number(value);
  if (
    !Number.isFinite(parsed) ||
    parsed <= 0 ||
    parsed < minimum ||
    (integer && !Number.isSafeInteger(parsed))
  ) {
    throw new TypeError(`${label} must be a positive number >= ${minimum}`);
  }
  return parsed;
}

function optionalPositiveInteger(value, label) {
  if (value == null || value === "") return null;
  return positiveNumber(value, label, { integer: true, minimum: 1 });
}

function unsignedInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 0xffffffff) {
    throw new TypeError(`${label} must be an unsigned 32-bit integer`);
  }
  return parsed >>> 0;
}

function booleanOption(value, label) {
  if (value == null || value === "") return false;
  if (value === true || value === "1" || value === "true") return true;
  if (value === false || value === "0" || value === "false") return false;
  throw new TypeError(`${label} must be true/false or 1/0`);
}

function parseOptions(argv, environment) {
  const envMinutes = environment.CC_TEAM_SOAK_DURATION_MINUTES;
  const envMilliseconds = environment.CC_TEAM_SOAK_DURATION_MS;
  const options = {
    durationMs:
      envMilliseconds != null
        ? positiveNumber(envMilliseconds, "CC_TEAM_SOAK_DURATION_MS", {
            integer: true,
            minimum: 250,
          })
        : envMinutes != null
          ? positiveNumber(envMinutes, "CC_TEAM_SOAK_DURATION_MINUTES", {
              minimum: 0.01,
            }) * 60_000
          : 5_000,
    workers: positiveNumber(
      environment.CC_TEAM_SOAK_WORKERS || 2,
      "worker count",
      { integer: true, minimum: 2 },
    ),
    tasks: positiveNumber(environment.CC_TEAM_SOAK_TASKS || 6, "task count", {
      integer: true,
      minimum: 5,
    }),
    crashes: positiveNumber(
      environment.CC_TEAM_SOAK_CRASHES || 2,
      "crash count",
      { integer: true, minimum: 1 },
    ),
    ttlMs: positiveNumber(environment.CC_TEAM_SOAK_TTL_MS || 60_000, "TTL", {
      integer: true,
      minimum: 1_000,
    }),
    taskDelayMs: positiveNumber(
      environment.CC_TEAM_SOAK_TASK_DELAY_MS || 5,
      "task delay",
      { integer: true, minimum: 1 },
    ),
    maxRssMb: positiveNumber(
      environment.CC_TEAM_SOAK_MAX_RSS_MB || 1_024,
      "maximum RSS",
      { minimum: 128 },
    ),
    maxRssGrowthMb: positiveNumber(
      environment.CC_TEAM_SOAK_MAX_RSS_GROWTH_MB || 256,
      "maximum RSS trend growth",
      { minimum: 32 },
    ),
    seed: unsignedInteger(environment.CC_TEAM_SOAK_SEED || 0x5eed2026, "seed"),
    output: path.resolve(
      environment.CC_TEAM_SOAK_OUTPUT ||
        path.join(
          os.tmpdir(),
          `cc-team-soak-result-${process.pid}-${crypto.randomUUID()}.json`,
        ),
    ),
    expectedSha: environment.CC_TEAM_SOAK_EXPECTED_SHA || null,
    maxRounds: optionalPositiveInteger(
      environment.CC_TEAM_SOAK_MAX_ROUNDS,
      "maximum rounds",
    ),
    requireManagedAgent: booleanOption(
      environment.CC_TEAM_SOAK_REQUIRE_MANAGED_AGENT,
      "CC_TEAM_SOAK_REQUIRE_MANAGED_AGENT",
    ),
    verifySourceOnly: false,
  };

  for (let index = 0; index < argv.length;) {
    if (argv[index] === "--help" || argv[index] === "-h") {
      options.help = true;
      index += 1;
      continue;
    }
    if (argv[index] === "--verify-source-only") {
      options.verifySourceOnly = true;
      index += 1;
      continue;
    }
    const parsed = readArgument(argv, index);
    if (parsed.value == null || parsed.value === "") {
      throw new TypeError(`${parsed.name} requires a value`);
    }
    switch (parsed.name) {
      case "--duration-ms":
        options.durationMs = positiveNumber(parsed.value, "duration", {
          integer: true,
          minimum: 250,
        });
        break;
      case "--duration-minutes":
        options.durationMs =
          positiveNumber(parsed.value, "duration", { minimum: 0.01 }) * 60_000;
        break;
      case "--workers":
        options.workers = positiveNumber(parsed.value, "worker count", {
          integer: true,
          minimum: 2,
        });
        break;
      case "--tasks":
        options.tasks = positiveNumber(parsed.value, "task count", {
          integer: true,
          minimum: 5,
        });
        break;
      case "--crashes":
        options.crashes = positiveNumber(parsed.value, "crash count", {
          integer: true,
          minimum: 1,
        });
        break;
      case "--ttl-ms":
        options.ttlMs = positiveNumber(parsed.value, "TTL", {
          integer: true,
          minimum: 1_000,
        });
        break;
      case "--task-delay-ms":
        options.taskDelayMs = positiveNumber(parsed.value, "task delay", {
          integer: true,
          minimum: 1,
        });
        break;
      case "--max-rss-mb":
        options.maxRssMb = positiveNumber(parsed.value, "maximum RSS", {
          minimum: 128,
        });
        break;
      case "--max-rss-growth-mb":
        options.maxRssGrowthMb = positiveNumber(
          parsed.value,
          "maximum RSS trend growth",
          { minimum: 32 },
        );
        break;
      case "--seed":
        options.seed = unsignedInteger(parsed.value, "seed");
        break;
      case "--output":
        options.output = path.resolve(parsed.value);
        break;
      case "--expected-sha":
        options.expectedSha = parsed.value;
        break;
      case "--max-rounds":
        options.maxRounds = positiveNumber(parsed.value, "maximum rounds", {
          integer: true,
          minimum: 1,
        });
        break;
      case "--require-managed-agent":
        options.requireManagedAgent = booleanOption(
          parsed.value,
          "require managed Agent",
        );
        break;
      default:
        throw new TypeError(`unknown option: ${parsed.name}`);
    }
    index += parsed.consumed;
  }

  if (
    options.expectedSha != null &&
    !/^[a-f0-9]{40,64}$/i.test(options.expectedSha)
  ) {
    throw new TypeError(
      "expected SHA must be a full 40-64 digit hex commit ID",
    );
  }
  if (options.expectedSha != null) {
    options.expectedSha = options.expectedSha.toLowerCase();
  }
  if (options.verifySourceOnly && options.expectedSha == null) {
    throw new TypeError("--verify-source-only requires --expected-sha");
  }
  if (
    options.expectedSha != null &&
    isPathInside(repositoryRoot, options.output)
  ) {
    throw new TypeError(
      "an exact-SHA soak report must be written outside the calling repository",
    );
  }
  if (options.crashes > 2) {
    throw new TypeError(
      "crash count must be 1 or 2 so the pinned three-attempt queue can still complete",
    );
  }
  return options;
}

function printHelp() {
  process.stdout.write(`Usage: node team-distributed-soak.mjs [options]

Runs real Git worktrees, durable multi-process queue workers, a Process Broker
managed-process capability probe, deterministic local Agent
contract/worktree/checkpoint turns, and fenced finalize. No network or live
model is used.

Options:
  --duration-ms <n>          Local duration in milliseconds (default 5000)
  --duration-minutes <n>     CI duration in minutes
  --workers <n>              Concurrent OS worker processes (default 2)
  --tasks <n>                Real DAG worktrees per round (default 6)
  --crashes <n>              Injected pre-execution worker exits (default 2)
  --ttl-ms <n>               Worker lease TTL (default 60000)
  --task-delay-ms <n>        Deterministic Agent delay (default 5)
  --max-rss-mb <n>           Per-process RSS ceiling (default 1024)
  --max-rss-growth-mb <n>    Tail RSS trend ceiling (default 256)
  --seed <n>                 Reproducible unsigned 32-bit seed
  --max-rounds <n>           Optional deterministic round cap
  --require-managed-agent <boolean>
                             Require the managed-process capability probe
  --expected-sha <sha>       Fail unless checkout HEAD is this exact full SHA
                             and controlled worktree bytes/modes match it
  --verify-source-only       Verify exact-SHA source evidence, then exit
  --output <path>            JSON result path
`);
}

function isPathInside(parentPath, candidatePath) {
  const relative = path.relative(
    path.resolve(parentPath),
    path.resolve(candidatePath),
  );
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function gitCommand(
  args,
  {
    encoding = "utf8",
    input,
    maxBuffer = 64 * MIB,
    root = repositoryRoot,
  } = {},
) {
  const result = spawnSync("git", safeGitArguments(root, args), {
    cwd: root,
    encoding,
    env: safeGitEnvironment(),
    input,
    maxBuffer,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed: ${
        result.error?.message ||
        (Buffer.isBuffer(result.stderr)
          ? result.stderr.toString("utf8").trim()
          : result.stderr?.trim()) ||
        `exit ${result.status}`
      }`,
    );
  }
  return result.stdout;
}

function nullDelimitedGitPaths(args, root = repositoryRoot) {
  const output = gitCommand(args, { encoding: null, root });
  const paths = [];
  for (let offset = 0; offset < output.length;) {
    const end = output.indexOf(0, offset);
    if (end < 0) {
      throw new Error(`git ${args[0]} emitted an unterminated path`);
    }
    if (end > offset) {
      const rawPath = output.subarray(offset, end);
      const decodedPath = rawPath.toString("utf8");
      if (!Buffer.from(decodedPath, "utf8").equals(rawPath)) {
        throw new Error("Git emitted a path that is not valid UTF-8");
      }
      paths.push(decodedPath);
    }
    offset = end + 1;
  }
  return {
    paths,
    evidenceDigest: crypto.createHash("sha256").update(output).digest("hex"),
  };
}

function gitBlobOid(bytes, objectFormat) {
  const hash = crypto.createHash(objectFormat);
  hash.update(Buffer.from(`blob ${bytes.length}\0`, "utf8"));
  hash.update(bytes);
  return hash.digest("hex");
}

const SOURCE_ATTRIBUTE_NAMES = [
  "text",
  "eol",
  "filter",
  "working-tree-encoding",
  "ident",
  "crlf",
];

function checkedSourceAttributes(
  entries,
  source = null,
  root = repositoryRoot,
) {
  const inputParts = [];
  for (const entry of entries) {
    inputParts.push(entry.pathBytes, Buffer.from([0]));
  }
  const args = ["check-attr", "-z", "--stdin"];
  if (source != null) args.push("--source", source);
  args.push(...SOURCE_ATTRIBUTE_NAMES);
  const output = gitCommand(args, {
    encoding: null,
    input: Buffer.concat(inputParts),
    root,
  });
  const fields = [];
  for (let offset = 0; offset < output.length;) {
    const end = output.indexOf(0, offset);
    if (end < 0) {
      throw new Error("git check-attr emitted an unterminated field");
    }
    fields.push(output.subarray(offset, end).toString("utf8"));
    offset = end + 1;
  }
  if (fields.length % 3 !== 0) {
    throw new Error("git check-attr emitted an incomplete record");
  }
  const byPath = new Map();
  for (let index = 0; index < fields.length; index += 3) {
    const [relativePath, attribute, value] = fields.slice(index, index + 3);
    if (!SOURCE_ATTRIBUTE_NAMES.includes(attribute)) {
      throw new Error(`git check-attr emitted an unknown ${attribute} field`);
    }
    const attributes = byPath.get(relativePath) || {};
    attributes[attribute] = value;
    byPath.set(relativePath, attributes);
  }
  for (const entry of entries) {
    const attributes = byPath.get(entry.relativePath);
    if (
      attributes == null ||
      SOURCE_ATTRIBUTE_NAMES.some((attribute) => attributes[attribute] == null)
    ) {
      throw new Error(
        `Git attributes are incomplete for ${entry.relativePath}`,
      );
    }
  }
  return byPath;
}

export function crlfWorkingTreeBytes(blobBytes) {
  let insertedCarriageReturns = 0;
  for (let index = 0; index < blobBytes.length; index += 1) {
    if (blobBytes[index] === 0x0a && blobBytes[index - 1] !== 0x0d) {
      insertedCarriageReturns += 1;
    }
  }
  if (insertedCarriageReturns === 0) return blobBytes;
  const output = Buffer.allocUnsafe(blobBytes.length + insertedCarriageReturns);
  let outputOffset = 0;
  for (let index = 0; index < blobBytes.length; index += 1) {
    if (blobBytes[index] === 0x0a && blobBytes[index - 1] !== 0x0d) {
      output[outputOffset] = 0x0d;
      outputOffset += 1;
    }
    output[outputOffset] = blobBytes[index];
    outputOffset += 1;
  }
  return output;
}

function statField(stat, name) {
  const nanosecondName = `${name}Ns`;
  if (stat[nanosecondName] != null) return String(stat[nanosecondName]);
  return String(Math.trunc(Number(stat[`${name}Ms`]) * 1_000_000));
}

function statFingerprint(stat) {
  return {
    dev: String(stat.dev),
    ino: String(stat.ino),
    mode: String(stat.mode),
    nlink: String(stat.nlink),
    size: String(stat.size),
    mtimeNs: statField(stat, "mtime"),
    ctimeNs: statField(stat, "ctime"),
  };
}

function sameStatFingerprint(left, right, { pathToHandle = false } = {}) {
  if (!left || !right) return false;
  const fields =
    pathToHandle && process.platform === "win32"
      ? ["mode", "nlink", "size", "mtimeNs", "ctimeNs"]
      : ["dev", "ino", "mode", "nlink", "size", "mtimeNs", "ctimeNs"];
  return fields.every((field) => left[field] === right[field]);
}

function sameDirectoryIdentity(left, right) {
  if (!left || !right) return false;
  if (left.ino !== right.ino || left.mode !== right.mode) return false;
  return (
    process.platform === "win32" ||
    left.dev === "0" ||
    right.dev === "0" ||
    left.dev === right.dev
  );
}

function sourceVerificationError(evidence) {
  const error = new Error(
    `exact-SHA controlled source verification failed: ${evidence.errors
      .slice(0, 10)
      .join("; ")}`,
  );
  error.code = "ERR_SOAK_EXACT_SOURCE_MISMATCH";
  error.sourceEvidence = evidence;
  return error;
}

export function verifyExactSourceTree(
  expectedSha,
  sourceRoot = repositoryRoot,
) {
  const normalizedExpectedSha = String(expectedSha).toLowerCase();
  const headSha = currentCommit(sourceRoot);
  const expectedTreeOid = commitTreeOid(normalizedExpectedSha, sourceRoot);
  const headTreeOid = commitTreeOid(headSha, sourceRoot);
  const objectFormat = String(
    gitCommand(["rev-parse", "--show-object-format"], {
      root: sourceRoot,
    }),
  )
    .trim()
    .toLowerCase();
  if (objectFormat !== "sha1" && objectFormat !== "sha256") {
    throw new Error(`unsupported Git object format: ${objectFormat}`);
  }

  const untracked = nullDelimitedGitPaths(
    ["ls-files", "--others", "--exclude-standard", "-z"],
    sourceRoot,
  );
  const ignoredSourceOverrides = nullDelimitedGitPaths(
    [
      "ls-files",
      "--others",
      "--ignored",
      "--exclude-standard",
      "-z",
      "--",
      ...SOURCE_OVERRIDE_ROOTS,
    ],
    sourceRoot,
  );
  const evidence = {
    available: true,
    matches: false,
    expectedSha: normalizedExpectedSha,
    headSha,
    expectedTreeOid,
    headTreeOid,
    objectFormat,
    trackedEntries: 0,
    trackedBytes: 0,
    sourceEntriesDigest: null,
    untracked: {
      count: untracked.paths.length,
      sample: untracked.paths.slice(0, 20),
      evidenceDigest: untracked.evidenceDigest,
    },
    ignoredSourceOverrides: {
      count: ignoredSourceOverrides.paths.length,
      sample: ignoredSourceOverrides.paths.slice(0, 20),
      evidenceDigest: ignoredSourceOverrides.evidenceDigest,
    },
    errors: [],
  };
  const recordError = (message) => {
    if (evidence.errors.length < 50) evidence.errors.push(message);
  };

  if (headSha !== normalizedExpectedSha) {
    recordError(
      `HEAD ${headSha || "unavailable"} does not match ${normalizedExpectedSha}`,
    );
  }
  if (expectedTreeOid == null || headTreeOid !== expectedTreeOid) {
    recordError(
      `HEAD tree ${headTreeOid || "unavailable"} does not match ${
        expectedTreeOid || "unavailable"
      }`,
    );
  }
  if (untracked.paths.length > 0) {
    recordError(
      `${untracked.paths.length} untracked path(s) are present, including ${untracked.paths
        .slice(0, 5)
        .join(", ")}`,
    );
  }
  if (ignoredSourceOverrides.paths.length > 0) {
    recordError(
      `${ignoredSourceOverrides.paths.length} ignored source override(s) are present, including ${ignoredSourceOverrides.paths
        .slice(0, 5)
        .join(", ")}`,
    );
  }
  if (evidence.errors.length > 0) {
    throw sourceVerificationError(evidence);
  }

  const treeOutput = gitCommand(
    ["ls-tree", "-rz", "--full-tree", normalizedExpectedSha],
    { encoding: null, root: sourceRoot },
  );
  const treeEntries = [];
  for (let offset = 0; offset < treeOutput.length;) {
    const end = treeOutput.indexOf(0, offset);
    if (end < 0) {
      recordError("git ls-tree emitted an unterminated entry");
      break;
    }
    const entry = treeOutput.subarray(offset, end);
    offset = end + 1;
    if (entry.length === 0) continue;
    const tab = entry.indexOf(0x09);
    if (tab < 0) {
      recordError("git ls-tree emitted an entry without a path");
      continue;
    }
    const header = entry.subarray(0, tab).toString("ascii");
    const match = /^([0-7]{6}) (blob|commit) ([0-9a-f]+)$/u.exec(header);
    if (!match) {
      recordError(`unsupported Git tree entry header: ${header}`);
      continue;
    }
    const [, mode, objectType, expectedOid] = match;
    const pathBytes = entry.subarray(tab + 1);
    const relativePath = pathBytes.toString("utf8");
    if (!Buffer.from(relativePath, "utf8").equals(pathBytes)) {
      recordError("tracked path is not valid UTF-8");
      continue;
    }
    if (
      relativePath === "" ||
      path.posix.isAbsolute(relativePath) ||
      path.posix.normalize(relativePath) !== relativePath ||
      relativePath.split("/").includes("..") ||
      (process.platform === "win32" && relativePath.includes("\\"))
    ) {
      recordError(`unsafe tracked path: ${relativePath}`);
      continue;
    }
    treeEntries.push({
      mode,
      objectType,
      expectedOid,
      pathBytes,
      relativePath,
    });
  }
  if (evidence.errors.length > 0) {
    throw sourceVerificationError(evidence);
  }

  const expectedAttributes = checkedSourceAttributes(
    treeEntries,
    normalizedExpectedSha,
    sourceRoot,
  );
  const worktreeAttributes = checkedSourceAttributes(
    treeEntries,
    null,
    sourceRoot,
  );
  let crlfEntries = 0;
  for (const entry of treeEntries) {
    const expected = expectedAttributes.get(entry.relativePath);
    const actual = worktreeAttributes.get(entry.relativePath);
    for (const attribute of SOURCE_ATTRIBUTE_NAMES) {
      if (expected[attribute] !== actual[attribute]) {
        recordError(
          `${entry.relativePath}: worktree ${attribute}=${actual[attribute]} does not match committed ${expected[attribute]}`,
        );
      }
    }
    for (const dangerousAttribute of [
      "filter",
      "working-tree-encoding",
      "ident",
      "crlf",
    ]) {
      if (
        expected[dangerousAttribute] !== "unspecified" &&
        expected[dangerousAttribute] !== "unset"
      ) {
        recordError(
          `${entry.relativePath}: unsupported ${dangerousAttribute}=${expected[dangerousAttribute]} conversion`,
        );
      }
    }
    if (!["set", "auto", "unset", "unspecified"].includes(expected.text)) {
      recordError(
        `${entry.relativePath}: unsupported text=${expected.text} attribute`,
      );
    }
    if (!["lf", "crlf", "unset", "unspecified"].includes(expected.eol)) {
      recordError(
        `${entry.relativePath}: unsupported eol=${expected.eol} attribute`,
      );
    }
    if (
      expected.eol === "crlf" &&
      expected.text !== "set" &&
      entry.mode !== "120000"
    ) {
      recordError(
        `${entry.relativePath}: eol=crlf requires an explicit text attribute`,
      );
    }
    if (expected.eol === "crlf" && entry.mode !== "120000") {
      crlfEntries += 1;
    }
  }
  evidence.attributes = {
    committedMatchesWorktree: evidence.errors.length === 0,
    policy:
      "built-in text/eol only; filter, working-tree-encoding, ident, and legacy crlf conversions rejected",
    crlfEntries,
  };
  if (evidence.errors.length > 0) {
    throw sourceVerificationError(evidence);
  }
  const canonicalRepositoryRoot = fs.realpathSync.native(sourceRoot);
  const parentIdentities = new Map();
  const verifiedPaths = [];
  const sourceDigest = crypto.createHash("sha256");
  parentIdentities.set("", {
    absolutePath: sourceRoot,
    canonicalPath: canonicalRepositoryRoot,
    fingerprint: statFingerprint(fs.lstatSync(sourceRoot, { bigint: true })),
  });

  function trustedParent(relativePath) {
    const parentRelativePath = path.posix.dirname(relativePath);
    const key = parentRelativePath === "." ? "" : parentRelativePath;
    const cached = parentIdentities.get(key);
    if (cached) return cached.absolutePath;
    const parentOfParent = trustedParent(key);
    const basename = path.posix.basename(key);
    const absolutePath = path.join(parentOfParent, basename);
    const parentStat = fs.lstatSync(absolutePath, { bigint: true });
    if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
      throw new Error(`tracked parent is not a real directory: ${key}`);
    }
    const canonicalPath = fs.realpathSync.native(absolutePath);
    if (!isPathInside(canonicalRepositoryRoot, canonicalPath)) {
      throw new Error(`tracked parent escapes the repository: ${key}`);
    }
    parentIdentities.set(key, {
      absolutePath,
      canonicalPath,
      fingerprint: statFingerprint(parentStat),
    });
    return absolutePath;
  }

  for (const {
    mode,
    objectType,
    expectedOid,
    pathBytes,
    relativePath,
  } of treeEntries) {
    sourceDigest.update(Buffer.from(`${mode} ${expectedOid}\t`, "ascii"));
    sourceDigest.update(pathBytes);
    sourceDigest.update(Buffer.from([0]));
    evidence.trackedEntries += 1;

    try {
      if (objectType !== "blob") {
        throw new Error(
          `unsupported tracked ${objectType} entry at ${relativePath}`,
        );
      }
      const parentPath = trustedParent(relativePath);
      const absolutePath = path.join(
        parentPath,
        path.posix.basename(relativePath),
      );
      const before = fs.lstatSync(absolutePath, { bigint: true });
      let bytes;
      if (mode === "120000") {
        if (!before.isSymbolicLink()) {
          throw new Error(`tracked symlink is not a symlink: ${relativePath}`);
        }
        bytes = fs.readlinkSync(absolutePath, { encoding: "buffer" });
      } else {
        if (mode !== "100644" && mode !== "100755") {
          throw new Error(`unsupported tracked file mode ${mode}`);
        }
        if (
          !before.isFile() ||
          before.isSymbolicLink() ||
          Number(before.nlink) !== 1
        ) {
          throw new Error(
            `tracked file is not a single-link regular file: ${relativePath}`,
          );
        }
        if (process.platform !== "win32") {
          const executable = (Number(before.mode) & 0o111) !== 0;
          if (executable !== (mode === "100755")) {
            throw new Error(
              `tracked executable mode mismatch at ${relativePath}`,
            );
          }
        }
        const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0);
        const descriptor = fs.openSync(absolutePath, flags);
        try {
          const opened = statFingerprint(
            fs.fstatSync(descriptor, { bigint: true }),
          );
          if (
            !sameStatFingerprint(statFingerprint(before), opened, {
              pathToHandle: true,
            })
          ) {
            throw new Error(
              `tracked file changed while opening: ${relativePath}`,
            );
          }
          bytes = fs.readFileSync(descriptor);
          const afterRead = statFingerprint(
            fs.fstatSync(descriptor, { bigint: true }),
          );
          if (!sameStatFingerprint(opened, afterRead)) {
            throw new Error(
              `tracked file changed while reading: ${relativePath}`,
            );
          }
        } finally {
          fs.closeSync(descriptor);
        }
      }
      const after = fs.lstatSync(absolutePath, { bigint: true });
      if (
        !sameStatFingerprint(statFingerprint(before), statFingerprint(after))
      ) {
        throw new Error(`tracked path changed while reading: ${relativePath}`);
      }
      const attributes = expectedAttributes.get(relativePath);
      if (mode !== "120000" && attributes.eol === "crlf") {
        const blobBytes = gitCommand(["cat-file", "blob", expectedOid], {
          encoding: null,
          root: sourceRoot,
        });
        const expectedWorkingTreeBytes = crlfWorkingTreeBytes(blobBytes);
        if (!bytes.equals(expectedWorkingTreeBytes)) {
          throw new Error(
            `controlled CRLF worktree bytes mismatch at ${relativePath}`,
          );
        }
      } else {
        const actualOid = gitBlobOid(bytes, objectFormat);
        if (actualOid !== expectedOid) {
          throw new Error(
            `raw worktree blob mismatch at ${relativePath}: expected ${expectedOid}, got ${actualOid}`,
          );
        }
      }
      evidence.trackedBytes += bytes.length;
      verifiedPaths.push({
        absolutePath,
        relativePath,
        fingerprint: statFingerprint(after),
      });
    } catch (error) {
      recordError(`${relativePath}: ${error?.message || String(error)}`);
    }
  }

  evidence.sourceEntriesDigest = sourceDigest.digest("hex");
  for (const identity of parentIdentities.values()) {
    try {
      const currentStat = statFingerprint(
        fs.lstatSync(identity.absolutePath, { bigint: true }),
      );
      const currentCanonicalPath = fs.realpathSync.native(
        identity.absolutePath,
      );
      if (
        !sameStatFingerprint(identity.fingerprint, currentStat) ||
        currentCanonicalPath !== identity.canonicalPath
      ) {
        recordError(
          `tracked parent changed during source verification: ${path.relative(
            sourceRoot,
            identity.absolutePath,
          )}`,
        );
      }
    } catch (error) {
      recordError(
        `tracked parent recheck failed: ${error?.message || String(error)}`,
      );
    }
  }
  for (const verifiedPath of verifiedPaths) {
    try {
      const current = statFingerprint(
        fs.lstatSync(verifiedPath.absolutePath, { bigint: true }),
      );
      if (!sameStatFingerprint(verifiedPath.fingerprint, current)) {
        recordError(
          `tracked path changed after verification: ${verifiedPath.relativePath}`,
        );
      }
    } catch (error) {
      recordError(
        `${verifiedPath.relativePath}: post-verification stat failed: ${
          error?.message || String(error)
        }`,
      );
    }
  }
  if (
    currentCommit(sourceRoot) !== normalizedExpectedSha ||
    commitTreeOid(normalizedExpectedSha, sourceRoot) !== expectedTreeOid
  ) {
    recordError("HEAD or expected tree changed during source verification");
  }
  const trackedWorktreeAfter = trackedWorktreeEvidence(sourceRoot);
  if (!trackedWorktreeAfter.available || !trackedWorktreeAfter.clean) {
    recordError("tracked worktree changed during source verification");
  }
  const untrackedAfter = nullDelimitedGitPaths(
    ["ls-files", "--others", "--exclude-standard", "-z"],
    sourceRoot,
  );
  if (untrackedAfter.paths.length > 0) {
    recordError(
      `untracked paths appeared during source verification: ${untrackedAfter.paths
        .slice(0, 5)
        .join(", ")}`,
    );
  }
  const ignoredSourceOverridesAfter = nullDelimitedGitPaths(
    [
      "ls-files",
      "--others",
      "--ignored",
      "--exclude-standard",
      "-z",
      "--",
      ...SOURCE_OVERRIDE_ROOTS,
    ],
    sourceRoot,
  );
  if (ignoredSourceOverridesAfter.paths.length > 0) {
    recordError(
      `ignored source overrides appeared during source verification: ${ignoredSourceOverridesAfter.paths
        .slice(0, 5)
        .join(", ")}`,
    );
  }
  if (evidence.errors.length > 0) {
    throw sourceVerificationError(evidence);
  }
  evidence.matches = true;
  return evidence;
}

function currentCommit(root = repositoryRoot) {
  const result = spawnSync(
    "git",
    safeGitArguments(root, ["rev-parse", "HEAD"]),
    {
      cwd: root,
      encoding: "utf8",
      env: safeGitEnvironment(),
      windowsHide: true,
    },
  );
  return result.status === 0 ? result.stdout.trim().toLowerCase() : null;
}

function commitTreeOid(revision, root = repositoryRoot) {
  if (!revision) return null;
  const result = spawnSync(
    "git",
    safeGitArguments(root, ["rev-parse", `${revision}^{tree}`]),
    {
      cwd: root,
      encoding: "utf8",
      env: safeGitEnvironment(),
      windowsHide: true,
    },
  );
  return result.status === 0 ? result.stdout.trim().toLowerCase() : null;
}

function branchRefEvidence(root = repositoryRoot) {
  const result = spawnSync(
    "git",
    safeGitArguments(root, ["symbolic-ref", "--quiet", "HEAD"]),
    {
      cwd: root,
      encoding: "utf8",
      env: safeGitEnvironment(),
      windowsHide: true,
    },
  );
  const errorMessage =
    result.error == null
      ? null
      : String(result.error?.message || result.error).slice(0, 500);
  const detached = result.status === 1 && errorMessage == null;
  return {
    available: (result.status === 0 || detached) && errorMessage == null,
    ref: result.status === 0 ? result.stdout.trim() : null,
    detached,
    status: result.status,
    error: errorMessage,
  };
}

function trackedDiffEvidence(root = repositoryRoot) {
  const commonOptions = {
    cwd: root,
    encoding: "utf8",
    env: safeGitEnvironment(),
    maxBuffer: 64 * MIB,
    windowsHide: true,
  };
  const unstaged = spawnSync(
    "git",
    safeGitArguments(root, [
      "diff",
      "--binary",
      "--no-ext-diff",
      "--no-textconv",
    ]),
    commonOptions,
  );
  const staged = spawnSync(
    "git",
    safeGitArguments(root, [
      "diff",
      "--cached",
      "--binary",
      "--no-ext-diff",
      "--no-textconv",
    ]),
    commonOptions,
  );
  const unstagedOutput =
    typeof unstaged.stdout === "string" ? unstaged.stdout : "";
  const stagedOutput = typeof staged.stdout === "string" ? staged.stdout : "";
  const errors = [unstaged, staged]
    .map((result) =>
      result.error == null
        ? null
        : String(result.error?.message || result.error).slice(0, 500),
    )
    .filter(Boolean);
  const available =
    unstaged.status === 0 && staged.status === 0 && errors.length === 0;
  return {
    available,
    unstagedStatus: unstaged.status,
    stagedStatus: staged.status,
    unstagedBytes: Buffer.byteLength(unstagedOutput),
    stagedBytes: Buffer.byteLength(stagedOutput),
    evidenceDigest: digestText(`${unstagedOutput}\0${stagedOutput}`),
    error: errors.join("; ") || null,
  };
}

function trackedWorktreeEvidence(root = repositoryRoot) {
  const result = spawnSync(
    "git",
    safeGitArguments(root, [
      "status",
      "--porcelain=v1",
      "--untracked-files=no",
    ]),
    {
      cwd: root,
      encoding: "utf8",
      env: safeGitEnvironment(),
      maxBuffer: 16 * MIB,
      windowsHide: true,
    },
  );
  const output = typeof result.stdout === "string" ? result.stdout : "";
  const changes = output.split(/\r?\n/u).filter(Boolean);
  const errorMessage =
    result.error == null
      ? null
      : String(result.error?.message || result.error).slice(0, 500);
  const diff = trackedDiffEvidence(root);
  const available =
    result.status === 0 && errorMessage == null && diff.available;
  return {
    available,
    clean: available && changes.length === 0,
    status: result.status,
    changeCount: changes.length,
    changes,
    evidenceDigest: digestText(output),
    diff,
    error:
      errorMessage ||
      diff.error ||
      (!diff.available
        ? `git diff exited ${diff.unstagedStatus}/${diff.stagedStatus}`
        : null),
  };
}

function repositoryOverlayEvidence() {
  try {
    const untracked = nullDelimitedGitPaths([
      "ls-files",
      "--others",
      "--exclude-standard",
      "-z",
    ]);
    const ignoredSourceOverrides = nullDelimitedGitPaths([
      "ls-files",
      "--others",
      "--ignored",
      "--exclude-standard",
      "-z",
      "--",
      ...SOURCE_OVERRIDE_ROOTS,
    ]);
    return {
      available: true,
      untracked: {
        count: untracked.paths.length,
        sample: untracked.paths.slice(0, 20),
        evidenceDigest: untracked.evidenceDigest,
      },
      ignoredSourceOverrides: {
        count: ignoredSourceOverrides.paths.length,
        sample: ignoredSourceOverrides.paths.slice(0, 20),
        evidenceDigest: ignoredSourceOverrides.evidenceDigest,
      },
      error: null,
    };
  } catch (error) {
    return {
      available: false,
      untracked: null,
      ignoredSourceOverrides: null,
      error: String(error?.message || error).slice(0, 500),
    };
  }
}

function invocationRepositoryEvidence() {
  const commitSha = currentCommit();
  const branch = branchRefEvidence();
  const trackedWorktree = trackedWorktreeEvidence();
  const overlays = repositoryOverlayEvidence();
  const treeOid = commitTreeOid(commitSha);
  return {
    available:
      commitSha != null &&
      treeOid != null &&
      branch.available &&
      trackedWorktree.available &&
      overlays.available,
    commitSha,
    treeOid,
    branch,
    trackedWorktree,
    overlays,
  };
}

function sameInvocationRepository(before, after) {
  return (
    before.available &&
    after.available &&
    before.commitSha === after.commitSha &&
    before.treeOid === after.treeOid &&
    before.branch.ref === after.branch.ref &&
    before.branch.detached === after.branch.detached &&
    before.trackedWorktree.clean === after.trackedWorktree.clean &&
    before.trackedWorktree.changeCount === after.trackedWorktree.changeCount &&
    before.trackedWorktree.evidenceDigest ===
      after.trackedWorktree.evidenceDigest &&
    before.trackedWorktree.diff.evidenceDigest ===
      after.trackedWorktree.diff.evidenceDigest &&
    JSON.stringify(before.trackedWorktree.changes) ===
      JSON.stringify(after.trackedWorktree.changes) &&
    before.overlays.available === after.overlays.available &&
    before.overlays.untracked?.count === after.overlays.untracked?.count &&
    before.overlays.untracked?.evidenceDigest ===
      after.overlays.untracked?.evidenceDigest &&
    before.overlays.ignoredSourceOverrides?.count ===
      after.overlays.ignoredSourceOverrides?.count &&
    before.overlays.ignoredSourceOverrides?.evidenceDigest ===
      after.overlays.ignoredSourceOverrides?.evidenceDigest
  );
}

function lstatIfPresent(filePath, options) {
  try {
    return fs.lstatSync(filePath, options);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function prepareReportOutput(filePath) {
  const requestedPath = path.resolve(filePath);
  if (lstatIfPresent(requestedPath) != null) {
    throw new Error(`soak report output already exists: ${requestedPath}`);
  }

  const requestedParent = path.dirname(requestedPath);
  let nearestExistingAncestor = requestedParent;
  for (;;) {
    const ancestorStat = lstatIfPresent(nearestExistingAncestor);
    if (ancestorStat != null) {
      if (!ancestorStat.isDirectory() || ancestorStat.isSymbolicLink()) {
        throw new Error(
          `soak report ancestor is not a real directory: ${nearestExistingAncestor}`,
        );
      }
      break;
    }
    const next = path.dirname(nearestExistingAncestor);
    if (next === nearestExistingAncestor) {
      throw new Error(
        `soak report has no existing filesystem ancestor: ${requestedPath}`,
      );
    }
    nearestExistingAncestor = next;
  }

  const canonicalRepositoryRoot = fs.realpathSync.native(repositoryRoot);
  const canonicalAncestor = fs.realpathSync.native(nearestExistingAncestor);
  if (isPathInside(canonicalRepositoryRoot, canonicalAncestor)) {
    throw new Error(
      "soak report output resolves inside the calling repository",
    );
  }
  fs.mkdirSync(requestedParent, { recursive: true });
  const canonicalParent = fs.realpathSync.native(requestedParent);
  if (isPathInside(canonicalRepositoryRoot, canonicalParent)) {
    throw new Error(
      "soak report output resolves inside the calling repository",
    );
  }
  const parentStat = fs.lstatSync(canonicalParent, { bigint: true });
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
    throw new Error("soak report canonical parent is not a real directory");
  }
  const canonicalPath = path.join(
    canonicalParent,
    path.basename(requestedPath),
  );
  if (lstatIfPresent(canonicalPath) != null) {
    throw new Error(`soak report output already exists: ${canonicalPath}`);
  }
  return {
    requestedPath,
    requestedParent,
    canonicalRepositoryRoot,
    canonicalParent,
    canonicalPath,
    parentFingerprint: statFingerprint(parentStat),
  };
}

function assertReportOutputAuthority(authority) {
  const canonicalParent = fs.realpathSync.native(authority.requestedParent);
  if (canonicalParent !== authority.canonicalParent) {
    throw new Error("soak report parent changed after output validation");
  }
  const parentStat = fs.lstatSync(authority.canonicalParent, {
    bigint: true,
  });
  if (
    !parentStat.isDirectory() ||
    parentStat.isSymbolicLink() ||
    !sameDirectoryIdentity(
      authority.parentFingerprint,
      statFingerprint(parentStat),
    )
  ) {
    throw new Error("soak report parent identity changed before write");
  }
  if (lstatIfPresent(authority.canonicalPath) != null) {
    throw new Error(
      `soak report output already exists: ${authority.canonicalPath}`,
    );
  }
}

function appendRepositoryMutationFailure(report) {
  if (
    report.failures.some(
      (failure) =>
        failure.message ===
        "soak changed the calling repository branch, HEAD, tree, or tracked status",
    )
  ) {
    return;
  }
  report.failures.push({
    name: "Error",
    code: null,
    message:
      "soak changed the calling repository branch, HEAD, tree, or tracked status",
    stack: null,
  });
}

function writeReportExclusive(authority, report, invocationRepositoryBefore) {
  assertReportOutputAuthority(authority);
  const flags =
    fs.constants.O_CREAT |
    fs.constants.O_EXCL |
    fs.constants.O_WRONLY |
    (fs.constants.O_NOFOLLOW || 0);
  const descriptor = fs.openSync(authority.canonicalPath, flags, 0o600);
  try {
    const openedPath = fs.lstatSync(authority.canonicalPath);
    const openedCanonicalPath = fs.realpathSync.native(authority.canonicalPath);
    if (
      !openedPath.isFile() ||
      openedPath.isSymbolicLink() ||
      Number(openedPath.nlink) !== 1 ||
      path.dirname(openedCanonicalPath) !== authority.canonicalParent ||
      isPathInside(authority.canonicalRepositoryRoot, openedCanonicalPath)
    ) {
      throw new Error("exclusive soak report output is not a regular file");
    }
    const provisional = Buffer.from(
      `${JSON.stringify(report, null, 2)}\n`,
      "utf8",
    );
    fs.writeSync(descriptor, provisional, 0, provisional.length, 0);
    fs.fsyncSync(descriptor);

    const afterReportWrite = invocationRepositoryEvidence();
    const unchanged = sameInvocationRepository(
      invocationRepositoryBefore,
      afterReportWrite,
    );
    report.checkoutEvidence.invocationRepository.afterReportWrite =
      afterReportWrite;
    report.checkoutEvidence.invocationRepository.after = afterReportWrite;
    report.checkoutEvidence.invocationRepository.unchanged = unchanged;
    if (!unchanged) {
      report.success = false;
      appendRepositoryMutationFailure(report);
    }
    const finalReport = Buffer.from(
      `${JSON.stringify(report, null, 2)}\n`,
      "utf8",
    );
    fs.ftruncateSync(descriptor, 0);
    fs.writeSync(descriptor, finalReport, 0, finalReport.length, 0);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function git(repo, ...args) {
  return execFileSync("git", safeGitArguments(repo, args), {
    cwd: repo,
    encoding: "utf8",
    env: safeGitEnvironment(),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  }).trim();
}

function nextRandom(state) {
  let value = state.value >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  state.value = value >>> 0;
  return state.value;
}

function makeDag(taskCount, seed, workflowMode) {
  const random = { value: seed || 1 };
  const tasks = Array.from({ length: taskCount }, (_, index) => {
    const key = `task-${String(index).padStart(3, "0")}`;
    let dependsOn = [];
    if (index === 2) dependsOn = ["task-000"];
    else if (index === 3) dependsOn = ["task-001"];
    else if (index === 4) dependsOn = ["task-002", "task-003"];
    else if (index > 4) {
      dependsOn = [`task-${String(index - 1).padStart(3, "0")}`];
    }
    const specification = {
      kind: "chainlesschain-team-soak-task",
      key,
      dependsOn,
    };
    return {
      key,
      title: `Real soak task ${index}`,
      dependsOn,
      priority: ["high", "normal", "low"][nextRandom(random) % 3],
      retrySafe: true,
      ...(workflowMode === "agent-worktree"
        ? { prompt: JSON.stringify(specification) }
        : { command: `node soak-task.mjs ${key}` }),
    };
  });
  return tasks;
}

function shellTaskProgram() {
  return `#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const key = process.argv[2];
const runId = process.env.CC_TEAM_SOAK_RUN_ID;
const workerId = process.env.CC_TEAM_SOAK_WORKER_ID;
const effectsDir = process.env.CC_TEAM_SOAK_EFFECTS_DIR;
if (!key || !runId || !workerId || !effectsDir) {
  throw new Error("shell fallback has no pinned soak authority");
}
const graph = JSON.parse(fs.readFileSync("soak-dependencies.json", "utf8"));
const dependsOn = graph[key];
if (!Array.isArray(dependsOn)) throw new Error("unknown soak task");
const dependencyEvidence = dependsOn.map((dependencyKey) => {
  const dependency = JSON.parse(
    fs.readFileSync(path.join("soak-output", dependencyKey + ".json"), "utf8"),
  );
  if (dependency.key !== dependencyKey || dependency.runId !== runId) {
    throw new Error("invalid dependency baseline for " + dependencyKey);
  }
  return {
    key: dependencyKey,
    attemptId: dependency.attemptId,
    contentDigest: crypto
      .createHash("sha256")
      .update(JSON.stringify(dependency))
      .digest("hex"),
  };
});
const attemptId = crypto
  .createHash("sha256")
  .update(JSON.stringify({ runId, key, workerId, pid: process.pid }))
  .digest("hex");
function writeExclusiveJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const descriptor = fs.openSync(filePath, "wx", 0o600);
  try {
    fs.writeFileSync(descriptor, JSON.stringify(value) + "\\n", "utf8");
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}
const attempt = {
  kind: "chainlesschain-team-soak-effect-attempt",
  runId,
  taskKey: key,
  attemptId,
  workerId,
  pid: process.pid,
};
writeExclusiveJson(
  path.join(effectsDir, "attempts", key, attemptId + ".json"),
  attempt,
);
writeExclusiveJson(path.join(effectsDir, "confirmed", key + ".json"), {
  ...attempt,
  kind: "chainlesschain-team-soak-confirmed-effect",
  confirmationId: crypto
    .createHash("sha256")
    .update(runId + "\\0" + key)
    .digest("hex"),
});
fs.mkdirSync("soak-output", { recursive: true });
fs.writeFileSync(
  path.join("soak-output", key + ".json"),
  JSON.stringify(
    {
      kind: "chainlesschain-team-soak-output",
      runId,
      key,
      attemptId,
      workerId,
      dependencyEvidence,
    },
    null,
    2,
  ) + "\\n",
  "utf8",
);
`;
}

function createFixture(
  rootDirectory,
  roundIndex,
  roundSeed,
  workflowMode,
  taskCount,
) {
  const roundDirectory = path.join(
    rootDirectory,
    `round-${String(roundIndex).padStart(6, "0")}`,
  );
  const repo = path.join(roundDirectory, "repo");
  const authority = path.join(roundDirectory, "authority");
  const effectsDir = path.join(authority, "effects");
  const checkpointStateDir = path.join(authority, "checkpoints");
  fs.mkdirSync(repo, { recursive: true });
  fs.mkdirSync(authority, { recursive: true, mode: 0o700 });
  const runId = `soak-${roundIndex}-${roundSeed}`;
  const tasks = makeDag(taskCount, roundSeed, workflowMode);
  fs.writeFileSync(path.join(repo, "README.md"), "real Agent Team soak\n");
  fs.writeFileSync(path.join(repo, "soak-task.mjs"), shellTaskProgram());
  fs.writeFileSync(
    path.join(repo, "soak-dependencies.json"),
    `${JSON.stringify(
      Object.fromEntries(tasks.map((task) => [task.key, task.dependsOn])),
      null,
      2,
    )}\n`,
  );
  git(repo, "init");
  git(repo, "config", "user.name", "Agent Team Soak");
  git(repo, "config", "user.email", "agent-team-soak@example.invalid");
  git(repo, "add", "README.md", "soak-task.mjs", "soak-dependencies.json");
  git(repo, "commit", "-m", "soak base");
  const statePath = path.join(authority, "queue.json");
  const graphPath = path.join(authority, "tasks.json");
  fs.writeFileSync(graphPath, `${JSON.stringify({ tasks }, null, 2)}\n`, {
    mode: 0o600,
  });
  return {
    roundDirectory,
    repo,
    authority,
    effectsDir,
    checkpointStateDir,
    runId,
    statePath,
    graphPath,
    tasks,
    baseOid: git(repo, "rev-parse", "HEAD").toLowerCase(),
  };
}

function createWorker(configurationPath, mode, workerId) {
  const child = spawn(
    process.execPath,
    [workerPath, configurationPath, mode, workerId],
    {
      cwd: repositoryRoot,
      detached: process.platform !== "win32",
      env: safeGitEnvironment(),
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  activeChildren.add(child);
  const events = [];
  let stdoutBuffer = "";
  let stderr = "";
  let parseError = null;

  function dispatch(line) {
    if (!line.trim()) return;
    try {
      events.push(JSON.parse(line));
    } catch (error) {
      parseError = new Error(`worker emitted invalid JSON: ${line}`, {
        cause: error,
      });
    }
  }

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk;
    for (;;) {
      const newline = stdoutBuffer.indexOf("\n");
      if (newline < 0) break;
      dispatch(stdoutBuffer.slice(0, newline));
      stdoutBuffer = stdoutBuffer.slice(newline + 1);
    }
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  const done = new Promise((resolve) => {
    child.on("error", (error) => {
      parseError ||= error;
    });
    child.on("close", (code, signal) => {
      activeChildren.delete(child);
      dispatch(stdoutBuffer);
      resolve({ code, signal, events, stderr, parseError });
    });
  });
  return { child, done };
}

function childIsRunning(child) {
  return (
    child?.pid != null && child.exitCode == null && child.signalCode == null
  );
}

export function terminateSoakChildTree(child, signal = "SIGTERM") {
  if (!childIsRunning(child)) return false;
  try {
    stopBackgroundAgentChildTree(child.pid, { signal });
    return true;
  } catch (error) {
    if (!childIsRunning(child)) return false;
    try {
      child.kill(signal);
    } catch {
      // Preserve the complete-tree failure below. A direct kill is only a
      // last-chance nudge and does not satisfy the descendant-tree contract.
    }
    const wrapped = new Error(
      `failed to terminate soak process tree ${child.pid}: ${
        error?.message || String(error)
      }`,
      { cause: error },
    );
    wrapped.code = error?.code || "ERR_SOAK_PROCESS_TREE_TERMINATION";
    throw wrapped;
  }
}

export async function withTimeout(promise, milliseconds, label, children = []) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const failures = [];
          for (const child of children) {
            try {
              terminateSoakChildTree(child, "SIGKILL");
            } catch (error) {
              failures.push(error);
            }
          }
          const timeoutError = new Error(
            `${label} timed out after ${milliseconds} ms`,
            failures.length > 0 ? { cause: failures[0] } : undefined,
          );
          timeoutError.code = "ERR_SOAK_TIMEOUT";
          timeoutError.processTreeTerminationFailures = failures;
          reject(timeoutError);
        }, milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
}

async function terminateActiveWorkers() {
  const children = [...activeChildren];
  if (children.length === 0) return;
  const closed = children.map(
    (child) =>
      new Promise((resolve) => {
        if (child.exitCode != null || child.signalCode != null) {
          resolve();
          return;
        }
        child.once("close", resolve);
      }),
  );
  const terminationFailures = [];
  for (const child of children) {
    try {
      terminateSoakChildTree(child, "SIGTERM");
    } catch (error) {
      terminationFailures.push(error);
    }
  }
  await Promise.race([
    Promise.all(closed),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
  for (const child of children.filter(childIsRunning)) {
    try {
      terminateSoakChildTree(child, "SIGKILL");
    } catch (error) {
      terminationFailures.push(error);
    }
  }
  await Promise.race([
    Promise.all(closed),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  const livePids = children.filter(childIsRunning).map((child) => child.pid);
  if (livePids.length > 0 || terminationFailures.length > 0) {
    const error = new Error(
      livePids.length > 0
        ? `soak worker process trees did not terminate: ${livePids.join(", ")}`
        : `soak worker process-tree cleanup reported ${terminationFailures.length} failure(s)`,
      terminationFailures.length > 0
        ? { cause: terminationFailures[0] }
        : undefined,
    );
    error.code = "ERR_SOAK_PROCESS_TREE_CLEANUP";
    throw error;
  }
}

function digestText(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function canonicalWorkspaceLockPath(workspaceRoot) {
  const identity = `${os.homedir()}\0${
    typeof process.getuid === "function"
      ? process.getuid()
      : os.userInfo().username
  }`;
  const lockRoot = path.join(
    os.tmpdir(),
    `chainlesschain-workspace-transaction-locks-${crypto
      .createHash("sha256")
      .update(identity)
      .digest("hex")
      .slice(0, 24)}`,
  );
  const canonicalWorkspace =
    process.platform === "win32"
      ? path.resolve(workspaceRoot).toLowerCase()
      : path.resolve(workspaceRoot);
  return path.join(
    lockRoot,
    crypto.createHash("sha256").update(canonicalWorkspace).digest("hex"),
  );
}

function stableBudgetEvidence(status) {
  return {
    maxTasks: status.maxTasks,
    maxTokens: status.maxTokens,
    maxUsd: status.maxUsd,
    maxWallMs: status.maxWallMs,
    tasksStarted: status.tasksStarted,
    tasksSettled: status.tasksSettled,
    tokens: status.tokens,
    spentUsd: status.spentUsd,
    reservedTokens: status.reservedTokens,
    reservedUsd: status.reservedUsd,
    reservations: status.reservations,
    reason: status.reason,
  };
}

function probeManagedProcessCapability(rootDirectory) {
  const probeRoot = path.join(rootDirectory, "platform-capability");
  const workspaceRoot = path.join(probeRoot, "workspace");
  const stateDir = path.join(probeRoot, "process-checkpoints");
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, "base.txt"), "before\n");
  const broker = new TeamProcessCheckpointBroker({
    stateDir,
    coverageTarget: "partial",
    writerIsolation: "unknown",
    externalSideEffects: true,
  });
  const guard = broker.beginTask({
    runId: "soak-platform-capability",
    taskKey: "managed-process-probe",
    workspaceRoot,
  });
  guard.markRunning();
  let supported = false;
  let failure = null;
  try {
    executionBroker.execFileSync("git", ["--version"], {
      cwd: workspaceRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      windowsHide: true,
      env: safeGitEnvironment(),
      origin: "team-soak:managed-process-probe",
      policy: "allow",
      scope: "team-soak",
    });
    supported = true;
  } catch (error) {
    const message = String(error?.message || error);
    failure = {
      code: error?.code || null,
      name: error?.name || "Error",
      message: message.slice(0, 500),
      messageDigest: digestText(message),
      failClosedVerified:
        /sandbox|process.?tree|required boundar|exit 125|bwrap|seatbelt|restricted token/iu.test(
          `${error?.code || ""} ${message}`,
        ),
    };
  }
  const rolledBack = guard.rollback({
    reason: supported
      ? "soak capability probe completed"
      : "soak capability probe verified fail-closed execution",
  });
  const rolledBackSnapshot = broker.inspectCheckpoint(guard.id);
  assert(
    rolledBack.outcome === "rolled_back" &&
      rolledBackSnapshot.state === "rolled_back",
    "managed process capability probe did not settle its checkpoint",
  );
  assert(
    supported || failure?.failClosedVerified === true,
    "managed process probe failed for a reason that is not a verified fail-closed isolation refusal",
  );
  assert(
    !fs.existsSync(canonicalWorkspaceLockPath(workspaceRoot)),
    "managed process capability probe left its canonical workspace lock",
  );

  const directStateDir = path.join(probeRoot, "direct-checkpoints");
  const directBroker = new TeamProcessCheckpointBroker({
    stateDir: directStateDir,
    coverageTarget: "full",
    writerIsolation: "exclusive-workspace",
    externalSideEffects: false,
  });
  const direct = directBroker.beginTask({
    runId: "soak-platform-capability",
    taskKey: "direct-file-checkpoint",
    workspaceRoot,
  });
  direct.markRunning();
  fs.writeFileSync(path.join(workspaceRoot, "direct.txt"), "checkpointed\n");
  const committed = direct.accept();
  const committedSnapshot = directBroker.inspectCheckpoint(direct.id);
  assert(
    committed.outcome === "committed" &&
      committedSnapshot.state === "committed" &&
      committed.fileCoverage === "full",
    "direct deterministic file checkpoint was not committed with full file coverage",
  );
  assert(
    !fs.existsSync(canonicalWorkspaceLockPath(workspaceRoot)),
    "direct deterministic file checkpoint left its canonical workspace lock",
  );

  return {
    managedProcessSupported: supported,
    workflowMode: supported ? "agent-worktree" : "shell-worktree",
    managedProcessProbe: {
      outcome: supported ? "supported" : "failed-closed",
      failure,
      checkpointState: rolledBackSnapshot.state,
      checkpointEvidenceDigest: rolledBack.evidenceDigest,
    },
    directFileCheckpoint: {
      outcome: "committed",
      state: committedSnapshot.state,
      coverage: committed.coverage,
      fileCoverage: committed.fileCoverage,
      evidenceDigest: committed.evidenceDigest,
    },
    truth: supported
      ? "managed-process capability probe passed; deterministic Agent contract/worktree/checkpoint coverage is verified without a live model"
      : "managed-process capability probe failed closed; deterministic shell-worktree fallback and direct-file checkpoint coverage are verified separately",
  };
}

function readJsonFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  const output = [];
  const pending = [directory];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(target);
      else if (entry.isFile() && entry.name.endsWith(".json")) {
        output.push(JSON.parse(fs.readFileSync(target, "utf8")));
      }
    }
  }
  return output;
}

function residuePaths(...roots) {
  const residues = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const pending = [root];
    while (pending.length > 0) {
      const current = pending.pop();
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const target = path.join(current, entry.name);
        if (
          entry.name.endsWith(".lock") ||
          entry.name.endsWith(".tmp") ||
          entry.name.includes(".tmp-")
        ) {
          residues.push(target);
        }
        if (entry.isDirectory() && entry.name !== ".git") pending.push(target);
      }
    }
  }
  return residues.sort();
}

function verifyExternalEffects(fixture) {
  const attempts = readJsonFiles(path.join(fixture.effectsDir, "attempts"));
  const confirmed = readJsonFiles(path.join(fixture.effectsDir, "confirmed"));
  assert(
    attempts.length === fixture.tasks.length,
    `observed ${attempts.length} external attempts for ${fixture.tasks.length} tasks`,
  );
  assert(
    confirmed.length === fixture.tasks.length,
    `observed ${confirmed.length} confirmed effects for ${fixture.tasks.length} tasks`,
  );
  const attemptsByTask = new Map();
  for (const attempt of attempts) {
    const entries = attemptsByTask.get(attempt.taskKey) || [];
    entries.push(attempt);
    attemptsByTask.set(attempt.taskKey, entries);
  }
  const attemptIds = new Set(attempts.map((entry) => entry.attemptId));
  const productiveWorkerIds = new Set(confirmed.map((entry) => entry.workerId));
  assert(
    attemptIds.size === attempts.length,
    "external effect attempt IDs were not globally unique",
  );
  assert(
    productiveWorkerIds.size >= 2,
    "confirmed effects do not prove multi-process queue competition",
  );
  for (const task of fixture.tasks) {
    const taskAttempts = attemptsByTask.get(task.key) || [];
    const confirmation = confirmed.find((entry) => entry.taskKey === task.key);
    assert(
      taskAttempts.length === 1,
      `task ${task.key} executed ${taskAttempts.length} external-effect attempts`,
    );
    assert(
      confirmation?.attemptId === taskAttempts[0].attemptId,
      `task ${task.key} confirmation does not bind its sole attempt`,
    );
  }
  return {
    attempts: attempts.length,
    confirmed: confirmed.length,
    duplicateConfirmed:
      confirmed.length - new Set(confirmed.map((entry) => entry.taskKey)).size,
    uniqueAttemptIds: attemptIds.size,
    productiveWorkers: productiveWorkerIds.size,
    crashBoundary: "before-worktree-checkpoint-and-external-effect",
    authority: "external idempotency markers keyed by task and attempt ID",
  };
}

function verifyDagOutputs(fixture, status) {
  const tasksByKey = new Map(status.tasks.map((task) => [task.key, task]));
  for (const task of fixture.tasks) {
    const outputPath = path.join(
      fixture.repo,
      "soak-output",
      `${task.key}.json`,
    );
    const output = JSON.parse(fs.readFileSync(outputPath, "utf8"));
    assert(output.key === task.key, `base output for ${task.key} is misbound`);
    assert(
      output.runId === fixture.runId,
      `base output for ${task.key} has the wrong run`,
    );
    assert(
      JSON.stringify(output.dependencyEvidence.map((entry) => entry.key)) ===
        JSON.stringify(task.dependsOn),
      `task ${task.key} did not observe its exact dependency baseline`,
    );
    const result = tasksByKey.get(task.key)?.metadata?.result;
    assert(result?.commitOid, `task ${task.key} has no durable Git result`);
    assert(
      (result.dependencyCommits || []).length === task.dependsOn.length,
      `task ${task.key} has incomplete dependency commit evidence`,
    );
    for (const dependencyKey of task.dependsOn) {
      const binding = result.dependencyCommits.find(
        (entry) => entry.key === dependencyKey,
      );
      const dependency = tasksByKey.get(dependencyKey)?.metadata?.result;
      assert(
        binding?.commitOid === dependency?.commitOid,
        `task ${task.key} inherited a stale ${dependencyKey} commit`,
      );
    }
  }
  return {
    outputs: fixture.tasks.length,
    dependencyEdges: fixture.tasks.reduce(
      (total, task) => total + task.dependsOn.length,
      0,
    ),
    diamondBaselineVerified: fixture.tasks.length >= 5,
  };
}

function verifyGitCleanup(fixture, status, finalized) {
  assert(finalized.merged === true, "finalization did not reach completed");
  assert(
    finalized.finalization.phase === "completed",
    `finalization stopped at ${finalized.finalization.phase}`,
  );
  assert(
    finalized.cleanup.length === fixture.tasks.length &&
      finalized.cleanup.every((entry) => entry.ok === true),
    "finalization did not durably clean every task worktree",
  );
  const worktrees = git(fixture.repo, "worktree", "list", "--porcelain")
    .split(/\r?\n/u)
    .filter((line) => line.startsWith("worktree "));
  assert(worktrees.length === 1, "Git retained a registered task worktree");
  assert(git(fixture.repo, "status", "--porcelain") === "", "base is dirty");
  for (const task of status.tasks) {
    const result = task.metadata?.result;
    assert(
      !fs.existsSync(result.worktreePath),
      `cleaned worktree still exists for ${task.key}`,
    );
    assert(
      git(fixture.repo, "rev-parse", result.branch).toLowerCase() ===
        result.commitOid,
      `retained branch for ${task.key} moved after completion`,
    );
    git(fixture.repo, "merge-base", "--is-ancestor", result.commitOid, "HEAD");
  }
  const baseBranch = git(
    fixture.repo,
    "symbolic-ref",
    "--quiet",
    "--short",
    "HEAD",
  );
  const actualBranches = git(
    fixture.repo,
    "for-each-ref",
    "--format=%(refname:short)",
    "refs/heads",
  )
    .split(/\r?\n/u)
    .filter(Boolean)
    .sort();
  const expectedBranches = [
    baseBranch,
    ...status.tasks.map((task) => task.metadata.result.branch),
  ].sort();
  assert(
    JSON.stringify(actualBranches) === JSON.stringify(expectedBranches),
    "Git retained an unaccounted branch or lost an expected task branch",
  );
  const operationResidue = [
    "MERGE_HEAD",
    "CHERRY_PICK_HEAD",
    "REVERT_HEAD",
    "rebase-merge",
    "rebase-apply",
  ].filter((name) => fs.existsSync(path.join(fixture.repo, ".git", name)));
  assert(
    operationResidue.length === 0,
    `Git operation residue remained: ${operationResidue.join(",")}`,
  );
  const gitLockResidue = [];
  const pending = [path.join(fixture.repo, ".git")];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(target);
      else if (entry.name.endsWith(".lock") || entry.name.includes(".tmp-")) {
        gitLockResidue.push(path.relative(fixture.repo, target));
      }
    }
  }
  assert(
    gitLockResidue.length === 0,
    `Git lock/temp residue remained: ${gitLockResidue.join(",")}`,
  );
  return {
    baseOidBefore: fixture.baseOid,
    baseOidAfter: git(fixture.repo, "rev-parse", "HEAD").toLowerCase(),
    registeredWorktrees: worktrees.length,
    retainedVerifiedTaskBranches: status.tasks.length,
    accountedBranches: actualBranches.length,
    operationResidue,
    lockResidue: gitLockResidue,
  };
}

function verifyCheckpoints(fixture, status, workflowMode) {
  if (workflowMode !== "agent-worktree") {
    return {
      taskManagedCheckpointSupported: false,
      truth:
        "task processes are intentionally not reported as checkpointed on this platform profile",
      transactions: 0,
      terminal: 0,
    };
  }
  const broker = new TeamProcessCheckpointBroker({
    stateDir: fixture.checkpointStateDir,
  });
  const checkpoints = broker.listCheckpoints();
  assert(
    checkpoints.length === fixture.tasks.length,
    `observed ${checkpoints.length} checkpoints for ${fixture.tasks.length} tasks`,
  );
  assert(
    checkpoints.every(
      (checkpoint) =>
        checkpoint.state === "committed" &&
        checkpoint.runId === fixture.runId &&
        checkpoint.evidence?.evidenceDigest,
    ),
    "a task checkpoint is non-terminal or lacks durable evidence",
  );
  const transactionIds = new Set(
    status.tasks.map(
      (task) => task.metadata?.result?.workspaceCheckpoint?.transactionId,
    ),
  );
  assert(
    transactionIds.size === fixture.tasks.length &&
      checkpoints.every((checkpoint) => transactionIds.has(checkpoint.id)),
    "queue results and Process Broker transactions do not match exactly",
  );
  const lockResidues = checkpoints
    .map((checkpoint) => canonicalWorkspaceLockPath(checkpoint.workspaceRoot))
    .filter((lockPath) => fs.existsSync(lockPath));
  assert(
    lockResidues.length === 0,
    "a terminal Process Broker checkpoint retained its canonical workspace lock",
  );
  return {
    taskManagedCheckpointSupported: true,
    coverageTarget: "partial",
    externalSideEffects: true,
    transactions: checkpoints.length,
    terminal: checkpoints.filter((checkpoint) =>
      ["committed", "rolled_back", "aborted"].includes(checkpoint.state),
    ).length,
    committed: checkpoints.filter(
      (checkpoint) => checkpoint.state === "committed",
    ).length,
    lockResidues,
  };
}

function rssTrend(samples, options) {
  const tail = samples.slice(-Math.min(20, samples.length));
  let slopeBytesPerRound = 0;
  if (tail.length >= 2) {
    const xMean = (tail.length - 1) / 2;
    const yMean = tail.reduce((total, value) => total + value, 0) / tail.length;
    let numerator = 0;
    let denominator = 0;
    for (let index = 0; index < tail.length; index += 1) {
      numerator += (index - xMean) * (tail[index] - yMean);
      denominator += (index - xMean) ** 2;
    }
    slopeBytesPerRound = denominator === 0 ? 0 : numerator / denominator;
  }
  const projectedTailGrowth = Math.max(
    0,
    slopeBytesPerRound * Math.max(0, tail.length - 1),
  );
  const maximum = Math.max(0, ...samples);
  return {
    samples: samples.length,
    maximumBytes: maximum,
    tailSamples: tail.length,
    tailSlopeBytesPerRound: Math.round(slopeBytesPerRound),
    projectedTailGrowthBytes: Math.round(projectedTailGrowth),
    absoluteLimitBytes: Math.round(options.maxRssMb * MIB),
    growthLimitBytes: Math.round(options.maxRssGrowthMb * MIB),
    bounded:
      maximum <= options.maxRssMb * MIB &&
      projectedTailGrowth <= options.maxRssGrowthMb * MIB,
  };
}

async function runRound(
  rootDirectory,
  options,
  platformCapability,
  roundIndex,
) {
  const roundSeed =
    (options.seed + Math.imul(roundIndex + 1, 2654435761)) >>> 0;
  const workflowMode = platformCapability.workflowMode;
  const fixture = createFixture(
    rootDirectory,
    roundIndex,
    roundSeed,
    workflowMode,
    options.tasks,
  );
  initDistributedQueue({
    state: fixture.statePath,
    repo: fixture.repo,
    runId: fixture.runId,
    tasks: fixture.graphPath,
    mode: workflowMode,
    managedCheckpoint: workflowMode === "agent-worktree",
    checkpointStateDir:
      workflowMode === "agent-worktree"
        ? fixture.checkpointStateDir
        : undefined,
    maxTasks: fixture.tasks.length + options.crashes,
    agentMaxTokens: workflowMode === "agent-worktree" ? 8 : undefined,
    agentMaxTurns: workflowMode === "agent-worktree" ? 2 : undefined,
    ttlMs: options.ttlMs,
  });
  const configurationPath = path.join(fixture.authority, "worker.json");
  writeJson(configurationPath, {
    statePath: fixture.statePath,
    repo: fixture.repo,
    runId: fixture.runId,
    effectsDir: fixture.effectsDir,
    checkpointStateDir: fixture.checkpointStateDir,
    readyDir: path.join(fixture.authority, "worker-ready"),
    workflowMode,
    workers: options.workers,
    tasks: fixture.tasks.length,
    crashes: options.crashes,
    crashLeaseTtlMs: Math.max(options.ttlMs * 10, 600_000),
    workerTtlMs: options.ttlMs,
    renewEveryMs: Math.max(500, Math.floor(options.ttlMs / 3)),
    pollMs: 25,
    taskDelayMs: options.taskDelayMs,
  });

  const crashedLeases = [];
  const childRssSamples = [];
  for (let index = 0; index < options.crashes; index += 1) {
    const workerId = `pre-exec-crash-${roundIndex}-${index}`;
    const worker = createWorker(
      configurationPath,
      "crash-before-execution",
      workerId,
    );
    const result = await withTimeout(
      worker.done,
      30_000,
      `pre-execution crash ${index}`,
      [worker.child],
    );
    assert(!result.parseError, result.parseError?.message);
    assert(
      result.code === 86 && result.signal == null,
      `crash worker exited ${result.code}/${result.signal}: ${result.stderr}`,
    );
    const claimEvent = result.events.find((event) => event.type === "claimed");
    assert(claimEvent?.claim?.ok, "pre-execution crash did not claim a task");
    crashedLeases.push({
      key: claimEvent.claim.key,
      holder: workerId,
      lease: claimEvent.claim.lease,
    });
    childRssSamples.push(
      ...result.events.map((event) => event.rssBytes).filter(Number.isFinite),
    );
  }

  // Managed checkpoint authority deliberately refuses to auto-replay even a
  // retrySafe task when its owner dies before publishing checkpoint evidence.
  // This injected boundary is known to be before worktree creation and before
  // any external-effect attempt, so exercise the real evidence-bound operator
  // adjudication path before allowing a new fence to run the task.
  const crashStatus = distributedQueueStatus({
    state: fixture.statePath,
    repo: fixture.repo,
    runId: fixture.runId,
    mode: workflowMode,
  });
  const crashAdjudications =
    workflowMode === "agent-worktree"
      ? crashStatus.pendingAdjudications.map((pending, index) => {
          const crashed = crashedLeases.find(
            (entry) => entry.key === pending.key,
          );
          assert(
            crashed,
            `adjudication has no crashed lease for ${pending.key}`,
          );
          const task = crashStatus.tasks.find(
            (candidate) => candidate.key === pending.key,
          );
          const abandoned = task?.metadata?.abandonedLeaseEvidence;
          assert(
            abandoned?.lease?.holder === crashed.holder &&
              abandoned?.lease?.leaseId === crashed.lease.leaseId &&
              abandoned?.lease?.fencingToken === crashed.lease.fencingToken &&
              abandoned?.evidenceDigest === pending.evidenceDigest,
            `crash adjudication for ${pending.key} changed its exact lease evidence`,
          );
          const result = adjudicateDistributedQueue({
            state: fixture.statePath,
            repo: fixture.repo,
            runId: fixture.runId,
            task: pending.key,
            decision: "retry",
            decisionId: `soak-crash-retry-${roundIndex}-${index}`,
            evidenceDigest: pending.evidenceDigest,
            actor: "agent-team-soak",
            reason:
              "injected crash was observed before worktree, checkpoint, and external effect",
          });
          assert(
            result.ok === true &&
              result.decision === "retry" &&
              result.status === "pending",
            `crash adjudication for ${pending.key} did not authorize retry`,
          );
          return {
            key: pending.key,
            evidenceDigest: pending.evidenceDigest,
            decisionId: `soak-crash-retry-${roundIndex}-${index}`,
          };
        })
      : [];
  if (workflowMode === "agent-worktree") {
    assert(
      crashAdjudications.length === crashedLeases.length,
      "managed pre-execution crashes did not enter exact fail-closed adjudication",
    );
  } else {
    assert(
      crashStatus.pendingAdjudications.length === 0,
      "uncheckpointed pre-execution crash unexpectedly requires adjudication",
    );
  }

  const drainMode =
    workflowMode === "agent-worktree" ? "agent-drain" : "shell-drain";
  const workers = Array.from({ length: options.workers }, (_, index) =>
    createWorker(
      configurationPath,
      drainMode,
      `real-worker-${roundIndex}-${index}`,
    ),
  );
  const timeoutMs = Math.max(
    180_000,
    fixture.tasks.length * (process.platform === "win32" ? 45_000 : 20_000),
  );
  const workerResults = await withTimeout(
    Promise.all(workers.map((worker) => worker.done)),
    timeoutMs,
    "real distributed workers",
    workers.map((worker) => worker.child),
  );
  for (const result of workerResults) {
    assert(!result.parseError, result.parseError?.message);
    assert(
      result.code === 0 && result.signal == null,
      `distributed worker exited ${result.code}/${result.signal}: ${
        result.stderr
      } events=${JSON.stringify(result.events).slice(0, 4_000)}`,
    );
    assert(
      result.events.some((event) => event.type === "worker-finished"),
      "distributed worker produced no terminal summary",
    );
    childRssSamples.push(
      ...result.events.map((event) => event.rssBytes).filter(Number.isFinite),
    );
  }
  const workerTaskLimit = Math.ceil(fixture.tasks.length / options.workers);
  const workerExecutionLimits = workerResults.map((result) => {
    const finished = result.events.find(
      (event) => event.type === "worker-finished",
    );
    const executions = Number(finished?.summary?.executions);
    assert(
      finished?.workerId &&
        Number.isSafeInteger(finished.localTaskCap) &&
        finished.localTaskCap === workerTaskLimit,
      "distributed worker did not report its pinned local task ceiling",
    );
    assert(
      Number.isSafeInteger(executions) &&
        executions >= 0 &&
        executions <= workerTaskLimit,
      `worker ${finished.workerId} executed ${executions} tasks above its ${workerTaskLimit}-task ceiling`,
    );
    return {
      workerId: finished.workerId,
      executions,
      limit: finished.localTaskCap,
      withinLimit: true,
    };
  });
  const workerExecutionTotal = workerExecutionLimits.reduce(
    (total, worker) => total + worker.executions,
    0,
  );
  assert(
    workerExecutionTotal === fixture.tasks.length,
    `worker execution evidence accounts for ${workerExecutionTotal}/${fixture.tasks.length} tasks`,
  );
  const productiveWorkers = workerExecutionLimits.filter(
    (worker) => worker.executions > 0,
  ).length;
  assert(
    productiveWorkers >= Math.min(2, options.workers),
    `only ${productiveWorkers} worker process(es) won a real queue claim`,
  );
  assert(
    childRssSamples.every((rss) => rss <= options.maxRssMb * MIB),
    "a worker process exceeded the configured RSS ceiling",
  );

  const status = distributedQueueStatus({
    state: fixture.statePath,
    repo: fixture.repo,
    runId: fixture.runId,
    mode: workflowMode,
  });
  assert(status.stats.total === fixture.tasks.length, "task count changed");
  assert(
    status.stats.completed === fixture.tasks.length &&
      status.stats.leased === 0 &&
      status.stats.adjudicationRequired === 0,
    `distributed queue did not reach a clean terminal state: ${JSON.stringify({
      stats: status.stats,
      tasks: status.tasks.map((task) => ({
        key: task.key,
        status: task.status,
        attempts: task.metadata?.attempts,
        lastError: task.metadata?.lastError,
        adjudication: task.metadata?.adjudication,
      })),
    }).slice(0, 8_000)}`,
  );
  const queue = new TeamDistributedQueue({ filePath: fixture.statePath });
  const budgetBeforeReplay = stableBudgetEvidence(queue.budgetStatus());
  assert(
    budgetBeforeReplay.tasksStarted === fixture.tasks.length + options.crashes,
    "crash/reclaim did not consume the exact global task-start budget",
  );
  assert(
    budgetBeforeReplay.tasksSettled === fixture.tasks.length &&
      budgetBeforeReplay.reservations === 0,
    "global budget retained an unsettled reservation",
  );
  assert(
    budgetBeforeReplay.tokens ===
      (workflowMode === "agent-worktree" ? fixture.tasks.length * 3 : 0),
    "global token accounting does not match deterministic Agent usage",
  );
  assert(
    budgetBeforeReplay.reason === "max-tasks",
    `global budget closed for ${budgetBeforeReplay.reason || "no reason"}`,
  );
  for (const crashed of crashedLeases) {
    const stale = queue.complete(crashed.key, {
      holder: crashed.holder,
      leaseId: crashed.lease.leaseId,
      usage: { input_tokens: 1, output_tokens: 0 },
      result: { staleReplay: true },
    });
    assert(stale.ok === false, "a dead pre-execution lease bypassed fencing");
  }
  assert(
    JSON.stringify(stableBudgetEvidence(queue.budgetStatus())) ===
      JSON.stringify(budgetBeforeReplay),
    "stale crash settlement changed the global budget",
  );

  const preview = finalizeDistributedQueue({
    state: fixture.statePath,
    repo: fixture.repo,
    runId: fixture.runId,
    mode: workflowMode,
  });
  assert(
    preview.preview.length === fixture.tasks.length &&
      preview.preview.every((entry) => entry.clean === true),
    "real Git merge preview was not clean",
  );
  const finalized = finalizeDistributedQueue({
    state: fixture.statePath,
    repo: fixture.repo,
    runId: fixture.runId,
    mode: workflowMode,
    merge: true,
  });
  const effects = verifyExternalEffects(fixture);
  const dag = verifyDagOutputs(fixture, status);
  const checkpoint = verifyCheckpoints(fixture, status, workflowMode);
  const gitEvidence = verifyGitCleanup(fixture, status, finalized);
  const residues = residuePaths(fixture.authority, fixture.repo);
  assert(
    residues.length === 0,
    `queue/checkpoint/Git lock or temp residue remained: ${residues.join(",")}`,
  );
  const terminalQueueSnapshot = queue.snapshot();
  fs.rmSync(fixture.roundDirectory, { recursive: true, force: true });
  assert(
    !fs.existsSync(fixture.roundDirectory),
    "verified round state could not be removed after evidence collection",
  );

  return {
    round: roundIndex,
    seed: roundSeed,
    workflowMode,
    tasks: fixture.tasks.length,
    workers: options.workers,
    productiveWorkers,
    workerExecutionCeiling: {
      limitPerWorker: workerTaskLimit,
      totalExecutions: workerExecutionTotal,
      expectedExecutions: fixture.tasks.length,
      enforced: true,
      workers: workerExecutionLimits,
    },
    preExecutionCrashes: options.crashes,
    reclaimedLeases: crashedLeases.length,
    adjudicatedCrashRetries: crashAdjudications.length,
    rejectedStaleSettlements: crashedLeases.length,
    successfulSettlements: fixture.tasks.length,
    queueRevision: terminalQueueSnapshot.revision,
    maxFence: terminalQueueSnapshot.nextFence - 1,
    budget: budgetBeforeReplay,
    dag,
    effects,
    checkpoint,
    finalization: {
      previewed: preview.preview.length,
      merged: finalized.integration.length,
      cleaned: finalized.cleanup.length,
      phase: finalized.finalization.phase,
    },
    git: gitEvidence,
    residues,
    verifiedRoundStateRemoved: true,
    childRss: {
      samples: childRssSamples.length,
      maximumBytes: Math.max(0, ...childRssSamples),
      limitBytes: Math.round(options.maxRssMb * MIB),
    },
  };
}

async function run(options) {
  const reportOutput = prepareReportOutput(options.output);
  options.output = reportOutput.canonicalPath;
  const expectedSha = options.expectedSha || null;
  const sourceBytes =
    expectedSha == null ? null : verifyExactSourceTree(expectedSha);
  const invocationRepositoryBefore = invocationRepositoryEvidence();
  const commitSha = invocationRepositoryBefore.commitSha;
  const expectedTreeOid = commitTreeOid(expectedSha);
  const headTreeOid = invocationRepositoryBefore.treeOid;
  const trackedWorktree = invocationRepositoryBefore.trackedWorktree;

  const startedAt = new Date();
  const startedMonotonic = performance.now();
  const report = {
    schemaVersion: 2,
    kind: "chainlesschain-cli-team-production-soak",
    success: false,
    startedAt: startedAt.toISOString(),
    finishedAt: null,
    elapsedMs: null,
    targetDurationMs: options.durationMs,
    platform: process.platform,
    architecture: process.arch,
    node: process.version,
    commitSha,
    checkoutEvidence: {
      expectedSha,
      headMatchesExpected:
        expectedSha == null ? null : commitSha === expectedSha,
      expectedTreeOid,
      headTreeOid,
      sourceTreeMatchesExpected:
        expectedSha == null ? null : headTreeOid === expectedTreeOid,
      trackedWorktreeRequired: expectedSha != null,
      trackedWorktree,
      sourceBytes,
      invocationRepository: {
        before: invocationRepositoryBefore,
        afterCleanup: null,
        afterReportWrite: null,
        after: null,
        unchanged: null,
      },
    },
    coverageSemantics: {
      managedProcess: "capability-probe",
      agentExecution: "deterministic-contract",
      faultInjection: "pre-execution-worker-exit",
    },
    seed: options.seed,
    platformCapability: null,
    configuration: {
      workers: options.workers,
      tasksPerRound: options.tasks,
      crashesPerRound: options.crashes,
      ttlMs: options.ttlMs,
      maxRounds: options.maxRounds,
      maxRssMb: options.maxRssMb,
      maxRssGrowthMb: options.maxRssGrowthMb,
      requireManagedAgent: options.requireManagedAgent,
      liveModel: false,
      networkRequired: false,
    },
    totals: {
      rounds: 0,
      tasks: 0,
      workerCrashes: 0,
      adjudicatedCrashRetries: 0,
      successfulSettlements: 0,
      rejectedStaleSettlements: 0,
      confirmedExternalEffects: 0,
      duplicateConfirmedExternalEffects: 0,
      managedTaskCheckpoints: 0,
      finalizedWorktrees: 0,
      residues: 0,
    },
    memory: null,
    rounds: [],
    failures: [],
  };
  const rootDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-team-production-soak-"),
  );
  const parentRssSamples = [];
  const workerMaximumRssSamples = [];
  try {
    assert(
      invocationRepositoryBefore.available,
      "calling repository identity could not be captured before the soak",
    );
    assert(
      expectedSha == null || commitSha === expectedSha,
      `checkout SHA mismatch: expected ${expectedSha}, got ${commitSha || "unavailable"}`,
    );
    assert(
      expectedSha == null || headTreeOid === expectedTreeOid,
      `checkout tree mismatch: expected ${expectedTreeOid || "unavailable"}, got ${headTreeOid || "unavailable"}`,
    );
    assert(
      expectedSha == null || trackedWorktree.available,
      `tracked worktree cleanliness could not be verified: ${
        trackedWorktree.error || `git status exited ${trackedWorktree.status}`
      }`,
    );
    assert(
      expectedSha == null || trackedWorktree.clean,
      `tracked worktree is dirty at expected SHA ${expectedSha}: ${trackedWorktree.changes
        .slice(0, 20)
        .join(", ")}`,
    );
    await loadSoakRuntimeModules();
    report.platformCapability = probeManagedProcessCapability(rootDirectory);
    assert(
      !options.requireManagedAgent ||
        report.platformCapability.managedProcessSupported,
      "this gate requires a passing managed-process capability probe, but the probe failed closed",
    );
    const roundsStartedMonotonic = performance.now();
    while (
      (report.totals.rounds === 0 ||
        performance.now() - roundsStartedMonotonic < options.durationMs) &&
      (options.maxRounds == null || report.totals.rounds < options.maxRounds)
    ) {
      const round = await runRound(
        rootDirectory,
        options,
        report.platformCapability,
        report.totals.rounds,
      );
      report.rounds.push(round);
      report.totals.rounds += 1;
      report.totals.tasks += round.tasks;
      report.totals.workerCrashes += round.preExecutionCrashes;
      report.totals.adjudicatedCrashRetries += round.adjudicatedCrashRetries;
      report.totals.successfulSettlements += round.successfulSettlements;
      report.totals.rejectedStaleSettlements += round.rejectedStaleSettlements;
      report.totals.confirmedExternalEffects += round.effects.confirmed;
      report.totals.duplicateConfirmedExternalEffects +=
        round.effects.duplicateConfirmed;
      report.totals.managedTaskCheckpoints += round.checkpoint.transactions;
      report.totals.finalizedWorktrees += round.finalization.cleaned;
      report.totals.residues += round.residues.length;
      parentRssSamples.push(process.memoryUsage().rss);
      workerMaximumRssSamples.push(round.childRss.maximumBytes);
      report.memory = {
        ...rssTrend(parentRssSamples, options),
        workerMaximaTrend: rssTrend(workerMaximumRssSamples, options),
      };
      assert(
        report.memory.bounded && report.memory.workerMaximaTrend.bounded,
        "parent or worker RSS trend exceeded its bound",
      );
      if (report.totals.rounds % 5 === 0) {
        process.stderr.write(
          `team production soak: ${report.totals.rounds} rounds, ${report.totals.tasks} worktrees\n`,
        );
      }
    }
    assert(report.totals.rounds > 0, "soak completed without a round");
    assert(
      report.totals.successfulSettlements === report.totals.tasks,
      "aggregate settlements do not match real worktree tasks",
    );
    assert(
      report.totals.confirmedExternalEffects === report.totals.tasks &&
        report.totals.duplicateConfirmedExternalEffects === 0,
      "aggregate confirmed external-effect evidence is not exactly once",
    );
    assert(
      report.totals.finalizedWorktrees === report.totals.tasks &&
        report.totals.residues === 0,
      "aggregate finalization or residue validation failed",
    );
    report.success = true;
  } catch (error) {
    report.failures.push({
      name: error?.name || "Error",
      code: error?.code || null,
      message: error?.message || String(error),
      stack: error?.stack || null,
    });
  } finally {
    try {
      await terminateActiveWorkers();
    } catch (error) {
      report.success = false;
      report.failures.push({
        name: error?.name || "Error",
        code: error?.code || null,
        message: error?.message || String(error),
        stack: error?.stack || null,
      });
    }
    try {
      fs.rmSync(rootDirectory, { recursive: true, force: true });
    } catch (error) {
      report.success = false;
      report.failures.push({
        name: error?.name || "Error",
        code: error?.code || null,
        message: `soak temporary-state cleanup failed: ${
          error?.message || String(error)
        }`,
        stack: error?.stack || null,
      });
    }
    const invocationRepositoryAfter = invocationRepositoryEvidence();
    const invocationRepositoryUnchanged = sameInvocationRepository(
      invocationRepositoryBefore,
      invocationRepositoryAfter,
    );
    report.checkoutEvidence.invocationRepository.afterCleanup =
      invocationRepositoryAfter;
    report.checkoutEvidence.invocationRepository.after =
      invocationRepositoryAfter;
    report.checkoutEvidence.invocationRepository.unchanged =
      invocationRepositoryUnchanged;
    if (!invocationRepositoryUnchanged) {
      report.success = false;
      appendRepositoryMutationFailure(report);
    }
    report.finishedAt = new Date().toISOString();
    report.elapsedMs = Math.round(performance.now() - startedMonotonic);
    report.memory ||= {
      ...rssTrend(parentRssSamples, options),
      workerMaximaTrend: rssTrend(workerMaximumRssSamples, options),
    };
    writeReportExclusive(reportOutput, report, invocationRepositoryBefore);
  }
  process.stdout.write(
    `${JSON.stringify({
      success: report.success,
      output: options.output,
      rounds: report.totals.rounds,
      tasks: report.totals.tasks,
      elapsedMs: report.elapsedMs,
      workflowMode: report.platformCapability?.workflowMode || null,
      commitSha: report.commitSha,
      failure: report.failures[0]?.message || null,
    })}\n`,
  );
  return report.success;
}

async function main() {
  sanitizeGitEnvironment(process.env);
  let options;
  try {
    options = parseOptions(process.argv.slice(2), process.env);
    if (options.help) {
      printHelp();
    } else if (options.verifySourceOnly) {
      const sourceBytes = verifyExactSourceTree(options.expectedSha);
      process.stdout.write(
        `${JSON.stringify({
          success: true,
          expectedSha: options.expectedSha,
          sourceBytes,
        })}\n`,
      );
    } else if (!(await run(options))) {
      process.exitCode = 1;
    }
  } catch (error) {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  }
}

const invokedAsMain =
  process.argv[1] != null &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsMain) await main();
