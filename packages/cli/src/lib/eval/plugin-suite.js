import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { runEvalSuite } from "./runner.js";
import { parsePluginManifest } from "../plugin-runtime/manifest.js";
import { encodeName } from "../plugin-runtime/scopes.js";

export const PLUGIN_EVAL_SUITE_SCHEMA = "chainlesschain.plugin-eval-suite/v1";
export const PLUGIN_EVAL_REPORT_SCHEMA = "chainlesschain.plugin-eval-report/v1";
export const PLUGIN_EVAL_HOLDOUT_SCHEMA =
  "chainlesschain.plugin-eval-holdout/v1";

const DEFAULT_SUITE_PATH = "evals/suite.json";
const MAX_SUITE_BYTES = 1024 * 1024;
const MAX_TASKS = 64;
const MAX_FIXTURES_PER_TASK = 128;
const MAX_ASSERTIONS_PER_TASK = 128;
const MAX_FIXTURE_BYTES = 256 * 1024;
const MAX_PLUGIN_FILES = 4096;
const MAX_PLUGIN_ENTRIES = 8192;
const MAX_PLUGIN_DEPTH = 64;
const MAX_PLUGIN_BYTES = 32 * 1024 * 1024;
const MAX_ASSERTION_FILE_BYTES = 4 * 1024 * 1024;
const MAX_RUNTIME_OUTPUT_BYTES = 16 * 1024 * 1024;
const MAX_RUNTIME_TOOL_CALLS = 10_000;
const MAX_TRIGGER_SIGNALS = 256;
const MAX_SAMPLE_RUNS = 20;
const TASK_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u;
const EXPECTATIONS = new Set([
  "should_trigger",
  "should_not_trigger",
  "optional",
]);
const ASSERTION_TYPES = new Set([
  "file_exists",
  "file_absent",
  "file_equals",
  "file_contains",
  "json_equals",
]);
const ARM_ORDERS = new Set(["balanced", "control-first", "candidate-first"]);

function digest(bytes, domain) {
  return `sha256:${crypto
    .createHash("sha256")
    .update(domain)
    .update("\0")
    .update(bytes)
    .digest("hex")}`;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function plainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function boundedString(
  value,
  label,
  max,
  { allowEmpty = false, allowFormatting = false } = {},
) {
  const controls =
    typeof value === "string" && allowFormatting
      ? value.replace(/[\t\r\n]/gu, "")
      : value;
  if (
    typeof value !== "string" ||
    (!allowEmpty && value.trim().length === 0) ||
    value.length > max ||
    /\p{Cc}/u.test(controls)
  ) {
    throw new TypeError(
      `${label} must be a string of at most ${max} characters`,
    );
  }
  return value;
}

function relativeTaskPath(value, label) {
  const raw = boundedString(value, label, 512).replaceAll("\\", "/");
  if (raw.startsWith("/") || /^[a-zA-Z]:\//u.test(raw)) {
    throw new TypeError(`${label} must be relative`);
  }
  const normalized = path.posix.normalize(raw);
  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized === ".chainlesschain" ||
    normalized.startsWith(".chainlesschain/")
  ) {
    throw new TypeError(
      `${label} must stay inside the task workspace and outside .chainlesschain`,
    );
  }
  return normalized;
}

function suiteRelativePath(root, suiteFile) {
  const candidate = path.resolve(root, suiteFile || DEFAULT_SUITE_PATH);
  const relation = path.relative(root, candidate);
  if (
    relation === "" ||
    relation === ".." ||
    relation.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relation)
  ) {
    throw new TypeError(
      "plugin eval suite must be a file inside the plugin root",
    );
  }
  return relation.split(path.sep).join("/");
}

function readBoundedJsonFile(file, label) {
  const target = path.resolve(file);
  const stat = fs.lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new TypeError(`${label} must be a regular file, not a symlink`);
  }
  if (stat.size === 0 || stat.size > MAX_SUITE_BYTES) {
    throw new RangeError(`${label} must be under ${MAX_SUITE_BYTES} bytes`);
  }
  const bytes = fs.readFileSync(target);
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new TypeError(`${label} is not valid JSON`);
  }
  return { target, bytes, value: plainObject(value, label) };
}

