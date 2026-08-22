import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  FRAGMENT_KEYS,
  PRODUCER_PATHS,
  PROFILE_VERSION,
  SESSION_UX_FRAGMENT_FILE,
  SESSION_UX_PRODUCER_PATHS,
  SESSION_UX_THRESHOLDS,
  TEST_IDS,
  THRESHOLDS,
  appendSessionUxFragment,
  buildSessionUxNodeEvidence,
  digest,
  measureSessionUxProjectionSurfaces,
  validateSessionUxFragment,
  verifySessionUxFragment,
} from "../../scripts/session-ux-audit-fragment.mjs";

const HEAD = "a".repeat(40);
const SOURCE = Object.freeze({
  workflowId:
    "owner/repo/.github/workflows/ide-roadmap-accessibility-performance.yml@refs/heads/main",
  runId: "42",
  jobId: "accessibility-performance",
  artifactName: "ide-accessibility-performance-linux-1",
});
const ACTIONS_ENVIRONMENT = Object.freeze({
  GITHUB_ACTIONS: "true",
  GITHUB_WORKFLOW_REF: SOURCE.workflowId,
  GITHUB_RUN_ID: SOURCE.runId,
  GITHUB_JOB: SOURCE.jobId,
  CC_P2_ARTIFACT: SOURCE.artifactName,
});
const roots = [];

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function entry(filePath) {
  const bytes = fs.readFileSync(filePath);
  return { sha256: digest(bytes), bytes: bytes.length };
}

function browserMeasurements() {
  return {
    selectedSessionCount: 128,
    postedMoveSessionCount: 128,
    postedMoveRevisionPreserved: true,
    thinkingExpandedWhileStreaming: true,
    thinkingCollapsedAfterTool: true,
    thinkingCollapsedAfterTurnEnd: true,
    thinkingCollapseFailureCount: 0,
  };
}

function javaMeasurements() {
  return {
    projectionConnected: true,
    sessionCount: 128,
    groupCount: 1,
    groupRevisionPreserved: true,
    groupedSessionCount: 128,
    focusRowCount: 1,
    pendingQuestionPreserved: true,
    settledAnswerPreserved: true,
    reasoningExpandedBeforeSettlement: true,
    reasoningCollapsedAfterSettlement: true,
    reasoningRestoredAfterToggle: true,
    thinkingCollapseFailureCount: 0,
  };
}

function createFixture() {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-session-ux-fragment-"),
  );
  roots.push(root);
  const input = path.join(root, "input");
  const artifact = path.join(root, "artifact");
  fs.mkdirSync(input);
  fs.mkdirSync(artifact);
  const measured = measureSessionUxProjectionSurfaces({
    stateFile: path.join(input, "session-workbench.json"),
  });
  const projectionPath = path.join(input, "projection.json");
  writeJson(projectionPath, measured.projection);
  const projectionBytes = fs.readFileSync(projectionPath);
  const nodeEvidence = buildSessionUxNodeEvidence({
    headSha: HEAD,
    platform: "linux",
    source: SOURCE,
    projectionBytes,
    projectionRevision: measured.projection.revision,
    groupRevision: measured.projection.groups.revision,
    cli: measured.cli,
    vscode: { ...measured.vscode, ...browserMeasurements() },
  });
  const nodeEvidencePath = path.join(input, "node-evidence.json");
  writeJson(nodeEvidencePath, nodeEvidence);
  const jetbrainsEvidence = {
    schema: "chainlesschain.session-ux-jetbrains-evidence.v1",
    headSha: HEAD,
    platform: "linux",
    javaVersion: "21.0.8",
    javaArch: "amd64",
    source: SOURCE,
    projectionDigest: digest(projectionBytes),
    projectionRevision: measured.projection.revision,
    groupRevision: measured.projection.groups.revision,
    measurements: javaMeasurements(),
  };
  const jetbrainsEvidencePath = path.join(input, "jetbrains-evidence.json");
  writeJson(jetbrainsEvidencePath, jetbrainsEvidence);

  const hostPath = path.join(artifact, "host-environment.json");
  writeJson(hostPath, {
    releaseCommit: HEAD,
    operatingSystem: "linux",
    architecture: "x64",
    nodeVersion: process.version,
    hosts: ["vscode", "jetbrains"],
    provenance: {
      workflowRef: SOURCE.workflowId,
      runId: SOURCE.runId,
      job: SOURCE.jobId,
      artifactName: SOURCE.artifactName,
    },
  });
  writeJson(path.join(artifact, "manifest.json"), {
    schema: "chainlesschain.accessibility-performance-manifest.v1",
    releaseCommit: HEAD,
    operatingSystem: "linux",
    files: { "host-environment.json": entry(hostPath) },
  });
  return {
    artifact,
    projectionPath,
    nodeEvidencePath,
    jetbrainsEvidencePath,
  };
}

