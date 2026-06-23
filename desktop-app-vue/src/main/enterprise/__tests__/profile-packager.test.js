/**
 * Unit coverage for the .ccprofile packager (enterprise/profile-packager.js).
 *
 * Covers the deterministic pack → load → extract round-trip, ed25519 signature
 * verification (including tamper + trusted-key whitelist), and — the reason this
 * file was added — the zip-slip / path-traversal guards in extractPluginsTo()
 * that wire the previously-dead isWithin() helper.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "os";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require("fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("path");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const packager = require("../profile-packager.js");

const { pack, loadProfile, extractPluginsTo, generateSignerKeyPair } = packager;

let workDir;

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Write a minimal valid plugin directory (plugin.json + one file). */
function writePlugin(dir, id, version, extraFiles = {}) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "plugin.json"),
    JSON.stringify({ id, version }),
    "utf-8",
  );
  fs.writeFileSync(path.join(dir, "index.js"), `// plugin ${id}\n`, "utf-8");
  for (const [rel, content] of Object.entries(extraFiles)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, "utf-8");
  }
}

async function buildProfile(plugins, overrides = {}) {
  const { publicKey, privateKey } = generateSignerKeyPair();
  const outPath = path.join(workDir, `profile-${Date.now()}.ccprofile`);
  await pack(
    {
      id: "acme",
      name: "Acme",
      version: "1.0.0",
      signer: "did:cc:acme",
      privateKeyPem: privateKey,
      publicKeyPem: publicKey,
      plugins,
      ...overrides,
    },
    outPath,
  );
  return { outPath, publicKey, privateKey };
}

describe("profile-packager", () => {
  beforeEach(() => {
    workDir = mkTmp("ccprofile-test-");
  });
  afterEach(() => {
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });

  describe("pack() + loadProfile() round-trip", () => {
    it("packs and verifies a signed profile, preserving file contents", async () => {
      const pluginDir = path.join(workDir, "plug-a");
      writePlugin(pluginDir, "plug-a", "2.3.4", {
        "nested/data.txt": "hello",
      });

      const { outPath } = await buildProfile([
        { id: "plug-a", version: "2.3.4", dir: pluginDir },
      ]);

      const loaded = await loadProfile(outPath);
      expect(loaded.manifest.id).toBe("acme");
      expect(loaded.manifest.plugins[0].id).toBe("plug-a");
      expect(loaded.trusted).toBe(true);
      expect(loaded.plugins["plug-a"].files["nested/data.txt"].toString()).toBe(
        "hello",
      );
    });

    it("rejects a profile whose manifest was tampered after signing", async () => {
      const pluginDir = path.join(workDir, "plug-b");
      writePlugin(pluginDir, "plug-b", "1.0.0");
      const { outPath } = await buildProfile([
        { id: "plug-b", version: "1.0.0", dir: pluginDir },
      ]);

      const obj = JSON.parse(fs.readFileSync(outPath, "utf-8"));
      obj.manifest.name = "Evil Corp"; // mutate signed field
      fs.writeFileSync(outPath, JSON.stringify(obj, null, 2), "utf-8");

      await expect(loadProfile(outPath)).rejects.toThrow(
        /signature verification failed/,
      );
    });

    it("rejects a profile whose plugin payload bytes were swapped (hash mismatch)", async () => {
      const pluginDir = path.join(workDir, "plug-c");
      writePlugin(pluginDir, "plug-c", "1.0.0");
      const { outPath } = await buildProfile([
        { id: "plug-c", version: "1.0.0", dir: pluginDir },
      ]);

      const obj = JSON.parse(fs.readFileSync(outPath, "utf-8"));
      const files = obj.payload.plugins["plug-c"].files;
      const firstKey = Object.keys(files)[0];
      files[firstKey] = Buffer.from("tampered").toString("base64");
      // Re-sign the manifest so the signature passes but the hash won't.
      fs.writeFileSync(outPath, JSON.stringify(obj, null, 2), "utf-8");

      await expect(loadProfile(outPath)).rejects.toThrow(/hash mismatch/);
    });

    it("enforces the trusted public-key whitelist", async () => {
      const pluginDir = path.join(workDir, "plug-d");
      writePlugin(pluginDir, "plug-d", "1.0.0");
      const { outPath, publicKey } = await buildProfile([
        { id: "plug-d", version: "1.0.0", dir: pluginDir },
      ]);

      // Correct key (PEM) → trusted.
      const ok = await loadProfile(outPath, {
        trustedPublicKeys: [publicKey],
      });
      expect(ok.trusted).toBe(true);

      // A different key → rejected.
      const other = generateSignerKeyPair();
      await expect(
        loadProfile(outPath, { trustedPublicKeys: [other.publicKey] }),
      ).rejects.toThrow(/not in the trusted/);
    });
  });

  describe("extractPluginsTo() — zip-slip guards", () => {
    it("extracts a clean plugin tree to disk", async () => {
      const target = path.join(workDir, "out");
      const written = extractPluginsTo(
        {
          "plug-a": {
            manifest: {},
            files: {
              "index.js": Buffer.from("x"),
              "sub/data.txt": Buffer.from("y"),
            },
          },
        },
        target,
      );
      expect(written).toHaveLength(1);
      expect(
        fs.readFileSync(
          path.join(target, "plug-a", "sub", "data.txt"),
          "utf-8",
        ),
      ).toBe("y");
    });

    it("rejects a plugin id that escapes the target dir", () => {
      const target = path.join(workDir, "out");
      expect(() =>
        extractPluginsTo(
          {
            "../../evil": {
              manifest: {},
              files: { "a.txt": Buffer.from("x") },
            },
          },
          target,
        ),
      ).toThrow(/path traversal/);
    });

    it("rejects a relpath that escapes the plugin dir", () => {
      const target = path.join(workDir, "out");
      expect(() =>
        extractPluginsTo(
          {
            "plug-x": {
              manifest: {},
              files: { "../../../etc/evil": Buffer.from("x") },
            },
          },
          target,
        ),
      ).toThrow(/path traversal/);
    });

    it("does not write the malicious file outside the target", () => {
      const target = path.join(workDir, "out");
      const escapeProbe = path.join(workDir, "etc", "evil");
      try {
        extractPluginsTo(
          {
            "plug-y": {
              manifest: {},
              files: { "../../etc/evil": Buffer.from("x") },
            },
          },
          target,
        );
      } catch {
        /* expected */
      }
      expect(fs.existsSync(escapeProbe)).toBe(false);
    });
  });
});