function collectPluginSnapshot(root) {
  const rootStat = fs.lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new TypeError("plugin root must be a real directory, not a symlink");
  }
  const files = [];
  let totalBytes = 0;
  let entriesVisited = 0;
  const walk = (directory, relativeDirectory = "", depth = 0) => {
    if (depth > MAX_PLUGIN_DEPTH) {
      throw new RangeError(
        `plugin eval payload exceeds the ${MAX_PLUGIN_DEPTH}-directory depth limit`,
      );
    }
    const entries = fs
      .readdirSync(directory, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (!relativeDirectory && entry.name === ".git") continue;
      entriesVisited += 1;
      if (entriesVisited > MAX_PLUGIN_ENTRIES) {
        throw new RangeError(
          `plugin eval payload exceeds ${MAX_PLUGIN_ENTRIES} filesystem entries`,
        );
      }
      const relative = relativeDirectory
        ? `${relativeDirectory}/${entry.name}`
        : entry.name;
      const absolute = path.join(directory, entry.name);
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) {
        throw new TypeError(`plugin eval refuses symlinks: ${relative}`);
      }
      if (stat.isDirectory()) {
        walk(absolute, relative, depth + 1);
        continue;
      }
      if (!stat.isFile()) {
        throw new TypeError(`plugin eval refuses special files: ${relative}`);
      }
      if (stat.size > MAX_PLUGIN_BYTES - totalBytes) {
        throw new RangeError(
          `plugin eval payload exceeds ${MAX_PLUGIN_BYTES} bytes`,
        );
      }
      const bytes = fs.readFileSync(absolute);
      totalBytes += bytes.length;
      if (
        files.length + 1 > MAX_PLUGIN_FILES ||
        totalBytes > MAX_PLUGIN_BYTES
      ) {
        throw new RangeError(
          `plugin eval payload exceeds ${MAX_PLUGIN_FILES} files or ${MAX_PLUGIN_BYTES} bytes`,
        );
      }
      files.push({ relative, bytes, mode: stat.mode & 0o777 });
    }
  };
  walk(root);
  const hash = crypto.createHash("sha256");
  hash.update("chainlesschain.plugin-eval-payload/v1\0");
  for (const file of files) {
    hash.update(file.relative);
    hash.update("\0");
    hash.update(String(file.bytes.length));
    hash.update("\0");
    hash.update(String(file.mode));
    hash.update("\0");
    hash.update(file.bytes);
    hash.update("\0");
  }
  return {
    files,
    fileCount: files.length,
    byteCount: totalBytes,
    digest: `sha256:${hash.digest("hex")}`,
  };
}

function parseThreshold(value, label, { min = 0, max = 1 } = {}) {
  if (value == null) return null;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  ) {
    throw new RangeError(`${label} must be a number between ${min} and ${max}`);
  }
  return value;
}

function parseSampleRuns(value, label = "sampling.runs") {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_SAMPLE_RUNS) {
    throw new RangeError(
      `${label} must be an integer between 1 and ${MAX_SAMPLE_RUNS}`,
    );
  }
  return value;
}

function parseArmOrder(value, label = "sampling.armOrder") {
  if (!ARM_ORDERS.has(value)) {
    throw new TypeError(
      `${label} must be balanced, control-first, or candidate-first`,
    );
  }
  return value;
}

function normalizeAssertion(value, taskId, index) {
  const assertion = plainObject(value, `task ${taskId} assertion ${index}`);
  if (!ASSERTION_TYPES.has(assertion.type)) {
    throw new TypeError(
      `task ${taskId} assertion ${index} has an unsupported type`,
    );
  }
  const normalized = {
    type: assertion.type,
    path: relativeTaskPath(
      assertion.path,
      `task ${taskId} assertion ${index}.path`,
    ),
  };
  if (["file_equals", "file_contains"].includes(assertion.type)) {
    normalized.value = boundedString(
      assertion.value,
      `task ${taskId} assertion ${index}.value`,
      MAX_FIXTURE_BYTES,
      { allowEmpty: true, allowFormatting: true },
    );
  } else if (assertion.type === "json_equals") {
    if (assertion.value === undefined) {
      throw new TypeError(
        `task ${taskId} assertion ${index}.value is required`,
      );
    }
    const encoded = canonical(assertion.value);
    if (Buffer.byteLength(encoded, "utf8") > MAX_FIXTURE_BYTES) {
      throw new RangeError(
        `task ${taskId} assertion ${index}.value exceeds its size limit`,
      );
    }
    normalized.value = assertion.value;
  }
  return normalized;
}

