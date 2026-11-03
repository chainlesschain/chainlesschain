import "../helpers/test-model-egress.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import {
  createLiveProviderTrajectoryFailureEvidence,
  safeProviderFailureDiagnostic,
  safeTrajectoryFailureDiagnostic,
} from "../../scripts/ide-roadmap-live-provider-trajectory.mjs";

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);

it("keeps historical provider diagnostics without a site compatible", () => {
  const providerError = [{ name: "Error", code: null, status: null }];
  const receipt = createLiveProviderTrajectoryFailureEvidence({
    mode: "loopback",
    releaseCommit: "f".repeat(40),
    code: "provider_trajectory_failed",
    diagnostic: { ...safeTrajectoryFailureDiagnostic([], []), providerError },
  });
  expect(receipt.diagnostic.providerError).toEqual(providerError);
});

it("persists bounded repository sites without raw provider stacks or host paths", () => {
  const source = path.join(
    REPOSITORY_ROOT,
    "packages/cli/src/runtime/agent-core.js",
  );
  const error = new Error("PRIVATE_PROVIDER_SECRET");
  error.stack = `Error: PRIVATE_PROVIDER_SECRET\n    at helper (${source}:87:2)`;
  error.cause = new Error("PRIVATE_PROVIDER_SECRET");
  error.cause.stack =
    "Error: PRIVATE_PROVIDER_SECRET\n    at helper (C:/private/credential.js:2:3)";
  const diagnostic = safeTrajectoryFailureDiagnostic([], []);
  diagnostic.providerError = safeProviderFailureDiagnostic(error);
  const receipt = createLiveProviderTrajectoryFailureEvidence({
    mode: "loopback",
    releaseCommit: "f".repeat(40),
    code: "provider_trajectory_failed",
    diagnostic,
  });
  expect(receipt.diagnostic.providerError).toEqual([
    {
      name: "Error",
      code: null,
      status: null,
      site: "packages/cli/src/runtime/agent-core.js:87",
    },
    { name: "Error", code: null, status: null, site: null },
  ]);
  const encoded = JSON.stringify(receipt);
  expect(encoded).not.toContain("PRIVATE_PROVIDER_SECRET");
  expect(encoded).not.toContain(REPOSITORY_ROOT.replaceAll("\\", "\\\\"));
  expect(encoded).not.toContain("C:/private");
  expect(encoded).not.toContain("stack");
});

it.each([
  "C:/private/credential.js:87",
  "/private/credential.js:87",
  "file:///private/credential.js:87",
  "packages/cli/../../private/credential.js:87",
  "packages/cli/src/runtime/PRIVATE_PROVIDER_SECRET.js:87",
  "packages/cli/package.json:87",
  "packages/cli/node_modules/provider/PRIVATE_PROVIDER_SECRET.js:87",
  "packages/cli/src/runtime/agent-core.js:87\nPRIVATE_PROVIDER_SECRET",
  "packages/cli/src/runtime/agent-core.js:0",
  "packages/cli/src/runtime/agent-core.js:9007199254740992",
  `packages/cli/${"a".repeat(180)}.js:87`,
  {},
])("rejects unbounded or non-repository diagnostic sites: %j", (site) => {
  const receipt = createLiveProviderTrajectoryFailureEvidence({
    mode: "loopback",
    releaseCommit: "f".repeat(40),
    code: "provider_trajectory_failed",
    diagnostic: {
      ...safeTrajectoryFailureDiagnostic([], []),
      providerError: [{ name: "Error", code: null, status: null, site }],
    },
  });
  expect(receipt).not.toHaveProperty("diagnostic");
});

it("drops fabricated source filenames from provider-controlled stacks", () => {
  const forged = path.join(
    REPOSITORY_ROOT,
    "packages/cli/src/runtime/PRIVATE_PROVIDER_SECRET.js",
  );
  const providerError = safeProviderFailureDiagnostic({
    name: "Error",
    stack: `Error: PRIVATE_PROVIDER_SECRET\n    at helper (${forged}:87:2)`,
  });
  expect(providerError).toEqual([
    { name: "Error", code: null, status: null, site: null },
  ]);
  const receipt = createLiveProviderTrajectoryFailureEvidence({
    mode: "loopback",
    releaseCommit: "f".repeat(40),
    code: "provider_trajectory_failed",
    diagnostic: { ...safeTrajectoryFailureDiagnostic([], []), providerError },
  });
  expect(receipt.diagnostic.providerError).toEqual(providerError);
  expect(JSON.stringify(receipt)).not.toContain("PRIVATE_PROVIDER_SECRET");
});
