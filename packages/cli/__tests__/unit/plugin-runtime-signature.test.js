import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { createHash, generateKeyPairSync, sign as edSign } from "node:crypto";
import {
  writePluginLock,
  readPluginLock,
  verifyInstalledSignature,
} from "../../src/lib/plugin-runtime/signature.js";
import { installFromDirectory } from "../../src/lib/plugin-runtime/install.js";
import { filterByManagedPolicy } from "../../src/lib/plugin-runtime/policy.js";
import { pluginVersionDir } from "../../src/lib/plugin-runtime/scopes.js";

let dir;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-psig-"));
});
afterEach(() => {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

describe("writePluginLock / readPluginLock", () => {
  it("round-trips a lock record", () => {
    const vdir = path.join(dir, "v");
    fs.mkdirSync(vdir, { recursive: true });
    fs.writeFileSync(path.join(vdir, "plugin.json"), "{}", "utf8");
    writePluginLock(vdir, {
      manifestFile: path.join(vdir, "plugin.json"),
      sha256: "abc",
      publicKeySha256: "key1",
      signatureVerified: true,
    });
    const lock = readPluginLock(vdir);
    expect(lock).toMatchObject({
      manifest: "plugin.json",
      sha256: "abc",
      publicKeySha256: "key1",
      signatureVerified: true,
    });
  });

  it("returns null when there is no lock", () => {
    expect(readPluginLock(dir)).toBe(null);
  });
});

describe("verifyInstalledSignature", () => {
  function makePlugin(manifestContent, lockOver = {}) {
    const root = path.join(dir, "plug");
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, "plugin.json"), manifestContent, "utf8");
    const lock = {
      lockVersion: 1,
      manifest: "plugin.json",
      sha256: sha256(Buffer.from(manifestContent)),
      publicKeySha256: "keyfp",
      signatureVerified: true,
      ...lockOver,
    };
    fs.writeFileSync(
      path.join(root, ".plugin-lock.json"),
      JSON.stringify(lock),
      "utf8",
    );
    return { root };
  }

  it("signed:true when the lock is verified and the manifest is unchanged", () => {
    const p = makePlugin('{"name":"a","version":"1.0.0"}');
    expect(verifyInstalledSignature(p).signed).toBe(true);
  });

  it("signed:false when there is no lock", () => {
    const root = path.join(dir, "nolock");
    fs.mkdirSync(root, { recursive: true });
    const res = verifyInstalledSignature({ root });
    expect(res.signed).toBe(false);
    expect(res.reason).toMatch(/no signature lock/);
  });

  it("signed:false when the manifest was tampered after install (sha mismatch)", () => {
    const p = makePlugin('{"name":"a","version":"1.0.0"}');
    // Tamper with the on-disk manifest after the lock was written.
    fs.writeFileSync(
      path.join(p.root, "plugin.json"),
      '{"name":"a","version":"1.0.0","evil":true}',
      "utf8",
    );
    const res = verifyInstalledSignature(p);
    expect(res.signed).toBe(false);
    expect(res.reason).toMatch(/tampered/);
  });

  it("signed:false when signatureVerified is false in the lock", () => {
    const p = makePlugin('{"x":1}', { signatureVerified: false });
    expect(verifyInstalledSignature(p).signed).toBe(false);
  });

  it("signed:false when the lock's manifest path escapes the plugin root (traversal)", () => {
    // Plant a secret OUTSIDE the plugin root and a lock that points at it with a
    // matching sha256. Without the boundary check, re-hashing the out-of-tree
    // file would match and forge signed:true.
    const secret = path.join(dir, "outside-secret.json");
    fs.writeFileSync(secret, '{"trusted":"looking"}', "utf8");
    const p = makePlugin('{"x":1}', {
      manifest: "../outside-secret.json",
      sha256: sha256(fs.readFileSync(secret)),
    });
    const res = verifyInstalledSignature(p);
    expect(res.signed).toBe(false);
    expect(res.reason).toMatch(/escapes the plugin root/);
  });

  it("still accepts a legitimate manifest in a subdirectory of the root", () => {
    // The boundary check must not over-reject a manifest nested inside the root.
    const root = path.join(dir, "nested");
    fs.mkdirSync(path.join(root, "sub"), { recursive: true });
    const content = '{"name":"n","version":"1.0.0"}';
    fs.writeFileSync(path.join(root, "sub", "plugin.json"), content, "utf8");
    fs.writeFileSync(
      path.join(root, ".plugin-lock.json"),
      JSON.stringify({
        lockVersion: 1,
        manifest: "sub/plugin.json",
        sha256: sha256(Buffer.from(content)),
        publicKeySha256: "keyfp",
        signatureVerified: true,
      }),
      "utf8",
    );
    expect(verifyInstalledSignature({ root }).signed).toBe(true);
  });

  it("enforces a trusted-keys allowlist when provided", () => {
    const p = makePlugin('{"x":1}', { publicKeySha256: "untrustedfp" });
    const res = verifyInstalledSignature(p, {
      trustedKeys: new Set(["trustedfp"]),
    });
    expect(res.signed).toBe(false);
    expect(res.reason).toMatch(/not trusted/);
    // …and passes when the key IS trusted.
    const ok = verifyInstalledSignature(p, {
      trustedKeys: new Set(["untrustedfp"]),
    });
    expect(ok.signed).toBe(true);
  });
});

