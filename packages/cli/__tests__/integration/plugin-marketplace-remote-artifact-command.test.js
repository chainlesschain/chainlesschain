import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { registerPluginCommand } from "../../src/commands/plugin.js";
import {
  getActiveVersion,
  listInstalled,
} from "../../src/lib/plugin-runtime/install.js";
import { buildMarketplacePayloadSbom } from "../../src/lib/plugin-runtime/marketplace-artifact-readback.js";

const REMOTE_ARTIFACT_EVIDENCE_SCHEMA =
  "cc-plugin-marketplace-remote-artifact-evidence/v1";
const PLUGIN_NAME = "remote-artifact-plugin";
const PLUGIN_VERSION = "1.0.0";

let cwd;
let sourceRoot;
let source;
let server;
let baseUrl;
let registryUrl;
let logSpy;
let errorSpy;
let requestUrls;
let signatureDeclarationMode;
let sbomDeclarationMode;
let registryVersion;
let originalAppData;
let originalXdgConfigHome;
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
let signingPrivateKey;

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
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
  sbomBytes = Buffer.from(
    JSON.stringify({
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
    }),
  );
  sbomSha256 = sha256(sbomBytes);
  legacyPayloadSha256 = buildMarketplacePayloadSbom(source).digest;
}

function registrySbomDeclaration() {
  const declaration = {
    format: "cyclonedx-json",
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
        version: registryVersion,
        source,
        sha256: manifestSha256,
        license: "Apache-2.0",
        permissions: {},
        dependencies: {},
        signature: registrySignatureDeclaration(),
        sbom: registrySbomDeclaration(),
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
  process.env.APPDATA = path.join(cwd, "appdata");
  process.env.XDG_CONFIG_HOME = path.join(cwd, "xdg-config");
  sourceRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-remote-artifact-src-"),
  );
  source = path.join(sourceRoot, "plugin");
  fs.mkdirSync(source);

  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  signingPrivateKey = privateKey;
  publicKeyPem = Buffer.from(publicKey.export({ type: "spki", format: "pem" }));
  publicKeyDocumentSha256 = sha256(publicKeyPem);
  publicKeySpkiSha256 = sha256(
    publicKey.export({ type: "spki", format: "der" }),
  );
  signatureDeclarationMode = "remote-bundle";
  sbomDeclarationMode = "document-digest";
  prepareRegistryVersion(PLUGIN_VERSION);
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
  for (const dir of [cwd, sourceRoot]) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("cc plugin remote marketplace artifact journey", () => {
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
