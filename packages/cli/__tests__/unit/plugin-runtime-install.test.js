import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  installFromDirectory as installFromDirectoryImpl,
  installFromSource as installFromSourceImpl,
  updatePlugin as updatePluginImpl,
  finalizePluginUpdate,
  rollbackPluginUpdate,
  listInstalled,
  listInstalledAllScopes,
  migratePluginProvenance,
  planPluginProvenanceMigration,
  readSourceMetadataStrict,
  uninstall,
  setActiveVersion,
  setPluginEnabled,
  isPluginEnabled,
  getActiveVersion,
  MAX_LISTED_PLUGIN_VERSIONS,
  parseGitSource,
  _deps as installDeps,
} from "../../src/lib/plugin-runtime/install.js";
import { execSync } from "node:child_process";
import {
  discoverPlugins,
  listInstalledVersions,
  pluginVersionDir,
} from "../../src/lib/plugin-runtime/scopes.js";
import {
  PLUGIN_MARKETPLACE_CANONICAL_PAYLOAD_SBOM_SCHEMA,
  PLUGIN_MARKETPLACE_PAYLOAD_SBOM_SCHEMA,
  buildMarketplacePayloadSbom,
  buildRemoteSbomPayloadComparison,
} from "../../src/lib/plugin-runtime/marketplace-artifact-readback.js";
import {
  _deps as remoteSourceDeps,
  resolveRemoteSource,
} from "../../src/lib/plugin-runtime/remote-source.js";
import { _resetPluginManagedPolicyCache } from "../../src/lib/plugin-security.js";

let cwd; // acts as the project root for project/local scopes
let srcRoot; // where source plugin fixtures live
let originalRemoteSourceDeps;
let registryFixtureAuthorities;

// Most lifecycle fixtures use separate temp directories to represent versions
// of one already-reviewed source. Make that approval explicit so individual
// tests can focus on the invariant named in their title. Tests of API defaults
// call the *Impl imports directly.
function installFromDirectory(source, opts = {}) {
  if (opts.sourceMetadata?.type === "registry") {
    return installRegistryFixture(source, opts, installFromSourceImpl);
  }
  return installFromDirectoryImpl(source, {
    allowSourceSwitch: true,
    allowDowngrade: true,
    ...opts,
  });
}

function installFromSource(source, opts = {}) {
  if (opts.sourceMetadata?.type === "registry") {
    return installRegistryFixture(source, opts, installFromSourceImpl);
  }
  return installFromSourceImpl(source, {
    allowSourceSwitch: true,
    allowDowngrade: true,
    ...opts,
  });
}

function installRegistryFixture(localSource, opts, implementation) {
  const registryUrl =
    opts.sourceMetadata.registry || opts.sourceMetadata.source;
  const resolution = registryFixtureAuthorities.get(registryUrl);
  if (!resolution)
    throw new Error(`missing registry fixture for ${registryUrl}`);
  const originalSpawnSync = installDeps.spawnSync;
  installDeps.spawnSync = (_executable, args) => {
    const destination = args.at(-1);
    fs.cpSync(localSource, destination, { recursive: true });
    return { status: 0, stdout: "", stderr: "" };
  };
  try {
    return implementation(resolution.source, {
      allowSourceSwitch: true,
      allowDowngrade: true,
      ...opts,
      sourceMetadata: {
        ...opts.sourceMetadata,
        source: registryUrl,
        registry: registryUrl,
        resolvedSource: resolution.source,
        ref: resolution.ref,
      },
      registryResolutionAuthority: resolution.registryResolutionAuthority,
    });
  } finally {
    installDeps.spawnSync = originalSpawnSync;
  }
}

function updatePlugin(source, opts = {}) {
  if (opts.sourceMetadata?.type === "registry") {
    return installRegistryFixture(source, opts, updatePluginImpl);
  }
  return updatePluginImpl(source, {
    allowSourceSwitch: true,
    allowDowngrade: true,
    ...opts,
  });
}

function makeSource(name, version, { withSkill = true, extra = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(srcRoot, `${name}-`));
  fs.writeFileSync(
    path.join(dir, "plugin.json"),
    JSON.stringify({ name, version, ...extra }),
    "utf8",
  );
  if (withSkill) {
    const s = path.join(dir, "skills", "hello");
    fs.mkdirSync(s, { recursive: true });
    fs.writeFileSync(
      path.join(s, "SKILL.md"),
      "---\nname: hello\n---\nhi",
      "utf8",
    );
  }
  return dir;
}

function signProvenancePlan(plan) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" });
  const signerPublicKeySha256 = crypto
    .createHash("sha256")
    .update(publicKey.export({ type: "spki", format: "der" }))
    .digest("hex");
  const signatureBase64 = crypto
    .sign(null, Buffer.from(plan.signingPayloadBase64, "base64"), privateKey)
    .toString("base64");
  return {
    attestation: {
      authority: plan.authority,
      publicKeyPem,
      signatureBase64,
    },
    signerPublicKeySha256,
  };
}

function canonicalJson(value) {
  if (value == null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

function remoteSbomEvidence({
  registryOrigin = "https://registry.example",
  url = "https://registry.example/plugin.cdx.json",
  format = "cyclonedx-json",
  digest = "e".repeat(64),
  bytes = 128,
} = {}) {
  const authority = {
    schemaVersion: "cc-plugin-marketplace-remote-artifact-evidence/v1",
    status: "verified",
    registryOrigin,
    signature: null,
    sbom: {
      status: "digest-verified",
      url,
      format,
      expectedDocumentSha256: digest,
      documentSha256: digest,
      bytes,
      fromCache: false,
    },
    claims: {
      publisherIdentityVerified: false,
      signatureBytesFetched: false,
      publicKeyFingerprintVerified: false,
      manifestSignatureVerified: false,
      sbomDocumentDigestVerified: true,
      sbomPayloadCompared: false,
    },
  };
  return {
    ...authority,
    evidenceDigest: crypto
      .createHash("sha256")
      .update(canonicalJson(authority))
      .digest("hex"),
  };
}

function semanticSourceMetadata(
  src,
  name,
  format = PLUGIN_MARKETPLACE_CANONICAL_PAYLOAD_SBOM_SCHEMA,
) {
  const payload = buildMarketplacePayloadSbom(src, {
    schemaVersion: format,
  });
  const bytes = Buffer.from(JSON.stringify(payload));
  const documentSha256 = crypto
    .createHash("sha256")
    .update(bytes)
    .digest("hex");
  const artifactUrl = "https://registry.example/plugin.sbom.json";
  return {
    bytes,
    metadata: {
      type: "registry",
      source: "https://registry.example/index.json",
      registry: "https://registry.example/index.json",
      package: name,
      catalogAuthority: {
        catalogDigest: "a".repeat(64),
        candidateId: `candidate-${"b".repeat(20)}`,
        candidateDigest: "c".repeat(64),
        governanceStatus: "complete",
        registryStatus: "online",
        versionAuthority: "registry-declared-unverified",
        artifactExpectations: {
          sbom: {
            status: "declared",
            format,
            payloadSha256: payload.digest,
            url: artifactUrl,
            documentSha256,
          },
        },
        remoteArtifactEvidence: remoteSbomEvidence({
          format,
          digest: documentSha256,
          bytes: bytes.length,
          url: artifactUrl,
        }),
      },
    },
  };
}

beforeEach(async () => {
  _resetPluginManagedPolicyCache();
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cc-inst-cwd-"));
  srcRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cc-inst-src-"));
  originalRemoteSourceDeps = { ...remoteSourceDeps };
  registryFixtureAuthorities = new Map();
  remoteSourceDeps.fetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () =>
      JSON.stringify({
        plugins: [
          {
            name: "fixture",
            source: "https://fixtures.invalid/plugin-source.git",
          },
        ],
      }),
  });
  for (const registryUrl of [
    "https://registry.example/index.json",
    "https://registry.example/index.json?token=secret",
  ]) {
    registryFixtureAuthorities.set(
      registryUrl,
      await resolveRemoteSource(registryUrl, {
        allowCache: false,
        managedPolicy: null,
      }),
    );
  }
});
afterEach(() => {
  _resetPluginManagedPolicyCache();
  Object.assign(remoteSourceDeps, originalRemoteSourceDeps);
  for (const d of [cwd, srcRoot]) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
});

describe("installFromDirectory", () => {
  it("copies a valid plugin into the scope version dir and marks it active", () => {
    const src = makeSource("greeter", "1.0.0");
    const res = installFromDirectory(src, { scope: "project", cwd });
    expect(res).toMatchObject({
      name: "greeter",
      version: "1.0.0",
      scope: "project",
    });
    const dest = pluginVersionDir("project", "greeter", "1.0.0", { cwd });
    expect(fs.existsSync(path.join(dest, "plugin.json"))).toBe(true);
    expect(fs.existsSync(path.join(dest, "skills", "hello", "SKILL.md"))).toBe(
      true,
    );
    expect(getActiveVersion("greeter", { scope: "project", cwd })).toBe(
      "1.0.0",
    );
  });

  it("refuses to overwrite an immutable version without force", () => {
    const src = makeSource("greeter", "1.0.0");
    installFromDirectory(src, { scope: "project", cwd });
    expect(() => installFromDirectory(src, { scope: "project", cwd })).toThrow(
      /already installed.*immutable/,
    );
  });

  it("reinstalls with force", () => {
    const src = makeSource("greeter", "1.0.0");
    installFromDirectory(src, { scope: "project", cwd });
    const res = installFromDirectory(src, {
      scope: "project",
      cwd,
      force: true,
    });
    expect(res.version).toBe("1.0.0");
  });

  it("keeps the active bytes intact when a forced reinstall copy fails", () => {
    const original = makeSource("greeter", "1.0.0");
    fs.writeFileSync(
      path.join(original, "skills", "hello", "SKILL.md"),
      "original",
    );
    installFromDirectory(original, { scope: "project", cwd });
    const replacement = makeSource("greeter", "1.0.0");
    fs.writeFileSync(
      path.join(replacement, "skills", "hello", "SKILL.md"),
      "replacement",
    );
    const copyFileSync = installDeps.copyFileSync;
    installDeps.copyFileSync = (from, to) => {
      if (from.endsWith("SKILL.md")) throw new Error("injected copy failure");
      return copyFileSync(from, to);
    };
    try {
      expect(() =>
        installFromDirectory(replacement, {
          scope: "project",
          cwd,
          force: true,
        }),
      ).toThrow(/injected copy failure/);
    } finally {
      installDeps.copyFileSync = copyFileSync;
    }

    const dest = pluginVersionDir("project", "greeter", "1.0.0", { cwd });
    expect(
      fs.readFileSync(path.join(dest, "skills", "hello", "SKILL.md"), "utf8"),
    ).toBe("original");
    expect(getActiveVersion("greeter", { scope: "project", cwd })).toBe(
      "1.0.0",
    );
  });

  it("retains predecessor recovery bytes when commit and restore both fail", () => {
    const original = makeSource("recovery-guard", "1.0.0");
    fs.writeFileSync(
      path.join(original, "skills", "hello", "SKILL.md"),
      "original",
    );
    const installed = installFromDirectory(original, {
      scope: "project",
      cwd,
    });
    const replacement = makeSource("recovery-guard", "1.0.0");
    fs.writeFileSync(
      path.join(replacement, "skills", "hello", "SKILL.md"),
      "replacement",
    );

    const originalRenameSync = installDeps.renameSync;
    installDeps.renameSync = (from, to) => {
      if (
        path.resolve(to) === path.resolve(installed.dir) &&
        ["staged", "previous"].includes(path.basename(from))
      ) {
        throw new Error(`injected ${path.basename(from)} rename failure`);
      }
      return originalRenameSync(from, to);
    };
    try {
      expect(() =>
        installFromDirectory(replacement, {
          scope: "project",
          cwd,
          force: true,
        }),
      ).toThrow(/retained recovery state/);
    } finally {
      installDeps.renameSync = originalRenameSync;
    }

    const nameDir = path.dirname(installed.dir);
    const recoveryRoots = fs
      .readdirSync(nameDir)
      .filter((entry) => entry.startsWith(".install-"));
    expect(recoveryRoots).toHaveLength(1);
    expect(
      fs.readFileSync(
        path.join(
          nameDir,
          recoveryRoots[0],
          "previous",
          "skills",
          "hello",
          "SKILL.md",
        ),
        "utf8",
      ),
    ).toBe("original");
    expect(fs.existsSync(installed.dir)).toBe(false);
    expect(getActiveVersion("recovery-guard", { scope: "project", cwd })).toBe(
      null,
    );
    expect(listInstalled({ cwd, scopes: ["project"] })).toEqual([
      expect.objectContaining({
        name: "recovery-guard",
        runtimeBlocked: true,
        activePointer: expect.objectContaining({
          status: "recovery-required",
          inspectionVersion: "1.0.0",
          recoveryPath: expect.stringContaining("previous"),
        }),
      }),
    ]);
  });

  it("keeps rejected replacement bytes inactive when activation recovery fails", () => {
    const original = makeSource("activation-recovery", "1.0.0");
    fs.writeFileSync(
      path.join(original, "skills", "hello", "SKILL.md"),
      "original",
    );
    const installed = installFromDirectory(original, {
      scope: "project",
      cwd,
    });
    const replacement = makeSource("activation-recovery", "1.0.0");
    fs.writeFileSync(
      path.join(replacement, "skills", "hello", "SKILL.md"),
      "replacement",
    );

    const originalRenameSync = installDeps.renameSync;
    installDeps.renameSync = (from, to) => {
      if (path.basename(from) === "next" && path.basename(to) === ".active") {
        throw new Error("injected active pointer failure");
      }
      if (
        path.basename(from) === "previous" &&
        path.resolve(to) === path.resolve(installed.dir)
      ) {
        throw new Error("injected predecessor restore failure");
      }
      return originalRenameSync(from, to);
    };
    try {
      expect(() =>
        installFromDirectory(replacement, {
          scope: "project",
          cwd,
          force: true,
        }),
      ).toThrow(/retained recovery state/);
    } finally {
      installDeps.renameSync = originalRenameSync;
    }

    const nameDir = path.dirname(installed.dir);
    const transactionRoot = path.join(
      nameDir,
      fs.readdirSync(nameDir).find((entry) => entry.startsWith(".install-")),
    );
    expect(fs.existsSync(installed.dir)).toBe(false);
    expect(
      fs.readFileSync(
        path.join(transactionRoot, "previous", "skills", "hello", "SKILL.md"),
        "utf8",
      ),
    ).toBe("original");
    expect(
      fs.readFileSync(
        path.join(transactionRoot, "rejected", "skills", "hello", "SKILL.md"),
        "utf8",
      ),
    ).toBe("replacement");
    expect(
      discoverPlugins({ cwd, scopes: ["project"], skipPolicy: true }),
    ).toEqual([]);
    expect(listInstalled({ cwd, scopes: ["project"] })[0]).toMatchObject({
      name: "activation-recovery",
      runtimeBlocked: true,
      activePointer: { status: "recovery-required" },
    });
  });

  it("fail-closes a candidate quarantine failure and blocks later mutation", () => {
    const original = makeSource("quarantine-recovery", "2.0.0");
    fs.writeFileSync(
      path.join(original, "skills", "hello", "SKILL.md"),
      "original",
    );
    const installed = installFromDirectory(original, {
      scope: "project",
      cwd,
    });
    const replacement = makeSource("quarantine-recovery", "2.0.0");
    fs.writeFileSync(
      path.join(replacement, "skills", "hello", "SKILL.md"),
      "replacement",
    );

    const originalRenameSync = installDeps.renameSync;
    installDeps.renameSync = (from, to) => {
      if (path.basename(from) === "next" && path.basename(to) === ".active") {
        throw new Error("injected active pointer failure");
      }
      if (
        path.resolve(from) === path.resolve(installed.dir) &&
        path.basename(to) === "rejected"
      ) {
        throw new Error("injected candidate quarantine failure");
      }
      return originalRenameSync(from, to);
    };
    try {
      expect(() =>
        installFromDirectory(replacement, {
          scope: "project",
          cwd,
          force: true,
        }),
      ).toThrow(/retained recovery state/);
    } finally {
      installDeps.renameSync = originalRenameSync;
    }

    expect(
      fs.readFileSync(
        path.join(installed.dir, "skills", "hello", "SKILL.md"),
        "utf8",
      ),
    ).toBe("replacement");
    expect(
      getActiveVersion("quarantine-recovery", { scope: "project", cwd }),
    ).toBe(null);
    const blocked = listInstalled({ cwd, scopes: ["project"] })[0];
    expect(blocked).toMatchObject({
      name: "quarantine-recovery",
      runtimeBlocked: true,
      activePointer: {
        status: "recovery-required",
        recoveryPath: expect.stringContaining("previous"),
      },
    });
    expect(
      fs.readFileSync(
        path.join(
          blocked.activePointer.recoveryPath,
          "skills",
          "hello",
          "SKILL.md",
        ),
        "utf8",
      ),
    ).toBe("original");

    const downgrade = makeSource("quarantine-recovery", "1.0.0");
    expect(() =>
      installFromDirectoryImpl(downgrade, {
        scope: "project",
        cwd,
        allowSourceSwitch: true,
        allowDowngrade: true,
      }),
    ).toThrow(/PLUGIN_INSTALL_RECOVERY_REQUIRED/);
    expect(() =>
      setActiveVersion("quarantine-recovery", "2.0.0", {
        scope: "project",
        cwd,
        allowSourceSwitch: true,
      }),
    ).toThrow(/PLUGIN_INSTALL_RECOVERY_REQUIRED/);
    expect(
      getActiveVersion("quarantine-recovery", { scope: "project", cwd }),
    ).toBe(null);
  });

  it("blocks runtime when candidate and pointer quarantine both fail", () => {
    const original = makeSource("double-recovery", "2.0.0");
    const installed = installFromDirectory(original, {
      scope: "project",
      cwd,
    });
    const replacement = makeSource("double-recovery", "2.0.0", {
      extra: { description: "replacement" },
    });

    const originalRenameSync = installDeps.renameSync;
    installDeps.renameSync = (from, to) => {
      if (path.basename(from) === "next" && path.basename(to) === ".active") {
        throw new Error("injected active pointer failure");
      }
      if (
        path.resolve(from) === path.resolve(installed.dir) &&
        path.basename(to) === "rejected"
      ) {
        throw new Error("injected candidate quarantine failure");
      }
      if (
        path.basename(from) === ".active" &&
        path.basename(to) === "previous-active"
      ) {
        throw new Error("injected pointer quarantine failure");
      }
      return originalRenameSync(from, to);
    };
    try {
      expect(() =>
        installFromDirectory(replacement, {
          scope: "project",
          cwd,
          force: true,
        }),
      ).toThrow(/active pointer fail-close also failed/);
    } finally {
      installDeps.renameSync = originalRenameSync;
    }

    expect(getActiveVersion("double-recovery", { scope: "project", cwd })).toBe(
      "2.0.0",
    );
    expect(
      discoverPlugins({ cwd, scopes: ["project"], skipPolicy: true }),
    ).toEqual([]);
    expect(listInstalled({ cwd, scopes: ["project"] })[0]).toMatchObject({
      name: "double-recovery",
      runtimeBlocked: true,
      activePointer: { status: "recovery-required" },
    });
  });

  it("rejects a corrupted staged copy before replacing active bytes", () => {
    const original = makeSource("greeter", "1.0.0");
    installFromDirectory(original, { scope: "project", cwd });
    const replacement = makeSource("greeter", "1.0.0");
    const copyFileSync = installDeps.copyFileSync;
    installDeps.copyFileSync = (from, to) => {
      copyFileSync(from, to);
      if (path.basename(from) === "plugin.json") {
        fs.writeFileSync(to, "{not-json", "utf8");
      }
    };
    try {
      expect(() =>
        installFromDirectory(replacement, {
          scope: "project",
          cwd,
          force: true,
        }),
      ).toThrow(/staged plugin failed load validation/);
    } finally {
      installDeps.copyFileSync = copyFileSync;
    }

    const dest = pluginVersionDir("project", "greeter", "1.0.0", { cwd });
    expect(
      JSON.parse(fs.readFileSync(path.join(dest, "plugin.json"), "utf8")),
    ).toMatchObject({
      name: "greeter",
      version: "1.0.0",
    });
  });

  it("keeps predecessor bytes active when staged file durability fails", () => {
    const original = makeSource("durability-guard", "1.0.0");
    fs.writeFileSync(
      path.join(original, "skills", "hello", "SKILL.md"),
      "original",
    );
    const installed = installFromDirectory(original, {
      scope: "project",
      cwd,
    });
    const replacement = makeSource("durability-guard", "1.0.0");
    fs.writeFileSync(
      path.join(replacement, "skills", "hello", "SKILL.md"),
      "replacement",
    );

    const originalOpenSync = installDeps.openSync;
    const originalFsyncSync = installDeps.fsyncSync;
    const stagedOpenMode = process.platform === "win32" ? "r+" : "r";
    let stagedFileDescriptor = null;
    installDeps.openSync = (file, ...args) => {
      const descriptor = originalOpenSync(file, ...args);
      if (
        args[0] === stagedOpenMode &&
        path
          .dirname(String(file))
          .split(path.sep)
          .some((part) => part.startsWith(".install-"))
      ) {
        stagedFileDescriptor = descriptor;
      }
      return descriptor;
    };
    installDeps.fsyncSync = (descriptor) => {
      if (descriptor === stagedFileDescriptor) {
        stagedFileDescriptor = null;
        throw new Error("injected staged fsync failure");
      }
      return originalFsyncSync(descriptor);
    };
    try {
      expect(() =>
        installFromDirectory(replacement, {
          scope: "project",
          cwd,
          force: true,
        }),
      ).toThrow(/injected staged fsync failure/u);
    } finally {
      installDeps.openSync = originalOpenSync;
      installDeps.fsyncSync = originalFsyncSync;
    }

    expect(
      fs.readFileSync(
        path.join(installed.dir, "skills", "hello", "SKILL.md"),
        "utf8",
      ),
    ).toBe("original");
    expect(
      getActiveVersion("durability-guard", { scope: "project", cwd }),
    ).toBe("1.0.0");
    expect(
      fs.existsSync(
        path.join(path.dirname(installed.dir), ".plugin-transaction-lock"),
      ),
    ).toBe(false);
  });

  it("rolls back an unpublished candidate when active-pointer fsync fails", () => {
    const source = makeSource("pointer-durability", "1.0.0");
    const originalOpenSync = installDeps.openSync;
    const originalFsyncSync = installDeps.fsyncSync;
    let pointerDescriptor = null;
    installDeps.openSync = (file, ...args) => {
      const descriptor = originalOpenSync(file, ...args);
      if (
        path.basename(String(file)) === "next" &&
        path.basename(path.dirname(String(file))).startsWith(".active-")
      ) {
        pointerDescriptor = descriptor;
      }
      return descriptor;
    };
    installDeps.fsyncSync = (descriptor) => {
      if (descriptor === pointerDescriptor) {
        pointerDescriptor = null;
        throw new Error("injected active pointer fsync failure");
      }
      return originalFsyncSync(descriptor);
    };
    try {
      expect(() =>
        installFromDirectory(source, { scope: "project", cwd }),
      ).toThrow(/injected active pointer fsync failure/u);
    } finally {
      installDeps.openSync = originalOpenSync;
      installDeps.fsyncSync = originalFsyncSync;
    }

    const nameDir = path.join(
      cwd,
      ".chainlesschain",
      "plugins",
      "pointer-durability",
    );
    expect(
      getActiveVersion("pointer-durability", { scope: "project", cwd }),
    ).toBe(null);
    expect(fs.existsSync(path.join(nameDir, "1.0.0"))).toBe(false);
    expect(fs.existsSync(path.join(nameDir, ".plugin-transaction-lock"))).toBe(
      false,
    );
  });

  it("rejects an invalid manifest", () => {
    const src = makeSource("evil", "1.0.0", {
      extra: { skills: [{ name: "x", path: "../../../etc" }] },
    });
    expect(() => installFromDirectory(src, { scope: "project", cwd })).toThrow(
      /manifest is invalid/,
    );
  });
});

