/**
 * Unit tests: src/lib/packer/pack-update-downloader.js
 *
 * We feed the downloader an injected fetch that returns a Web ReadableStream
 * over a Node Buffer. This avoids spinning up a real HTTP server (fast, no
 * port collisions) while exercising the streaming + hashing + atomic rename
 * code paths the same way real fetch does.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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

function transactionResidue(dir, outputName) {
  return fs
    .readdirSync(dir)
    .filter(
      (name) =>
        name.startsWith(`${outputName}.partial-`) ||
        name === `${outputName}.lock`,
    );
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
    expect(transactionResidue(tmpDir, "out.exe")).toEqual([]);
  });

  it("preserves the active output when its download lock is replaced", async () => {
    const payload = Buffer.from("replacement-bytes");
    const outputPath = path.join(tmpDir, "locked.exe");
    const lockPath = `${outputPath}.lock`;
    fs.writeFileSync(outputPath, "old-output");
    let exchanged = false;

    await expect(
      downloadAndVerify({
        url: "https://example.test/locked.exe",
        sha256: sha256Hex(payload),
        outputPath,
        fetchImpl: fakeFetchStream(payload),
        onProgress: () => {
          if (exchanged) return;
          fs.unlinkSync(lockPath);
          fs.writeFileSync(lockPath, "foreign-owner");
          exchanged = true;
        },
      }),
    ).rejects.toMatchObject({ code: "DOWNLOAD_LOCK_LOST" });

    expect(exchanged).toBe(true);
    expect(fs.readFileSync(outputPath, "utf8")).toBe("old-output");
    expect(fs.readFileSync(lockPath, "utf8")).toBe("foreign-owner");
    expect(
      fs
        .readdirSync(tmpDir)
        .some((name) => name.startsWith("locked.exe.partial-")),
    ).toBe(false);
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
    fs.writeFileSync(outputPath, "old-verified-output");
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
    expect(fs.readFileSync(outputPath, "utf8")).toBe("old-verified-output");
    expect(transactionResidue(tmpDir, "bad.exe")).toEqual([]);
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

  it("times out a fetch that never produces a response", async () => {
    const outputPath = path.join(tmpDir, "fetch-timeout.exe");
    let observedSignal;
    await expect(
      downloadAndVerify({
        url: "https://x/slow-response",
        sha256: "a".repeat(64),
        outputPath,
        timeoutMs: 50,
        fetchImpl: (_url, options) => {
          observedSignal = options.signal;
          return new Promise(() => {});
        },
      }),
    ).rejects.toMatchObject({ code: "TIMEOUT" });
    expect(observedSignal.aborted).toBe(true);
    expect(fs.existsSync(outputPath)).toBe(false);
    expect(transactionResidue(tmpDir, "fetch-timeout.exe")).toEqual([]);
  });

  it("times out a response body that stops producing chunks", async () => {
    const outputPath = path.join(tmpDir, "body-timeout.exe");
    const payload = Buffer.from("first-chunk");
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(payload));
        },
      }),
      headers: { get: () => null },
    });
    await expect(
      downloadAndVerify({
        url: "https://x/stalled-body",
        sha256: sha256Hex(payload),
        outputPath,
        timeoutMs: 50,
        fetchImpl,
      }),
    ).rejects.toMatchObject({ code: "TIMEOUT" });
    expect(fs.existsSync(outputPath)).toBe(false);
    expect(transactionResidue(tmpDir, "body-timeout.exe")).toEqual([]);
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

    await expect(
      downloadAndVerify({
        url: "https://x",
        sha256: "a".repeat(64),
        outputPath: path.join(tmpDir, "bad-timeout.exe"),
        timeoutMs: 0,
      }),
    ).rejects.toMatchObject({ code: "BAD_TIMEOUT" });

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

  it("never unlinks the existing output before the atomic rename", async () => {
    const outputPath = path.join(tmpDir, "atomic.exe");
    fs.writeFileSync(outputPath, "old-contents");
    const unlinkSpy = vi.spyOn(fs, "unlinkSync");
    try {
      const payload = Buffer.from("new-contents");
      await downloadAndVerify({
        url: "https://x",
        sha256: sha256Hex(payload),
        outputPath,
        fetchImpl: fakeFetchStream(payload),
      });
      expect(
        unlinkSpy.mock.calls.some(([candidate]) => candidate === outputPath),
      ).toBe(false);
      expect(fs.readFileSync(outputPath, "utf8")).toBe("new-contents");
    } finally {
      unlinkSpy.mockRestore();
    }
  });

  it("preserves the existing output and cleans transaction residue when final rename fails", async () => {
    const outputPath = path.join(tmpDir, "rename-fails.exe");
    fs.writeFileSync(outputPath, "old-contents");
    const originalRenameSync = fs.renameSync.bind(fs);
    const renameSpy = vi
      .spyOn(fs, "renameSync")
      .mockImplementation((sourcePath, destinationPath) => {
        if (
          String(sourcePath).startsWith(`${outputPath}.partial-`) &&
          path.resolve(String(destinationPath)) === path.resolve(outputPath)
        ) {
          const error = new Error("rename denied");
          error.code = "EACCES";
          throw error;
        }
        return originalRenameSync(sourcePath, destinationPath);
      });
    const payload = Buffer.from("new-contents");
    try {
      await expect(
        downloadAndVerify({
          url: "https://x",
          sha256: sha256Hex(payload),
          outputPath,
          fetchImpl: fakeFetchStream(payload),
        }),
      ).rejects.toMatchObject({ code: "FINALIZE_FAILED" });
    } finally {
      renameSpy.mockRestore();
    }
    expect(fs.readFileSync(outputPath, "utf8")).toBe("old-contents");
    expect(transactionResidue(tmpDir, "rename-fails.exe")).toEqual([]);
  });

  it("rejects a partial pathname exchanged at the atomic rename boundary", async () => {
    const outputPath = path.join(tmpDir, "partial-exchanged.exe");
    const originalRenameSync = fs.renameSync.bind(fs);
    const renameSpy = vi
      .spyOn(fs, "renameSync")
      .mockImplementation((sourcePath, destinationPath) => {
        if (
          String(sourcePath).startsWith(`${outputPath}.partial-`) &&
          path.resolve(String(destinationPath)) === path.resolve(outputPath)
        ) {
          fs.unlinkSync(sourcePath);
          fs.writeFileSync(sourcePath, "substituted-bytes");
        }
        return originalRenameSync(sourcePath, destinationPath);
      });
    const payload = Buffer.from("trusted-download-bytes");
    try {
      await expect(
        downloadAndVerify({
          url: "https://x",
          sha256: sha256Hex(payload),
          outputPath,
          fetchImpl: fakeFetchStream(payload),
        }),
      ).rejects.toMatchObject({ code: "FINALIZE_FAILED" });
    } finally {
      renameSpy.mockRestore();
    }
    expect(fs.existsSync(outputPath)).toBe(false);
    expect(transactionResidue(tmpDir, "partial-exchanged.exe")).toEqual([]);
  });

  it("fails closed when another writer owns the output lock", async () => {
    const outputPath = path.join(tmpDir, "locked.exe");
    const lockPath = `${outputPath}.lock`;
    fs.writeFileSync(lockPath, "other-owner");
    const fetchImpl = vi.fn(fakeFetchStream(Buffer.from("new")));

    await expect(
      downloadAndVerify({
        url: "https://x",
        sha256: sha256Hex(Buffer.from("new")),
        outputPath,
        fetchImpl,
      }),
    ).rejects.toMatchObject({ code: "DOWNLOAD_LOCKED" });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(fs.readFileSync(lockPath, "utf8")).toBe("other-owner");
  });

  it("removes only its unique partial and lock after a stream failure", async () => {
    const outputPath = path.join(tmpDir, "aborted.exe");
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      body: {
        async *[Symbol.asyncIterator]() {
          yield Buffer.from("first-chunk");
          throw new Error("connection reset");
        },
      },
    });

    await expect(
      downloadAndVerify({
        url: "https://x",
        sha256: "a".repeat(64),
        outputPath,
        fetchImpl,
      }),
    ).rejects.toMatchObject({ code: "STREAM_ERROR" });
    expect(transactionResidue(tmpDir, "aborted.exe")).toEqual([]);
  });

  it("rejects a symlink output without touching its referent", async () => {
    const victimPath = path.join(tmpDir, "victim.exe");
    const outputPath = path.join(tmpDir, "linked.exe");
    fs.writeFileSync(victimPath, "victim-bytes");
    try {
      fs.symlinkSync(victimPath, outputPath, "file");
    } catch (error) {
      if (["EPERM", "EACCES", "ENOTSUP"].includes(error?.code)) return;
      throw error;
    }

    const payload = Buffer.from("replacement");
    await expect(
      downloadAndVerify({
        url: "https://x",
        sha256: sha256Hex(payload),
        outputPath,
        fetchImpl: fakeFetchStream(payload),
      }),
    ).rejects.toMatchObject({ code: "UNSAFE_PATH" });
    expect(fs.readFileSync(victimPath, "utf8")).toBe("victim-bytes");
  });

  it("rejects a symlink or junction in the output ancestor chain", async () => {
    const realDir = path.join(tmpDir, "real-output");
    const linkedDir = path.join(tmpDir, "linked-output");
    fs.mkdirSync(realDir);
    try {
      fs.symlinkSync(
        realDir,
        linkedDir,
        process.platform === "win32" ? "junction" : "dir",
      );
    } catch (error) {
      if (["EPERM", "EACCES", "ENOTSUP"].includes(error?.code)) return;
      throw error;
    }

    const payload = Buffer.from("replacement");
    await expect(
      downloadAndVerify({
        url: "https://x",
        sha256: sha256Hex(payload),
        outputPath: path.join(linkedDir, "artifact.exe"),
        fetchImpl: fakeFetchStream(payload),
      }),
    ).rejects.toMatchObject({ code: "UNSAFE_PATH" });
    expect(fs.readdirSync(realDir)).toEqual([]);
  });
});
