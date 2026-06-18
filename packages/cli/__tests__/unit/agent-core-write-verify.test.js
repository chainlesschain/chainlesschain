/**
 * Post-write byte-count verification (Claude-Code 2.1.181 parity).
 *
 * Network drives and cloud-synced folders (OneDrive / Dropbox / Google Drive)
 * can silently truncate a write or leave a 0-byte file. write_file / edit_file
 * must verify the on-disk size matches what was intended and surface an error
 * instead of reporting a false `success`.
 *
 * writeFileVerified is the pure helper behind all three write tools; `fsImpl`
 * is injectable so the truncation and stat-failure branches can be exercised
 * without an actual flaky filesystem.
 */

import { describe, it, expect, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { writeFileVerified } from "../../src/runtime/agent-core.js";

describe("writeFileVerified", () => {
  const tmpFiles = [];
  afterEach(() => {
    for (const f of tmpFiles.splice(0)) {
      try {
        fs.rmSync(f, { force: true });
      } catch {
        /* best-effort cleanup */
      }
    }
  });

  it("writes a real file and returns the actual on-disk byte size", () => {
    const file = path.join(
      os.tmpdir(),
      `cc-write-verify-${process.pid}-${Date.now()}.txt`,
    );
    tmpFiles.push(file);
    const content = "hello world\n";
    const res = writeFileVerified(file, content);
    expect(res.error).toBeUndefined();
    expect(res.size).toBe(Buffer.byteLength(content, "utf8"));
    expect(fs.readFileSync(file, "utf8")).toBe(content);
  });

  it("reports byte length (not char length) for multibyte UTF-8 content", () => {
    const file = path.join(
      os.tmpdir(),
      `cc-write-verify-utf8-${process.pid}-${Date.now()}.txt`,
    );
    tmpFiles.push(file);
    const content = "中文内容🚀"; // chars < bytes
    const res = writeFileVerified(file, content);
    expect(res.error).toBeUndefined();
    expect(res.size).toBe(Buffer.byteLength(content, "utf8"));
    expect(res.size).toBeGreaterThan(content.length);
  });

  it("returns an error when fewer bytes reach disk (truncated write)", () => {
    const fakeFs = {
      writeFileSync() {
        /* pretend the network drive accepted the call */
      },
      statSync() {
        return { size: 3 }; // truncated: only 3 bytes landed
      },
    };
    const content = "this is much longer than three bytes";
    const res = writeFileVerified("/net/share/file.txt", content, fakeFs);
    expect(res.size).toBeUndefined();
    expect(res.error).toMatch(/truncated/i);
    expect(res.error).toContain(String(Buffer.byteLength(content, "utf8")));
    expect(res.error).toContain("3");
  });

  it("flags a 0-byte file as a truncated write", () => {
    const fakeFs = {
      writeFileSync() {},
      statSync() {
        return { size: 0 };
      },
    };
    const res = writeFileVerified("/net/share/empty.txt", "non-empty", fakeFs);
    expect(res.error).toMatch(/truncated/i);
  });

  it("returns an error when the file cannot be stat'd after writing", () => {
    const fakeFs = {
      writeFileSync() {},
      statSync() {
        throw new Error("ENOENT: vanished");
      },
    };
    const res = writeFileVerified("/net/share/gone.txt", "data", fakeFs);
    expect(res.size).toBeUndefined();
    expect(res.error).toMatch(/verification failed/i);
    expect(res.error).toContain("ENOENT: vanished");
  });

  it("succeeds via injected fs when sizes match", () => {
    const content = "exact match";
    const fakeFs = {
      writeFileSync() {},
      statSync() {
        return { size: Buffer.byteLength(content, "utf8") };
      },
    };
    const res = writeFileVerified("/net/share/ok.txt", content, fakeFs);
    expect(res.error).toBeUndefined();
    expect(res.size).toBe(Buffer.byteLength(content, "utf8"));
  });
});