describe("installFromSource", () => {
  it("installs from an existing local directory", () => {
    const src = makeSource("greeter", "1.0.0");
    const res = installFromSource(src, { scope: "project", cwd });
    expect(res.name).toBe("greeter");
    const [row] = listInstalled({ cwd, scopes: ["project"] });
    expect(row.source).toMatchObject({
      version: 1,
      type: "local",
      source: path.resolve(src),
    });
  });

  it("requires source-switch and downgrade approvals by default for direct callers", () => {
    const current = makeSource("default-guard", "2.0.0");
    installFromSourceImpl(current, { scope: "project", cwd });
    const candidate = makeSource("default-guard", "1.0.0");

    expect(() =>
      installFromSourceImpl(candidate, { scope: "project", cwd }),
    ).toThrow(/SOURCE_SWITCH_APPROVAL_REQUIRED/);
    expect(() =>
      installFromSourceImpl(candidate, {
        scope: "project",
        cwd,
        allowSourceSwitch: true,
      }),
    ).toThrow(/VERSION_DOWNGRADE_APPROVAL_REQUIRED/);
    expect(getActiveVersion("default-guard", { scope: "project", cwd })).toBe(
      "2.0.0",
    );
  });

  it("replaces untrusted source metadata with installer-owned provenance", () => {
    const src = makeSource("provenance", "1.0.0");
    fs.writeFileSync(
      path.join(src, ".plugin-source.json"),
      JSON.stringify({
        type: "git",
        source: "https://attacker.invalid/forged.git",
      }),
      "utf8",
    );
    installFromSource(src, { scope: "project", cwd });
    const [row] = listInstalled({ cwd, scopes: ["project"] });
    expect(row.source).toMatchObject({
      type: "local",
      source: path.resolve(src),
    });
    expect(row.source.source).not.toContain("attacker.invalid");
  });

  it("persists validated marketplace catalog authority and exact registry identity", () => {
    const src = makeSource("governed", "2.0.0");
    const catalogDigest = "a".repeat(64);
    const candidateId = `candidate-${"b".repeat(20)}`;
    const candidateDigest = "c".repeat(64);
    const selectionDigest = "d".repeat(64);
    installFromSource(src, {
      scope: "project",
      cwd,
      expectedIdentity: { name: "governed", version: "2.0.0" },
      sourceMetadata: {
        type: "registry",
        source: "https://registry.example/index.json?token=secret",
        registry: "https://registry.example/index.json?token=secret",
        package: "governed",
        resolvedSource: "https://git.example/governed.git#v2.0.0",
        catalogAuthority: {
          catalogDigest,
          candidateId,
          candidateDigest,
          selectionDigest,
          selectionSourceCount: 2,
          governanceStatus: "complete",
          registryStatus: "online",
          versionAuthority: "registry-declared-unverified",
        },
      },
    });

    const [row] = listInstalled({ cwd, scopes: ["project"] });
    expect(row.source).toMatchObject({
      type: "registry",
      source: "https://registry.example/index.json?[REDACTED]",
      catalogAuthority: {
        schemaVersion: "cc-plugin-marketplace-catalog/v1",
        installPreflightSchemaVersion:
          "cc-plugin-marketplace-install-preflight/v1",
        catalogDigest,
        registryDocumentSha256: registryFixtureAuthorities.get(
          "https://registry.example/index.json?token=secret",
        ).documentSha256,
        candidateId,
        candidateDigest,
        selectionSchemaVersion: "cc-plugin-marketplace-candidate-selection/v1",
        selectionDigest,
        selectionSourceCount: 2,
        preflightStatus: "allowed",
        governanceStatus: "complete",
      },
    });
    expect(JSON.stringify(row.source)).not.toContain("secret");
  });

  it("cross-binds registry capability to the fetched document before I/O", () => {
    const registry = "https://registry.example/index.json";
    const resolution = registryFixtureAuthorities.get(registry);
    let existsCalls = 0;
    let lstatCalls = 0;
    let mkdtempCalls = 0;
    let spawnCalls = 0;
    const originalExistsSync = installDeps.existsSync;
    const originalLstatSync = installDeps.lstatSync;
    const originalMkdtempSync = installDeps.mkdtempSync;
    const originalSpawnSync = installDeps.spawnSync;
    installDeps.existsSync = () => {
      existsCalls += 1;
      return false;
    };
    installDeps.lstatSync = (...args) => {
      lstatCalls += 1;
      return originalLstatSync(...args);
    };
    installDeps.mkdtempSync = (...args) => {
      mkdtempCalls += 1;
      return originalMkdtempSync(...args);
    };
    installDeps.spawnSync = () => {
      spawnCalls += 1;
      return { status: 1, stdout: "", stderr: "" };
    };
    try {
      expect(() =>
        installFromSourceImpl(resolution.source, {
          cwd,
          registryResolutionAuthority: resolution.registryResolutionAuthority,
          sourceMetadata: {
            type: "registry",
            source: registry,
            registry,
            resolvedSource: resolution.source,
            ref: resolution.ref,
            catalogAuthority: {
              registryDocumentSha256: "0".repeat(64),
            },
          },
        }),
      ).toThrow(/does not match catalog document digest/u);
      expect(() =>
        installFromSourceImpl(resolution.source, {
          cwd,
          registryResolutionAuthority: resolution.registryResolutionAuthority,
          sourceMetadata: {
            type: "registry",
            source: registry,
            registry,
            resolvedSource: resolution.source,
            ref: resolution.ref,
          },
        }),
      ).toThrow(/requires catalog authority/u);
      expect(() =>
        installFromSourceImpl(resolution.source, {
          cwd,
          registryResolutionAuthority: resolution.registryResolutionAuthority,
          sourceMetadata: {
            type: "registry",
            source: registry,
            registry,
            resolvedSource: resolution.source,
            ref: resolution.ref,
            catalogAuthority: {},
          },
        }),
      ).toThrow(/catalogAuthority\.catalogDigest/u);
      expect({ existsCalls, lstatCalls, mkdtempCalls, spawnCalls }).toEqual({
        existsCalls: 0,
        lstatCalls: 0,
        mkdtempCalls: 0,
        spawnCalls: 0,
      });
    } finally {
      installDeps.existsSync = originalExistsSync;
      installDeps.lstatSync = originalLstatSync;
      installDeps.mkdtempSync = originalMkdtempSync;
      installDeps.spawnSync = originalSpawnSync;
    }
  });

  it("uses one installer-owned source authority for online publish and offline reuse", () => {
    const registry = "https://registry.example/index.json";
    const resolution = registryFixtureAuthorities.get(registry);
    const source = makeSource("cached-governed", "1.0.0");
    const manifestSha256 = crypto
      .createHash("sha256")
      .update(fs.readFileSync(path.join(source, "plugin.json")))
      .digest("hex");
    const payload = buildMarketplacePayloadSbom(source, {
      schemaVersion: PLUGIN_MARKETPLACE_PAYLOAD_SBOM_SCHEMA,
    });
    const sourceCacheDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "cc-plugin-source-cache-"),
    );
    const offlineCwd = fs.mkdtempSync(
      path.join(os.tmpdir(), "cc-inst-offline-cwd-"),
    );
    const sourceMetadata = {
      type: "registry",
      source: registry,
      registry,
      package: "cached-governed",
      resolvedSource: resolution.source,
      ref: resolution.ref,
      catalogAuthority: {
        catalogDigest: "a".repeat(64),
        candidateId: `candidate-${"b".repeat(20)}`,
        governanceStatus: "complete",
        registryStatus: "online",
        versionAuthority: "registry-declared-unverified",
        artifactExpectations: {
          manifest: { status: "declared", sha256: manifestSha256 },
          sbom: {
            status: "declared",
            format: payload.schemaVersion,
            payloadSha256: payload.digest,
          },
        },
      },
    };
    try {
      const online = installRegistryFixture(
        source,
        {
          scope: "project",
          cwd,
          sourceCacheDir,
          sourceMetadata,
        },
        installFromSourceImpl,
      );
      expect(online.sourceCache).toMatchObject({ status: "published" });

      let spawnCalls = 0;
      const originalSpawnSync = installDeps.spawnSync;
      installDeps.spawnSync = () => {
        spawnCalls += 1;
        throw new Error("offline install must not spawn Git");
      };
      try {
        const offline = installFromSourceImpl(resolution.source, {
          scope: "project",
          cwd: offlineCwd,
          sourceCacheDir,
          sourceMetadata,
          registryResolutionAuthority: resolution.registryResolutionAuthority,
          offline: true,
        });
        expect(offline.sourceCache).toEqual({
          status: "hit",
          cacheKey: online.sourceCache.cacheKey,
        });
        expect(spawnCalls).toBe(0);
      } finally {
        installDeps.spawnSync = originalSpawnSync;
      }
    } finally {
      fs.rmSync(sourceCacheDir, { recursive: true, force: true });
      fs.rmSync(offlineCwd, { recursive: true, force: true });
    }
  });

  it("rejects registry identity drift and malformed catalog authority before install", () => {
    const src = makeSource("actual-name", "1.0.0");
    expect(() =>
      installFromSource(src, {
        scope: "project",
        cwd,
        expectedIdentity: { name: "claimed-name", version: "1.0.0" },
      }),
    ).toThrow(/plugin identity mismatch/);
    expect(() =>
      installFromSource(src, {
        scope: "project",
        cwd,
        sourceMetadata: {
          type: "registry",
          source: "https://registry.example/index.json",
          catalogAuthority: {
            catalogDigest: "not-a-digest",
            candidateId: `candidate-${"b".repeat(20)}`,
          },
        },
      }),
    ).toThrow(/catalogAuthority\.catalogDigest/);
    expect(() =>
      installFromSource(src, {
        scope: "project",
        cwd,
        sourceMetadata: {
          type: "registry",
          source: "https://registry.example/index.json",
          catalogAuthority: {
            catalogDigest: "a".repeat(64),
            candidateId: `candidate-${"b".repeat(20)}`,
            selectionDigest: "d".repeat(64),
            selectionSourceCount: 17,
          },
        },
      }),
    ).toThrow(/catalogAuthority\.selectionSourceCount/);
    expect(listInstalled({ cwd, scopes: ["project"] })).toEqual([]);
  });

  it("cross-binds remote artifact evidence to the selected registry and catalog declaration", () => {
    const src = makeSource("remote-sbom", "1.0.0");
    const artifactUrl = "https://registry.example/plugin.cdx.json";
    const documentSha256 = "e".repeat(64);
    const catalogAuthority = (evidence) => ({
      catalogDigest: "a".repeat(64),
      candidateId: `candidate-${"b".repeat(20)}`,
      candidateDigest: "c".repeat(64),
      governanceStatus: "complete",
      registryStatus: "online",
      versionAuthority: "registry-declared-unverified",
      artifactExpectations: {
        sbom: {
          status: "declared",
          format: "cyclonedx-json",
          url: artifactUrl,
          documentSha256,
        },
      },
      remoteArtifactEvidence: evidence,
    });
    const sourceMetadata = (evidence) => ({
      type: "registry",
      source: "https://registry.example/index.json",
      registry: "https://registry.example/index.json",
      package: "remote-sbom",
      catalogAuthority: catalogAuthority(evidence),
    });

    expect(() =>
      installFromSource(src, {
        scope: "project",
        cwd,
        sourceMetadata: sourceMetadata(
          remoteSbomEvidence({ url: "https://other.example/plugin.cdx.json" }),
        ),
      }),
    ).toThrow(/does not match catalog URL, format, or digest expectations/);
    expect(() =>
      installFromSource(src, {
        scope: "project",
        cwd,
        sourceMetadata: sourceMetadata(
          remoteSbomEvidence({ registryOrigin: "https://other.example" }),
        ),
      }),
    ).toThrow(/registry origin does not match/);
    expect(listInstalled({ cwd, scopes: ["project"] })).toEqual([]);

    installFromSource(src, {
      scope: "project",
      cwd,
      sourceMetadata: sourceMetadata(remoteSbomEvidence()),
    });
    expect(listInstalled({ cwd, scopes: ["project"] })).toHaveLength(1);
  });

  it("requires fetched bytes for a repository-defined payload SBOM before activation", () => {
    const src = makeSource("semantic-sbom", "1.0.0");
    const sbomBytes = Buffer.from(
      JSON.stringify(buildMarketplacePayloadSbom(src)),
    );
    const documentSha256 = crypto
      .createHash("sha256")
      .update(sbomBytes)
      .digest("hex");
    const artifactUrl = "https://registry.example/plugin.sbom.json";
    const evidence = remoteSbomEvidence({
      format: PLUGIN_MARKETPLACE_PAYLOAD_SBOM_SCHEMA,
      digest: documentSha256,
      bytes: sbomBytes.length,
      url: artifactUrl,
    });
    const sourceMetadata = {
      type: "registry",
      source: "https://registry.example/index.json",
      registry: "https://registry.example/index.json",
      package: "semantic-sbom",
      catalogAuthority: {
        catalogDigest: "a".repeat(64),
        candidateId: `candidate-${"b".repeat(20)}`,
        candidateDigest: "c".repeat(64),
        governanceStatus: "complete",
        registryStatus: "online",
        versionAuthority: "registry-declared-unverified",
        artifactExpectations: {
          sbom: {
            status: "declared",
            format: PLUGIN_MARKETPLACE_PAYLOAD_SBOM_SCHEMA,
            url: artifactUrl,
            documentSha256,
          },
        },
        remoteArtifactEvidence: evidence,
      },
    };

    const authorityWithoutEvidence = { ...sourceMetadata.catalogAuthority };
    delete authorityWithoutEvidence.remoteArtifactEvidence;
    expect(() =>
      installFromSource(src, {
        scope: "project",
        cwd,
        sourceMetadata: {
          ...sourceMetadata,
          catalogAuthority: authorityWithoutEvidence,
        },
      }),
    ).toThrow(/payload SBOM evidence is required before plugin activation/i);
    expect(listInstalled({ cwd, scopes: ["project"] })).toEqual([]);

    expect(() =>
      installFromSource(src, {
        scope: "project",
        cwd,
        sourceMetadata,
      }),
    ).toThrow(/SBOM bytes are required before plugin activation/i);
    expect(listInstalled({ cwd, scopes: ["project"] })).toEqual([]);

    installFromSource(src, {
      scope: "project",
      cwd,
      sourceMetadata,
      remoteSbomBytes: sbomBytes,
    });
    expect(
      listInstalled({ cwd, scopes: ["project"] })[0].source.catalogAuthority
        .remoteSbomPayloadComparison,
    ).toMatchObject({
      status: "matched",
      documentSha256,
      remotePayload: { digest: buildMarketplacePayloadSbom(src).digest },
    });
  });

  it("requires v2 instead of binding legacy v1 documents to Git metadata", () => {
    const src = makeSource("legacy-git-sbom", "1.0.0");
    fs.mkdirSync(path.join(src, ".git"));
    fs.writeFileSync(path.join(src, ".git", "config"), "fixture\n", "utf8");
    const payload = buildMarketplacePayloadSbom(src);
    const bytes = Buffer.from(JSON.stringify(payload));
    const documentSha256 = crypto
      .createHash("sha256")
      .update(bytes)
      .digest("hex");

    expect(() =>
      buildRemoteSbomPayloadComparison({
        remoteArtifactEvidence: remoteSbomEvidence({
          format: PLUGIN_MARKETPLACE_PAYLOAD_SBOM_SCHEMA,
          digest: documentSha256,
          bytes: bytes.length,
        }),
        remoteSbomBytes: bytes,
        installedRoot: src,
      }),
    ).toThrow(/v1 cannot bind Git VCS metadata.*v2 payload format/i);
  });

  it("keeps an incomplete legacy v1 declaration unbound on later replacement", () => {
    const src = makeSource("legacy-unbound-sbom", "1.0.0");
    const payload = buildMarketplacePayloadSbom(src);
    installFromSource(src, {
      scope: "project",
      cwd,
      sourceMetadata: {
        type: "registry",
        source: "https://registry.example/index.json",
        registry: "https://registry.example/index.json",
        package: "legacy-unbound-sbom",
        catalogAuthority: {
          catalogDigest: "a".repeat(64),
          candidateId: `candidate-${"b".repeat(20)}`,
          candidateDigest: "c".repeat(64),
          governanceStatus: "complete",
          registryStatus: "online",
          versionAuthority: "registry-declared-unverified",
          artifactExpectations: {
            sbom: {
              status: "declared",
              format: PLUGIN_MARKETPLACE_PAYLOAD_SBOM_SCHEMA,
              payloadSha256: payload.digest,
            },
          },
        },
      },
    });

    const replacement = makeSource("legacy-unbound-sbom", "2.0.0");
    const upgraded = installFromSource(replacement, {
      scope: "project",
      cwd,
    });
    expect(upgraded.version).toBe("2.0.0");
    expect(
      getActiveVersion("legacy-unbound-sbom", { scope: "project", cwd }),
    ).toBe("2.0.0");
  });

  it("fails closed when evidence is deleted from a complete v1 binding", () => {
    const src = makeSource("legacy-bound-sbom", "1.0.0");
    const semantic = semanticSourceMetadata(
      src,
      "legacy-bound-sbom",
      PLUGIN_MARKETPLACE_PAYLOAD_SBOM_SCHEMA,
    );
    const installed = installFromSource(src, {
      scope: "project",
      cwd,
      sourceMetadata: semantic.metadata,
      remoteSbomBytes: semantic.bytes,
    });
    const metadataPath = path.join(installed.dir, ".plugin-source.json");
    const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
    delete metadata.catalogAuthority.remoteArtifactEvidence;
    delete metadata.catalogAuthority.remoteSbomPayloadComparison;
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), "utf8");

    const replacement = makeSource("legacy-bound-sbom", "2.0.0");
    expect(() =>
      installFromSource(replacement, { scope: "project", cwd }),
    ).toThrow(/INSTALLED_SEMANTIC_SBOM_EVIDENCE_INVALID/);
    expect(
      getActiveVersion("legacy-bound-sbom", { scope: "project", cwd }),
    ).toBe("1.0.0");
  });

  it("fails closed when an active semantic install contains an excluded metadata directory", () => {
    const src = makeSource("unsafe-active-sbom", "1.0.0");
    const semantic = semanticSourceMetadata(src, "unsafe-active-sbom");
    const installed = installFromSource(src, {
      scope: "project",
      cwd,
      sourceMetadata: semantic.metadata,
      remoteSbomBytes: semantic.bytes,
    });
    const unsafePath = path.join(installed.dir, ".plugin-lock.json");
    fs.rmSync(unsafePath, { recursive: true, force: true });
    fs.mkdirSync(unsafePath);
    fs.writeFileSync(path.join(unsafePath, "hidden.js"), "hidden\n", "utf8");

    const replacement = makeSource("unsafe-active-sbom", "2.0.0");
    const nextSemantic = semanticSourceMetadata(
      replacement,
      "unsafe-active-sbom",
    );
    expect(() =>
      installFromSource(replacement, {
        scope: "project",
        cwd,
        sourceMetadata: nextSemantic.metadata,
        remoteSbomBytes: nextSemantic.bytes,
      }),
    ).toThrow(/EXISTING_VERSION_UNSAFE_ENTRY/);
    expect(
      getActiveVersion("unsafe-active-sbom", { scope: "project", cwd }),
    ).toBe("1.0.0");
  });

  it("rejects an incomplete v2 declaration before activation", () => {
    const src = makeSource("incomplete-v2-sbom", "1.0.0");
    const payload = buildMarketplacePayloadSbom(src, {
      schemaVersion: PLUGIN_MARKETPLACE_CANONICAL_PAYLOAD_SBOM_SCHEMA,
    });
    const sourceMetadata = {
      type: "registry",
      source: "https://registry.example/index.json",
      registry: "https://registry.example/index.json",
      package: "incomplete-v2-sbom",
      catalogAuthority: {
        catalogDigest: "a".repeat(64),
        candidateId: `candidate-${"b".repeat(20)}`,
        candidateDigest: "c".repeat(64),
        governanceStatus: "complete",
        registryStatus: "online",
        versionAuthority: "registry-declared-unverified",
        artifactExpectations: {
          sbom: {
            status: "declared",
            format: PLUGIN_MARKETPLACE_CANONICAL_PAYLOAD_SBOM_SCHEMA,
            payloadSha256: payload.digest,
          },
        },
      },
    };

    expect(() =>
      installFromSource(src, {
        scope: "project",
        cwd,
        sourceMetadata,
      }),
    ).toThrow(/payload SBOM v2 requires complete bound remote evidence/i);
    expect(listInstalled({ cwd, scopes: ["project"] })).toEqual([]);
  });

  it("blocks direct local replacement and pointer activation from weakening an installed v2 binding", () => {
    const savedUnbound = makeSource("semantic-lineage", "2.0.0");
    installFromSource(savedUnbound, { scope: "project", cwd });

    const bound = makeSource("semantic-lineage", "1.0.0");
    fs.writeFileSync(
      path.join(bound, "skills", "hello", "SKILL.md"),
      "bound",
      "utf8",
    );
    const semantic = semanticSourceMetadata(bound, "semantic-lineage");
    installFromSource(bound, {
      scope: "project",
      cwd,
      sourceMetadata: semantic.metadata,
      remoteSbomBytes: semantic.bytes,
    });
    expect(
      getActiveVersion("semantic-lineage", { scope: "project", cwd }),
    ).toBe("1.0.0");

    expect(() => updatePlugin(savedUnbound, { scope: "project", cwd })).toThrow(
      /SEMANTIC_SBOM_BINDING_DOWNGRADE/,
    );
    expect(
      getActiveVersion("semantic-lineage", { scope: "project", cwd }),
    ).toBe("1.0.0");

    const replacement = makeSource("semantic-lineage", "3.0.0");
    expect(() =>
      installFromSource(replacement, { scope: "project", cwd }),
    ).toThrow(/SEMANTIC_SBOM_BINDING_DOWNGRADE/);
    const active = listInstalled({ cwd, scopes: ["project"] })[0];
    expect(active.version).toBe("1.0.0");
    expect(
      fs.readFileSync(
        path.join(active.dir, "skills", "hello", "SKILL.md"),
        "utf8",
      ),
    ).toBe("bound");
    expect(
      active.source.catalogAuthority.remoteSbomPayloadComparison,
    ).toMatchObject({ status: "matched" });
  });

  it("fails closed when provenance is deleted before a direct replacement", () => {
    const bound = makeSource("missing-lineage", "1.0.0");
    const semantic = semanticSourceMetadata(bound, "missing-lineage");
    const installed = installFromSource(bound, {
      scope: "project",
      cwd,
      sourceMetadata: semantic.metadata,
      remoteSbomBytes: semantic.bytes,
    });
    fs.rmSync(path.join(installed.dir, ".plugin-source.json"));

    const replacement = makeSource("missing-lineage", "2.0.0");
    expect(() =>
      installFromSource(replacement, { scope: "project", cwd }),
    ).toThrow(/source metadata is missing.*remove and reinstall/i);
    expect(getActiveVersion("missing-lineage", { scope: "project", cwd })).toBe(
      "1.0.0",
    );
  });

  it("protects a non-active v2 destination from a forced unbound overwrite", () => {
    const activeBound = makeSource("saved-binding", "3.0.0");
    const activeSemantic = semanticSourceMetadata(activeBound, "saved-binding");
    installFromSource(activeBound, {
      scope: "project",
      cwd,
      sourceMetadata: activeSemantic.metadata,
      remoteSbomBytes: activeSemantic.bytes,
    });
    const bound = makeSource("saved-binding", "2.0.0");
    fs.writeFileSync(
      path.join(bound, "skills", "hello", "SKILL.md"),
      "protected",
      "utf8",
    );
    const semantic = semanticSourceMetadata(bound, "saved-binding");
    installFromSource(bound, {
      scope: "project",
      cwd,
      sourceMetadata: semantic.metadata,
      remoteSbomBytes: semantic.bytes,
    });
    setActiveVersion("saved-binding", "3.0.0", { scope: "project", cwd });

    const replacement = makeSource("saved-binding", "2.0.0");
    expect(() =>
      installFromSource(replacement, {
        scope: "project",
        cwd,
        force: true,
      }),
    ).toThrow(/SEMANTIC_SBOM_BINDING_DOWNGRADE/);
    expect(getActiveVersion("saved-binding", { scope: "project", cwd })).toBe(
      "3.0.0",
    );
    const protectedDir = pluginVersionDir("project", "saved-binding", "2.0.0", {
      cwd,
    });
    expect(
      fs.readFileSync(
        path.join(protectedDir, "skills", "hello", "SKILL.md"),
        "utf8",
      ),
    ).toBe("protected");
  });

  it("blocks direct active-version rollback from v2-bound to dormant unbound bytes", () => {
    const unbound = makeSource("use-binding", "2.0.0");
    installFromSource(unbound, { scope: "project", cwd });
    const bound = makeSource("use-binding", "1.0.0");
    const semantic = semanticSourceMetadata(bound, "use-binding");
    installFromSource(bound, {
      scope: "project",
      cwd,
      sourceMetadata: semantic.metadata,
      remoteSbomBytes: semantic.bytes,
    });

    expect(() =>
      setActiveVersion("use-binding", "2.0.0", {
        scope: "project",
        cwd,
      }),
    ).toThrow(/SEMANTIC_SBOM_BINDING_DOWNGRADE/);
    expect(() =>
      setActiveVersion("use-binding", "2.0.0", {
        scope: "project",
        cwd,
        allowSourceSwitch: true,
      }),
    ).toThrow(/SEMANTIC_SBOM_BINDING_DOWNGRADE/);
    expect(getActiveVersion("use-binding", { scope: "project", cwd })).toBe(
      "1.0.0",
    );
  });

  it("freshly verifies dormant semantic bytes before direct activation", () => {
    const first = makeSource("use-tamper", "1.0.0");
    const firstSemantic = semanticSourceMetadata(first, "use-tamper");
    const installedFirst = installFromSource(first, {
      scope: "project",
      cwd,
      sourceMetadata: firstSemantic.metadata,
      remoteSbomBytes: firstSemantic.bytes,
    });
    const second = makeSource("use-tamper", "2.0.0");
    const secondSemantic = semanticSourceMetadata(second, "use-tamper");
    installFromSource(second, {
      scope: "project",
      cwd,
      sourceMetadata: secondSemantic.metadata,
      remoteSbomBytes: secondSemantic.bytes,
    });
    fs.writeFileSync(
      path.join(installedFirst.dir, "skills", "hello", "SKILL.md"),
      "tampered",
      "utf8",
    );

    expect(() =>
      setActiveVersion("use-tamper", "1.0.0", {
        scope: "project",
        cwd,
      }),
    ).toThrow(/INSTALLED_SEMANTIC_SBOM_EVIDENCE_INVALID/);
    expect(getActiveVersion("use-tamper", { scope: "project", cwd })).toBe(
      "2.0.0",
    );
  });

  it("does not turn a missing active pointer into a semantic downgrade trampoline", () => {
    const unbound = makeSource("use-missing-active", "2.0.0");
    installFromSource(unbound, { scope: "project", cwd });
    const bound = makeSource("use-missing-active", "1.0.0");
    const semantic = semanticSourceMetadata(bound, "use-missing-active");
    installFromSource(bound, {
      scope: "project",
      cwd,
      sourceMetadata: semantic.metadata,
      remoteSbomBytes: semantic.bytes,
    });
    fs.rmSync(
      path.join(
        path.dirname(
          pluginVersionDir("project", "use-missing-active", "1.0.0", {
            cwd,
          }),
        ),
        ".active",
      ),
    );
    expect(
      getActiveVersion("use-missing-active", { scope: "project", cwd }),
    ).toBeNull();

    expect(() =>
      setActiveVersion("use-missing-active", "2.0.0", {
        scope: "project",
        cwd,
      }),
    ).toThrow(/SEMANTIC_SBOM_BINDING_DOWNGRADE/);
    expect(
      getActiveVersion("use-missing-active", { scope: "project", cwd }),
    ).toBeNull();
  });

  it("does not erase dormant binding authority when provenance is deleted", () => {
    const unbound = makeSource("use-dormant-provenance", "2.0.0");
    installFromSource(unbound, { scope: "project", cwd });
    const bound = makeSource("use-dormant-provenance", "1.0.0");
    const semantic = semanticSourceMetadata(bound, "use-dormant-provenance");
    const installedBound = installFromSource(bound, {
      scope: "project",
      cwd,
      sourceMetadata: semantic.metadata,
      remoteSbomBytes: semantic.bytes,
    });
    const activeFile = path.join(path.dirname(installedBound.dir), ".active");
    fs.rmSync(activeFile);
    fs.rmSync(path.join(installedBound.dir, ".plugin-source.json"));

    expect(() =>
      setActiveVersion("use-dormant-provenance", "2.0.0", {
        scope: "project",
        cwd,
        allowSourceSwitch: true,
      }),
    ).toThrow(/source metadata is missing.*remove and reinstall/i);
    expect(fs.existsSync(activeFile)).toBe(false);
  });

  it("requires selected legacy bytes to be reinstalled before activation", () => {
    const first = makeSource("use-provenance", "1.0.0");
    installFromSource(first, { scope: "project", cwd });
    const second = makeSource("use-provenance", "2.0.0");
    installFromSource(second, { scope: "project", cwd });
    fs.rmSync(
      path.join(
        pluginVersionDir("project", "use-provenance", "1.0.0", { cwd }),
        ".plugin-source.json",
      ),
    );

    expect(() =>
      setActiveVersion("use-provenance", "1.0.0", {
        scope: "project",
        cwd,
      }),
    ).toThrow(/source metadata is missing.*remove and reinstall/i);
    expect(getActiveVersion("use-provenance", { scope: "project", cwd })).toBe(
      "2.0.0",
    );
  });

  it("rejects an activation target whose manifest is no longer loadable", () => {
    const first = installFromSource(makeSource("use-invalid", "1.0.0"), {
      scope: "project",
      cwd,
    });
    installFromSource(makeSource("use-invalid", "2.0.0"), {
      scope: "project",
      cwd,
    });
    fs.rmSync(path.join(first.dir, "plugin.json"));

    expect(() =>
      setActiveVersion("use-invalid", "1.0.0", {
        scope: "project",
        cwd,
        allowSourceSwitch: true,
      }),
    ).toThrow(/ACTIVATION_TARGET_INVALID/);
    expect(getActiveVersion("use-invalid", { scope: "project", cwd })).toBe(
      "2.0.0",
    );
  });

  it("requires source-switch approval when repairing a missing active pointer", () => {
    const first = makeSource("use-repair-source", "1.0.0");
    installFromSource(first, { scope: "project", cwd });
    const second = makeSource("use-repair-source", "2.0.0");
    installFromSource(second, { scope: "project", cwd });
    const activeFile = path.join(
      path.dirname(
        pluginVersionDir("project", "use-repair-source", "2.0.0", { cwd }),
      ),
      ".active",
    );
    fs.rmSync(activeFile);

    expect(() =>
      setActiveVersion("use-repair-source", "1.0.0", {
        scope: "project",
        cwd,
      }),
    ).toThrow(/SOURCE_SWITCH_APPROVAL_REQUIRED/);
    expect(fs.existsSync(activeFile)).toBe(false);
    setActiveVersion("use-repair-source", "1.0.0", {
      scope: "project",
      cwd,
      allowSourceSwitch: true,
    });
    expect(
      getActiveVersion("use-repair-source", { scope: "project", cwd }),
    ).toBe("1.0.0");
  });

  it("does not turn an invalid pointer into a version-downgrade trampoline", () => {
    const source = makeSource("repair-version", "2.0.0");
    const installed = installFromSource(source, { scope: "project", cwd });
    const activeFile = path.join(path.dirname(installed.dir), ".active");
    fs.writeFileSync(activeFile, "corrupt", "utf8");
    fs.writeFileSync(
      path.join(source, "plugin.json"),
      JSON.stringify({ name: "repair-version", version: "1.0.0" }),
      "utf8",
    );

    expect(() =>
      updatePlugin(source, {
        scope: "project",
        cwd,
        enforceUpdateApprovals: true,
        allowDowngrade: false,
      }),
    ).toThrow(/VERSION_DOWNGRADE_APPROVAL_REQUIRED/);
    expect(fs.readFileSync(activeFile, "utf8")).toBe("corrupt");
    expect(listInstalledVersions("project", "repair-version", { cwd })).toEqual(
      ["2.0.0"],
    );
  });

  it("allows transaction rollback to restore its captured weaker predecessor", () => {
    const previous = makeSource("semantic-rollback", "1.0.0");
    installFromSource(previous, { scope: "project", cwd });
    const bound = makeSource("semantic-rollback", "2.0.0");
    const semantic = semanticSourceMetadata(bound, "semantic-rollback");
    const update = installFromSource(bound, {
      scope: "project",
      cwd,
      sourceMetadata: semantic.metadata,
      remoteSbomBytes: semantic.bytes,
      transactional: true,
    });
    expect(
      getActiveVersion("semantic-rollback", { scope: "project", cwd }),
    ).toBe("2.0.0");

    expect(rollbackPluginUpdate(update)).toEqual({
      rolledBack: true,
      version: "1.0.0",
      cleanupPending: false,
    });
    expect(
      getActiveVersion("semantic-rollback", { scope: "project", cwd }),
    ).toBe("1.0.0");
  });

  it("restores the exact corrupt pointer captured by a rejected transaction", () => {
    const source = makeSource("pointer-rollback", "1.0.0");
    const installed = installFromSource(source, { scope: "project", cwd });
    const activeFile = path.join(path.dirname(installed.dir), ".active");
    fs.writeFileSync(activeFile, "corrupt-before", "utf8");
    fs.writeFileSync(
      path.join(source, "plugin.json"),
      JSON.stringify({ name: "pointer-rollback", version: "2.0.0" }),
      "utf8",
    );

    const update = installFromSource(source, {
      scope: "project",
      cwd,
      transactional: true,
      enforceUpdateApprovals: true,
    });
    expect(
      getActiveVersion("pointer-rollback", { scope: "project", cwd }),
    ).toBe("2.0.0");
    expect(rollbackPluginUpdate(update)).toMatchObject({
      rolledBack: true,
      version: null,
    });
    expect(fs.readFileSync(activeFile, "utf8")).toBe("corrupt-before");
    expect(
      listInstalledVersions("project", "pointer-rollback", { cwd }),
    ).toEqual(["1.0.0"]);
  });

  it("refuses stale rollback after its pointer is externally replaced", () => {
    installFromSource(makeSource("stale-pointer", "1.0.0"), {
      scope: "project",
      cwd,
    });
    const update = installFromSource(makeSource("stale-pointer", "2.0.0"), {
      scope: "project",
      cwd,
      transactional: true,
    });
    const activeFile = path.join(path.dirname(update.dir), ".active");
    fs.writeFileSync(activeFile, "1.0.0", "utf8");

    expect(() => rollbackPluginUpdate(update)).toThrow(
      /PLUGIN_TRANSACTION_STALE/,
    );
    expect(getActiveVersion("stale-pointer", { scope: "project", cwd })).toBe(
      "1.0.0",
    );
  });

  it("refuses rollback when its predecessor was removed", () => {
    installFromSource(makeSource("stale-predecessor", "1.0.0"), {
      scope: "project",
      cwd,
    });
    const update = installFromSource(makeSource("stale-predecessor", "2.0.0"), {
      scope: "project",
      cwd,
      transactional: true,
    });
    expect(() =>
      uninstall("stale-predecessor", {
        scope: "project",
        cwd,
        version: "1.0.0",
      }),
    ).toThrow(/PLUGIN_INSTALL_RECOVERY_REQUIRED/);
    fs.rmSync(
      pluginVersionDir("project", "stale-predecessor", "1.0.0", { cwd }),
      { recursive: true, force: true },
    );

    expect(() => rollbackPluginUpdate(update)).toThrow(
      /PLUGIN_TRANSACTION_STALE/,
    );
    expect(
      getActiveVersion("stale-predecessor", { scope: "project", cwd }),
    ).toBe("2.0.0");
  });

  it("refuses rollback after same-version bytes change ownership", () => {
    installFromSource(makeSource("stale-generation", "1.0.0"), {
      scope: "project",
      cwd,
    });
    const update = installFromSource(
      makeSource("stale-generation", "2.0.0", {
        extra: { description: "transaction" },
      }),
      { scope: "project", cwd, transactional: true },
    );
    fs.writeFileSync(
      path.join(update.dir, "plugin.json"),
      JSON.stringify({
        name: "stale-generation",
        version: "2.0.0",
        description: "later replacement",
      }),
      "utf8",
    );

    expect(() => rollbackPluginUpdate(update)).toThrow(
      /PLUGIN_TRANSACTION_STALE/,
    );
    const activeRoot = pluginVersionDir(
      "project",
      "stale-generation",
      "2.0.0",
      { cwd },
    );
    expect(
      JSON.parse(fs.readFileSync(path.join(activeRoot, "plugin.json"))),
    ).toMatchObject({ description: "later replacement" });
  });

  it("freshly verifies saved v2 bytes before pointer-only activation", () => {
    const first = makeSource("saved-v2", "1.0.0");
    const firstSemantic = semanticSourceMetadata(first, "saved-v2");
    installFromSource(first, {
      scope: "project",
      cwd,
      sourceMetadata: firstSemantic.metadata,
      remoteSbomBytes: firstSemantic.bytes,
    });
    const second = makeSource("saved-v2", "2.0.0");
    const secondSemantic = semanticSourceMetadata(second, "saved-v2");
    const installedSecond = installFromSource(second, {
      scope: "project",
      cwd,
      sourceMetadata: secondSemantic.metadata,
      remoteSbomBytes: secondSemantic.bytes,
    });
    setActiveVersion("saved-v2", "1.0.0", { scope: "project", cwd });
    fs.writeFileSync(
      path.join(installedSecond.dir, "skills", "hello", "SKILL.md"),
      "tampered",
      "utf8",
    );

    expect(() =>
      updatePlugin(second, {
        scope: "project",
        cwd,
        sourceMetadata: secondSemantic.metadata,
      }),
    ).toThrow(/EXISTING_VERSION_PAYLOAD_MISMATCH/);
    expect(getActiveVersion("saved-v2", { scope: "project", cwd })).toBe(
      "1.0.0",
    );
  });

  it("serializes pointer-only transactions until finalize", () => {
    const first = makeSource("pointer-transaction", "1.0.0");
    installFromSource(first, { scope: "project", cwd });
    const second = makeSource("pointer-transaction", "2.0.0");
    installFromSource(second, { scope: "project", cwd });
    setActiveVersion("pointer-transaction", "1.0.0", {
      scope: "project",
      cwd,
      allowSourceSwitch: true,
    });

    const update = updatePlugin(second, {
      scope: "project",
      cwd,
      transactional: true,
      allowSourceSwitch: true,
    });
    expect(update).toMatchObject({
      updated: true,
      reinstalled: false,
      version: "2.0.0",
    });
    expect(
      discoverPlugins({ cwd, scopes: ["project"], skipPolicy: true }),
    ).toEqual([]);
    expect(() =>
      setActiveVersion("pointer-transaction", "1.0.0", {
        scope: "project",
        cwd,
        allowSourceSwitch: true,
      }),
    ).toThrow(/PLUGIN_INSTALL_RECOVERY_REQUIRED/);

    expect(finalizePluginUpdate(update)).toEqual({
      finalized: true,
      cleanupPending: false,
    });
    expect(
      discoverPlugins({ cwd, scopes: ["project"], skipPolicy: true }),
    ).toEqual([
      expect.objectContaining({
        name: "pointer-transaction",
        version: "2.0.0",
      }),
    ]);
  });

  it("rejects unsafe manifest names before creating a scope directory", () => {
    const source = makeSource("unsafe-name", "1.0.0");
    fs.writeFileSync(
      path.join(source, "plugin.json"),
      JSON.stringify({ name: "..", version: "1.0.0" }),
      "utf8",
    );
    const sentinel = path.join(cwd, ".chainlesschain", "sentinel.txt");
    fs.mkdirSync(path.dirname(sentinel), { recursive: true });
    fs.writeFileSync(sentinel, "keep", "utf8");

    expect(() =>
      installFromDirectory(source, { scope: "project", cwd }),
    ).toThrow(/manifest\.name is unsafe/);
    expect(fs.readFileSync(sentinel, "utf8")).toBe("keep");
  });

  it("rejects a linked plugin name directory before writing installed bytes", () => {
    const pluginsRoot = path.join(cwd, ".chainlesschain", "plugins");
    const outside = fs.mkdtempSync(path.join(srcRoot, "outside-"));
    fs.mkdirSync(pluginsRoot, { recursive: true });
    fs.symlinkSync(
      outside,
      path.join(pluginsRoot, "linked-name"),
      process.platform === "win32" ? "junction" : "dir",
    );

    expect(() =>
      installFromDirectory(makeSource("linked-name", "1.0.0"), {
        scope: "project",
        cwd,
      }),
    ).toThrow(/PLUGIN_NAME_DIRECTORY_UNSAFE/);
    expect(fs.existsSync(path.join(outside, "1.0.0"))).toBe(false);
  });

  it("errors on a plain non-remote, non-existent source", () => {
    // A bare word is neither a directory nor a git URL.
    expect(() =>
      installFromSource("this-is-not-a-path-or-url", { scope: "project", cwd }),
    ).toThrow(/source directory does not exist/);
  });

  it("enforces managed name/source policy before files land on disk", () => {
    const src = makeSource("managed-denied", "1.0.0");
    expect(() =>
      installFromSource(src, {
        scope: "project",
        cwd,
        managedPolicy: { deniedPlugins: ["managed-denied"] },
        policySource: src,
      }),
    ).toThrow(/denied by managed settings/);
    expect(listInstalled({ cwd, scopes: ["project"] })).toEqual([]);
  });
});

