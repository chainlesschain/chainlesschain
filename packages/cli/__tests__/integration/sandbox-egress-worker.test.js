import { afterEach, describe, expect, it } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import net from "node:net";
import { startEgressProxyWorker } from "../../src/lib/sandbox-egress-worker.js";

let proxy;
let upstream;
let tunnel;

afterEach(async () => {
  tunnel?.destroy();
  if (proxy) await proxy.close();
  if (upstream) {
    upstream.kill();
    await new Promise((resolve) => {
      if (upstream.exitCode !== null || upstream.signalCode !== null) resolve();
      else upstream.once("exit", resolve);
    });
  }
  proxy = null;
  upstream = null;
  tunnel = null;
});

function startUpstream() {
  const script =
    'const http=require("node:http");const s=http.createServer((q,r)=>r.end("allowed"));' +
    's.listen(0,"127.0.0.1",()=>console.log(s.address().port));';
  upstream = spawn(process.execPath, ["-e", script], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  return new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error("upstream timeout")), 5000);
    upstream.stdout.on("data", (chunk) => {
      output += chunk;
      const port = Number(output.trim());
      if (Number.isSafeInteger(port) && port > 0) {
        clearTimeout(timer);
        resolve(port);
      }
    });
    upstream.once("error", reject);
    upstream.once("exit", () => reject(new Error("upstream exited")));
  });
}

function syncProxyGet(port, target) {
  const script =
    'const http=require("node:http");const req=http.get({host:"127.0.0.1",port:Number(process.argv[1]),path:process.argv[2]},r=>{' +
    'let body="";r.on("data",c=>body+=c);r.on("end",()=>console.log(`${r.statusCode}:${body.trim()}`));});' +
    'req.setTimeout(5000,()=>req.destroy(new Error("timeout")));req.on("error",e=>{console.error(e.message);process.exitCode=1});';
  return spawnSync(process.execPath, ["-e", script, String(port), target], {
    encoding: "utf8",
    timeout: 10_000,
  });
}

describe("egress proxy worker", () => {
  it("serves allow and deny decisions while the caller is blocked in spawnSync", async () => {
    const upPort = await startUpstream();
    const failures = [];
    proxy = await startEgressProxyWorker(
      { allowedDomains: ["127.0.0.1"] },
      { onFailure: (error) => failures.push(error.code) },
    );
    const target = `http://127.0.0.1:${upPort}/`;
    const allowed = syncProxyGet(proxy.port, target);
    expect(allowed.status, allowed.stderr).toBe(0);
    expect(allowed.stdout.trim()).toBe("200:allowed");

    expect(
      await proxy.updatePolicy({ allowedDomains: ["elsewhere.test"] }, 0),
    ).toBe(1);
    await expect(
      proxy.updatePolicy({ allowedDomains: ["127.0.0.1"] }, 0),
    ).rejects.toMatchObject({ code: "ERR_EGRESS_POLICY_REVISION" });
    const denied = syncProxyGet(proxy.port, target);
    expect(denied.status, denied.stderr).toBe(0);
    expect(denied.stdout.trim()).toMatch(/^403:/);

    await proxy.abort();
    expect(failures).toEqual(["ERR_EGRESS_WORKER_ABORTED"]);
    await expect(
      proxy.updatePolicy({ allowedDomains: ["127.0.0.1"] }, 1),
    ).rejects.toMatchObject({ code: "ERR_EGRESS_WORKER_ABORTED" });
    const afterAbort = syncProxyGet(proxy.port, target);
    expect(afterAbort.status).not.toBe(0);
  });

  it("revokes an active CONNECT tunnel across the worker boundary", async () => {
    let upstreamSocket;
    let notifyUpstreamClosed;
    const upstreamClosed = new Promise((resolve) => {
      notifyUpstreamClosed = resolve;
    });
    const server = net.createServer((socket) => {
      upstreamSocket = socket;
      socket.once("close", notifyUpstreamClosed);
      socket.write("first");
    });
    const upPort = await new Promise((resolve) =>
      server.listen(0, "127.0.0.1", () => resolve(server.address().port)),
    );
    try {
      proxy = await startEgressProxyWorker({
        allowedDomains: ["127.0.0.1"],
      });
      tunnel = net.connect(proxy.port, "127.0.0.1");
      tunnel.on("error", () => {});
      const first = new Promise((resolve) => {
        let received = "";
        tunnel.on("data", (chunk) => {
          received += chunk;
          if (received.includes("first")) resolve(received);
        });
      });
      tunnel.once("connect", () =>
        tunnel.write(
          `CONNECT 127.0.0.1:${upPort} HTTP/1.1\r\nHost: 127.0.0.1:${upPort}\r\n\r\n`,
        ),
      );
      expect(await first).toContain("200 Connection Established");
      const closed = new Promise((resolve) => tunnel.once("close", resolve));
      await proxy.updatePolicy({ allowedDomains: ["elsewhere.test"] }, 0);
      await Promise.all([closed, upstreamClosed]);
      expect(upstreamSocket.destroyed).toBe(true);
    } finally {
      upstreamSocket?.destroy();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("shares one shutdown barrier across concurrent close calls", async () => {
    proxy = await startEgressProxyWorker({ allowedDomains: ["127.0.0.1"] });
    const closing = proxy.close();
    expect(proxy.close()).toBe(closing);
    await closing;
    expect(syncProxyGet(proxy.port, "http://127.0.0.1:1/").status).not.toBe(0);
  });
});
