import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  RC_DEFAULT_FRAGMENT_SCHEMA,
  RC_DEFAULT_PRODUCER_FILES,
  RC_DEFAULT_TEST_IDS,
  RC_DEFAULT_THRESHOLDS,
  aggregateRcDefaultFragments,
  buildRcDefaultFragment,
  normalizeRcDefaultFragment,
  runRcDefaultCampaign,
} from "../../scripts/verify-rc-default-audit.mjs";

const temporaryDirectories = [];
const HEAD_SHA = "a".repeat(40);

function fakeDigests() {
  return Object.fromEntries(
    RC_DEFAULT_PRODUCER_FILES.map((relativePath) => [
      relativePath,
      `sha256:${"0".repeat(64)}`,
    ]),
  );
}

function fakeSource(osName) {
  return {
    workflowId:
      "chainlesschain/chainlesschain/.github/workflows/ide-roadmap-safety.yml@refs/heads/test",
    runId: "123456",
    jobId: `producer-${osName}`,
    artifactName: `rc-default-${osName}-${HEAD_SHA}`,
  };
}

function fragmentFor(osName, measurements, required = true) {
  return buildRcDefaultFragment({
    headSha: HEAD_SHA,
    osName,
    required,
    source: fakeSource(osName),
    measurements,
    digests: fakeDigests(),
  });
}

function writeEvidence(values) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "chainlesschain-rc-default-test-"),
  );
  temporaryDirectories.push(directory);
  values.forEach((value, index) => {
    fs.writeFileSync(
      path.join(directory, `${index}.json`),
      `${JSON.stringify(value, null, 2)}\n`,
      "utf8",
    );
  });
  return directory;
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    fs.rmSync(temporaryDirectories.pop(), { recursive: true, force: true });
  }
});

describe("RC-DEFAULT canonical audit evidence", () => {
  it("measures passive startup and the default authority boundaries", () => {
    const measurements = runRcDefaultCampaign({ runTests: false });

    expect(measurements).toMatchObject({
      passiveRemoteStateWrites: 0,
      defaultNonLoopbackExposureCount: 0,
      defaultPrivilegedScopeCount: 0,
      lanWithoutOptInAcceptedCount: 0,
      projectWideningAcceptedCount: 0,
      privilegedScopeWithoutOptInAcceptedCount: 0,
      disabledConfigurationStartsCount: 0,
      persistentSecretHits: 0,
      explicitLanOptInsAccepted: 1,
      explicitApproveOptInsAccepted: 1,
      explicitInterruptOptInsAccepted: 1,
    });
  });

  it("emits the exact canonical fragment contract", () => {
    const measurements = runRcDefaultCampaign({ runTests: false });
    const fragment = fragmentFor("windows", measurements, false);

    expect(fragment.schema).toBe(RC_DEFAULT_FRAGMENT_SCHEMA);
    expect(fragment.thresholds).toEqual(RC_DEFAULT_THRESHOLDS);
    expect(fragment.testIds).toEqual(RC_DEFAULT_TEST_IDS);
    expect(fragment.disposition).toBe("advisory");
    expect(Object.keys(fragment)).toEqual([
      "schema",
      "commitmentId",
      "headSha",
      "os",
      "runtime",
      "profileVersion",
      "thresholds",
      "measurements",
      "testIds",
      "producerDigests",
      "disposition",
      "outcome",
      "source",
    ]);
  });

  it("rejects advisory evidence in a required aggregate", () => {
    const measurements = runRcDefaultCampaign({ runTests: false });
    const advisory = fragmentFor("linux", measurements, false);
    const directory = writeEvidence([advisory]);

    expect(() =>
      aggregateRcDefaultFragments({
        evidenceDirectory: directory,
        headSha: HEAD_SHA,
      }),
    ).toThrow(/required/u);
  });

  it("rejects an incomplete three-OS aggregate", () => {
    const measurements = runRcDefaultCampaign({ runTests: false });
    const directory = writeEvidence([
      fragmentFor("linux", measurements),
      fragmentFor("windows", measurements),
    ]);

    expect(() =>
      aggregateRcDefaultFragments({
        evidenceDirectory: directory,
        headSha: HEAD_SHA,
      }),
    ).toThrow(/exactly one fragment per OS/u);
  });

  it("rejects threshold and producer-digest tampering", () => {
    const measurements = runRcDefaultCampaign({ runTests: false });
    const fragment = fragmentFor("macos", measurements);
    const thresholdTamper = structuredClone(fragment);
    thresholdTamper.thresholds.persistentSecretHitsMaximum = 1;
    expect(() =>
      normalizeRcDefaultFragment(thresholdTamper, {
        expectedHead: HEAD_SHA,
        required: true,
      }),
    ).toThrow();

    const digestTamper = structuredClone(fragment);
    digestTamper.producerDigests[RC_DEFAULT_PRODUCER_FILES[0]] =
      `sha256:${"f".repeat(63)}`;
    expect(() =>
      normalizeRcDefaultFragment(digestTamper, {
        expectedHead: HEAD_SHA,
        required: true,
      }),
    ).toThrow();
  });
});