function normalizeTask(value, index) {
  const task = plainObject(value, `tasks[${index}]`);
  const id = boundedString(task.id, `tasks[${index}].id`, 128);
  if (!TASK_ID.test(id))
    throw new TypeError(`invalid plugin eval task id: ${id}`);
  const expectation = task.expectation || "should_trigger";
  if (!EXPECTATIONS.has(expectation)) {
    throw new TypeError(`task ${id} has an invalid expectation`);
  }
  const fixturesInput = task.fixtures || [];
  if (
    !Array.isArray(fixturesInput) ||
    fixturesInput.length > MAX_FIXTURES_PER_TASK
  ) {
    throw new RangeError(`task ${id} has too many fixtures`);
  }
  let fixtureBytes = 0;
  const fixturePaths = new Set();
  const fixtures = fixturesInput.map((fixtureValue, fixtureIndex) => {
    const fixture = plainObject(
      fixtureValue,
      `task ${id} fixture ${fixtureIndex}`,
    );
    const fixturePath = relativeTaskPath(
      fixture.path,
      `task ${id} fixture ${fixtureIndex}.path`,
    );
    if (fixturePaths.has(fixturePath)) {
      throw new TypeError(
        `task ${id} has duplicate fixture path ${fixturePath}`,
      );
    }
    fixturePaths.add(fixturePath);
    const encoding = fixture.encoding || "utf8";
    if (!new Set(["utf8", "base64"]).has(encoding)) {
      throw new TypeError(
        `task ${id} fixture ${fixtureIndex} has invalid encoding`,
      );
    }
    const content = boundedString(
      fixture.content,
      `task ${id} fixture ${fixtureIndex}.content`,
      MAX_FIXTURE_BYTES,
      { allowEmpty: true, allowFormatting: true },
    );
    const bytes = Buffer.from(content, encoding);
    fixtureBytes += bytes.length;
    if (bytes.length > MAX_FIXTURE_BYTES || fixtureBytes > MAX_SUITE_BYTES) {
      throw new RangeError(`task ${id} fixture content exceeds its size limit`);
    }
    return { path: fixturePath, bytes };
  });
  if (
    !Array.isArray(task.assertions) ||
    task.assertions.length === 0 ||
    task.assertions.length > MAX_ASSERTIONS_PER_TASK
  ) {
    throw new RangeError(
      `task ${id} requires 1-${MAX_ASSERTIONS_PER_TASK} assertions`,
    );
  }
  const assertions = task.assertions.map((assertion, assertionIndex) =>
    normalizeAssertion(assertion, id, assertionIndex),
  );
  const expectedInput = task.expectedFiles || [
    ...new Set(
      assertions
        .filter((assertion) => assertion.type !== "file_absent")
        .map((assertion) => assertion.path),
    ),
  ];
  if (!Array.isArray(expectedInput) || expectedInput.length > 128) {
    throw new RangeError(`task ${id} has too many expectedFiles`);
  }
  const expectedFiles = [
    ...new Set(
      expectedInput.map((file, fileIndex) =>
        relativeTaskPath(file, `task ${id}.expectedFiles[${fileIndex}]`),
      ),
    ),
  ];
  const timeoutMs = task.timeoutMs == null ? undefined : Number(task.timeoutMs);
  if (
    timeoutMs !== undefined &&
    (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 600000)
  ) {
    throw new RangeError(`task ${id}.timeoutMs must be 1000-600000`);
  }
  return {
    id,
    description: boundedString(
      task.description || "",
      `task ${id}.description`,
      1024,
      { allowEmpty: true, allowFormatting: true },
    ),
    prompt: boundedString(task.prompt, `task ${id}.prompt`, 32768, {
      allowFormatting: true,
    }),
    expectation,
    fixtures,
    assertions,
    expectedFiles,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  };
}

export function loadPluginEvalDefinition(pluginRoot, { suiteFile } = {}) {
  const root = path.resolve(pluginRoot);
  const manifest = parsePluginManifest(root);
  if (manifest.ok !== true) {
    throw new TypeError(
      `plugin manifest is invalid: ${manifest.errors.join("; ") || "unknown error"}`,
    );
  }
  const snapshot = collectPluginSnapshot(root);
  const suitePath = suiteRelativePath(root, suiteFile);
  const suiteEntry = snapshot.files.find((file) => file.relative === suitePath);
  if (
    !suiteEntry ||
    suiteEntry.bytes.length === 0 ||
    suiteEntry.bytes.length > MAX_SUITE_BYTES
  ) {
    throw new TypeError(
      `plugin eval suite ${suitePath} must be a non-empty regular file under ${MAX_SUITE_BYTES} bytes`,
    );
  }
  let raw;
  try {
    raw = JSON.parse(suiteEntry.bytes.toString("utf8"));
  } catch {
    throw new TypeError(`plugin eval suite ${suitePath} is not valid JSON`);
  }
  plainObject(raw, "plugin eval suite");
  if (raw.schema !== PLUGIN_EVAL_SUITE_SCHEMA) {
    throw new TypeError(
      `plugin eval suite must use ${PLUGIN_EVAL_SUITE_SCHEMA}`,
    );
  }
  const identity = plainObject(raw.plugin, "plugin eval suite.plugin");
  if (
    identity.name !== manifest.metadata.name ||
    identity.version !== manifest.metadata.version
  ) {
    throw new TypeError(
      "plugin eval suite identity must match the parsed plugin manifest",
    );
  }
  if (
    !Array.isArray(raw.tasks) ||
    raw.tasks.length === 0 ||
    raw.tasks.length > MAX_TASKS
  ) {
    throw new RangeError(`plugin eval suite requires 1-${MAX_TASKS} tasks`);
  }
  const tasks = raw.tasks.map(normalizeTask);
  const ids = new Set(tasks.map((task) => task.id));
  if (ids.size !== tasks.length) {
    throw new TypeError("plugin eval task ids must be unique");
  }
  const thresholds = raw.thresholds || {};
  plainObject(thresholds, "plugin eval suite.thresholds");
  const sampling = raw.sampling || {};
  plainObject(sampling, "plugin eval suite.sampling");
  const maxCandidateCostUsd = parseThreshold(
    thresholds.maxCandidateCostUsd,
    "thresholds.maxCandidateCostUsd",
    { min: 0, max: 1_000_000 },
  );
  return {
    schema: PLUGIN_EVAL_SUITE_SCHEMA,
    pluginRoot: fs.realpathSync(root),
    identity: {
      name: manifest.metadata.name,
      version: manifest.metadata.version,
      skills: manifest.components.skills.map((skill) => skill.name),
    },
    suitePath,
    suiteDigest: digest(
      suiteEntry.bytes,
      "chainlesschain.plugin-eval-suite-bytes/v1",
    ),
    payload: snapshot,
    tasks,
    sampling: {
      runs: parseSampleRuns(sampling.runs ?? 1),
      armOrder: parseArmOrder(sampling.armOrder || "balanced"),
    },
    thresholds: {
      minPassRateDelta:
        parseThreshold(
          thresholds.minPassRateDelta,
          "thresholds.minPassRateDelta",
          { min: -1, max: 1 },
        ) ?? 0,
      maxUnrelatedChangeRate:
        parseThreshold(
          thresholds.maxUnrelatedChangeRate,
          "thresholds.maxUnrelatedChangeRate",
        ) ?? 1,
      maxCandidateCostUsd,
    },
  };
}

