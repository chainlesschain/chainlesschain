/**
 * Plugin signature lock (Phase 3.3l — `requireSignedPlugins` load enforcement).
 *
 * `verifyPluginManifest` (../plugin-security.js) verifies a plugin manifest's
 * SHA-256 + detached Ed25519 signature, but only at the moment of `cc plugin
 * add/validate`. To enforce signing at LOAD time (an org's requireSignedPlugins),
 * install records the verification result in a `.plugin-lock.json` inside the
 * immutable version dir; discovery then re-checks it fail-closed.
 *
 * The lock persists the DETACHED SIGNATURE + PUBLIC KEY themselves (lockVersion
 * 2), and load-time verification re-runs the actual Ed25519 verify over the
 * on-disk manifest bytes. The lock file lives in a writable plugin dir, so
 * nothing in it can be TRUSTED — a recorded boolean or fingerprint could simply
 * be forged by whoever authored the plugin. What a forger CANNOT do is produce a
 * signature that verifies under a key the org has pinned via
 * trustedPluginKeySha256 — which is why the key fingerprint used for the trust
 * check is COMPUTED from the embedded public key, never read from the lock.
 * The signature covers only the manifest file, not every component file — a
 * known limitation (documented), an integrity anchor rather than a full
 * supply-chain seal; the manifest is where the component wiring is declared.
 */

import { createHash, createPublicKey, verify } from "node:crypto";
import fs from "fs";
import path from "path";

export const LOCK_FILENAME = ".plugin-lock.json";

export const _deps = {
  readFileSync: fs.readFileSync,
  writeFileSync: fs.writeFileSync,
  existsSync: fs.existsSync,
  readdirSync: fs.readdirSync,
  statSync: fs.statSync,
};

/** Build a deterministic file-level SBOM for an installed plugin directory. */
export function buildPluginSbom(root) {
  const files = [];
  const walk = (dir) => {
    for (const entry of _deps.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      const rel = path.relative(root, abs).replace(/\\/g, "/");
      if (rel === LOCK_FILENAME) continue;
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile()) {
        const bytes = _deps.readFileSync(abs);
        files.push({
          path: rel,
          bytes: bytes.length,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        });
      }
    }
  };
  walk(path.resolve(root));
  files.sort((a, b) => a.path.localeCompare(b.path));
  const digest = createHash("sha256")
    .update(files.map((file) => `${file.path}\0${file.sha256}\n`).join(""))
    .digest("hex");
  return { version: 1, digest, files };
}

/** Record a verified signature into the version dir. */
export function writePluginLock(
  versionDir,
  {
    manifestFile,
    sha256,
    publicKeySha256,
    signatureVerified,
    signatureBase64,
    publicKeyPem,
    sbom = null,
  },
) {
  const rel = path.relative(versionDir, manifestFile).replace(/\\/g, "/");
  const lock = {
    lockVersion: 2,
    manifest: rel || "plugin.json",
    sha256,
    publicKeySha256: publicKeySha256 || null,
    signatureVerified: signatureVerified === true,
    // The material load-time enforcement actually re-verifies. Without these a
    // lock is just self-asserted JSON and counts as unsigned.
    signatureBase64: signatureBase64 || null,
    publicKeyPem: publicKeyPem || null,
    ...(sbom ? { sbom } : {}),
  };
  _deps.writeFileSync(
    path.join(versionDir, LOCK_FILENAME),
    JSON.stringify(lock, null, 2),
    "utf8",
  );
  return lock;
}

