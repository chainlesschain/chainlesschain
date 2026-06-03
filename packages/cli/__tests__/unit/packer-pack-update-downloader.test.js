/**
 * Unit tests: src/lib/packer/pack-update-downloader.js
 *
 * We feed the downloader an injected fetch that returns a Web ReadableStream
 * over a Node Buffer. This avoids spinning up a real HTTP server (fast, no
 * port collisions) while exercising the streaming + hashing + atomic rename
 * code paths the same way real fetch does.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {
  downloadAndVerify,
  DownloadError,
} from "../../src/lib/packer/pack-update-downloader.js";

function sha256Hex(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

/** Build an injected fetch that yields `body` as a single-chunk stream. */
function fakeFetchStream(body, { status = 200, contentLength } = {}) {
  return async () => {
    const data = Buffer.isBuffer(body) ? body : Buffer.from(body);
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(data));
        controller.close();
      },
    });
    const headers = new Map();
    if (contentLength !== false) {
      headers.set("content-length", String(contentLength ?? data.length));
    }
    return {
      ok: status >= 200 && status < 300,
      status,
      body: stream,
      headers: { get: (k) => headers.get(String(k).toLowerCase()) ?? null },
    };
  };
}

/** Yield `body` in two chunks so we can verify incremental progress. */
function fakeFetchChunked(body) {
  return async () => {
    const data = Buffer.from(body);
    const mid = Math.floor(data.length / 2);
    const first = data.subarray(0, mid);
    const second = data.subarray(mid);
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(first));
        controller.enqueue(new Uint8Array(second));
        controller.close();
      },
    });
    return {
      ok: true,
      status: 200,
      body: stream,
      headers: {
        get: (k) => (k === "content-length" ? String(data.length) : null),
      },
    };
  };
}

function fakeFetchStatus(status) {
  return async () => ({
    ok: false,
    status,
    body: new ReadableStream({ start: (c) => c.close() }),
    headers: { get: () => null },
  });
}

function fakeFetchThrow(err) {
  return async () => {
    throw err;
  };
}