/**
 * Attach reviewer-owned tasks from a file outside the plugin payload. The
 * digest is reported separately so an author-controlled payload cannot mutate
 * or silently absorb the holdout corpus.
 */
export function attachPluginEvalHoldout(definition, holdoutFile) {
  if (!holdoutFile) return definition;
  const { target, bytes, value } = readBoundedJsonFile(
    holdoutFile,
    "plugin eval holdout",
  );
  const holdoutReal = fs.realpathSync(target);
  const relation = path.relative(definition.pluginRoot, holdoutReal);
  if (
    relation === "" ||
    (!relation.startsWith(`..${path.sep}`) &&
      relation !== ".." &&
      !path.isAbsolute(relation))
  ) {
    throw new TypeError(
      "plugin eval holdout must be outside the plugin payload root",
    );
  }
  if (value.schema !== PLUGIN_EVAL_HOLDOUT_SCHEMA) {
    throw new TypeError(
      `plugin eval holdout must use ${PLUGIN_EVAL_HOLDOUT_SCHEMA}`,
    );
  }
  const identity = plainObject(value.plugin, "plugin eval holdout.plugin");
  if (
    identity.name !== definition.identity.name ||
    identity.version !== definition.identity.version
  ) {
    throw new TypeError(
      "plugin eval holdout identity must match the parsed plugin manifest",
    );
  }
  if (
    !Array.isArray(value.tasks) ||
    value.tasks.length === 0 ||
    value.tasks.length > MAX_TASKS
  ) {
    throw new RangeError(`plugin eval holdout requires 1-${MAX_TASKS} tasks`);
  }
  const holdoutTasks = value.tasks.map((task, index) => ({
    ...normalizeTask(task, index),
    source: "holdout",
  }));
  if (definition.tasks.length + holdoutTasks.length > MAX_TASKS) {
    throw new RangeError(
      `plugin eval author and holdout tasks may not exceed ${MAX_TASKS}`,
    );
  }
  const ids = new Set(definition.tasks.map((task) => task.id));
  for (const task of holdoutTasks) {
    if (ids.has(task.id)) {
      throw new TypeError(`duplicate plugin eval task id: ${task.id}`);
    }
    ids.add(task.id);
  }
  return {
    ...definition,
    tasks: [
      ...definition.tasks.map((task) => ({
        ...task,
        source: task.source || "author",
      })),
      ...holdoutTasks,
    ],
    holdout: {
      schema: PLUGIN_EVAL_HOLDOUT_SCHEMA,
      // Reports may be shared as CI artifacts; do not disclose the reviewer's
      // absolute workstation path. The digest is the authoritative binding.
      path: path.basename(target),
      digest: digest(bytes, "chainlesschain.plugin-eval-holdout-bytes/v1"),
      tasks: holdoutTasks.length,
      independentFromPayload: true,
    },
  };
}

