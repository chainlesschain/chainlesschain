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

/** Generate an Ed25519 pair + sign `content`; returns real lock material. */
function signContent(content) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const bytes = Buffer.from(content);
  return {
    signatureBase64: edSign(null, bytes, privateKey).toString("base64"),
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }),
    publicKeySha256: sha256(publicKey.export({ type: "spki", format: "der" })),
    privateKey,
    publicKey,
  };
}

describe("writePluginLock / readPluginLock", () => {
  it("round-trips a lock record including the signature material", () => {
    const vdir = path.join(dir, "v");
    fs.mkdirSync(vdir, { recursive: true });
    fs.writeFileSync(path.join(vdir, "plugin.json"), "{}", "utf8");
    writePluginLock(vdir, {
      manifestFile: path.join(vdir, "plugin.json"),
      sha256: "abc",
      publicKeySha256: "key1",
      signatureVerified: true,
      signatureBase64: "c2ln",
      publicKeyPem: "-----BEGIN PUBLIC KEY-----\nx\n-----END PUBLIC KEY-----\n",
    });
    const lock = readPluginLock(vdir);
    expect(lock).toMatchObject({
      lockVersion: 2,
      manifest: "plugin.json",
      sha256: "abc",
      publicKeySha256: "key1",
      signatureVerified: true,
      signatureBase64: "c2ln",
    });
    expect(lock.publicKeyPem).toContain("BEGIN PUBLIC KEY");
  });

  it("returns null when there is no lock", () => {
    expect(readPluginLock(dir)).toBe(null);
  });
});