describe("install with a real Ed25519 signature → lock → load enforcement", () => {
  let cwd;
  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cc-psig-cwd-"));
  });
  afterEach(() => {
    try {
      fs.rmSync(cwd, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  function makeSignedSource(name, version) {
    const src = fs.mkdtempSync(path.join(dir, `${name}-`));
    const manifest = JSON.stringify({ name, version });
    fs.writeFileSync(path.join(src, "plugin.json"), manifest, "utf8");
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const sig = edSign(null, Buffer.from(manifest), privateKey);
    const sigFile = path.join(src, "plugin.json.sig");
    const keyFile = path.join(src, "key.pub");
    fs.writeFileSync(sigFile, sig);
    fs.writeFileSync(
      keyFile,
      publicKey.export({ type: "spki", format: "pem" }),
      "utf8",
    );
    return { src, sigFile, keyFile, manifest };
  }

  it("records a verified lock, and requireSignedPlugins keeps signed / drops unsigned", () => {
    // 1) A signed plugin installs and records a lock.
    const signed = makeSignedSource("signed-one", "1.0.0");
    const res = installFromDirectory(signed.src, {
      scope: "local",
      cwd,
      signature: {
        signatureFile: signed.sigFile,
        publicKeyFile: signed.keyFile,
        requireSignature: true,
      },
    });
    expect(res.signatureVerified).toBe(true);
    const lock = readPluginLock(
      pluginVersionDir("local", "signed-one", "1.0.0", { cwd }),
    );
    expect(lock.signatureVerified).toBe(true);

    // 2) An UNsigned plugin installs with no lock.
    const unsignedSrc = fs.mkdtempSync(path.join(dir, "unsigned-"));
    fs.writeFileSync(
      path.join(unsignedSrc, "plugin.json"),
      JSON.stringify({ name: "unsigned-one", version: "1.0.0" }),
      "utf8",
    );
    installFromDirectory(unsignedSrc, { scope: "local", cwd });

    // 3) Under requireSignedPlugins, only the signed one survives the filter.
    const signedPlugin = {
      name: "signed-one",
      root: pluginVersionDir("local", "signed-one", "1.0.0", { cwd }),
    };
    const unsignedPlugin = {
      name: "unsigned-one",
      root: pluginVersionDir("local", "unsigned-one", "1.0.0", { cwd }),
    };
    const { kept, dropped } = filterByManagedPolicy(
      [signedPlugin, unsignedPlugin],
      { requireSignedPlugins: true },
    );
    expect(kept.map((p) => p.name)).toEqual(["signed-one"]);
    expect(dropped.map((d) => d.name)).toEqual(["unsigned-one"]);
    expect(dropped[0].reason).toMatch(/requireSignedPlugins/);
  });

  it("a signed install that fails verification does NOT land on disk (fail-closed)", () => {
    const signed = makeSignedSource("bad-sig", "1.0.0");
    // Corrupt the manifest AFTER signing so the signature no longer matches.
    fs.writeFileSync(
      path.join(signed.src, "plugin.json"),
      JSON.stringify({ name: "bad-sig", version: "1.0.0", tampered: true }),
      "utf8",
    );
    expect(() =>
      installFromDirectory(signed.src, {
        scope: "local",
        cwd,
        signature: {
          signatureFile: signed.sigFile,
          publicKeyFile: signed.keyFile,
          requireSignature: true,
        },
      }),
    ).toThrow(/signature verification failed/);
    expect(
      fs.existsSync(pluginVersionDir("local", "bad-sig", "1.0.0", { cwd })),
    ).toBe(false);
  });
});
