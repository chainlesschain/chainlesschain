import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import { registerPluginCommand } from "../../src/commands/plugin.js";
import {
  _deps as installDeps,
  getActiveVersion,
  listInstalled,
  readSourceMetadataStrict,
} from "../../src/lib/plugin-runtime/install.js";
import { _resetPolicyCache } from "../../src/lib/plugin-runtime/policy.js";
import {
  PLUGIN_MARKETPLACE_CANONICAL_PAYLOAD_SBOM_SCHEMA,
  PLUGIN_MARKETPLACE_PAYLOAD_SBOM_SCHEMA,
  PLUGIN_MARKETPLACE_REMOTE_SBOM_PAYLOAD_COMPARISON_SCHEMA,
  buildMarketplacePayloadSbom,
} from "../../src/lib/plugin-runtime/marketplace-artifact-readback.js";
import { buildPluginSbom } from "../../src/lib/plugin-runtime/signature.js";
import { pluginLifecycleCoordinatorLock } from "../../src/lib/plugin-runtime/scopes.js";

const REMOTE_ARTIFACT_EVIDENCE_SCHEMA =
  "cc-plugin-marketplace-remote-artifact-evidence/v1";
const PLUGIN_NAME = "remote-artifact-plugin";
const PLUGIN_VERSION = "1.0.0";
const REGISTRY_GIT_SOURCE_PREFIX =
  "https://git.example.invalid/remote-artifact-plugin-";

let cwd;
let sourceRoot;
let source;
let registrySource;
let server;
let baseUrl;
let registryUrl;
let logSpy;
let errorSpy;
let requestUrls;
let signatureDeclarationMode;
let sbomDeclarationMode;
let registryVersion;
let omitRegistryVersion;
let originalAppData;
let originalXdgConfigHome;
let originalManagedSettings;
let publisherDeclaration;
let manifestBytes;
let manifestSha256;
let signatureBytes;
let signatureSha256;
let publicKeyPem;
let publicKeyDocumentSha256;
let publicKeySpkiSha256;
let sbomBytes;
let sbomSha256;
let legacyPayloadSha256;
let canonicalPayloadSha256;
let signingPrivateKey;
let archiveBytes;
let originalSpawnSync;

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function tarField(header, offset, length, value) {
  Buffer.from(value, "utf8").copy(header, offset, 0, length);
}

function tarOctal(header, offset, length, value) {
  tarField(
    header,
    offset,
    length,
    `${value.toString(8).padStart(length - 1, "0")}\0`,
  );
}

function tarEntry(name, content = Buffer.alloc(0), type = "0") {
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
  const header = Buffer.alloc(512);
  tarField(header, 0, 100, name);
  tarOctal(header, 100, 8, type === "5" ? 0o755 : 0o644);
  tarOctal(header, 108, 8, 0);
  tarOctal(header, 116, 8, 0);
  tarOctal(header, 124, 12, bytes.length);
  tarOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  tarField(header, 156, 1, type);
  tarField(header, 257, 6, "ustar\0");
  tarField(header, 263, 2, "00");
  let checksum = 0;
  for (const byte of header) checksum += byte;
  tarField(header, 148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `);
  return Buffer.concat([
    header,
    bytes,
    Buffer.alloc(Math.ceil(bytes.length / 512) * 512 - bytes.length),
  ]);
}

function pluginArchive(manifest) {
  return gzipSync(
    Buffer.concat([
      tarEntry("package/", Buffer.alloc(0), "5"),
      tarEntry("package/plugin.json", manifest),
      Buffer.alloc(1024),
    ]),
  );
}

function makeProgram() {
  const program = new Command();
  program.exitOverride();
  registerPluginCommand(program);
  return program;
}

async function run(...argv) {
  logSpy.mockClear();
  errorSpy.mockClear();
  process.exitCode = 0;
  await makeProgram().parseAsync(["node", "cc", "plugin", ...argv]);
  const stdout = logSpy.mock.calls
    .map((call) => call.map((value) => String(value ?? "")).join(" "))
    .join("\n");
  const stderr = errorSpy.mock.calls
    .map((call) => call.map((value) => String(value ?? "")).join(" "))
    .join("\n");
  const exitCode = process.exitCode || 0;
  process.exitCode = 0;
  return { exitCode, stdout, stderr };
}

function declaredArtifactUrl(pathname, secretName) {
  return `${baseUrl}${pathname}?${secretName}=must-not-persist#download`;
}

function prepareRegistryVersion(version) {
  registryVersion = version;
  manifestBytes = Buffer.from(
    JSON.stringify({
      name: PLUGIN_NAME,
      version,
      license: "Apache-2.0",
    }),
  );
  fs.writeFileSync(path.join(source, "plugin.json"), manifestBytes);
  manifestSha256 = sha256(manifestBytes);
  signatureBytes = crypto.sign(null, manifestBytes, signingPrivateKey);
  signatureSha256 = sha256(signatureBytes);
  const legacyPayloadSbom = buildMarketplacePayloadSbom(source);
  const canonicalPayloadSbom = buildMarketplacePayloadSbom(source, {
    schemaVersion: PLUGIN_MARKETPLACE_CANONICAL_PAYLOAD_SBOM_SCHEMA,
  });
  legacyPayloadSha256 = legacyPayloadSbom.digest;
  canonicalPayloadSha256 = canonicalPayloadSbom.digest;
  const semanticPayloadSbom =
    sbomDeclarationMode === "payload-bound-v1"
      ? legacyPayloadSbom
      : canonicalPayloadSbom;
  sbomBytes = Buffer.from(
    JSON.stringify(
      ["payload-bound", "payload-bound-v1"].includes(sbomDeclarationMode)
        ? semanticPayloadSbom
        : {
            bomFormat: "CycloneDX",
            specVersion: "1.5",
            version: 1,
            metadata: {
              component: {
                type: "application",
                name: PLUGIN_NAME,
                version,
              },
            },
            components: [],
          },
    ),
  );
  sbomSha256 = sha256(sbomBytes);
}

function registrySbomDeclaration() {
  if (sbomDeclarationMode === "v2-incomplete") {
    return {
      format: PLUGIN_MARKETPLACE_CANONICAL_PAYLOAD_SBOM_SCHEMA,
      digest: canonicalPayloadSha256,
    };
  }
  const declaration = {
    format:
      sbomDeclarationMode === "payload-bound"
        ? PLUGIN_MARKETPLACE_CANONICAL_PAYLOAD_SBOM_SCHEMA
        : sbomDeclarationMode === "payload-bound-v1"
          ? PLUGIN_MARKETPLACE_PAYLOAD_SBOM_SCHEMA
          : "cyclonedx-json",
    url: declaredArtifactUrl("/artifacts/plugin.cdx.json", "sbom_token"),
  };
  if (sbomDeclarationMode === "legacy-payload-digest") {
    return { ...declaration, digest: legacyPayloadSha256 };
  }
  return {
    ...declaration,
    documentSha256:
      sbomDeclarationMode === "bad-document-digest"
        ? "0".repeat(64)
        : sbomSha256,
  };
}

function registrySignatureDeclaration() {
  const metadata = {
    algorithm: "ed25519",
    publicKeySha256: publicKeySpkiSha256,
  };
  if (signatureDeclarationMode === "metadata-only") return metadata;
  return {
    ...metadata,
    documentSha256: signatureSha256,
    url: declaredArtifactUrl(
      "/artifacts/plugin-manifest.sig",
      "signature_token",
    ),
    publicKeyUrl: declaredArtifactUrl("/artifacts/publisher.pem", "key_token"),
    publicKeyDocumentSha256,
  };
}

function registryDocument() {
  return {
    name: "loopback-artifact-registry",
    plugins: [
      {
        name: PLUGIN_NAME,
        ...(omitRegistryVersion ? {} : { version: registryVersion }),
        source: registrySource,
        sha256: manifestSha256,
        license: "Apache-2.0",
        permissions: {},
        dependencies: {},
        signature: registrySignatureDeclaration(),
        sbom: registrySbomDeclaration(),
        ...(publisherDeclaration
          ? {
              publisher: {
                id: "loopback-publisher",
                organizationId: "loopback-org",
              },
            }
          : {}),
      },
    ],
  };
}

function send(response, body, contentType) {
  response.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(body),
  });
  response.end(body);
}

