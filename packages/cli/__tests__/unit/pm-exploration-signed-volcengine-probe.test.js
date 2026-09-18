import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const CLI_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const SCRIPT = path.join(
  CLI_ROOT,
  "scripts",
  "pm-exploration-signed-volcengine-live-probe.mjs",
);

function run(...args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: CLI_ROOT,
    encoding: "utf8",
    env: { ...process.env },
    timeout: 60_000,
  });
}

describe("signed PM Volcengine live probe", () => {
  it("executes the signed deployment and durable settlement chain without network in fixture mode", () => {
    const result = run("--fixture");
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).not.toContain(
      "test-only-pm-signed-live-probe-secret",
    );
    expect(result.stdout).not.toContain("FIXTURE_OK");
    const output = JSON.parse(result.stdout);
    expect(output).toMatchObject({
      schema: "chainlesschain.pm-exploration-signed-volcengine-live-probe/v1",
      provider: "volcengine",
      model: "deepseek-v4-flash",
      signedDeploymentVerified: true,
      deploymentMode: "test",
      autoPromotion: "hold",
      handlerArtifactBound: true,
      settlementDurablyVerified: true,
      durabilityAuthorityKind: "synthetic-filesystem-replica",
      budgetStatus: "succeeded",
      ingressProjectionStatus: "completed",
      networkCall: false,
      fixtureResponse: true,
      governedPmTestRun: true,
      productionGovernedPmRun: false,
      credentialExposed: false,
      responseContentExposed: false,
    });
    expect(output.usage.totalTokens).toBe(252);
    expect(output.settlementDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(output.persistenceRecordDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
  }, 60_000);

  it("refuses ambiguous fixture and paid-live flags", () => {
    const result = run("--fixture", "--confirm-live");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("mutually exclusive");
    expect(result.stdout).toBe("");
  });
});
