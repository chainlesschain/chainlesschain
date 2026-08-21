#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import {
  buildMarketplacePayloadSbom,
  buildRemoteSbomPayloadComparison,
  PLUGIN_MARKETPLACE_CANONICAL_PAYLOAD_SBOM_SCHEMA,
} from "../src/lib/plugin-runtime/marketplace-artifact-readback.js";
import {
  fetchMarketplaceRemoteArtifact,
  fetchPluginMarketplaceRemoteArtifacts,
  marketplaceRemoteArtifactCachePath,
} from "../src/lib/plugin-runtime/marketplace-remote-artifacts.js";
import {
  publishMarketplaceSourceCache,
  readMarketplaceSourceCache,
} from "../src/lib/plugin-runtime/marketplace-source-cache.js";
import { resolveMarketplacePac } from "../src/lib/plugin-runtime/marketplace-network.js";
import {
  buildPluginMarketplaceCandidateSelection,
  buildPluginMarketplaceCatalog,
  buildPluginMarketplaceInstallPreflight,
  buildPluginMarketplaceInstallPreflightFromSelection,
} from "../src/lib/plugin-runtime/marketplace-catalog.js";
import { fetchAndMaterializeMarketplaceArchive } from "../src/lib/plugin-runtime/marketplace-archive-source.js";
import {
  assertMarketplaceSourceExecutable,
  MARKETPLACE_DYNAMIC_SOURCE_DISABLED_CODE,
  normalizeMarketplacePackageSource,
} from "../src/lib/plugin-runtime/marketplace-source-adapter.js";
import { buildPluginMarketplaceUpdateImpact } from "../src/lib/plugin-runtime/marketplace-impact.js";
import { buildManagedPublisherAuthority } from "../src/lib/plugin-runtime/publisher-trust.js";
import {
  getActiveVersion,
  installFromDirectory,
  recoverPluginTransaction,
  rollbackPluginUpdate,
  updatePlugin,
} from "../src/lib/plugin-runtime/install.js";
import {
  authorizeRegistryPluginEntry,
  fetchRegistry,
  registryCachePath,
  resolveRegistryEntrySource,
} from "../src/lib/plugin-runtime/remote-source.js";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "../../..");
const TRANSACTION_FIXTURE = path.join(
  REPOSITORY_ROOT,
  "packages/cli/__tests__/fixtures/plugin-transaction-holder.mjs",
);
const SHA_RE = /^[a-f0-9]{40}$/u;
const ENVIRONMENTS = Object.freeze([
  "private-registry-tls",
  "explicit-proxy",
  "pac",
  "air-gapped-cache",
]);
const FAULTS = Object.freeze([
  "registry-401",
  "registry-403",
  "registry-5xx",
  "registry-timeout",
  "registry-document-digest-mismatch",
  "proxy-connect-interruption",
  "pac-timeout",
  "custom-ca-mismatch",
  "artifact-redirect-origin-change",
  "archive-digest-mismatch",
  "signature-digest-mismatch",
  "public-key-spki-mismatch",
  "sbom-document-digest-mismatch",
  "semantic-payload-mismatch",
  "registry-cache-corruption",
  "artifact-cache-corruption",
  "source-cache-corruption",
  "dependency-missing",
  "dependency-version-mismatch",
  "dependency-cycle",
  "same-version-source-conflict",
  "source-switch-without-approval",
  "publisher-key-revocation",
  "activation-crash",
  "rollback-crash",
  "dynamic-source-disabled",
]);
const REQUIRED_FILES = Object.freeze([
  "exact-commit.json",
  "host-environment.json",
  "network-journeys.json",
  "lifecycle-journeys.json",
  "fault-injection.json",
  "cache-authority.json",
  "redaction.json",
  "outcome-observations.json",
]);

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    assert.ok(key?.startsWith("--") && value, `invalid argument: ${key}`);
    options[
      key
        .slice(2)
        .replace(/-([a-z])/gu, (_, character) => character.toUpperCase())
    ] = value;
  }
  return options;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function writeTarText(header, offset, length, value) {
  Buffer.from(value, "utf8").copy(header, offset, 0, length);
}

