import { afterEach, describe, expect, it } from "vitest";
import http from "node:http";
const Database = require("better-sqlite3");
const { AppBuilder } = require("../app-builder.js");
const { registerLowCodeIPC } = require("../low-code-ipc.js");
const { probeRestConnection } = require("../rest-connection-probe.js");

const servers = [];
const databases = [];
async function endpoint(handler) {
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return `http://127.0.0.1:${server.address().port}/health`;
}
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  for (const db of databases.splice(0)) db.close();
});

describe("real REST reachability probe", () => {
  it("performs one HEAD request and reports measured latency without response headers or body", async () => {
    const requests = [];
    const url = await endpoint((request, response) => {
      requests.push({
        method: request.method,
        authorization: request.headers.authorization,
        cookie: request.headers.cookie,
      });
      response.writeHead(204, { "X-Private": "response-secret" });
      response.end();
    });
    const result = await probeRestConnection({ url });
    expect(requests).toEqual([
      { method: "HEAD", authorization: undefined, cookie: undefined },
    ]);
    expect(result).toMatchObject({
      success: true,
      probed: true,
      status: "reachable",
      httpStatus: 204,
      check: "http-reachability",
      method: "HEAD",
    });
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(result)).not.toContain("response-secret");
    expect(result).not.toHaveProperty("deployed");
  });

  it.each([401, 403, 404, 405, 500])(
    "reports HTTP %s without pretending the datasource is connected",
    async (status) => {
      const url = await endpoint((_request, response) => {
        response.writeHead(status);
        response.end("private payload");
      });
      expect(await probeRestConnection({ url })).toMatchObject({
        success: false,
        probed: true,
        httpStatus: status,
        status: "http-error",
        errorCode: "REST_PROBE_HTTP_ERROR",
      });
    },
  );

  it("does not follow redirects or expose Location", async () => {
    let targetRequests = 0;
    const target = await endpoint((_request, response) => {
      targetRequests++;
      response.end();
    });
    const url = await endpoint((_request, response) => {
      response.writeHead(302, { Location: `${target}?token=redirect-secret` });
      response.end();
    });
    const result = await probeRestConnection({ url });
    expect(result).toMatchObject({
      success: false,
      status: "redirect-blocked",
      errorCode: "REST_PROBE_REDIRECT_BLOCKED",
    });
    expect(targetRequests).toBe(0);
    expect(JSON.stringify(result)).not.toContain("redirect-secret");
  });

  it("enforces an overall timeout and performs no automatic retry", async () => {
    let requests = 0;
    const url = await endpoint(() => {
      requests++;
    });
    const result = await probeRestConnection({ url, timeoutMs: 100 });
    expect(result).toMatchObject({
      success: false,
      probed: true,
      status: "timeout",
      errorCode: "REST_PROBE_TIMEOUT",
    });
    expect(requests).toBe(1);
  });

  it.each([
    {},
    { url: "file:///private/data" },
    { url: "ftp://example.test" },
    { url: "http://user:secret@example.test" },
    { url: "http://example.test/#secret" },
    { url: "http://example.test", timeoutMs: -1 },
    { url: "http://example.test", timeoutMs: 15001 },
    { url: "http://example.test", timeoutMs: "100" },
  ])("rejects invalid configuration before probing: %j", async (config) => {
    const result = await probeRestConnection(config);
    expect(result).toMatchObject({
      success: false,
      probed: false,
      errorCode: "REST_PROBE_INVALID_CONFIG",
    });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it.each([
    { method: "POST" },
    { headers: { Authorization: "Bearer private-token" } },
    { auth: "secret" },
  ])(
    "keeps unsupported authentication and unsafe methods disabled",
    async (extra) => {
      let requests = 0;
      const url = await endpoint((_request, response) => {
        requests++;
        response.end();
      });
      const result = await probeRestConnection({ url, ...extra });
      expect(result).toMatchObject({
        success: false,
        probed: false,
        status: "unsupported",
        errorCode: "REST_PROBE_AUTH_OR_METHOD_UNSUPPORTED",
      });
      expect(requests).toBe(0);
      expect(JSON.stringify(result)).not.toMatch(/private-token|secret/);
    },
  );

  it("returns a fixed network error for a closed endpoint", async () => {
    const url = await endpoint((_request, response) => response.end());
    const server = servers.pop();
    await new Promise((resolve) => server.close(resolve));
    const result = await probeRestConnection({ url, timeoutMs: 1000 });
    expect(result).toMatchObject({
      success: false,
      probed: true,
      status: "network-error",
      errorCode: "REST_PROBE_NETWORK_ERROR",
    });
    expect(JSON.stringify(result)).not.toContain(url);
  });

  it("awaits the actual IPC result and re-probes saved SQLite configuration after restart", async () => {
    const url = await endpoint((_request, response) => {
      response.writeHead(200);
      response.end();
    });
    const db = new Database(":memory:");
    databases.push(db);
    const builder = new AppBuilder();
    await builder.initialize(db);
    const app = builder.createApp({ name: "REST probe" });
    const ds = builder.addDataSource(app.id, "Health", "rest", { url });
    const restarted = new AppBuilder();
    await restarted.initialize(db);
    const handlers = {};
    registerLowCodeIPC({
      appBuilder: restarted,
      ipcMain: {
        removeHandler() {},
        handle(channel, handler) {
          handlers[channel] = handler;
        },
      },
    });
    const result = await handlers["lowcode:test-connection"]({}, ds.id);
    expect(result).toMatchObject({
      success: true,
      data: { success: true, status: "reachable", probed: true, type: "rest" },
    });
    expect(() => structuredClone(result)).not.toThrow();
    expect(restarted.exportApp(app.id).dataSources[0].status).toBe(
      "configured",
    );
    expect(restarted.publish(app.id)).toMatchObject({
      deployed: false,
      runtimeStatus: "unsupported",
    });
  });
});