function requestedPathnames() {
  return requestUrls.map((url) => new URL(url, baseUrl).pathname);
}

beforeEach(async () => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cc-remote-artifact-cwd-"));
  originalAppData = process.env.APPDATA;
  originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
  originalManagedSettings = process.env.CC_MANAGED_SETTINGS;
  process.env.APPDATA = path.join(cwd, "appdata");
  process.env.XDG_CONFIG_HOME = path.join(cwd, "xdg-config");
  sourceRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-remote-artifact-src-"),
  );
  source = path.join(sourceRoot, "plugin");
  fs.mkdirSync(source);
  // The production cache is intentionally shared by canonical source and
  // payload identity. Give every test an independent registry source so a
  // concurrent worker or a prior run cannot turn the online seed assertion
  // from `published` into `reused` before this case performs its offline read.
  registrySource = `${REGISTRY_GIT_SOURCE_PREFIX}${crypto.randomUUID()}.git`;
  originalSpawnSync = installDeps.spawnSync;
  installDeps.spawnSync = (_executable, args) => {
    if (!args.includes(registrySource)) {
      throw new Error("unexpected Git fixture source");
    }
    fs.cpSync(source, args.at(-1), { recursive: true });
    return { status: 0, stdout: "", stderr: "" };
  };

  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  signingPrivateKey = privateKey;
  publicKeyPem = Buffer.from(publicKey.export({ type: "spki", format: "pem" }));
  publicKeyDocumentSha256 = sha256(publicKeyPem);
  publicKeySpkiSha256 = sha256(
    publicKey.export({ type: "spki", format: "der" }),
  );
  signatureDeclarationMode = "remote-bundle";
  sbomDeclarationMode = "document-digest";
  omitRegistryVersion = false;
  publisherDeclaration = false;
  _resetPolicyCache();
  prepareRegistryVersion(PLUGIN_VERSION);
  archiveBytes = null;
  requestUrls = [];

  server = http.createServer((request, response) => {
    requestUrls.push(request.url);
    const pathname = new URL(request.url, baseUrl).pathname;
    if (pathname === "/registry.json") {
      send(response, JSON.stringify(registryDocument()), "application/json");
      return;
    }
    if (pathname === "/artifacts/plugin-manifest.sig") {
      send(response, signatureBytes, "application/octet-stream");
      return;
    }
    if (pathname === "/artifacts/publisher.pem") {
      send(response, publicKeyPem, "application/x-pem-file");
      return;
    }
    if (pathname === "/artifacts/plugin.cdx.json") {
      send(response, sbomBytes, "application/vnd.cyclonedx+json");
      return;
    }
    if (pathname === "/artifacts/plugin.tgz" && archiveBytes) {
      send(response, archiveBytes, "application/gzip");
      return;
    }
    response.writeHead(404, { "Content-Type": "text/plain" });
    response.end("not found");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  registryUrl = `${baseUrl}/registry.json`;

  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(process, "cwd").mockReturnValue(cwd);
});

