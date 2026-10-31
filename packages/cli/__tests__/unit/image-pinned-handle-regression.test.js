import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// The injected I/O still opens and closes real pinned file descriptors.
import { readBoundedImage } from "../../src/lib/image-file-boundary.js";

const LIMIT = 20 * 1024 * 1024;
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=",
  "base64",
);
let root;
let live;
beforeEach(() => {
  root = fs.mkdtempSync(join(tmpdir(), "verify-13-image-"));
  live = new Set();
});
afterEach(() => {
  // Cleanup is a fallback, not evidence of production closure.
  for (const fd of live) fs.closeSync(fd);
  fs.rmSync(root, { recursive: true, force: true });
});
function file(name, bytes = PNG) {
  const path = join(root, name);
  fs.writeFileSync(path, bytes);
  return path;
}
function trackedIO() {
  return {
    openSync: vi.fn((...args) => {
      const fd = fs.openSync(...args);
      live.add(fd);
      return fd;
    }),
    fstatSync: vi.fn((...args) => fs.fstatSync(...args)),
    readSync: vi.fn((...args) => fs.readSync(...args)),
    closeSync: vi.fn((fd) => {
      fs.closeSync(fd);
      live.delete(fd);
    }),
  };
}
function expectClosed(io) {
  expect(io.openSync).toHaveBeenCalledTimes(1);
  const fd = io.openSync.mock.results[0].value;
  expect(io.closeSync.mock.calls).toEqual([[fd]]);
  expect(io.fstatSync.mock.calls.length).toBeGreaterThan(0);
  for (const [used] of [...io.fstatSync.mock.calls, ...io.readSync.mock.calls])
    expect(used).toBe(fd);
  expect(() => fs.fstatSync(fd)).toThrow(/EBADF/);
  expect(live.size).toBe(0);
}

