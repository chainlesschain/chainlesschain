/**
 * artifact-* WS protocol — the web-panel bridge onto the deliverable store
 * (P1 #10 批24). Handlers run against a REAL ArtifactStore in a temp dir
 * (CC_ARTIFACTS_DIR override, same convention as CC_BACKGROUND_AGENTS_DIR);
 * covers listing/filters, metadata show, the preview policy (text utf8 capped
 * + truncated flag / image base64 / opaque mime metadata-only), the
 * tampered-index traversal guard, remove and TTL clean.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  handleArtifactClean,
  handleArtifactContent,
  handleArtifactList,
  handleArtifactRemove,
  handleArtifactShow,
  previewKindForMime,
  TEXT_PREVIEW_CAP,
} from "../../src/gateways/ws/artifact-protocol.js";
import { ArtifactStore } from "../../src/lib/artifact-store.js";

let dir;
let srcDir;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-art-ws-"));
  srcDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-art-ws-src-"));
  process.env.CC_ARTIFACTS_DIR = dir;
});

afterEach(() => {
  delete process.env.CC_ARTIFACTS_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(srcDir, { recursive: true, force: true });
});

function fakeServer() {
  return {
    sent: [],
    clients: new Map(),
    _send(ws, payload) {
      this.sent.push(payload);
    },
  };
}

function publish(name, content, extra = {}) {
  const p = path.join(srcDir, name);
  fs.writeFileSync(p, content);
  return new ArtifactStore().publish({ filePath: p, ...extra });
}

describe("previewKindForMime", () => {
  it("classifies text / image / opaque mimes", () => {
    expect(previewKindForMime("text/markdown")).toBe("text");
    expect(previewKindForMime("application/json")).toBe("text");
    expect(previewKindForMime("image/png")).toBe("image");
    expect(previewKindForMime("application/zip")).toBe("none");
    expect(previewKindForMime("")).toBe("none");
  });
});

describe("artifact-list / artifact-show", () => {
  it("lists with kind/session filters and shows metadata + storedPath", async () => {
    publish("a.md", "# A", { kind: "report", sessionId: "s1" });
    const b = publish("b.log", "log line", { kind: "log", sessionId: "s2" });

    const server = fakeServer();
    await handleArtifactList(server, "1", {}, {});
    expect(server.sent[0].type).toBe("artifact-list");
    expect(server.sent[0].artifacts).toHaveLength(2);

    await handleArtifactList(server, "2", {}, { kind: "log" });
    expect(server.sent[1].artifacts).toHaveLength(1);
    await handleArtifactList(server, "3", {}, { session: "s1" });
    expect(server.sent[2].artifacts).toHaveLength(1);

    await handleArtifactShow(server, "4", {}, { artifactId: b.id });
    expect(server.sent[3].type).toBe("artifact-show");
    expect(server.sent[3].artifact.storedPath).toContain(b.file);

    await handleArtifactShow(server, "5", {}, { artifactId: "art_missing" });
    expect(server.sent[4]).toMatchObject({
      type: "error",
      code: "ARTIFACT_NOT_FOUND",
    });
  });
});

describe("artifact-content preview policy", () => {
  it("text → utf8 content; long text is capped + flagged truncated", async () => {
    const short = publish("r.md", "# hello preview");
    const server = fakeServer();
    await handleArtifactContent(server, "1", {}, { artifactId: short.id });
    expect(server.sent[0]).toMatchObject({
      type: "artifact-content",
      previewable: true,
      encoding: "utf8",
      truncated: false,
      content: "# hello preview",
    });

    const big = publish("big.txt", "x".repeat(TEXT_PREVIEW_CAP + 100));
    await handleArtifactContent(server, "2", {}, { artifactId: big.id });
    expect(server.sent[1].truncated).toBe(true);
    expect(server.sent[1].content).toHaveLength(TEXT_PREVIEW_CAP);
  });

  it("caller maxBytes narrows but can never exceed the server cap", async () => {
    const e = publish("m.txt", "abcdefghij");
    const server = fakeServer();
    await handleArtifactContent(
      server,
      "1",
      {},
      { artifactId: e.id, maxBytes: 4 },
    );
    expect(server.sent[0]).toMatchObject({ truncated: true, content: "abcd" });
  });

  it("image → base64; opaque mime → previewable:false with a reason", async () => {
    // 1x1 PNG
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    const img = publish("shot.png", png, { kind: "screenshot" });
    const zip = publish("bundle.zip", "PK...", { kind: "data" });

    const server = fakeServer();
    await handleArtifactContent(server, "1", {}, { artifactId: img.id });
    expect(server.sent[0]).toMatchObject({
      previewable: true,
      encoding: "base64",
    });
    expect(Buffer.from(server.sent[0].content, "base64")).toEqual(png);

    await handleArtifactContent(server, "2", {}, { artifactId: zip.id });
    expect(server.sent[1].previewable).toBe(false);
    expect(server.sent[1].reason).toContain("cc artifacts open");
  });

  it("refuses to serve a tampered index row (non-basename stored filename)", async () => {
    const e = publish("t.md", "text");
    // Tamper the index: point the stored filename outside files/
    const indexFile = path.join(dir, "index.jsonl");
    const rows = fs
      .readFileSync(indexFile, "utf-8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    rows.find((r) => r.id === e.id).file = "../index.jsonl";
    fs.writeFileSync(
      indexFile,
      rows.map((r) => JSON.stringify(r)).join("\n") + "\n",
    );

    const server = fakeServer();
    await handleArtifactContent(server, "1", {}, { artifactId: e.id });
    expect(server.sent[0]).toMatchObject({
      type: "error",
      code: "ARTIFACT_BAD_FILE",
    });
  });
});

describe("artifact-remove / artifact-clean", () => {
  it("removes one and cleans expired", async () => {
    const e = publish("gone.md", "bye");
    const server = fakeServer();
    await handleArtifactRemove(server, "1", {}, { artifactId: e.id });
    expect(server.sent[0]).toMatchObject({ found: true, removed: e.id });
    await handleArtifactRemove(server, "2", {}, { artifactId: e.id });
    expect(server.sent[1]).toMatchObject({ found: false });

    // expired entry via a store with a shifted clock
    const p = path.join(srcDir, "old.md");
    fs.writeFileSync(p, "old");
    new ArtifactStore({
      now: () => Date.now() - 40 * 24 * 60 * 60 * 1000,
    }).publish({ filePath: p, ttlDays: 1 });
    await handleArtifactClean(server, "3", {}, {});
    expect(server.sent[2]).toMatchObject({ type: "artifact-clean", removed: 1 });
  });
});