describe("downloadAndVerify", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-dl-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });

  it("streams bytes, writes to outputPath, returns bytes+sha256", async () => {
    const payload = Buffer.from("fake-exe-bytes-0123456789");
    const sha = sha256Hex(payload);
    const outputPath = path.join(tmpDir, "out.exe");
    const r = await downloadAndVerify({
      url: "https://example.test/a.exe",
      sha256: sha,
      outputPath,
      fetchImpl: fakeFetchStream(payload),
    });
    expect(r.outputPath).toBe(outputPath);
    expect(r.bytes).toBe(payload.length);
    expect(r.sha256).toBe(sha);
    expect(fs.readFileSync(outputPath)).toEqual(payload);
    // No `.partial` left behind
    expect(fs.existsSync(outputPath + ".partial")).toBe(false);
  });

  it("creates parent directory if missing", async () => {
    const payload = Buffer.from("hi");
    const outputPath = path.join(tmpDir, "deep", "nest", "out.exe");
    await downloadAndVerify({
      url: "https://x/y",
      sha256: sha256Hex(payload),
      outputPath,
      fetchImpl: fakeFetchStream(payload),
    });
    expect(fs.existsSync(outputPath)).toBe(true);
  });

  it("rejects on SHA-256 mismatch and removes the partial file", async () => {
    const payload = Buffer.from("mismatched-bytes");
    const wrongSha = "0".repeat(64);
    const outputPath = path.join(tmpDir, "bad.exe");
    let caught;
    try {
      await downloadAndVerify({
        url: "https://x",
        sha256: wrongSha,
        outputPath,
        fetchImpl: fakeFetchStream(payload),
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(DownloadError);
    expect(caught.code).toBe("SHA_MISMATCH");
    expect(fs.existsSync(outputPath)).toBe(false);
    expect(fs.existsSync(outputPath + ".partial")).toBe(false);
  });

  it("rejects HTTP 404 with FETCH_FAILED", async () => {
    try {
      await downloadAndVerify({
        url: "https://x",
        sha256: "a".repeat(64),
        outputPath: path.join(tmpDir, "never.exe"),
        fetchImpl: fakeFetchStatus(404),
      });
    } catch (e) {
      expect(e.code).toBe("FETCH_FAILED");
    }
  });

  it("rejects network errors with NETWORK_ERROR", async () => {
    try {
      await downloadAndVerify({
        url: "https://x",
        sha256: "a".repeat(64),
        outputPath: path.join(tmpDir, "never.exe"),
        fetchImpl: fakeFetchThrow(new Error("ECONNREFUSED")),
      });
    } catch (e) {
      expect(e.code).toBe("NETWORK_ERROR");
    }
  });

  it("maps AbortError to TIMEOUT", async () => {
    const abortErr = new Error("aborted");
    abortErr.name = "AbortError";
    try {
      await downloadAndVerify({
        url: "https://x",
        sha256: "a".repeat(64),
        outputPath: path.join(tmpDir, "never.exe"),
        fetchImpl: fakeFetchThrow(abortErr),
      });
    } catch (e) {
      expect(e.code).toBe("TIMEOUT");
    }
  });

  it("onProgress fires per chunk with running bytes + total", async () => {
    const payload = Buffer.alloc(1024, 7);
    const sha = sha256Hex(payload);
    const calls = [];
    await downloadAndVerify({
      url: "https://x",
      sha256: sha,
      outputPath: path.join(tmpDir, "prog.exe"),
      fetchImpl: fakeFetchChunked(payload),
      onProgress: (p) => calls.push(p),
    });
    expect(calls.length).toBe(2);
    // Each call must see `total === 1024` and bytes monotonic up to 1024.
    expect(calls[0].total).toBe(1024);
    expect(calls[1].total).toBe(1024);
    expect(calls[0].bytes).toBeLessThan(calls[1].bytes);
    expect(calls[1].bytes).toBe(1024);
  });

  it("progress callback throwing does not interrupt the download", async () => {
    const payload = Buffer.from("ok-bytes");
    const sha = sha256Hex(payload);
    const outputPath = path.join(tmpDir, "bad-cb.exe");
    const r = await downloadAndVerify({
      url: "https://x",
      sha256: sha,
      outputPath,
      fetchImpl: fakeFetchStream(payload),
      onProgress: () => {
        throw new Error("cb blew up");
      },
    });
    expect(r.bytes).toBe(payload.length);
    expect(fs.readFileSync(outputPath)).toEqual(payload);
  });

  it("rejects BAD_SHA256 on malformed sha hex", async () => {
    try {
      await downloadAndVerify({
        url: "https://x",
        sha256: "not-sha",
        outputPath: path.join(tmpDir, "x.exe"),
        fetchImpl: fakeFetchStream(Buffer.from("x")),
      });
    } catch (e) {
      expect(e.code).toBe("BAD_SHA256");
    }
  });

  it("NO_URL / NO_OUTPUT / NO_BODY argument guards", async () => {
    await expect(
      downloadAndVerify({
        sha256: "a".repeat(64),
        outputPath: "x",
      }),
    ).rejects.toMatchObject({ code: "NO_URL" });

    await expect(
      downloadAndVerify({
        url: "https://x",
        sha256: "a".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "NO_OUTPUT" });

    // body:null response
    const nullBodyFetch = async () => ({
      ok: true,
      status: 200,
      body: null,
      headers: { get: () => null },
    });
    try {
      await downloadAndVerify({
        url: "https://x",
        sha256: "a".repeat(64),
        outputPath: path.join(tmpDir, "noBody.exe"),
        fetchImpl: nullBodyFetch,
      });
    } catch (e) {
      expect(e.code).toBe("NO_BODY");
    }
  });

  it("overwrites an existing file atomically", async () => {
    const outputPath = path.join(tmpDir, "existing.exe");
    fs.writeFileSync(outputPath, "old-contents");
    const payload = Buffer.from("new-contents");
    await downloadAndVerify({
      url: "https://x",
      sha256: sha256Hex(payload),
      outputPath,
      fetchImpl: fakeFetchStream(payload),
    });
    expect(fs.readFileSync(outputPath, "utf-8")).toBe("new-contents");
  });
});
