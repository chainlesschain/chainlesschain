import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArtifactStore } from "../../src/lib/artifact-store.js";
import {
  EXECUTION_LOCATION_RESULT_ARTIFACT_IMPORT_SCHEMA,
  importExecutionLocationResultArtifact,
  readExecutionLocationResultArtifactImport,
} from "../../src/lib/execution-location-result-artifact.js";

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function preview(overrides = {}) {
  const bytes = Buffer.from("reviewed result bytes\n", "utf8");
  return {
    schema: "cc-execution-location-result-preview/v1",
    sessionId: "artifact-import-session",
    requestId: "artifact-import-request",
    reviewDigest: `sha256:${"1".repeat(64)}`,
    item: "summary",
    kind: "summary",
    mediaType: "text/markdown",
    byteLength: bytes.byteLength,
    digest: sha256(bytes),
    bytes,
    ...overrides,
  };
}

describe("execution-location result ArtifactStore import", () => {
  let dir;
  let store;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-result-artifact-"));
    store = new ArtifactStore({
      dir,
      now: () => Date.UTC(2026, 7, 18, 12, 0, 0),
    });
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("imports one reviewed item with content-free lineage and exact byte readback", () => {
    const source = preview();
    const receipt = importExecutionLocationResultArtifact(source, {
      artifactStore: store,
    });

    expect(receipt).toMatchObject({
      schema: EXECUTION_LOCATION_RESULT_ARTIFACT_IMPORT_SCHEMA,
      imported: true,
      source: {
        sessionId: source.sessionId,
        requestId: source.requestId,
        reviewDigest: source.reviewDigest,
        item: "summary",
        kind: "summary",
        sourceDigest: source.digest,
      },
      artifact: {
        kind: "report",
        mime: "text/markdown",
        size: source.byteLength,
        sha256: source.digest.slice("sha256:".length),
        immutable: true,
      },
      retention: "artifact-store-ttl-explicit-delete-not-worm",
    });
    expect(receipt.importDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(receipt.receiptDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(JSON.stringify(receipt)).not.toContain("reviewed result bytes");

    const [entry] = store.list();
    expect(entry.recordDigest).toBe(receipt.importDigest);
    expect(entry.lineage.sourceDigest).toBe(source.digest);
    expect(fs.readFileSync(store.storedPath(entry))).toEqual(source.bytes);
  });

  it("returns the same artifact after response loss instead of duplicating bytes", () => {
    const first = importExecutionLocationResultArtifact(preview(), {
      artifactStore: store,
    });
    const retry = importExecutionLocationResultArtifact(preview(), {
      artifactStore: store,
    });

    expect(first.imported).toBe(true);
    expect(retry.imported).toBe(false);
    expect(retry.artifact.id).toBe(first.artifact.id);
    expect(retry.receiptDigest).toBe(first.receiptDigest);
    expect(store.list()).toHaveLength(1);
  });

  it("reconstructs the receipt from persisted lineage and current bytes", () => {
    const imported = importExecutionLocationResultArtifact(preview(), {
      artifactStore: store,
    });
    const readback = readExecutionLocationResultArtifactImport(
      imported.importDigest,
      { artifactStore: store },
    );

    expect(readback.receipt.receiptDigest).toBe(imported.receiptDigest);
    expect(readback.integrity).toMatchObject({ ok: true, reason: "ok" });
    expect(readback.entry.id).toBe(imported.artifact.id);
  });

  it("fails closed when managed bytes or persisted lineage drift", () => {
    const imported = importExecutionLocationResultArtifact(preview(), {
      artifactStore: store,
    });
    const entry = store.get(imported.artifact.id);
    fs.chmodSync(store.storedPath(entry), 0o666);
    fs.writeFileSync(store.storedPath(entry), "tampered", "utf8");

    expect(() =>
      readExecutionLocationResultArtifactImport(imported.importDigest, {
        artifactStore: store,
      }),
    ).toThrow(/readback does not match import authority/u);
  });

  it("rejects selector or digest drift before publishing", () => {
    expect(() =>
      importExecutionLocationResultArtifact(
        preview({ item: "artifact:sha256:" + "2".repeat(64) }),
        { artifactStore: store },
      ),
    ).toThrow(/lineage is invalid/u);
    expect(() =>
      importExecutionLocationResultArtifact(
        preview({ digest: `sha256:${"3".repeat(64)}` }),
        { artifactStore: store },
      ),
    ).toThrow(/content does not match import authority/u);
    expect(store.list()).toEqual([]);
  });

  it("rejects duplicate authority rows as ambiguous", () => {
    const imported = importExecutionLocationResultArtifact(preview(), {
      artifactStore: store,
    });
    const entry = store.get(imported.artifact.id);
    fs.appendFileSync(
      path.join(dir, "index.jsonl"),
      `${JSON.stringify(entry)}\n`,
      "utf8",
    );

    expect(() =>
      readExecutionLocationResultArtifactImport(imported.importDigest, {
        artifactStore: store,
      }),
    ).toThrow(/ambiguous/u);
  });
});
