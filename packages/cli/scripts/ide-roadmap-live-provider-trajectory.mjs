import { execFileSync, fork } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  STRUCTURED_HANDOFF_FIELDS,
  parseStructuredHandoff,
} from "../src/harness/structured-handoff.js";
import { IterationBudget } from "../src/lib/iteration-budget.js";
import { agentLoop } from "../src/runtime/agent-core.js";
import {
  IDE_ROADMAP_MANIFEST_VERSION,
  IDE_ROADMAP_RUNTIME_EVIDENCE_SCHEMA,
  IDE_ROADMAP_RUNTIME_EVIDENCE_SCHEMA_VERSION,
  createIdeRoadmapRuntimeEvidenceDigest,
  verifyIdeRoadmapFixtures,
} from "./verify-ide-roadmap-fixtures.mjs";

export const LIVE_PROVIDER_TRAJECTORY_CASE = "s0-live-provider-trajectory";
export const LIVE_PROVIDER_TRAJECTORY_SCHEMA =
  "chainlesschain.ide-roadmap-live-provider-trajectory.v1";
export const LIVE_PROVIDER_TRAJECTORY_SCHEMA_VERSION = 1;
export const LIVE_PROVIDER_TRAJECTORY_FAILURE_SCHEMA =
  "chainlesschain.ide-roadmap-live-provider-trajectory-failure.v1";
export const LIVE_PROVIDER_TRAJECTORY_AGGREGATE_SCHEMA =
  "chainlesschain.ide-roadmap-live-provider-trajectory-aggregate.v1";
export const LIVE_PROVIDER_TRAJECTORY_FIXTURE =
  "tests/fixtures/ide-roadmap/s0-live-provider-trajectory.json";
export const LIVE_PROVIDER_TRAJECTORY_REQUIRED_ARTIFACTS = Object.freeze([
  "exact-commit",
  "fixture-contract",
  "structured-handoff-trajectories",
  "provider-usage",
  "read-only-tool-sequence",
  "redacted-event-order",
  "credential-boundary",
]);

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = path.resolve(SCRIPT_DIRECTORY, "../../..");
const LOOPBACK_CHILD = path.resolve(
  SCRIPT_DIRECTORY,
  "../__tests__/fixtures/live-provider-trajectory-openai-server.mjs",
);
const CLI_PACKAGE_PATH = path.resolve(SCRIPT_DIRECTORY, "../package.json");
const GIT_OID_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
const FACT_ID_PATTERN = /^\[([A-Z]+-[0-9]{3})\]/;
const CLOUD_PROVIDERS = new Set([
  "anthropic",
  "openai",
  "deepseek",
  "dashscope",
  "mistral",
  "gemini",
  "volcengine",
]);
const MODE_TRANSPORT = Object.freeze({
  loopback: "loopback-http",
  live: "external-live-provider",
});
const EXPECTED_OUTCOME = Object.freeze({
  semanticCompactionCount: 2,
  structuredHandoffSchemaStable: true,
  frozenFactRetentionRate: 1,
  silentLossCount: 0,
  providerUsageKnown: true,
  readOnlyToolSequenceCount: 2,
  credentialLeakCount: 0,
});
const FACT_FIELD_PREFIXES = Object.freeze({
  objective: "OBJ",
  constraints: "CON",
  keyDecisions: "DEC",
  changedFiles: "FILE",
  tests: "TEST",
  unresolvedSideEffects: "SIDE",
  checkpoints: "CHK",
  blockers: "BLK",
  nextSteps: "NEXT",
});
const EXPECTED_EVENT_ORDER = Object.freeze([
  "run-started",
  "semantic-compaction:model-usage-started",
  "compaction",
  "semantic-compaction:token-usage",
  "model:model-usage-started",
  "model:token-usage",
  "tool:read_file:started",
  "tool:read_file:settled",
  "model:model-usage-started",
  "model:token-usage",
  "response-complete",
  "run-ended:complete",
]);
const FAILURE_CODES = new Set([
  "invalid_arguments",
  "invalid_release_commit",
  "release_commit_mismatch",
  "fixture_invalid",
  "loopback_start_failed",
  "loopback_audit_failed",
  "missing_live_provider_secret",
  "missing_live_provider",
  "missing_live_model",
  "unsupported_live_provider",
  "trajectory_timeout",
  "trajectory_invariant_failed",
  "provider_trajectory_failed",
  "evidence_write_failed",
  "evidence_verification_failed",
]);
const FORBIDDEN_EVIDENCE_KEYS = new Set([
  "apikey",
  "api_key",
  "authorization",
  "headers",
  "prompt",
  "requestbody",
  "rawrequest",
  "rawresponse",
  "baseurl",
  "content",
  "responsebody",
  "toolresult",
]);

export class LiveProviderTrajectoryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "LiveProviderTrajectoryError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new LiveProviderTrajectoryError(code, message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(stableValue(value));
}

function sha256Bytes(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function sha256Json(value) {
  return sha256Bytes(canonicalJson(value));
}

function platformName(value = process.platform) {
  if (value === "win32") return "windows";
  if (value === "darwin") return "macos";
  if (value === "linux") return "linux";
  return value;
}

function exactTimestamp(value, label) {
  if (
    typeof value !== "string" ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(Date.parse(value)).toISOString() !== value
  ) {
    fail(
      "evidence_verification_failed",
      `${label} is not an exact UTC timestamp`,
    );
  }
  return Date.parse(value);
}

function positiveInteger(value, label, maximum = 1000) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > maximum) {
    fail(
      "invalid_arguments",
      `${label} must be an integer between 1 and ${maximum}`,
    );
  }
  return number;
}

function safeModelIdentifier(value, label) {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(value)
  ) {
    fail(
      "invalid_arguments",
      `${label} must be a bounded provider model identifier`,
    );
  }
  return value;
}

function readJson(filePath, code = "fixture_invalid") {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    fail(code, "required JSON input is unavailable or invalid");
  }
}

function fixtureKeys(value, expected, label) {
  if (
    !isRecord(value) ||
    canonicalJson(Object.keys(value).sort()) !==
      canonicalJson([...expected].sort())
  ) {
    fail("fixture_invalid", `${label} has missing or unknown fields`);
  }
}

function boundedFixtureString(value, label, maximum = 1000) {
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    value !== value.trim() ||
    value.length > maximum ||
    /\p{Cc}/u.test(value)
  ) {
    fail("fixture_invalid", `${label} must be a bounded exact string`);
  }
  return value;
}

function fixturePath(repoRoot) {
  return path.join(repoRoot, ...LIVE_PROVIDER_TRAJECTORY_FIXTURE.split("/"));
}