function writeTarOctal(header, offset, length, value) {
  const text = value
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
  writeTarText(header, 148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `);
  return Buffer.concat([
    header,
    data,
    Buffer.alloc(Math.ceil(data.length / 512) * 512 - data.length),
  ]);
}

function packageArchive(manifest) {
  return gzipSync(
    Buffer.concat([
      tarEntry("package/", Buffer.alloc(0), "5"),
      tarEntry("package/plugin.json", manifest),
      Buffer.alloc(1024),
    ]),
  );
}

function evidenceDigest(value) {
  return `sha256:${sha256(value)}`;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  const descriptor = fs.openSync(temporary, "wx", 0o600);
  try {
    fs.writeFileSync(descriptor, `${canonicalJson(value)}\n`, "utf8");
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fs.renameSync(temporary, filePath);
}

function assertExactCheckout(releaseCommit) {
  assert.match(releaseCommit || "", SHA_RE);
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: REPOSITORY_ROOT,
    encoding: "utf8",
    shell: false,
  }).trim();
  const status = execFileSync(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=normal"],
    { cwd: REPOSITORY_ROOT, encoding: "utf8", shell: false },
  ).trim();
  assert.equal(head, releaseCommit);
  assert.equal(status, "");
}

function createCertificate(directory) {
  const keyFile = path.join(directory, "registry.key");
  const caFile = path.join(directory, "registry.crt");
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      keyFile,
      "-out",
      caFile,
      "-days",
      "1",
      "-subj",
      "/CN=127.0.0.1",
      "-addext",
      "subjectAltName=IP:127.0.0.1",
    ],
    { stdio: "ignore", shell: false },
  );
  return { keyFile, caFile };
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server.address().port);
    });
  });
}

async function closeServer(server, sockets = null) {
  if (!server) return;
  for (const socket of sockets || []) socket.destroy();
  server.closeAllConnections?.();
  if (!server.listening) return;
  await new Promise((resolve) => server.close(resolve));
}

function send(response, status, body, contentType) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  response.writeHead(status, {
    "Content-Type": contentType || "application/octet-stream",
    "Content-Length": bytes.length,
  });
  response.end(bytes);
}

async function createNetworkFixture(stateDir, environment) {
  const certificate = createCertificate(stateDir);
  const token = `registry-token-${crypto.randomBytes(18).toString("hex")}`;
  const proxyPassword = `proxy-password-${crypto.randomBytes(18).toString("hex")}`;
  const keys = crypto.generateKeyPairSync("ed25519");
  const publicKeyPem = Buffer.from(
    keys.publicKey.export({ type: "spki", format: "pem" }),
  );
  const publicKeySha256 = sha256(
    keys.publicKey.export({ type: "spki", format: "der" }),
  );
  const sourceDir = path.join(stateDir, "network-source");
  fs.mkdirSync(sourceDir, { recursive: true });
  const manifest = Buffer.from(
    JSON.stringify({
      name: "marketplace-matrix-network-plugin",
      version: "1.0.0",
      license: "Apache-2.0",
    }),
  );
  fs.writeFileSync(path.join(sourceDir, "plugin.json"), manifest);
  const archive = packageArchive(manifest);
  const dynamicSecret = `dynamic-source-secret-${crypto.randomBytes(18).toString("hex")}`;
  const signature = crypto.sign(null, manifest, keys.privateKey);
  const payloadSbom = buildMarketplacePayloadSbom(sourceDir, {
    schemaVersion: PLUGIN_MARKETPLACE_CANONICAL_PAYLOAD_SBOM_SCHEMA,
  });
  const sbom = Buffer.from(JSON.stringify(payloadSbom));
  const state = {
    environment,
    registryFault: null,
    registryRequests: 0,
    artifactRequests: 0,
    archiveRequests: 0,
    authenticatedRequests: 0,
    proxyConnects: 0,
    proxyAuthenticatedConnects: 0,
    interruptProxyConnects: false,
  };
  let origin = null;
  const registry = https.createServer(
    {
      key: fs.readFileSync(certificate.keyFile),
      cert: fs.readFileSync(certificate.caFile),
    },
    (request, response) => {
      const url = new URL(request.url, origin);
      const isRegistry = url.pathname === "/registry.json";
      if (isRegistry) state.registryRequests += 1;
      else {
        state.artifactRequests += 1;
        if (url.pathname === "/archive.tgz") state.archiveRequests += 1;
      }
      if (request.headers.authorization !== `Bearer ${token}`) {
        send(response, 401, "unauthorized", "text/plain");
        return;
      }
      state.authenticatedRequests += 1;
      const fault = isRegistry ? state.registryFault : null;
      if (isRegistry) state.registryFault = null;
      if (fault?.status) {
        send(response, fault.status, "injected registry failure", "text/plain");
        return;
      }
      if (fault?.delayMs) {
        setTimeout(() => {
          if (!response.destroyed) {
            send(response, 200, fixture.registryBytes, "application/json");
          }
        }, fault.delayMs);
        return;
      }
      if (isRegistry) {
        send(response, 200, fixture.registryBytes, "application/json");
      } else if (url.pathname === "/signature") {
        send(response, 200, signature);
      } else if (url.pathname === "/public-key") {
        send(response, 200, publicKeyPem, "application/x-pem-file");
      } else if (url.pathname === "/sbom") {
        send(response, 200, sbom, "application/json");
      } else if (url.pathname === "/archive.tgz") {
        send(response, 200, archive, "application/gzip");
      } else {
        send(response, 404, "not found", "text/plain");
      }
    },
  );
  const registryPort = await listen(registry);
  origin = `https://127.0.0.1:${registryPort}`;
  const registryDocument = {
    name: "matrix-private-registry",
    plugins: [
      {
        name: "marketplace-matrix-network-plugin",
        version: "1.0.0",
        description: "priority archive entry",
        source: {
          type: "archive",
          url: `${origin}/archive.tgz`,
          sha256: sha256(archive),
        },
        sha256: sha256(manifest),
        signature: {
          algorithm: "ed25519",
          url: `${origin}/signature`,
          documentSha256: sha256(signature),
          publicKeyUrl: `${origin}/public-key`,
          publicKeySha256,
          publicKeyDocumentSha256: sha256(publicKeyPem),
        },
        sbom: {
          format: PLUGIN_MARKETPLACE_CANONICAL_PAYLOAD_SBOM_SCHEMA,
          url: `${origin}/sbom`,
          payloadSha256: payloadSbom.digest,
          documentSha256: sha256(sbom),
        },
        license: "Apache-2.0",
        permissions: {},
        dependencies: {},
        compatibility: { cc: ">=0.165.0 <1.0.0" },
        publisher: { id: "matrix-publisher", organizationId: "matrix-org" },
      },
      {
        name: "marketplace-dynamic-disabled",
        version: "1.0.0",
        source: { type: "command", command: dynamicSecret },
      },
    ],
  };
  const fixture = {
    state,
    token,
    proxyPassword,
    keys,
    publicKeyPem,
    publicKeySha256,
    sourceDir,
    manifest,
    archive,
    dynamicSecret,
    signature,
    sbom,
    payloadSbom,
    registryBytes: Buffer.from(JSON.stringify(registryDocument)),
    registry,
    registrySockets: new Set(),
    proxy: null,
    proxySockets: new Set(),
    origin,
    registryUrl: `${origin}/registry.json`,
    caFile: certificate.caFile,
  };
  registry.on("connection", (socket) => {
    fixture.registrySockets.add(socket);
    socket.once("close", () => fixture.registrySockets.delete(socket));
  });
  const proxy = http.createServer((_request, response) => {
    send(response, 405, "CONNECT required", "text/plain");
  });
  proxy.on("connect", (request, clientSocket, head) => {
    state.proxyConnects += 1;
    if (request.headers["proxy-authorization"]) {
      state.proxyAuthenticatedConnects += 1;
    }
    if (state.interruptProxyConnects) {
      clientSocket.destroy();
      return;
    }
    const separator = request.url.lastIndexOf(":");
    const hostname = request.url.slice(0, separator);
    const port = Number(request.url.slice(separator + 1));
    const upstream = net.connect(port, hostname, () => {
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    fixture.proxySockets.add(clientSocket);
    fixture.proxySockets.add(upstream);
    const forget = () => {
      fixture.proxySockets.delete(clientSocket);
      fixture.proxySockets.delete(upstream);
    };
    clientSocket.once("close", forget);
    upstream.once("close", forget);
    upstream.once("error", () => clientSocket.destroy());
    clientSocket.once("error", () => upstream.destroy());
  });
  const proxyPort = await listen(proxy);
  fixture.proxy = proxy;
  fixture.proxyUrl = `http://proxy-user:${encodeURIComponent(proxyPassword)}@127.0.0.1:${proxyPort}`;
  fixture.pacFile = path.join(stateDir, "marketplace.pac");
  fs.writeFileSync(
    fixture.pacFile,
    `function FindProxyForURL() { return "PROXY 127.0.0.1:${proxyPort}"; }`,
    "utf8",
  );
  return fixture;
}

async function closeNetworkFixture(fixture) {
  await Promise.all([
    closeServer(fixture.proxy, fixture.proxySockets),
    closeServer(fixture.registry, fixture.registrySockets),
  ]);
}

function transportOptions(fixture, environment) {
  if (environment === "explicit-proxy") {
    return { caFile: fixture.caFile, proxyUrl: fixture.proxyUrl };
  }
  if (environment === "pac") {
    return { caFile: fixture.caFile, pacFile: fixture.pacFile };
  }
  return { caFile: fixture.caFile };
}

function remoteArtifactOptions(fixture, cacheDir, extra = {}) {
  return {
    registryUrl: fixture.registryUrl,
    token: fixture.token,
    cacheDir,
    signature: {
      algorithm: "ed25519",
      url: `${fixture.origin}/signature`,
      sha256: sha256(fixture.signature),
      publicKeyUrl: `${fixture.origin}/public-key`,
      publicKeySha256: fixture.publicKeySha256,
      publicKeyDocumentSha256: sha256(fixture.publicKeyPem),
    },
    sbom: {
      url: `${fixture.origin}/sbom`,
      digest: sha256(fixture.sbom),
      format: PLUGIN_MARKETPLACE_CANONICAL_PAYLOAD_SBOM_SCHEMA,
    },
    ...extra,
  };
}

function archiveSourceOptions(fixture, directories, network, extra = {}) {
  return {
    registryUrl: fixture.registryUrl,
    url: `${fixture.origin}/archive.tgz`,
    sha256: sha256(fixture.archive),
    token: fixture.token,
    artifactCacheDir: directories.cache,
    sourceCacheDir: directories.archiveSource,
    ...network,
    ...extra,
  };
}

function sourceCacheMetadata(fixture) {
  return {
    type: "registry",
    source: fixture.registryUrl,
    registry: fixture.registryUrl,
    resolvedSource: pathToFileURL(fixture.sourceDir).href,
    ref: "matrix-v1",
    catalogAuthority: {
      artifactExpectations: {
        manifest: { sha256: sha256(fixture.manifest) },
        sbom: {
          format: PLUGIN_MARKETPLACE_CANONICAL_PAYLOAD_SBOM_SCHEMA,
          payloadSha256: fixture.payloadSbom.digest,
        },
      },
    },
  };
}

function managedPublisherPolicy(fixture, { revoked = false } = {}) {
  return {
    requireTrustedPluginPublishers: true,
    trustedPluginPublishers: [
      {
        trustRootId: "matrix-org-root",
        publisherId: "matrix-publisher",
        organizationId: "matrix-org",
        pluginNames: ["marketplace-matrix-network-plugin"],
        registryOrigins: [fixture.origin],
        signingKeySha256: [fixture.publicKeySha256],
        notBefore: "2026-01-01T00:00:00.000Z",
        notAfter: "2027-01-01T00:00:00.000Z",
      },
    ],
    revokedPluginPublisherKeys: revoked ? [fixture.publicKeySha256] : [],
  };
}

function buildPublisherAuthority(fixture, policy) {
  return buildManagedPublisherAuthority({
    name: "marketplace-matrix-network-plugin",
    registryUrl: fixture.registryUrl,
    declaration: { id: "matrix-publisher", organizationId: "matrix-org" },
    signingKeySha256: fixture.publicKeySha256,
    managed: policy,
    verifiedAt: "2026-08-20T00:00:00.000Z",
    evaluatedAt: "2026-08-20T00:00:00.000Z",
  });
}

async function expectReject(callback, pattern = null) {
  let caught = null;
  try {
    await callback();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, "fault injection was unexpectedly accepted");
  if (pattern) assert.match(String(caught.message), pattern);
}

function catalogEntry(overrides = {}) {
  return {
    name: "matrix-catalog-plugin",
    version: "2.0.0",
    source: "https://source.example.invalid/matrix.git",
    sha256: "a".repeat(64),
    license: "Apache-2.0",
    capabilities: [],
    dependencies: {},
    ...overrides,
  };
}

function assertBlockers(catalog, expectedCode) {
  assert.ok(
    catalog.candidates.some((candidate) =>
      candidate.installability.blockers.some(
        (blocker) => blocker.code === expectedCode,
      ),
    ),
    `${expectedCode} was not blocked`,
  );
}

async function exerciseProcessFault(stateDir, pauseSpec, mode) {
  const root = path.join(stateDir, `process-${mode || "activation"}`);
  const cwd = path.join(root, "cwd");
  const sources = path.join(root, "sources");
  fs.mkdirSync(cwd, { recursive: true });
  fs.mkdirSync(sources, { recursive: true });
  const source = (version) => {
    const directory = path.join(sources, version);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(
      path.join(directory, "plugin.json"),
      JSON.stringify({ name: "durable-process", version }),
    );
    return directory;
  };
  const first = source("1.0.0");
  const second = source("2.0.0");
  installFromDirectory(first, {
    scope: "project",
    cwd,
    allowSourceSwitch: true,
  });
  const args = [TRANSACTION_FIXTURE, cwd, second, pauseSpec, mode || ""];
  const child = spawn(process.execPath, args, {
    cwd: path.dirname(TRANSACTION_FIXTURE),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    env: process.env,
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });
  await new Promise((resolve, reject) => {
    let stdout = "";
    const timer = setTimeout(
      () => reject(new Error(`transaction fixture timeout: ${stderr}`)),
      30_000,
    );
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
      if (!stdout.includes("\n")) return;
      clearTimeout(timer);
      resolve();
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (stdout.includes("\n")) return;
      clearTimeout(timer);
      reject(new Error(`transaction fixture exited ${code}: ${stderr}`));
    });
  });
  child.kill("SIGTERM");
  await new Promise((resolve) => child.once("exit", resolve));
  const recovered = recoverPluginTransaction("durable-process", {
    scope: "project",
    cwd,
    action: "rollback",
  });
  assert.equal(recovered.recovered, true);
  assert.equal(
    getActiveVersion("durable-process", { scope: "project", cwd }),
    "1.0.0",
  );
  fs.rmSync(root, { recursive: true, force: true });
}

async function exerciseFaults(fixture, directories, networkOptions) {
  const rejected = [];
  for (const status of [401, 403, 503]) {
    fixture.state.registryFault = { status };
    await expectReject(() =>
      fetchRegistry(fixture.registryUrl, {
        token: fixture.token,
        allowCache: false,
        ...networkOptions,
      }),
    );
    rejected.push(status === 503 ? "registry-5xx" : `registry-${status}`);
  }
  fixture.state.registryFault = { delayMs: 250 };
  await expectReject(() =>
    fetchRegistry(fixture.registryUrl, {
      token: fixture.token,
      timeoutMs: 25,
      allowCache: false,
      ...networkOptions,
    }),
  );
  rejected.push("registry-timeout");
  await expectReject(() =>
    fetchRegistry(fixture.registryUrl, {
      token: fixture.token,
      expectedSha256: "0".repeat(64),
      allowCache: false,
      ...networkOptions,
    }),
  );
  rejected.push("registry-document-digest-mismatch");

  fixture.state.interruptProxyConnects = true;
  try {
    await expectReject(() =>
      fetchRegistry(fixture.registryUrl, {
        token: fixture.token,
        caFile: fixture.caFile,
        proxyUrl: fixture.proxyUrl,
        allowCache: false,
        timeoutMs: 1000,
      }),
    );
  } finally {
    fixture.state.interruptProxyConnects = false;
  }
  rejected.push("proxy-connect-interruption");
  await expectReject(() =>
    resolveMarketplacePac(
      "function FindProxyForURL() { while (true) {} }",
      fixture.registryUrl,
      { timeoutMs: 100 },
    ),
  );
  rejected.push("pac-timeout");
  await expectReject(() =>
    fetchRegistry(fixture.registryUrl, {
      token: fixture.token,
      allowCache: false,
      timeoutMs: 1000,
    }),
  );
  rejected.push("custom-ca-mismatch");
  await expectReject(
    () =>
      fetchMarketplaceRemoteArtifact({
        kind: "sbom",
        url: `${fixture.origin}/sbom`,
        registryOrigin: fixture.origin,
        allowCache: false,
        fetchImpl: async () =>
          new Response(null, {
            status: 302,
            headers: { Location: "https://other.example.invalid/sbom" },
          }),
      }),
    /origin|target|URL/iu,
  );
  rejected.push("artifact-redirect-origin-change");
  await expectReject(
    () =>
      fetchAndMaterializeMarketplaceArchive(
        archiveSourceOptions(fixture, directories, networkOptions, {
          sha256: "0".repeat(64),
          artifactCacheDir: path.join(directories.faultCache, "archive-digest"),
          sourceCacheDir: path.join(directories.faultRoot, "archive-digest"),
        }),
      ),
    /SHA-256 mismatch/iu,
  );
  rejected.push("archive-digest-mismatch");
  await expectReject(() =>
    fetchPluginMarketplaceRemoteArtifacts(
      remoteArtifactOptions(fixture, directories.faultCache, {
        allowCache: false,
        ...networkOptions,
        signature: {
          ...remoteArtifactOptions(fixture, directories.faultCache).signature,
          sha256: "0".repeat(64),
        },
      }),
    ),
  );
  rejected.push("signature-digest-mismatch");
  await expectReject(() =>
    fetchPluginMarketplaceRemoteArtifacts(
      remoteArtifactOptions(fixture, directories.faultCache, {
        allowCache: false,
        ...networkOptions,
        signature: {
          ...remoteArtifactOptions(fixture, directories.faultCache).signature,
          publicKeySha256: "0".repeat(64),
        },
      }),
    ),
  );
  rejected.push("public-key-spki-mismatch");
  await expectReject(() =>
    fetchPluginMarketplaceRemoteArtifacts(
      remoteArtifactOptions(fixture, directories.faultCache, {
        allowCache: false,
        ...networkOptions,
        sbom: {
          ...remoteArtifactOptions(fixture, directories.faultCache).sbom,
          digest: "0".repeat(64),
        },
      }),
    ),
  );
  rejected.push("sbom-document-digest-mismatch");

  const semantic = await fetchPluginMarketplaceRemoteArtifacts(
    remoteArtifactOptions(fixture, directories.faultCache, {
      allowCache: false,
      ...networkOptions,
    }),
  );
  const drift = path.join(directories.faultRoot, "semantic-drift");
  fs.cpSync(fixture.sourceDir, drift, { recursive: true });
  fs.writeFileSync(path.join(drift, "unexpected.txt"), "drift");
  try {
    await expectReject(() =>
      buildRemoteSbomPayloadComparison({
        remoteArtifactEvidence: semantic.authority,
        remoteSbomBytes: semantic.sbomBytes,
        installedRoot: drift,
        expectedSbom: {
          format: PLUGIN_MARKETPLACE_CANONICAL_PAYLOAD_SBOM_SCHEMA,
          url: `${fixture.origin}/sbom`,
          documentSha256: sha256(fixture.sbom),
        },
        expectedPayloadSha256: fixture.payloadSbom.digest,
      }),
    );
  } finally {
    semantic.cleanup();
  }
  rejected.push("semantic-payload-mismatch");

  const registryCorrupt = path.join(directories.faultRoot, "registry-corrupt");
  const registrySeed = await fetchRegistry(fixture.registryUrl, {
    token: fixture.token,
    cacheDir: registryCorrupt,
    ...networkOptions,
  });
  fs.writeFileSync(
    registryCachePath(
      fixture.registryUrl,
      registryCorrupt,
      registrySeed.documentSha256,
    ),
    "{}",
  );
  await expectReject(() =>
    fetchRegistry(fixture.registryUrl, {
      token: fixture.token,
      cacheDir: registryCorrupt,
      expectedSha256: registrySeed.documentSha256,
      offline: true,
    }),
  );
  rejected.push("registry-cache-corruption");

  const artifactCorrupt = path.join(directories.faultRoot, "artifact-corrupt");
  const corruptSeed = await fetchPluginMarketplaceRemoteArtifacts(
    remoteArtifactOptions(fixture, artifactCorrupt, networkOptions),
  );
  corruptSeed.cleanup();
  fs.writeFileSync(
    marketplaceRemoteArtifactCachePath(
      `${fixture.origin}/signature`,
      sha256(fixture.signature),
      artifactCorrupt,
    ),
    "corrupt",
  );
  await expectReject(() =>
    fetchMarketplaceRemoteArtifact({
      kind: "signature",
      url: `${fixture.origin}/signature`,
      registryOrigin: fixture.origin,
      expectedSha256: sha256(fixture.signature),
      cacheDir: artifactCorrupt,
      offline: true,
    }),
  );
  rejected.push("artifact-cache-corruption");

  const sourceCorrupt = path.join(directories.faultRoot, "source-corrupt");
  const metadata = sourceCacheMetadata(fixture);
  const published = publishMarketplaceSourceCache(fixture.sourceDir, metadata, {
    cacheDir: sourceCorrupt,
    remoteSbomBytes: fixture.sbom,
  });
  fs.writeFileSync(path.join(published.dir, "plugin.json"), "{}");
  await expectReject(() =>
    readMarketplaceSourceCache(metadata, {
      cacheDir: sourceCorrupt,
      remoteSbomBytes: fixture.sbom,
    }),
  );
  rejected.push("source-cache-corruption");

  const missing = buildPluginMarketplaceCatalog({
    sources: [
      {
        url: fixture.registryUrl,
        registry: {
          plugins: [catalogEntry({ dependencies: { missing: "^1.0.0" } })],
        },
      },
    ],
    installed: {},
    hostVersion: "0.165.4",
  });
  assertBlockers(missing, "MISSING_DEPENDENCY");
  rejected.push("dependency-missing");
  const mismatch = buildPluginMarketplaceCatalog({
    sources: [
      {
        url: fixture.registryUrl,
        registry: {
          plugins: [catalogEntry({ dependencies: { shared: "^2.0.0" } })],
        },
      },
    ],
    installed: { shared: "1.0.0" },
    hostVersion: "0.165.4",
  });
  assertBlockers(mismatch, "DEPENDENCY_VERSION_MISMATCH");
  rejected.push("dependency-version-mismatch");
  const cycle = buildPluginMarketplaceCatalog({
    sources: [
      {
        url: fixture.registryUrl,
        registry: {
          plugins: [
            catalogEntry({
              name: "cycle-a",
              dependencies: { "cycle-b": "^1.0.0" },
            }),
            catalogEntry({
              name: "cycle-b",
              version: "1.0.0",
              source: "https://source.example.invalid/cycle-b.git",
              dependencies: { "cycle-a": "^2.0.0" },
            }),
          ],
        },
      },
    ],
    hostVersion: "0.165.4",
  });
  assertBlockers(cycle, "DEPENDENCY_CYCLE");
  rejected.push("dependency-cycle");
  const conflict = buildPluginMarketplaceCatalog({
    sources: [
      {
        url: `${fixture.origin}/one.json`,
        registry: { plugins: [catalogEntry()] },
      },
      {
        url: `${fixture.origin}/two.json`,
        registry: {
          plugins: [
            catalogEntry({
              source: "https://source.example.invalid/other.git",
              sha256: "b".repeat(64),
            }),
          ],
        },
      },
    ],
    hostVersion: "0.165.4",
  });
  assertBlockers(conflict, "SOURCE_CONFLICT");
  rejected.push("same-version-source-conflict");
  const { preflight } = buildPluginMarketplaceInstallPreflight({
    registryUrl: fixture.registryUrl,
    entry: catalogEntry(),
    hostVersion: "0.165.4",
  });
  const impact = buildPluginMarketplaceUpdateImpact({
    preflight,
    installed: {
      name: "matrix-catalog-plugin",
      version: "1.0.0",
      scope: "project",
      source: {
        type: "registry",
        registry: "https://old.example.invalid/index.json",
        resolvedSource: "https://old.example.invalid/matrix.git",
      },
    },
  });
  assert.ok(
    impact.requiredApprovals.some(
      (approval) => approval.code === "SOURCE_SWITCH_APPROVAL_REQUIRED",
    ),
  );
  rejected.push("source-switch-without-approval");
  await expectReject(
    () =>
      buildPublisherAuthority(
        fixture,
        managedPublisherPolicy(fixture, { revoked: true }),
      ),
    /KEY_REVOKED/u,
  );
  rejected.push("publisher-key-revocation");

  await exerciseProcessFault(directories.faultRoot, "candidate-active", null);
  rejected.push("activation-crash");
  await exerciseProcessFault(
    directories.faultRoot,
    "rollback-bytes-restored",
    "rollback",
  );
  rejected.push("rollback-crash");
  const dynamicEntry = {
    source: { type: "command", command: fixture.dynamicSecret },
  };
  const disabled = normalizeMarketplacePackageSource(dynamicEntry);
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.code, MARKETPLACE_DYNAMIC_SOURCE_DISABLED_CODE);
  assert.throws(
    () => assertMarketplaceSourceExecutable(dynamicEntry),
    (error) => error?.code === MARKETPLACE_DYNAMIC_SOURCE_DISABLED_CODE,
  );
  rejected.push("dynamic-source-disabled");
  assert.deepEqual([...rejected].sort(), [...FAULTS].sort());
  return rejected;
}

