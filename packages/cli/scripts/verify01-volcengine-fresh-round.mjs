import assert from "node:assert/strict";
import net from "node:net";
import { loadPublicGeneratorProof } from "./verify01-public-generator-binding.mjs";
import { loadVolcengineBudgetRetry } from "./verify01-native-execution-budgets.mjs";
import {
  isPublic147FullRound,
  assertPublic147FullDispatch,
} from "./verify01-volcengine-public147-full.mjs";
import {
  isPublic140FullRound,
  assertPublic140FullDispatch,
} from "./verify01-volcengine-public140-full.mjs";
import {
  isPublic140GenerationRecovery,
  assertPublic140GenerationRecoveryDispatch,
} from "./verify01-volcengine-public140-generation-recovery.mjs";
import {
  isHistoricalRetry,
  runtimeRepairBinding,
  ORIGINAL_PROJECT,
} from "./verify01-volcengine-historical-retry.mjs";

/** Read-only authentication. Retry only catalog network failures, never generation. */
export async function verifyFreshVolcengineCredential(
  key,
  { fetchImpl = globalThis.fetch } = {},
) {
  assert.ok(key?.trim(), "Dedicated complete Volcengine key is required");
  const previous = net.getDefaultAutoSelectFamilyAttemptTimeout();
  net.setDefaultAutoSelectFamilyAttemptTimeout(2000);
  try {
    let response;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        response = await fetchImpl(
          "https://ark.cn-beijing.volces.com/api/v3/models",
          {
            signal: AbortSignal.timeout(30000),
            headers: { Authorization: "Bearer " + key.trim() },
          },
        );
        break;
      } catch (error) {
        if (attempt === 2) {
          throw new Error(
            "Volcengine catalog network preflight failed before authentication",
            { cause: error },
          );
        }
      }
    }
    assert.ok(
      response.ok,
      "Volcengine credential metadata preflight failed: HTTP " +
        response.status,
    );
    const models = await response.json();
    assert.ok(
      models.data?.some((row) => row.id === "deepseek-v4-flash-ga-260731"),
      "Required DeepSeek model missing from authenticated model catalog",
    );
    return {
      authenticated: true,
      modelListed: true,
      modelGenerationRequests: 0,
    };
  } finally {
    net.setDefaultAutoSelectFamilyAttemptTimeout(previous);
  }
}

/** Explicit new full round, separate from the historical unfinished-task chain. */
export function assertFreshVolcengineRound(options, plan) {
  const declaration = options.packageBinding?.bytes
    ? JSON.parse(options.packageBinding.bytes.toString("utf8"))
    : null;
  if (isPublic147FullRound(declaration))
    return assertPublic147FullDispatch(options, plan);
  if (isPublic140GenerationRecovery(declaration))
    return assertPublic140GenerationRecoveryDispatch(options, plan);
  if (isPublic140FullRound(declaration))
    return assertPublic140FullDispatch(options, plan);
  return assertLegacyFreshVolcengineRound(options);
}
function assertLegacyFreshVolcengineRound({
  provider,
  packageSet,
  packageBinding,
  hosts,
  entries,
  sampleIds,
  revisionBinding,
  runAttempt,
  credentialPresent,
  repositoryRoot,
}) {
  assert.equal(provider, "volcengine");
  assert.equal(packageSet, "latest", "Fresh round requires public packages");
  assert.equal(hosts, "all", "Fresh round requires all three native hosts");
  assert.equal(entries, "all", "Fresh round requires all three entries");
  assert.equal(sampleIds, undefined, "Fresh round must cover all 45 samples");
  assert.equal(
    revisionBinding,
    null,
    "Fresh round uses original project inputs",
  );
  assert.equal(
    runAttempt,
    1,
    "Reconcile the previous live attempt before retrying",
  );
  assert.equal(
    credentialPresent,
    true,
    "Dedicated Volcengine round key is missing",
  );
  const manifest = JSON.parse(packageBinding.bytes.toString("utf8"));
  assert.deepEqual(manifest.freshVolcengineRound, {
    id: "volcengine-public139-20261103",
    taskCount: 36,
    firstRunCount: 9,
    repeatPreviouslyAccepted: true,
    historicalScoresUnchanged: true,
    formalSample: false,
  });
  assert.deepEqual(packageBinding.versions, {
    cli: "0.166.139",
    vscode: "0.37.175",
    jetbrains: "0.4.192",
    vscodeHost: "1.132.0",
    jetbrainsHost: "2025.2",
  });
  return loadPublicGeneratorProof(manifest, { repositoryRoot });
}

export function assertFreshVolcengineBudgetRetry(options, plan) {
  assert.equal(
    options.reviewChanges,
    true,
    "Budget retries retain independent change review",
  );
  const {
    provider,
    packageSet,
    packageBinding,
    hosts,
    entries,
    sampleIds,
    revisionBinding,
    runAttempt,
    credentialPresent,
    repositoryRoot,
  } = options;
  assert.equal(provider, "volcengine");
  const manifest = JSON.parse(packageBinding.bytes.toString("utf8"));
  const historical = isHistoricalRetry(manifest);
  assert.equal(packageSet, historical ? "prerelease" : "latest");
  assert.equal(hosts, "all");
  assert.equal(entries, "all");
  assert.equal(
    sampleIds,
    undefined,
    "Retry selection comes only from the committed baseline manifest",
  );
  assert.equal(revisionBinding, null);
  assert.equal(runAttempt, 1);
  assert.equal(credentialPresent, true);
  assert.equal(manifest.volcengineBudgetRetry?.reviewChanges, true);
  assert.equal(
    manifest.freshVolcengineRound,
    undefined,
    "A subset retry must not claim a full 45-sample round",
  );
  assert.deepEqual(packageBinding.versions, {
    cli: "0.166.139",
    vscode: "0.37.175",
    jetbrains: "0.4.192",
    vscodeHost: "1.132.0",
    jetbrainsHost: "2025.2",
  });
  if (historical)
    runtimeRepairBinding(manifest, {
      provider,
      projectCommit: ORIGINAL_PROJECT,
      revisionBinding,
    });
  else loadPublicGeneratorProof(manifest, { repositoryRoot });
  return loadVolcengineBudgetRetry(manifest, { repositoryRoot, plan });
}
