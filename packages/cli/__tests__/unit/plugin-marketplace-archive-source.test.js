import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchAndMaterializeMarketplaceArchive } from "../../src/lib/plugin-runtime/marketplace-archive-source.js";
import { buildPluginMarketplaceInstallPreflight } from "../../src/lib/plugin-runtime/marketplace-catalog.js";
import {
  assertMarketplaceSourceExecutable,
  MARKETPLACE_DYNAMIC_SOURCE_DISABLED_CODE,
  normalizeMarketplacePackageSource,
} from "../../src/lib/plugin-runtime/marketplace-source-adapter.js";
import {
  _deps as remoteSourceDependencies,
  listRegistryPlugins,
  resolveRemoteSource,
  validateRegistry,
} from "../../src/lib/plugin-runtime/remote-source.js";
import {
  installFromSource,
  listInstalled,
} from "../../src/lib/plugin-runtime/install.js";

function writeTarText(header, offset, length, value) {
  Buffer.from(value, "utf8").copy(header, offset, 0, length);
}

function writeTarOctal(header, offset, length, value) {
  const text = Math.max(0, value)
    .toString(8)
    .padStart(length - 1, "0")
    .slice(-(length - 1));
  writeTarText(header, offset, length, `${text}\0`);
}

function tarEntry(name, content = Buffer.alloc(0), type = "0") {
  const data = Buffer.isBuffer(content) ? content : Buffer.from(content);
  const header = Buffer.alloc(512);
  writeTarText(header, 0, 100, name);
  writeTarOctal(header, 100, 8, type === "5" ? 0o755 : 0o644);
  writeTarOctal(header, 108, 8, 0);
  writeTarOctal(header, 116, 8, 0);
  writeTarOctal(header, 124, 12, data.length);
  writeTarOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  writeTarText(header, 156, 1, type);
  writeTarText(header, 257, 6, "ustar\0");
  writeTarText(header, 263, 2, "00");
  let checksum = 0;
  for (const byte of header) checksum += byte;
  const checksumText = checksum.toString(8).padStart(6, "0");
  writeTarText(header, 148, 8, `${checksumText}\0 `);
  const padding = Buffer.alloc(
    Math.ceil(data.length / 512) * 512 - data.length,
  );
  return Buffer.concat([header, data, padding]);
}

function pluginArchive(entries = []) {
  const manifest = JSON.stringify({
    name: "archive-plugin",
    version: "1.0.0",
    description: "archive fixture",
  });
  return gzipSync(
    Buffer.concat([
      tarEntry("package/", Buffer.alloc(0), "5"),
      tarEntry("package/plugin.json", manifest),
      tarEntry("package/index.js", "export const value = 1;\n"),
      ...entries,
      Buffer.alloc(1024),
    ]),
  );
}

