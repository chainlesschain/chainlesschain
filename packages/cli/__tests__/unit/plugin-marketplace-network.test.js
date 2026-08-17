import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import tls from "node:tls";
import {
  createMarketplaceNetworkTransport,
  normalizeProxyUrl,
  parsePacResult,
  readMarketplaceCaBundle,
  readMarketplacePacFile,
  resolveMarketplacePac,
} from "../../src/lib/plugin-runtime/marketplace-network.js";
import {
  fetchRegistry,
  registryCachePath,
} from "../../src/lib/plugin-runtime/remote-source.js";

const OPENSSL_AVAILABLE = (() => {
  try {
    execFileSync("openssl", ["version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

let root;
const servers = [];

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-market-network-"));
});

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections?.();
    if (server.listening) {
      await new Promise((resolve) => server.close(resolve));
    }
  }
  fs.rmSync(root, { recursive: true, force: true });
});

async function listen(server) {
  servers.push(server);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server.address().port;
}

function sendRegistry(response) {
  const body = JSON.stringify({
    plugins: [{ name: "network-plugin", source: "owner/network-plugin" }],
  });
  response.writeHead(200, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  response.end(body);
}

describe("Marketplace registry network transport", () => {
  it("normalizes proxy credentials without retaining them in authority", async () => {
    const normalized = normalizeProxyUrl(
      "http://proxy-user:proxy-pass@proxy.example:8080",
    );
    expect(normalized).toEqual({
      url: "http://proxy.example:8080",
      origin: "http://proxy.example:8080",
      authorization: `Basic ${Buffer.from("proxy-user:proxy-pass").toString("base64")}`,
    });
    expect(() => normalizeProxyUrl("socks://proxy.example:1080")).toThrow(
      /HTTP or HTTPS/,
    );
    expect(() => normalizeProxyUrl("https://proxy.example/path")).toThrow(
      /only an origin/,
    );

    const transport = createMarketplaceNetworkTransport({
      proxyUrl: "http://proxy-user:proxy-pass@proxy.example:8080",
    });
    expect(transport.authority).toEqual({
      mode: "explicit-proxy",
      proxyOrigin: "http://proxy.example:8080",
    });
    await transport.close();
  });

  it("accepts a bounded CA bundle and rejects hard-linked authority files", async () => {
    const caFile = path.join(root, "enterprise-ca.pem");
    fs.writeFileSync(caFile, tls.rootCertificates[0], "utf8");
    const expectedSha256 = crypto
      .createHash("sha256")
      .update(fs.readFileSync(caFile))
      .digest("hex");
    expect(readMarketplaceCaBundle(caFile)).toMatchObject({
      sha256: expectedSha256,
    });
    const transport = createMarketplaceNetworkTransport({ caFile });
    expect(transport.authority).toEqual({
      mode: "direct-custom-ca",
      customCaSha256: expectedSha256,
    });
    await transport.close();

    fs.linkSync(caFile, path.join(root, "enterprise-ca-hardlink.pem"));
    expect(() => readMarketplaceCaBundle(caFile)).toThrow(/single-link/);
  });

  it("resolves a bounded PAC in a terminable worker", async () => {
    const script =
      'function FindProxyForURL(url, host) { return shExpMatch(host, "*.internal") ? "PROXY proxy.internal:8080" : "DIRECT"; }';
    const pacFile = path.join(root, "enterprise.pac");
    fs.writeFileSync(pacFile, script, "utf8");
    const pac = readMarketplacePacFile(pacFile);
    expect(pac.sha256).toBe(
      crypto.createHash("sha256").update(script).digest("hex"),
    );
    expect(
      await resolveMarketplacePac(pac.script, "https://service.internal/x"),
    ).toBe("PROXY proxy.internal:8080");
    expect(parsePacResult("SOCKS ignored:1080; DIRECT")).toBeNull();
    expect(parsePacResult("HTTPS proxy.internal:8443")).toMatchObject({
      origin: "https://proxy.internal:8443",
    });

    await expect(
      resolveMarketplacePac(
        "function FindProxyForURL() { while (true) {} }",
        "https://service.internal/x",
        { timeoutMs: 100 },
      ),
    ).rejects.toThrow(/exceeded 100 ms/);
  });

  it("routes a real registry request through a proxy and fails corrupted outage fallback closed", async () => {
    const target = http.createServer((_request, response) =>
      sendRegistry(response),
    );
    const targetPort = await listen(target);
    let proxyConnections = 0;
    const proxy = http.createServer((request, response) => {
      proxyConnections += 1;
      const targetUrl = new URL(request.url);
      const upstream = http.request(
        {
          hostname: targetUrl.hostname,
          port: targetUrl.port,
          path: `${targetUrl.pathname}${targetUrl.search}`,
          method: request.method,
          headers: request.headers,
        },
        (upstreamResponse) => {
          response.writeHead(
            upstreamResponse.statusCode,
            upstreamResponse.headers,
          );
          upstreamResponse.pipe(response);
        },
      );
      request.pipe(upstream);
    });
    proxy.on("connect", (request, clientSocket, head) => {
      proxyConnections += 1;
      const separator = request.url.lastIndexOf(":");
      const hostname = request.url.slice(0, separator);
      const port = Number(request.url.slice(separator + 1));
      const upstream = net.connect(port, hostname, () => {
        clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length) upstream.write(head);
        upstream.pipe(clientSocket);
        clientSocket.pipe(upstream);
      });
    });
    const proxyPort = await listen(proxy);

    const result = await fetchRegistry(
      `http://127.0.0.1:${targetPort}/registry.json`,
      {
        proxyUrl: `http://127.0.0.1:${proxyPort}`,
        allowCache: false,
      },
    );
    expect(result.registry.plugins[0].name).toBe("network-plugin");
    expect(result.networkAuthority).toEqual({
      mode: "explicit-proxy",
      proxyOrigin: `http://127.0.0.1:${proxyPort}`,
    });
    expect(proxyConnections).toBeGreaterThan(0);

    const explicitConnections = proxyConnections;
    const pacFile = path.join(root, "route.pac");
    fs.writeFileSync(
      pacFile,
      `function FindProxyForURL() { return "PROXY 127.0.0.1:${proxyPort}"; }`,
      "utf8",
    );
    const pacResult = await fetchRegistry(
      `http://127.0.0.1:${targetPort}/registry.json`,
      { pacFile, allowCache: false },
    );
    expect(pacResult.registry.plugins[0].name).toBe("network-plugin");
    expect(pacResult.networkAuthority).toEqual({
      mode: "pac",
      pacSha256: crypto
        .createHash("sha256")
        .update(fs.readFileSync(pacFile))
        .digest("hex"),
    });
    expect(proxyConnections).toBeGreaterThan(explicitConnections);

    const registryUrl = `http://127.0.0.1:${targetPort}/registry.json`;
    const seeded = await fetchRegistry(registryUrl, {
      proxyUrl: `http://127.0.0.1:${proxyPort}`,
      cacheDir: root,
    });
    proxy.closeAllConnections?.();
    await new Promise((resolve) => proxy.close(resolve));

    await expect(
      fetchRegistry(registryUrl, {
        proxyUrl: `http://127.0.0.1:${proxyPort}`,
        cacheDir: root,
        expectedSha256: seeded.documentSha256,
        timeoutMs: 500,
      }),
    ).resolves.toMatchObject({
      fromCache: true,
      documentSha256: seeded.documentSha256,
    });

    fs.writeFileSync(
      registryCachePath(registryUrl, root, seeded.documentSha256),
      "{}",
      "utf8",
    );
    await expect(
      fetchRegistry(registryUrl, {
        proxyUrl: `http://127.0.0.1:${proxyPort}`,
        cacheDir: root,
        expectedSha256: seeded.documentSha256,
        timeoutMs: 500,
      }),
    ).rejects.toThrow(/verified immutable cache rejected.*digest mismatch/);
  });

  it.skipIf(!OPENSSL_AVAILABLE)(
    "uses a custom CA for a real authenticated HTTPS registry",
    async () => {
      const keyFile = path.join(root, "registry.key");
      const caFile = path.join(root, "registry.crt");
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
        { stdio: "ignore" },
      );
      let observedAuthorization = null;
      const registry = https.createServer(
        {
          key: fs.readFileSync(keyFile),
          cert: fs.readFileSync(caFile),
        },
        (request, response) => {
          observedAuthorization = request.headers.authorization;
          if (observedAuthorization !== "Bearer private-token") {
            response.writeHead(401);
            response.end();
            return;
          }
          sendRegistry(response);
        },
      );
      const port = await listen(registry);
      const url = `https://127.0.0.1:${port}/registry.json`;

      await expect(
        fetchRegistry(url, { token: "private-token", allowCache: false }),
      ).rejects.toThrow();
      const result = await fetchRegistry(url, {
        token: "private-token",
        caFile,
        allowCache: false,
      });
      expect(result.registry.plugins[0].name).toBe("network-plugin");
      expect(observedAuthorization).toBe("Bearer private-token");
      expect(result.networkAuthority).toMatchObject({
        mode: "direct-custom-ca",
        customCaSha256: crypto
          .createHash("sha256")
          .update(fs.readFileSync(caFile))
          .digest("hex"),
      });
    },
  );
});