describe("listInstalled", () => {
  it("lists installed plugins across scopes", () => {
    installFromDirectory(makeSource("alpha", "1.0.0"), {
      scope: "project",
      cwd,
    });
    installFromDirectory(makeSource("beta", "0.2.0"), { scope: "local", cwd });
    const rows = listInstalled({ cwd, scopes: ["project", "local"] });
    const names = rows.map((r) => r.name).sort();
    expect(names).toEqual(["alpha", "beta"]);
    expect(rows.every((r) => r.ok)).toBe(true);
    expect(rows.find((r) => r.name === "alpha")?.versions).toEqual(["1.0.0"]);
  });

  it("bounds the version history while retaining an older active version", () => {
    installFromDirectory(makeSource("bounded", "1.0.0"), {
      scope: "project",
      cwd,
    });
    const nameDir = path.dirname(
      pluginVersionDir("project", "bounded", "1.0.0", { cwd }),
    );
    for (let major = 2; major <= 71; major += 1) {
      fs.mkdirSync(path.join(nameDir, `${major}.0.0`));
    }

    const [row] = listInstalled({ cwd, scopes: ["project"] });
    expect(row.versions).toHaveLength(MAX_LISTED_PLUGIN_VERSIONS);
    expect(row.versions[0]).toBe("71.0.0");
    expect(row.versions.at(-1)).toBe("1.0.0");
    expect(row.versions).not.toContain("8.0.0");
    expect(row.versions).not.toContain("7.0.0");
  });

  it("returns every physical scope with effective-authority diagnostics", () => {
    installFromDirectory(makeSource("scope-inventory", "1.0.0"), {
      scope: "project",
      cwd,
    });
    installFromDirectory(makeSource("scope-inventory", "2.0.0"), {
      scope: "local",
      cwd,
    });

    expect(listInstalled({ cwd, scopes: ["project", "local"] })).toEqual([
      expect.objectContaining({
        name: "scope-inventory",
        scope: "local",
        version: "2.0.0",
      }),
    ]);
    expect(
      listInstalledAllScopes({ cwd, scopes: ["project", "local"] }).map(
        ({ scope, effectiveAuthority, shadowedByScope, inactiveReason }) => ({
          scope,
          effectiveAuthority,
          shadowedByScope,
          inactiveReason,
        }),
      ),
    ).toEqual([
      {
        scope: "project",
        effectiveAuthority: false,
        shadowedByScope: "local",
        inactiveReason: "shadowed",
      },
      {
        scope: "local",
        effectiveAuthority: true,
        shadowedByScope: null,
        inactiveReason: null,
      },
    ]);
  });
});

