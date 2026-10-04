import { describe, it, expect, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { inspectImageBudget } from "../../../vscode-extension/src/chat/image-decode-budget.js";
import {
  createImagePreviewGate,
  drawImagePreview,
  decodeImagePreviewBatch,
} from "../../../vscode-extension/src/chat/image-preview-gate.js";
import { readImageSnapshot } from "../../../vscode-extension/src/chat/image-file-snapshot.js";
import { writeImageTemps } from "../../../vscode-extension/src/chat/image-attachments.js";

const gif = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
);
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGPgKfjwHwAEZAJsF63ZDAAAAABJRU5ErkJggg==",
  "base64",
);
const animated = (count, canvas = 1) => {
  const header = Buffer.from(gif.subarray(0, 19));
  header.writeUInt16LE(canvas, 6);
  header.writeUInt16LE(canvas, 8);
  return Buffer.concat([
    header,
    ...Array.from({ length: count }, () => gif.subarray(19, -1)),
    Buffer.from([0x3b]),
  ]);
};

describe("complete-container admission, distinct from codec decoding", () => {
  it("counts all GIF compositing canvases, including small delta frames", () => {
    expect(inspectImageBudget(animated(3, 100))).toMatchObject({
      frames: 3,
      decodedPixels: 30000,
    });
    expect(() => inspectImageBudget(animated(201))).toThrow("200 frames");
    expect(() => inspectImageBudget(animated(3, 4000))).toThrow(
      "decoded canvas pixels",
    );
  });
  it("rejects damaged/truncated containers that retain valid dimension headers", () => {
    const damaged = Buffer.from(png);
    damaged[45] ^= 1;
    expect(() => inspectImageBudget(damaged)).toThrow("checksum");
    for (const file of [gif, png])
      expect(() => inspectImageBudget(file.subarray(0, -1))).toThrow();
    const outside = Buffer.from(gif);
    outside.writeUInt16LE(2, 32);
    expect(() => inspectImageBudget(outside)).toThrow("canvas");
  });
  it("retains PNG and GIF acceptance with explicit frame metadata", () => {
    for (const file of [png, gif])
      expect(inspectImageBudget(file)).toMatchObject({
        width: 1,
        height: 1,
        frames: 1,
        decodedPixels: 1,
      });
  });
});

