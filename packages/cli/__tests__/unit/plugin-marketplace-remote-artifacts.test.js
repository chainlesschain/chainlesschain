import { afterEach, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import tls from "node:tls";
import {
  MARKETPLACE_REMOTE_ARTIFACT_LIMITS,
  MAX_MARKETPLACE_ARTIFACT_URL_LENGTH,
  PLUGIN_MARKETPLACE_REMOTE_ARTIFACT_EVIDENCE_SCHEMA,
  assertMarketplaceArtifactUrlSafe,
  fetchMarketplaceRemoteArtifact,
  fetchPluginMarketplaceRemoteArtifacts,
  marketplaceRemoteArtifactCachePath,
  redactMarketplaceArtifactError,
} from "../../src/lib/plugin-runtime/marketplace-remote-artifacts.js";

const tempDirs = [];
const servers = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => closeServer(server)));
  for (const directory of tempDirs.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("marketplace remote artifact bundle", () => {
  it("fetches a key-bound signature and digest-bound SBOM into stable evidence", async () => {
    const cacheDir = makeTempDir("cc-marketplace-artifact-cache-");
    const manifest = Buffer.from('{"name":"signed-plugin","version":"1.0.0"}');
    const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
    const signature = crypto.sign(null, manifest, privateKey);
    const publicKeyPem = Buffer.from(
      publicKey.export({ type: "spki", format: "pem" }),
    );
    const publicKeySha256 = sha256(
      publicKey.export({ type: "spki", format: "der" }),
    );
    const sbom = Buffer.from(
      JSON.stringify({ bomFormat: "CycloneDX", specVersion: "1.6" }),
    );
    const seenAuthorization = [];
    const { server, origin } = await startServer((request, response) => {
      seenAuthorization.push(request.headers.authorization || null);
      if (request.url.startsWith("/signature")) {
        return send(response, signature);
      }
      if (request.url.startsWith("/publisher")) {
        return send(response, publicKeyPem);
      }
      if (request.url.startsWith("/sbom")) return send(response, sbom);
      response.writeHead(404).end();
    });
    servers.push(server);

    const input = {
      registryUrl: `${origin}/index.json?registry_secret=hidden`,
      token: "private-registry-token",
      cacheDir,
      signature: {
        algorithm: "ed25519",
        url: `${origin}/signature?download_secret=hidden`,
        publicKeyUrl: `${origin}/publisher?key_secret=hidden`,
        publicKeySha256,
      },
      sbom: {
        url: `${origin}/sbom?sbom_secret=hidden`,
        digest: sha256(sbom),
        format: "cyclonedx-json",
      },
    };
    const first = await fetchPluginMarketplaceRemoteArtifacts(input);
    const second = await fetchPluginMarketplaceRemoteArtifacts(input);
    try {
      expect(first.authority).toMatchObject({
        schemaVersion: PLUGIN_MARKETPLACE_REMOTE_ARTIFACT_EVIDENCE_SCHEMA,
        status: "verified",
        registryOrigin: origin,
        signature: {
          status: "fetched",
          url: `${origin}/signature`,
          signatureSha256: sha256(signature),
          bytes: signature.length,
          fromCache: false,
          publicKey: {
            url: `${origin}/publisher`,
            documentSha256: sha256(publicKeyPem),
            spkiSha256: publicKeySha256,
            bytes: publicKeyPem.length,
            fromCache: false,
          },
        },
        sbom: {
          status: "digest-verified",
          url: `${origin}/sbom`,
          format: "cyclonedx-json",
          expectedDocumentSha256: sha256(sbom),
          documentSha256: sha256(sbom),
          bytes: sbom.length,
          fromCache: false,
        },
        claims: {
          publisherIdentityVerified: false,
          signatureBytesFetched: true,
          publicKeyFingerprintVerified: true,
          manifestSignatureVerified: false,
          sbomDocumentDigestVerified: true,
          sbomPayloadCompared: false,
        },
      });
      expect(first.authority.evidenceDigest).toBe(
        evidenceDigest(first.authority),
      );
      expect(first.authority.evidenceDigest).toBe(
        second.authority.evidenceDigest,
      );
      expect(fs.readFileSync(first.signatureFile)).toEqual(signature);
      expect(fs.readFileSync(first.publicKeyFile)).toEqual(publicKeyPem);
      expect(first.sbomBytes).toEqual(sbom);
      expect(seenAuthorization).toHaveLength(6);
      expect(new Set(seenAuthorization)).toEqual(
        new Set(["Bearer private-registry-token"]),
      );

      const serialized = JSON.stringify(first.authority);
      expect(serialized).not.toContain("private-registry-token");
      expect(serialized).not.toContain("hidden");
      expect(serialized).not.toContain(path.dirname(first.signatureFile));
    } finally {
      first.cleanup();
      first.cleanup();
      second.cleanup();
    }
    expect(fs.existsSync(first.signatureFile)).toBe(false);
  });

  it("fails closed on a mismatched SPKI fingerprint or SBOM digest", async () => {
    const { publicKey } = crypto.generateKeyPairSync("ed25519");
    const publicKeyPem = Buffer.from(
      publicKey.export({ type: "spki", format: "pem" }),
    );
    const responseByPath = new Map([
      ["/signature", Buffer.alloc(64, 1)],
      ["/publisher", publicKeyPem],
      ["/sbom", Buffer.from("sbom")],
    ]);
    const fetchImpl = async (value) => {
      const body = responseByPath.get(new URL(value).pathname);
      return new Response(body || "missing", { status: body ? 200 : 404 });
    };
    const base = {
      registryUrl: "https://registry.example/index.json",
      fetchImpl,
      allowCache: false,
      signature: {
        url: "https://registry.example/signature",
        publicKeyUrl: "https://registry.example/publisher",
        publicKeySha256: "f".repeat(64),
      },
    };

    await expect(
      fetchPluginMarketplaceRemoteArtifacts(base),
    ).rejects.toMatchObject({ code: "PUBLIC_KEY_FINGERPRINT_MISMATCH" });

    await expect(
      fetchPluginMarketplaceRemoteArtifacts({
        registryUrl: base.registryUrl,
        fetchImpl,
        allowCache: false,
        sbom: {
          url: "https://registry.example/sbom",
          digest: "e".repeat(64),
          format: "cyclonedx-json",
        },
      }),
    ).rejects.toMatchObject({ code: "DIGEST_MISMATCH" });
  });

  it("accepts only strict SPKI PUBLIC KEY PEM documents", async () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
    const spkiDer = Buffer.from(
      publicKey.export({ type: "spki", format: "der" }),
    );
    const spkiPem = Buffer.from(
      publicKey.export({ type: "spki", format: "pem" }),
    );
    const fingerprint = sha256(spkiDer);
    const signature = Buffer.alloc(64, 7);
    const base = {
      registryUrl: "https://registry.example/index.json",
      allowCache: false,
      signature: {
        url: "https://registry.example/signature",
        publicKeyUrl: "https://registry.example/key",
        publicKeySha256: fingerprint,
      },
    };
    const withKey = (keyBytes) => ({
      ...base,
      fetchImpl: async (value) =>
        new Response(
          new URL(value).pathname === "/signature" ? signature : keyBytes,
        ),
    });

    const result = await fetchPluginMarketplaceRemoteArtifacts(
      withKey(spkiPem),
    );
    try {
      expect(fs.readFileSync(result.publicKeyFile)).toEqual(spkiPem);
      expect(result.authority.signature.publicKey.documentSha256).toBe(
        sha256(spkiPem),
      );
    } finally {
      result.cleanup();
    }

    const { privateKey: ecPrivateKey } = crypto.generateKeyPairSync("ec", {
      namedCurve: "prime256v1",
    });
    const certificatePem = Buffer.from(tls.rootCertificates[0]);
    const certificateDer = Buffer.from(
      new crypto.X509Certificate(certificatePem).raw,
    );
    const rejected = [
      spkiDer,
      Buffer.from(privateKey.export({ type: "pkcs8", format: "pem" })),
      Buffer.from(privateKey.export({ type: "pkcs8", format: "der" })),
      Buffer.from(ecPrivateKey.export({ type: "sec1", format: "pem" })),
      Buffer.from(ecPrivateKey.export({ type: "sec1", format: "der" })),
      certificatePem,
      certificateDer,
      Buffer.from(`\n${spkiPem}`),
    ];
    for (const keyBytes of rejected) {
      await expect(
        fetchPluginMarketplaceRemoteArtifacts(withKey(keyBytes)),
      ).rejects.toMatchObject({ code: "INVALID_PUBLIC_KEY_CONTAINER" });
    }
  });

  it("does not treat digest-only metadata as a remote artifact request", async () => {
    await expect(
      fetchPluginMarketplaceRemoteArtifacts({
        signature: {
          publicKeySha256: "a".repeat(64),
          sha256: "b".repeat(64),
          status: "declared",
        },
        sbom: { digest: "c".repeat(64), status: "declared" },
      }),
    ).resolves.toBeNull();
  });

  it("retries EBUSY cleanup without marking the signature bundle cleaned", async () => {
    const { publicKey } = crypto.generateKeyPairSync("ed25519");
    const publicKeyPem = Buffer.from(
      publicKey.export({ type: "spki", format: "pem" }),
    );
    const result = await fetchPluginMarketplaceRemoteArtifacts({
      registryUrl: "https://registry.example/index.json",
      allowCache: false,
      fetchImpl: async (value) =>
        new Response(
          new URL(value).pathname === "/signature"
            ? Buffer.alloc(64, 3)
            : publicKeyPem,
        ),
      signature: {
        url: "https://registry.example/signature",
        publicKeyUrl: "https://registry.example/key",
        publicKeySha256: sha256(
          publicKey.export({ type: "spki", format: "der" }),
        ),
      },
    });

    const originalRmSync = fs.rmSync;
    let attempts = 0;
    try {
      fs.rmSync = (...args) => {
        attempts += 1;
        if (attempts === 1) {
          throw Object.assign(new Error("busy"), { code: "EBUSY" });
        }
        return originalRmSync(...args);
      };
      expect(() => result.cleanup()).toThrow(/busy/);
      expect(fs.existsSync(result.signatureFile)).toBe(true);
      expect(() => result.cleanup()).not.toThrow();
      expect(attempts).toBe(2);
      expect(fs.existsSync(result.signatureFile)).toBe(false);
    } finally {
      fs.rmSync = originalRmSync;
      originalRmSync(path.dirname(result.signatureFile), {
        recursive: true,
        force: true,
      });
    }
  });

  it("does not let a non-loopback registry route artifacts to loopback HTTP", async () => {
    await expect(
      fetchPluginMarketplaceRemoteArtifacts({
        registryUrl: "https://registry.example/index.json",
        allowCache: false,
        sbom: {
          url: "http://127.0.0.1:9999/private-sbom",
          digest: "a".repeat(64),
        },
      }),
    ).rejects.toMatchObject({ code: "UNSAFE_URL" });

    await expect(
      fetchPluginMarketplaceRemoteArtifacts({
        registryUrl: "https://registry.example/index.json",
        allowCache: false,
        fetchImpl: async () =>
          new Response(null, {
            status: 302,
            headers: { Location: "http://127.0.0.1:9999/private-sbom" },
          }),
        sbom: {
          url: "https://registry.example/sbom",
          digest: "a".repeat(64),
        },
      }),
    ).rejects.toMatchObject({ code: "UNSAFE_URL" });

    await expect(
      fetchPluginMarketplaceRemoteArtifacts({
        registryUrl: "https://registry.example/index.json",
        allowCache: false,
        fetchImpl: async () =>
          new Response(null, {
            status: 302,
            headers: { Location: "https://127.0.0.1/private-sbom" },
          }),
        sbom: {
          url: "https://registry.example/sbom",
          digest: "a".repeat(64),
        },
      }),
    ).rejects.toMatchObject({ code: "UNSAFE_NETWORK_TARGET" });

    for (const target of [
      "https://127.0.0.1:9999/private-sbom",
      "https://10.2.3.4/private-sbom",
      "https://169.254.169.254/latest/meta-data",
      "https://[::1]/private-sbom",
    ]) {
      await expect(
        fetchPluginMarketplaceRemoteArtifacts({
          registryUrl: "https://registry.example/index.json",
          allowCache: false,
          sbom: { url: target, digest: "a".repeat(64) },
        }),
      ).rejects.toMatchObject({ code: "UNSAFE_NETWORK_TARGET" });
    }
  });

  it("rejects cross-origin artifacts while trusting the configured registry origin", async () => {
    const bytes = Buffer.from("sbom");
    let fetches = 0;
    await expect(
      fetchPluginMarketplaceRemoteArtifacts({
        registryUrl: "https://registry.example/index.json",
        allowCache: false,
        resolveHostname: async () => [{ address: "169.254.169.254" }],
        fetchImpl: async () => {
          fetches += 1;
          return new Response(bytes);
        },
        sbom: {
          url: "https://artifacts.example/sbom",
          digest: sha256(bytes),
        },
      }),
    ).rejects.toMatchObject({ code: "CROSS_ORIGIN_ARTIFACT_REJECTED" });
    expect(fetches).toBe(0);

    const sameOrigin = await fetchPluginMarketplaceRemoteArtifacts({
      registryUrl: "https://10.0.0.4/index.json",
      allowCache: false,
      resolveHostname: async () => {
        throw new Error("same registry origin must not be reclassified");
      },
      fetchImpl: async () => new Response(bytes),
      sbom: {
        url: "https://10.0.0.4/sbom",
        digest: sha256(bytes),
      },
    });
    expect(sameOrigin.sbomBytes).toEqual(bytes);
    sameOrigin.cleanup();
  });
});