describe("updatePlugin (upgrade from source)", () => {
  it("enforces source-switch and version-downgrade approvals for command callers", () => {
    const gitBacked = makeSource("guarded-update", "2.0.0");
    installFromSource(gitBacked, {
      scope: "project",
      cwd,
      sourceMetadata: {
        type: "git",
        source: "https://git.example/guarded-update.git",
      },
    });

    const localUpgrade = makeSource("guarded-update", "3.0.0");
    expect(() =>
      updatePlugin(localUpgrade, {
        scope: "project",
        cwd,
        enforceUpdateApprovals: true,
        allowSourceSwitch: false,
      }),
    ).toThrow(/SOURCE_SWITCH_APPROVAL_REQUIRED/);
    updatePlugin(localUpgrade, {
      scope: "project",
      cwd,
      enforceUpdateApprovals: true,
      allowSourceSwitch: true,
    });

    fs.writeFileSync(
      path.join(localUpgrade, "plugin.json"),
      JSON.stringify({ name: "guarded-update", version: "1.0.0" }),
      "utf8",
    );
    expect(() =>
      updatePlugin(localUpgrade, {
        scope: "project",
        cwd,
        enforceUpdateApprovals: true,
        allowDowngrade: false,
      }),
    ).toThrow(/VERSION_DOWNGRADE_APPROVAL_REQUIRED/);
    const downgraded = updatePlugin(localUpgrade, {
      scope: "project",
      cwd,
      enforceUpdateApprovals: true,
      allowDowngrade: true,
    });
    expect(downgraded.version).toBe("1.0.0");

    const otherLocalPath = makeSource("guarded-update", "4.0.0");
    expect(() =>
      updatePlugin(otherLocalPath, {
        scope: "project",
        cwd,
        enforceUpdateApprovals: true,
        allowSourceSwitch: false,
      }),
    ).toThrow(/SOURCE_SWITCH_APPROVAL_REQUIRED/);
    const switched = updatePlugin(otherLocalPath, {
      scope: "project",
      cwd,
      enforceUpdateApprovals: true,
      allowSourceSwitch: true,
    });
    expect(switched.version).toBe("4.0.0");
  });

  it("does not activate saved bytes whose source differs from the fetched candidate", () => {
    const sourceA = makeSource("pointer-source", "1.0.0");
    const gitA = { type: "git", source: "https://git.example/a.git" };
    installFromSource(sourceA, {
      scope: "project",
      cwd,
      sourceMetadata: gitA,
    });
    const sourceB = makeSource("pointer-source", "2.0.0");
    installFromSource(sourceB, {
      scope: "project",
      cwd,
      sourceMetadata: { type: "git", source: "https://git.example/b.git" },
    });
    setActiveVersion("pointer-source", "1.0.0", {
      scope: "project",
      cwd,
      allowSourceSwitch: true,
    });
    fs.writeFileSync(
      path.join(sourceA, "plugin.json"),
      JSON.stringify({ name: "pointer-source", version: "2.0.0" }),
      "utf8",
    );

    expect(() =>
      updatePlugin(sourceA, {
        scope: "project",
        cwd,
        sourceMetadata: gitA,
        enforceUpdateApprovals: true,
      }),
    ).toThrow(/EXISTING_VERSION_SOURCE_MISMATCH/);
    expect(getActiveVersion("pointer-source", { scope: "project", cwd })).toBe(
      "1.0.0",
    );
  });

  it.each([
    { label: "local", sourceMetadata: null },
    {
      label: "Git",
      sourceMetadata: {
        type: "git",
        source: "https://git.example/pointer-bytes.git",
      },
    },
    {
      label: "registry",
      sourceMetadata: {
        type: "registry",
        source: "https://registry.example/index.json",
        registry: "https://registry.example/index.json",
        package: "pointer-bytes-registry",
        catalogAuthority: {
          catalogDigest: "a".repeat(64),
          candidateId: `candidate-${"b".repeat(20)}`,
          candidateDigest: "c".repeat(64),
          governanceStatus: "complete",
          registryStatus: "online",
          versionAuthority: "registry-declared-unverified",
          artifactExpectations: {},
        },
      },
    },
  ])(
    "compares the fetched $label payload with saved target bytes before pointer activation",
    ({ label, sourceMetadata }) => {
      const name = `pointer-bytes-${label.toLowerCase()}`;
      const mutableSource = makeSource(name, "2.0.0");
      const sourceOptions = sourceMetadata ? { sourceMetadata } : {};
      const saved = installFromSource(mutableSource, {
        scope: "project",
        cwd,
        ...sourceOptions,
      });
      fs.writeFileSync(
        path.join(mutableSource, "plugin.json"),
        JSON.stringify({ name, version: "3.0.0" }),
        "utf8",
      );
      installFromSource(mutableSource, {
        scope: "project",
        cwd,
        ...sourceOptions,
      });
      fs.writeFileSync(
        path.join(saved.dir, "tampered.js"),
        "tampered\n",
        "utf8",
      );
      fs.writeFileSync(
        path.join(mutableSource, "plugin.json"),
        JSON.stringify({ name, version: "2.0.0" }),
        "utf8",
      );

      expect(() =>
        updatePlugin(mutableSource, {
          scope: "project",
          cwd,
          ...sourceOptions,
          enforceUpdateApprovals: true,
          allowDowngrade: true,
        }),
      ).toThrow(/EXISTING_VERSION_PAYLOAD_MISMATCH/);
      expect(getActiveVersion(name, { scope: "project", cwd })).toBe("3.0.0");
    },
  );

  it.each(["link", ".git", "metadata-directory"])(
    "rejects a saved target containing an unsafe %s entry even when the candidate matches",
    (unsafeKind) => {
      const name = `pointer-unsafe-${unsafeKind.replace(/[^a-z]/g, "")}`;
      const mutableSource = makeSource(name, "2.0.0");
      const saved = installFromSource(mutableSource, {
        scope: "project",
        cwd,
      });
      fs.writeFileSync(
        path.join(mutableSource, "plugin.json"),
        JSON.stringify({ name, version: "3.0.0" }),
        "utf8",
      );
      installFromSource(mutableSource, { scope: "project", cwd });
      fs.writeFileSync(
        path.join(mutableSource, "plugin.json"),
        JSON.stringify({ name, version: "2.0.0" }),
        "utf8",
      );

      if (unsafeKind === "link") {
        const outside = fs.mkdtempSync(path.join(srcRoot, "outside-"));
        fs.writeFileSync(path.join(outside, "payload.js"), "outside\n", "utf8");
        const symlinkType = process.platform === "win32" ? "junction" : "dir";
        fs.symlinkSync(
          outside,
          path.join(mutableSource, "escape"),
          symlinkType,
        );
        fs.symlinkSync(outside, path.join(saved.dir, "escape"), symlinkType);
      } else if (unsafeKind === ".git") {
        for (const root of [mutableSource, saved.dir]) {
          fs.mkdirSync(path.join(root, ".git"));
          fs.writeFileSync(
            path.join(root, ".git", "payload.js"),
            "hidden\n",
            "utf8",
          );
        }
      } else {
        fs.rmSync(path.join(saved.dir, ".plugin-lock.json"), { force: true });
        fs.mkdirSync(path.join(saved.dir, ".plugin-lock.json"));
        fs.writeFileSync(
          path.join(saved.dir, ".plugin-lock.json", "payload.js"),
          "hidden\n",
          "utf8",
        );
      }

      expect(() =>
        updatePlugin(mutableSource, {
          scope: "project",
          cwd,
          enforceUpdateApprovals: true,
          allowDowngrade: true,
        }),
      ).toThrow(/EXISTING_VERSION_UNSAFE_ENTRY/);
      expect(getActiveVersion(name, { scope: "project", cwd })).toBe("3.0.0");
    },
  );

  it("rejects a saved target whose version root is a link", () => {
    const name = "pointer-unsafe-root-link";
    const mutableSource = makeSource(name, "2.0.0");
    const saved = installFromSource(mutableSource, {
      scope: "project",
      cwd,
    });
    fs.writeFileSync(
      path.join(mutableSource, "plugin.json"),
      JSON.stringify({ name, version: "3.0.0" }),
      "utf8",
    );
    installFromSource(mutableSource, { scope: "project", cwd });
    fs.writeFileSync(
      path.join(mutableSource, "plugin.json"),
      JSON.stringify({ name, version: "2.0.0" }),
      "utf8",
    );

    const linkedRoot = fs.mkdtempSync(path.join(srcRoot, "saved-root-"));
    const backing = path.join(linkedRoot, "payload");
    fs.renameSync(saved.dir, backing);
    fs.symlinkSync(
      backing,
      saved.dir,
      process.platform === "win32" ? "junction" : "dir",
    );

    expect(() =>
      updatePlugin(mutableSource, {
        scope: "project",
        cwd,
        enforceUpdateApprovals: true,
        allowDowngrade: true,
      }),
    ).toThrow(/EXISTING_VERSION_UNSAFE_ENTRY/);
    expect(getActiveVersion(name, { scope: "project", cwd })).toBe("3.0.0");
  });

  it("installs a NEW version, repoints .active, keeps the old on disk for rollback", () => {
    installFromDirectory(makeSource("widget", "1.0.0"), {
      scope: "project",
      cwd,
    });
    const res = updatePlugin(makeSource("widget", "2.0.0"), {
      scope: "project",
      cwd,
    });
    expect(res.updated).toBe(true);
    expect(res.previousVersion).toBe("1.0.0");
    expect(res.version).toBe("2.0.0");
    expect(getActiveVersion("widget", { scope: "project", cwd })).toBe("2.0.0");
    // old version dir preserved (rollback via `cc plugin use widget 1.0.0`)
    expect(
      fs.existsSync(pluginVersionDir("project", "widget", "1.0.0", { cwd })),
    ).toBe(true);
  });

  it("is a no-op when already at the source version (no --force)", () => {
    const src = makeSource("widget", "1.0.0");
    installFromDirectory(src, { scope: "project", cwd });
    const res = updatePlugin(src, {
      scope: "project",
      cwd,
    });
    expect(res.updated).toBe(false);
    expect(res.reinstalled).toBe(false);
    expect(res.version).toBe("1.0.0");
  });

  it("--force reinstalls the same version", () => {
    installFromDirectory(makeSource("widget", "1.0.0"), {
      scope: "project",
      cwd,
    });
    const res = updatePlugin(makeSource("widget", "1.0.0"), {
      scope: "project",
      cwd,
      force: true,
    });
    expect(res.reinstalled).toBe(true);
    expect(res.version).toBe("1.0.0");
  });

  it("installs a plugin that was not yet present", () => {
    const res = updatePlugin(makeSource("fresh", "1.0.0"), {
      scope: "project",
      cwd,
    });
    expect(res.updated).toBe(true);
    expect(res.previousVersion).toBe(null);
    expect(getActiveVersion("fresh", { scope: "project", cwd })).toBe("1.0.0");
  });

  it("restores active version and exact bytes when a transaction rolls back", () => {
    const original = makeSource("widget", "1.0.0");
    fs.writeFileSync(
      path.join(original, "skills", "hello", "SKILL.md"),
      "original",
    );
    installFromDirectory(original, { scope: "project", cwd });

    const sameVersion = makeSource("widget", "1.0.0");
    fs.writeFileSync(
      path.join(sameVersion, "skills", "hello", "SKILL.md"),
      "replacement",
    );
    const reinstall = updatePlugin(sameVersion, {
      scope: "project",
      cwd,
      force: true,
      transactional: true,
    });
    expect(
      fs.readFileSync(
        path.join(reinstall.dir, "skills", "hello", "SKILL.md"),
        "utf8",
      ),
    ).toBe("replacement");
    expect(rollbackPluginUpdate(reinstall)).toEqual({
      rolledBack: true,
      version: "1.0.0",
      cleanupPending: false,
    });
    expect(
      fs.readFileSync(
        path.join(reinstall.dir, "skills", "hello", "SKILL.md"),
        "utf8",
      ),
    ).toBe("original");

    const upgrade = updatePlugin(makeSource("widget", "2.0.0"), {
      scope: "project",
      cwd,
      transactional: true,
    });
    expect(getActiveVersion("widget", { scope: "project", cwd })).toBe("2.0.0");
    expect(finalizePluginUpdate(upgrade)).toMatchObject({ finalized: true });
    expect(getActiveVersion("widget", { scope: "project", cwd })).toBe("2.0.0");
  });

  it("keeps a failed rollback retryable until candidate bytes are quarantined", () => {
    installFromDirectory(makeSource("rollback-retry", "1.0.0"), {
      scope: "project",
      cwd,
    });
    const update = updatePlugin(makeSource("rollback-retry", "2.0.0"), {
      scope: "project",
      cwd,
      transactional: true,
    });
    const originalRenameSync = installDeps.renameSync;
    let injected = false;
    installDeps.renameSync = (from, to) => {
      if (
        !injected &&
        path.resolve(from) === path.resolve(update.dir) &&
        path.basename(to) === "rejected"
      ) {
        injected = true;
        throw new Error("injected candidate quarantine failure");
      }
      return originalRenameSync(from, to);
    };
    try {
      expect(() => rollbackPluginUpdate(update)).toThrow(
        /injected candidate quarantine failure/,
      );
      expect(
        getActiveVersion("rollback-retry", { scope: "project", cwd }),
      ).toBe(null);
      expect(listInstalled({ cwd, scopes: ["project"] })[0]).toMatchObject({
        name: "rollback-retry",
        runtimeBlocked: true,
        activePointer: { status: "recovery-required" },
      });
    } finally {
      installDeps.renameSync = originalRenameSync;
    }

    expect(rollbackPluginUpdate(update)).toEqual({
      rolledBack: true,
      version: "1.0.0",
      cleanupPending: false,
    });
    expect(getActiveVersion("rollback-retry", { scope: "project", cwd })).toBe(
      "1.0.0",
    );
    expect(fs.existsSync(update.dir)).toBe(false);
  });

  it("blocks runtime and retries when rollback pointer quarantine also fails", () => {
    installFromDirectory(makeSource("rollback-double", "1.0.0"), {
      scope: "project",
      cwd,
    });
    const update = updatePlugin(makeSource("rollback-double", "2.0.0"), {
      scope: "project",
      cwd,
      transactional: true,
    });
    const originalRenameSync = installDeps.renameSync;
    installDeps.renameSync = (from, to) => {
      if (
        path.resolve(from) === path.resolve(update.dir) &&
        path.basename(to) === "rejected"
      ) {
        throw new Error("injected candidate quarantine failure");
      }
      if (
        path.basename(from) === ".active" &&
        path.basename(to) === "candidate-active"
      ) {
        throw new Error("injected pointer quarantine failure");
      }
      return originalRenameSync(from, to);
    };
    try {
      expect(() => rollbackPluginUpdate(update)).toThrow(
        /active pointer fail-close also failed/,
      );
    } finally {
      installDeps.renameSync = originalRenameSync;
    }

    expect(getActiveVersion("rollback-double", { scope: "project", cwd })).toBe(
      "2.0.0",
    );
    expect(
      discoverPlugins({ cwd, scopes: ["project"], skipPolicy: true }),
    ).toEqual([]);
    expect(listInstalled({ cwd, scopes: ["project"] })[0]).toMatchObject({
      name: "rollback-double",
      runtimeBlocked: true,
      activePointer: { status: "recovery-required" },
    });
    expect(rollbackPluginUpdate(update)).toMatchObject({
      rolledBack: true,
      version: "1.0.0",
    });
    expect(getActiveVersion("rollback-double", { scope: "project", cwd })).toBe(
      "1.0.0",
    );
  });

  it("retries rollback after candidate quarantine precedes predecessor restore failure", () => {
    const original = makeSource("rollback-restore", "1.0.0");
    fs.writeFileSync(
      path.join(original, "skills", "hello", "SKILL.md"),
      "original",
    );
    installFromDirectory(original, { scope: "project", cwd });
    const replacement = makeSource("rollback-restore", "1.0.0");
    fs.writeFileSync(
      path.join(replacement, "skills", "hello", "SKILL.md"),
      "replacement",
    );
    const update = updatePlugin(replacement, {
      scope: "project",
      cwd,
      force: true,
      transactional: true,
    });

    const originalRenameSync = installDeps.renameSync;
    let injected = false;
    installDeps.renameSync = (from, to) => {
      if (!injected && path.basename(from) === "previous") {
        injected = true;
        throw new Error("injected predecessor publication failure");
      }
      return originalRenameSync(from, to);
    };
    try {
      expect(() => rollbackPluginUpdate(update)).toThrow(
        /injected predecessor publication failure/,
      );
      expect(
        getActiveVersion("rollback-restore", { scope: "project", cwd }),
      ).toBe(null);
    } finally {
      installDeps.renameSync = originalRenameSync;
    }

    expect(rollbackPluginUpdate(update)).toEqual({
      rolledBack: true,
      version: "1.0.0",
      cleanupPending: false,
    });
    expect(
      getActiveVersion("rollback-restore", { scope: "project", cwd }),
    ).toBe("1.0.0");
    expect(
      fs.readFileSync(
        path.join(update.dir, "skills", "hello", "SKILL.md"),
        "utf8",
      ),
    ).toBe("original");
  });

  it("retires non-transactional cleanup debt without locking later mutation", () => {
    const originalRmSync = installDeps.rmSync;
    installDeps.rmSync = (target, options) => {
      if (path.basename(String(target)).startsWith(".cleanup-")) {
        throw new Error("injected committed cleanup failure");
      }
      return originalRmSync(target, options);
    };
    let installed;
    try {
      installed = installFromDirectory(makeSource("install-cleanup", "1.0.0"), {
        scope: "project",
        cwd,
      });
    } finally {
      installDeps.rmSync = originalRmSync;
    }

    expect(installed).toMatchObject({
      cleanupPending: true,
      cleanupPath: expect.stringContaining(".cleanup-"),
    });
    expect(fs.existsSync(installed.cleanupPath)).toBe(true);
    expect(getActiveVersion("install-cleanup", { scope: "project", cwd })).toBe(
      "1.0.0",
    );

    setActiveVersion("install-cleanup", "1.0.0", {
      scope: "project",
      cwd,
    });
    expect(fs.existsSync(installed.cleanupPath)).toBe(false);
  });

  it("retires finalized cleanup debt without locking later mutation", () => {
    installFromDirectory(makeSource("finalize-cleanup", "1.0.0"), {
      scope: "project",
      cwd,
    });
    const update = updatePlugin(makeSource("finalize-cleanup", "2.0.0"), {
      scope: "project",
      cwd,
      transactional: true,
    });
    const originalRmSync = installDeps.rmSync;
    installDeps.rmSync = (target, options) => {
      if (path.basename(String(target)).startsWith(".cleanup-")) {
        throw new Error("injected finalized cleanup failure");
      }
      return originalRmSync(target, options);
    };
    let finalization;
    try {
      finalization = finalizePluginUpdate(update);
    } finally {
      installDeps.rmSync = originalRmSync;
    }

    expect(finalization).toMatchObject({
      finalized: true,
      cleanupPending: true,
      cleanupPath: expect.stringContaining(".cleanup-"),
    });
    expect(fs.existsSync(finalization.cleanupPath)).toBe(true);
    setActiveVersion("finalize-cleanup", "2.0.0", {
      scope: "project",
      cwd,
    });
    expect(fs.existsSync(finalization.cleanupPath)).toBe(false);
  });

  it("surfaces unretired finalized cleanup debt and permits whole-name remediation", () => {
    installFromDirectory(makeSource("finalize-recovery", "1.0.0"), {
      scope: "project",
      cwd,
    });
    const update = updatePlugin(makeSource("finalize-recovery", "2.0.0"), {
      scope: "project",
      cwd,
      transactional: true,
    });
    const nameDir = path.dirname(update.dir);
    const transactionRoot = path.join(
      nameDir,
      fs.readdirSync(nameDir).find((entry) => entry.startsWith(".install-")),
    );
    const originalRenameSync = installDeps.renameSync;
    const originalRmSync = installDeps.rmSync;
    installDeps.renameSync = (from, to) => {
      if (
        path.resolve(from) === path.resolve(transactionRoot) &&
        path.basename(to).startsWith(".cleanup-")
      ) {
        throw new Error("injected cleanup retirement failure");
      }
      return originalRenameSync(from, to);
    };
    installDeps.rmSync = (target, options) => {
      if (path.resolve(target) === path.resolve(transactionRoot)) {
        throw new Error("injected cleanup removal failure");
      }
      return originalRmSync(target, options);
    };
    let finalization;
    try {
      finalization = finalizePluginUpdate(update);
    } finally {
      installDeps.renameSync = originalRenameSync;
      installDeps.rmSync = originalRmSync;
    }

    expect(finalization).toEqual({
      finalized: true,
      cleanupPending: true,
      cleanupPath: transactionRoot,
    });
    expect(
      discoverPlugins({ cwd, scopes: ["project"], skipPolicy: true }),
    ).toEqual([]);
    expect(listInstalled({ cwd, scopes: ["project"] })[0]).toMatchObject({
      name: "finalize-recovery",
      runtimeBlocked: true,
      activePointer: {
        status: "recovery-required",
        recoveryPath: expect.stringContaining(".install-"),
      },
    });
    expect(
      uninstall("finalize-recovery", { scope: "project", cwd }),
    ).toMatchObject({ removed: ["2.0.0", "1.0.0"] });
    expect(fs.existsSync(nameDir)).toBe(false);
  });

  it("reports rollback cleanup debt without reporting state restoration as failed", () => {
    installFromDirectory(makeSource("rollback-cleanup", "1.0.0"), {
      scope: "project",
      cwd,
    });
    const update = updatePlugin(makeSource("rollback-cleanup", "2.0.0"), {
      scope: "project",
      cwd,
      transactional: true,
    });
    const originalRmSync = installDeps.rmSync;
    installDeps.rmSync = (target, options) => {
      if (path.basename(String(target)).startsWith(".cleanup-")) {
        throw new Error("injected cleanup failure");
      }
      return originalRmSync(target, options);
    };
    let rollback;
    try {
      rollback = rollbackPluginUpdate(update);
    } finally {
      installDeps.rmSync = originalRmSync;
    }

    expect(rollback).toMatchObject({
      rolledBack: true,
      version: "1.0.0",
      cleanupPending: true,
      cleanupPath: expect.stringContaining(".cleanup-"),
    });
    expect(
      getActiveVersion("rollback-cleanup", { scope: "project", cwd }),
    ).toBe("1.0.0");
    expect(fs.existsSync(rollback.cleanupPath)).toBe(true);
    setActiveVersion("rollback-cleanup", "1.0.0", {
      scope: "project",
      cwd,
    });
    expect(fs.existsSync(rollback.cleanupPath)).toBe(false);
  });
});