describe("verifyInstalledSignature", () => {
  /** A plugin whose lock is GENUINE: real signature over the manifest bytes. */
  function makeSignedPlugin(manifestContent, lockOver = {}) {
    const root = path.join(dir, "plug");
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, "plugin.json"), manifestContent, "utf8");
    const mat = signContent(manifestContent);
    const lock = {
      lockVersion: 2,
      manifest: "plugin.json",
      sha256: sha256(Buffer.from(manifestContent)),
      publicKeySha256: mat.publicKeySha256,
      signatureVerified: true,
      signatureBase64: mat.signatureBase64,
      publicKeyPem: mat.publicKeyPem,
      ...lockOver,
    };
    fs.writeFileSync(
      path.join(root, ".plugin-lock.json"),
      JSON.stringify(lock),
      "utf8",
    );
    return { root, mat };
  }

  it("signed:true when the embedded signature verifies over the on-disk manifest", () => {
    const p = makeSignedPlugin('{"name":"a","version":"1.0.0"}');
    const res = verifyInstalledSignature(p);
    expect(res.signed).toBe(true);
    expect(res.publicKeySha256).toBe(p.mat.publicKeySha256);
  });

  it("signed:false when there is no lock", () => {
    const root = path.join(dir, "nolock");
    fs.mkdirSync(root, { recursive: true });
    const res = verifyInstalledSignature({ root });
    expect(res.signed).toBe(false);
    expect(res.reason).toMatch(/no signature lock/);
  });

  it("signed:false when the manifest was tampered after install (sha mismatch)", () => {
    const p = makeSignedPlugin('{"name":"a","version":"1.0.0"}');
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
    const p = makeSignedPlugin('{"x":1}', { signatureVerified: false });
    expect(verifyInstalledSignature(p).signed).toBe(false);
  });

  it("ATTACK: a self-asserted lock with NO signature material is rejected", () => {
    // The pre-fix bypass: `signatureVerified:true` + a matching sha256 are both
    // attacker-writable JSON. Without embedded material there is nothing to
    // cryptographically verify → must count as unsigned.
    const root = path.join(dir, "forged");
    fs.mkdirSync(root, { recursive: true });
    const manifest = '{"name":"evil","version":"1.0.0"}';
    fs.writeFileSync(path.join(root, "plugin.json"), manifest, "utf8");
    fs.writeFileSync(
      path.join(root, ".plugin-lock.json"),
      JSON.stringify({
        lockVersion: 1,
        manifest: "plugin.json",
        sha256: sha256(Buffer.from(manifest)),
        publicKeySha256: "whatever-i-claim",
        signatureVerified: true,
      }),
      "utf8",
    );
    const res = verifyInstalledSignature({ root });
    expect(res.signed).toBe(false);
    expect(res.reason).toMatch(/lacks signature material/);
  });

  it("ATTACK: the trust check uses the COMPUTED fingerprint, not the lock's claim", () => {
    // Attacker self-signs with their own key but writes the ORG'S trusted
    // fingerprint into the lock's publicKeySha256 field. The fingerprint must be
    // recomputed from the embedded key, so the lie is ignored.
    const trustedFp = "f".repeat(64);
    const p = makeSignedPlugin('{"x":1}', { publicKeySha256: trustedFp });
    const res = verifyInstalledSignature(p, {
      trustedKeys: new Set([trustedFp]),
    });
    expect(res.signed).toBe(false);
    expect(res.reason).toMatch(/not trusted/);
    // The reported fingerprint is the attacker's real one, not the claimed one.
    expect(res.reason).toContain(p.mat.publicKeySha256);
  });

  it("ATTACK: a signature that does not verify over the manifest is rejected", () => {
    // Valid-looking material, but the signature was made over DIFFERENT bytes.
    const other = signContent('{"different":"content"}');
    const manifest = '{"name":"evil","version":"1.0.0"}';
    const p = makeSignedPlugin(manifest, {
      signatureBase64: other.signatureBase64,
      publicKeyPem: other.publicKeyPem,
    });
    const res = verifyInstalledSignature(p);
    expect(res.signed).toBe(false);
    expect(res.reason).toMatch(/does not verify/);
  });

  it("signed:false when the lock's public key is garbage", () => {
    const p = makeSignedPlugin('{"x":1}', { publicKeyPem: "not a key" });
    const res = verifyInstalledSignature(p);
    expect(res.signed).toBe(false);
    expect(res.reason).toMatch(/not a valid key/);
  });

  it("signed:false when the lock's manifest path escapes the plugin root (traversal)", () => {
    const secret = path.join(dir, "outside-secret.json");
    fs.writeFileSync(secret, '{"trusted":"looking"}', "utf8");
    const p = makeSignedPlugin('{"x":1}', {
      manifest: "../outside-secret.json",
      sha256: sha256(fs.readFileSync(secret)),
    });
    const res = verifyInstalledSignature(p);
    expect(res.signed).toBe(false);
    expect(res.reason).toMatch(/escapes the plugin root/);
  });

  it("still accepts a legitimate manifest in a subdirectory of the root", () => {
    const root = path.join(dir, "nested");
    fs.mkdirSync(path.join(root, "sub"), { recursive: true });
    const content = '{"name":"n","version":"1.0.0"}';
    fs.writeFileSync(path.join(root, "sub", "plugin.json"), content, "utf8");
    const mat = signContent(content);
    fs.writeFileSync(
      path.join(root, ".plugin-lock.json"),
      JSON.stringify({
        lockVersion: 2,
        manifest: "sub/plugin.json",
        sha256: sha256(Buffer.from(content)),
        publicKeySha256: mat.publicKeySha256,
        signatureVerified: true,
        signatureBase64: mat.signatureBase64,
        publicKeyPem: mat.publicKeyPem,
      }),
      "utf8",
    );
    expect(verifyInstalledSignature({ root }).signed).toBe(true);
  });

  it("enforces a trusted-keys allowlist against the computed fingerprint", () => {
    const p = makeSignedPlugin('{"x":1}');
    const res = verifyInstalledSignature(p, {
      trustedKeys: new Set(["some-other-fp"]),
    });
    expect(res.signed).toBe(false);
    expect(res.reason).toMatch(/not trusted/);
    const ok = verifyInstalledSignature(p, {
      trustedKeys: new Set([p.mat.publicKeySha256]),
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
    const keyFp = sha256(publicKey.export({ type: "spki", format: "der" }));
    return { src, sigFile, keyFile, manifest, keyFp };
  }

  it("records a re-verifiable lock, and requireSignedPlugins keeps signed / drops unsigned", () => {
    // 1) A signed plugin installs and records a lock WITH the material.
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
    expect(lock.signatureBase64).toBeTruthy();
    expect(lock.publicKeyPem).toContain("BEGIN PUBLIC KEY");

    // 2) An UNsigned plugin installs with no lock.
    const unsignedSrc = fs.mkdtempSync(path.join(dir, "unsigned-"));
    fs.writeFileSync(
      path.join(unsignedSrc, "plugin.json"),
      JSON.stringify({ name: "unsigned-one", version: "1.0.0" }),
      "utf8",
    );
    installFromDirectory(unsignedSrc, { scope: "local", cwd });

    // 3) Under requireSignedPlugins + pinned key, only the signed one survives.
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
      {
        requireSignedPlugins: true,
        trustedPluginKeySha256: [signed.keyFp],
      },
    );
    expect(kept.map((p) => p.name)).toEqual(["signed-one"]);
    expect(dropped.map((d) => d.name)).toEqual(["unsigned-one"]);
    expect(dropped[0].reason).toMatch(/requireSignedPlugins/);
  });

  it("records an SBOM and rejects tampered component files", () => {
    const signed = makeSignedSource("sbom-plugin", "1.0.0");
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const manifestBytes = Buffer.from(signed.manifest);
    fs.writeFileSync(signed.sigFile, edSign(null, manifestBytes, privateKey));
    fs.writeFileSync(
      signed.keyFile,
      publicKey.export({ type: "spki", format: "pem" }),
      "utf8",
    );
    const cwd = path.join(dir, "cwd-sbom");
    const installed = installFromDirectory(signed.src, {
      scope: "local",
      cwd,
      signature: {
        signatureFile: signed.sigFile,
        publicKeyFile: signed.keyFile,
        requireSignature: true,
      },
    });
    const lock = readPluginLock(installed.dir);
    expect(lock.sbom?.version).toBe(1);
    expect(verifyInstalledSignature({ root: installed.dir }, {
      trustedKeys: new Set([lock.publicKeySha256]),
    }).signed).toBe(true);

    fs.writeFileSync(path.join(installed.dir, "tampered.js"), "malicious", "utf8");
    expect(verifyInstalledSignature({ root: installed.dir }, {
      trustedKeys: new Set([lock.publicKeySha256]),
    })).toMatchObject({ signed: false, reason: "plugin component SBOM mismatch" });
  });

  it("FAIL-CLOSED: requireSignedPlugins with NO pinned keys drops everything", () => {
    // "Signed by anyone" is meaningless — a drop-in plugin can self-sign its own
    // lock. Without trustedPluginKeySha256 the gate must reject, not accept.
    const signed = makeSignedSource("self-signed", "1.0.0");
    installFromDirectory(signed.src, {
      scope: "local",
      cwd,
      signature: {
        signatureFile: signed.sigFile,
        publicKeyFile: signed.keyFile,
        requireSignature: true,
      },
    });
    const plugin = {
      name: "self-signed",
      root: pluginVersionDir("local", "self-signed", "1.0.0", { cwd }),
    };
    const { kept, dropped } = filterByManagedPolicy([plugin], {
      requireSignedPlugins: true,
    });
    expect(kept).toEqual([]);
    expect(dropped[0].reason).toMatch(/no trustedPluginKeySha256/);
  });

  it("ATTACK: an unsigned install strips a forged lock shipped inside the source", () => {
    // The source dir ships its own hand-written .plugin-lock.json claiming
    // signatureVerified:true. copyDirGuarded copies dotfiles, so without the
    // strip the forged lock would land in the "immutable" version dir.
    const src = fs.mkdtempSync(path.join(dir, "forged-src-"));
    const manifest = JSON.stringify({ name: "forged-lock", version: "1.0.0" });
    fs.writeFileSync(path.join(src, "plugin.json"), manifest, "utf8");
    fs.writeFileSync(
      path.join(src, ".plugin-lock.json"),
      JSON.stringify({
        lockVersion: 1,
        manifest: "plugin.json",
        sha256: sha256(Buffer.from(manifest)),
        publicKeySha256: "forged",
        signatureVerified: true,
      }),
      "utf8",
    );
    installFromDirectory(src, { scope: "local", cwd });
    const vdir = pluginVersionDir("local", "forged-lock", "1.0.0", { cwd });
    expect(fs.existsSync(path.join(vdir, ".plugin-lock.json"))).toBe(false);
    expect(readPluginLock(vdir)).toBe(null);
  });

  it("a signed install that fails verification does NOT land on disk (fail-closed)", () => {
    const signed = makeSignedSource("bad-sig", "1.0.0");
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
