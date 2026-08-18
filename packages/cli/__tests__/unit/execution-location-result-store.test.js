import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createExecutionLocationBinding } from "../../src/lib/execution-location-contract.js";
import { createExecutionLocationResultBundle } from "../../src/lib/execution-location-result.js";
import {
  _executionLocationResultStoreFaultHooks,
  readStoredExecutionLocationResultBundle,
  storeExecutionLocationResultBundle,
} from "../../src/lib/execution-location-result-store.js";

const DIGEST = `sha256:${"1".repeat(64)}`;

function authority() {
  const source = {
    sessionId: "result-store-session-1",
    headHash: "a".repeat(64),
    eventCount: 3,
    transcriptDigest: `sha256:${"2".repeat(64)}`,
  };
  const targetBinding = createExecutionLocationBinding({
    location: "container",
    observed: true,
    observedAt: "2026-08-18T13:00:00.000Z",
    source: {
      cwd: "/target/repo",
      git: { root: "/target/repo", commit: "b".repeat(40) },
    },
    runtime: { platform: "linux", arch: "x64", tools: ["node"] },
  });
  const handoff = {
    schema: "chainlesschain.session-execution-location-handoff/v1",
    handoffId: `sha256:${"3".repeat(64)}`,
    source,
    target: {
      profileDigest: DIGEST,
      targetEvidenceId: "container-evidence-1",
      targetFactsDigest: `sha256:${"4".repeat(64)}`,
      attestationDigest: `sha256:${"5".repeat(64)}`,
      binding: targetBinding,
    },
    eventHash: "c".repeat(64),
    eventCount: 4,
  };
  return {
    authority: "verified-session-location-handoff",
    sessionId: source.sessionId,
    headHash: "d".repeat(64),
    eventCount: 6,
    bindingEventHash: handoff.eventHash,
    bindingEventCount: handoff.eventCount,
    locationHandoff: handoff,
    binding: targetBinding,
  };
}

function bundle() {
  return createExecutionLocationResultBundle({
    sessionAuthority: authority(),
    resultId: "stored-result-1",
    summaryBytes: Buffer.from("stored private summary", "utf8"),
    diffBytes: Buffer.from("diff --git a/a b/a\n", "utf8"),
    artifacts: [
      { mediaType: "application/json", bytes: Buffer.from('{"ok":true}') },
    ],
    evidence: [],
  });
}

describe("execution-location result bundle store", () => {
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-result-store-"));
    _executionLocationResultStoreFaultHooks.afterFilePublish = null;
  });

  afterEach(() => {
    _executionLocationResultStoreFaultHooks.afterFilePublish = null;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("publishes canonical bytes once and rehashes them on every read", () => {
    const expected = bundle();
    const first = storeExecutionLocationResultBundle(expected, { dir });
    expect(first).toMatchObject({
      stored: true,
      receipt: {
        sessionId: "result-store-session-1",
        resultId: "stored-result-1",
        bundleDigest: expected.bundleDigest,
        format: "canonical-json",
        retention: "explicit-delete-local-not-worm",
      },
    });
    expect(first.receipt.receiptDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(
      readStoredExecutionLocationResultBundle(first.receipt, { dir }),
    ).toEqual(expected);

    const retry = storeExecutionLocationResultBundle(expected, { dir });
    expect(retry).toEqual({ receipt: first.receipt, stored: false });
    expect(
      fs.readdirSync(dir).filter((name) => name.endsWith(".json")),
    ).toHaveLength(1);
  });

  it("recovers a file-published response loss without duplicating bytes", () => {
    const expected = bundle();
    _executionLocationResultStoreFaultHooks.afterFilePublish = () => {
      throw new Error("injected result store response loss");
    };
    expect(() => storeExecutionLocationResultBundle(expected, { dir })).toThrow(
      /injected result store response loss/u,
    );
    _executionLocationResultStoreFaultHooks.afterFilePublish = null;

    const retry = storeExecutionLocationResultBundle(expected, { dir });
    expect(retry.stored).toBe(false);
    expect(
      readStoredExecutionLocationResultBundle(retry.receipt, { dir }),
    ).toEqual(expected);
  });

  it("fails closed for receipt drift, byte tamper, and hardlinked storage", () => {
    const stored = storeExecutionLocationResultBundle(bundle(), { dir });
    expect(() =>
      readStoredExecutionLocationResultBundle(
        { ...stored.receipt, byteLength: stored.receipt.byteLength + 1 },
        { dir },
      ),
    ).toThrow(/receipt is invalid/u);

    const filePath = path.join(dir, `${stored.receipt.storeId}.json`);
    fs.writeFileSync(filePath, "tampered", "utf8");
    expect(() =>
      readStoredExecutionLocationResultBundle(stored.receipt, { dir }),
    ).toThrow(/identity|digest/u);

    fs.rmSync(filePath, { force: true });
    const restored = storeExecutionLocationResultBundle(bundle(), { dir });
    fs.linkSync(filePath, path.join(dir, "second-link.json"));
    expect(() =>
      readStoredExecutionLocationResultBundle(restored.receipt, { dir }),
    ).toThrow(/identity is invalid/u);
  });
});
