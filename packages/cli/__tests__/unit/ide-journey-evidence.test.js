import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  IDE_JOURNEY_EVIDENCE_SCHEMA,
  canonicalJson,
  redactDiagnosticText,
  sha256Buffer,
  writeIdeJourneyEvidence,
} from "../../../../scripts/ide-journey-evidence.mjs";

const temporaryRoots = [];

function temporaryRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-ide-evidence-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("IDE journey evidence", () => {
  it("redacts credentials without erasing release commits or digests", () => {
    const commit = "a".repeat(40);
    const digest = "b".repeat(64);
    const redacted = redactDiagnosticText(
      `Authorization: Bearer very-secret token=abc123 sk-live-secret ${commit} ${digest}`,
    );

    expect(redacted).not.toContain("very-secret");
    expect(redacted).not.toContain("abc123");
    expect(redacted).not.toContain("sk-live-secret");
    expect(redacted).toContain(commit);
    expect(redacted).toContain(digest);
  });

  it("writes immutable content-addressed evidence with redacted diagnostics", () => {
    const root = temporaryRoot();
    const diagnostics = path.join(root, "diagnostics-src");
    const artifactDir = path.join(root, "evidence");
    const vsix = path.join(root, "extension.vsix");
    fs.mkdirSync(diagnostics);
    fs.writeFileSync(
      path.join(diagnostics, "extension.log"),
      "token=do-not-persist\nactivation complete\n",
      "utf8",
    );
    fs.writeFileSync(vsix, "vsix bytes", "utf8");

    const result = writeIdeJourneyEvidence({
      artifactDir,
      journeyId: "vscode-activation",
      host: "vscode",
      hostVersion: "1.110.0",
      cliVersion: "0.200.0",
      extensionVersion: "0.40.0",
      transport: "local-bridge",
      result: "passed",
      releaseCommit: "c".repeat(40),
      startedAt: "2026-08-01T00:00:00.000Z",
      finishedAt: "2026-08-01T00:00:01.000Z",
      sourceRoots: [diagnostics],
      artifactPaths: [vsix],
    });

    expect(result.evidence).toMatchObject({
      schema: IDE_JOURNEY_EVIDENCE_SCHEMA,
      schemaVersion: 1,
      journeyId: "vscode-activation",
      releaseCommit: "c".repeat(40),
      result: "passed",
      evidenceComplete: true,
    });
    expect(result.evidence.evidenceDigest).toBe(
      sha256Buffer(
        canonicalJson(
          Object.fromEntries(
            Object.entries(result.evidence).filter(
              ([key]) => key !== "evidenceDigest",
            ),
          ),
        ),
      ),
    );
    const persisted = fs.readFileSync(result.destination, "utf8");
    const copiedLog = fs.readFileSync(
      path.join(
        artifactDir,
        result.evidence.artifacts.find(
          (artifact) => artifact.kind === "host-diagnostic",
        ).path,
      ),
      "utf8",
    );
    expect(persisted).not.toContain("do-not-persist");
    expect(copiedLog).not.toContain("do-not-persist");
    expect(copiedLog).toContain("activation complete");

    fs.writeFileSync(
      path.join(diagnostics, "extension.log"),
      "token=replacement-secret\nreplacement content\n",
      "utf8",
    );
    expect(() =>
      writeIdeJourneyEvidence({
        artifactDir,
        journeyId: "replacement-attempt",
        host: "vscode",
        hostVersion: "1.110.0",
        cliVersion: "0.200.0",
        result: "passed",
        releaseCommit: "d".repeat(40),
        sourceRoots: [diagnostics],
      }),
    ).toThrow();
    expect(fs.readFileSync(result.destination, "utf8")).toBe(persisted);
    expect(
      fs.readFileSync(
        path.join(
          artifactDir,
          result.evidence.artifacts.find(
            (artifact) => artifact.kind === "host-diagnostic",
          ).path,
        ),
        "utf8",
      ),
    ).toBe(copiedLog);
  });

  it("does not accept a release artifact without host diagnostics", () => {
    const root = temporaryRoot();
    const vsix = path.join(root, "extension.vsix");
    fs.writeFileSync(vsix, "vsix bytes", "utf8");

    const { evidence } = writeIdeJourneyEvidence({
      artifactDir: path.join(root, "evidence"),
      journeyId: "artifact-only",
      host: "vscode",
      hostVersion: "1.110.0",
      cliVersion: "0.200.0",
      result: "passed",
      releaseCommit: "c".repeat(40),
      artifactPaths: [vsix],
    });

    expect(evidence.evidenceComplete).toBe(false);
    expect(evidence.incidents).toContainEqual({
      code: "host-diagnostics-missing",
    });
  });

  it("marks missing exact coordinates and artifacts incomplete", () => {
    const root = temporaryRoot();
    const { evidence } = writeIdeJourneyEvidence({
      artifactDir: path.join(root, "evidence"),
      journeyId: "incomplete",
      host: "jetbrains",
      result: "passed",
      releaseCommit: "not-a-commit",
      execFileSync: () => "not-a-commit",
    });

    expect(evidence.evidenceComplete).toBe(false);
    expect(evidence.incidents.map((incident) => incident.code)).toEqual(
      expect.arrayContaining([
        "exact-release-commit-missing",
        "host-version-missing",
        "cli-version-missing",
        "evidence-artifacts-missing",
      ]),
    );
  });
});
