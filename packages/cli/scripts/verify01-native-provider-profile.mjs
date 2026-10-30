import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DIAGNOSTIC } from "./verify01-volcengine-task-diagnostic.mjs";
import {
  BROKER,
  createVolcengineDiagnosticBroker,
} from "./verify01-volcengine-diagnostic-broker.mjs";
import {
  OPENAI_BROKER,
  createOpenAiDiagnosticBroker,
} from "./verify01-openai-diagnostic-broker.mjs";

/** Operator selection only; existing Volcengine cohorts retain their policy. */
export function nativeProviderProfile(provider = DIAGNOSTIC.provider) {
  assert.ok(
    ["volcengine", "openai"].includes(provider),
    "unsupported diagnostic provider",
  );
  return provider === "openai"
    ? Object.freeze({
        provider,
        model: OPENAI_BROKER.model,
        keyEnvironment: "OPENAI_API_KEY",
        policy: OPENAI_BROKER,
        createBroker: createOpenAiDiagnosticBroker,
        defaultThinkingPreserved: true,
      })
    : Object.freeze({
        provider,
        model: DIAGNOSTIC.model,
        keyEnvironment: "VOLCENGINE_API_KEY",
        policy: BROKER,
        createBroker: createVolcengineDiagnosticBroker,
        defaultThinkingPreserved: false,
      });
}

/** Validate a new provider cohort before its deliveries reach acceptance. */
export function assertNativeProviderIdentity(
  summary,
  provider,
  sourceSha,
  packageBinding,
) {
  const profile = nativeProviderProfile(provider);
  const hash = (value) =>
    `sha256:${createHash("sha256").update(value).digest("hex")}`;
  assert.match(sourceSha, /^[a-f0-9]{40}$/u);
  assert.equal(summary.executionSourceCommit, sourceSha);
  assert.equal(
    summary.cohortKind,
    provider === "openai"
      ? "new-openai-provider-diagnostic"
      : "volcengine-native-diagnostic",
  );
  assert.deepEqual(summary.modelTransport, {
    provider: profile.provider,
    model: profile.model,
    endpoint: profile.policy.endpoint,
    policyDigest: hash(JSON.stringify(profile.policy)),
    defaultThinkingPreserved: profile.defaultThinkingPreserved,
    formalSample: false,
  });
  if (packageBinding) {
    assert.deepEqual(summary.versions, packageBinding.versions);
    assert.equal(summary.packageSetDigest, packageBinding.packageSetDigest);
  }
  assert.equal(
    summary.executionIdentityDigest,
    hash(
      JSON.stringify({
        sourceSha,
        taskPlanDigest: summary.planDigest,
        versions: summary.versions,
        packageSetDigest: summary.packageSetDigest || null,
        modelTransport: summary.modelTransport,
      }),
    ),
  );
  return summary.executionIdentityDigest;
}