function materializePlugin(definition, workspace) {
  const nameDir = path.join(
    workspace,
    ".chainlesschain",
    "plugins",
    encodeName(definition.identity.name),
  );
  const versionDir = path.join(nameDir, definition.identity.version);
  for (const file of definition.payload.files) {
    const target = path.join(versionDir, ...file.relative.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, file.bytes, { flag: "wx" });
    fs.chmodSync(target, file.mode);
  }
  fs.writeFileSync(path.join(nameDir, ".active"), definition.identity.version, {
    encoding: "utf8",
    flag: "wx",
  });
}

function readTaskFile(workspace, relative) {
  const segments = relative.split("/");
  let target = workspace;
  try {
    for (const [index, segment] of segments.entries()) {
      target = path.join(target, segment);
      const component = fs.lstatSync(target);
      if (component.isSymbolicLink()) return null;
      if (index < segments.length - 1 && !component.isDirectory()) return null;
    }
    const stat = fs.lstatSync(target);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size > MAX_ASSERTION_FILE_BYTES
    ) {
      return null;
    }
    const workspaceReal = fs.realpathSync(workspace);
    const targetReal = fs.realpathSync(target);
    const relation = path.relative(workspaceReal, targetReal);
    if (
      relation === ".." ||
      relation.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relation)
    ) {
      return null;
    }
    const noFollow = fs.constants.O_NOFOLLOW || 0;
    const descriptor = fs.openSync(target, fs.constants.O_RDONLY | noFollow);
    try {
      const opened = fs.fstatSync(descriptor);
      if (!opened.isFile() || opened.size > MAX_ASSERTION_FILE_BYTES)
        return null;
      return fs.readFileSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
  } catch {
    return null;
  }
}

function checkAssertions(task, workspace) {
  for (const assertion of task.assertions) {
    const bytes = readTaskFile(workspace, assertion.path);
    if (assertion.type === "file_absent") {
      if (bytes !== null) {
        return { pass: false, detail: `${assertion.path} should be absent` };
      }
      continue;
    }
    if (bytes === null) {
      return { pass: false, detail: `${assertion.path} is missing` };
    }
    if (assertion.type === "file_exists") continue;
    const text = bytes.toString("utf8");
    if (assertion.type === "file_equals" && text !== assertion.value) {
      return { pass: false, detail: `${assertion.path} content did not match` };
    }
    if (assertion.type === "file_contains" && !text.includes(assertion.value)) {
      return {
        pass: false,
        detail: `${assertion.path} did not contain the expected text`,
      };
    }
    if (assertion.type === "json_equals") {
      let actual;
      try {
        actual = JSON.parse(text);
      } catch {
        return { pass: false, detail: `${assertion.path} is not valid JSON` };
      }
      if (canonical(actual) !== canonical(assertion.value)) {
        return { pass: false, detail: `${assertion.path} JSON did not match` };
      }
    }
  }
  return { pass: true, detail: "all declarative assertions passed" };
}

function buildTasks(definition, { candidate }) {
  return definition.tasks.map((task) => ({
    id: task.id,
    description: task.description,
    source: task.source || "author",
    prompt: task.prompt,
    expectedFiles: task.expectedFiles,
    ...(task.timeoutMs === undefined ? {} : { timeoutMs: task.timeoutMs }),
    setup(workspace) {
      for (const fixture of task.fixtures) {
        const target = path.join(workspace, ...fixture.path.split("/"));
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, fixture.bytes, { flag: "wx" });
      }
      if (candidate) materializePlugin(definition, workspace);
    },
    check(workspace) {
      return checkAssertions(task, workspace);
    },
  }));
}

function normalizedUsage(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const output = {};
  for (const key of [
    "input_tokens",
    "output_tokens",
    "cache_read_input_tokens",
    "cache_creation_input_tokens",
    "reasoning_tokens",
  ]) {
    const amount = value[key];
    if (typeof amount === "number" && Number.isFinite(amount) && amount >= 0) {
      output[key] = amount;
    }
  }
  return output;
}

