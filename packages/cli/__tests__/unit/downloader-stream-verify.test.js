/**
 * downloader streamToFileVerified — install/download-path robustness.
 *
 * Two guards on the binary/bundle download used by `cc setup`:
 *   - size verification: a server-advertised Content-Length that doesn't match
 *     the bytes received means a truncated download → must throw, not silently
 *     report success (the caller would extract/install a corrupt file).
 *   - idle timeout: if no bytes arrive for idleTimeoutMs, abort the controller
 *     (cancelling the fetch) so a hung mirror can't freeze the download forever.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { streamToFileVerified, extractZip } from "../../src/lib/downloader.js";

let tmpDir;
let n = 0;
const dest = () => path.join(tmpDir, `dl-${n++}.bin`);

function bodyFrom(chunks) {
  return new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(ch);
      c.close();
    },
  });
}
const resp = (contentLength, body) => ({
  headers: { get: () => contentLength },
  body,
});

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-dl-"));
});
afterEach(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

describe("streamToFileVerified", () => {
  it("writes the file and returns byte counts on a complete download", async () => {
    const data = Buffer.from("hello world");
    const d = dest();
    const res = await streamToFileVerified(
      resp(String(data.length), bodyFrom([data])),
      d,
    );
    expect(res.downloadedBytes).toBe(data.length);
    expect(res.totalBytes).toBe(data.length);
    expect(fs.readFileSync(d).length).toBe(data.length);
  });

  it("throws when fewer bytes arrive than Content-Length (truncated)", async () => {
    const data = Buffer.from("hello world"); // 11 bytes
    await expect(
      streamToFileVerified(resp("100", bodyFrom([data])), dest()),
    ).rejects.toThrow(/truncated/i);
  });

  it("does not verify size when Content-Length is unknown (0)", async () => {
    const data = Buffer.from("abc");
    const res = await streamToFileVerified(resp("0", bodyFrom([data])), dest());
    expect(res.downloadedBytes).toBe(3);
    expect(res.totalBytes).toBe(0);
  });

  it("aborts a stalled download via the idle timeout", async () => {
    const controller = new AbortController();
    // A reader whose read() only settles when the controller aborts.
    const body = {
      getReader() {
        return {
          read() {
            return new Promise((_resolve, reject) => {
              controller.signal.addEventListener("abort", () => {
                const e = new Error("aborted");
                e.name = "AbortError";
                reject(e);
              });
            });
          },
        };
      },
    };
    await expect(
      streamToFileVerified(resp("100", body), dest(), {
        controller,
        idleTimeoutMs: 30,
      }),
    ).rejects.toThrow();
    expect(controller.signal.aborted).toBe(true);
  });
});

describe("extractZip — no shell injection via paths", () => {
  // A path that would break out of a quoted shell string and run a command.
  const EVIL = '/tmp/a";rm -rf ~ #.zip';

  it("unix: passes the zip path as a literal execFile argument (no shell)", () => {
    let call;
    extractZip(EVIL, "/dest", {
      platform: "linux",
      execFileImpl: (file, args, options) => {
        call = { file, args, options };
      },
    });
    expect(call.file).toBe("unzip");
    expect(call.args).toEqual(["-o", EVIL, "-d", "/dest"]);
    // The evil string survives verbatim as one argument — no shell ever parses it.
    expect(call.args).toContain(EVIL);
    expect(call.options).toMatchObject({
      origin: "update:archive-extract",
      policy: "allow",
      scope: "update",
      shell: false,
    });
  });

  it("windows: keeps the -Command script constant, paths only via env", () => {
    let call;
    extractZip(EVIL, "/dest", {
      platform: "win32",
      execFileImpl: (file, args, opts) => {
        call = { file, args, env: opts.env, options: opts };
      },
    });
    expect(call.file).toBe("powershell");
    const script = call.args[call.args.length - 1];
    // The script must not contain the path at all (so it can't be injected).
    expect(script).not.toContain("rm -rf");
    expect(script).not.toContain(EVIL);
    expect(call.env.CC_ZIP_SRC).toBe(EVIL);
    expect(call.env.CC_ZIP_DEST).toBe("/dest");
    expect(call.options).toMatchObject({
      origin: "update:archive-extract",
      policy: "allow",
      scope: "update",
      shell: false,
    });
  });
});
