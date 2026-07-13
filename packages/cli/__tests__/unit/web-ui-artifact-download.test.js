/**
 * GET /api/artifacts/<id>/download (批25) — the uncapped browser-download
 * path over the deliverable store. Exercised through a REAL http server so
 * headers/streaming/auth behave exactly as in production: token gate
 * (Bearer + ?token=, constant-time), 404s, tamper guard, byte-exact body,
 * Content-Disposition.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { handleApiRequest } from "../../src/lib/web-ui-server.js";
import { ArtifactStore } from "../../src/lib/artifact-store.js";

let dir;
let srcDir;
let server;
let baseUrl;

async function startServer(ctx = {}) {
  server = http.createServer((req, res) => {
    // Force each response to close its TCP connection so global fetch (undici)
    // does NOT keep the client socket alive in its pool — a pooled keep-alive
    // socket outlives the test and pins the vitest forks-pool worker (the
    // "Worker exited unexpectedly" flake). Can't close undici's global
    // dispatcher instead: the forks worker is reused across files, so that
    // would break fetch for later files.
    res.setHeader("Connection", "close");
    if (handleApiRequest(req, res, ctx)) return;
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-art-dl-"));
  srcDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-art-dl-src-"));
  process.env.CC_ARTIFACTS_DIR = dir;
});

afterEach(async () => {
  delete process.env.CC_ARTIFACTS_DIR;
  if (server) {
    // global fetch (undici) keeps a keep-alive client socket pooled; a plain
    // server.close() only stops accepting NEW connections and waits for that
    // idle-but-open socket, leaving it pinning the vitest forks worker's event
    // loop (→ the "Worker exited unexpectedly" forks-pool flake blamed on a
    // sibling file via worker reuse). closeAllConnections() FINs the pooled
    // socket so both ends release immediately.
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
  server = null;
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(srcDir, { recursive: true, force: true });
});

function publish(name, content, extra = {}) {
  const p = path.join(srcDir, name);
  fs.writeFileSync(p, content);
  return new ArtifactStore().publish({ filePath: p, ...extra });
}

describe("GET /api/artifacts/<id>/download", () => {
  it("streams the full stored copy byte-exactly with download headers", async () => {
    // bigger than the WS text preview cap — download must NOT be capped
    const body = "x".repeat(300 * 1024) + "END";
    const e = publish("report.md", body, { title: "weekly.md" });
    await startServer({});
    const res = await fetch(`${baseUrl}/api/artifacts/${e.id}/download`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/markdown");
    expect(res.headers.get("content-disposition")).toContain("attachment");
    expect(res.headers.get("content-disposition")).toContain("weekly.md");
    expect(Number(res.headers.get("content-length"))).toBe(body.length);
    const text = await res.text();
    expect(text).toHaveLength(body.length);
    expect(text.endsWith("END")).toBe(true);
  });

  it("enforces the token when configured: Bearer and ?token= pass, wrong/absent fail", async () => {
    const e = publish("a.txt", "secret body");
    await startServer({ wsToken: "tok-123" });

    const noAuth = await fetch(`${baseUrl}/api/artifacts/${e.id}/download`);
    expect(noAuth.status).toBe(401);

    const wrong = await fetch(
      `${baseUrl}/api/artifacts/${e.id}/download?token=nope`,
    );
    expect(wrong.status).toBe(401);

    const viaQuery = await fetch(
      `${baseUrl}/api/artifacts/${e.id}/download?token=tok-123`,
    );
    expect(viaQuery.status).toBe(200);

    const viaBearer = await fetch(`${baseUrl}/api/artifacts/${e.id}/download`, {
      headers: { Authorization: "Bearer tok-123" },
    });
    expect(viaBearer.status).toBe(200);
    expect(await viaBearer.text()).toBe("secret body");
  });

  it("404s an unknown id and refuses a tampered index row", async () => {
    const e = publish("t.md", "text");
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
    await startServer({});

    const missing = await fetch(`${baseUrl}/api/artifacts/art_nope/download`);
    expect(missing.status).toBe(404);

    const tampered = await fetch(`${baseUrl}/api/artifacts/${e.id}/download`);
    expect(tampered.status).toBe(400);
  });

  it("does not shadow /api/skills or the SPA fallback", async () => {
    await startServer({});
    const skills = await fetch(`${baseUrl}/api/skills`);
    expect(skills.status).toBe(200);
    const other = await fetch(`${baseUrl}/not-api`);
    expect(other.status).toBe(404); // fell through to the test server's fallback
  });
});
