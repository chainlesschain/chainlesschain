import { describe, expect, it } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import {
  createFixturePng,
  disposeLinuxClipboardOwner,
  linuxClipboardOwnerArgs,
  pngDimensions,
  pngPixelIdentity,
  requireClipboardWriterRetired,
  startLinuxClipboardOwner,
  trackLinuxClipboardOwner,
} from "../../scripts/clipboard-image-host-smoke.mjs";
import { detectClipboardImageMediaType } from "../../src/repl/clipboard-image.js";

describe("clipboard image host smoke fixture", () => {
  function fakeOwner(onKill = () => {}) {
    const child = new EventEmitter();
    child.stderr = new PassThrough();
    child.kill = (signal) => {
      onKill(signal, child);
      return true;
    };
    return { child, owner: trackLinuxClipboardOwner(child) };
  }

  it("builds a deterministic valid PNG identity for host round trips", () => {
    const first = createFixturePng();
    const second = createFixturePng();
    expect(first.equals(second)).toBe(true);
    expect(detectClipboardImageMediaType(first)).toBe("image/png");
    expect(pngDimensions(first)).toEqual({ width: 3, height: 2 });
    expect(pngPixelIdentity(first).pixelSha256).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("refuses a non-PNG host result", () => {
    expect(() => pngDimensions(Buffer.from("not-a-png"))).toThrow(
      "did not read a PNG",
    );
  });

  it("keeps the Linux X11 selection owner foreground and single-use", () => {
    expect(linuxClipboardOwnerArgs("/private/fixture.png")).toEqual([
      "-quiet",
      "-loops",
      "1",
      "-selection",
      "clipboard",
      "-t",
      "image/png",
      "-i",
      "/private/fixture.png",
    ]);
  });

  it("recognizes a chunked xclip readiness handshake and clean retirement", async () => {
    const { child, owner } = fakeOwner();
    child.stderr.write("Waiting for one selection ");
    child.stderr.write("request.\n");
    await expect(owner.readyPromise).resolves.toEqual({ type: "ready" });
    child.emit("close", 0, null);
    await expect(requireClipboardWriterRetired(owner, 20)).resolves.toEqual({
      mode: "foreground",
      loops: 1,
      exitCode: 0,
      signal: null,
      cleanupConfirmed: true,
    });
    child.stderr.destroy();
  });

  it("rejects a nonzero xclip owner exit", async () => {
    const { child, owner } = fakeOwner();
    child.emit("close", 1, null);
    await expect(requireClipboardWriterRetired(owner, 20)).rejects.toThrow(
      "did not retire cleanly",
    );
    child.stderr.destroy();
  });

  it("rejects an xclip owner that exits immediately after readiness", async () => {
    const child = new EventEmitter();
    child.stderr = new PassThrough();
    child.kill = () => true;
    const result = startLinuxClipboardOwner("/private/fixture.png", {
      readyTimeoutMs: 20,
      spawn: () => {
        queueMicrotask(() => {
          child.stderr.write("Waiting for one selection request.\n");
          child.emit("exit", 1, null);
          child.emit("close", 1, null);
        });
        return child;
      },
    });
    await expect(result).rejects.toThrow("did not become ready");
    child.stderr.destroy();
  });

  it("rejects an xclip stderr failure racing with readiness", async () => {
    const child = new EventEmitter();
    child.stderr = new PassThrough();
    child.kill = () => true;
    const result = startLinuxClipboardOwner("/private/fixture.png", {
      readyTimeoutMs: 20,
      spawn: () => {
        queueMicrotask(() => {
          child.stderr.write("Waiting for one selection request.\n");
          child.stderr.emit(
            "error",
            Object.assign(new Error("read failed"), {
              code: "EIO",
            }),
          );
          child.emit("exit", 1, null);
          child.emit("close", 1, null);
        });
        return child;
      },
    });
    await expect(result).rejects.toThrow("did not become ready");
    child.stderr.destroy();
  });

  it("escalates xclip cleanup and waits for the observed close", async () => {
    const signals = [];
    const { child, owner } = fakeOwner((signal, target) => {
      signals.push(signal);
      if (signal === "SIGKILL")
        queueMicrotask(() => target.emit("close", null, signal));
    });
    await expect(
      disposeLinuxClipboardOwner(owner, { termGraceMs: 1, killGraceMs: 20 }),
    ).resolves.toBe(true);
    expect(signals).toEqual(["SIGTERM", "SIGKILL"]);
    child.stderr.destroy();
  });

  it("does not signal again after observing exit at the TERM deadline", async () => {
    const signals = [];
    const { child, owner } = fakeOwner((signal, target) => {
      signals.push(signal);
      if (signal === "SIGTERM") {
        setTimeout(() => target.emit("exit", 0, null), 0);
        setTimeout(() => target.emit("close", 0, null), 5);
      }
    });
    await expect(
      disposeLinuxClipboardOwner(owner, { termGraceMs: 1, killGraceMs: 20 }),
    ).resolves.toBe(true);
    expect(signals).toEqual(["SIGTERM"]);
    child.stderr.destroy();
  });

  it("fails closed when xclip cleanup cannot be observed", async () => {
    const { child, owner } = fakeOwner();
    await expect(
      disposeLinuxClipboardOwner(owner, { termGraceMs: 1, killGraceMs: 1 }),
    ).resolves.toBe(false);
    child.stderr.destroy();
  });

  it("rejects truncated or checksum-invalid PNG evidence", () => {
    const fixture = createFixturePng();
    expect(() => pngPixelIdentity(fixture.subarray(0, -1))).toThrow();
    const corrupted = Buffer.from(fixture);
    corrupted[corrupted.length - 8] ^= 0xff;
    expect(() => pngPixelIdentity(corrupted)).toThrow("checksum");
  });
});