/** Read a version dir's signature lock, or null when absent/unreadable. */
export function readPluginLock(versionDir) {
  const p = path.join(versionDir, LOCK_FILENAME);
  if (!_deps.existsSync(p)) return null;
  try {
    return JSON.parse(_deps.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Verify an installed plugin's recorded signature against its on-disk manifest.
 * `signed:true` ONLY when a lock exists, carries real signature material, the
 * embedded Ed25519 signature VERIFIES over the on-disk manifest bytes, and —
 * when trustedKeys is a non-empty Set — the signing key's COMPUTED fingerprint
 * is among them. Every field of the lock is treated as attacker-writable; the
 * only trust anchors are the cryptographic verify and the caller's trustedKeys.
 *
 * @param {{root:string}} plugin
 * @param {object} [opts] { trustedKeys?: Set<string> }
 * @returns {{ signed:boolean, reason?:string, publicKeySha256?:string }}
 */
export function verifyInstalledSignature(plugin, opts = {}) {
  const lock = readPluginLock(plugin.root);
  if (!lock) return { signed: false, reason: "no signature lock" };
  if (lock.signatureVerified !== true) {
    return { signed: false, reason: "lock is not signature-verified" };
  }
  const manifestFile = path.join(plugin.root, lock.manifest || "plugin.json");
  // `lock.manifest` is untrusted — it lives in the (writable) plugin dir. A lock
  // pointing OUTSIDE the plugin root (`manifest: "../../secret"`) would make us
  // re-hash an arbitrary file and, with a matching locked sha256, forge
  // signed:true — which gates load-time requireSignedPlugins. A plugin's manifest
  // is ALWAYS inside its own root, so reject any path that escapes it (boundary
  // via path.relative, not startsWith — the sandbox-fs-policy pattern).
  const rel = path.relative(
    path.resolve(plugin.root),
    path.resolve(manifestFile),
  );
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    return {
      signed: false,
      reason: "lock manifest path escapes the plugin root",
    };
  }
  if (!_deps.existsSync(manifestFile)) {
    return { signed: false, reason: "locked manifest file is missing" };
  }
  let bytes;
  try {
    bytes = _deps.readFileSync(manifestFile);
  } catch {
    return { signed: false, reason: "manifest unreadable" };
  }
  const sha = createHash("sha256").update(bytes).digest("hex");
  if (sha.toLowerCase() !== String(lock.sha256 || "").toLowerCase()) {
    return {
      signed: false,
      reason: "manifest tampered since install (sha256 mismatch)",
    };
  }
  // A lock without real signature material is unverifiable, and therefore
  // worthless as a signing gate: `signatureVerified:true` is just a JSON field
  // anyone can write. Legacy (lockVersion 1) locks land here too — reinstalling
  // the plugin with --signature re-records a verifiable lock.
  if (!lock.signatureBase64 || !lock.publicKeyPem) {
    return {
      signed: false,
      reason:
        "lock lacks signature material (legacy or hand-written lock — " +
        "reinstall the plugin with --signature to re-record it)",
    };
  }
  let keyObject;
  let publicKeySha256;
  try {
    keyObject = createPublicKey(lock.publicKeyPem);
    // Fingerprint is COMPUTED from the embedded key — the lock's own
    // publicKeySha256 field is attacker-writable and never used for trust.
    publicKeySha256 = createHash("sha256")
      .update(keyObject.export({ type: "spki", format: "der" }))
      .digest("hex");
  } catch {
    return { signed: false, reason: "lock public key is not a valid key" };
  }
  let sigOk = false;
  try {
    sigOk = verify(
      null,
      bytes,
      keyObject,
      Buffer.from(String(lock.signatureBase64), "base64"),
    );
  } catch {
    sigOk = false;
  }
  if (!sigOk) {
    return {
      signed: false,
      reason: "recorded signature does not verify over the on-disk manifest",
    };
  }
  if (lock.sbom) {
    let actualSbom;
    try {
      actualSbom = buildPluginSbom(plugin.root);
    } catch {
      return { signed: false, reason: "plugin SBOM cannot be read" };
    }
    if (
      actualSbom.digest !== lock.sbom.digest ||
      JSON.stringify(actualSbom.files) !== JSON.stringify(lock.sbom.files)
    ) {
      return { signed: false, reason: "plugin component SBOM mismatch" };
    }
  }
  const trustedKeys = opts.trustedKeys;
  if (trustedKeys && trustedKeys.size > 0) {
    if (!trustedKeys.has(publicKeySha256)) {
      return {
        signed: false,
        reason: `signing key not trusted (${publicKeySha256})`,
      };
    }
  }
  return { signed: true, publicKeySha256 };
}