function loadFixture(repoRoot) {
  const filePath = fixturePath(repoRoot);
  let fixtureStat;
  try {
    fixtureStat = fs.statSync(filePath);
  } catch {
    fail("fixture_invalid", "live provider trajectory fixture is unavailable");
  }
  if (!fixtureStat.isFile() || fixtureStat.size > 128 * 1024) {
    fail(
      "fixture_invalid",
      "live provider trajectory fixture exceeds its size bound",
    );
  }
  const fixture = readJson(filePath);
  fixtureKeys(
    fixture,
    [
      "schemaVersion",
      "case",
      "trajectoryVersion",
      "noiseMessagesPerCycle",
      "cycles",
      "expected",
    ],
    "fixture",
  );
  if (
    fixture?.schemaVersion !== 1 ||
    fixture?.case !== LIVE_PROVIDER_TRAJECTORY_CASE ||
    fixture?.trajectoryVersion !== "1.0.0" ||
    fixture.noiseMessagesPerCycle !== 56 ||
    !Array.isArray(fixture.cycles) ||
    fixture.cycles.length !== 2 ||
    canonicalJson(fixture.expected) !== canonicalJson(EXPECTED_OUTCOME)
  ) {
    fail(
      "fixture_invalid",
      "live provider trajectory fixture contract is invalid",
    );
  }
  const seenFactIds = new Set();
  for (const [index, cycle] of fixture.cycles.entries()) {
    fixtureKeys(cycle, ["id", "factDelta", "tool"], `fixture.cycles[${index}]`);
    fixtureKeys(
      cycle.factDelta,
      index === 0
        ? STRUCTURED_HANDOFF_FIELDS
        : STRUCTURED_HANDOFF_FIELDS.slice(1),
      `fixture.cycles[${index}].factDelta`,
    );
    fixtureKeys(
      cycle.tool,
      ["name", "path", "content", "completionMarker"],
      `fixture.cycles[${index}].tool`,
    );
    if (
      cycle?.id !== `cycle-${index + 1}` ||
      !isRecord(cycle.factDelta) ||
      cycle.tool?.name !== "read_file" ||
      typeof cycle.tool.path !== "string" ||
      typeof cycle.tool.content !== "string" ||
      typeof cycle.tool.completionMarker !== "string"
    ) {
      fail("fixture_invalid", "live provider trajectory cycle is invalid");
    }
    for (const field of STRUCTURED_HANDOFF_FIELDS) {
      if (field === "objective" && index > 0) continue;
      const values =
        field === "objective"
          ? [cycle.factDelta[field]]
          : cycle.factDelta[field];
      if (!Array.isArray(values) || values.length !== 1) {
        fail(
          "fixture_invalid",
          `fixture cycle fact field ${field} must contain exactly one fact`,
        );
      }
      for (const [factIndex, value] of values.entries()) {
        boundedFixtureString(value, `${field}[${factIndex}]`);
        const id = factId(value, `${field}[${factIndex}]`);
        if (!id.startsWith(`${FACT_FIELD_PREFIXES[field]}-`)) {
          fail(
            "fixture_invalid",
            `${field}[${factIndex}] uses the wrong fact-ID namespace`,
          );
        }
        if (seenFactIds.has(id)) {
          fail("fixture_invalid", `fact ID ${id} is duplicated`);
        }
        seenFactIds.add(id);
      }
    }
    boundedFixtureString(
      cycle.tool.path,
      `fixture.cycles[${index}].tool.path`,
      128,
    );
    boundedFixtureString(
      cycle.tool.content.trimEnd(),
      `fixture.cycles[${index}].tool.content`,
      256,
    );
    boundedFixtureString(
      cycle.tool.completionMarker,
      `fixture.cycles[${index}].tool.completionMarker`,
      128,
    );
    if (
      path.isAbsolute(cycle.tool.path) ||
      cycle.tool.path.includes("..") ||
      path.basename(cycle.tool.path) !== cycle.tool.path ||
      (index > 0 &&
        (cycle.tool.path !== fixture.cycles[0].tool.path ||
          cycle.tool.content !== fixture.cycles[0].tool.content ||
          cycle.tool.completionMarker ===
            fixture.cycles[0].tool.completionMarker))
    ) {
      fail(
        "fixture_invalid",
        "fixture tool target or completion markers are unsafe",
      );
    }
  }
  let roadmapCase;
  try {
    roadmapCase = verifyIdeRoadmapFixtures({ repoRoot }).cases.find(
      (entry) => entry.id === LIVE_PROVIDER_TRAJECTORY_CASE,
    );
  } catch {
    fail("fixture_invalid", "IDE roadmap manifest contract is invalid");
  }
  if (
    !roadmapCase ||
    roadmapCase.fixture !== LIVE_PROVIDER_TRAJECTORY_FIXTURE
  ) {
    fail(
      "fixture_invalid",
      "live provider trajectory manifest binding is invalid",
    );
  }
  return {
    fixture,
    filePath,
    digest: sha256Bytes(fs.readFileSync(filePath)),
    roadmapCase,
  };
}

function cumulativeHandoff(fixture, cycleIndex) {
  const handoff = Object.fromEntries(
    STRUCTURED_HANDOFF_FIELDS.map((field, index) => [
      field,
      index === 0 ? "" : [],
    ]),
  );
  for (const cycle of fixture.cycles.slice(0, cycleIndex + 1)) {
    if (typeof cycle.factDelta.objective === "string") {
      handoff.objective = cycle.factDelta.objective;
    }
    for (const field of STRUCTURED_HANDOFF_FIELDS.slice(1)) {
      if (Array.isArray(cycle.factDelta[field])) {
        handoff[field].push(...cycle.factDelta[field]);
      }
    }
  }
  return handoff;
}

function factId(value, label) {
  const match = typeof value === "string" ? value.match(FACT_ID_PATTERN) : null;
  if (!match)
    fail("fixture_invalid", `${label} must begin with an opaque fact ID`);
  return match[1];
}

function factIdsByField(handoff) {
  return Object.fromEntries(
    STRUCTURED_HANDOFF_FIELDS.map((field) => [
      field,
      field === "objective"
        ? [factId(handoff[field], field)]
        : handoff[field].map((value, index) =>
            factId(value, `${field}[${index}]`),
          ),
    ]),
  );
}

function fieldDigests(handoff) {
  return Object.fromEntries(
    STRUCTURED_HANDOFF_FIELDS.map((field) => [
      field,
      sha256Json(handoff[field]),
    ]),
  );
}

function noiseContent(cycleIndex, messageIndex) {
  const ordinal = cycleIndex * 56 + messageIndex;
  const first =
    ordinal < 103 ? 0x3400 + ordinal * 48 : 0x4e00 + (ordinal - 103) * 48;
  return Array.from({ length: 48 }, (_, offset) =>
    String.fromCodePoint(first + offset),
  )
    .join("")
    .repeat(5);
}

function appendCycleMessages(messages, fixture, cycleIndex) {
  const cycle = fixture.cycles[cycleIndex];
  messages.push({
    role: "user",
    content:
      `Trajectory fact delta for ${cycle.id}. Preserve every tagged fact in its ` +
      `matching canonical structured-handoff field:\n${JSON.stringify(cycle.factDelta)}`,
  });
  for (let index = 0; index < fixture.noiseMessagesPerCycle; index += 1) {
    messages.push({
      role: index % 2 === 0 ? "assistant" : "user",
      content: noiseContent(cycleIndex, index),
    });
  }
  messages.push({
    role: "assistant",
    content: `Safe trajectory context bridge ${cycleIndex + 1}.`,
  });
  messages.push({
    role: "user",
    content:
      `For ${cycle.id}, call read_file exactly once with ` +
      `${JSON.stringify({ path: cycle.tool.path })}. Do not call any other tool. ` +
      `After the tool result, reply with exactly ${cycle.tool.completionMarker}.`,
  });
}

function resolveGitHead(repoRoot) {
  let head;
  try {
    head = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    fail(
      "invalid_release_commit",
      "unable to resolve the checked-out Git HEAD",
    );
  }
  if (!GIT_OID_PATTERN.test(head)) {
    fail(
      "invalid_release_commit",
      "checked-out Git HEAD is not an exact commit",
    );
  }
  return head;
}

function exactReleaseCommit(value, repoRoot, verifyHead = true) {
  if (typeof value !== "string" || !GIT_OID_PATTERN.test(value)) {
    fail(
      "invalid_release_commit",
      "release commit must be a lowercase 40-character Git OID",
    );
  }
  if (verifyHead && resolveGitHead(repoRoot) !== value) {
    fail(
      "release_commit_mismatch",
      "release commit does not equal checked-out Git HEAD",
    );
  }
  return value;
}

export function resolveLiveProviderTrajectoryProfile({
  mode,
  env = process.env,
  loopbackBaseUrl = null,
} = {}) {
  if (mode === "loopback") {
    if (typeof loopbackBaseUrl !== "string" || !loopbackBaseUrl) {
      fail(
        "loopback_start_failed",
        "loopback provider endpoint is unavailable",
      );
    }
    return {
      mode,
      provider: "openai",
      model: "cc-live-trajectory-loopback-v1",
      apiKey: "cc-loopback-non-secret",
      baseUrl: loopbackBaseUrl,
      transport: MODE_TRANSPORT.loopback,
    };
  }
  if (mode !== "live") {
    fail("invalid_arguments", "mode must be loopback or live");
  }
  const provider = String(env.CC_LLM_PROVIDER || "").trim();
  const model = String(env.CC_LLM_MODEL || "").trim();
  const apiKey = String(env.CC_LLM_API_KEY || "").trim();
  if (!provider) fail("missing_live_provider", "CC_LLM_PROVIDER is required");
  if (!model) fail("missing_live_model", "CC_LLM_MODEL is required");
  if (!apiKey) {
    fail("missing_live_provider_secret", "CC_LLM_API_KEY is required");
  }
  if (!CLOUD_PROVIDERS.has(provider)) {
    fail(
      "unsupported_live_provider",
      "configured live provider is not allowed",
    );
  }
  safeModelIdentifier(model, "CC_LLM_MODEL");
  return {
    mode,
    provider,
    model,
    apiKey,
    baseUrl: null,
    transport: MODE_TRANSPORT.live,
  };
}