export function parsePluginEvalRuntimeMetrics(output, identity) {
  try {
    const serialized = String(output || "");
    if (Buffer.byteLength(serialized, "utf8") > MAX_RUNTIME_OUTPUT_BYTES) {
      return { available: false, pluginTriggered: null };
    }
    const events = serialized
      .split(/\r?\n/u)
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line));
    const terminals = events.filter((event) => event?.type === "result");
    if (terminals.length !== 1 || events.at(-1) !== terminals[0]) {
      return { available: false, pluginTriggered: null };
    }
    const terminal = terminals[0];
    const toolCalls = Array.isArray(terminal.tool_calls)
      ? terminal.tool_calls
      : [];
    if (toolCalls.length > MAX_RUNTIME_TOOL_CALLS) {
      return { available: false, pluginTriggered: null };
    }
    const skillNames = new Set(identity.skills || []);
    const signals = [];
    for (const call of toolCalls) {
      if (call?.plugin === identity.name) {
        if (signals.length < MAX_TRIGGER_SIGNALS) {
          signals.push({
            source: "plugin_attribution",
            tool: call.tool || null,
          });
        }
        continue;
      }
      if (
        call?.tool === "run_skill" &&
        skillNames.has(call?.args?.skill_name)
      ) {
        if (signals.length < MAX_TRIGGER_SIGNALS) {
          signals.push({
            source: "skill_name",
            tool: "run_skill",
            skill: call.args.skill_name,
          });
        }
      }
    }
    const cost = terminal.total_cost_usd;
    return {
      available: true,
      pluginTriggered: signals.length > 0,
      signals,
      usage: normalizedUsage(terminal.usage),
      totalCostUsd:
        typeof cost === "number" && Number.isFinite(cost) && cost >= 0
          ? cost
          : null,
      turns:
        Number.isSafeInteger(terminal.num_turns) && terminal.num_turns >= 0
          ? terminal.num_turns
          : null,
      toolCallCount: toolCalls.length,
    };
  } catch {
    return { available: false, pluginTriggered: null };
  }
}

function instrumentRunAgent(runAgent, identity) {
  return async (input) => {
    const result = await runAgent(input);
    return {
      ...result,
      evaluationMetrics: parsePluginEvalRuntimeMetrics(
        result?.output,
        identity,
      ),
    };
  };
}

function sumUsage(results) {
  const totals = {};
  let cost = 0;
  let costAvailable = true;
  for (const result of results) {
    const metrics = result.evaluationMetrics;
    if (metrics?.usage) {
      for (const [key, value] of Object.entries(metrics.usage)) {
        totals[key] = (totals[key] || 0) + value;
      }
    }
    if (typeof metrics?.totalCostUsd === "number") cost += metrics.totalCostUsd;
    else costAvailable = false;
  }
  return {
    usage: totals,
    totalCostUsd: costAvailable ? cost : null,
  };
}

function projectArm(summary, definition, { candidate }) {
  const byId = new Map(definition.tasks.map((task) => [task.id, task]));
  const results = summary.results.map((result) => {
    const task = byId.get(result.id);
    const metrics = result.evaluationMetrics || {
      available: false,
      pluginTriggered: null,
    };
    const expectation = candidate ? task.expectation : "should_not_trigger";
    const activationPassed =
      metrics.available === true &&
      (expectation === "optional" ||
        (expectation === "should_trigger" &&
          metrics.pluginTriggered === true) ||
        (expectation === "should_not_trigger" &&
          metrics.pluginTriggered === false));
    return {
      ...result,
      source: task.source || "author",
      expectation,
      pluginTriggered: metrics.pluginTriggered,
      activationEvidenceAvailable: metrics.available === true,
      activationPassed,
      effectivePass: result.pass && activationPassed,
    };
  });
  const effectivePassed = results.filter(
    (result) => result.effectivePass,
  ).length;
  const triggered = results.filter(
    (result) => result.pluginTriggered === true,
  ).length;
  return {
    ...summary,
    results,
    effectivePassed,
    effectiveFailed: results.length - effectivePassed,
    effectivePassRate: results.length ? effectivePassed / results.length : 0,
    triggerRate: results.length ? triggered / results.length : 0,
    activationEvidenceComplete: results.every(
      (result) => result.activationEvidenceAvailable,
    ),
    ...sumUsage(results),
  };
}

function reportArm(arm) {
  return {
    passed: arm.passed,
    failed: arm.failed,
    total: arm.total,
    passRate: arm.passRate,
    effectivePassed: arm.effectivePassed,
    effectiveFailed: arm.effectiveFailed,
    effectivePassRate: arm.effectivePassRate,
    artifactChecksPassed: arm.artifactChecksPassed,
    executionsSucceeded: arm.executionsSucceeded,
    unrelatedChangeRate: arm.unrelatedChangeRate,
    tasksWithUnrelatedChanges: arm.tasksWithUnrelatedChanges,
    triggerRate: arm.triggerRate,
    activationEvidenceComplete: arm.activationEvidenceComplete,
    usage: arm.usage,
    totalCostUsd: arm.totalCostUsd,
    ms: arm.ms,
    sampleRuns: arm.sampleRuns,
    results: arm.results,
  };
}