describe("signed legacy provenance migration", () => {
  it("backfills only an exact payload-bound signed authority", () => {
    const installed = installFromDirectory(
      makeSource("legacy-provenance", "1.0.0"),
      { scope: "project", cwd },
    );
    fs.rmSync(path.join(installed.dir, ".plugin-source.json"));
    const plan = planPluginProvenanceMigration("legacy-provenance", {
      scope: "project",
      cwd,
      version: "1.0.0",
      issuedAt: "2026-08-18T00:00:00.000Z",
      sourceMetadata: { type: "local", source: "reviewed-legacy-source" },
    });
    const signed = signProvenancePlan(plan);

    expect(
      migratePluginProvenance("legacy-provenance", {
        scope: "project",
        cwd,
        version: "1.0.0",
        attestation: signed.attestation,
        expectedSignerSha256: signed.signerPublicKeySha256,
      }),
    ).toMatchObject({
      migrated: true,
      signerPublicKeySha256: signed.signerPublicKeySha256,
    });
    expect(
      readSourceMetadataStrict(installed.dir, { required: true }),
    ).toMatchObject({
      type: "local",
      source: "reviewed-legacy-source",
      migrationAttestation: {
        signerPublicKeySha256: signed.signerPublicKeySha256,
        authority: {
          subject: {
            name: "legacy-provenance",
            version: "1.0.0",
            scope: "project",
          },
        },
      },
    });
  });

  it("rejects payload drift, signer mismatch, and provenance overwrite", () => {
    const installed = installFromDirectory(
      makeSource("legacy-reject", "1.0.0"),
      { scope: "project", cwd },
    );
    expect(() =>
      planPluginProvenanceMigration("legacy-reject", {
        scope: "project",
        cwd,
        version: "1.0.0",
        sourceMetadata: { type: "local", source: "reviewed" },
      }),
    ).toThrow(/never overwrites provenance/u);

    fs.rmSync(path.join(installed.dir, ".plugin-source.json"));
    const plan = planPluginProvenanceMigration("legacy-reject", {
      scope: "project",
      cwd,
      version: "1.0.0",
      issuedAt: "2026-08-18T00:00:00.000Z",
      sourceMetadata: { type: "local", source: "reviewed" },
    });
    const signed = signProvenancePlan(plan);
    expect(() =>
      migratePluginProvenance("legacy-reject", {
        scope: "project",
        cwd,
        version: "1.0.0",
        attestation: signed.attestation,
        expectedSignerSha256: "0".repeat(64),
      }),
    ).toThrow(/pinned fingerprint/u);

    fs.writeFileSync(path.join(installed.dir, "drift.txt"), "changed", "utf8");
    expect(() =>
      migratePluginProvenance("legacy-reject", {
        scope: "project",
        cwd,
        version: "1.0.0",
        attestation: signed.attestation,
        expectedSignerSha256: signed.signerPublicKeySha256,
      }),
    ).toThrow(/does not match installed bytes/u);
  });

  it("detects a tampered stored migration signature", () => {
    const installed = installFromDirectory(
      makeSource("legacy-tamper", "1.0.0"),
      { scope: "project", cwd },
    );
    const metadataFile = path.join(installed.dir, ".plugin-source.json");
    fs.rmSync(metadataFile);
    const plan = planPluginProvenanceMigration("legacy-tamper", {
      scope: "project",
      cwd,
      version: "1.0.0",
      issuedAt: "2026-08-18T00:00:00.000Z",
      sourceMetadata: { type: "local", source: "reviewed" },
    });
    const signed = signProvenancePlan(plan);
    migratePluginProvenance("legacy-tamper", {
      scope: "project",
      cwd,
      version: "1.0.0",
      attestation: signed.attestation,
      expectedSignerSha256: signed.signerPublicKeySha256,
    });
    const stored = JSON.parse(fs.readFileSync(metadataFile, "utf8"));
    stored.migrationAttestation.signatureBase64 = Buffer.alloc(64, 7).toString(
      "base64",
    );
    fs.writeFileSync(metadataFile, JSON.stringify(stored), "utf8");

    expect(() =>
      readSourceMetadataStrict(installed.dir, { required: true }),
    ).toThrow(/signature verification failed/u);
  });

  it("rejects component-SBOM rewrites and linked provenance authority", () => {
    const locked = installFromDirectory(makeSource("legacy-locked", "1.0.0"), {
      scope: "project",
      cwd,
    });
    fs.rmSync(path.join(locked.dir, ".plugin-source.json"));
    fs.writeFileSync(
      path.join(locked.dir, ".plugin-lock.json"),
      JSON.stringify({ sbom: { digest: "historical" } }),
      "utf8",
    );
    const plan = planPluginProvenanceMigration("legacy-locked", {
      scope: "project",
      cwd,
      version: "1.0.0",
      issuedAt: "2026-08-18T00:00:00.000Z",
      sourceMetadata: { type: "local", source: "reviewed" },
    });
    const signed = signProvenancePlan(plan);
    expect(() =>
      migratePluginProvenance("legacy-locked", {
        scope: "project",
        cwd,
        version: "1.0.0",
        attestation: signed.attestation,
        expectedSignerSha256: signed.signerPublicKeySha256,
      }),
    ).toThrow(/component-SBOM lock/u);

    fs.rmSync(path.join(locked.dir, ".plugin-lock.json"));
    migratePluginProvenance("legacy-locked", {
      scope: "project",
      cwd,
      version: "1.0.0",
      attestation: signed.attestation,
      expectedSignerSha256: signed.signerPublicKeySha256,
    });
    const metadata = path.join(locked.dir, ".plugin-source.json");
    const outside = path.join(cwd, "linked-source-metadata.json");
    fs.renameSync(metadata, outside);
    fs.linkSync(outside, metadata);
    expect(() =>
      readSourceMetadataStrict(locked.dir, { required: true }),
    ).toThrow(/PLUGIN_SOURCE_METADATA_UNSAFE/u);
  });
});