function startLoopbackServer(fixtureFile) {
  const child = fork(LOOPBACK_CHILD, [fixtureFile], {
    stdio: ["ignore", "ignore", "ignore", "ipc"],
    execArgv: [],
  });
  let closed = false;
  let startupSettled = false;
  const started = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!startupSettled) {
        startupSettled = true;
        child.kill();
        reject(
          new LiveProviderTrajectoryError(
            "loopback_start_failed",
            "loopback provider did not become ready",
          ),
        );
      }
    }, 10_000);
    child.on("message", (message) => {
      if (startupSettled) return;
      if (message?.type === "listening" && Number.isInteger(message.port)) {
        startupSettled = true;
        clearTimeout(timer);
        resolve(`http://127.0.0.1:${message.port}/v1`);
      } else if (message?.type === "startup-error") {
        startupSettled = true;
        clearTimeout(timer);
        reject(
          new LiveProviderTrajectoryError(
            "loopback_start_failed",
            "loopback provider rejected its fixture",
          ),
        );
      }
    });
    child.once("exit", () => {
      if (!startupSettled) {
        startupSettled = true;
        clearTimeout(timer);
        reject(
          new LiveProviderTrajectoryError(
            "loopback_start_failed",
            "loopback provider exited before readiness",
          ),
        );
      }
    });
  });

  const close = () => {
    if (closed) return Promise.resolve(null);
    closed = true;
    return new Promise((resolve) => {
      let audit = null;
      const timer = setTimeout(() => {
        child.kill();
        resolve(audit);
      }, 5_000);
      child.on("message", (message) => {
        if (message?.type === "audit") audit = message;
      });
      child.once("exit", () => {
        clearTimeout(timer);
        resolve(audit);
      });
      if (child.connected) child.send({ type: "close" });
      else {
        clearTimeout(timer);
        resolve(audit);
      }
    });
  };
  return { child, started, close };
}

function eventLabel(event) {
  if (event?.type === "model-usage-started") {
    return `${event.source || "model"}:model-usage-started`;
  }
  if (event?.type === "token-usage") {
    return `${event.source || "model"}:token-usage`;
  }
  if (event?.type === "tool-executing") {
    return `tool:${event.tool}:started`;
  }
  if (event?.type === "tool-result") {
    return `tool:${event.tool}:settled`;
  }
  if (event?.type === "run-ended") return `run-ended:${event.reason}`;
  return String(event?.type || "unknown-event");
}

function normalizedUsage(event, phase) {
  const usage = event?.usage;
  const inputTokens = usage?.input_tokens ?? usage?.prompt_tokens;
  const outputTokens = usage?.output_tokens ?? usage?.completion_tokens;
  const cacheReadTokens = usage?.cache_read_input_tokens ?? 0;
  const cacheCreationTokens = usage?.cache_creation_input_tokens ?? 0;
  for (const value of [
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
  ]) {
    if (!Number.isSafeInteger(value) || value < 0) {
      fail(
        "trajectory_invariant_failed",
        "provider usage is missing or invalid",
      );
    }
  }
  return {
    phase,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
  };
}

function latestStructuredHandoff(messages) {
  const summary = [...messages]
    .reverse()
    .find(
      (message) =>
        message?.role === "system" &&
        typeof message.content === "string" &&
        message.content.startsWith("[Conversation Summary]\n"),
    );
  if (!summary) {
    fail(
      "trajectory_invariant_failed",
      "semantic compaction did not persist a handoff",
    );
  }
  return parseStructuredHandoff(
    summary.content.slice("[Conversation Summary]\n".length),
  );
}

function ensureCycleOutcome({
  cycle,
  cycleIndex,
  fixture,
  messages,
  events,
  eventOrder,
}) {
  if (canonicalJson(eventOrder) !== canonicalJson(EXPECTED_EVENT_ORDER)) {
    fail(
      "trajectory_invariant_failed",
      "production event order did not match the trajectory contract",
    );
  }
  const forbidden = new Set([
    "compaction-degraded",
    "compaction-usage-unknown",
    "model-usage-unknown",
    "iteration-budget-exhausted",
  ]);
  if (events.some((event) => forbidden.has(event?.type))) {
    fail(
      "trajectory_invariant_failed",
      "a degraded or unknown provider event was observed",
    );
  }
  const compactions = events.filter((event) => event?.type === "compaction");
  if (
    compactions.length !== 1 ||
    compactions[0]?.stats?.summaryMode !== "llm-structured" ||
    compactions[0]?.stats?.degraded === true
  ) {
    fail(
      "trajectory_invariant_failed",
      "semantic compaction was not a structured provider handoff",
    );
  }

  const expectedHandoff = cumulativeHandoff(fixture, cycleIndex);
  const actualHandoff = latestStructuredHandoff(messages);
  const expectedIds = factIdsByField(expectedHandoff);
  const actualIds = factIdsByField(actualHandoff);
  const missingByField = Object.fromEntries(
    STRUCTURED_HANDOFF_FIELDS.map((field) => [
      field,
      expectedIds[field].filter((id) => !actualIds[field].includes(id)),
    ]),
  );
  const expectedFactCount = Object.values(expectedIds).flat().length;
  const missingFactCount = Object.values(missingByField).flat().length;
  if (
    missingFactCount !== 0 ||
    canonicalJson(actualHandoff) !== canonicalJson(expectedHandoff)
  ) {
    fail(
      "trajectory_invariant_failed",
      "structured handoff lost or moved a tagged fact",
    );
  }

  const executing = events.filter((event) => event?.type === "tool-executing");
  const settled = events.filter((event) => event?.type === "tool-result");
  if (
    executing.length !== 1 ||
    executing[0]?.tool !== "read_file" ||
    canonicalJson(executing[0]?.args) !==
      canonicalJson({ path: cycle.tool.path }) ||
    settled.length !== 1 ||
    settled[0]?.tool !== "read_file" ||
    settled[0]?.error != null ||
    settled[0]?.result?.error != null ||
    settled[0]?.result?.content !== cycle.tool.content
  ) {
    fail(
      "trajectory_invariant_failed",
      "read-only tool sequence did not match the fixture",
    );
  }
  const completions = events.filter(
    (event) => event?.type === "response-complete",
  );
  if (
    completions.length !== 1 ||
    completions[0]?.content !== cycle.tool.completionMarker
  ) {
    fail(
      "trajectory_invariant_failed",
      "provider completion marker did not match the fixture",
    );
  }

  const usageEvents = events.filter((event) => event?.type === "token-usage");
  if (usageEvents.length !== 3) {
    fail(
      "trajectory_invariant_failed",
      "cycle did not settle all three provider calls",
    );
  }
  const usage = usageEvents.map((event, index) =>
    normalizedUsage(
      event,
      index === 0
        ? "semantic-compaction"
        : index === 1
          ? "model-before-tool"
          : "model-after-tool",
    ),
  );

  return {
    cycleId: cycle.id,
    eventOrder: [...eventOrder],
    handoffFields: [...STRUCTURED_HANDOFF_FIELDS],
    handoffDigest: sha256Json(actualHandoff),
    handoffFieldDigests: fieldDigests(actualHandoff),
    retention: {
      expectedFactIdsByField: expectedIds,
      retainedFactIdsByField: actualIds,
      missingFactIdsByField: missingByField,
      expectedFactCount,
      retainedFactCount: expectedFactCount - missingFactCount,
      retentionRate:
        expectedFactCount === 0
          ? 1
          : (expectedFactCount - missingFactCount) / expectedFactCount,
    },
    usage,
    tool: {
      name: "read_file",
      argumentPathDigest: sha256Json(cycle.tool.path),
      expectedContentDigest: sha256Bytes(cycle.tool.content),
      resultDigest: sha256Json({
        content: settled[0].result.content,
        hashed: settled[0].result.hashed === true,
        error: settled[0].result.error || null,
      }),
      executingCount: 1,
      settledCount: 1,
      errorCount: 0,
    },
    completionMarkerDigest: sha256Bytes(cycle.tool.completionMarker),
  };
}