function aggregateArms(arms) {
  const results = arms.flatMap((arm, sampleIndex) =>
    arm.results.map((result) => ({ ...result, sample: sampleIndex + 1 })),
  );
  const total = results.length;
  const measured = results.filter((result) =>
    Array.isArray(result.unrelatedChanges),
  );
  const tasksWithUnrelatedChanges = measured.filter(
    (result) => result.unrelatedChanges.length > 0,
  ).length;
  const passed = results.filter((result) => result.pass).length;
  const effectivePassed = results.filter(
    (result) => result.effectivePass,
  ).length;
  const triggered = results.filter(
    (result) => result.pluginTriggered === true,
  ).length;
  return {
    results,
    passed,
    failed: total - passed,
    total,
    passRate: total > 0 ? passed / total : 0,
    effectivePassed,
    effectiveFailed: total - effectivePassed,
    effectivePassRate: total > 0 ? effectivePassed / total : 0,
    artifactChecksPassed: results.filter((result) => result.artifactCheckPassed)
      .length,
    executionsSucceeded: results.filter((result) => result.executionSucceeded)
      .length,
    tasksWithUnrelatedChanges,
    unrelatedChangeRate: measured.length
      ? tasksWithUnrelatedChanges / measured.length
      : 0,
    triggerRate: total > 0 ? triggered / total : 0,
    activationEvidenceComplete: results.every(
      (result) => result.activationEvidenceAvailable,
    ),
    ...sumUsage(results),
    ms: arms.reduce((totalMs, arm) => totalMs + arm.ms, 0),
    sampleRuns: arms.length,
  };
}

// Wilson score intervals stay well behaved for the small and extreme samples
// common in plugin author evals (unlike p +/- z*sqrt(p(1-p)/n)).
function wilson95(successes, total) {
  if (!Number.isSafeInteger(total) || total <= 0) return null;
  const z = 1.959963984540054;
  const z2 = z * z;
  const p = successes / total;
  const denominator = 1 + z2 / total;
  const center = (p + z2 / (2 * total)) / denominator;
  const radius =
    (z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total)) / denominator;
  return {
    lower: Math.max(0, center - radius),
    upper: Math.min(1, center + radius),
  };
}

function confidenceComparison(control, candidate) {
  const controlInterval = wilson95(control.effectivePassed, control.total);
  const candidateInterval = wilson95(
    candidate.effectivePassed,
    candidate.total,
  );
  if (!controlInterval || !candidateInterval) return null;
  return {
    method: "wilson-95-newcombe-difference",
    control: controlInterval,
    candidate: candidateInterval,
    passRateDelta: {
      lower: candidateInterval.lower - controlInterval.upper,
      upper: candidateInterval.upper - controlInterval.lower,
    },
  };
}

function sampleArmSequence(sampleRuns, armOrder, suiteDigest) {
  if (armOrder === "control-first") {
    return Array.from({ length: sampleRuns }, () => ["control", "candidate"]);
  }
  if (armOrder === "candidate-first") {
    return Array.from({ length: sampleRuns }, () => ["candidate", "control"]);
  }
  // Bind the first arm to the suite digest, then alternate. This balances
  // provider drift without introducing an unrecorded random source.
  const startsWithCandidate =
    Number.parseInt(String(suiteDigest).slice(-2), 16) % 2 === 1;
  return Array.from({ length: sampleRuns }, (_, index) => {
    const candidateFirst = startsWithCandidate
      ? index % 2 === 0
      : index % 2 === 1;
    return candidateFirst ? ["candidate", "control"] : ["control", "candidate"];
  });
}