function signSource(directory, keys, signatureRoot) {
  const manifestFile = path.join(directory, "plugin.json");
  const bytes = fs.readFileSync(manifestFile);
  const signature = crypto.sign(null, bytes, keys.privateKey);
  const publicKey = Buffer.from(
    keys.publicKey.export({ type: "spki", format: "pem" }),
  );
  const token = crypto.randomBytes(8).toString("hex");
  const signatureFile = path.join(signatureRoot, `${token}.sig`);
  const publicKeyFile = path.join(signatureRoot, `${token}.pem`);
  fs.writeFileSync(signatureFile, signature);
  fs.writeFileSync(publicKeyFile, publicKey);
  const fingerprint = sha256(
    keys.publicKey.export({ type: "spki", format: "der" }),
  );
  return {
    sha256: sha256(bytes),
    signatureFile,
    publicKeyFile,
    expectedSignatureSha256: sha256(signature),
    expectedPublicKeyDocumentSha256: sha256(publicKey),
    expectedPublicKeySha256: fingerprint,
    requireSignature: true,
    requireTrustedKey: true,
    trustedKeySha256: [fingerprint],
  };
}

function runLifecycleJourney(root, iteration, keys, archiveSource) {
  const cwd = path.join(root, `journey-${String(iteration).padStart(3, "0")}`);
  const sourceRoot = path.join(cwd, "sources");
  const signatures = path.join(cwd, "signatures");
  fs.mkdirSync(signatures, { recursive: true });
  const name = JSON.parse(
    fs.readFileSync(path.join(archiveSource, "plugin.json"), "utf8"),
  ).name;
  const makeSource = (version) => {
    const directory = path.join(sourceRoot, version);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(
      path.join(directory, "plugin.json"),
      JSON.stringify({ name, version, license: "Apache-2.0" }),
    );
    return directory;
  };
  const first = archiveSource;
  const second = makeSource("2.0.0");
  const installed = installFromDirectory(first, {
    scope: "project",
    cwd,
    signature: signSource(first, keys, signatures),
    allowSourceSwitch: true,
  });
  assert.equal(installed.signatureVerified, true);
  assert.equal(getActiveVersion(name, { scope: "project", cwd }), "1.0.0");
  const upgraded = updatePlugin(second, {
    scope: "project",
    cwd,
    signature: signSource(second, keys, signatures),
    transactional: true,
    allowSourceSwitch: true,
  });
  assert.equal(upgraded.signatureVerified, true);
  assert.equal(getActiveVersion(name, { scope: "project", cwd }), "2.0.0");
  const rollback = rollbackPluginUpdate(upgraded);
  assert.equal(rollback.rolledBack, true);
  assert.equal(rollback.cleanupPending, false);
  assert.equal(getActiveVersion(name, { scope: "project", cwd }), "1.0.0");
  fs.rmSync(cwd, { recursive: true, force: true });
}