async function runOneTrajectory({ fixture, profile, runIndex, timeoutMs }) {
  const startedAt = new Date().toISOString();
  const workspace = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-live-trajectory-"),
  );
  fs.writeFileSync(
    path.join(workspace, fixture.cycles[0].tool.path),
    fixture.cycles[0].tool.content,
    { encoding: "utf8", mode: 0o600 },
  );
  const messages = [];
  const cycles = [];
  let currentEventOrder = null;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error("trajectory timeout")),
    timeoutMs,
  );
  const options = {
    provider: profile.provider,
    model: profile.model,
    ...(profile.baseUrl ? { baseUrl: profile.baseUrl } : {}),
    apiKey: profile.apiKey,
    cwd: workspace,
    enabledToolNames: ["read_file"],
    exactToolNames: true,
    hermeticExecution: true,
    autoCompact: true,
    autoMicroCompact: false,
    runnableProviderFallback: false,
    strictUsageTelemetry: true,
    compactionMaxOutputTokens: 2048,
    maxOutputTokens: 2048,
    signal: controller.signal,
    onUsageBoundary(boundary) {
      if (boundary?.source !== "semantic-compaction" || !currentEventOrder) {
        fail(
          "trajectory_invariant_failed",
          "unexpected compaction usage boundary",
        );
      }
      currentEventOrder.push("semantic-compaction:model-usage-started");
    },
  };

  try {
    for (const [cycleIndex, cycle] of fixture.cycles.entries()) {
      appendCycleMessages(messages, fixture, cycleIndex);
      const events = [];
      const eventOrder = [];
      currentEventOrder = eventOrder;
      options.iterationBudget = new IterationBudget({
        limit: 6,
        owner: `${LIVE_PROVIDER_TRAJECTORY_CASE}-${runIndex}-${cycle.id}`,
      });
      try {
        for await (const event of agentLoop(messages, options)) {
          eventOrder.push(eventLabel(event));
          events.push(event);
        }
      } catch (error) {
        if (controller.signal.aborted) {
          fail(
            "trajectory_timeout",
            "provider trajectory exceeded its timeout",
          );
        }
        if (error instanceof LiveProviderTrajectoryError) throw error;
        fail(
          "provider_trajectory_failed",
          "provider trajectory did not complete",
        );
      }
      const evidence = ensureCycleOutcome({
        cycle,
        cycleIndex,
        fixture,
        messages,
        events,
        eventOrder,
      });
      cycles.push(evidence);
      const completion = events.find(
        (event) => event?.type === "response-complete",
      );
      const lastMessage = messages.at(-1);
      if (
        lastMessage?.role !== "assistant" ||
        lastMessage?.content !== completion.content
      ) {
        // agentLoop currently leaves ordinary final answers to its host to
        // persist. Keep that host responsibility, while avoiding duplication if
        // the production loop later starts appending the final answer itself.
        messages.push({ role: "assistant", content: completion.content });
      }
      currentEventOrder = null;
    }
  } finally {
    clearTimeout(timer);
    fs.rmSync(workspace, { recursive: true, force: true });
  }

  return {
    runIndex,
    startedAt,
    finishedAt: new Date().toISOString(),
    cycles,
  };
}

function artifactDigests({ releaseCommit, fixtureDigest, trajectory }) {
  return {
    "exact-commit": sha256Json(releaseCommit),
    "fixture-contract": fixtureDigest,
    "structured-handoff-trajectories": sha256Json(
      trajectory.cycles.map((cycle) => ({
        cycleId: cycle.cycleId,
        handoffDigest: cycle.handoffDigest,
        retention: cycle.retention,
      })),
    ),
    "provider-usage": sha256Json(trajectory.cycles.map((cycle) => cycle.usage)),
    "read-only-tool-sequence": sha256Json(
      trajectory.cycles.map((cycle) => cycle.tool),
    ),
    "redacted-event-order": sha256Json(
      trajectory.cycles.map((cycle) => cycle.eventOrder),
    ),
    "credential-boundary": sha256Json({
      rawProviderMaterialPersisted: false,
      secretStorage: false,
      evidenceProfile: "digest-and-identifier-allowlist-v1",
    }),
  };
}

function buildRun({
  releaseCommit,
  fixture,
  fixtureDigest,
  profile,
  cliVersion,
  execution,
}) {
  const allCycles = execution.cycles;
  const expectedFactCount = allCycles.reduce(
    (total, cycle) => total + cycle.retention.expectedFactCount,
    0,
  );
  const retainedFactCount = allCycles.reduce(
    (total, cycle) => total + cycle.retention.retainedFactCount,
    0,
  );
  const trajectory = {
    schema: LIVE_PROVIDER_TRAJECTORY_SCHEMA,
    schemaVersion: LIVE_PROVIDER_TRAJECTORY_SCHEMA_VERSION,
    mode: profile.mode,
    fixtureDigest,
    cycleCount: allCycles.length,
    cycles: allCycles,
  };
  const observedOutcome = {
    semanticCompactionCount: allCycles.length,
    structuredHandoffSchemaStable: allCycles.every(
      (cycle) =>
        canonicalJson(cycle.handoffFields) ===
        canonicalJson(STRUCTURED_HANDOFF_FIELDS),
    ),
    frozenFactRetentionRate:
      expectedFactCount === 0 ? 1 : retainedFactCount / expectedFactCount,
    silentLossCount: expectedFactCount - retainedFactCount,
    providerUsageKnown: allCycles.every((cycle) => cycle.usage.length === 3),
    readOnlyToolSequenceCount: allCycles.filter(
      (cycle) =>
        cycle.tool.name === "read_file" &&
        cycle.tool.executingCount === 1 &&
        cycle.tool.settledCount === 1 &&
        cycle.tool.errorCount === 0,
    ).length,
    credentialLeakCount: 0,
  };
  if (canonicalJson(observedOutcome) !== canonicalJson(fixture.expected)) {
    fail(
      "trajectory_invariant_failed",
      "observed outcome did not meet the fixture contract",
    );
  }
  return {
    runId: `${LIVE_PROVIDER_TRAJECTORY_CASE}-${profile.mode}-${platformName()}-${randomUUID()}`,
    caseId: LIVE_PROVIDER_TRAJECTORY_CASE,
    manifestVersion: IDE_ROADMAP_MANIFEST_VERSION,
    releaseCommit,
    hostVersion: "agent-loop-v1",
    cliVersion,
    host: "cli-agent-loop",
    operatingSystem: platformName(),
    transport: profile.transport,
    startedAt: execution.startedAt,
    finishedAt: execution.finishedAt,
    result: "passed",
    observedOutcome,
    artifacts: [...LIVE_PROVIDER_TRAJECTORY_REQUIRED_ARTIFACTS],
    artifactDigests: artifactDigests({
      releaseCommit,
      fixtureDigest,
      trajectory,
    }),
    trajectory,
  };
}

function assertNoSecret(value, secret) {
  if (typeof secret !== "string" || secret.length === 0) return;
  if (JSON.stringify(value).includes(secret)) {
    fail(
      "trajectory_invariant_failed",
      "credential material reached the evidence envelope",
    );
  }
}