describe("uninstall + rollback", () => {
  it("removes a whole plugin (all versions)", () => {
    installFromDirectory(makeSource("greeter", "1.0.0"), {
      scope: "project",
      cwd,
    });
    installFromDirectory(makeSource("greeter", "2.0.0"), {
      scope: "project",
      cwd,
    });
    const res = uninstall("greeter", { scope: "project", cwd });
    expect(res.removed.sort()).toEqual(["1.0.0", "2.0.0"]);
    expect(listInstalled({ cwd, scopes: ["project"] })).toHaveLength(0);
  });

  it("preflights the lower-scope authority exposed by whole-name uninstall", () => {
    installFromDirectory(makeSource("scope-uninstall", "1.0.0"), {
      scope: "project",
      cwd,
    });
    installFromDirectory(makeSource("scope-uninstall", "2.0.0"), {
      scope: "local",
      cwd,
    });

    expect(() => uninstall("scope-uninstall", { scope: "local", cwd })).toThrow(
      /SOURCE_SWITCH_APPROVAL_REQUIRED/,
    );
    expect(getActiveVersion("scope-uninstall", { scope: "local", cwd })).toBe(
      "2.0.0",
    );

    uninstall("scope-uninstall", {
      scope: "local",
      cwd,
      allowSourceSwitch: true,
    });
    expect(
      discoverPlugins({ cwd, skipPolicy: true }).find(
        ({ name }) => name === "scope-uninstall",
      ),
    ).toMatchObject({ scope: "project", version: "1.0.0" });
  });

  it("requires explicit remediation before a blocked higher scope exposes fallback", () => {
    installFromDirectory(makeSource("scope-blocked-remove", "1.0.0"), {
      scope: "project",
      cwd,
    });
    const local = installFromDirectory(
      makeSource("scope-blocked-remove", "2.0.0"),
      { scope: "local", cwd },
    );
    fs.rmSync(path.join(local.dir, "plugin.json"));

    expect(() =>
      uninstall("scope-blocked-remove", {
        scope: "local",
        cwd,
        allowBlockedIdentity: true,
      }),
    ).toThrow(/SOURCE_SWITCH_APPROVAL_REQUIRED/);
    expect(fs.existsSync(local.dir)).toBe(true);

    uninstall("scope-blocked-remove", {
      scope: "local",
      cwd,
      allowBlockedIdentity: true,
      allowSourceSwitch: true,
    });
    expect(
      discoverPlugins({ cwd, skipPolicy: true }).find(
        ({ name }) => name === "scope-blocked-remove",
      ),
    ).toMatchObject({ scope: "project", version: "1.0.0" });
  });

  it("removes one version and repoints active to the newest remaining", () => {
    installFromDirectory(makeSource("greeter", "1.0.0"), {
      scope: "project",
      cwd,
    });
    installFromDirectory(makeSource("greeter", "2.0.0"), {
      scope: "project",
      cwd,
    });
    // active is 2.0.0 (last installed); remove it → active falls back to 1.0.0
    uninstall("greeter", {
      scope: "project",
      cwd,
      version: "2.0.0",
      allowSourceSwitch: true,
    });
    expect(getActiveVersion("greeter", { scope: "project", cwd })).toBe(
      "1.0.0",
    );
  });

  it("preflights automatic fallback before removing a v2-bound active version", () => {
    const fallback = makeSource("protected-uninstall", "2.0.0");
    installFromSource(fallback, { scope: "project", cwd });
    const bound = makeSource("protected-uninstall", "1.0.0");
    const semantic = semanticSourceMetadata(bound, "protected-uninstall");
    installFromSource(bound, {
      scope: "project",
      cwd,
      sourceMetadata: semantic.metadata,
      remoteSbomBytes: semantic.bytes,
    });

    expect(() =>
      uninstall("protected-uninstall", {
        scope: "project",
        cwd,
        version: "1.0.0",
      }),
    ).toThrow(/SEMANTIC_SBOM_BINDING_DOWNGRADE/);
    expect(() =>
      uninstall("protected-uninstall", {
        scope: "project",
        cwd,
        version: "1.0.0",
        allowSourceSwitch: true,
      }),
    ).toThrow(/SEMANTIC_SBOM_BINDING_DOWNGRADE/);
    expect(
      getActiveVersion("protected-uninstall", { scope: "project", cwd }),
    ).toBe("1.0.0");
    expect(
      listInstalledVersions("project", "protected-uninstall", { cwd }),
    ).toEqual(["2.0.0", "1.0.0"]);
  });

  it("does not mutate version directories when the active pointer is invalid", () => {
    installFromDirectory(makeSource("invalid-uninstall", "1.0.0"), {
      scope: "project",
      cwd,
    });
    installFromDirectory(makeSource("invalid-uninstall", "2.0.0"), {
      scope: "project",
      cwd,
    });
    const activeFile = path.join(
      path.dirname(
        pluginVersionDir("project", "invalid-uninstall", "2.0.0", { cwd }),
      ),
      ".active",
    );
    fs.writeFileSync(activeFile, "9.9.9", "utf8");

    expect(() =>
      uninstall("invalid-uninstall", {
        scope: "project",
        cwd,
        version: "2.0.0",
      }),
    ).toThrow(/ACTIVE_POINTER_DANGLING/);
    expect(
      listInstalledVersions("project", "invalid-uninstall", { cwd }),
    ).toEqual(["2.0.0", "1.0.0"]);
    expect(fs.readFileSync(activeFile, "utf8")).toBe("9.9.9");
    expect(listInstalled({ cwd, scopes: ["project"] })).toEqual([
      expect.objectContaining({
        name: "invalid-uninstall",
        version: null,
        versions: ["2.0.0", "1.0.0"],
        runtimeBlocked: true,
        activePointer: {
          status: "dangling",
          activeVersion: null,
          inspectionVersion: "2.0.0",
        },
      }),
    ]);
  });

  it("removing a NON-active version leaves the pinned active version untouched", () => {
    for (const v of ["1.0.0", "2.0.0", "3.0.0"]) {
      installFromDirectory(makeSource("greeter", v), { scope: "project", cwd });
    }
    // Roll back: pin the OLD version as active.
    setActiveVersion("greeter", "1.0.0", {
      scope: "project",
      cwd,
      allowSourceSwitch: true,
    });
    expect(getActiveVersion("greeter", { scope: "project", cwd })).toBe(
      "1.0.0",
    );
    // Uninstall an unrelated (non-active) version — the pin must NOT move to the
    // newest remaining (previously it silently jumped 1.0.0 → 2.0.0).
    uninstall("greeter", { scope: "project", cwd, version: "3.0.0" });
    expect(getActiveVersion("greeter", { scope: "project", cwd })).toBe(
      "1.0.0",
    );
  });

  it("setActiveVersion pins an older version (rollback)", () => {
    installFromDirectory(makeSource("greeter", "1.0.0"), {
      scope: "project",
      cwd,
    });
    installFromDirectory(makeSource("greeter", "2.0.0"), {
      scope: "project",
      cwd,
    });
    expect(getActiveVersion("greeter", { scope: "project", cwd })).toBe(
      "2.0.0",
    );
    setActiveVersion("greeter", "1.0.0", {
      scope: "project",
      cwd,
      allowSourceSwitch: true,
    });
    expect(getActiveVersion("greeter", { scope: "project", cwd })).toBe(
      "1.0.0",
    );
  });

  it("throws pinning a version that isn't installed", () => {
    installFromDirectory(makeSource("greeter", "1.0.0"), {
      scope: "project",
      cwd,
    });
    expect(() =>
      setActiveVersion("greeter", "9.9.9", { scope: "project", cwd }),
    ).toThrow(/not installed/);
  });

  it("rejects version traversal and empty version selectors without deleting plugins", () => {
    installFromDirectory(makeSource("alpha", "1.0.0"), {
      scope: "project",
      cwd,
    });
    installFromDirectory(makeSource("victim", "1.0.0"), {
      scope: "project",
      cwd,
    });

    expect(() =>
      uninstall("alpha", {
        scope: "project",
        cwd,
        version: "../victim/1.0.0",
      }),
    ).toThrow(/not installed/);
    expect(() =>
      uninstall("alpha", { scope: "project", cwd, version: "" }),
    ).toThrow(/not installed/);
    expect(listInstalledVersions("project", "victim", { cwd })).toEqual([
      "1.0.0",
    ]);
    expect(listInstalledVersions("project", "alpha", { cwd })).toEqual([
      "1.0.0",
    ]);
  });

  it("rejects unsafe plugin names before whole-plugin removal", () => {
    installFromDirectory(makeSource("safe-name", "1.0.0"), {
      scope: "project",
      cwd,
    });
    const sentinel = path.join(cwd, ".chainlesschain", "keep.txt");
    fs.writeFileSync(sentinel, "keep", "utf8");

    expect(() => uninstall("..", { scope: "project", cwd })).toThrow(
      /invalid plugin name/,
    );
    expect(fs.readFileSync(sentinel, "utf8")).toBe("keep");
    expect(listInstalledVersions("project", "safe-name", { cwd })).toEqual([
      "1.0.0",
    ]);
  });

  it("does not let an encoded-name alias remove another plugin", () => {
    const scoped = fs.mkdtempSync(path.join(srcRoot, "scoped-"));
    fs.writeFileSync(
      path.join(scoped, "plugin.json"),
      JSON.stringify({ name: "@a/b", version: "1.0.0" }),
      "utf8",
    );
    installFromDirectory(scoped, { scope: "project", cwd });

    expect(() => uninstall("__a__b", { scope: "project", cwd })).toThrow(
      /PLUGIN_NAME_DIRECTORY_IDENTITY_MISMATCH/,
    );
    expect(listInstalledVersions("project", "@a/b", { cwd })).toEqual([
      "1.0.0",
    ]);
  });

  it("restores active bytes when fallback pointer commit fails", () => {
    const source = makeSource("atomic-uninstall", "1.0.0");
    installFromDirectory(source, { scope: "project", cwd });
    fs.writeFileSync(
      path.join(source, "plugin.json"),
      JSON.stringify({ name: "atomic-uninstall", version: "2.0.0" }),
      "utf8",
    );
    installFromDirectory(source, { scope: "project", cwd });
    const originalRenameSync = installDeps.renameSync;
    installDeps.renameSync = (from, to) => {
      if (path.basename(from) === "next" && path.basename(to) === ".active") {
        throw new Error("simulated pointer commit failure");
      }
      return originalRenameSync(from, to);
    };
    try {
      expect(() =>
        uninstall("atomic-uninstall", {
          scope: "project",
          cwd,
          version: "2.0.0",
        }),
      ).toThrow(/simulated pointer commit failure/);
    } finally {
      installDeps.renameSync = originalRenameSync;
    }
    expect(
      getActiveVersion("atomic-uninstall", { scope: "project", cwd }),
    ).toBe("2.0.0");
    expect(
      listInstalledVersions("project", "atomic-uninstall", { cwd }),
    ).toEqual(["2.0.0", "1.0.0"]);
  });

  it("retires committed uninstall cleanup debt without blocking fallback", () => {
    const source = makeSource("uninstall-cleanup", "1.0.0");
    installFromDirectory(source, { scope: "project", cwd });
    fs.writeFileSync(
      path.join(source, "plugin.json"),
      JSON.stringify({ name: "uninstall-cleanup", version: "2.0.0" }),
      "utf8",
    );
    installFromDirectory(source, { scope: "project", cwd });

    const originalRmSync = installDeps.rmSync;
    installDeps.rmSync = (target, options) => {
      if (path.basename(String(target)).startsWith(".cleanup-")) {
        throw new Error("injected uninstall cleanup failure");
      }
      return originalRmSync(target, options);
    };
    let result;
    try {
      result = uninstall("uninstall-cleanup", {
        scope: "project",
        cwd,
        version: "2.0.0",
      });
    } finally {
      installDeps.rmSync = originalRmSync;
    }

    expect(result).toMatchObject({
      removed: ["2.0.0"],
      cleanupPending: true,
      cleanupPath: expect.stringContaining(".cleanup-"),
    });
    expect(
      getActiveVersion("uninstall-cleanup", { scope: "project", cwd }),
    ).toBe("1.0.0");
    expect(
      discoverPlugins({ cwd, scopes: ["project"], skipPolicy: true }),
    ).toEqual([
      expect.objectContaining({
        name: "uninstall-cleanup",
        version: "1.0.0",
        runtimeBlocked: false,
      }),
    ]);
    setActiveVersion("uninstall-cleanup", "1.0.0", {
      scope: "project",
      cwd,
    });
    expect(fs.existsSync(result.cleanupPath)).toBe(false);
  });

  it("surfaces retained uninstall recovery when fallback restoration also fails", () => {
    const source = makeSource("uninstall-recovery", "1.0.0");
    installFromDirectory(source, { scope: "project", cwd });
    fs.writeFileSync(
      path.join(source, "plugin.json"),
      JSON.stringify({ name: "uninstall-recovery", version: "2.0.0" }),
      "utf8",
    );
    const installed = installFromDirectory(source, {
      scope: "project",
      cwd,
    });
    const originalRenameSync = installDeps.renameSync;
    installDeps.renameSync = (from, to) => {
      if (path.basename(from) === "next" && path.basename(to) === ".active") {
        throw new Error("injected fallback pointer failure");
      }
      if (
        path.basename(path.dirname(from)).startsWith(".uninstall-") &&
        path.resolve(to) === path.resolve(installed.dir)
      ) {
        throw new Error("injected uninstall restore failure");
      }
      return originalRenameSync(from, to);
    };
    try {
      expect(() =>
        uninstall("uninstall-recovery", {
          scope: "project",
          cwd,
          version: "2.0.0",
        }),
      ).toThrow(/injected uninstall restore failure/);
    } finally {
      installDeps.renameSync = originalRenameSync;
    }

    expect(
      getActiveVersion("uninstall-recovery", { scope: "project", cwd }),
    ).toBe(null);
    const blocked = listInstalled({ cwd, scopes: ["project"] })[0];
    expect(blocked).toMatchObject({
      name: "uninstall-recovery",
      runtimeBlocked: true,
      activePointer: {
        status: "recovery-required",
        recoveryPath: expect.stringContaining(".uninstall-"),
      },
    });
    expect(() =>
      setActiveVersion("uninstall-recovery", "1.0.0", {
        scope: "project",
        cwd,
        allowSourceSwitch: true,
      }),
    ).toThrow(/PLUGIN_INSTALL_RECOVERY_REQUIRED/);
    expect(
      uninstall("uninstall-recovery", { scope: "project", cwd }),
    ).toMatchObject({ removed: ["1.0.0"] });
    expect(fs.existsSync(path.dirname(installed.dir))).toBe(false);
  });

  it("rejects activation and deletion through a linked plugin directory", () => {
    const pluginsRoot = path.join(cwd, ".chainlesschain", "plugins");
    const outside = fs.mkdtempSync(path.join(srcRoot, "linked-installed-"));
    const outsideVersion = path.join(outside, "1.0.0");
    fs.mkdirSync(outsideVersion, { recursive: true });
    fs.writeFileSync(
      path.join(outsideVersion, "plugin.json"),
      JSON.stringify({ name: "linked-installed", version: "1.0.0" }),
      "utf8",
    );
    fs.writeFileSync(
      path.join(outsideVersion, ".plugin-source.json"),
      JSON.stringify({ type: "local", source: outside }),
      "utf8",
    );
    fs.writeFileSync(path.join(outside, ".active"), "1.0.0", "utf8");
    fs.mkdirSync(pluginsRoot, { recursive: true });
    fs.symlinkSync(
      outside,
      path.join(pluginsRoot, "linked-installed"),
      process.platform === "win32" ? "junction" : "dir",
    );

    expect(() =>
      setActiveVersion("linked-installed", "1.0.0", {
        scope: "project",
        cwd,
      }),
    ).toThrow(/PLUGIN_NAME_DIRECTORY_UNSAFE/);
    expect(() =>
      uninstall("linked-installed", {
        scope: "project",
        cwd,
        version: "1.0.0",
      }),
    ).toThrow(/PLUGIN_NAME_DIRECTORY_UNSAFE/);
    expect(fs.existsSync(outsideVersion)).toBe(true);
    expect(fs.readFileSync(path.join(outside, ".active"), "utf8")).toBe(
      "1.0.0",
    );
  });
});

