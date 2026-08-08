import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { verifyMcpSecurityEvidenceSet } from "../../scripts/ide-roadmap-mcp-security-gate.mjs";
import { IDE_ROADMAP_MANIFEST_VERSION } from "../../scripts/verify-ide-roadmap-fixtures.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..", "..");
const releaseCommit = "a".repeat(40);

function sha256File(filePath) {
  return `sha256:${crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex")}`;
}

function evidenceFor(operatingSystem) {
  const manifestPath = path.join(
    repoRoot,
    "tests",
    "fixtures",
    "ide-roadmap",
    "manifest.json",
  );
  const roadmapFixturePath = path.join(
    repoRoot,
    "tests",
    "fixtures",
    "ide-roadmap",
    "s0-skill-mcp.json",
  );
  const serverFixturePath = path.join(
    repoRoot,
    "packages",
    "cli",
    "__tests__",
    "fixtures",
    "mcp-adversarial-effect-server.mjs",
  );
  const sampleCases = [
    ["claimed_read_mutation", "unknown"],
    ["unknown_mutation", "unknown"],
    ["declared_write", "write"],
  ];
  const samples = Array.from({ length: 100 }, (_, iteration) =>
    sampleCases.map(([toolName, effect]) => ({
      id: `${toolName}-${iteration}`,
      toolName,
      iteration,
      pass: true,
      decision: "ask",
      code: "CC_MCP_EFFECT_CONFIRMATION_REQUIRED",
      effect,
      trusted: false,
      mutationCount: 0,
      ledgerRecordCount: 0,
    })),
  ).flat();
  return {
    schema: "chainlesschain.ide-roadmap-mcp-security-evidence.v2",
    releaseCommit,
    result: "passed",
    startedAt: "2026-08-06T00:00:00.000Z",
    finishedAt: "2026-08-06T00:01:00.000Z",
    runner: { operatingSystem, architecture: "x64", nodeVersion: "v22.12.0" },
    transport: "stdio-mcp",
    fixture: {
      manifestVersion: IDE_ROADMAP_MANIFEST_VERSION,
      digests: {
        manifest: sha256File(manifestPath),
        roadmapFixture: sha256File(roadmapFixturePath),
        adversarialServer: sha256File(serverFixturePath),
      },
    },
    matrix: {
      requiredRunsPerTool: 100,
      tools: ["claimed_read_mutation", "unknown_mutation", "declared_write"],
      sampleCount: 300,
      passCount: 300,
      unapprovedTransportCallCount: 0,
      unapprovedMutationCount: 0,
      unapprovedLedgerRecordCount: 0,
      samples,
    },
    approvedProbe: {
      pass: true,
      permissionPromptCount: 1,
      transportCallCount: 1,
      declaredEffect: "read",
      authorizedEffect: "unknown",
      trusted: false,
      ledgerStarted: true,
      ledgerSettled: true,
      resourceScopes: ["path:approved-claimed-read.txt"],
    },
    staleHostReadPolicyProbe: {
      pass: true,
      sampleCount: 2,
      transportCallCount: 0,
      mutationCount: 0,
      ledgerRecordCount: 0,
      samples: [
        {
          toolName: "unknown_mutation",
          expectedEffect: "unknown",
          observedEffect: "unknown",
          decision: "ask",
          code: "CC_MCP_EFFECT_CONFIRMATION_REQUIRED",
          trusted: false,
          transportCallCount: 0,
          mutationCount: 0,
          ledgerRecordCount: 0,
          pass: true,
        },
        {
          toolName: "declared_write",
          expectedEffect: "write",
          observedEffect: "write",
          decision: "ask",
          code: "CC_MCP_EFFECT_CONFIRMATION_REQUIRED",
          trusted: false,
          transportCallCount: 0,
          mutationCount: 0,
          ledgerRecordCount: 0,
          pass: true,
        },
      ],
    },
    codeSnapshotRaceProbe:
      operatingSystem === "windows"
        ? {
            required: false,
            pass: true,
            reason: "windows-atomic-launch-covered-by-filter-oplock-gate",
          }
        : {
            required: true,
            pass: true,
            backend:
              operatingSystem === "linux"
                ? "linux-fd-code-snapshot"
                : "macos-fd-code-snapshot",
            mechanism:
              operatingSystem === "linux"
                ? "verified-o_tmpfile-copy-inherited-fd-module-compile-v1"
                : "verified-private-runtime-copy-and-unlinked-entry-fd-module-compile-v1",
            handleAtomic: operatingSystem === "linux",
            entrySnapshotAtomic: true,
            runtimeLaunchAtomic: operatingSystem === "linux",
            sharedLibraryClosure: false,
            sourceReplacementObserved: true,
            originalSnapshotExecuted: true,
            maliciousPathExecuted: false,
            exitCode: 0,
            stdoutBytes: 14,
            stderrBytes: 0,
          },
    invariants: {
      annotationsAreHintsOnly: true,
      defaultConfirmationRequired: true,
      hostAuthorizationRequiredForTrustedRead: true,
      unapprovedEffectsBeforeTransport: 0,
      unapprovedMutations: 0,
      unapprovedLedgerWrites: 0,
      claimedReadRemainsUnknownWithoutHostAuthorization: true,
      staleHostReadCannotDowngradeRisk: true,
    },
  };
}

