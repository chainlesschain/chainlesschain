import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  REQUIRED_PROCESS_COUNT,
  SESSION_MESSAGE_FABRIC_AGGREGATE_SCHEMA,
  SESSION_MESSAGE_FABRIC_EVIDENCE_SCHEMA,
  aggregateSessionMessageFabricEvidence,
  produceSessionMessageFabricEvidence,
} from "../../scripts/verify-session-message-fabric.mjs";

const REPOSITORY_ROOT = fileURLToPath(new URL("../../../..", import.meta.url));
const temporaryDirectories = [];
const RELEASE_COMMIT = "a".repeat(40);

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("cross-session message exact-head evidence", () => {
  it("admits 32 concurrent processes and aggregates exactly three operating systems", async () => {
    const evidence = await produceSessionMessageFabricEvidence({
      releaseCommit: RELEASE_COMMIT,
      verifyGitHead: false,
      source: {
        workflowId:
          "owner/repo/.github/workflows/cli-reliability-soak.yml@refs/heads/main",
        runId: "12345",
        jobId: "session-message-fabric-test",
        artifactName: "session-message-fabric-test",
      },
    });
    expect(evidence.measurements).toMatchObject({
      processCount: REQUIRED_PROCESS_COUNT,
      delivered: REQUIRED_PROCESS_COUNT,
      queueCapacity: 100,
      receiptStatuses: ["delivered", "expired", "full", "refused"],
      idleNotifications: 1,
      offlineFalseDeliveries: 0,
      crashRecoveredMessages: 1,
      unknownCommitRetries: 1,
      duplicateDeliveries: 0,
      historyLeaks: 0,
    });
    expect(evidence).toMatchObject({
      schema: SESSION_MESSAGE_FABRIC_EVIDENCE_SCHEMA,
      commitmentId: "XSESSION",
      profileVersion: "claude-2.1.224-238-xsession/v1",
      disposition: "required",
      outcome: "passed",
      runtime: { name: "node", version: expect.any(String) },
      producerDigests: expect.any(Object),
      source: expect.any(Object),
    });
    expect(Object.keys(evidence).sort()).toEqual(
      [
        "commitmentId",
        "disposition",
        "headSha",
        "measurements",
        "os",
        "outcome",
        "producerDigests",
        "profileVersion",
        "runtime",
        "schema",
        "source",
        "testIds",
        "thresholds",
      ].sort(),
    );

    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "cc-session-message-aggregate-"),
    );
    temporaryDirectories.push(directory);
    for (const platform of ["linux", "macos", "windows"]) {
      const fragment = {
        ...evidence,
        os: platform,
        source: {
          workflowId:
            "owner/repo/.github/workflows/cli-reliability-soak.yml@refs/heads/main",
          runId: "12345",
          jobId: `session-message-fabric-${platform}`,
          artifactName: `session-message-fabric-${platform}`,
        },
      };
      fs.writeFileSync(
        path.join(directory, `${platform}.json`),
        JSON.stringify(fragment),
      );
    }
    const aggregateOptions = {
      evidenceDir: directory,
      releaseCommit: RELEASE_COMMIT,
      verifyGitHead: false,
      source: {
        workflowId:
          "owner/repo/.github/workflows/cli-reliability-soak.yml@refs/heads/main",
        runId: "12345",
        jobId: "session-message-fabric-aggregate",
        artifactName: `xsession-audit-aggregate-${RELEASE_COMMIT}`,
      },
    };
    expect(
      aggregateSessionMessageFabricEvidence(aggregateOptions),
    ).toMatchObject({
      schema: SESSION_MESSAGE_FABRIC_AGGREGATE_SCHEMA,
      headSha: RELEASE_COMMIT,
      operatingSystems: ["linux", "macos", "windows"],
      fragments: expect.arrayContaining([
        expect.objectContaining({ os: "linux" }),
        expect.objectContaining({ os: "macos" }),
        expect.objectContaining({ os: "windows" }),
      ]),
      fragmentDigests: {
        linux: expect.stringMatching(/^sha256:/),
        macos: expect.stringMatching(/^sha256:/),
        windows: expect.stringMatching(/^sha256:/),
      },
    });

    const windowsPath = path.join(directory, "windows.json");
    const tampered = JSON.parse(fs.readFileSync(windowsPath, "utf8"));
    tampered.thresholds.maxMessageBytes += 1;
    fs.writeFileSync(windowsPath, JSON.stringify(tampered));
    expect(() =>
      aggregateSessionMessageFabricEvidence(aggregateOptions),
    ).toThrow();
  }, 60_000);

  it("is required by both CLI CI and the existing reliability soak", () => {
    const cliCi = fs.readFileSync(
      path.join(REPOSITORY_ROOT, ".github", "workflows", "cli-ci.yml"),
      "utf8",
    );
    const reliability = fs.readFileSync(
      path.join(
        REPOSITORY_ROOT,
        ".github",
        "workflows",
        "cli-reliability-soak.yml",
      ),
      "utf8",
    );
    for (const workflow of [cliCi, reliability]) {
      expect(workflow).toContain("verify-session-message-fabric.mjs");
      expect(workflow).toContain("session-message-fabric-");
    }
    expect(reliability).toContain("session-message-fabric-aggregate");
    expect(reliability).toContain("xsession-audit-aggregate-");
    expect(reliability).toContain(
      "ubuntu-latest, windows-latest, macos-latest",
    );
  });
});