afterEach(async () => {
  expect(fs.existsSync(pluginLifecycleCoordinatorLock(PLUGIN_NAME))).toBe(
    false,
  );
  installDeps.spawnSync = originalSpawnSync;
  vi.restoreAllMocks();
  process.exitCode = 0;
  server?.closeAllConnections?.();
  if (server?.listening) {
    await new Promise((resolve) => server.close(resolve));
  }
  if (originalAppData === undefined) delete process.env.APPDATA;
  else process.env.APPDATA = originalAppData;
  if (originalXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
  if (originalManagedSettings === undefined) {
    delete process.env.CC_MANAGED_SETTINGS;
  } else {
    process.env.CC_MANAGED_SETTINGS = originalManagedSettings;
  }
  _resetPolicyCache();
  for (const dir of [cwd, sourceRoot]) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("cc plugin remote marketplace artifact journey", () => {
  it("installs a preflight-bound same-origin archive and replays it offline without persisting query secrets", async () => {
    archiveBytes = pluginArchive(manifestBytes);
    registrySource = {
      type: "archive",
      url: `${baseUrl}/artifacts/plugin.tgz?download_token=must-not-persist#download`,
      sha256: sha256(archiveBytes),
    };
    const documentSha256 = sha256(
      Buffer.from(JSON.stringify(registryDocument())),
    );

    const onlineRun = await run(
      "add",
      PLUGIN_NAME,
      "--registry",
      registryUrl,
      "--scope",
      "project",
      "--json",
    );
    expect(onlineRun.exitCode, onlineRun.stderr).toBe(0);
    const onlinePaths = requestedPathnames();
    expect(onlinePaths).toContain("/artifacts/plugin.tgz");
    expect(onlinePaths.indexOf("/artifacts/plugin.tgz")).toBeGreaterThan(
      onlinePaths.indexOf("/registry.json"),
    );
    const [onlineInstalled] = listInstalled({ cwd, scopes: ["project"] });
    expect(onlineInstalled.source).toMatchObject({
      resolvedSource: `${baseUrl}/artifacts/plugin.tgz`,
      catalogAuthority: {
        archiveSource: {
          status: "digest-verified-and-extracted",
          archiveSha256: sha256(archiveBytes),
          fromCache: false,
        },
      },
    });
    expect(JSON.stringify(onlineInstalled.source)).not.toContain(
      "must-not-persist",
    );

    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    requestUrls = [];
    const offlineRun = await run(
      "add",
      PLUGIN_NAME,
      "--registry",
      registryUrl,
      "--registry-digest",
      `${registryUrl}=${documentSha256}`,
      "--offline",
      "--scope",
      "local",
      "--json",
    );
    expect(offlineRun.exitCode, offlineRun.stderr).toBe(0);
    expect(requestUrls).toEqual([]);
    const [offlineInstalled] = listInstalled({ cwd, scopes: ["local"] });
    expect(offlineInstalled.source).toMatchObject({
      offline: true,
      resolvedSource: `${baseUrl}/artifacts/plugin.tgz`,
      catalogAuthority: {
        archiveSource: {
          archiveSha256: sha256(archiveBytes),
          fromCache: true,
        },
      },
    });
    expect(JSON.stringify(offlineInstalled.source)).not.toContain(
      "must-not-persist",
    );
  });

  it("replays a pinned registry and all declared artifacts offline without a network request", async () => {
    sbomDeclarationMode = "payload-bound";
    prepareRegistryVersion(PLUGIN_VERSION);
    const documentSha256 = sha256(
      Buffer.from(JSON.stringify(registryDocument())),
    );
    const onlineRun = await run(
      "add",
      PLUGIN_NAME,
      "--registry",
      registryUrl,
      "--scope",
      "project",
      "--json",
    );
    expect(onlineRun.exitCode, onlineRun.stderr).toBe(0);
    expect(requestedPathnames()).toEqual(
      expect.arrayContaining([
        "/registry.json",
        "/artifacts/plugin-manifest.sig",
        "/artifacts/publisher.pem",
        "/artifacts/plugin.cdx.json",
      ]),
    );

    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    requestUrls = [];
    const offlineRun = await run(
      "add",
      PLUGIN_NAME,
      "--registry",
      registryUrl,
      "--registry-digest",
      `${registryUrl}=${documentSha256}`,
      "--offline",
      "--scope",
      "local",
      "--json",
    );

    expect(offlineRun.exitCode, offlineRun.stderr).toBe(0);
    expect(requestUrls).toEqual([]);
    const [installed] = listInstalled({ cwd, scopes: ["local"] });
    expect(installed.source).toMatchObject({
      offline: true,
      catalogAuthority: {
        registryStatus: "cached",
        registryDocumentSha256: documentSha256,
        remoteArtifactEvidence: {
          signature: {
            fromCache: true,
            publicKey: { fromCache: true },
          },
          sbom: { fromCache: true },
        },
      },
    });
  });

  it("seeds and replays a semantic remote Git source package cache offline", async () => {
    sbomDeclarationMode = "payload-bound";
    prepareRegistryVersion(PLUGIN_VERSION);
    const documentSha256 = sha256(
      Buffer.from(JSON.stringify(registryDocument())),
    );

    const onlineRun = await run(
      "add",
      PLUGIN_NAME,
      "--registry",
      registryUrl,
      "--scope",
      "project",
      "--json",
    );
    expect(onlineRun.exitCode, onlineRun.stderr).toBe(0);
    expect(JSON.parse(onlineRun.stdout).sourceCache).toMatchObject({
      status: "published",
      cacheKey: expect.stringMatching(/^[a-f0-9]{64}$/),
    });

    fs.renameSync(source, `${source}-removed`);
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    requestUrls = [];
    const offlineRun = await run(
      "add",
      PLUGIN_NAME,
      "--registry",
      registryUrl,
      "--registry-digest",
      `${registryUrl}=${documentSha256}`,
      "--offline",
      "--scope",
      "local",
      "--json",
    );

    expect(offlineRun.exitCode, offlineRun.stderr).toBe(0);
    expect(requestUrls).toEqual([]);
    expect(JSON.parse(offlineRun.stdout).sourceCache).toMatchObject({
      status: "hit",
      cacheKey: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    const [installed] = listInstalled({ cwd, scopes: ["local"] });
    expect(installed.source).toMatchObject({
      offline: true,
      catalogAuthority: {
        remoteSbomPayloadComparison: { status: "matched" },
      },
    });
  });

  it("binds publisher identity to managed organization trust and enforces revocation", async () => {
    publisherDeclaration = true;
    const managedFile = path.join(cwd, "managed-publisher.json");
    const policy = {
      requireTrustedPluginPublishers: true,
      trustedPluginPublishers: [
        {
          trustRootId: "loopback-org-root-2026",
          publisherId: "loopback-publisher",
          organizationId: "loopback-org",
          pluginNames: [PLUGIN_NAME],
          registryOrigins: [baseUrl],
          signingKeySha256: [publicKeySpkiSha256],
          notBefore: "2026-01-01T00:00:00.000Z",
          notAfter: "2027-01-01T00:00:00.000Z",
        },
      ],
      revokedPluginPublisherKeys: [],
    };
    fs.writeFileSync(managedFile, JSON.stringify(policy), "utf8");
    process.env.CC_MANAGED_SETTINGS = managedFile;
    _resetPolicyCache();

    const installRun = await run(
      "add",
      PLUGIN_NAME,
      "--registry",
      registryUrl,
      "--scope",
      "project",
      "--json",
    );
    expect(installRun.exitCode, installRun.stderr).toBe(0);
    const [installed] = listInstalled({ cwd, scopes: ["project"] });
    expect(installed.source.catalogAuthority.publisherAuthority).toMatchObject({
      status: "verified",
      trustRootId: "loopback-org-root-2026",
      publisher: {
        id: "loopback-publisher",
        organizationId: "loopback-org",
      },
      subject: {
        name: PLUGIN_NAME,
        registryOrigin: baseUrl,
        signingKeySha256: publicKeySpkiSha256,
      },
      claims: { publisherIdentityVerified: true },
    });
    const evidenceRun = await run(
      "evidence",
      PLUGIN_NAME,
      "--scope",
      "project",
      "--json",
    );
    expect(evidenceRun.exitCode, evidenceRun.stderr).toBe(0);
    expect(JSON.parse(evidenceRun.stdout)).toMatchObject({
      claims: { registryPublisherIdentityVerified: true },
    });

    fs.writeFileSync(
      managedFile,
      JSON.stringify({
        ...policy,
        revokedPluginPublisherKeys: [
          {
            sha256: publicKeySpkiSha256,
            revokedAt: "2026-08-18T00:00:00.000Z",
            reason: "incident-response",
          },
        ],
      }),
      "utf8",
    );
    _resetPolicyCache();
    expect(() =>
      readSourceMetadataStrict(installed.dir, {
        required: true,
        requireRegistryAuthority: true,
      }),
    ).toThrow(/PLUGIN_PUBLISHER_KEY_REVOKED/u);
  });

  it("fetches signature, public key, and SBOM over loopback before persisting verifiable evidence", async () => {
    const installRun = await run(
      "add",
      PLUGIN_NAME,
      "--registry",
      registryUrl,
      "--scope",
      "project",
      "--json",
    );

    expect(installRun.exitCode, installRun.stderr).toBe(0);
    expect(JSON.parse(installRun.stdout)).toMatchObject({
      name: PLUGIN_NAME,
      version: PLUGIN_VERSION,
      scope: "project",
      marketplaceAuthorityPersisted: true,
      marketplacePreflight: {
        integrity: {
          signature: {
            documentSha256: signatureSha256,
            publicKeyDocumentSha256,
            remoteVerification: "complete",
          },
          sbom: {
            documentSha256: sbomSha256,
            payloadSha256: null,
            remoteVerification: "complete",
          },
        },
      },
    });
    expect(requestedPathnames()).toEqual(
      expect.arrayContaining([
        "/registry.json",
        "/artifacts/plugin-manifest.sig",
        "/artifacts/publisher.pem",
        "/artifacts/plugin.cdx.json",
      ]),
    );

    const [installed] = listInstalled({ cwd, scopes: ["project"] });
    expect(installed).toMatchObject({
      name: PLUGIN_NAME,
      version: PLUGIN_VERSION,
      scope: "project",
    });
    const persistedSource = JSON.parse(
      fs.readFileSync(path.join(installed.dir, ".plugin-source.json"), "utf8"),
    );
    expect(
      persistedSource.catalogAuthority.remoteArtifactEvidence,
    ).toMatchObject({
      schemaVersion: REMOTE_ARTIFACT_EVIDENCE_SCHEMA,
      status: "verified",
      signature: {
        status: "fetched",
        url: `${baseUrl}/artifacts/plugin-manifest.sig`,
        signatureSha256,
        bytes: signatureBytes.length,
        fromCache: false,
        publicKey: {
          url: `${baseUrl}/artifacts/publisher.pem`,
          documentSha256: publicKeyDocumentSha256,
          spkiSha256: publicKeySpkiSha256,
          bytes: publicKeyPem.length,
          fromCache: false,
        },
      },
      sbom: {
        status: "digest-verified",
        url: `${baseUrl}/artifacts/plugin.cdx.json`,
        format: "cyclonedx-json",
        expectedDocumentSha256: sbomSha256,
        documentSha256: sbomSha256,
        bytes: sbomBytes.length,
        fromCache: false,
      },
    });
    expect(
      persistedSource.catalogAuthority.remoteArtifactEvidence.evidenceDigest,
    ).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(persistedSource)).not.toMatch(
      /must-not-persist|signature_token|key_token|sbom_token/,
    );

    const evidenceRun = await run(
      "evidence",
      PLUGIN_NAME,
      "--scope",
      "project",
      "--json",
    );
    expect(evidenceRun.exitCode, evidenceRun.stderr).toBe(0);
    expect(JSON.parse(evidenceRun.stdout)).toMatchObject({
      plugin: { name: PLUGIN_NAME, version: PLUGIN_VERSION, scope: "project" },
      actual: { signature: { verified: true } },
      claims: {
        remoteSignatureFetched: true,
        remoteSignatureBoundToInstalledLock: true,
        remoteSbomFetched: true,
        remoteArtifactEvidenceSelfConsistent: true,
        remoteSbomDigestVerifiedAtInstallRecorded: true,
        signatureCryptographicallyReverified: true,
      },
    });
  });

  it("compares a repository payload SBOM with staged bytes before activation and persists readback authority", async () => {
    sbomDeclarationMode = "payload-bound";
    prepareRegistryVersion(PLUGIN_VERSION);

    const installRun = await run(
      "add",
      PLUGIN_NAME,
      "--registry",
      registryUrl,
      "--scope",
      "project",
      "--json",
    );

    expect(installRun.exitCode, installRun.stderr).toBe(0);
    expect(JSON.parse(installRun.stdout)).toMatchObject({
      marketplaceAuthorityPersisted: true,
      marketplacePreflight: {
        integrity: {
          sbom: {
            format: PLUGIN_MARKETPLACE_CANONICAL_PAYLOAD_SBOM_SCHEMA,
            documentSha256: sbomSha256,
            payloadSha256: null,
            remoteVerification: "complete",
          },
        },
      },
    });

    const [installed] = listInstalled({ cwd, scopes: ["project"] });
    const comparison =
      installed.source.catalogAuthority.remoteSbomPayloadComparison;
    expect(comparison).toMatchObject({
      schemaVersion: PLUGIN_MARKETPLACE_REMOTE_SBOM_PAYLOAD_COMPARISON_SCHEMA,
      status: "matched",
      remoteArtifactEvidenceDigest:
        installed.source.catalogAuthority.remoteArtifactEvidence.evidenceDigest,
      format: PLUGIN_MARKETPLACE_CANONICAL_PAYLOAD_SBOM_SCHEMA,
      documentSha256: sbomSha256,
      remotePayload: {
        digest: canonicalPayloadSha256,
        fileCount: 1,
        totalBytes: manifestBytes.length,
      },
      installedPayload: {
        digest: canonicalPayloadSha256,
        fileCount: 1,
        totalBytes: manifestBytes.length,
      },
    });
    expect(comparison.comparisonDigest).toMatch(/^[a-f0-9]{64}$/);

    const evidenceRun = await run(
      "evidence",
      PLUGIN_NAME,
      "--scope",
      "project",
      "--json",
    );
    expect(evidenceRun.exitCode, evidenceRun.stderr).toBe(0);
    expect(JSON.parse(evidenceRun.stdout)).toMatchObject({
      status: "matched",
      comparisons: {
        remoteSbom: { status: "matched", comparable: true },
        remoteSbomPayload: { status: "matched", comparable: true },
      },
      actual: {
        remoteArtifacts: {
          sbom: {
            payloadComparisonPresent: true,
            payloadComparisonValid: true,
            currentPayload: {
              schemaVersion: PLUGIN_MARKETPLACE_CANONICAL_PAYLOAD_SBOM_SCHEMA,
              digest: canonicalPayloadSha256,
            },
            currentPayloadMatches: true,
          },
        },
      },
      claims: {
        remoteSbomPayloadComparisonRecorded: true,
        remoteSbomPayloadComparisonSelfConsistent: true,
        remoteSbomRecordedPayloadMatchesCurrentInstall: true,
      },
    });
  });

  it("rolls back a v2 declaration without fetchable semantic evidence", async () => {
    sbomDeclarationMode = "v2-incomplete";
    prepareRegistryVersion(PLUGIN_VERSION);

    const installRun = await run(
      "add",
      PLUGIN_NAME,
      "--registry",
      registryUrl,
      "--scope",
      "project",
      "--json",
    );

    expect(installRun.exitCode).toBe(1);
    expect(installRun.stderr).toMatch(
      /payload SBOM v2 requires complete bound remote evidence/i,
    );
    expect(requestedPathnames()).not.toContain("/artifacts/plugin.cdx.json");
    expect(listInstalled({ cwd, scopes: ["project"] })).toEqual([]);
  });

  it.each([
    { label: "comparison", removeEvidence: false },
    { label: "comparison and evidence", removeEvidence: true },
  ])(
    "fails readback when a v2 install loses its persisted $label",
    async ({ removeEvidence }) => {
      sbomDeclarationMode = "payload-bound";
      prepareRegistryVersion(PLUGIN_VERSION);
      const installRun = await run(
        "add",
        PLUGIN_NAME,
        "--registry",
        registryUrl,
        "--scope",
        "project",
        "--json",
      );
      expect(installRun.exitCode, installRun.stderr).toBe(0);

      const [installed] = listInstalled({ cwd, scopes: ["project"] });
      const metadataPath = path.join(installed.dir, ".plugin-source.json");
      const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
      delete metadata.catalogAuthority.remoteSbomPayloadComparison;
      if (removeEvidence) {
        delete metadata.catalogAuthority.remoteArtifactEvidence;
      }
      fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), "utf8");
      const lockPath = path.join(installed.dir, ".plugin-lock.json");
      const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
      lock.sbom = buildPluginSbom(installed.dir);
      fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2), "utf8");

      const evidenceRun = await run(
        "evidence",
        PLUGIN_NAME,
        "--scope",
        "project",
        "--json",
      );
      expect(evidenceRun.exitCode, evidenceRun.stderr).toBe(2);
      expect(JSON.parse(evidenceRun.stdout)).toMatchObject({
        status: "failed",
        comparisons: {
          remoteSbomPayload: { status: "mismatch", comparable: true },
        },
        blockers: [{ code: "REMOTE_SBOM_PAYLOAD_COMPARISON_MISSING" }],
      });
    },
  );

  it("fails the command when persisted semantic metadata is invalid", async () => {
    sbomDeclarationMode = "payload-bound";
    prepareRegistryVersion(PLUGIN_VERSION);
    const installRun = await run(
      "add",
      PLUGIN_NAME,
      "--registry",
      registryUrl,
      "--scope",
      "project",
      "--json",
    );
    expect(installRun.exitCode, installRun.stderr).toBe(0);

    const [installed] = listInstalled({ cwd, scopes: ["project"] });
    const metadataPath = path.join(installed.dir, ".plugin-source.json");
    const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
    metadata.catalogAuthority.remoteSbomPayloadComparison.comparisonDigest =
      "0".repeat(64);
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), "utf8");

    const evidenceRun = await run(
      "evidence",
      PLUGIN_NAME,
      "--scope",
      "project",
      "--json",
    );
    expect(evidenceRun.exitCode).toBe(1);
    expect(evidenceRun.stderr).toMatch(
      /plugin source metadata is invalid.*comparison digest is invalid/i,
    );
  });

  it("fails the command when registry catalog authority is deleted", async () => {
    const installRun = await run(
      "add",
      PLUGIN_NAME,
      "--registry",
      registryUrl,
      "--scope",
      "project",
      "--json",
    );
    expect(installRun.exitCode, installRun.stderr).toBe(0);

    const [installed] = listInstalled({ cwd, scopes: ["project"] });
    const metadataPath = path.join(installed.dir, ".plugin-source.json");
    const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
    delete metadata.catalogAuthority;
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), "utf8");

    const evidenceRun = await run(
      "evidence",
      PLUGIN_NAME,
      "--scope",
      "project",
      "--json",
    );
    expect(evidenceRun.exitCode).toBe(1);
    expect(evidenceRun.stderr).toMatch(
      /registry source metadata is missing catalog artifact authority/i,
    );
  });

  it("rejects registry-shaped metadata relabeled as a Git source", async () => {
    const installRun = await run(
      "add",
      PLUGIN_NAME,
      "--registry",
      registryUrl,
      "--scope",
      "project",
      "--json",
    );
    expect(installRun.exitCode, installRun.stderr).toBe(0);

    const [installed] = listInstalled({ cwd, scopes: ["project"] });
    const metadataPath = path.join(installed.dir, ".plugin-source.json");
    const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
    metadata.type = "git";
    delete metadata.catalogAuthority;
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), "utf8");

    const evidenceRun = await run(
      "evidence",
      PLUGIN_NAME,
      "--scope",
      "project",
      "--json",
    );
    expect(evidenceRun.exitCode).toBe(1);
    expect(evidenceRun.stderr).toMatch(
      /registry-shaped source metadata has an invalid type/i,
    );
  });

  it("fails the command when installed source metadata is deleted", async () => {
    const installRun = await run(
      "add",
      PLUGIN_NAME,
      "--registry",
      registryUrl,
      "--scope",
      "project",
      "--json",
    );
    expect(installRun.exitCode, installRun.stderr).toBe(0);

    const [installed] = listInstalled({ cwd, scopes: ["project"] });
    fs.unlinkSync(path.join(installed.dir, ".plugin-source.json"));
    const evidenceRun = await run(
      "evidence",
      PLUGIN_NAME,
      "--scope",
      "project",
      "--json",
    );

    expect(evidenceRun.exitCode).toBe(1);
    expect(evidenceRun.stderr).toMatch(/plugin source metadata is missing/i);
  });

  it("keeps valid local-install evidence partial and non-blocking", async () => {
    const installRun = await run("add", source, "--scope", "project", "--json");
    expect(installRun.exitCode, installRun.stderr).toBe(0);

    const evidenceRun = await run(
      "evidence",
      PLUGIN_NAME,
      "--scope",
      "project",
      "--json",
    );
    expect(evidenceRun.exitCode, evidenceRun.stderr).toBe(0);
    expect(JSON.parse(evidenceRun.stdout)).toMatchObject({
      status: "partial",
      blockers: [],
    });
  });

  it("compares a v2 materialized remote Git payload without VCS metadata", async () => {
    sbomDeclarationMode = "payload-bound";
    prepareRegistryVersion(PLUGIN_VERSION);
    fs.mkdirSync(path.join(source, ".git"));
    fs.writeFileSync(
      path.join(source, ".git", "HEAD"),
      "ref: refs/heads/main\n",
    );
    // Rebuild the publisher document from the committed checkout so the
    // producer-side v2 walk also proves that top-level .git is excluded.
    prepareRegistryVersion(PLUGIN_VERSION);
    const publishedPayload = JSON.parse(sbomBytes.toString("utf8"));
    expect(publishedPayload).toMatchObject({
      schemaVersion: PLUGIN_MARKETPLACE_CANONICAL_PAYLOAD_SBOM_SCHEMA,
      exclusions: expect.arrayContaining([".git"]),
      files: [expect.objectContaining({ path: "plugin.json", type: "file" })],
    });
    const installRun = await run(
      "add",
      PLUGIN_NAME,
      "--registry",
      registryUrl,
      "--scope",
      "project",
      "--json",
    );

    expect(installRun.exitCode, installRun.stderr).toBe(0);
    const [installed] = listInstalled({ cwd, scopes: ["project"] });
    expect(fs.existsSync(path.join(installed.dir, ".git"))).toBe(false);
    expect(
      installed.source.catalogAuthority.remoteSbomPayloadComparison,
    ).toMatchObject({
      status: "matched",
      remotePayload: { digest: canonicalPayloadSha256, fileCount: 1 },
      installedPayload: { digest: canonicalPayloadSha256, fileCount: 1 },
    });
  });

  it("rejects a repository payload SBOM whose inventory differs from staged plugin bytes", async () => {
    sbomDeclarationMode = "payload-bound";
    prepareRegistryVersion(PLUGIN_VERSION);
    fs.writeFileSync(path.join(source, "undeclared.js"), "export default 1;\n");

    const installRun = await run(
      "add",
      PLUGIN_NAME,
      "--registry",
      registryUrl,
      "--scope",
      "project",
      "--json",
    );

    expect(installRun.exitCode).toBe(1);
    expect(installRun.stderr).toMatch(
      /payload SBOM does not match staged plugin bytes/i,
    );
    expect(requestedPathnames()).toContain("/artifacts/plugin.cdx.json");
    expect(listInstalled({ cwd, scopes: ["project"] })).toEqual([]);
  });

  it("repeats the semantic payload comparison before activating an upgrade", async () => {
    sbomDeclarationMode = "payload-bound";
    prepareRegistryVersion(PLUGIN_VERSION);
    const installedV1 = await run(
      "add",
      PLUGIN_NAME,
      "--registry",
      registryUrl,
      "--scope",
      "project",
      "--json",
    );
    expect(installedV1.exitCode, installedV1.stderr).toBe(0);

    prepareRegistryVersion("2.0.0");
    requestUrls = [];
    const upgraded = await run(
      "upgrade",
      PLUGIN_NAME,
      "--registry",
      registryUrl,
      "--scope",
      "project",
      "--allow-source-switch",
      "--json",
    );

    expect(upgraded.exitCode, upgraded.stderr).toBe(0);
    expect(JSON.parse(upgraded.stdout)).toMatchObject({
      version: "2.0.0",
      activationStatus: "activated",
      marketplaceAuthorityPersisted: true,
    });
    expect(requestedPathnames()).toContain("/artifacts/plugin.cdx.json");
    expect(getActiveVersion(PLUGIN_NAME, { scope: "project", cwd })).toBe(
      "2.0.0",
    );
    const active = listInstalled({ cwd, scopes: ["project"] })[0];
    expect(
      active.source.catalogAuthority.remoteSbomPayloadComparison,
    ).toMatchObject({
      schemaVersion: PLUGIN_MARKETPLACE_REMOTE_SBOM_PAYLOAD_COMPARISON_SCHEMA,
      status: "matched",
      documentSha256: sbomSha256,
      installedPayload: {
        digest: canonicalPayloadSha256,
        fileCount: 1,
        totalBytes: manifestBytes.length,
      },
    });
  });

  it("keeps the prior active version when an upgrade payload differs from its semantic SBOM", async () => {
    sbomDeclarationMode = "payload-bound";
    prepareRegistryVersion(PLUGIN_VERSION);
    const installedV1 = await run(
      "add",
      PLUGIN_NAME,
      "--registry",
      registryUrl,
      "--scope",
      "project",
      "--json",
    );
    expect(installedV1.exitCode, installedV1.stderr).toBe(0);

    prepareRegistryVersion("2.0.0");
    fs.writeFileSync(path.join(source, "undeclared-v2.js"), "v2 drift\n");
    requestUrls = [];
    const rejected = await run(
      "upgrade",
      PLUGIN_NAME,
      "--registry",
      registryUrl,
      "--scope",
      "project",
      "--allow-source-switch",
      "--json",
    );

    expect(rejected.exitCode).toBe(1);
    expect(rejected.stderr).toMatch(
      /payload SBOM does not match staged plugin bytes/i,
    );
    expect(requestedPathnames()).toContain("/artifacts/plugin.cdx.json");
    expect(getActiveVersion(PLUGIN_NAME, { scope: "project", cwd })).toBe(
      PLUGIN_VERSION,
    );
    expect(listInstalled({ cwd, scopes: ["project"] })).toEqual([
      expect.objectContaining({
        name: PLUGIN_NAME,
        version: PLUGIN_VERSION,
        versions: [PLUGIN_VERSION],
      }),
    ]);
  });

  it("blocks an upgrade that removes the installed v2 semantic binding", async () => {
    sbomDeclarationMode = "payload-bound";
    prepareRegistryVersion(PLUGIN_VERSION);
    const installedV1 = await run(
      "add",
      PLUGIN_NAME,
      "--registry",
      registryUrl,
      "--scope",
      "project",
      "--json",
    );
    expect(installedV1.exitCode, installedV1.stderr).toBe(0);

    sbomDeclarationMode = "document-digest";
    prepareRegistryVersion("2.0.0");
    requestUrls = [];
    const impactRun = await run(
      "impact",
      PLUGIN_NAME,
      "--registry",
      registryUrl,
      "--scope",
      "project",
      "--json",
    );
    expect(impactRun.exitCode, impactRun.stderr).toBe(2);
    const impact = JSON.parse(impactRun.stdout);
    expect(impact).toMatchObject({
      status: "blocked",
      changes: {
        integrity: {
          semanticPayloadBinding: {
            from: PLUGIN_MARKETPLACE_CANONICAL_PAYLOAD_SBOM_SCHEMA,
            to: null,
            kind: "removed",
            downgraded: true,
          },
        },
      },
      blockers: [{ code: "SEMANTIC_SBOM_BINDING_DOWNGRADE" }],
    });

    requestUrls = [];
    const rejected = await run(
      "upgrade",
      PLUGIN_NAME,
      "--registry",
      registryUrl,
      "--scope",
      "project",
      "--allow-source-switch",
      "--allow-downgrade",
      "--expected-impact-digest",
      impact.impactDigest,
      "--json",
    );

    expect(rejected.exitCode).toBe(1);
    expect(rejected.stderr).toMatch(/SEMANTIC_SBOM_BINDING_DOWNGRADE/);
    expect(requestedPathnames()).toContain("/registry.json");
    expect(requestedPathnames()).not.toContain(
      "/artifacts/plugin-manifest.sig",
    );
    expect(requestedPathnames()).not.toContain("/artifacts/plugin.cdx.json");
    expect(getActiveVersion(PLUGIN_NAME, { scope: "project", cwd })).toBe(
      PLUGIN_VERSION,
    );
  });

  it.each([
    { label: "a newer version", version: "2.0.0", extraArgs: [] },
    {
      label: "the same version with --force",
      version: PLUGIN_VERSION,
      extraArgs: ["--force"],
    },
  ])(
    "blocks registry add from replacing a v2 binding with $label before artifact fetch",
    async ({ version, extraArgs }) => {
      sbomDeclarationMode = "payload-bound";
      prepareRegistryVersion(PLUGIN_VERSION);
      const installedV1 = await run(
        "add",
        PLUGIN_NAME,
        "--registry",
        registryUrl,
        "--scope",
        "project",
        "--json",
      );
      expect(installedV1.exitCode, installedV1.stderr).toBe(0);
      const installedOutput = JSON.parse(installedV1.stdout);
      expect(installedOutput.marketplaceImpact?.impactDigest).toBe(
        installedOutput.sourceMetadata.catalogAuthority.updateImpactDigest,
      );
      const [prior] = listInstalled({ cwd, scopes: ["project"] });
      const metadataPath = path.join(prior.dir, ".plugin-source.json");
      const priorMetadata = fs.readFileSync(metadataPath, "utf8");
      const priorManifest = fs.readFileSync(
        path.join(prior.dir, "plugin.json"),
        "utf8",
      );

      sbomDeclarationMode = "document-digest";
      prepareRegistryVersion(version);
      requestUrls = [];
      const rejected = await run(
        "add",
        PLUGIN_NAME,
        "--registry",
        registryUrl,
        "--scope",
        "project",
        ...extraArgs,
        "--json",
      );

      expect(rejected.exitCode).toBe(1);
      expect(rejected.stderr).toMatch(/SEMANTIC_SBOM_BINDING_DOWNGRADE/);
      expect(requestedPathnames()).toContain("/registry.json");
      expect(requestedPathnames()).not.toContain(
        "/artifacts/plugin-manifest.sig",
      );
      expect(requestedPathnames()).not.toContain("/artifacts/plugin.cdx.json");
      expect(getActiveVersion(PLUGIN_NAME, { scope: "project", cwd })).toBe(
        PLUGIN_VERSION,
      );
      const [after] = listInstalled({ cwd, scopes: ["project"] });
      expect(after.versions).toEqual([PLUGIN_VERSION]);
      expect(fs.readFileSync(metadataPath, "utf8")).toBe(priorMetadata);
      expect(fs.readFileSync(path.join(after.dir, "plugin.json"), "utf8")).toBe(
        priorManifest,
      );
    },
  );

  it("blocks an update whose registry defers the candidate version before artifact fetch", async () => {
    sbomDeclarationMode = "payload-bound";
    prepareRegistryVersion("2.0.0");
    const installedV2 = await run(
      "add",
      PLUGIN_NAME,
      "--registry",
      registryUrl,
      "--scope",
      "project",
      "--json",
    );
    expect(installedV2.exitCode, installedV2.stderr).toBe(0);

    prepareRegistryVersion("1.0.0");
    omitRegistryVersion = true;
    requestUrls = [];
    const rejected = await run(
      "upgrade",
      PLUGIN_NAME,
      "--registry",
      registryUrl,
      "--scope",
      "project",
      "--allow-source-switch",
      "--allow-downgrade",
      "--json",
    );

    expect(rejected.exitCode).toBe(1);
    expect(rejected.stderr).toMatch(/REGISTRY_VERSION_REQUIRED_FOR_UPDATE/);
    expect(requestedPathnames()).toContain("/registry.json");
    expect(requestedPathnames()).not.toContain(
      "/artifacts/plugin-manifest.sig",
    );
    expect(requestedPathnames()).not.toContain("/artifacts/plugin.cdx.json");
    expect(getActiveVersion(PLUGIN_NAME, { scope: "project", cwd })).toBe(
      "2.0.0",
    );
  });

  it.each([
    {
      label: "comparison",
      mutate(metadata) {
        delete metadata.catalogAuthority.remoteSbomPayloadComparison;
      },
      error: /INSTALLED_SEMANTIC_SBOM_EVIDENCE_INVALID/,
    },
    {
      label: "comparison and evidence",
      mutate(metadata) {
        delete metadata.catalogAuthority.remoteSbomPayloadComparison;
        delete metadata.catalogAuthority.remoteArtifactEvidence;
      },
      error: /INSTALLED_SEMANTIC_SBOM_EVIDENCE_INVALID/,
    },
    {
      label: "comparison checksum",
      mutate(metadata) {
        metadata.catalogAuthority.remoteSbomPayloadComparison.comparisonDigest =
          "0".repeat(64);
      },
      error: /plugin source metadata is invalid.*comparison digest is invalid/i,
    },
    {
      label: "catalog authority",
      mutate(metadata) {
        delete metadata.catalogAuthority;
      },
      error: /registry source metadata is missing catalog artifact authority/i,
    },
    {
      label: "registry type and catalog authority",
      mutate(metadata) {
        metadata.type = "git";
        delete metadata.catalogAuthority;
      },
      error: /registry-shaped source metadata has an invalid type/i,
    },
  ])(
    "blocks a nonsemantic upgrade when installed v2 $label is missing or invalid",
    async ({ mutate, error }) => {
      sbomDeclarationMode = "payload-bound";
      prepareRegistryVersion(PLUGIN_VERSION);
      const installedV1 = await run(
        "add",
        PLUGIN_NAME,
        "--registry",
        registryUrl,
        "--scope",
        "project",
        "--json",
      );
      expect(installedV1.exitCode, installedV1.stderr).toBe(0);

      const [installed] = listInstalled({ cwd, scopes: ["project"] });
      const metadataPath = path.join(installed.dir, ".plugin-source.json");
      const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
      mutate(metadata);
      fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), "utf8");
      const lockPath = path.join(installed.dir, ".plugin-lock.json");
      const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
      lock.sbom = buildPluginSbom(installed.dir);
      fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2), "utf8");

      sbomDeclarationMode = "document-digest";
      prepareRegistryVersion("2.0.0");
      requestUrls = [];
      const rejected = await run(
        "upgrade",
        PLUGIN_NAME,
        "--registry",
        registryUrl,
        "--scope",
        "project",
        "--allow-source-switch",
        "--allow-downgrade",
        "--json",
      );

      expect(rejected.exitCode).toBe(1);
      expect(rejected.stderr).toMatch(error);
      expect(requestedPathnames()).toContain("/registry.json");
      expect(requestedPathnames()).not.toContain(
        "/artifacts/plugin-manifest.sig",
      );
      expect(requestedPathnames()).not.toContain("/artifacts/plugin.cdx.json");
      expect(getActiveVersion(PLUGIN_NAME, { scope: "project", cwd })).toBe(
        PLUGIN_VERSION,
      );
    },
  );

  it("rejects a tampered installed semantic payload during impact before artifact fetch", async () => {
    sbomDeclarationMode = "payload-bound";
    prepareRegistryVersion(PLUGIN_VERSION);
    const installedV1 = await run(
      "add",
      PLUGIN_NAME,
      "--registry",
      registryUrl,
      "--scope",
      "project",
      "--json",
    );
    expect(installedV1.exitCode, installedV1.stderr).toBe(0);

    const [installed] = listInstalled({ cwd, scopes: ["project"] });
    fs.writeFileSync(path.join(installed.dir, "payload-drift.js"), "drift\n");
    prepareRegistryVersion("2.0.0");

    requestUrls = [];
    const impactRun = await run(
      "impact",
      PLUGIN_NAME,
      "--registry",
      registryUrl,
      "--scope",
      "project",
      "--json",
    );
    expect(impactRun.exitCode).toBe(1);
    expect(impactRun.stderr).toMatch(
      /INSTALLED_SEMANTIC_SBOM_EVIDENCE_INVALID/,
    );
    expect(requestedPathnames()).toEqual(["/registry.json"]);

    requestUrls = [];
    const rejected = await run(
      "upgrade",
      PLUGIN_NAME,
      "--registry",
      registryUrl,
      "--scope",
      "project",
      "--json",
    );
    expect(rejected.exitCode).toBe(1);
    expect(rejected.stderr).toMatch(/INSTALLED_SEMANTIC_SBOM_EVIDENCE_INVALID/);
    expect(requestedPathnames()).toEqual(["/registry.json"]);
    expect(getActiveVersion(PLUGIN_NAME, { scope: "project", cwd })).toBe(
      PLUGIN_VERSION,
    );
    expect(
      fs.readFileSync(path.join(installed.dir, "payload-drift.js"), "utf8"),
    ).toBe("drift\n");
  });

  it("rejects a blocked active pointer before marketplace artifact fetch", async () => {
    sbomDeclarationMode = "payload-bound";
    prepareRegistryVersion(PLUGIN_VERSION);
    const installedV1 = await run(
      "add",
      PLUGIN_NAME,
      "--registry",
      registryUrl,
      "--scope",
      "project",
      "--json",
    );
    expect(installedV1.exitCode, installedV1.stderr).toBe(0);

    const [installed] = listInstalled({ cwd, scopes: ["project"] });
    const activeFile = path.join(path.dirname(installed.dir), ".active");
    fs.writeFileSync(activeFile, "9.9.9", "utf8");
    prepareRegistryVersion("2.0.0");

    requestUrls = [];
    const impactRun = await run(
      "impact",
      PLUGIN_NAME,
      "--registry",
      registryUrl,
      "--scope",
      "project",
      "--json",
    );
    expect(impactRun.exitCode).toBe(1);
    expect(impactRun.stderr).toMatch(
      /INSTALLED_PLUGIN_RUNTIME_BLOCKED.*dangling/,
    );
    expect(requestedPathnames()).toEqual(["/registry.json"]);

    requestUrls = [];
    const rejected = await run(
      "upgrade",
      PLUGIN_NAME,
      "--registry",
      registryUrl,
      "--scope",
      "project",
      "--json",
    );
    expect(rejected.exitCode).toBe(1);
    expect(rejected.stderr).toMatch(
      /INSTALLED_PLUGIN_RUNTIME_BLOCKED.*dangling/,
    );
    expect(requestedPathnames()).toEqual(["/registry.json"]);
    expect(fs.readFileSync(activeFile, "utf8")).toBe("9.9.9");
  });

  it("blocks a complete v1 binding whose evidence and comparison were deleted before artifact fetch", async () => {
    sbomDeclarationMode = "payload-bound-v1";
    prepareRegistryVersion(PLUGIN_VERSION);
    const installedV1 = await run(
      "add",
      PLUGIN_NAME,
      "--registry",
      registryUrl,
      "--scope",
      "project",
      "--json",
    );
    expect(installedV1.exitCode, installedV1.stderr).toBe(0);

    const [installed] = listInstalled({ cwd, scopes: ["project"] });
    const metadataPath = path.join(installed.dir, ".plugin-source.json");
    const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
    delete metadata.catalogAuthority.remoteArtifactEvidence;
    delete metadata.catalogAuthority.remoteSbomPayloadComparison;
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), "utf8");
    const lockPath = path.join(installed.dir, ".plugin-lock.json");
    const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    lock.sbom = buildPluginSbom(installed.dir);
    fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2), "utf8");

    sbomDeclarationMode = "document-digest";
    prepareRegistryVersion("2.0.0");
    requestUrls = [];
    const rejected = await run(
      "upgrade",
      PLUGIN_NAME,
      "--registry",
      registryUrl,
      "--scope",
      "project",
      "--allow-source-switch",
      "--json",
    );

    expect(rejected.exitCode).toBe(1);
    expect(rejected.stderr).toMatch(/INSTALLED_SEMANTIC_SBOM_EVIDENCE_INVALID/);
    expect(requestedPathnames()).toContain("/registry.json");
    expect(requestedPathnames()).not.toContain(
      "/artifacts/plugin-manifest.sig",
    );
    expect(requestedPathnames()).not.toContain("/artifacts/plugin.cdx.json");
    expect(getActiveVersion(PLUGIN_NAME, { scope: "project", cwd })).toBe(
      PLUGIN_VERSION,
    );
  });

  it("fetches only the SBOM when signature authority is metadata-only", async () => {
    signatureDeclarationMode = "metadata-only";

    const installRun = await run(
      "add",
      PLUGIN_NAME,
      "--registry",
      registryUrl,
      "--scope",
      "project",
      "--json",
    );

    expect(installRun.exitCode, installRun.stderr).toBe(0);
    expect(JSON.parse(installRun.stdout)).toMatchObject({
      name: PLUGIN_NAME,
      version: PLUGIN_VERSION,
      marketplaceAuthorityPersisted: true,
      marketplacePreflight: {
        integrity: {
          signature: {
            publicKeySha256: publicKeySpkiSha256,
            url: null,
            publicKeyUrl: null,
            remoteVerification: "not-requested",
          },
          sbom: {
            documentSha256: sbomSha256,
            remoteVerification: "complete",
          },
        },
      },
    });
    expect(requestedPathnames()).toEqual([
      "/registry.json",
      "/artifacts/plugin.cdx.json",
    ]);

    const [installed] = listInstalled({ cwd, scopes: ["project"] });
    expect(
      installed.source.catalogAuthority.remoteArtifactEvidence,
    ).toMatchObject({
      schemaVersion: REMOTE_ARTIFACT_EVIDENCE_SCHEMA,
      status: "verified",
      signature: null,
      sbom: {
        status: "digest-verified",
        url: `${baseUrl}/artifacts/plugin.cdx.json`,
        expectedDocumentSha256: sbomSha256,
        documentSha256: sbomSha256,
      },
      claims: {
        signatureBytesFetched: false,
        publicKeyFingerprintVerified: false,
        sbomDocumentDigestVerified: true,
      },
    });
  });

  it("keeps legacy sbom.url + digest as an unfetched payload assertion", async () => {
    sbomDeclarationMode = "legacy-payload-digest";

    const installRun = await run(
      "add",
      PLUGIN_NAME,
      "--registry",
      registryUrl,
      "--scope",
      "project",
      "--json",
    );

    expect(installRun.exitCode, installRun.stderr).toBe(0);
    expect(JSON.parse(installRun.stdout)).toMatchObject({
      name: PLUGIN_NAME,
      version: PLUGIN_VERSION,
      marketplaceAuthorityPersisted: true,
      marketplacePreflight: {
        integrity: {
          sbom: {
            documentSha256: null,
            payloadSha256: legacyPayloadSha256,
            remoteVerification: "incomplete",
          },
        },
        warnings: expect.arrayContaining([
          expect.objectContaining({ code: "REMOTE_SBOM_ARTIFACT_INCOMPLETE" }),
        ]),
      },
    });
    expect(requestedPathnames()).toEqual(
      expect.arrayContaining([
        "/registry.json",
        "/artifacts/plugin-manifest.sig",
        "/artifacts/publisher.pem",
      ]),
    );
    expect(requestedPathnames()).not.toContain("/artifacts/plugin.cdx.json");

    const [installed] = listInstalled({ cwd, scopes: ["project"] });
    expect(installed.source.catalogAuthority).toMatchObject({
      artifactExpectations: {
        sbom: {
          payloadSha256: legacyPayloadSha256,
          documentSha256: null,
        },
      },
      remoteArtifactEvidence: {
        status: "verified",
        signature: { status: "fetched" },
        sbom: null,
        claims: { sbomDocumentDigestVerified: false },
      },
    });

    const evidenceRun = await run(
      "evidence",
      PLUGIN_NAME,
      "--scope",
      "project",
      "--json",
    );
    expect(evidenceRun.exitCode, evidenceRun.stderr).toBe(0);
    expect(JSON.parse(evidenceRun.stdout)).toMatchObject({
      status: "partial",
      comparisons: {
        remoteSbom: { status: "not-observed", comparable: false },
      },
      claims: {
        remoteSignatureFetched: true,
        remoteSignatureBoundToInstalledLock: true,
        remoteSbomFetched: false,
        remoteArtifactEvidenceSelfConsistent: true,
        remoteSbomDigestVerifiedAtInstallRecorded: false,
      },
    });
  });

  it("rejects bad detached signature bytes before creating an installed plugin", async () => {
    signatureBytes = Buffer.alloc(signatureBytes.length, 0);
    signatureSha256 = sha256(signatureBytes);

    const installRun = await run(
      "add",
      PLUGIN_NAME,
      "--registry",
      registryUrl,
      "--scope",
      "project",
      "--json",
    );

    expect(installRun.exitCode).toBe(1);
    expect(installRun.stderr).toMatch(/signature verification failed/i);
    expect(listInstalled({ cwd, scopes: ["project"] })).toEqual([]);
  });

  it("rejects a remote SBOM digest mismatch before creating an installed plugin", async () => {
    sbomDeclarationMode = "bad-document-digest";

    const installRun = await run(
      "add",
      PLUGIN_NAME,
      "--registry",
      registryUrl,
      "--scope",
      "project",
      "--json",
    );

    expect(installRun.exitCode).toBe(1);
    expect(installRun.stderr).toMatch(/sbom/i);
    expect(installRun.stderr).toMatch(/digest|sha-?256/i);
    expect(requestedPathnames()).toContain("/artifacts/plugin.cdx.json");
    expect(listInstalled({ cwd, scopes: ["project"] })).toEqual([]);
  });

  it("rejects a CLI manifest digest that conflicts with registry authority", async () => {
    const installRun = await run(
      "add",
      PLUGIN_NAME,
      "--registry",
      registryUrl,
      "--scope",
      "project",
      "--sha256",
      "0".repeat(64),
      "--json",
    );

    expect(installRun.exitCode).toBe(1);
    expect(installRun.stderr).toMatch(
      /--sha256 does not match the registry-declared manifest SHA-256/i,
    );
    expect(requestedPathnames()).toEqual(["/registry.json"]);
    expect(listInstalled({ cwd, scopes: ["project"] })).toEqual([]);
  });

  it("keeps the prior active version when upgrade artifact verification fails", async () => {
    const installedV1 = await run(
      "add",
      PLUGIN_NAME,
      "--registry",
      registryUrl,
      "--scope",
      "project",
      "--json",
    );
    expect(installedV1.exitCode, installedV1.stderr).toBe(0);
    const [beforeUpgrade] = listInstalled({ cwd, scopes: ["project"] });
    const v1EvidenceDigest =
      beforeUpgrade.source.catalogAuthority.remoteArtifactEvidence
        .evidenceDigest;

    prepareRegistryVersion("2.0.0");
    sbomDeclarationMode = "bad-document-digest";
    requestUrls = [];

    const rejected = await run(
      "upgrade",
      PLUGIN_NAME,
      "--registry",
      registryUrl,
      "--scope",
      "project",
      "--allow-source-switch",
      "--json",
    );
    expect(rejected.exitCode).toBe(1);
    expect(rejected.stderr).toMatch(/sbom/i);
    expect(requestedPathnames()).toContain("/artifacts/plugin.cdx.json");
    expect(listInstalled({ cwd, scopes: ["project"] })).toEqual([
      expect.objectContaining({
        name: PLUGIN_NAME,
        version: PLUGIN_VERSION,
        source: expect.objectContaining({
          catalogAuthority: expect.objectContaining({
            remoteArtifactEvidence: expect.objectContaining({
              evidenceDigest: v1EvidenceDigest,
            }),
          }),
        }),
      }),
    ]);
  });

  it("rejects a conflicting CLI manifest digest before upgrading the active version", async () => {
    const installedV1 = await run(
      "add",
      PLUGIN_NAME,
      "--registry",
      registryUrl,
      "--scope",
      "project",
      "--json",
    );
    expect(installedV1.exitCode, installedV1.stderr).toBe(0);

    prepareRegistryVersion("2.0.0");
    requestUrls = [];
    const rejected = await run(
      "upgrade",
      PLUGIN_NAME,
      "--registry",
      registryUrl,
      "--scope",
      "project",
      "--sha256",
      "0".repeat(64),
      "--allow-source-switch",
      "--json",
    );

    expect(rejected.exitCode).toBe(1);
    expect(rejected.stderr).toMatch(
      /--sha256 does not match the registry-declared manifest SHA-256/i,
    );
    expect(requestedPathnames()).toEqual(["/registry.json"]);
    expect(getActiveVersion(PLUGIN_NAME, { scope: "project", cwd })).toBe(
      PLUGIN_VERSION,
    );
  });

  it("transactionally revalidates an existing target version instead of pointer-only activation", async () => {
    const installedV1 = await run(
      "add",
      PLUGIN_NAME,
      "--registry",
      registryUrl,
      "--scope",
      "project",
      "--json",
    );
    expect(installedV1.exitCode, installedV1.stderr).toBe(0);

    prepareRegistryVersion("2.0.0");
    const installedV2 = await run(
      "upgrade",
      PLUGIN_NAME,
      "--registry",
      registryUrl,
      "--scope",
      "project",
      "--allow-source-switch",
      "--json",
    );
    expect(installedV2.exitCode, installedV2.stderr).toBe(0);
    const switchedBack = await run(
      "use",
      PLUGIN_NAME,
      PLUGIN_VERSION,
      "--scope",
      "project",
    );
    expect(switchedBack.exitCode, switchedBack.stderr).toBe(0);
    expect(getActiveVersion(PLUGIN_NAME, { scope: "project", cwd })).toBe(
      PLUGIN_VERSION,
    );

    const versionTwo = listInstalled({ cwd, scopes: ["project"] })[0]
      .versions.map((version) => ({
        version,
        dir: path.join(cwd, ".chainlesschain", "plugins", PLUGIN_NAME, version),
      }))
      .find((candidate) => candidate.version === "2.0.0");
    expect(versionTwo).toBeDefined();
    fs.writeFileSync(
      path.join(versionTwo.dir, "plugin.json"),
      JSON.stringify({ name: PLUGIN_NAME, version: "2.0.0", tampered: true }),
      "utf8",
    );
    requestUrls = [];

    const revalidated = await run(
      "upgrade",
      PLUGIN_NAME,
      "--registry",
      registryUrl,
      "--scope",
      "project",
      "--allow-source-switch",
      "--json",
    );
    expect(revalidated.exitCode, revalidated.stderr).toBe(0);
    expect(JSON.parse(revalidated.stdout)).toMatchObject({
      version: "2.0.0",
      reinstalled: true,
      activationStatus: "activated",
      marketplaceAuthorityPersisted: true,
    });
    expect(requestedPathnames()).toEqual(
      expect.arrayContaining([
        "/artifacts/plugin-manifest.sig",
        "/artifacts/publisher.pem",
        "/artifacts/plugin.cdx.json",
      ]),
    );
    expect(getActiveVersion(PLUGIN_NAME, { scope: "project", cwd })).toBe(
      "2.0.0",
    );
    const active = listInstalled({ cwd, scopes: ["project"] })[0];
    expect(
      JSON.parse(fs.readFileSync(path.join(active.dir, "plugin.json"), "utf8")),
    ).not.toHaveProperty("tampered");
  });
});