describe("marketplace artifact transport boundary", () => {
  it("keeps bearer auth on its registry origin and strips it cross-origin", async () => {
    const body = Buffer.from("detached-signature");
    const targetAuthorization = [];
    const target = await startServer((request, response) => {
      targetAuthorization.push(request.headers.authorization || null);
      send(response, body);
    });
    servers.push(target.server);

    const sourceAuthorization = [];
    const source = await startServer((request, response) => {
      sourceAuthorization.push(request.headers.authorization || null);
      if (request.url === "/same-start") {
        response.writeHead(302, { Location: "/same-target" }).end();
        return;
      }
      if (request.url === "/same-target") return send(response, body);
      if (request.url === "/cross-start") {
        response
          .writeHead(302, { Location: `${target.origin}/cross-target` })
          .end();
        return;
      }
      response.writeHead(404).end();
    });
    servers.push(source.server);

    const common = {
      kind: "signature",
      token: "origin-scoped-token",
      authorizationOrigin: source.origin,
      expectedSha256: sha256(body),
      allowCache: false,
    };
    await fetchMarketplaceRemoteArtifact({
      ...common,
      url: `${source.origin}/same-start`,
    });
    await fetchMarketplaceRemoteArtifact({
      ...common,
      url: `${source.origin}/cross-start`,
    });

    expect(sourceAuthorization).toEqual([
      "Bearer origin-scoped-token",
      "Bearer origin-scoped-token",
      "Bearer origin-scoped-token",
    ]);
    expect(targetAuthorization).toEqual([null]);
  });

  it("allows at most three manually validated redirect hops", async () => {
    const body = Buffer.from("ok");
    const fetchImpl = async (value, options) => {
      expect(options.redirect).toBe("manual");
      const step = Number(new URL(value).pathname.slice(1));
      if (step < 3) {
        return new Response(null, {
          status: 302,
          headers: { Location: `/${step + 1}` },
        });
      }
      return new Response(body);
    };
    const allowed = await fetchMarketplaceRemoteArtifact({
      kind: "signature",
      url: "https://registry.example/0",
      expectedSha256: sha256(body),
      fetchImpl,
      allowCache: false,
    });
    expect(allowed.redirectCount).toBe(3);

    const endlessRedirect = async (value) => {
      const step = Number(new URL(value).pathname.slice(1));
      return new Response(null, {
        status: 302,
        headers: { Location: `/${step + 1}` },
      });
    };
    await expect(
      fetchMarketplaceRemoteArtifact({
        kind: "signature",
        url: "https://registry.example/0",
        fetchImpl: endlessRedirect,
        allowCache: false,
      }),
    ).rejects.toMatchObject({ code: "REDIRECT_LIMIT_EXCEEDED" });
  });

  it("rejects unsafe HTTP on the initial URL and every redirect", async () => {
    expect(() =>
      assertMarketplaceArtifactUrlSafe("http://artifacts.example/signature"),
    ).toThrow(/HTTPS or loopback HTTP/);
    expect(() =>
      assertMarketplaceArtifactUrlSafe("http://127.0.0.1/signature"),
    ).not.toThrow();

    await expect(
      fetchMarketplaceRemoteArtifact({
        kind: "signature",
        url: "https://registry.example/signature",
        allowCache: false,
        fetchImpl: async () =>
          new Response(null, {
            status: 302,
            headers: { Location: "http://artifacts.example/signature" },
          }),
      }),
    ).rejects.toMatchObject({ code: "UNSAFE_URL" });

    await expect(
      fetchPluginMarketplaceRemoteArtifacts({
        registryUrl: "https://registry.example/index.json",
        allowInsecure: true,
        allowCache: false,
        sbom: {
          url: "http://artifacts.example/sbom",
          digest: "a".repeat(64),
        },
      }),
    ).rejects.toMatchObject({ code: "UNSAFE_URL" });

    const bytes = Buffer.from("insecure-registry-sbom");
    const sameRegistry = await fetchPluginMarketplaceRemoteArtifacts({
      registryUrl: "http://registry.example/index.json",
      allowInsecure: true,
      allowCache: false,
      fetchImpl: async () => new Response(bytes),
      sbom: {
        url: "http://registry.example/sbom",
        digest: sha256(bytes),
      },
    });
    expect(sameRegistry.sbomBytes).toEqual(bytes);
    sameRegistry.cleanup();
  });

  it("does not send a token without an explicit authorization origin", async () => {
    const seen = [];
    const bytes = Buffer.from("signature");
    await fetchMarketplaceRemoteArtifact({
      kind: "signature",
      url: "https://artifacts.example/signature",
      token: "do-not-infer-origin",
      allowCache: false,
      fetchImpl: async (_value, options) => {
        seen.push(options.headers.Authorization || null);
        return new Response(bytes);
      },
    });
    expect(seen).toEqual([null]);

    for (const token of [
      "two words",
      "tab\ttoken",
      "line\ntoken",
      "x\u200by",
      "percent%2Ftoken",
      "ampersand&token",
      "雪-token",
    ]) {
      await expect(
        fetchMarketplaceRemoteArtifact({
          kind: "signature",
          url: "https://artifacts.example/signature",
          token,
          allowCache: false,
          fetchImpl: async () => new Response(bytes),
        }),
      ).rejects.toMatchObject({ code: "INVALID_TOKEN" });
    }
  });

  it("cancels redirect and HTTP error bodies without using arrayBuffer fallback", async () => {
    let cancellations = 0;
    const redirectBody = new ReadableStream({
      cancel() {
        cancellations += 1;
      },
    });
    await fetchMarketplaceRemoteArtifact({
      kind: "signature",
      url: "https://registry.example/start",
      allowCache: false,
      fetchImpl: async (value) =>
        new URL(value).pathname === "/start"
          ? new Response(redirectBody, {
              status: 302,
              headers: { Location: "/target" },
            })
          : new Response("ok"),
    });

    const errorBody = new ReadableStream({
      cancel() {
        cancellations += 1;
      },
    });
    await expect(
      fetchMarketplaceRemoteArtifact({
        kind: "signature",
        url: "https://registry.example/error",
        allowCache: false,
        fetchImpl: async () => new Response(errorBody, { status: 404 }),
      }),
    ).rejects.toMatchObject({ code: "HTTP_ERROR" });
    expect(cancellations).toBe(2);

    let arrayBufferCalled = false;
    await expect(
      fetchMarketplaceRemoteArtifact({
        kind: "signature",
        url: "https://registry.example/unreadable",
        allowCache: false,
        fetchImpl: async () => ({
          ok: true,
          status: 200,
          headers: new Headers(),
          body: {},
          async arrayBuffer() {
            arrayBufferCalled = true;
            return new ArrayBuffer(0);
          },
        }),
      }),
    ).rejects.toMatchObject({ code: "UNREADABLE_BODY" });
    expect(arrayBufferCalled).toBe(false);
  });

  it("enforces the persisted artifact URL length boundary", async () => {
    const prefix = "https://registry.example/";
    const maximumUrl =
      prefix + "a".repeat(MAX_MARKETPLACE_ARTIFACT_URL_LENGTH - prefix.length);
    expect(() => assertMarketplaceArtifactUrlSafe(maximumUrl)).not.toThrow();
    expect(() =>
      assertMarketplaceArtifactUrlSafe(`${maximumUrl}a`),
    ).toThrowError(expect.objectContaining({ code: "URL_TOO_LONG" }));
  });

  it("enforces both Content-Length and streamed-body limits", async () => {
    const limit = MARKETPLACE_REMOTE_ARTIFACT_LIMITS.signature;
    await expect(
      fetchMarketplaceRemoteArtifact({
        kind: "signature",
        url: "https://registry.example/signature",
        allowCache: false,
        fetchImpl: async () =>
          new Response(Buffer.from("small"), {
            headers: { "Content-Length": String(limit + 1) },
          }),
      }),
    ).rejects.toMatchObject({ code: "CONTENT_TOO_LARGE" });

    await expect(
      fetchMarketplaceRemoteArtifact({
        kind: "signature",
        url: "https://registry.example/signature",
        allowCache: false,
        fetchImpl: async () => new Response(Buffer.alloc(limit + 1, 1)),
      }),
    ).rejects.toMatchObject({ code: "CONTENT_TOO_LARGE" });
  });

  it("times out boundedly and redacts tokens, userinfo, query, and fragment", async () => {
    await expect(
      fetchMarketplaceRemoteArtifact({
        kind: "signature",
        url: "https://registry.example/signature?secret=hidden#fragment",
        token: "super-secret-token",
        timeoutMs: 10,
        allowCache: false,
        fetchImpl: async (_value, { signal }) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(new Error("abort")));
          }),
      }),
    ).rejects.toMatchObject({ code: "TIMEOUT" });

    let failure;
    try {
      await fetchMarketplaceRemoteArtifact({
        kind: "signature",
        url: "https://registry.example/signature?secret=hidden#fragment",
        token: "super-secret-token",
        allowCache: false,
        fetchImpl: async () => {
          throw new Error(
            "Bearer super-secret-token https://user:password@registry.example/signature?secret=hidden#fragment",
          );
        },
      });
    } catch (error) {
      failure = error;
    }
    expect(failure.code).toBe("FETCH_FAILED");
    expect(failure.message).not.toMatch(
      /super-secret-token|password|secret=hidden|fragment/,
    );
    expect(failure.message).toContain("https://registry.example/signature");
    expect(
      redactMarketplaceArtifactError(
        "Authorization=Bearer abc token=xyz https://u:p@x.test/a?q=s",
        { token: "abc" },
      ),
    ).not.toMatch(/abc|xyz|u:p|q=s/);
  });
});