describe("attachment same-handle read boundary (independent regression)", () => {
  it("reads a small PNG through short reads, pins the opened inode and closes it", () => {
    const target = file("small.png");
    const replacement = file("replacement.png", Buffer.from("not an image"));
    const originalInode = fs.statSync(target).ino;
    const replacementInode = fs.statSync(replacement).ino;
    expect(replacementInode).not.toBe(originalInode);
    const io = trackedIO();
    const open = io.openSync.getMockImplementation();
    io.openSync.mockImplementation((...args) => {
      const fd = open(...args);
      // Rename after open, before the first fstat: only the pathname changes.
      fs.renameSync(target, join(root, "opened-original.png"));
      fs.renameSync(replacement, target);
      expect(fs.fstatSync(fd).ino).toBe(originalInode);
      return fd;
    });
    io.readSync.mockImplementation((fd, data, offset, length, position) =>
      fs.readSync(fd, data, offset, Math.min(length, 7), position),
    );
    const data = readBoundedImage(target, "image/png", PNG.length, io);
    expect(Buffer.isBuffer(data)).toBe(true);
    expect(data).toEqual(PNG);
    expect(fs.statSync(target).ino).toBe(replacementInode);
    expect(io.readSync.mock.calls.length).toBeGreaterThan(2);
    expect(io.fstatSync).toHaveBeenCalledTimes(2);
    expectClosed(io);
  });

  it("rejects a valid but wrong-format inode substituted immediately before open", () => {
    const target = file("selected.png");
    const gif = Buffer.from(
      "R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
      "base64",
    );
    const replacement = file("other.gif", gif);
    const selectedInode = fs.statSync(target).ino;
    const substitutedInode = fs.statSync(replacement).ino;
    expect(substitutedInode).not.toBe(selectedInode);
    const io = trackedIO();
    const open = io.openSync.getMockImplementation();
    io.openSync.mockImplementation((...args) => {
      fs.renameSync(replacement, target);
      const fd = open(...args);
      expect(fs.fstatSync(fd).ino).toBe(substitutedInode);
      return fd;
    });
    expect(() => readBoundedImage(target, "image/png", LIMIT, io)).toThrow(
      /extension does not match its file header/,
    );
    expect(io.readSync).toHaveBeenCalledTimes(1);
    expectClosed(io);
    // The replacement is a readable small image, not an earlier malformed-input failure.
    const control = trackedIO();
    expect(readBoundedImage(target, "image/gif", LIMIT, control)).toEqual(gif);
    expectClosed(control);
  });

  it("rejects independent byte and pixel limits with valid image prerequisites", () => {
    for (const oversized of [true, false]) {
      const target = file(`limit-${oversized}.png`);
      const io = trackedIO();
      if (oversized) {
        const replacement = file("too-large.png");
        fs.truncateSync(replacement, LIMIT + 1);
        const replacementInode = fs.statSync(replacement).ino;
        expect(replacementInode).not.toBe(fs.statSync(target).ino);
        const open = io.openSync.getMockImplementation();
        io.openSync.mockImplementation((...args) => {
          fs.renameSync(replacement, target);
          const fd = open(...args);
          expect(fs.fstatSync(fd).ino).toBe(replacementInode);
          return fd;
        });
      }
      expect(() =>
        readBoundedImage(
          target,
          "image/png",
          oversized ? LIMIT + 1 : PNG.length - 1,
          io,
        ),
      ).toThrow(
        oversized ? /1 byte to 20 MiB/ : /Total image attachments exceed/,
      );
      expect(io.readSync).not.toHaveBeenCalled();
      expectClosed(io);
    }
    const atLimit = Buffer.from(PNG);
    atLimit.writeUInt32BE(40_000_000, 16);
    const overLimit = Buffer.from(atLimit);
    overLimit.writeUInt32BE(40_000_001, 16);
    const over = file("over-pixel-limit.png", overLimit);
    const rejected = trackedIO();
    expect(() => readBoundedImage(over, "image/png", LIMIT, rejected)).toThrow(
      /40 megapixels/,
    );
    expectClosed(rejected);
    const allowed = file("at-pixel-limit.png", atLimit);
    const control = trackedIO();
    expect(readBoundedImage(allowed, "image/png", LIMIT, control)).toEqual(
      atLimit,
    );
    expectClosed(control);
  });

  it("caps reads at the admitted size plus one when the opened file grows", () => {
    const target = file("growing.png");
    const io = trackedIO();
    let changed = false;
    io.readSync.mockImplementation((...args) => {
      const count = fs.readSync(...args);
      if (!changed) {
        changed = true;
        fs.appendFileSync(target, Buffer.alloc(1024, 65));
      }
      return count;
    });
    expect(() => readBoundedImage(target, "image/png", LIMIT, io)).toThrow(
      /changed while being read/,
    );
    expect(changed).toBe(true);
    expect(io.readSync).toHaveBeenCalledTimes(2);
    const [headerRead, bodyRead] = io.readSync.mock.calls;
    expect(headerRead.slice(2)).toEqual([0, PNG.length, 0]);
    expect(bodyRead.slice(2)).toEqual([0, PNG.length + 1, 0]);
    expect(bodyRead[1].length).toBe(PNG.length + 1);
    expect(io.readSync.mock.results.map(({ value }) => value)).toEqual([
      PNG.length,
      PNG.length + 1,
    ]);
    expect(io.fstatSync).toHaveBeenCalledTimes(2);
    expectClosed(io);
  });

  it("rejects equal-length content changes even when descriptor timestamps are unchanged", () => {
    const target = file("rewritten.png");
    const replacement = Buffer.from(PNG);
    replacement.writeUInt32BE(2, 16); // Still an admissible small PNG header.
    const io = trackedIO();
    let metadata;
    io.fstatSync.mockImplementation((fd) => {
      const stat = fs.fstatSync(fd);
      if (!metadata)
        metadata = { mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs };
      // Model coarse timestamp resolution; retain real descriptor type and size.
      Object.assign(stat, metadata);
      return stat;
    });
    let changed = false;
    io.readSync.mockImplementation((...args) => {
      const count = fs.readSync(...args);
      if (!changed) {
        changed = true;
        fs.writeFileSync(target, replacement);
      }
      return count;
    });
    expect(() => readBoundedImage(target, "image/png", LIMIT, io)).toThrow(
      /changed while being read/,
    );
    expect(changed).toBe(true);
    expect(io.readSync).toHaveBeenCalledTimes(3); // header, body, EOF probe
    expect(io.readSync.mock.results.map(({ value }) => value)).toEqual([
      PNG.length,
      PNG.length,
      0,
    ]);
    expect(io.fstatSync).toHaveBeenCalledTimes(2);
    const [before, after] = io.fstatSync.mock.results.map(({ value }) => value);
    expect(after.size).toBe(before.size);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(after.ctimeMs).toBe(before.ctimeMs);
    expectClosed(io);
    const control = trackedIO();
    expect(readBoundedImage(target, "image/png", LIMIT, control)).toEqual(
      replacement,
    );
    expectClosed(control);
    for (const field of ["mtimeMs", "ctimeMs"]) {
      const metadataOnly = trackedIO();
      let initial,
        observations = 0;
      metadataOnly.fstatSync.mockImplementation((fd) => {
        const stat = fs.fstatSync(fd);
        initial ??= { mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs };
        Object.assign(stat, initial);
        if (++observations === 2) stat[field] += 1;
        return stat;
      });
      const originalBytes = fs.readFileSync(target);
      expect(() =>
        readBoundedImage(target, "image/png", LIMIT, metadataOnly),
      ).toThrow(/changed while being read/);
      expect(fs.readFileSync(target)).toEqual(originalBytes);
      expect(metadataOnly.fstatSync).toHaveBeenCalledTimes(2);
      expectClosed(metadataOnly);
    }
  });

  it("rejects an opened directory as non-regular without attempting a read", () => {
    const io = trackedIO();
    expect(() => readBoundedImage(root, "image/png", LIMIT, io)).toThrow(
      /must be a regular file/,
    );
    expect(io.readSync).not.toHaveBeenCalled();
    expectClosed(io);
  });
});