function digest(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

describe("Marketplace source adapter", () => {
  it("keeps legacy git sources and normalizes explicit archives", () => {
    expect(
      normalizeMarketplacePackageSource({
        source: "https://git.example/plugin.git",
        ref: "v1",
      }),
    ).toEqual({
      type: "git",
      source: "https://git.example/plugin.git",
      ref: "v1",
    });
    expect(
      normalizeMarketplacePackageSource({
        source: {
          type: "archive",
          url: "https://registry.example/archive-plugin.tgz?token=secret#download",
          sha256: "a".repeat(64),
        },
      }),
    ).toEqual({
      type: "archive",
      url: "https://registry.example/archive-plugin.tgz",
      sha256: "a".repeat(64),
      format: "tgz",
    });
    expect(
      JSON.stringify(
        normalizeMarketplacePackageSource({
          source: {
            type: "archive",
            url: "https://registry.example/archive-plugin.tgz?token=secret",
            sha256: "a".repeat(64),
          },
        }),
      ),
    ).not.toContain("secret");
  });

  it("keeps command and headers helpers disabled without executing them", () => {
    const command = vi.fn();
    const entry = { source: { type: "command", command } };
    expect(normalizeMarketplacePackageSource(entry)).toMatchObject({
      type: "dynamic-disabled",
      enabled: false,
      code: MARKETPLACE_DYNAMIC_SOURCE_DISABLED_CODE,
    });
    expect(() => assertMarketplaceSourceExecutable(entry)).toThrowError(
      expect.objectContaining({
        code: MARKETPLACE_DYNAMIC_SOURCE_DISABLED_CODE,
      }),
    );
    expect(command).not.toHaveBeenCalled();

    const withHelper = {
      source: "https://git.example/plugin.git",
      headersHelper: "secret-helper",
    };
    expect(normalizeMarketplacePackageSource(withHelper)).toMatchObject({
      type: "dynamic-disabled",
      requestedType: "headers-helper",
    });
    expect(() => assertMarketplaceSourceExecutable(withHelper)).toThrowError(
      expect.objectContaining({
        code: MARKETPLACE_DYNAMIC_SOURCE_DISABLED_CODE,
      }),
    );

    const nestedHelper = {
      source: {
        type: "archive",
        url: "https://registry.example/plugin.tgz",
        sha256: "a".repeat(64),
        headersHelper: "secret-helper",
      },
    };
    expect(normalizeMarketplacePackageSource(nestedHelper)).toMatchObject({
      type: "dynamic-disabled",
      requestedType: "headers-helper",
    });
    expect(() => assertMarketplaceSourceExecutable(nestedHelper)).toThrowError(
      expect.objectContaining({
        code: MARKETPLACE_DYNAMIC_SOURCE_DISABLED_CODE,
      }),
    );
  });

  it("projects disabled dynamic entries without exposing command bytes", () => {
    const registry = validateRegistry({
      plugins: [
        { name: "dynamic", source: { type: "command", command: "TOKEN" } },
      ],
    });
    const rows = listRegistryPlugins(registry);
    expect(rows[0]).toMatchObject({
      name: "dynamic",
      source: null,
      sourceType: "dynamic-disabled",
      enabled: false,
    });
    expect(JSON.stringify(rows)).not.toContain("TOKEN");
  });
});

describe("Marketplace HTTPS archive source", () => {
  let root;
  let artifactCacheDir;
  let sourceCacheDir;
  let originalRegistryFetch;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-marketplace-archive-"));
    artifactCacheDir = path.join(root, "artifacts");
    sourceCacheDir = path.join(root, "sources");
    originalRegistryFetch = remoteSourceDependencies.fetch;
  });

  afterEach(() => {
    remoteSourceDependencies.fetch = originalRegistryFetch;
    fs.rmSync(root, { recursive: true, force: true });
  });

  async function materialize(bytes, overrides = {}) {
    return fetchAndMaterializeMarketplaceArchive({
      registryUrl: "https://registry.example/index.json",
      url: "https://registry.example/archive-plugin.tgz",
      sha256: digest(bytes),
      token: "top-secret-token",
      artifactCacheDir,
      sourceCacheDir,
      fetchImpl: async (_url, request) => {
        expect(request.headers.Authorization).toBe("Bearer top-secret-token");
        return new Response(bytes, {
          status: 200,
          headers: { "content-length": String(bytes.length) },
        });
      },
      ...overrides,
    });
  }

  it("verifies, safely extracts, and binds an immutable package projection", async () => {
    const bytes = pluginArchive();
    const result = await materialize(bytes);

    expect(
      JSON.parse(fs.readFileSync(path.join(result.dir, "plugin.json"))),
    ).toMatchObject({
      name: "archive-plugin",
      version: "1.0.0",
    });
    expect(result.authority).toMatchObject({
      status: "digest-verified-and-extracted",
      archiveSha256: digest(bytes),
      registryOrigin: "https://registry.example",
      fromCache: false,
      fileCount: 2,
    });
    expect(JSON.stringify(result.authority)).not.toContain("top-secret-token");
  });

  it("recovers offline from verified bytes and ignores crash temp directories", async () => {
    const bytes = pluginArchive();
    const online = await materialize(bytes);
    fs.mkdirSync(path.join(sourceCacheDir, ".tmp-crashed-install"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(path.dirname(online.dir), "authority.json"),
      '{"truncated":true}\n',
    );

    const offline = await materialize(bytes, {
      offline: true,
      fetchImpl: async () => {
        throw new Error("network must stay unused offline");
      },
    });
    expect(offline.dir).toBe(online.dir);
    expect(offline.authority.fromCache).toBe(true);
  });

  it("rejects archive digest mismatch, cross-origin URLs, and traversal", async () => {
    const bytes = pluginArchive();
    await expect(
      materialize(bytes, { sha256: "0".repeat(64) }),
    ).rejects.toMatchObject({ code: "DIGEST_MISMATCH" });

    await expect(
      materialize(bytes, {
        url: "https://cdn.example/archive-plugin.tgz",
      }),
    ).rejects.toMatchObject({ code: "CROSS_ORIGIN_ARTIFACT_REJECTED" });
    const crossOriginPreflight = buildPluginMarketplaceInstallPreflight({
      registryUrl: "https://registry.example/index.json",
      entry: {
        name: "archive-plugin",
        version: "1.0.0",
        source: {
          type: "archive",
          url: "https://cdn.example/archive-plugin.tgz",
          sha256: digest(bytes),
        },
      },
    }).preflight;
    expect(crossOriginPreflight.status).toBe("blocked");
    expect(crossOriginPreflight.blockers).toContainEqual({
      code: "ARCHIVE_SOURCE_ORIGIN_MISMATCH",
    });

    const traversal = pluginArchive([tarEntry("package/../escape.txt", "no")]);
    await expect(materialize(traversal)).rejects.toThrow(/package\/ root/u);
    expect(fs.existsSync(path.join(root, "escape.txt"))).toBe(false);

    const windowsAlternateStream = pluginArchive([
      tarEntry("package/plugin.json:secret", "no"),
    ]);
    await expect(materialize(windowsAlternateStream)).rejects.toThrow(
      /package\/ root/u,
    );

    const metadataFlood = pluginArchive(
      Array.from({ length: 10_001 }, () => tarEntry("pax", "", "g")),
    );
    await expect(materialize(metadataFlood)).rejects.toThrow(
      /too many entries/u,
    );
  });

  it("keeps candidate archive bytes at zero until governance preflight allows them", async () => {
    const bytes = pluginArchive();
    const archiveFetch = vi.fn(
      async () => new Response(bytes, { status: 200 }),
    );
    const registry = {
      plugins: [
        {
          name: "archive-plugin",
          version: "1.0.0",
          source: {
            type: "archive",
            url: "https://registry.example/archive-plugin.tgz",
            sha256: digest(bytes),
          },
          compatibility: { cc: ">=9.0.0" },
        },
      ],
    };
    remoteSourceDependencies.fetch = async () =>
      new Response(JSON.stringify(registry), { status: 200 });

    const inspected = await resolveRemoteSource(
      "https://registry.example/index.json",
      {
        name: "archive-plugin",
        materialize: false,
        archiveFetchImpl: archiveFetch,
      },
    );
    const { preflight } = buildPluginMarketplaceInstallPreflight({
      registryUrl: "https://registry.example/index.json",
      entry: inspected.entry,
      hostVersion: "0.163.8",
    });

    expect(inspected).toMatchObject({ source: null, sourceType: "archive" });
    expect(preflight.status).toBe("blocked");
    expect(preflight.claims.pluginBytesFetched).toBe(false);
    expect(archiveFetch).not.toHaveBeenCalled();
  });

  it("resolves an archive registry entry to the verified local package", async () => {
    const bytes = pluginArchive();
    const registry = {
      plugins: [
        {
          name: "archive-plugin",
          version: "1.0.0",
          source: {
            type: "archive",
            url: "https://registry.example/archive-plugin.tgz",
            sha256: digest(bytes),
          },
        },
      ],
    };
    remoteSourceDependencies.fetch = async () =>
      new Response(JSON.stringify(registry), { status: 200 });
    const resolved = await resolveRemoteSource(
      "https://registry.example/index.json",
      {
        name: "archive-plugin",
        artifactCacheDir,
        archiveSourceCacheDir: sourceCacheDir,
        archiveFetchImpl: async (url) => {
          return new Response(bytes, { status: 200 });
        },
      },
    );
    expect(resolved.sourceType).toBe("archive");
    expect(resolved.sourceIdentity).toBe(
      "https://registry.example/archive-plugin.tgz",
    );
    expect(fs.existsSync(path.join(resolved.source, "plugin.json"))).toBe(true);
  });

  it("persists archive and payload authority through installation readback", async () => {
    const bytes = pluginArchive();
    remoteSourceDependencies.fetch = async () =>
      new Response(
        JSON.stringify({
          plugins: [
            {
              name: "archive-plugin",
              version: "1.0.0",
              source: {
                type: "archive",
                url: "https://registry.example/archive-plugin.tgz",
                sha256: digest(bytes),
              },
            },
          ],
        }),
        { status: 200 },
      );
    const resolved = await resolveRemoteSource(
      "https://registry.example/index.json",
      {
        name: "archive-plugin",
        artifactCacheDir,
        archiveSourceCacheDir: sourceCacheDir,
        archiveFetchImpl: async () => new Response(bytes, { status: 200 }),
      },
    );
    const cwd = path.join(root, "project");
    fs.mkdirSync(cwd);
    installFromSource(resolved.source, {
      scope: "project",
      cwd,
      registryResolutionAuthority: resolved.registryResolutionAuthority,
      expectedIdentity: { name: "archive-plugin", version: "1.0.0" },
      sourceMetadata: {
        type: "registry",
        source: "https://registry.example/index.json",
        registry: "https://registry.example/index.json",
        package: "archive-plugin",
        resolvedSource: "https://registry.example/archive-plugin.tgz",
        catalogAuthority: {
          catalogDigest: "a".repeat(64),
          candidateId: `candidate-${"b".repeat(20)}`,
          candidateDigest: "c".repeat(64),
          governanceStatus: "complete",
          registryStatus: "online",
          versionAuthority: "registry-declared-unverified",
          archiveSource: resolved.archiveAuthority,
        },
      },
    });

    const installed = listInstalled({ cwd, scopes: ["project"] });
    expect(installed).toHaveLength(1);
    expect(installed[0].source).toMatchObject({
      resolvedSource: "https://registry.example/archive-plugin.tgz",
      catalogAuthority: {
        archiveSource: {
          archiveSha256: digest(bytes),
          payloadSha256: resolved.archiveAuthority.payloadSha256,
          status: "digest-verified-and-extracted",
        },
      },
    });

    expect(() =>
      installFromSource(resolved.source, {
        scope: "local",
        cwd,
        registryResolutionAuthority: resolved.registryResolutionAuthority,
        expectedIdentity: { name: "archive-plugin", version: "1.0.0" },
        sourceMetadata: {
          ...installed[0].source,
          registry: "https://other.example/index.json",
        },
      }),
    ).toThrow(/registry source authority|selected registry and source/u);
  });
});