describe("cancellable codec worker lifecycle", () => {
  it("closes transferred bitmaps that arrive after cancellation", async () => {
    const worker = { postMessage() {}, terminate() {} };
    const gate = createImagePreviewGate({ workerFactory: () => worker });
    const pending = gate.validate([]);
    const rejected = expect(pending).rejects.toThrow("cancelled");
    gate.cancel();
    const bitmap = { close: vi.fn() };
    worker.onmessage({ data: { results: [{ thumbnails: [{ bitmap }] }] } });
    await rejected;
    expect(bitmap.close).toHaveBeenCalledOnce();
  });
  it("preserves per-frame duration with a minimum and stops playback timers", async () => {
    vi.useFakeTimers();
    try {
      const context = { clearRect() {}, drawImage: vi.fn() };
      const stop = drawImagePreview(
        { getContext: () => context },
        {
          repetitions: Infinity,
          thumbnails: [
            { bitmap: "first", duration: 1 },
            { bitmap: "second", duration: 125 },
          ],
        },
      );
      expect(context.drawImage).toHaveBeenLastCalledWith("first", 0, 0);
      await vi.advanceTimersByTimeAsync(19);
      expect(context.drawImage).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(context.drawImage).toHaveBeenLastCalledWith("second", 0, 0);
      await vi.advanceTimersByTimeAsync(124);
      expect(context.drawImage).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(context.drawImage).toHaveBeenCalledTimes(3);
      stop();
      await vi.advanceTimersByTimeAsync(1000);
      expect(context.drawImage).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
  it("rejects codec frame-count or canvas disagreements and closes native resources", async () => {
    for (const incorrectFrames of [true, false]) {
      const close = vi.fn();
      const frameClose = vi.fn();
      vi.stubGlobal(
        "ImageDecoder",
        class {
          static async isTypeSupported() {
            return true;
          }
          tracks = {
            ready: Promise.resolve(),
            selectedTrack: { frameCount: incorrectFrames ? 2 : 1 },
          };
          completed = Promise.resolve();
          async decode() {
            return {
              complete: true,
              image: { displayWidth: 9, displayHeight: 9, close: frameClose },
            };
          }
          close = close;
        },
      );
      vi.stubGlobal(
        "OffscreenCanvas",
        class {
          getContext() {
            return {};
          }
        },
      );
      try {
        await expect(
          decodeImagePreviewBatch([
            { data: "data:image/gif;base64," + gif.toString("base64") },
          ]),
        ).rejects.toThrow(incorrectFrames ? "frame count" : "dimensions");
        expect(close).toHaveBeenCalledOnce();
        if (!incorrectFrames) expect(frameClose).toHaveBeenCalledOnce();
      } finally {
        vi.unstubAllGlobals();
      }
    }
  });
  it("terminates a stuck worker on deadline and rejects stale completion", async () => {
    vi.useFakeTimers();
    try {
      const worker = { postMessage: vi.fn(), terminate: vi.fn() };
      const gate = createImagePreviewGate({
        timeoutMs: 25,
        workerFactory: () => worker,
      });
      const result = gate.validate([{ data: "fixture" }]);
      const rejected = expect(result).rejects.toThrow("budget");
      await vi.advanceTimersByTimeAsync(25);
      await rejected;
      worker.onmessage({ data: { results: ["late"] } });
      expect(worker.terminate).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
  it("replacing the visible batch kills its decoder and accepts only the new result", async () => {
    const workers = [];
    const gate = createImagePreviewGate({
      workerFactory: () => {
        const worker = { postMessage() {}, terminate: vi.fn() };
        workers.push(worker);
        return worker;
      },
    });
    const first = gate.validate([{ data: "first" }]);
    const rejected = expect(first).rejects.toThrow("cancelled");
    const second = gate.validate([{ data: "second" }]);
    workers[0].onmessage({ data: { results: ["old"] } });
    workers[1].onmessage({ data: { results: ["new"] } });
    await rejected;
    expect(await second).toEqual(["new"]);
    expect(
      workers.every((worker) => worker.terminate.mock.calls.length === 1),
    ).toBe(true);
  });
});

describe("single-descriptor image reads", () => {
  function fixture({
    growth = false,
    mutation = false,
    tick = () => {},
    pathStat = {},
    handleStat = {},
    afterPathStat = {},
    afterHandleStat = {},
  } = {}) {
    const before = {
      isFile: () => true,
      size: 3n,
      dev: 1n,
      ino: 2n,
      mtimeNs: 1000000n,
      ctimeNs: 1000000n,
    };
    let reads = 0;
    const handle = {
      stat: vi.fn(async () => ({
        ...before,
        ...handleStat,
        ...(reads ? afterHandleStat : {}),
        ...(mutation && reads ? { mtimeNs: before.mtimeNs + 1n } : {}),
      })),
      read: vi.fn(async (buffer, offset, length, position) => {
        reads++;
        tick();
        const source = Buffer.from(growth ? "grow" : "abc");
        const bytesRead = Math.min(length, 1, source.length - position);
        if (bytesRead > 0)
          source.copy(buffer, offset, position, position + bytesRead);
        return { bytesRead: Math.max(0, bytesRead) };
      }),
      close: vi.fn(async () => {}),
    };
    return {
      handle,
      io: {
        lstat: vi.fn(async () => ({
          ...before,
          ...pathStat,
          ...(reads ? afterPathStat : {}),
        })),
        open: vi.fn(async () => handle),
      },
    };
  }
  it("handles short reads and rejects growth or same-size observed modification", async () => {
    const valid = fixture();
    expect(String(await readImageSnapshot("image", null, valid))).toBe("abc");
    for (const options of [{ growth: true }, { mutation: true }]) {
      const test = fixture(options);
      await expect(readImageSnapshot("image", null, test)).rejects.toThrow(
        "changed while reading",
      );
      expect(test.handle.close).toHaveBeenCalledOnce();
      expect(
        test.handle.read.mock.calls.every((call) => call[0].length === 4),
      ).toBe(true);
    }
  });
  it("accepts Windows 64-bit path and 32-bit handle volume serials without losing precision", async () => {
    const dev = (1n << 60n) + 0xabcdef12n;
    const test = fixture({
      pathStat: { dev },
      handleStat: { dev: BigInt.asUintN(32, dev) },
    });
    expect(
      String(
        await readImageSnapshot("image", null, { ...test, platform: "win32" }),
      ),
    ).toBe("abc");
    expect(test.io.lstat).toHaveBeenCalledWith("image", { bigint: true });
    expect(test.handle.stat).toHaveBeenCalledWith({ bigint: true });
    expect(test.handle.close).toHaveBeenCalledOnce();
  });
  it("rejects different low device bits, large inode replacements and nanosecond changes while opening", async () => {
    const ino = 1n << 60n;
    for (const options of [
      { pathStat: { dev: (1n << 60n) + 7n }, handleStat: { dev: 8n } },
      { pathStat: { ino }, handleStat: { ino: ino + 1n } },
      { handleStat: { mtimeNs: 1000001n } },
      { handleStat: { ctimeNs: 1000001n } },
      { pathStat: { isFile: () => false } },
    ]) {
      const test = fixture(options);
      await expect(
        readImageSnapshot("image", null, { ...test, platform: "win32" }),
      ).rejects.toThrow("changed");
      expect(test.handle.read).not.toHaveBeenCalled();
      if (test.io.open.mock.calls.length)
        expect(test.handle.close).toHaveBeenCalledOnce();
    }
  });
  it("retains full device IDs within each API and rejects path replacement during reading", async () => {
    const dev = (1n << 60n) + 7n;
    for (const options of [
      { afterPathStat: { dev: dev + (1n << 32n) } },
      { afterHandleStat: { dev: 7n + (1n << 32n) } },
      { afterPathStat: { ino: 3n } },
      { afterPathStat: { isFile: () => false } },
      { afterPathStat: { ctimeNs: 1000001n } },
    ]) {
      const test = fixture({
        pathStat: { dev },
        handleStat: { dev: 7n },
        ...options,
      });
      await expect(
        readImageSnapshot("image", null, { ...test, platform: "win32" }),
      ).rejects.toThrow("changed while reading");
      expect(test.handle.close).toHaveBeenCalledOnce();
    }
  });
  it("compares full device IDs across APIs on POSIX", async () => {
    const test = fixture({ pathStat: { dev: (1n << 32n) + 1n } });
    await expect(
      readImageSnapshot("image", null, { ...test, platform: "linux" }),
    ).rejects.toThrow("changed while opening");
    expect(test.handle.close).toHaveBeenCalledOnce();
  });
  function zeroDeviceFixture(probeChanges = [{}, {}]) {
    const test = fixture({ pathStat: { dev: 0n }, handleStat: { dev: 7n } });
    const probes = probeChanges.map((changes) => ({
      stat: vi.fn(async () => ({
        isFile: () => true,
        size: 3n,
        dev: 7n,
        ino: 2n,
        mtimeNs: 1000000n,
        ctimeNs: 1000000n,
        ...changes,
      })),
      close: vi.fn(async () => {}),
    }));
    test.io.open.mockResolvedValueOnce(test.handle);
    for (const probe of probes) test.io.open.mockResolvedValueOnce(probe);
    return { ...test, probes, platform: "win32" };
  }
  it("binds Windows zero-device path stats to full file-handle identities before and after reading", async () => {
    const test = zeroDeviceFixture();
    expect(String(await readImageSnapshot("image", null, test))).toBe("abc");
    expect(test.io.open).toHaveBeenCalledTimes(3);
    expect(test.handle.close).toHaveBeenCalledOnce();
    for (const probe of test.probes) {
      expect(probe.stat).toHaveBeenCalledWith({ bigint: true });
      expect(probe.close).toHaveBeenCalledOnce();
    }
  });
  it("rejects another volume with the same inode and timestamps at either zero-device path check", async () => {
    for (const phase of ["opening", "reading"]) {
      for (const dev of [8n, 7n + (1n << 32n)]) {
        const test = zeroDeviceFixture(
          phase === "opening" ? [{ dev }] : [{}, { dev }],
        );
        await expect(readImageSnapshot("image", null, test)).rejects.toThrow(
          `changed while ${phase}`,
        );
        expect(test.handle.close).toHaveBeenCalledOnce();
        for (const probe of test.probes)
          expect(probe.close).toHaveBeenCalledOnce();
        if (phase === "opening")
          expect(test.handle.read).not.toHaveBeenCalled();
        else expect(test.handle.read).toHaveBeenCalled();
      }
    }
  });
  it("closes both descriptors if the zero-device verification fails or is cancelled", async () => {
    for (const cancel of [false, true]) {
      const test = zeroDeviceFixture([{}]);
      const controller = new AbortController();
      test.probes[0].stat.mockImplementationOnce(async () => {
        if (!cancel) throw new Error("volume lookup failed");
        controller.abort();
        return {};
      });
      await expect(
        readImageSnapshot("image", null, {
          ...test,
          signal: controller.signal,
        }),
      ).rejects.toThrow(cancel ? "cancelled" : "volume lookup failed");
      expect(test.probes[0].close).toHaveBeenCalledOnce();
      expect(test.handle.close).toHaveBeenCalledOnce();
      expect(test.handle.read).not.toHaveBeenCalled();
    }
  });
  it("does not accept a missing path device ID on POSIX", async () => {
    const test = zeroDeviceFixture([{}]);
    await expect(
      readImageSnapshot("image", null, { ...test, platform: "linux" }),
    ).rejects.toThrow("changed while opening");
    expect(test.io.open).toHaveBeenCalledOnce();
    expect(test.handle.close).toHaveBeenCalledOnce();
  });
  it("checks cancellation and elapsed budget between chunks and closes the descriptor", async () => {
    let now = 0;
    const timed = fixture({
      tick: () => {
        now += 6;
      },
    });
    await expect(
      readImageSnapshot("image", null, {
        ...timed,
        timeoutMs: 5,
        now: () => now,
      }),
    ).rejects.toThrow("time budget");
    expect(timed.handle.close).toHaveBeenCalledOnce();
    const controller = new AbortController();
    const cancelled = fixture({ tick: () => controller.abort() });
    await expect(
      readImageSnapshot("image", null, {
        ...cancelled,
        signal: controller.signal,
      }),
    ).rejects.toThrow("cancelled");
    expect(cancelled.handle.close).toHaveBeenCalledOnce();
  });
  it("reads real files and rejects an unexpected saved size", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "image-read-"));
    try {
      const file = path.join(dir, "one.png");
      await fs.writeFile(file, png);
      expect(await readImageSnapshot(file, png.length)).toEqual(png);
      await expect(readImageSnapshot(file, png.length + 1)).rejects.toThrow(
        "changed",
      );
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

it("persists GIF attachments and cleans staging under a path longer than Windows MAX_PATH", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "image-long-path-"));
  const directory = path.join(
    root,
    ...Array(5).fill("draft-" + "x".repeat(48)),
  );
  expect(directory.length).toBeGreaterThan(260);
  try {
    await fs.mkdir(directory, { recursive: true });
    const [file] = await writeImageTemps(
      [{ data: "data:image/gif;base64," + gif.toString("base64") }],
      { directory },
    );
    expect(path.dirname(file)).toBe(directory);
    expect(file.startsWith("\\\\?\\")).toBe(false);
    expect(await readImageSnapshot(file, gif.length)).toEqual(gif);
    expect(await fs.readdir(directory)).toEqual([path.basename(file)]);
    await expect(
      writeImageTemps(
        [{ data: "data:image/gif;base64," + gif.toString("base64") }],
        { directory, timeoutMs: 0 },
      ),
    ).rejects.toThrow("budget");
    expect(await fs.readdir(directory)).toEqual([path.basename(file)]);
  } finally {
    // root is the exact directory created by this test under os.tmpdir().
    await fs.rm(root, { recursive: true, force: true });
  }
});

it("cleans private worker staging after timeout/cancel and promotes accepted bytes exclusively", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "image-worker-"));
  const images = [{ data: "data:image/png;base64," + png.toString("base64") }];
  try {
    await expect(
      writeImageTemps(images, { directory, timeoutMs: 0 }),
    ).rejects.toThrow("budget");
    expect(await fs.readdir(directory)).toEqual([]);
    const controller = new AbortController();
    const pending = writeImageTemps(images, {
      directory,
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toThrow("cancelled");
    expect(await fs.readdir(directory)).toEqual([]);
    const [file] = await writeImageTemps(images, { directory });
    expect(await fs.readFile(file)).toEqual(png);
    expect(await fs.readdir(directory)).toEqual([path.basename(file)]);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
