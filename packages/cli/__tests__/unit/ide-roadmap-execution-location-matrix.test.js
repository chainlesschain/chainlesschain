import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  EVIDENCE_FILES,
  sumTrajectoryCounters,
} from "../../scripts/ide-roadmap-execution-location-matrix.mjs";
import {
  REQUIRED_TRANSPORTS,
  verifyCell,
} from "../../scripts/verify-ide-roadmap-execution-location.mjs";

const COMMIT = "a".repeat(40);
const DIGEST = `sha256:${"b".repeat(64)}`;
const roots = [];

function digest(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function trajectory(reconnect = false) {
  return {
    schema: "chainlesschain.execution-location-trajectory.v1",
    sessionIdDigest: DIGEST,
    sourceHeadDigest: DIGEST,
    sourceEventCount: 3,
    attestationDigest: DIGEST,
    targetHandoffAttestationDigest: `sha256:${"c".repeat(64)}`,
    targetFactsDigest: DIGEST,
    handoffId: DIGEST,
    resumeDigest: DIGEST,
    reconnectResumeDigest: reconnect ? DIGEST : null,
    collectionDigest: DIGEST,
    settlementDigest: DIGEST,
    reviewDigest: DIGEST,
    importDigest: DIGEST,
    launchCount: 1,
    resumeCount: reconnect ? 2 : 1,
    reconnectCount: reconnect ? 1 : 0,
    resultCollectCount: 1,
    resultReviewCount: 1,
    resultImportCount: 1,
    secretTransferCount: 0,
    silentFallbackCount: 0,
    duplicateHandoffCount: 0,
    duplicateResultSettlementCount: 0,
  };
}

function writeJson(directory, file, value) {
  fs.writeFileSync(
    path.join(directory, file),
    `${JSON.stringify(value)}\n`,
    "utf8",
  );
}

function makeCell(transport = "ssh") {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-location-evidence-"),
  );
  roots.push(directory);
  const provenance = {
    repository: "owner/repo",
    workflowRef: "owner/repo/.github/workflows/location.yml@refs/heads/main",
    workflowSha: COMMIT,
    runId: "42",
    runAttempt: "1",
    eventName: "workflow_dispatch",
    job: `${transport}-execution-location`,
    artifactName: `ide-execution-location-${transport}-1`,
  };
  const reconnect = trajectory(true);
  const campaign = Array.from({ length: 99 }, () => trajectory(false));
  writeJson(directory, "bootstrap.json", {
    schema: "chainlesschain.execution-location-bootstrap.v1",
  });
  writeJson(directory, "reconnect-prepared.json", {
    schema: "chainlesschain.execution-location-reconnect-prepared.v1",
    transport,
    prepared: true,
    sessionIdDigest: DIGEST,
    targetFactsDigest: DIGEST,
    handoffId: DIGEST,
    resumeDigest: DIGEST,
  });
  writeJson(directory, "network-fault.json", {
    schema: "chainlesschain.execution-location-network-fault.v1",
    injectedOutageCount: 1,
    unavailableProbeFailureCount: 1,
    unavailableProbeSuccessCount: 0,
    credentialLeakCount: 0,
    diagnostic: { messageDigest: DIGEST },
  });
  writeJson(directory, "reconnect-completed.json", {
    schema: "chainlesschain.execution-location-reconnect-completed.v1",
    trajectory: reconnect,
  });
  writeJson(directory, "campaign.json", {
    schema: "chainlesschain.execution-location-campaign.v1",
    iterations: 99,
    trajectories: campaign,
  });
  writeJson(directory, "outcome-observations.json", {
    schema: "chainlesschain.execution-location-outcome.v1",
    success: true,
    exactCommitBound: true,
    trajectoryCount: 100,
    ...sumTrajectoryCounters([reconnect, ...campaign]),
    injectedOutageCount: 1,
    unavailableProbeFailureCount: 1,
    staleAuthorityAcceptanceCount: 0,
    orphanProcessCount: 0,
  });
  writeJson(directory, "exact-commit.json", {
    schema: "chainlesschain.execution-location-exact-commit.v1",
    releaseCommit: COMMIT,
    exactCommitBound: true,
  });
  writeJson(directory, "provenance.json", {
    schema: "chainlesschain.execution-location-provenance.v1",
    releaseCommit: COMMIT,
    transport,
    ...provenance,
  });
  const files = Object.fromEntries(
    EVIDENCE_FILES.map((file) => {
      const bytes = fs.readFileSync(path.join(directory, file));
      return [file, { sha256: digest(bytes), bytes: bytes.length }];
    }),
  );
  writeJson(directory, "manifest.json", {
    schema: "chainlesschain.execution-location-manifest.v1",
    releaseCommit: COMMIT,
    transport,
    files,
  });
  return { directory, provenance };
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("IDE roadmap execution-location matrix", () => {
  it("requires the genuine WSL, Container, and strict SSH cells", () => {
    expect(REQUIRED_TRANSPORTS).toEqual(["wsl", "container", "ssh"]);
    const workflow = fs.readFileSync(
      path.resolve(
        import.meta.dirname,
        "../../../../.github/workflows/ide-roadmap-execution-location.yml",
      ),
      "utf8",
    );
    expect(workflow).toContain("WSL production location trajectory x100");
    expect(workflow).toContain("Container production location trajectory x100");
    expect(workflow).toContain(
      "Strict SSH production location trajectory x100",
    );
    expect(workflow).toContain("if: always()");
    expect(workflow).toContain('test "$WSL_RESULT" = success');
    expect(workflow).toContain("require all 300 trajectories");
    const linuxRunner = fs.readFileSync(
      path.resolve(
        import.meta.dirname,
        "../../../../.github/scripts/run-ide-roadmap-execution-location-linux.sh",
      ),
      "utf8",
    );
    const wslRunner = fs.readFileSync(
      path.resolve(
        import.meta.dirname,
        "../../../../.github/scripts/run-ide-roadmap-execution-location-wsl.ps1",
      ),
      "utf8",
    );
    expect(linuxRunner).toContain("run_matrix campaign --iterations 99");
    expect(wslRunner).toContain(
      'Invoke-Matrix "campaign" @("--iterations", "99")',
    );
  });

  it("rehashes a 100-trajectory cell and accepts one fail-closed reconnect", () => {
    const { directory, provenance } = makeCell("ssh");
    expect(
      verifyCell(directory, {
        transport: "ssh",
        releaseCommit: COMMIT,
        provenance,
      }),
    ).toMatchObject({ transport: "ssh", trajectoryCount: 100 });
  });

  it("rejects a modified producer file instead of trusting its manifest", () => {
    const { directory, provenance } = makeCell("container");
    fs.appendFileSync(path.join(directory, "campaign.json"), " ", "utf8");
    expect(() =>
      verifyCell(directory, {
        transport: "container",
        releaseCommit: COMMIT,
        provenance,
      }),
    ).toThrow(/digest drift/u);
  });

  it("keeps target resume on the production CLI with a bounded exit input", () => {
    const wrapper = fs.readFileSync(
      path.resolve(
        import.meta.dirname,
        "../../../../.github/scripts/ide-roadmap-execution-location-target.sh",
      ),
      "utf8",
    );
    expect(wrapper).toContain('"${1:-}" == "session"');
    expect(wrapper).toContain("printf '/exit\\n'");
    expect(wrapper).toContain(
      '"$CC_IDE_TARGET_NODE" "$CC_IDE_TARGET_ENTRY" "$@"',
    );
  });
});