describe("marketplace artifact immutable cache", () => {
  it("addresses entries by URL hash plus digest and revalidates offline bytes", async () => {
    const cacheDir = makeTempDir("cc-marketplace-artifact-cache-");
    const url = "https://registry.example/signature?version=one";
    const bytes = Buffer.from("cached-signature");
    const digest = sha256(bytes);
    let fetches = 0;
    const online = await fetchMarketplaceRemoteArtifact({
      kind: "signature",
      url,
      expectedSha256: digest,
      cacheDir,
      fetchImpl: async () => {
        fetches += 1;
        return new Response(bytes);
      },
    });
    expect(online.fromCache).toBe(false);
    const cachePath = marketplaceRemoteArtifactCachePath(url, digest, cacheDir);
    expect(fs.existsSync(cachePath)).toBe(true);
    expect(path.basename(path.dirname(cachePath))).toHaveLength(64);
    expect(path.basename(cachePath)).toBe(`${digest}.bin`);

    const offline = await fetchMarketplaceRemoteArtifact({
      kind: "signature",
      url,
      expectedSha256: digest,
      cacheDir,
      offline: true,
      fetchImpl: async () => {
        fetches += 1;
        throw new Error("network must not be used offline");
      },
    });
    expect(offline.fromCache).toBe(true);
    expect(offline.bytes).toEqual(bytes);
    expect(fetches).toBe(1);

    fs.writeFileSync(cachePath, "tampered");
    await expect(
      fetchMarketplaceRemoteArtifact({
        kind: "signature",
        url,
        expectedSha256: digest,
        cacheDir,
        offline: true,
      }),
    ).rejects.toMatchObject({ code: "CACHE_DIGEST_MISMATCH" });
  });

  it("does not use a good cache entry to conceal a live digest mismatch", async () => {
    const cacheDir = makeTempDir("cc-marketplace-artifact-cache-");
    const url = "https://registry.example/sbom";
    const expected = Buffer.from("expected");
    const digest = sha256(expected);
    await fetchMarketplaceRemoteArtifact({
      kind: "sbom",
      url,
      expectedSha256: digest,
      cacheDir,
      fetchImpl: async () => new Response(expected),
    });

    await expect(
      fetchMarketplaceRemoteArtifact({
        kind: "sbom",
        url,
        expectedSha256: digest,
        cacheDir,
        fetchImpl: async () => new Response("attacker replacement"),
      }),
    ).rejects.toMatchObject({ code: "DIGEST_MISMATCH" });
  });

  it("repairs a truncated final entry and publishes concurrent identical bytes", async () => {
    const cacheDir = makeTempDir("cc-marketplace-artifact-cache-");
    const url = "https://registry.example/signature";
    const bytes = Buffer.from("complete-cache-content");
    const digest = sha256(bytes);
    const cachePath = marketplaceRemoteArtifactCachePath(url, digest, cacheDir);
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, bytes.subarray(0, 4));

    const repaired = await fetchMarketplaceRemoteArtifact({
      kind: "signature",
      url,
      expectedSha256: digest,
      cacheDir,
      fetchImpl: async () => new Response(bytes),
    });
    expect(repaired.fromCache).toBe(false);
    expect(fs.readFileSync(cachePath)).toEqual(bytes);
    expect(
      fs
        .readdirSync(path.dirname(cachePath))
        .filter((name) => name.startsWith(".tmp-")),
    ).toEqual([]);

    const [first, second] = await Promise.all([
      fetchMarketplaceRemoteArtifact({
        kind: "signature",
        url,
        expectedSha256: digest,
        cacheDir,
        fetchImpl: async () => new Response(bytes),
      }),
      fetchMarketplaceRemoteArtifact({
        kind: "signature",
        url,
        expectedSha256: digest,
        cacheDir,
        fetchImpl: async () => new Response(bytes),
      }),
    ]);
    expect(first.bytes).toEqual(bytes);
    expect(second.bytes).toEqual(bytes);
    expect(fs.readFileSync(cachePath)).toEqual(bytes);
  });

  it("rejects non-regular, symlinked, and oversized cache entries", async () => {
    const cacheDir = makeTempDir("cc-marketplace-artifact-cache-");
    const url = "https://registry.example/signature";
    const digest = "d".repeat(64);
    const cachePath = marketplaceRemoteArtifactCachePath(url, digest, cacheDir);
    fs.mkdirSync(cachePath, { recursive: true });
    await expect(
      fetchMarketplaceRemoteArtifact({
        kind: "signature",
        url,
        expectedSha256: digest,
        cacheDir,
        offline: true,
      }),
    ).rejects.toMatchObject({ code: "CACHE_INVALID" });
    fs.rmSync(cachePath, { recursive: true, force: true });

    const target = path.join(cacheDir, "symlink-target.bin");
    fs.writeFileSync(target, "target");
    let symlinkCreated = false;
    try {
      fs.symlinkSync(target, cachePath, "file");
      symlinkCreated = true;
    } catch (error) {
      if (error?.code !== "EPERM") throw error;
    }
    if (symlinkCreated) {
      await expect(
        fetchMarketplaceRemoteArtifact({
          kind: "signature",
          url,
          expectedSha256: digest,
          cacheDir,
          offline: true,
        }),
      ).rejects.toMatchObject({ code: "CACHE_INVALID" });
      fs.unlinkSync(cachePath);
    }

    fs.writeFileSync(
      cachePath,
      Buffer.alloc(MARKETPLACE_REMOTE_ARTIFACT_LIMITS.signature + 1),
    );
    await expect(
      fetchMarketplaceRemoteArtifact({
        kind: "signature",
        url,
        expectedSha256: digest,
        cacheDir,
        offline: true,
      }),
    ).rejects.toMatchObject({ code: "CACHE_INVALID" });
  });

  it("falls back only for transport/server failure, never for 4xx", async () => {
    const cacheDir = makeTempDir("cc-marketplace-artifact-cache-");
    const url = "https://registry.example/sbom";
    const expected = Buffer.from("expected");
    const digest = sha256(expected);
    await fetchMarketplaceRemoteArtifact({
      kind: "sbom",
      url,
      expectedSha256: digest,
      cacheDir,
      fetchImpl: async () => new Response(expected),
    });

    await expect(
      fetchMarketplaceRemoteArtifact({
        kind: "sbom",
        url,
        expectedSha256: digest,
        cacheDir,
        fetchImpl: async () => new Response("unauthorized", { status: 401 }),
      }),
    ).rejects.toMatchObject({ code: "HTTP_ERROR" });

    const cached = await fetchMarketplaceRemoteArtifact({
      kind: "sbom",
      url,
      expectedSha256: digest,
      cacheDir,
      fetchImpl: async () => new Response("unavailable", { status: 503 }),
    });
    expect(cached.fromCache).toBe(true);
    expect(cached.bytes).toEqual(expected);
  });
});

async function startServer(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return { server, origin: `http://127.0.0.1:${address.port}` };
}

async function closeServer(server) {
  server.closeAllConnections?.();
  if (!server.listening) return;
  await new Promise((resolve) => server.close(resolve));
}

function send(response, bytes) {
  response.writeHead(200, { "Content-Length": String(bytes.length) });
  response.end(bytes);
}

function makeTempDir(prefix) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(directory);
  return directory;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function evidenceDigest(authority) {
  const { evidenceDigest: _ignored, ...unsigned } = authority;
  return sha256(canonicalJson(unsigned));
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
