#!/usr/bin/env node

// Manual probe for a real local Laya System One service. This does not run
// Skills, write session state, or claim that the release evaluation passed.
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";

import {
  createSkillDecisionRequest,
  normalizeSkillDecisionProviderResult,
  resolveSkillDecision,
} from "../src/lib/decision-layer/contracts.js";
import { createDecisionProvider } from "../src/lib/decision-layer/providers.js";
import { createSkillDecisionRuntime } from "../src/lib/decision-layer/runtime.js";

const language = process.argv[2] ?? "en";
const mode = process.argv[3] ?? "provider";
const timeoutMs = Number(process.argv[4] ?? 30_000);
if (
  (language !== "en" && language !== "zh") ||
  (mode !== "provider" && mode !== "runtime") ||
  (mode === "runtime" &&
    (!Number.isSafeInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 30_000))
) {
  throw new TypeError(
    "usage: node scripts/laya-live-probe.mjs [en|zh] [provider|runtime] [timeout-ms]",
  );
}

const digest = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const candidates = [
  {
    id: "repair-unit-tests",
    displayName: "Repair unit tests",
    description: "Diagnose and repair failing JavaScript unit tests.",
    category: "development",
    digest: digest("laya-probe-repair-unit-tests-v1"),
    tags: ["tests", "javascript"],
  },
  {
    id: "plan-travel",
    displayName: "Plan travel",
    description: "Create travel itineraries and booking checklists.",
    category: "travel",
    digest: digest("laya-probe-plan-travel-v1"),
    tags: ["travel"],
  },
];
const query =
  language === "zh"
    ? "请找出 JavaScript 单元测试失败的原因并修复。"
    : "Find the cause of the failing JavaScript unit tests and repair them.";
const request = createSkillDecisionRequest({
  decisionId: `laya-live-probe-${language}`,
  tenantId: "local-probe",
  sessionId: "local-probe",
  turnId: `probe-${language}`,
  query,
  candidates,
  contextRevision: "probe-v1",
});
const provider = createDecisionProvider({ provider: "laya" });
if (mode === "runtime") {
  const usageEvents = [];
  const observations = [];
  const runtime = createSkillDecisionRuntime({
    mode: "shadow",
    tenantId: "local-probe",
    sessionId: "local-probe",
    provider,
    persist: async (event) => usageEvents.push(event),
    observe: async (observation) => observations.push(observation),
    timeoutMs,
  });
  const started = performance.now();
  const decision = await runtime.suggest({
    query,
    candidates,
    turnId: `probe-${language}`,
    contextRevision: "probe-v1",
  });
  console.log(
    JSON.stringify(
      {
        language,
        mode,
        timeoutMs,
        latencyMs: performance.now() - started,
        decision,
        usageEventCount: usageEvents.length,
        observation: observations[0],
      },
      null,
      2,
    ),
  );
} else {
  const started = performance.now();
  const raw = await provider.decide(request, {
    // Initial weight download and CPU cold load are deliberately measured
    // separately from the CLI's 800 ms production target.
    signal: AbortSignal.timeout(600_000),
  });
  const latencyMs = performance.now() - started;
  const normalized = normalizeSkillDecisionProviderResult(request, raw);
  const resolved = resolveSkillDecision(request, normalized);
  console.log(
    JSON.stringify(
      {
        language,
        mode,
        provider: raw.provider,
        responseModel: raw.model,
        latencyMs,
        usage: raw.usage,
        answers: normalized.answers,
        decision: {
          status: resolved.status,
          reasonCode: resolved.reasonCode,
          selectedSkillId: resolved.selectedSkillId,
        },
      },
      null,
      2,
    ),
  );
}
