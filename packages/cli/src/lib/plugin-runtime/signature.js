/**
 * Plugin signature lock (Phase 3.3l — `requireSignedPlugins` load enforcement).
 *
 * `verifyPluginManifest` (../plugin-security.js) verifies a plugin manifest's
 * SHA-256 + detached Ed25519 signature, but only at the moment of `cc plugin
 * add/validate`. To enforce signing at LOAD time (an org's requireSignedPlugins),
 * install records the verification result in a `.plugin-lock.json` inside the
 * immutable version dir; discovery then re-checks it fail-closed.
 *
 * The lock records the manifest's sha256 + the signing key's fingerprint. At
 * load we RE-HASH the on-disk manifest and compare — so a manifest tampered with
 * after install (even inside the version dir) fails the check. The signature
 * itself covers only the manifest file, not every component file — that is a
 * known limitation (documented), an integrity anchor rather than a full
 * supply-chain seal; the immutable version dir + this re-hash catch manifest
 * tampering, which is where the component wiring is declared.
 */

import { createHash } from "node:crypto";
import fs from "fs";
import path from "path";

const LOCK = ".plugin-lock.json";

export const _deps = {
  readFileSync: fs.readFileSync,
  writeFileSync: fs.writeFileSync,
  existsSync: fs.existsSync,
};

/** Record a verified signature into the version dir. */
export function writePluginLock(
  versionDir,
  { manifestFile, sha256, publicKeySha256, signatureVerified },
) {
  const rel = path.relative(versionDir, manifestFile).replace(/\\/g, "/");
  const lock = {
    lockVersion: 1,
    manifest: rel || "plugin.json",
    sha256,
    publicKeySha256: publicKeySha256 || null,
    signatureVerified: signatureVerified === true,
  };
  _deps.writeFileSync(
    path.join(versionDir, LOCK),
    JSON.stringify(lock, null, 2),
    "utf8",
  );
  return lock;
}

/** Read a version dir's signature lock, or null when absent/unreadable. */
export function readPluginLock(versionDir) {
  const p = path.join(versionDir, LOCK);
  if (!_deps.existsSync(p)) return null;
  try {
    return JSON.parse(_deps.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Verify an installed plugin's recorded signature against its on-disk manifest.
 * `signed:true` ONLY when a lock exists, was signature-verified, the manifest
 * still hashes to the locked sha256 (tamper detection), and — when trustedKeys
 * is a non-empty Set — the signing key fingerprint is among them.
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
  let sha;
  try {
    sha = createHash("sha256")
      .update(_deps.readFileSync(manifestFile))
      .digest("hex");
  } catch {
    return { signed: false, reason: "manifest unreadable" };
  }
  if (sha.toLowerCase() !== String(lock.sha256 || "").toLowerCase()) {
    return {
      signed: false,
      reason: "manifest tampered since install (sha256 mismatch)",
    };
  }
  const trustedKeys = opts.trustedKeys;
  if (trustedKeys && trustedKeys.size > 0) {
    if (!lock.publicKeySha256 || !trustedKeys.has(lock.publicKeySha256)) {
      return {
        signed: false,
        reason: `signing key not trusted (${lock.publicKeySha256 || "unsigned"})`,
      };
    }
  }
  return { signed: true, publicKeySha256: lock.publicKeySha256 };
}
