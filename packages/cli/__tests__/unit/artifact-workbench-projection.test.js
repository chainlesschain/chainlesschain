import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArtifactStore } from "../../src/lib/artifact-store.js";
import { authorizeArtifactContentAccess } from "../../src/lib/artifact-access-ledger.js";
import {
  ARTIFACT_WORKBENCH_PROJECTION_SCHEMA,
  buildArtifactWorkbenchProjection,
} from "../../src/lib/artifact-workbench-projection.js";
import { runArtifactsWorkbench } from "../../src/commands/artifacts.js";

describe("artifact canonical product workbench projection", () => {
  let root;
  let store;
  const now = Date.UTC(2026, 7, 20, 8, 0, 0);

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-artifact-workbench-"));
    store = new ArtifactStore({
      dir: path.join(root, "artifacts"),
      now: () => now,
    });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("binds returned-result review lineage and audited access history", () => {
    const sourceDigest = `sha256:${"a".repeat(64)}`;
    const reviewDigest = `sha256:${"b".repeat(64)}`;
    const importDigest = `sha256:${"c".repeat(64)}`;
    const lineage = {
      schema: "cc-execution-location-result-artifact-lineage/v1",
      sessionId: "session-returned-1",
      requestId: "collect-returned-1",
      reviewDigest,
      item: "summary",
      kind: "summary",
      mediaType: "text/plain",
      byteLength: 4,
      sourceDigest,
    };
    const publication = store.publishDataOnce({
      data: "S3CR",
      fileName: "returned.txt",
      title: "Returned summary",
      kind: "report",
      mime: "text/plain",
      sessionId: lineage.sessionId,
      immutable: true,
      recordDigest: importDigest,
      lineage,
    });
    authorizeArtifactContentAccess(
      store,
      {
        accessId: "access-returned-1",
        artifactId: publication.entry.id,
        client: "vscode",
        action: "download",
      },
      { now: () => now + 1_000 },
    );

    const projection = buildArtifactWorkbenchProjection(store, {
      recoveryOptions: { now: () => now + 2_000 },
    });
    expect(projection).toMatchObject({
      schema: ARTIFACT_WORKBENCH_PROJECTION_SCHEMA,
      recovery: { summary: { itemCount: 0 } },
      history: {
        totalEventCount: 1,
        truncated: false,
        activity: [
          {
            type: "access",
            artifactId: publication.entry.id,
            artifactSessionId: "session-returned-1",
            recordDigest: importDigest,
            action: "download",
            client: "vscode",
          },
        ],
      },
    });
    expect(projection.artifacts[0]).toMatchObject({
      id: publication.entry.id,
      sessionId: "session-returned-1",
      recordDigest: importDigest,
      returnedResult: {
        sessionId: "session-returned-1",
        requestId: "collect-returned-1",
        reviewDigest,
        item: "summary",
        sourceDigest,
      },
      history: {
        accessCount: 1,
        latestAccess: { action: "download", client: "vscode" },
      },
    });
    expect(JSON.stringify(projection)).not.toContain("S3CR");
    expect(JSON.stringify(projection)).not.toContain(root);
  });

  it("keeps recovery alerts machine-readable without treating them as a CLI failure", () => {
    const filesDir = path.join(store.dir, "files");
    fs.mkdirSync(filesDir, { recursive: true });
    fs.writeFileSync(
      path.join(filesDir, "art_orphan_ui.txt"),
      "orphan product secret",
    );
    const writes = [];
    const original = console.log;
    console.log = (value) => writes.push(String(value));
    try {
      expect(
        runArtifactsWorkbench(
          { json: true },
          { store, workbenchOptions: { recoveryOptions: { now: () => now } } },
        ),
      ).toBe(0);
    } finally {
      console.log = original;
    }
    const projection = JSON.parse(writes[0]);
    expect(projection.recovery.summary.orphanCount).toBe(1);
    expect(projection.recovery.policy.unattendedMutationAllowed).toBe(false);
    expect(writes[0]).not.toContain("orphan product secret");
    expect(writes[0]).not.toContain(root);
  });
});