export async function runPluginEval(
  definition,
  {
    controlRunAgent,
    candidateRunAgent,
    runSuite = runEvalSuite,
    keepWorkspaces = false,
    provider = null,
    model = null,
    dryRun = false,
    minPassRateDelta,
    sampleRuns,
    armOrder,
    onResult,
  } = {},
) {
  if (
    typeof controlRunAgent !== "function" ||
    typeof candidateRunAgent !== "function"
  ) {
    throw new TypeError("controlRunAgent and candidateRunAgent are required");
  }
  const resolvedSampleRuns = parseSampleRuns(
    sampleRuns === undefined ? definition.sampling?.runs || 1 : sampleRuns,
    "sampleRuns",
  );
  const resolvedArmOrder = parseArmOrder(
    armOrder === undefined
      ? definition.sampling?.armOrder || "balanced"
      : armOrder,
    "armOrder",
  );
  const runArm = async (arm, tasks, runAgent, sample) =>
    projectArm(
      await runSuite(tasks, {
        runAgent: instrumentRunAgent(runAgent, definition.identity),
        keepWorkspaces,
        onResult: onResult
          ? (result) => onResult({ arm, sample, result })
          : undefined,
      }),
      definition,
      { candidate: arm === "candidate" },
    );
  const armRuns = { control: [], candidate: [] };
  const sequence = sampleArmSequence(
    resolvedSampleRuns,
    resolvedArmOrder,
    definition.suiteDigest,
  );
  for (const [sampleIndex, orderedArms] of sequence.entries()) {
    for (const arm of orderedArms) {
      const candidate = arm === "candidate";
      armRuns[arm].push(
        await runArm(
          arm,
          buildTasks(definition, { candidate }),
          candidate ? candidateRunAgent : controlRunAgent,
          sampleIndex + 1,
        ),
      );
    }
  }
  const control = aggregateArms(armRuns.control);
  const candidate = aggregateArms(armRuns.candidate);
  const requiredDelta =
    minPassRateDelta === undefined
      ? definition.thresholds.minPassRateDelta
      : parseThreshold(minPassRateDelta, "minPassRateDelta", {
          min: -1,
          max: 1,
        });
  const passRateDelta = candidate.effectivePassRate - control.effectivePassRate;
  const reasons = [];
  if (dryRun) reasons.push("dry_run");
  if (
    !control.activationEvidenceComplete ||
    !candidate.activationEvidenceComplete
  ) {
    reasons.push("activation_evidence_incomplete");
  }
  if (candidate.effectivePassed !== candidate.total) {
    reasons.push("candidate_tasks_failed");
  }
  if (passRateDelta < requiredDelta) reasons.push("minimum_gain_not_met");
  if (
    candidate.unrelatedChangeRate > definition.thresholds.maxUnrelatedChangeRate
  ) {
    reasons.push("unrelated_change_threshold_exceeded");
  }
  if (
    definition.thresholds.maxCandidateCostUsd !== null &&
    (candidate.totalCostUsd === null ||
      candidate.totalCostUsd > definition.thresholds.maxCandidateCostUsd)
  ) {
    reasons.push("candidate_cost_threshold_not_met");
  }
  const uniqueReasons = [...new Set(reasons)];
  const status = dryRun
    ? "INSUFFICIENT_EVIDENCE"
    : uniqueReasons.length
      ? "FAIL"
      : "PASS";
  return {
    schema: PLUGIN_EVAL_REPORT_SCHEMA,
    scope: "local-plugin-eval",
    productionAttested: false,
    status,
    passed: status === "PASS",
    reasons: uniqueReasons,
    plugin: {
      name: definition.identity.name,
      version: definition.identity.version,
      payloadDigest: definition.payload.digest,
      payloadFiles: definition.payload.fileCount,
      payloadBytes: definition.payload.byteCount,
    },
    suite: {
      schema: definition.schema,
      path: definition.suitePath,
      digest: definition.suiteDigest,
      tasks: definition.tasks.length,
    },
    holdout: definition.holdout || null,
    selection: {
      provider,
      model,
      dryRun: dryRun === true,
      sampleRuns: resolvedSampleRuns,
      armOrder: resolvedArmOrder,
    },
    sampling: {
      runs: resolvedSampleRuns,
      armOrder: resolvedArmOrder,
      sequence,
      deterministic: true,
    },
    thresholds: {
      ...definition.thresholds,
      minPassRateDelta: requiredDelta,
    },
    comparison: {
      passRateDelta,
      outcome:
        passRateDelta > 0
          ? "gain"
          : passRateDelta < 0
            ? "regression"
            : "neutral",
    },
    statistics: {
      confidence95: confidenceComparison(control, candidate),
    },
    arms: {
      control: reportArm(control),
      candidate: reportArm(candidate),
    },
  };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderPluginEvalHtml(report) {
  const rows = report.arms.candidate.results
    .map(
      (result) =>
        `<tr><td>${escapeHtml(result.id)}</td><td>${escapeHtml(result.expectation)}</td><td>${escapeHtml(result.pluginTriggered)}</td><td>${escapeHtml(result.effectivePass)}</td><td>${escapeHtml(result.detail || result.error || "")}</td></tr>`,
    )
    .join("");
  return [
    "<!doctype html>",
    '<html lang="en"><head><meta charset="utf-8">',
    `<title>Plugin eval: ${escapeHtml(report.plugin.name)}</title>`,
    "<style>body{font-family:system-ui,sans-serif;margin:2rem;max-width:1100px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:.5rem;text-align:left}code{overflow-wrap:anywhere}</style>",
    "</head><body>",
    `<h1>Plugin eval: ${escapeHtml(report.plugin.name)} ${escapeHtml(report.plugin.version)}</h1>`,
    `<p>Status: <strong>${escapeHtml(report.status)}</strong>; outcome: ${escapeHtml(report.comparison.outcome)}; pass-rate delta: ${escapeHtml(report.comparison.passRateDelta)}</p>`,
    `<p>Payload: <code>${escapeHtml(report.plugin.payloadDigest)}</code><br>Suite: <code>${escapeHtml(report.suite.digest)}</code></p>`,
    "<table><thead><tr><th>Task</th><th>Expectation</th><th>Triggered</th><th>Effective pass</th><th>Detail</th></tr></thead>",
    `<tbody>${rows}</tbody></table>`,
    `<h2>Machine-readable report</h2><pre>${escapeHtml(JSON.stringify(report, null, 2))}</pre>`,
    "</body></html>\n",
  ].join("");
}
