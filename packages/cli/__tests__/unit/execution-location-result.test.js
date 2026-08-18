import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  EXECUTION_LOCATION_RESULT_BUNDLE_SCHEMA,
  EXECUTION_LOCATION_RESULT_VERIFICATION_SCHEMA,
  createExecutionLocationResultBundle,
  normalizeExecutionLocationResultBundle,
  readExecutionLocationResultBundle,
  readExecutionLocationResultFile,
  verifyExecutionLocationResultBundle,
} from "../../src/lib/execution-location-result.js";

const temporaryDirectories = [];

function makeDirectory() {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-location-result-"),
  );
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function targetAuthority(overrides = {}) {
  const sourceHeadHash = "1".repeat(64);
  const bindingEventHash = "2".repeat(64);
  return {
    authority: "verified-session-location-handoff",
    sessionId: "session-result",
    headHash: "3".repeat(64),
    eventCount: 5,
    bindingEventHash,
    bindingEventCount: 3,
    locationHandoff: {
      eventHash: bindingEventHash,
      eventCount: 3,
      handoffId: `sha256:${"4".repeat(64)}`,
      source: {
        sessionId: "session-result",
        headHash: sourceHeadHash,
        eventCount: 2,
        transcriptDigest: `sha256:${"5".repeat(64)}`,
      },
      target: {
        profileDigest: `sha256:${"6".repeat(64)}`,
        targetEvidenceId: "container-review",
        targetFactsDigest: `sha256:${"7".repeat(64)}`,
        attestationDigest: `sha256:${"8".repeat(64)}`,
      },
    },
    ...overrides,
  };
}

function makeBundle(overrides = {}) {
  return createExecutionLocationResultBundle({
    sessionAuthority: targetAuthority(),
    resultId: "result-1",
    summaryBytes: Buffer.from("review complete", "utf8"),
    diffBytes: Buffer.from("diff --git a/a b/a\n", "utf8"),
    artifacts: [
      { mediaType: "application/json", bytes: Buffer.from('{"ok":true}') },
    ],
    evidence: [
      { mediaType: "text/plain", bytes: Buffer.from("tests: pass") },
    ],
    ...overrides,
  });
}

describe("execution location result bundle", () => {
  it("binds actual returned bytes to the target handoff and unchanged source", () => {
    const bundle = makeBundle();
    expect(bundle).toMatchObject({
      schema: EXECUTION_LOCATION_RESULT_BUNDLE_SCHEMA,
      resultId: "result-1",
      session: {
        sessionId: "session-result",
        source: { headHash: "1".repeat(64), eventCount: 2 },
        target: { headHash: "3".repeat(64), eventCount: 5 },
      },
      summary: { byteLength: 15 },
      artifacts: [{ mediaType: "application/json", byteLength: 11 }],
      evidence: [{ mediaType: "text/plain", byteLength: 11 }],
    });
    expect(bundle.bundleDigest).toMatch(/^sha256:[a-f0-9]{64}$/);

    const normalized = normalizeExecutionLocationResultBundle(
      JSON.parse(JSON.stringify(bundle)),
    );
    expect(normalized).toEqual(bundle);
    const verified = verifyExecutionLocationResultBundle({
      bundle: normalized,
      sourceAuthority: {
        sessionId: "session-result",
        headHash: "1".repeat(64),
        eventCount: 2,
      },
      expectedHandoffId: `sha256:${"4".repeat(64)}`,
    });
    expect(verified).toMatchObject({
      schema: EXECUTION_LOCATION_RESULT_VERIFICATION_SCHEMA,
      resultId: "result-1",
      bundleDigest: bundle.bundleDigest,
      applied: false,
      artifacts: [{ mediaType: "application/json", byteLength: 11 }],
    });
    expect(JSON.stringify(verified)).not.toContain("review complete");
    expect(JSON.stringify(verified)).not.toContain("tests: pass");
  });

  it("rejects content, bundle digest, source, and handoff drift", () => {
    const bundle = JSON.parse(JSON.stringify(makeBundle()));
    const contentTamper = structuredClone(bundle);
    contentTamper.summary.contentBase64 = Buffer.from("forged").toString(
      "base64",
    );
    expect(() => normalizeExecutionLocationResultBundle(contentTamper)).toThrow(
      /bytes or digest/,
    );

    const digestTamper = structuredClone(bundle);
    digestTamper.bundleDigest = `sha256:${"0".repeat(64)}`;
    expect(() => normalizeExecutionLocationResultBundle(digestTamper)).toThrow(
      /bundle digest/,
    );
    expect(() =>
      verifyExecutionLocationResultBundle({
        bundle,
        sourceAuthority: {
          sessionId: "session-result",
          headHash: "9".repeat(64),
          eventCount: 2,
        },
        expectedHandoffId: `sha256:${"4".repeat(64)}`,
      }),
    ).toThrow(/source authority or handoff changed/);
    expect(() =>
      verifyExecutionLocationResultBundle({
        bundle,
        sourceAuthority: {
          sessionId: "session-result",
          headHash: "1".repeat(64),
          eventCount: 2,
        },
        expectedHandoffId: `sha256:${"9".repeat(64)}`,
      }),
    ).toThrow(/source authority or handoff changed/);
  });

  it("rejects inconsistent handoff projections and duplicate returned bytes", () => {
    expect(() =>
      makeBundle({
        sessionAuthority: targetAuthority({ bindingEventCount: 4 }),
      }),
    ).toThrow(/handoff authority is inconsistent/);
    const duplicate = {
      mediaType: "text/plain",
      bytes: Buffer.from("same"),
    };
    expect(() =>
      makeBundle({ artifacts: [duplicate], evidence: [duplicate] }),
    ).toThrow(/duplicate content/);
  });

  it("reads only bounded single-link files within the data boundary", () => {
    const root = makeDirectory();
    const summary = path.join(root, "summary.txt");
    fs.writeFileSync(summary, "summary", "utf8");
    expect(
      readExecutionLocationResultFile(summary, {
        boundaryRoot: root,
        runtime: { platform: process.platform, uvVersion: process.versions.uv },
      }).toString("utf8"),
    ).toBe("summary");
    const outside = path.join(makeDirectory(), "outside.txt");
    fs.writeFileSync(outside, "outside", "utf8");
    expect(() =>
      readExecutionLocationResultFile(outside, { boundaryRoot: root }),
    ).toThrow(/escapes the execution location data boundary/);
    const hardlink = path.join(root, "summary-link.txt");
    fs.linkSync(summary, hardlink);
    expect(() =>
      readExecutionLocationResultFile(summary, { boundaryRoot: root }),
    ).toThrow(/regular and single-link/);
  });

  it("reads and rehashes a canonical bundle JSON file", () => {
    const root = makeDirectory();
    const bundleFile = path.join(root, "bundle.json");
    const bundle = makeBundle();
    fs.writeFileSync(bundleFile, JSON.stringify(bundle), "utf8");
    expect(
      readExecutionLocationResultBundle(bundleFile, { boundaryRoot: root }),
    ).toEqual(bundle);
  });
});