function atomicWriteJson(filePath, value) {
  const target = path.resolve(filePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  try {
    if (fs.existsSync(target)) {
      fail(
        "evidence_write_failed",
        "refusing to replace existing trajectory evidence",
      );
    }
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    // Hard-link publication is atomic and exclusive: unlike rename(), it can
    // never replace an evidence artifact that appeared after the pre-check.
    fs.linkSync(temporary, target);
    fs.rmSync(temporary, { force: true });
    try {
      fs.chmodSync(target, 0o600);
    } catch {
      // Windows does not implement POSIX mode bits. The atomic file remains
      // bounded to the caller-selected evidence path.
    }
  } catch {
    try {
      fs.rmSync(temporary, { force: true });
    } catch {
      // Best effort after an evidence write failure.
    }
    fail(
      "evidence_write_failed",
      "unable to write trajectory evidence atomically",
    );
  }
}

export async function runLiveProviderTrajectory({
  repoRoot = DEFAULT_REPO_ROOT,
  mode = "loopback",
  runs = 1,
  releaseCommit,
  outputPath = null,
  env = process.env,
  timeoutMs = 120_000,
  verifyHead = true,
} = {}) {
  const runCount = positiveInteger(runs, "runs");
  const root = path.resolve(repoRoot);
  const exactCommit = exactReleaseCommit(releaseCommit, root, verifyHead);
  const loaded = loadFixture(root);
  const cliVersion = readJson(CLI_PACKAGE_PATH).version;
  let loopback = null;
  let loopbackAudit = null;
  let profile;
  const previousPromptCompressorFlag = process.env.CC_FLAG_PROMPT_COMPRESSOR;
  process.env.CC_FLAG_PROMPT_COMPRESSOR = "true";
  try {
    if (mode === "loopback") {
      loopback = startLoopbackServer(loaded.filePath);
      const baseUrl = await loopback.started;
      profile = resolveLiveProviderTrajectoryProfile({
        mode,
        env,
        loopbackBaseUrl: baseUrl,
      });
    } else {
      profile = resolveLiveProviderTrajectoryProfile({ mode, env });
    }

    const executions = [];
    for (let index = 0; index < runCount; index += 1) {
      executions.push(
        await runOneTrajectory({
          fixture: loaded.fixture,
          profile,
          runIndex: index,
          timeoutMs: positiveInteger(timeoutMs, "timeoutMs", 15 * 60_000),
        }),
      );
    }
    if (loopback) {
      loopbackAudit = await loopback.close();
      loopback = null;
      const expectedRequests = runCount * loaded.fixture.cycles.length * 3;
      if (
        !loopbackAudit?.authorizationObserved ||
        loopbackAudit?.requestCount !== expectedRequests ||
        loopbackAudit?.stageCounts?.summary !== runCount * 2 ||
        loopbackAudit?.stageCounts?.toolCall !== runCount * 2 ||
        loopbackAudit?.stageCounts?.final !== runCount * 2
      ) {
        fail(
          "loopback_audit_failed",
          "loopback provider stage audit did not settle",
        );
      }
    }

    const evidence = {
      schema: IDE_ROADMAP_RUNTIME_EVIDENCE_SCHEMA,
      schemaVersion: IDE_ROADMAP_RUNTIME_EVIDENCE_SCHEMA_VERSION,
      manifestVersion: IDE_ROADMAP_MANIFEST_VERSION,
      caseId: LIVE_PROVIDER_TRAJECTORY_CASE,
      releaseCommit: exactCommit,
      generatedAt: new Date().toISOString(),
      profile: {
        schema: LIVE_PROVIDER_TRAJECTORY_SCHEMA,
        schemaVersion: LIVE_PROVIDER_TRAJECTORY_SCHEMA_VERSION,
        mode: profile.mode,
        fixtureDigest: loaded.digest,
        provider: profile.provider,
        model: profile.model,
        operatingSystem: platformName(),
        architecture: process.arch,
        nodeVersion: process.versions.node,
        requestedRuns: runCount,
        completedRuns: runCount,
        manifestMinimumIndependentRuns:
          loaded.roadmapCase.minimumIndependentRuns,
        manifestMatrixEligible:
          profile.mode === "live" && platformName() === "linux",
        manifestCoverageComplete:
          profile.mode === "live" &&
          platformName() === "linux" &&
          runCount >= loaded.roadmapCase.minimumIndependentRuns,
        transportAudit:
          profile.mode === "loopback"
            ? {
                kind: "loopback-http",
                authorizationObserved: true,
                requestCount: loopbackAudit.requestCount,
                summaryCount: loopbackAudit.stageCounts.summary,
                toolCallCount: loopbackAudit.stageCounts.toolCall,
                finalCount: loopbackAudit.stageCounts.final,
              }
            : { kind: "external-provider", locallyControlled: false },
      },
      runs: executions.map((execution) =>
        buildRun({
          releaseCommit: exactCommit,
          fixture: loaded.fixture,
          fixtureDigest: loaded.digest,
          profile,
          cliVersion,
          execution,
        }),
      ),
    };
    assertNoSecret(evidence, profile.apiKey);
    evidence.evidenceDigest = createIdeRoadmapRuntimeEvidenceDigest(evidence);
    verifyLiveProviderTrajectoryEvidence(evidence, {
      repoRoot: root,
      releaseCommit: exactCommit,
      expectedMode: mode,
      expectedOperatingSystem: platformName(),
      forbiddenSecrets: [profile.apiKey],
    });
    if (outputPath) atomicWriteJson(outputPath, evidence);
    return evidence;
  } finally {
    if (loopback) await loopback.close();
    if (previousPromptCompressorFlag === undefined) {
      delete process.env.CC_FLAG_PROMPT_COMPRESSOR;
    } else {
      process.env.CC_FLAG_PROMPT_COMPRESSOR = previousPromptCompressorFlag;
    }
  }
}

function exactKeys(value, expected, label) {
  if (!isRecord(value)) {
    fail("evidence_verification_failed", `${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (canonicalJson(actual) !== canonicalJson(wanted)) {
    fail(
      "evidence_verification_failed",
      `${label} has missing or unknown fields`,
    );
  }
}

function exactString(value, label) {
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    value !== value.trim()
  ) {
    fail(
      "evidence_verification_failed",
      `${label} must be an exact non-empty string`,
    );
  }
  return value;
}

function exactSha(value, label) {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    fail(
      "evidence_verification_failed",
      `${label} must be a lowercase SHA-256 digest`,
    );
  }
  return value;
}

function exactNonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(
      "evidence_verification_failed",
      `${label} must be a non-negative integer`,
    );
  }
  return value;
}

function assertSafeEvidenceTree(value, { forbiddenSecrets = [] } = {}) {
  const secrets = forbiddenSecrets.filter(
    (secret) => typeof secret === "string" && secret.length > 0,
  );
  const visit = (entry, location) => {
    if (typeof entry === "string") {
      for (const secret of secrets) {
        if (entry.includes(secret)) {
          fail(
            "evidence_verification_failed",
            `${location} contains credential material`,
          );
        }
      }
      return;
    }
    if (Array.isArray(entry)) {
      entry.forEach((item, index) => visit(item, `${location}[${index}]`));
      return;
    }
    if (!isRecord(entry)) return;
    for (const [key, child] of Object.entries(entry)) {
      const normalized = key.toLowerCase().replace(/[^a-z0-9_]/g, "");
      const compact = normalized.replaceAll("_", "");
      if (
        FORBIDDEN_EVIDENCE_KEYS.has(normalized) ||
        FORBIDDEN_EVIDENCE_KEYS.has(compact)
      ) {
        fail(
          "evidence_verification_failed",
          `${location}.${key} is a forbidden raw-material field`,
        );
      }
      visit(child, `${location}.${key}`);
    }
  };
  visit(value, "evidence");
}

function verifyCycleEvidence(cycleEvidence, fixture, cycleIndex, label) {
  exactKeys(
    cycleEvidence,
    [
      "cycleId",
      "eventOrder",
      "handoffFields",
      "handoffDigest",
      "handoffFieldDigests",
      "retention",
      "usage",
      "tool",
      "completionMarkerDigest",
    ],
    label,
  );
  const cycle = fixture.cycles[cycleIndex];
  const expectedHandoff = cumulativeHandoff(fixture, cycleIndex);
  const expectedIds = factIdsByField(expectedHandoff);
  if (cycleEvidence.cycleId !== cycle.id) {
    fail(
      "evidence_verification_failed",
      `${label}.cycleId does not match the fixture`,
    );
  }
  if (
    canonicalJson(cycleEvidence.eventOrder) !==
    canonicalJson(EXPECTED_EVENT_ORDER)
  ) {
    fail(
      "evidence_verification_failed",
      `${label}.eventOrder is incomplete or reordered`,
    );
  }
  if (
    canonicalJson(cycleEvidence.handoffFields) !==
    canonicalJson(STRUCTURED_HANDOFF_FIELDS)
  ) {
    fail(
      "evidence_verification_failed",
      `${label}.handoffFields is not canonical`,
    );
  }
  if (cycleEvidence.handoffDigest !== sha256Json(expectedHandoff)) {
    fail(
      "evidence_verification_failed",
      `${label}.handoffDigest does not retain exact facts`,
    );
  }
  if (
    canonicalJson(cycleEvidence.handoffFieldDigests) !==
    canonicalJson(fieldDigests(expectedHandoff))
  ) {
    fail(
      "evidence_verification_failed",
      `${label}.handoffFieldDigests moved or lost facts`,
    );
  }
  exactKeys(
    cycleEvidence.retention,
    [
      "expectedFactIdsByField",
      "retainedFactIdsByField",
      "missingFactIdsByField",
      "expectedFactCount",
      "retainedFactCount",
      "retentionRate",
    ],
    `${label}.retention`,
  );
  const emptyMissing = Object.fromEntries(
    STRUCTURED_HANDOFF_FIELDS.map((field) => [field, []]),
  );
  const expectedFactCount = Object.values(expectedIds).flat().length;
  if (
    canonicalJson(cycleEvidence.retention.expectedFactIdsByField) !==
      canonicalJson(expectedIds) ||
    canonicalJson(cycleEvidence.retention.retainedFactIdsByField) !==
      canonicalJson(expectedIds) ||
    canonicalJson(cycleEvidence.retention.missingFactIdsByField) !==
      canonicalJson(emptyMissing) ||
    cycleEvidence.retention.expectedFactCount !== expectedFactCount ||
    cycleEvidence.retention.retainedFactCount !== expectedFactCount ||
    cycleEvidence.retention.retentionRate !== 1
  ) {
    fail(
      "evidence_verification_failed",
      `${label}.retention is not complete and field-stable`,
    );
  }

  if (!Array.isArray(cycleEvidence.usage) || cycleEvidence.usage.length !== 3) {
    fail(
      "evidence_verification_failed",
      `${label}.usage must settle three provider calls`,
    );
  }
  const expectedPhases = [
    "semantic-compaction",
    "model-before-tool",
    "model-after-tool",
  ];
  cycleEvidence.usage.forEach((usage, index) => {
    exactKeys(
      usage,
      [
        "phase",
        "inputTokens",
        "outputTokens",
        "cacheReadTokens",
        "cacheCreationTokens",
      ],
      `${label}.usage[${index}]`,
    );
    if (usage.phase !== expectedPhases[index]) {
      fail(
        "evidence_verification_failed",
        `${label}.usage[${index}].phase is reordered`,
      );
    }
    for (const field of [
      "inputTokens",
      "outputTokens",
      "cacheReadTokens",
      "cacheCreationTokens",
    ]) {
      exactNonNegativeInteger(
        usage[field],
        `${label}.usage[${index}].${field}`,
      );
    }
  });

  exactKeys(
    cycleEvidence.tool,
    [
      "name",
      "argumentPathDigest",
      "expectedContentDigest",
      "resultDigest",
      "executingCount",
      "settledCount",
      "errorCount",
    ],
    `${label}.tool`,
  );
  if (
    cycleEvidence.tool.name !== "read_file" ||
    cycleEvidence.tool.argumentPathDigest !== sha256Json(cycle.tool.path) ||
    cycleEvidence.tool.expectedContentDigest !==
      sha256Bytes(cycle.tool.content) ||
    cycleEvidence.tool.resultDigest !==
      sha256Json({ content: cycle.tool.content, hashed: false, error: null }) ||
    cycleEvidence.tool.executingCount !== 1 ||
    cycleEvidence.tool.settledCount !== 1 ||
    cycleEvidence.tool.errorCount !== 0
  ) {
    fail(
      "evidence_verification_failed",
      `${label}.tool is not the exact safe read-only sequence`,
    );
  }
  exactSha(cycleEvidence.tool.resultDigest, `${label}.tool.resultDigest`);
  if (
    cycleEvidence.completionMarkerDigest !==
    sha256Bytes(cycle.tool.completionMarker)
  ) {
    fail(
      "evidence_verification_failed",
      `${label}.completionMarkerDigest does not match the fixture`,
    );
  }
}

export function verifyLiveProviderTrajectoryEvidence(
  evidence,
  {
    repoRoot = DEFAULT_REPO_ROOT,
    releaseCommit,
    expectedMode = null,
    expectedOperatingSystem = null,
    forbiddenSecrets = [],
    seenRunIds = new Set(),
    verifyHead = true,
  } = {},
) {
  assertSafeEvidenceTree(evidence, { forbiddenSecrets });
  exactKeys(
    evidence,
    [
      "schema",
      "schemaVersion",
      "manifestVersion",
      "caseId",
      "releaseCommit",
      "generatedAt",
      "profile",
      "runs",
      "evidenceDigest",
    ],
    "evidence",
  );
  if (
    evidence.schema !== IDE_ROADMAP_RUNTIME_EVIDENCE_SCHEMA ||
    evidence.schemaVersion !== IDE_ROADMAP_RUNTIME_EVIDENCE_SCHEMA_VERSION ||
    evidence.manifestVersion !== IDE_ROADMAP_MANIFEST_VERSION ||
    evidence.caseId !== LIVE_PROVIDER_TRAJECTORY_CASE
  ) {
    fail(
      "evidence_verification_failed",
      "evidence envelope schema or case is unsupported",
    );
  }
  const exactCommit = exactReleaseCommit(releaseCommit, repoRoot, verifyHead);
  if (evidence.releaseCommit !== exactCommit) {
    fail(
      "evidence_verification_failed",
      "evidence release commit does not match the requested commit",
    );
  }
  exactTimestamp(evidence.generatedAt, "evidence.generatedAt");
  exactSha(evidence.evidenceDigest, "evidence.evidenceDigest");
  if (
    evidence.evidenceDigest !== createIdeRoadmapRuntimeEvidenceDigest(evidence)
  ) {
    fail(
      "evidence_verification_failed",
      "evidence digest does not match its envelope",
    );
  }

  const loaded = loadFixture(path.resolve(repoRoot));
  exactKeys(
    evidence.profile,
    [
      "schema",
      "schemaVersion",
      "mode",
      "fixtureDigest",
      "provider",
      "model",
      "operatingSystem",
      "architecture",
      "nodeVersion",
      "requestedRuns",
      "completedRuns",
      "manifestMinimumIndependentRuns",
      "manifestMatrixEligible",
      "manifestCoverageComplete",
      "transportAudit",
    ],
    "evidence.profile",
  );
  const profile = evidence.profile;
  if (
    profile.schema !== LIVE_PROVIDER_TRAJECTORY_SCHEMA ||
    profile.schemaVersion !== LIVE_PROVIDER_TRAJECTORY_SCHEMA_VERSION ||
    !Object.hasOwn(MODE_TRANSPORT, profile.mode)
  ) {
    fail("evidence_verification_failed", "evidence profile is unsupported");
  }
  if (expectedMode && profile.mode !== expectedMode) {
    fail(
      "evidence_verification_failed",
      "evidence mode does not match the requested mode",
    );
  }
  if (profile.fixtureDigest !== loaded.digest) {
    fail(
      "evidence_verification_failed",
      "evidence fixture digest does not match the repository fixture",
    );
  }
  exactString(profile.provider, "evidence.profile.provider");
  exactString(profile.model, "evidence.profile.model");
  if (
    (profile.mode === "loopback" &&
      (profile.provider !== "openai" ||
        profile.model !== "cc-live-trajectory-loopback-v1")) ||
    (profile.mode === "live" &&
      (!CLOUD_PROVIDERS.has(profile.provider) ||
        !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(profile.model)))
  ) {
    fail(
      "evidence_verification_failed",
      "evidence provider profile is not allowed",
    );
  }
  exactString(profile.architecture, "evidence.profile.architecture");
  exactString(profile.nodeVersion, "evidence.profile.nodeVersion");
  exactString(profile.operatingSystem, "evidence.profile.operatingSystem");
  if (
    expectedOperatingSystem &&
    profile.operatingSystem !== expectedOperatingSystem
  ) {
    fail(
      "evidence_verification_failed",
      "evidence operating system does not match the requested cell",
    );
  }
  if (!Array.isArray(evidence.runs) || evidence.runs.length === 0) {
    fail("evidence_verification_failed", "evidence.runs must be non-empty");
  }
  if (
    profile.requestedRuns !== evidence.runs.length ||
    profile.completedRuns !== evidence.runs.length ||
    profile.manifestMinimumIndependentRuns !==
      loaded.roadmapCase.minimumIndependentRuns
  ) {
    fail(
      "evidence_verification_failed",
      "evidence run counts do not match the envelope",
    );
  }
  const eligible =
    profile.mode === "live" && profile.operatingSystem === "linux";
  if (
    profile.manifestMatrixEligible !== eligible ||
    profile.manifestCoverageComplete !==
      (eligible &&
        evidence.runs.length >= profile.manifestMinimumIndependentRuns)
  ) {
    fail(
      "evidence_verification_failed",
      "evidence manifest coverage claim is incorrect",
    );
  }
  if (profile.mode === "loopback") {
    exactKeys(
      profile.transportAudit,
      [
        "kind",
        "authorizationObserved",
        "requestCount",
        "summaryCount",
        "toolCallCount",
        "finalCount",
      ],
      "evidence.profile.transportAudit",
    );
    const expectedCycles = evidence.runs.length * loaded.fixture.cycles.length;
    if (
      profile.transportAudit.kind !== "loopback-http" ||
      profile.transportAudit.authorizationObserved !== true ||
      profile.transportAudit.requestCount !== expectedCycles * 3 ||
      profile.transportAudit.summaryCount !== expectedCycles ||
      profile.transportAudit.toolCallCount !== expectedCycles ||
      profile.transportAudit.finalCount !== expectedCycles
    ) {
      fail(
        "evidence_verification_failed",
        "loopback transport audit is incomplete",
      );
    }
  } else {
    exactKeys(
      profile.transportAudit,
      ["kind", "locallyControlled"],
      "evidence.profile.transportAudit",
    );
    if (
      profile.transportAudit.kind !== "external-provider" ||
      profile.transportAudit.locallyControlled !== false
    ) {
      fail(
        "evidence_verification_failed",
        "live evidence incorrectly claims local control",
      );
    }
  }

  for (const [runIndex, run] of evidence.runs.entries()) {
    const label = `evidence.runs[${runIndex}]`;
    exactKeys(
      run,
      [
        "runId",
        "caseId",
        "manifestVersion",
        "releaseCommit",
        "hostVersion",
        "cliVersion",
        "host",
        "operatingSystem",
        "transport",
        "startedAt",
        "finishedAt",
        "result",
        "observedOutcome",
        "artifacts",
        "artifactDigests",
        "trajectory",
      ],
      label,
    );
    const runId = exactString(run.runId, `${label}.runId`);
    if (seenRunIds.has(runId)) {
      fail("evidence_verification_failed", `${label}.runId is duplicated`);
    }
    seenRunIds.add(runId);
    if (
      run.caseId !== LIVE_PROVIDER_TRAJECTORY_CASE ||
      run.manifestVersion !== IDE_ROADMAP_MANIFEST_VERSION ||
      run.releaseCommit !== exactCommit ||
      run.hostVersion !== "agent-loop-v1" ||
      run.host !== "cli-agent-loop" ||
      run.operatingSystem !== profile.operatingSystem ||
      run.transport !== MODE_TRANSPORT[profile.mode] ||
      run.result !== "passed"
    ) {
      fail(
        "evidence_verification_failed",
        `${label} is not bound to the declared trajectory cell`,
      );
    }
    exactString(run.cliVersion, `${label}.cliVersion`);
    const started = exactTimestamp(run.startedAt, `${label}.startedAt`);
    const finished = exactTimestamp(run.finishedAt, `${label}.finishedAt`);
    if (finished < started) {
      fail(
        "evidence_verification_failed",
        `${label}.finishedAt precedes startedAt`,
      );
    }
    if (
      canonicalJson(run.observedOutcome) !==
      canonicalJson(loaded.fixture.expected)
    ) {
      fail(
        "evidence_verification_failed",
        `${label}.observedOutcome does not match the fixture`,
      );
    }
    if (
      canonicalJson(run.artifacts) !==
      canonicalJson(LIVE_PROVIDER_TRAJECTORY_REQUIRED_ARTIFACTS)
    ) {
      fail(
        "evidence_verification_failed",
        `${label}.artifacts is incomplete or reordered`,
      );
    }
    exactKeys(
      run.trajectory,
      [
        "schema",
        "schemaVersion",
        "mode",
        "fixtureDigest",
        "cycleCount",
        "cycles",
      ],
      `${label}.trajectory`,
    );
    if (
      run.trajectory.schema !== LIVE_PROVIDER_TRAJECTORY_SCHEMA ||
      run.trajectory.schemaVersion !==
        LIVE_PROVIDER_TRAJECTORY_SCHEMA_VERSION ||
      run.trajectory.mode !== profile.mode ||
      run.trajectory.fixtureDigest !== loaded.digest ||
      run.trajectory.cycleCount !== loaded.fixture.cycles.length ||
      !Array.isArray(run.trajectory.cycles) ||
      run.trajectory.cycles.length !== loaded.fixture.cycles.length
    ) {
      fail(
        "evidence_verification_failed",
        `${label}.trajectory contract is invalid`,
      );
    }
    run.trajectory.cycles.forEach((cycle, cycleIndex) =>
      verifyCycleEvidence(
        cycle,
        loaded.fixture,
        cycleIndex,
        `${label}.trajectory.cycles[${cycleIndex}]`,
      ),
    );
    exactKeys(
      run.artifactDigests,
      LIVE_PROVIDER_TRAJECTORY_REQUIRED_ARTIFACTS,
      `${label}.artifactDigests`,
    );
    const expectedArtifactDigests = artifactDigests({
      releaseCommit: exactCommit,
      fixtureDigest: loaded.digest,
      trajectory: run.trajectory,
    });
    if (
      canonicalJson(run.artifactDigests) !==
      canonicalJson(expectedArtifactDigests)
    ) {
      fail(
        "evidence_verification_failed",
        `${label}.artifactDigests does not match the trajectory`,
      );
    }
  }

  return Object.freeze({
    mode: profile.mode,
    operatingSystem: profile.operatingSystem,
    runCount: evidence.runs.length,
    manifestMatrixEligible: profile.manifestMatrixEligible,
    manifestCoverageComplete: profile.manifestCoverageComplete,
  });
}

function listEvidenceFiles(directory) {
  const root = path.resolve(directory);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    fail("evidence_verification_failed", "evidence directory is unavailable");
  }
  const files = [];
  let totalBytes = 0;
  const visit = (current, depth) => {
    if (depth > 6) {
      fail(
        "evidence_verification_failed",
        "evidence directory exceeds its depth bound",
      );
    }
    for (const entry of fs
      .readdirSync(current, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const candidate = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        fail(
          "evidence_verification_failed",
          "evidence directory may not contain symbolic links",
        );
      }
      if (entry.isDirectory()) visit(candidate, depth + 1);
      else if (entry.isFile() && entry.name.endsWith(".json")) {
        const size = fs.statSync(candidate).size;
        if (size > 64 * 1024 * 1024) {
          fail(
            "evidence_verification_failed",
            "an evidence file exceeds 64 MiB",
          );
        }
        totalBytes += size;
        if (totalBytes > 128 * 1024 * 1024) {
          fail(
            "evidence_verification_failed",
            "evidence directory exceeds 128 MiB",
          );
        }
        files.push(candidate);
        if (files.length > 64) {
          fail(
            "evidence_verification_failed",
            "evidence directory exceeds 64 JSON files",
          );
        }
      }
    }
  };
  visit(root, 0);
  return files;
}

export function verifyLiveProviderTrajectoryEvidenceSet({
  evidenceDir,
  repoRoot = DEFAULT_REPO_ROOT,
  releaseCommit,
  expectedMode,
  expectedOperatingSystems,
  minimumRunsPerOperatingSystem = 1,
  requireManifestCoverage = false,
  forbiddenSecrets = [],
} = {}) {
  if (!Object.hasOwn(MODE_TRANSPORT, expectedMode)) {
    fail("invalid_arguments", "expectedMode must be loopback or live");
  }
  if (
    !Array.isArray(expectedOperatingSystems) ||
    expectedOperatingSystems.length === 0
  ) {
    fail(
      "invalid_arguments",
      "expectedOperatingSystems must be a non-empty array",
    );
  }
  const expectedOs = [
    ...new Set(expectedOperatingSystems.map((value) => String(value))),
  ];
  const minimumRuns = positiveInteger(
    minimumRunsPerOperatingSystem,
    "minimumRunsPerOperatingSystem",
  );
  const exactCommit = exactReleaseCommit(releaseCommit, repoRoot, true);
  const documents = [];
  for (const filePath of listEvidenceFiles(evidenceDir)) {
    const value = readJson(filePath, "evidence_verification_failed");
    if (value?.schema === LIVE_PROVIDER_TRAJECTORY_FAILURE_SCHEMA) {
      fail(
        "evidence_verification_failed",
        "a failed trajectory artifact is present",
      );
    }
    if (
      value?.schema === IDE_ROADMAP_RUNTIME_EVIDENCE_SCHEMA &&
      value?.caseId === LIVE_PROVIDER_TRAJECTORY_CASE
    ) {
      documents.push(value);
    } else {
      fail(
        "evidence_verification_failed",
        "evidence directory contains an unexpected JSON document",
      );
    }
  }
  if (documents.length === 0) {
    fail(
      "evidence_verification_failed",
      "no live provider trajectory evidence documents were found",
    );
  }

  const seenRunIds = new Set();
  const counts = Object.fromEntries(
    expectedOs.map((operatingSystem) => [operatingSystem, 0]),
  );
  for (const document of documents) {
    const operatingSystem = document?.profile?.operatingSystem;
    if (!expectedOs.includes(operatingSystem)) {
      fail(
        "evidence_verification_failed",
        "evidence contains an unexpected operating-system cell",
      );
    }
    const result = verifyLiveProviderTrajectoryEvidence(document, {
      repoRoot,
      releaseCommit: exactCommit,
      expectedMode,
      expectedOperatingSystem: operatingSystem,
      forbiddenSecrets,
      seenRunIds,
    });
    counts[operatingSystem] += result.runCount;
  }
  for (const operatingSystem of expectedOs) {
    if (counts[operatingSystem] < minimumRuns) {
      fail(
        "evidence_verification_failed",
        `operating-system cell ${operatingSystem} has ${counts[operatingSystem]}/${minimumRuns} runs`,
      );
    }
  }

  const totalRuns = Object.values(counts).reduce(
    (total, count) => total + count,
    0,
  );
  const manifestCoverageComplete =
    expectedMode === "live" &&
    expectedOs.length === 1 &&
    expectedOs[0] === "linux" &&
    counts.linux >=
      loadFixture(path.resolve(repoRoot)).roadmapCase.minimumIndependentRuns;
  if (requireManifestCoverage && !manifestCoverageComplete) {
    fail(
      "evidence_verification_failed",
      "evidence does not satisfy the 100-run external-live-provider Linux manifest cell",
    );
  }
  const aggregate = {
    schema: LIVE_PROVIDER_TRAJECTORY_AGGREGATE_SCHEMA,
    schemaVersion: 1,
    manifestVersion: IDE_ROADMAP_MANIFEST_VERSION,
    caseId: LIVE_PROVIDER_TRAJECTORY_CASE,
    releaseCommit: exactCommit,
    generatedAt: new Date().toISOString(),
    mode: expectedMode,
    expectedOperatingSystems: expectedOs,
    minimumRunsPerOperatingSystem: minimumRuns,
    counts,
    evidenceFileCount: documents.length,
    runCount: totalRuns,
    manifestMatrixEligible:
      expectedMode === "live" &&
      expectedOs.length === 1 &&
      expectedOs[0] === "linux",
    manifestCoverageComplete,
    provenanceClaim: "structural-envelope-only",
  };
  aggregate.evidenceDigest = createIdeRoadmapRuntimeEvidenceDigest(aggregate);
  return Object.freeze(aggregate);
}

export function createLiveProviderTrajectoryFailureEvidence({
  mode,
  releaseCommit,
  code,
} = {}) {
  const failureCode = FAILURE_CODES.has(code)
    ? code
    : "provider_trajectory_failed";
  const evidence = {
    schema: LIVE_PROVIDER_TRAJECTORY_FAILURE_SCHEMA,
    schemaVersion: 1,
    caseId: LIVE_PROVIDER_TRAJECTORY_CASE,
    mode: mode === "live" || mode === "loopback" ? mode : "unknown",
    releaseCommit:
      typeof releaseCommit === "string" && GIT_OID_PATTERN.test(releaseCommit)
        ? releaseCommit
        : null,
    generatedAt: new Date().toISOString(),
    result: "failed",
    failureCode,
    rawProviderMaterialPersisted: false,
  };
  evidence.evidenceDigest = createIdeRoadmapRuntimeEvidenceDigest(evidence);
  return evidence;
}

function parseCliArgs(argv) {
  const options = {
    mode: process.env.CC_IDE_ROADMAP_LIVE_PROVIDER_MODE || "loopback",
    runs: process.env.CC_IDE_ROADMAP_LIVE_PROVIDER_RUNS || "1",
    releaseCommit: process.env.CC_IDE_ROADMAP_LIVE_PROVIDER_EXPECTED_SHA,
    outputPath: process.env.CC_IDE_ROADMAP_LIVE_PROVIDER_OUTPUT,
    expectedOperatingSystems: null,
    minimumRunsPerOperatingSystem: 1,
    requireManifestCoverage: false,
  };
  const take = (index, argument) => {
    const value = argv[index + 1];
    if (!value) fail("invalid_arguments", `${argument} requires a value`);
    return value;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--mode") options.mode = take(index++, argument);
    else if (argument === "--runs") options.runs = take(index++, argument);
    else if (argument === "--release-commit") {
      options.releaseCommit = take(index++, argument);
    } else if (argument === "--output") {
      options.outputPath = take(index++, argument);
    } else if (argument === "--verify-evidence-dir") {
      options.evidenceDir = take(index++, argument);
    } else if (argument === "--expected-mode") {
      options.expectedMode = take(index++, argument);
    } else if (argument === "--expected-operating-systems") {
      options.expectedOperatingSystems = take(index++, argument)
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
    } else if (argument === "--minimum-runs") {
      options.minimumRunsPerOperatingSystem = take(index++, argument);
    } else if (argument === "--require-manifest-coverage") {
      options.requireManifestCoverage = true;
    } else {
      fail("invalid_arguments", `unknown argument: ${argument}`);
    }
  }
  if (!options.outputPath) fail("invalid_arguments", "--output is required");
  if (options.evidenceDir) {
    if (!options.expectedMode) {
      fail(
        "invalid_arguments",
        "--expected-mode is required for aggregate verification",
      );
    }
    if (!options.expectedOperatingSystems?.length) {
      fail(
        "invalid_arguments",
        "--expected-operating-systems is required for aggregate verification",
      );
    }
  }
  return options;
}

function isDirectExecution() {
  return (
    Boolean(process.argv[1]) &&
    path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  );
}

if (isDirectExecution()) {
  let options = null;
  try {
    options = parseCliArgs(process.argv.slice(2));
    if (options.evidenceDir) {
      const aggregate = verifyLiveProviderTrajectoryEvidenceSet({
        evidenceDir: options.evidenceDir,
        releaseCommit: options.releaseCommit,
        expectedMode: options.expectedMode,
        expectedOperatingSystems: options.expectedOperatingSystems,
        minimumRunsPerOperatingSystem: options.minimumRunsPerOperatingSystem,
        requireManifestCoverage: options.requireManifestCoverage,
        forbiddenSecrets: [process.env.CC_LLM_API_KEY],
      });
      atomicWriteJson(options.outputPath, aggregate);
      console.log(
        `Verified ${aggregate.runCount} ${aggregate.mode} trajectory run(s) across ` +
          `${aggregate.expectedOperatingSystems.join(",")}; manifest coverage complete: ` +
          `${aggregate.manifestCoverageComplete}. Structural evidence only; trusted ` +
          "provenance and full release readiness were not established.",
      );
    } else {
      const evidence = await runLiveProviderTrajectory({
        mode: options.mode,
        runs: options.runs,
        releaseCommit: options.releaseCommit,
        outputPath: options.outputPath,
      });
      console.log(
        `Recorded ${evidence.runs.length} ${evidence.profile.mode} trajectory run(s) for ` +
          `${evidence.releaseCommit}; manifest coverage complete: ` +
          `${evidence.profile.manifestCoverageComplete}. Loopback is never counted as ` +
          "real-provider evidence.",
      );
    }
  } catch (error) {
    const code = FAILURE_CODES.has(error?.code)
      ? error.code
      : "provider_trajectory_failed";
    if (options?.outputPath && !options.evidenceDir) {
      try {
        const failureEvidence = createLiveProviderTrajectoryFailureEvidence({
          mode: options.mode,
          releaseCommit: options.releaseCommit,
          code,
        });
        assertNoSecret(failureEvidence, process.env.CC_LLM_API_KEY);
        atomicWriteJson(options.outputPath, failureEvidence);
      } catch {
        // Preserve the original fixed-code failure. Never print provider text.
      }
    }
    console.error(`S0 live provider trajectory failed (${code})`);
    process.exitCode = 1;
  }
}