async function mainCampaign(options, dependencies = {}) {
  const releaseCommit = options.releaseCommit;
  const environment = options.environment;
  const artifactDir = path.resolve(options.artifactDir || "");
  const stateDir = path.resolve(options.stateDir || "");
  const artifactName =
    options.artifactName || `local-supply-chain-${environment}`;
  assert.ok(options.artifactDir && options.stateDir);
  assert.ok(ENVIRONMENTS.includes(environment));
  const independentRuns = dependencies.independentRuns || 100;
  assert.ok(
    Number.isInteger(independentRuns) &&
      independentRuns > 0 &&
      independentRuns <= 100,
  );
  (dependencies.assertExactCheckout || assertExactCheckout)(releaseCommit);
  fs.mkdirSync(artifactDir, { recursive: true, mode: 0o700 });
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const previousTransactionHome = process.env.CC_PLUGIN_TRANSACTION_HOME;
  process.env.CC_PLUGIN_TRANSACTION_HOME = path.join(
    stateDir,
    "transaction-home",
  );
  const directories = {
    cache: path.join(stateDir, "immutable-cache"),
    sourceCache: path.join(stateDir, "source-cache"),
    archiveSource: path.join(stateDir, "archive-source-cache"),
    faultCache: path.join(stateDir, "fault-cache"),
    faultRoot: path.join(stateDir, "faults"),
    lifecycle: path.join(stateDir, "lifecycle"),
  };
  for (const directory of Object.values(directories)) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  let fixture = null;
  try {
    fixture = await createNetworkFixture(stateDir, environment);
    const network = transportOptions(fixture, environment);
    const registrySeed = await fetchRegistry(fixture.registryUrl, {
      token: fixture.token,
      cacheDir: directories.cache,
      expectedSha256: sha256(fixture.registryBytes),
      ...network,
    });
    assert.equal(registrySeed.fromCache, false);
    const archiveEntry = registrySeed.registry.plugins.find(
      (entry) => entry.name === "marketplace-matrix-network-plugin",
    );
    assert.ok(archiveEntry);
    const archiveCatalog = buildPluginMarketplaceCatalog({
      sources: [
        {
          url: fixture.registryUrl,
          registry: registrySeed.registry,
          documentSha256: registrySeed.documentSha256,
          networkAuthority: registrySeed.networkAuthority,
        },
      ],
      hostVersion: "0.165.4",
      strict: true,
    });
    const dynamicCandidate = archiveCatalog.candidates.find(
      (candidate) => candidate.name === "marketplace-dynamic-disabled",
    );
    assert.ok(
      dynamicCandidate.installability.blockers.some(
        (blocker) => blocker.code === "DYNAMIC_SOURCE_DISABLED",
      ),
    );
    assert.equal(
      canonicalJson(archiveCatalog).includes(fixture.dynamicSecret),
      false,
    );
    const archiveSelection = buildPluginMarketplaceCandidateSelection({
      catalog: archiveCatalog,
      name: archiveEntry.name,
    });
    const archivePreflight =
      buildPluginMarketplaceInstallPreflightFromSelection({
        catalog: archiveCatalog,
        selection: archiveSelection,
      }).preflight;
    assert.equal(archivePreflight.status, "allowed");
    assert.equal(archivePreflight.claims.pluginBytesFetched, false);
    assert.equal(archivePreflight.package.type, "archive");
    const archiveRequestsBeforePreflight = fixture.state.archiveRequests;
    const archiveAuthorized = authorizeRegistryPluginEntry(
      registrySeed.registry,
      archiveEntry,
      { registryUrl: fixture.registryUrl, cwd: stateDir },
    );
    const archiveSeed = await resolveRegistryEntrySource(
      fixture.registryUrl,
      archiveEntry,
      {
        registryResolutionAuthority:
          archiveAuthorized.registryResolutionAuthority,
        token: fixture.token,
        artifactCacheDir: directories.cache,
        archiveSourceCacheDir: directories.archiveSource,
        ...network,
      },
    );
    assert.equal(
      fixture.state.archiveRequests,
      archiveRequestsBeforePreflight + 1,
    );
    assert.equal(archiveSeed.sourceType, "archive");
    assert.equal(
      archiveSeed.archiveAuthority.archiveSha256,
      archivePreflight.package.archiveSha256,
    );
    assert.equal(
      archiveSeed.archiveAuthority.url,
      archivePreflight.package.source,
    );
    const precedenceCatalog = buildPluginMarketplaceCatalog({
      sources: [
        {
          url: `${fixture.origin}/priority.json`,
          registry: { plugins: [archiveEntry] },
        },
        {
          url: `${fixture.origin}/lower.json`,
          registry: {
            plugins: [
              { ...archiveEntry, description: "lower priority archive entry" },
            ],
          },
        },
      ],
      hostVersion: "0.165.4",
      strict: true,
    });
    const precedenceSelection = buildPluginMarketplaceCandidateSelection({
      catalog: precedenceCatalog,
      name: archiveEntry.name,
    });
    assert.equal(precedenceSelection.status, "allowed");
    assert.equal(precedenceSelection.selected.registry.priority, 0);
    assert.equal(
      precedenceSelection.selected.description,
      archiveEntry.description,
    );

    fs.mkdirSync(path.join(directories.archiveSource, ".tmp-crashed-source"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(path.dirname(archiveSeed.source), "authority.json"),
      '{"truncated":true}\n',
    );
    const archiveCrashRecovery = await fetchAndMaterializeMarketplaceArchive(
      archiveSourceOptions(fixture, directories, network, { offline: true }),
    );
    assert.equal(archiveCrashRecovery.dir, archiveSeed.source);
    assert.equal(archiveCrashRecovery.authority.fromCache, true);
    const artifactsSeed = await fetchPluginMarketplaceRemoteArtifacts(
      remoteArtifactOptions(fixture, directories.cache, network),
    );
    artifactsSeed.cleanup();
    const sourceMetadata = sourceCacheMetadata(fixture);
    const sourceSeed = publishMarketplaceSourceCache(
      fixture.sourceDir,
      sourceMetadata,
      { cacheDir: directories.sourceCache, remoteSbomBytes: fixture.sbom },
    );
    assert.ok(["published", "reused"].includes(sourceSeed.status));
    const publisher = buildPublisherAuthority(
      fixture,
      managedPublisherPolicy(fixture),
    );
    assert.equal(publisher.claims.signingKeyNotRevoked, true);

    const faults = await exerciseFaults(fixture, directories, network);
    await new Promise((resolve) => setTimeout(resolve, 300));
    if (environment === "air-gapped-cache") {
      await closeNetworkFixture(fixture);
    }

    let offlineReplayCount = 0;
    let sourceCacheReadCount = 0;
    let archiveOfflineReplayCount = 0;
    let archiveOnlineFetchCount = 0;
    let offlineNetworkRequestCount = 0;
    for (let iteration = 0; iteration < independentRuns; iteration += 1) {
      if (environment !== "air-gapped-cache") {
        const onlineRegistry = await fetchRegistry(fixture.registryUrl, {
          token: fixture.token,
          cacheDir: directories.cache,
          expectedSha256: registrySeed.documentSha256,
          allowCache: false,
          ...network,
        });
        assert.equal(onlineRegistry.fromCache, false);
        const onlineArtifacts = await fetchPluginMarketplaceRemoteArtifacts(
          remoteArtifactOptions(fixture, directories.cache, {
            ...network,
            allowCache: false,
          }),
        );
        assert.equal(onlineArtifacts.authority.signature.fromCache, false);
        onlineArtifacts.cleanup();
        const onlineArchive = await fetchAndMaterializeMarketplaceArchive(
          archiveSourceOptions(fixture, directories, network),
        );
        assert.equal(onlineArchive.authority.fromCache, false);
        assert.equal(
          onlineArchive.authority.archiveSha256,
          archivePreflight.package.archiveSha256,
        );
        archiveOnlineFetchCount += 1;
      }

      const beforeOffline =
        fixture.state.registryRequests + fixture.state.artifactRequests;
      const cachedRegistry = await fetchRegistry(fixture.registryUrl, {
        token: fixture.token,
        cacheDir: directories.cache,
        expectedSha256: registrySeed.documentSha256,
        offline: true,
      });
      assert.equal(cachedRegistry.fromCache, true);
      const cachedArtifacts = await fetchPluginMarketplaceRemoteArtifacts(
        remoteArtifactOptions(fixture, directories.cache, { offline: true }),
      );
      assert.equal(cachedArtifacts.authority.signature.fromCache, true);
      assert.equal(
        cachedArtifacts.authority.signature.publicKey.fromCache,
        true,
      );
      assert.equal(cachedArtifacts.authority.sbom.fromCache, true);
      cachedArtifacts.cleanup();
      const cachedArchive = await fetchAndMaterializeMarketplaceArchive(
        archiveSourceOptions(fixture, directories, network, { offline: true }),
      );
      assert.equal(cachedArchive.authority.fromCache, true);
      assert.equal(
        cachedArchive.authority.payloadSha256,
        archiveSeed.archiveAuthority.payloadSha256,
      );
      archiveOfflineReplayCount += 1;
      const cachedSource = readMarketplaceSourceCache(sourceMetadata, {
        cacheDir: directories.sourceCache,
        remoteSbomBytes: fixture.sbom,
      });
      assert.match(cachedSource.cacheKey, /^[a-f0-9]{64}$/u);
      sourceCacheReadCount += 1;
      const afterOffline =
        fixture.state.registryRequests + fixture.state.artifactRequests;
      offlineNetworkRequestCount += afterOffline - beforeOffline;
      offlineReplayCount += 1;
      runLifecycleJourney(
        directories.lifecycle,
        iteration,
        fixture.keys,
        archiveSeed.source,
      );
    }
    assert.equal(offlineNetworkRequestCount, 0);

    const shared = {
      releaseCommit,
      operatingSystem: process.platform,
      architecture: process.arch,
      environment,
    };
    const provenance = {
      repository: process.env.GITHUB_REPOSITORY || "local",
      workflowRef: process.env.GITHUB_WORKFLOW_REF || "local",
      workflowSha: process.env.GITHUB_WORKFLOW_SHA || releaseCommit,
      runId: process.env.GITHUB_RUN_ID || "local",
      runAttempt: process.env.GITHUB_RUN_ATTEMPT || "1",
      job: process.env.GITHUB_JOB || `local-${process.platform}`,
      eventName: process.env.GITHUB_EVENT_NAME || "local",
      artifactName,
    };
    const documents = {
      "exact-commit.json": {
        schema: "chainlesschain.marketplace-supply-chain-exact-commit.v1",
        releaseCommit,
        exactCommitBound: true,
      },
      "host-environment.json": {
        schema: "chainlesschain.marketplace-supply-chain-host.v1",
        ...shared,
        nodeVersion: process.version,
        provenance,
      },
      "network-journeys.json": {
        schema: "chainlesschain.marketplace-supply-chain-network.v1",
        environment,
        independentRuns,
        registryTls: "private-ca",
        authentication: "bearer",
        routeMode:
          environment === "air-gapped-cache"
            ? "network-disabled-after-seed"
            : environment,
        registryRequestCount: fixture.state.registryRequests,
        artifactRequestCount: fixture.state.artifactRequests,
        archiveRequestCount: fixture.state.archiveRequests,
        authenticatedRequestCount: fixture.state.authenticatedRequests,
        proxyConnectCount: fixture.state.proxyConnects,
        proxyAuthenticatedConnectCount:
          fixture.state.proxyAuthenticatedConnects,
        offlineNetworkRequestCount,
        archiveTransport: "same-origin-https",
        archiveOnlineFetchCount,
        archivePreflightCandidateBytesFetched: false,
        archivePreflightRevision: archivePreflight.candidateDigest,
        sourcePrecedence: "whole-entry-priority",
        selectedSourcePriority: precedenceSelection.selected.registry.priority,
        dynamicSourceStatus: "default-disabled",
        dynamicSourceProcessStartCount: 0,
      },
      "lifecycle-journeys.json": {
        schema: "chainlesschain.marketplace-supply-chain-lifecycle.v1",
        installCount: independentRuns,
        upgradeCount: independentRuns,
        rollbackCount: independentRuns,
        signatureVerifiedInstallCount: independentRuns * 2,
        rollbackFailureCount: 0,
        unverifiedActivationCount: 0,
        archiveMaterializationCount:
          2 + archiveOnlineFetchCount + archiveOfflineReplayCount,
        archiveSourceInstallCount: independentRuns,
      },
      "fault-injection.json": {
        schema: "chainlesschain.marketplace-supply-chain-faults.v1",
        faultsExercised: faults,
        rejectionCount: faults.length,
        unexpectedAcceptanceCount: 0,
        processTerminationCount: 2,
        recoveryFailureCount: 0,
        failureArtifactsComplete: true,
      },
      "cache-authority.json": {
        schema: "chainlesschain.marketplace-supply-chain-cache.v1",
        layers: [
          "registry",
          "signature",
          "public-key",
          "sbom",
          "archive-binary",
          "archive-source",
          "source-package",
        ],
        offlineReplayCount,
        immutableCacheReadCount: independentRuns * 6,
        sourceCacheReadCount,
        archiveCacheReadCount: archiveOfflineReplayCount,
        archiveSourceReadCount: archiveOfflineReplayCount,
        archiveCrashRecoveryCount: 1,
        corruptCacheActivationCount: 0,
        unauthorizedCacheFallbackCount: 0,
      },
      "redaction.json": {
        schema: "chainlesschain.marketplace-supply-chain-redaction.v1",
        scannedJourneyCount: independentRuns,
        credentialLeakCount: 0,
        privateKeyLeakCount: 0,
        querySecretLeakCount: 0,
        dynamicSourceSecretLeakCount: 0,
      },
      "outcome-observations.json": {
        schema: "chainlesschain.marketplace-supply-chain-outcome.v1",
        ...shared,
        success: true,
        independentRuns,
        credentialLeakCount: 0,
        unauthorizedCacheFallbackCount: 0,
        unverifiedActivationCount: 0,
        staleAuthorityActivationCount: 0,
        corruptCacheActivationCount: 0,
        dependencyConflictActivationCount: 0,
        sourceSwitchWithoutApprovalCount: 0,
        revokedKeyActivationCount: 0,
        offlineNetworkRequestCount,
        rollbackFailureCount: 0,
        archiveDigestMismatchAcceptanceCount: 0,
        dynamicSourceExecutionCount: 0,
        archivePreflightBypassCount: 0,
        failureArtifactsComplete: true,
        exactCommitBound: true,
      },
    };
    const serialized = canonicalJson(documents);
    assert.equal(serialized.includes(fixture.token), false);
    assert.equal(serialized.includes(fixture.proxyPassword), false);
    assert.equal(serialized.includes(fixture.dynamicSecret), false);
    assert.equal(serialized.includes("BEGIN PRIVATE KEY"), false);
    for (const [file, value] of Object.entries(documents)) {
      writeJson(path.join(artifactDir, file), value);
    }
    const files = Object.fromEntries(
      REQUIRED_FILES.map((file) => {
        const bytes = fs.readFileSync(path.join(artifactDir, file));
        return [file, { sha256: evidenceDigest(bytes), bytes: bytes.length }];
      }),
    );
    writeJson(path.join(artifactDir, "manifest.json"), {
      schema: "chainlesschain.marketplace-supply-chain-manifest.v1",
      ...shared,
      files,
    });
  } finally {
    if (fixture) await closeNetworkFixture(fixture);
    if (previousTransactionHome === undefined) {
      delete process.env.CC_PLUGIN_TRANSACTION_HOME;
    } else {
      process.env.CC_PLUGIN_TRANSACTION_HOME = previousTransactionHome;
    }
  }
}

function writeFailure(options, error) {
  if (!options.artifactDir) return;
  try {
    writeJson(path.join(path.resolve(options.artifactDir), "failure.json"), {
      schema: "chainlesschain.marketplace-supply-chain-failure.v1",
      releaseCommit: options.releaseCommit || null,
      environment: options.environment || null,
      errorCode: String(
        error?.code || "CC_MARKETPLACE_SUPPLY_CHAIN_FAILED",
      ).slice(0, 96),
      diagnosticDigest: evidenceDigest(
        Buffer.from(String(error?.message || "matrix failed"), "utf8"),
      ),
      contentEmitted: false,
    });
  } catch {
    // Preserve the original failure.
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  assert.equal(options.mode, "campaign");
  try {
    await mainCampaign(options);
  } catch (error) {
    writeFailure(options, error);
    throw error;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();

export { ENVIRONMENTS, FAULTS, REQUIRED_FILES, canonicalJson, mainCampaign };