function append(fixture, overrides = {}) {
  return appendSessionUxFragment({
    artifactDir: fixture.artifact,
    releaseCommit: HEAD,
    artifactName: SOURCE.artifactName,
    projectionPath: fixture.projectionPath,
    nodeEvidencePath: fixture.nodeEvidencePath,
    jetbrainsEvidencePath: fixture.jetbrainsEvidencePath,
    environment: ACTIONS_ENVIRONMENT,
    platform: "linux",
    producerReader: () => Buffer.from("exact SESSION-UX producer fixture"),
    requireWorkingTreeMatch: false,
    headReader: () => HEAD,
    ...overrides,
  });
}

function verify(fixture) {
  return verifySessionUxFragment({
    artifactDir: fixture.artifact,
    releaseCommit: HEAD,
    artifactName: SOURCE.artifactName,
    expectedPlatform: "linux",
    expectedSource: SOURCE,
    producerReader: () => Buffer.from("exact SESSION-UX producer fixture"),
  });
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("SESSION-UX canonical audit fragment", () => {
  it("exports the locked profile contract and path-triggers every exact producer", () => {
    expect(PROFILE_VERSION).toBe("session-ux/v1");
    expect(THRESHOLDS).toBe(SESSION_UX_THRESHOLDS);
    expect(TEST_IDS.length).toBeGreaterThan(0);
    expect(PRODUCER_PATHS).toBe(SESSION_UX_PRODUCER_PATHS);
    const workflow = fs.readFileSync(
      path.resolve(
        import.meta.dirname,
        "../../../../.github/workflows/ide-roadmap-accessibility-performance.yml",
      ),
      "utf8",
    );
    for (const producerPath of PRODUCER_PATHS) {
      expect(workflow).toContain(`- "${producerPath}"`);
    }
  });

  it("binds real projection/group/CAS/128/focus measurements into exactly 13 keys", () => {
    const fixture = createFixture();
    const fragment = append(fixture);

    expect(Object.keys(fragment).sort()).toEqual([...FRAGMENT_KEYS].sort());
    expect(fragment).toMatchObject({
      schema: "chainlesschain.claude-code-increment-audit-fragment.v1",
      commitmentId: "SESSION-UX",
      headSha: HEAD,
      os: "linux",
      profileVersion: "session-ux/v1",
      thresholds: SESSION_UX_THRESHOLDS,
      disposition: "required",
      source: SOURCE,
      outcome: "passed",
      measurements: {
        cli: {
          sessionCount: 128,
          groupedSessionCount: 128,
          staleCasErrorCode: "SESSION_GROUP_STALE",
        },
        vscode: {
          selectedSessionCount: 128,
          focusRowCount: 1,
          thinkingCollapseFailureCount: 0,
        },
        jetbrains: {
          sessionCount: 128,
          reasoningCollapsedAfterSettlement: true,
        },
      },
    });
    expect(Object.keys(fragment.producerDigests).sort()).toEqual(
      [...SESSION_UX_PRODUCER_PATHS].sort(),
    );
    expect(verify(fixture)).toMatchObject({
      required: { commitmentId: "SESSION-UX", outcome: "passed" },
    });
  });

  it("fails closed outside Actions and on forged OS or provenance", () => {
    const local = createFixture();
    expect(() => append(local, { environment: {} })).toThrow(
      /only by GitHub Actions/u,
    );

    const wrongOs = createFixture();
    expect(() => append(wrongOs, { platform: "darwin" })).toThrow();

    const forged = createFixture();
    expect(() =>
      append(forged, {
        environment: {
          ...ACTIONS_ENVIRONMENT,
          GITHUB_WORKFLOW_REF: "owner/repo/.github/workflows/forged.yml@main",
        },
      }),
    ).toThrow();
  });

  it("rejects self-consistent raw-evidence and canonical-fragment tampering", () => {
    const raw = createFixture();
    append(raw);
    const rawPath = path.join(raw.artifact, "session-ux-node-evidence.json");
    const rawValue = JSON.parse(fs.readFileSync(rawPath, "utf8"));
    rawValue.vscode.selectedSessionCount = 127;
    writeJson(rawPath, rawValue);
    const rawManifestPath = path.join(raw.artifact, "manifest.json");
    const rawManifest = JSON.parse(fs.readFileSync(rawManifestPath, "utf8"));
    rawManifest.files["session-ux-node-evidence.json"] = entry(rawPath);
    writeJson(rawManifestPath, rawManifest);
    expect(() => verify(raw)).toThrow();

    const canonical = createFixture();
    append(canonical);
    const fragmentPath = path.join(
      canonical.artifact,
      SESSION_UX_FRAGMENT_FILE,
    );
    const fragment = JSON.parse(fs.readFileSync(fragmentPath, "utf8"));
    fragment.measurements.vscode.selectedSessionCount = 127;
    writeJson(fragmentPath, fragment);
    const manifestPath = path.join(canonical.artifact, "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    manifest.files[SESSION_UX_FRAGMENT_FILE] = entry(fragmentPath);
    writeJson(manifestPath, manifest);
    expect(() => validateSessionUxFragment(fragment)).toThrow();
    expect(() => verify(canonical)).toThrow();
  });
});
