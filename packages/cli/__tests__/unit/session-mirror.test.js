/**
 * session-mirror — the off-box session copy (fs/http drivers) plus the P1
 * Turn/Checkpoint additions: at-rest encryption, deletion, retention prune, and
 * key rotation. fs access + crypto RNG go through injected deps so the whole
 * thing round-trips deterministically without a real disk.
 */
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import {
  createMirror,
  createFsMirror,
  createMirrorCipher,
  pruneMirror,
  rotateMirrorKey,
} from "../../src/harness/session-mirror.js";

const DIR = join("/mirror", "sessions");

/** In-memory fs implementing exactly the fs-driver surface. */
function memFs() {
  const files = new Map();
  const dirs = new Set();
  return {
    files,
    existsSync: (p) => files.has(p) || dirs.has(p),
    mkdirSync: (p) => dirs.add(p),
    readFileSync: (p) => {
      if (!files.has(p)) throw new Error("ENOENT " + p);
      return files.get(p);
    },
    writeFileSync: (p, data) => files.set(p, data),
    readdirSync: (dir) =>
      [...files.keys()]
        .filter((f) => f.startsWith(dir))
        .map((f) => f.slice(dir.length).replace(/^[\\/]/, "")),
    unlinkSync: (p) => files.delete(p),
  };
}

describe("createFsMirror push/pull/list/delete", () => {
  it("round-trips bytes and enumerates ids", async () => {
    const fs = memFs();
    const m = createFsMirror({ dir: DIR }, fs);
    await m.push("s1", "line1\nline2\n");
    await m.push("s2", "x\n");
    expect(await m.pull("s1")).toBe("line1\nline2\n");
    expect((await m.list()).sort()).toEqual(["s1", "s2"]);
    expect(await m.pull("missing")).toBe(null);
  });

  it("deletes an entry idempotently", async () => {
    const fs = memFs();
    const m = createFsMirror({ dir: DIR }, fs);
    await m.push("s1", "a\n");
    expect(await m.delete("s1")).toEqual({ id: "s1", deleted: true });
    expect(await m.pull("s1")).toBe(null);
    expect(await m.delete("s1")).toEqual({ id: "s1", deleted: false });
  });

  it("rejects an unsafe session id", async () => {
    const m = createFsMirror({ dir: DIR }, memFs());
    await expect(m.push("../escape", "x")).rejects.toThrow(/unsafe/);
  });
});

describe("createMirrorCipher (at-rest AES-256-GCM)", () => {
  it("round-trips through encrypt → decrypt", () => {
    const c = createMirrorCipher({ passphrase: "correct horse", keyId: "k1" });
    const env = c.encrypt("secret session bytes\n");
    expect(env).not.toContain("secret session bytes"); // ciphertext, not plaintext
    expect(c.decrypt(env)).toBe("secret session bytes\n");
    expect(c.envelopeKeyId(env)).toBe("k1");
  });

  it("fails to decrypt with the wrong passphrase", () => {
    const a = createMirrorCipher({ passphrase: "pw-a" });
    const b = createMirrorCipher({ passphrase: "pw-b" });
    const env = a.encrypt("data");
    expect(() => b.decrypt(env)).toThrow();
  });

  it("detects tampered ciphertext (GCM auth)", () => {
    const c = createMirrorCipher({ passphrase: "pw" });
    const env = JSON.parse(c.encrypt("data"));
    // Flip a byte of the ciphertext.
    const ct = Buffer.from(env.ct, "base64url");
    ct[0] ^= 0xff;
    env.ct = ct.toString("base64url");
    expect(() => c.decrypt(JSON.stringify(env))).toThrow();
  });

  it("rejects a non-envelope / unsupported version", () => {
    const c = createMirrorCipher({ passphrase: "pw" });
    expect(() => c.decrypt("not json")).toThrow(/not a valid envelope/);
    expect(() => c.decrypt(JSON.stringify({ v: 99 }))).toThrow(/unsupported/);
  });

  it("requires a passphrase", () => {
    expect(() => createMirrorCipher({})).toThrow(/passphrase/);
  });
});

