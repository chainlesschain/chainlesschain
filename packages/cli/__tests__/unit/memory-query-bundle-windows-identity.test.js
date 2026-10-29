import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { syncBuiltinESMExports } from "node:module";
import {
  createQueryBundlePlan,
  readQueryBundle,
  writeQueryBundle,
} from "../../src/lib/context-memory-kernel/memory-query-bundle.js";

const parent = fs.realpathSync.native(os.tmpdir());
const roots = [];
const uvDescriptor = Object.getOwnPropertyDescriptor(process.versions, "uv");

afterEach(() => {
  vi.restoreAllMocks();
  syncBuiltinESMExports();
  Object.defineProperty(process.versions, "uv", uvDescriptor);
  for (const root of roots.splice(0)) {
    if (
      path.dirname(path.resolve(root)) !== parent ||
      !path.basename(root).startsWith("cc-query-bundle-device-")
    )
      throw new Error("unsafe query bundle device fixture cleanup");
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function fixture() {
  const root = fs.mkdtempSync(path.join(parent, "cc-query-bundle-device-"));
  roots.push(root);
  const bytes = Buffer.from("verified frame");
  const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  const plan = createQueryBundlePlan(
    {
      digest,
      shards: { aa: { queryDigest: digest, queryBytes: bytes.length } },
    },
    { maxBundleBytes: 1024 },
  );
  return {
    root,
    file: path.join(root, plan.name),
    plan,
    bytes,
    getFrame: async () => bytes,
    checkDirectories: () => {},
  };
}

function projectPathDevice(f, uvVersion = "1.49.1") {
  Object.defineProperty(process.versions, "uv", {
    ...uvDescriptor,
    value: uvVersion,
  });
  const original = fs.lstatSync;
  vi.spyOn(fs, "lstatSync").mockImplementation((file, options) => {
    const stat = original(file, options);
    if (file === f.root || path.dirname(file) === f.root)
      stat.dev = typeof stat.dev === "bigint" ? 0n : 0;
    return stat;
  });
  syncBuiltinESMExports();
}

describe("precise query bundle identities", () => {
  it("rejects distinct inode values that would collide as Number stats", async () => {
    const f = fixture();
    fs.writeFileSync(f.file, Buffer.concat([f.plan.header, f.bytes]));
    const lstat = fs.lstatSync;
    const fstat = fs.fstatSync;
    const inode = 2n ** 54n;
    vi.spyOn(fs, "lstatSync").mockImplementation((file, options) => {
      const stat = lstat(file, options);
      if (file === f.file) stat.ino = options?.bigint ? inode : Number(inode);
      return stat;
    });
    vi.spyOn(fs, "fstatSync").mockImplementation((fd, options) => {
      const stat = fstat(fd, options);
      if (stat.isFile())
        stat.ino = options?.bigint ? inode + 1n : Number(inode + 1n);
      return stat;
    });
    syncBuiltinESMExports();
    await expect(readQueryBundle(f.file, f.plan)).rejects.toMatchObject({
      code: "CONTEXT_MEMORY_STORE_CORRUPT",
    });
  });
});

// This exercises the Windows compatibility branch using the real Windows
// volume/parent/file handles, even on hosts without GetFileInformationByName.
describe.skipIf(process.platform !== "win32")(
  "Windows path-device projection",
  () => {
    it.each(["1.49.1", "1.50.0"])(
      "round trips a bundle with projected path devices on libuv %s",
      async (uvVersion) => {
        const f = fixture();
        projectPathDevice(f, uvVersion);
        await writeQueryBundle(f.file, f.plan, f);
        const frames = [];
        await readQueryBundle(f.file, f.plan, {
          onFrame: (_, bytes) => frames.push(bytes),
        });
        expect(frames).toEqual([f.bytes]);
        expect(fs.readdirSync(f.root)).toEqual([f.plan.name]);
      },
    );

    it("cleans only its owned temporary after cancellation with projected devices", async () => {
      const f = fixture();
      fs.writeFileSync(f.file, "old target");
      projectPathDevice(f);
      await expect(
        writeQueryBundle(f.file, f.plan, {
          ...f,
          getFrame: () => {
            throw new Error("cancelled source");
          },
        }),
      ).rejects.toThrow("cancelled source");
      expect(fs.readdirSync(f.root)).toEqual([f.plan.name]);
      expect(fs.readFileSync(f.file, "utf8")).toBe("old target");
    });

    it("does not delete a replacement temporary with projected devices", async () => {
      const f = fixture();
      projectPathDevice(f);
      let temporary;
      await expect(
        writeQueryBundle(f.file, f.plan, {
          ...f,
          getFrame: () => {
            temporary = path.join(f.root, fs.readdirSync(f.root)[0]);
            fs.renameSync(temporary, `${temporary}.displaced`);
            fs.writeFileSync(temporary, "replacement");
            throw new Error("cancelled after replacement");
          },
        }),
      ).rejects.toThrow("cancelled after replacement");
      expect(fs.readFileSync(temporary, "utf8")).toBe("replacement");
      expect(fs.existsSync(f.file)).toBe(false);
    });

    it.each(["replacement", "hardlink", "symlink"])(
      "rejects a %s introduced during a projected-device read",
      async (kind) => {
        const f = fixture();
        fs.writeFileSync(f.file, Buffer.concat([f.plan.header, f.bytes]));
        projectPathDevice(f);
        let checks = 0;
        await expect(
          readQueryBundle(f.file, f.plan, {
            checkpoint: () => {
              if (++checks !== 2) return;
              if (kind === "hardlink") {
                fs.linkSync(f.file, `${f.file}.linked`);
                return;
              }
              fs.renameSync(f.file, `${f.file}.displaced`);
              if (kind === "replacement")
                fs.writeFileSync(f.file, "replacement");
              else {
                const target = path.join(f.root, "redirect-target");
                fs.mkdirSync(target);
                fs.symlinkSync(target, f.file, "junction");
              }
            },
          }),
        ).rejects.toMatchObject({ code: "CONTEXT_MEMORY_STORE_CORRUPT" });
        if (kind === "replacement")
          expect(fs.readFileSync(f.file, "utf8")).toBe("replacement");
        else if (kind === "symlink")
          expect(fs.lstatSync(f.file).isSymbolicLink()).toBe(true);
        else expect(fs.lstatSync(f.file).nlink).toBe(2);
      },
    );

    it("rejects a file handle device not bound to the independently opened volume", async () => {
      const f = fixture();
      projectPathDevice(f);
      const fstat = fs.fstatSync;
      vi.spyOn(fs, "fstatSync").mockImplementation((fd, options) => {
        const stat = fstat(fd, options);
        if (stat.isFile()) stat.dev += options?.bigint ? 1n : 1;
        return stat;
      });
      syncBuiltinESMExports();
      await expect(writeQueryBundle(f.file, f.plan, f)).rejects.toMatchObject({
        code: "CONTEXT_MEMORY_STORE_CORRUPT",
      });
      expect(fs.existsSync(f.file)).toBe(false);
      expect(fs.readdirSync(f.root)).toEqual([
        expect.stringMatching(/^query-rebuild-.*\.tmp$/u),
      ]);
    });

    it("does not bridge mismatched devices on unaffected libuv versions", async () => {
      const f = fixture();
      projectPathDevice(f, "1.51.0");
      await expect(writeQueryBundle(f.file, f.plan, f)).rejects.toMatchObject({
        code: "CONTEXT_MEMORY_STORE_CORRUPT",
      });
      expect(fs.existsSync(f.file)).toBe(false);
    });
  },
);