describe("IDE roadmap MCP security evidence verifier", () => {
  let evidenceDir;

  beforeEach(() => {
    evidenceDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-mcp-evidence-"));
    for (const operatingSystem of ["linux", "macos", "windows"]) {
      fs.writeFileSync(
        path.join(evidenceDir, `${operatingSystem}.json`),
        JSON.stringify(evidenceFor(operatingSystem)),
        "utf8",
      );
    }
  });

  afterEach(() => {
    fs.rmSync(evidenceDir, { recursive: true, force: true });
  });

  it("accepts exactly three current-fixture OS artifacts and aggregates zero effects", () => {
    const aggregate = verifyMcpSecurityEvidenceSet({
      evidenceDir,
      releaseCommit,
    });

    expect(aggregate).toMatchObject({
      releaseCommit,
      result: "passed",
      operatingSystems: ["linux", "macos", "windows"],
      sampleCount: 900,
      unapprovedTransportCallCount: 0,
      unapprovedMutationCount: 0,
      unapprovedLedgerRecordCount: 0,
      approvedProbeCount: 3,
      staleHostReadPolicyProbeCount: 3,
      codeSnapshotRaceOperatingSystems: ["linux", "macos"],
      codeSnapshotRaceProbeCount: 2,
      atomicPathReplacementEscapeCount: 0,
      staleHostReadCannotDowngradeRisk: true,
    });
  });

  it("rejects a single unapproved mutation even when every sample says pass", () => {
    const windowsPath = path.join(evidenceDir, "windows.json");
    const windows = JSON.parse(fs.readFileSync(windowsPath, "utf8"));
    windows.matrix.unapprovedMutationCount = 1;
    fs.writeFileSync(windowsPath, JSON.stringify(windows), "utf8");

    expect(() =>
      verifyMcpSecurityEvidenceSet({ evidenceDir, releaseCommit }),
    ).toThrow(/unapprovedMutationCount/);
  });

  it("rejects an incomplete platform matrix", () => {
    fs.rmSync(path.join(evidenceDir, "macos.json"));

    expect(() =>
      verifyMcpSecurityEvidenceSet({ evidenceDir, releaseCommit }),
    ).toThrow(/exactly linux, macos, windows/);
  });

  it("rejects evidence bound to a stale fixture manifest version", () => {
    const windowsPath = path.join(evidenceDir, "windows.json");
    const windows = JSON.parse(fs.readFileSync(windowsPath, "utf8"));
    windows.fixture.manifestVersion = "1.1.1";
    fs.writeFileSync(windowsPath, JSON.stringify(windows), "utf8");

    expect(() =>
      verifyMcpSecurityEvidenceSet({ evidenceDir, releaseCommit }),
    ).toThrow(/manifest version/);
  });

  it("rejects a stale host read policy risk downgrade", () => {
    const windowsPath = path.join(evidenceDir, "windows.json");
    const windows = JSON.parse(fs.readFileSync(windowsPath, "utf8"));
    windows.staleHostReadPolicyProbe.samples[1].observedEffect = "read";
    fs.writeFileSync(windowsPath, JSON.stringify(windows), "utf8");

    expect(() =>
      verifyMcpSecurityEvidenceSet({ evidenceDir, releaseCommit }),
    ).toThrow(/stale host read policy probe/);
  });

  it("rejects a pathname replacement that escapes the atomic snapshot", () => {
    const macPath = path.join(evidenceDir, "macos.json");
    const mac = JSON.parse(fs.readFileSync(macPath, "utf8"));
    mac.codeSnapshotRaceProbe.maliciousPathExecuted = true;
    fs.writeFileSync(macPath, JSON.stringify(mac), "utf8");

    expect(() =>
      verifyMcpSecurityEvidenceSet({ evidenceDir, releaseCommit }),
    ).toThrow(/code snapshot race probe/);
  });
});