describe("createMirror with encryption wrapper", () => {
  it("stores ciphertext at rest but pulls back plaintext", async () => {
    const fs = memFs();
    const m = createMirror(
      { kind: "fs", dir: DIR, encryption: { passphrase: "pw", keyId: "k1" } },
      fs,
    );
    expect(m.encrypted).toBe(true);
    const r = await m.push("s1", "plaintext session\n");
    expect(r.encrypted).toBe(true);
    // What actually hit disk is the envelope, not the plaintext.
    const stored = [...fs.files.values()][0];
    expect(stored).not.toContain("plaintext session");
    expect(stored).toContain('"ct"');
    // Transparent decrypt on pull.
    expect(await m.pull("s1")).toBe("plaintext session\n");
  });

  it("returns the raw driver unwrapped when no passphrase is set", async () => {
    const fs = memFs();
    const m = createMirror({ kind: "fs", dir: DIR }, fs);
    expect(m.encrypted).toBeUndefined();
    await m.push("s1", "raw\n");
    expect([...fs.files.values()][0]).toBe("raw\n"); // stored verbatim
  });

  it("returns null when no mirror is configured", () => {
    expect(createMirror({})).toBe(null);
    expect(createMirror({ kind: "none" })).toBe(null);
  });
});

describe("pruneMirror (retention)", () => {
  it("deletes every id not in the keep set", async () => {
    const fs = memFs();
    const m = createFsMirror({ dir: DIR }, fs);
    for (const id of ["keep1", "keep2", "gone1", "gone2"]) {
      await m.push(id, "x\n");
    }
    const res = await pruneMirror(m, { keep: ["keep1", "keep2"] });
    expect(res.deleted.sort()).toEqual(["gone1", "gone2"]);
    expect((await m.list()).sort()).toEqual(["keep1", "keep2"]);
  });

  it("no-ops on a null mirror", async () => {
    expect(await pruneMirror(null, { keep: [] })).toEqual({
      deleted: [],
      kept: [],
    });
  });
});

describe("rotateMirrorKey", () => {
  it("re-encrypts every entry from the old key to the new key", async () => {
    const fs = memFs();
    const driver = createFsMirror({ dir: DIR }, fs);
    const oldC = createMirrorCipher({ passphrase: "old-pw", keyId: "k1" });
    const newC = createMirrorCipher({ passphrase: "new-pw", keyId: "k2" });
    // Seed the mirror as if written under the old key.
    await driver.push("s1", oldC.encrypt("session one\n"));
    await driver.push("s2", oldC.encrypt("session two\n"));

    const res = await rotateMirrorKey(driver, { from: oldC, to: newC });
    expect(res.rotated.sort()).toEqual(["s1", "s2"]);
    expect(res.keyId).toBe("k2");

    // The new key reads it; the old key no longer can.
    const raw = await driver.pull("s1");
    expect(newC.decrypt(raw)).toBe("session one\n");
    expect(() => oldC.decrypt(raw)).toThrow();
  });

  it("is idempotent — a second rotation skips already-rotated entries", async () => {
    const fs = memFs();
    const driver = createFsMirror({ dir: DIR }, fs);
    const oldC = createMirrorCipher({ passphrase: "old", keyId: "k1" });
    const newC = createMirrorCipher({ passphrase: "new", keyId: "k2" });
    await driver.push("s1", oldC.encrypt("one\n"));
    await rotateMirrorKey(driver, { from: oldC, to: newC });
    const again = await rotateMirrorKey(driver, { from: oldC, to: newC });
    expect(again.rotated).toEqual([]);
    expect(again.skipped).toEqual(["s1"]);
  });

  it("reports (not drops) an entry that fails to decrypt with the old key", async () => {
    const fs = memFs();
    const driver = createFsMirror({ dir: DIR }, fs);
    const oldC = createMirrorCipher({ passphrase: "old", keyId: "k1" });
    const newC = createMirrorCipher({ passphrase: "new", keyId: "k2" });
    const wrong = createMirrorCipher({
      passphrase: "someone-else",
      keyId: "kX",
    });
    await driver.push("s1", wrong.encrypt("foreign\n"));
    const res = await rotateMirrorKey(driver, { from: oldC, to: newC });
    expect(res.rotated).toEqual([]);
    expect(res.failed).toHaveLength(1);
    expect(res.failed[0].id).toBe("s1");
  });

  it("throws without both ciphers", async () => {
    await expect(rotateMirrorKey(null, {})).rejects.toThrow(/requires/);
  });
});