describe("enable / disable lifecycle", () => {
  it("keeps disabled versions installed but removes them from runtime discovery", () => {
    installFromDirectory(makeSource("switchable", "1.0.0"), {
      scope: "project",
      cwd,
    });
    expect(isPluginEnabled("switchable", { scope: "project", cwd })).toBe(true);

    setPluginEnabled("switchable", false, { scope: "project", cwd });
    expect(isPluginEnabled("switchable", { scope: "project", cwd })).toBe(
      false,
    );
    expect(
      discoverPlugins({ cwd, scopes: ["project"], skipPolicy: true }),
    ).toEqual([]);
    expect(listInstalled({ cwd, scopes: ["project"] })[0]).toMatchObject({
      name: "switchable",
      enabled: false,
      versions: ["1.0.0"],
    });

    setPluginEnabled("switchable", true, { scope: "project", cwd });
    expect(
      discoverPlugins({ cwd, scopes: ["project"], skipPolicy: true }),
    ).toHaveLength(1);
  });

  it("rejects lifecycle changes for a missing scoped install", () => {
    expect(() =>
      setPluginEnabled("missing", false, { scope: "project", cwd }),
    ).toThrow(/not installed/);
  });

  it("does not expose a different lower-scope source without approval", () => {
    installFromDirectory(makeSource("scope-disable", "1.0.0"), {
      scope: "project",
      cwd,
    });
    installFromDirectory(makeSource("scope-disable", "2.0.0"), {
      scope: "local",
      cwd,
    });

    expect(() =>
      setPluginEnabled("scope-disable", false, { scope: "local", cwd }),
    ).toThrow(/SOURCE_SWITCH_APPROVAL_REQUIRED/);
    expect(isPluginEnabled("scope-disable", { scope: "local", cwd })).toBe(
      true,
    );

    setPluginEnabled("scope-disable", false, {
      scope: "local",
      cwd,
      allowSourceSwitch: true,
    });
    expect(
      discoverPlugins({ cwd, skipPolicy: true }).find(
        ({ name }) => name === "scope-disable",
      ),
    ).toMatchObject({ scope: "project", version: "1.0.0" });
    expect(
      listInstalledAllScopes({ cwd, scopes: ["project", "local"] }).find(
        ({ scope }) => scope === "local",
      ),
    ).toMatchObject({
      enabled: false,
      effectiveAuthority: false,
      inactiveReason: "disabled",
    });
  });

  it("does not expose a lower-scope semantic downgrade", () => {
    installFromDirectory(makeSource("scope-semantic-fallback", "1.0.0"), {
      scope: "project",
      cwd,
    });
    const bound = makeSource("scope-semantic-fallback", "2.0.0");
    const semantic = semanticSourceMetadata(bound, "scope-semantic-fallback");
    installFromDirectory(bound, {
      scope: "local",
      cwd,
      sourceMetadata: semantic.metadata,
      remoteSbomBytes: semantic.bytes,
    });

    expect(() =>
      setPluginEnabled("scope-semantic-fallback", false, {
        scope: "local",
        cwd,
        allowSourceSwitch: true,
      }),
    ).toThrow(/SEMANTIC_SBOM_BINDING_DOWNGRADE/);
    expect(
      isPluginEnabled("scope-semantic-fallback", { scope: "local", cwd }),
    ).toBe(true);
  });

  it("rejects a weaker semantic binding installed at a higher scope", () => {
    const bound = makeSource("scope-semantic", "1.0.0");
    const semantic = semanticSourceMetadata(bound, "scope-semantic");
    installFromDirectory(bound, {
      scope: "project",
      cwd,
      sourceMetadata: semantic.metadata,
      remoteSbomBytes: semantic.bytes,
    });
    const unbound = makeSource("scope-semantic", "2.0.0");

    expect(() =>
      installFromDirectoryImpl(unbound, {
        scope: "local",
        cwd,
        allowSourceSwitch: true,
        allowDowngrade: true,
      }),
    ).toThrow(/SEMANTIC_SBOM_BINDING_DOWNGRADE/);
    expect(listInstalledVersions("local", "scope-semantic", { cwd })).toEqual(
      [],
    );
  });
});

describe("parseGitSource", () => {
  it("expands GitHub shorthand owner/repo", () => {
    expect(parseGitSource("acme/widgets")).toEqual({
      url: "https://github.com/acme/widgets.git",
      ref: null,
    });
  });

  it("passes through git URLs and keeps the #ref", () => {
    expect(parseGitSource("https://example.com/p.git#v2")).toEqual({
      url: "https://example.com/p.git",
      ref: "v2",
    });
    expect(parseGitSource("git@github.com:acme/w.git")).toMatchObject({
      url: "git@github.com:acme/w.git",
    });
    expect(parseGitSource("file:///tmp/repo#main")).toEqual({
      url: "file:///tmp/repo",
      ref: "main",
    });
  });

  it("expands bare GitLab subgroup repositories through the shared classifier", () => {
    expect(
      parseGitSource("gitlab.com/acme/platform/security/plugins#release"),
    ).toEqual({
      url: "https://gitlab.com/acme/platform/security/plugins.git",
      ref: "release",
    });
  });

  it("returns null for non-remote strings", () => {
    expect(parseGitSource(null)).toBeNull();
    expect(parseGitSource("  ")).toBeNull();
    expect(parseGitSource("./local/dir")).toBeNull();
    expect(parseGitSource("C:drive-relative-repo")).toBeNull();
    expect(parseGitSource("just-a-word")).toBeNull();
  });
});

describe("installFromSource — git (mocked clone)", () => {
  let savedSpawn;
  beforeEach(() => {
    savedSpawn = installDeps.spawnSync;
  });
  afterEach(() => {
    installDeps.spawnSync = savedSpawn;
  });

  it("rejects a canonical blocked source before git spawn", () => {
    let spawned = 0;
    installDeps.spawnSync = () => {
      spawned += 1;
      return { status: 0, stdout: "", stderr: "" };
    };
    expect(() =>
      installFromSourceImpl(
        "git@gitlab.com:acme/platform/security/plugins.git",
        {
          scope: "project",
          cwd,
          managedPolicy: {
            blockedMarketplaces: [
              "git@gitlab.com:ACME/platform/security/plugins.git",
            ],
          },
        },
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "PLUGIN_SOURCE_POLICY_BLOCKED",
        sourceIdentity: expect.stringMatching(
          /^gitlab:ssh:\/\/\[principal:[a-f0-9]{64}\]@gitlab\.com\/acme\/platform\/security\/plugins$/u,
        ),
      }),
    );
    expect(spawned).toBe(0);
  });

  it("clones a remote source and installs it", () => {
    const calls = [];
    // Emulate `git clone … <dir>` by materializing a plugin at the target dir.
    installDeps.spawnSync = (cmd, args, options) => {
      calls.push([cmd, args, options]);
      const dir = args[args.length - 1];
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, "plugin.json"),
        JSON.stringify({ name: "remote-plugin", version: "3.1.0" }),
        "utf8",
      );
      return { status: 0, stdout: "", stderr: "" };
    };
    const res = installFromSource("acme/widgets", { scope: "project", cwd });
    expect(res).toMatchObject({
      name: "remote-plugin",
      version: "3.1.0",
      source: "https://github.com/acme/widgets.git",
    });
    expect(listInstalled({ cwd, scopes: ["project"] })).toHaveLength(1);
    expect(calls).toHaveLength(1);
    const [gitExecutable, gitArgs, gitOptions] = calls[0];
    expect(path.isAbsolute(gitExecutable)).toBe(true);
    expect(path.basename(gitExecutable).toLowerCase()).toMatch(
      /^git(?:\.exe)?$/u,
    );
    expect(gitArgs).toEqual(
      expect.arrayContaining([
        "--no-pager",
        `core.hooksPath=${process.platform === "win32" ? "NUL" : "/dev/null"}`,
        "http.followRedirects=false",
        "protocol.ext.allow=never",
        "protocol.file.allow=never",
        "core.autocrlf=false",
        "core.eol=lf",
        "core.symlinks=false",
        "clone",
        "--depth",
        "1",
        "https://github.com/acme/widgets.git",
      ]),
    );
    expect(gitOptions).toMatchObject({
      origin: "plugin:install-git",
      policy: "allow",
      scope: "plugin-install",
      shell: false,
      env: expect.objectContaining({
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
        GIT_TERMINAL_PROMPT: "0",
      }),
      auditRedactArgIndexes: [
        gitArgs.indexOf("https://github.com/acme/widgets.git"),
      ],
    });
  });

  it("uses the shared classifier even when owner/repo also exists locally", () => {
    const ambiguous = path.join(cwd, "acme", "widgets");
    fs.mkdirSync(ambiguous, { recursive: true });
    fs.writeFileSync(
      path.join(ambiguous, "plugin.json"),
      JSON.stringify({ name: "wrong-local-plugin", version: "1.0.0" }),
    );
    let spawned = 0;
    installDeps.spawnSync = (_cmd, args) => {
      spawned += 1;
      const dir = args.at(-1);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, "plugin.json"),
        JSON.stringify({ name: "right-remote-plugin", version: "1.0.0" }),
      );
      return { status: 0, stdout: "", stderr: "" };
    };

    expect(
      installFromSourceImpl("acme/widgets", { scope: "project", cwd }),
    ).toMatchObject({ name: "right-remote-plugin" });
    expect(spawned).toBe(1);
  });

  it("rejects source policy and malformed refs before target fs or git I/O", () => {
    const originalExistsSync = installDeps.existsSync;
    const originalLstatSync = installDeps.lstatSync;
    let existsCalls = 0;
    let lstatCalls = 0;
    let spawnCalls = 0;
    installDeps.existsSync = () => {
      existsCalls += 1;
      return false;
    };
    installDeps.lstatSync = () => {
      lstatCalls += 1;
      throw new Error("lstat must remain unreachable");
    };
    installDeps.spawnSync = () => {
      spawnCalls += 1;
      throw new Error("git must remain unreachable");
    };
    try {
      const source =
        "https://example.com/acme/review.git?tenant=private#release";
      expect(() =>
        installFromSourceImpl(source, {
          cwd,
          managedPolicy: { blockedPluginSources: [source] },
        }),
      ).toThrowError(
        expect.objectContaining({ code: "PLUGIN_SOURCE_POLICY_BLOCKED" }),
      );
      expect(() =>
        installFromSourceImpl("https://example.com/acme/review.git#one#two", {
          cwd,
          managedPolicy: {},
        }),
      ).toThrowError(
        expect.objectContaining({ code: "PLUGIN_SOURCE_POLICY_INVALID" }),
      );
      expect(() =>
        installFromSourceImpl("ftp://example.com/acme/review.git", {
          cwd,
          managedPolicy: {},
        }),
      ).toThrowError(
        expect.objectContaining({ code: "PLUGIN_SOURCE_POLICY_INVALID" }),
      );
      const local = path.join(cwd, "blocked-local");
      expect(() =>
        installFromDirectoryImpl(local, {
          cwd,
          managedPolicy: {
            blockedPluginSources: [{ source: "directory", path: local }],
          },
        }),
      ).toThrowError(
        expect.objectContaining({ code: "PLUGIN_SOURCE_POLICY_BLOCKED" }),
      );
      expect(() =>
        installFromDirectoryImpl("acme/review", {
          cwd,
          managedPolicy: {
            blockedPluginSources: [
              {
                source: "directory",
                path: path.join(cwd, "acme", "review"),
              },
            ],
          },
        }),
      ).toThrowError(
        expect.objectContaining({ code: "PLUGIN_SOURCE_POLICY_BLOCKED" }),
      );
      expect(() =>
        installFromDirectoryImpl(` ${local} `, {
          cwd,
          managedPolicy: {},
        }),
      ).toThrowError(
        expect.objectContaining({ code: "PLUGIN_SOURCE_POLICY_INVALID" }),
      );
      const descriptor = { source: "directory", path: local };
      expect(() =>
        installFromSourceImpl(descriptor, {
          cwd,
          managedPolicy: { allowedPluginSources: [descriptor] },
        }),
      ).toThrowError(
        expect.objectContaining({ code: "PLUGIN_SOURCE_POLICY_INVALID" }),
      );
      expect(() =>
        installFromDirectoryImpl(descriptor, {
          cwd,
          managedPolicy: { allowedPluginSources: [descriptor] },
        }),
      ).toThrowError(
        expect.objectContaining({ code: "PLUGIN_SOURCE_POLICY_INVALID" }),
      );
      const aliasPolicy = {
        additionalMarketplaces: {
          company: {
            source: { source: "github", repo: "trusted/safe" },
          },
          "acme/review": {
            source: { source: "github", repo: "trusted/safe" },
          },
        },
        allowedMarketplaces: ["company", "acme/review"],
      };
      for (const aliasedCandidate of ["company", "acme/review"]) {
        expect(() =>
          installFromSourceImpl(aliasedCandidate, {
            cwd,
            managedPolicy: aliasPolicy,
          }),
        ).toThrowError(
          expect.objectContaining({ code: "PLUGIN_SOURCE_POLICY_NOT_ALLOWED" }),
        );
      }
      for (const [allowedSource, candidate] of [
        [
          "git@code.example:team/review.git",
          "git@code.example:/team/review.git",
        ],
        [
          "git@code.example:team/review.git",
          "ssh://git@code.example/team/review.git",
        ],
        [
          "git@code.example:team/review.git",
          "git@code.example:team/%72eview.git",
        ],
        ["git@code.example:team/review.git", "git@code.example:team/review"],
      ]) {
        expect(() =>
          installFromSourceImpl(candidate, {
            cwd,
            managedPolicy: { allowedPluginSources: [allowedSource] },
          }),
        ).toThrowError(
          expect.objectContaining({ code: "PLUGIN_SOURCE_POLICY_NOT_ALLOWED" }),
        );
      }
      const registry = "https://registry.example/index.json";
      const resolved = "https://github.com/acme/blocked.git#release";
      expect(() =>
        installFromSourceImpl(resolved, {
          cwd,
          sourceMetadata: {
            type: "registry",
            source: registry,
            registry,
            resolvedSource: resolved,
          },
          managedPolicy: {
            allowedMarketplaces: [{ source: "url", url: registry }],
            blockedPluginSources: [resolved],
          },
        }),
      ).toThrowError(
        expect.objectContaining({
          message: expect.stringMatching(/registry source authority/u),
        }),
      );
      expect({ existsCalls, lstatCalls, spawnCalls }).toEqual({
        existsCalls: 0,
        lstatCalls: 0,
        spawnCalls: 0,
      });
    } finally {
      installDeps.existsSync = originalExistsSync;
      installDeps.lstatSync = originalLstatSync;
    }
  });

  it("rejects argv-visible Git credentials before clone", () => {
    let spawned = 0;
    installDeps.spawnSync = () => {
      spawned += 1;
      return { status: 128, stdout: "", stderr: "SECRET_GIT_STDERR" };
    };
    let failure;
    try {
      installFromSourceImpl(
        "https://alice:password@example.com/acme/review.git?token=secret#main",
        { cwd, managedPolicy: null },
      );
    } catch (error) {
      failure = error;
    }
    expect(failure?.message).toContain("query credentials are not supported");
    expect(failure?.message).not.toMatch(/alice|password|secret/u);
    expect(spawned).toBe(0);
  });

  it("ignores caller-forged update materialization directories", () => {
    const forged = makeSource("forged-update", "9.9.9");
    let spawned = 0;
    installDeps.spawnSync = () => {
      spawned += 1;
      return { status: 128, stdout: "", stderr: "clone rejected" };
    };
    expect(() =>
      updatePluginImpl("https://github.com/acme/review.git", {
        cwd,
        managedPolicy: {},
        _materializedDir: forged,
      }),
    ).toThrow(/git clone failed/u);
    expect(spawned).toBe(1);
    expect(listInstalled({ cwd, scopes: ["project"] })).toEqual([]);
  });

  it("transfers a transactional clone handle to the returned install result", () => {
    installDeps.spawnSync = (_cmd, args) => {
      const dir = args[args.length - 1];
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, "plugin.json"),
        JSON.stringify({ name: "transactional-remote", version: "1.0.0" }),
        "utf8",
      );
      return { status: 0, stdout: "", stderr: "" };
    };

    const result = installFromSource("acme/transactional", {
      scope: "project",
      cwd,
      transactional: true,
    });
    expect(finalizePluginUpdate(result)).toMatchObject({ finalized: true });
    expect(
      getActiveVersion("transactional-remote", { scope: "project", cwd }),
    ).toBe("1.0.0");
  });

  it("removes lifecycle markers when uninstalling the final disabled version", () => {
    installFromDirectory(makeSource("final-disabled", "1.0.0"), {
      scope: "project",
      cwd,
    });
    setPluginEnabled("final-disabled", false, { scope: "project", cwd });

    expect(
      uninstall("final-disabled", {
        scope: "project",
        cwd,
        version: "1.0.0",
        allowSourceSwitch: true,
      }),
    ).toMatchObject({ removed: ["1.0.0"] });
    expect(
      fs.existsSync(
        path.dirname(
          pluginVersionDir("project", "final-disabled", "1.0.0", { cwd }),
        ),
      ),
    ).toBe(false);
  });

  it("reports a clear error when git is not installed", () => {
    installDeps.spawnSync = () => ({ error: { code: "ENOENT" }, status: null });
    expect(() =>
      installFromSource("acme/widgets", { scope: "project", cwd }),
    ).toThrow(/git is not installed/);
  });

  it("does not materialize or persist URL credentials and query tokens", () => {
    let spawned = 0;
    installDeps.spawnSync = () => {
      spawned += 1;
      return { status: 0, stdout: "", stderr: "" };
    };
    expect(() =>
      installFromSource(
        "https://alice:secret@example.com/private.git?token=hidden#main",
        { scope: "project", cwd },
      ),
    ).toThrow(/query credentials are not supported/u);
    expect(spawned).toBe(0);
    expect(listInstalled({ cwd, scopes: ["project"] })).toEqual([]);
  });
});

// Real end-to-end against a LOCAL git repo (offline) — only when git exists.
let gitAvailable = false;
try {
  execSync("git --version", { stdio: "ignore" });
  gitAvailable = true;
} catch {
  gitAvailable = false;
}

describe.skipIf(!gitAvailable)(
  "installFromSource — git (real, local repo)",
  () => {
    it("clones a file:// repo and installs the plugin", () => {
      const repo = fs.mkdtempSync(path.join(os.tmpdir(), "cc-gitrepo-"));
      fs.writeFileSync(
        path.join(repo, "plugin.json"),
        JSON.stringify({ name: "git-plugin", version: "1.0.0" }),
        "utf8",
      );
      const skillDir = path.join(repo, "skills", "gskill");
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(
        path.join(skillDir, "SKILL.md"),
        "---\nname: gskill\n---\nx",
        "utf8",
      );
      const git = (args) =>
        execSync(`git ${args}`, { cwd: repo, stdio: "ignore" });
      git("init -q");
      git("-c user.email=t@t -c user.name=t add -A");
      execSync("git -c user.email=t@t -c user.name=t commit -q -m init", {
        cwd: repo,
        stdio: "ignore",
      });

      const url = "file://" + repo.replace(/\\/g, "/");
      try {
        const res = installFromSource(url, { scope: "project", cwd });
        expect(res.name).toBe("git-plugin");
        const rows = listInstalled({ cwd, scopes: ["project"] });
        expect(rows.map((r) => r.name)).toContain("git-plugin");
      } finally {
        try {
          fs.rmSync(repo, { recursive: true, force: true });
        } catch {
          /* best-effort */
        }
      }
    });
  },
);
