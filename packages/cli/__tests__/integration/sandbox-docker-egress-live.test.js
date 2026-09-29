/** Real Linux Docker cell; missing primitives/images are failures when enabled.
 * This is initial enforcement evidence, not the complete NET-01 matrix.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import net from "node:net";
import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import executionBroker from "../../src/lib/process-execution-broker/index.js";
import { startEgressProxyWorker } from "../../src/lib/sandbox-egress-worker.js";
import { startDockerEgressSession } from "../../src/lib/sandbox-docker-egress.js";
import { normalizeAgentSandbox } from "../../src/lib/agent-sandbox.js";
import { executeTool } from "../../src/runtime/agent-core.js";

const LIVE = process.env.CC_DOCKER_EGRESS_LIVE === "1";
const listen = (server, ...args) =>
  new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(...args, () => resolve(server.address()));
  });

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitForFile(file) {
  const deadline = Date.now() + 45_000;
  while (!fs.existsSync(file)) {
    if (Date.now() > deadline)
      throw new Error(`Target never reached readiness: ${file}`);
    await delay(25);
  }
}
function docker(args) {
  return new Promise((resolve, reject) =>
    executionBroker.execFile(
      "docker",
      args,
      {
        origin: "test:docker-egress-live",
        policy: "allow",
        requirePersistentAudit: true,
        encoding: "utf8",
        timeout: 30_000,
      },
      (error, stdout) =>
        error ? reject(error) : resolve(String(stdout).trim()),
    ),
  );
}
async function liveFixture(policy) {
  expect(process.platform).toBe("linux");
  const image = process.env.CC_DOCKER_EGRESS_IMAGE;
  expect(image).toMatch(/@sha256:[a-f0-9]{64}$/);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-egress-matrix-"));
  const workspace = path.join(root, "workspace");
  fs.mkdirSync(workspace);
  let proxy;
  let session;
  const servers = [];
  const sockets = new Set();
  return {
    workspace,
    track(server) {
      servers.push(server);
      server.on("connection", (socket) => {
        sockets.add(socket);
        socket.on("error", () => {});
        socket.once("close", () => sockets.delete(socket));
      });
      return server;
    },
    async start() {
      proxy = await startEgressProxyWorker(policy, {
        socketPath: path.join(root, "broker.sock"),
      });
      session = await startDockerEgressSession({
        workspaceRoot: workspace,
        brokerSocketPath: proxy.socketPath,
        relayImage: image,
      });
      return { proxy, session };
    },
    async close() {
      const closed = await Promise.allSettled([
        session?.close(),
        proxy?.close(),
      ]);
      for (const socket of sockets) socket.destroy();
      await Promise.all(
        servers.map(
          (server) => new Promise((resolve) => server.close(resolve)),
        ),
      );
      fs.rmSync(root, { recursive: true, force: true });
      const failure = closed.find((entry) => entry.status === "rejected");
      if (failure) throw failure.reason;
    },
  };
}

// Pure Node target helpers: no tools or npm modules are assumed in the image.
const CLIENT_HELPERS = `const net=require('node:net'),http=require('node:http');
const direct=(host,port)=>new Promise(resolve=>{const s=net.connect({host,port});s.setTimeout(3000,()=>{s.destroy();resolve('TIMEOUT')});s.on('connect',()=>{s.destroy();resolve('CONNECTED')});s.on('error',e=>resolve(e.code))});
const request=target=>new Promise((resolve,reject)=>{const q=http.get({host:'127.0.0.1',port:3128,path:target},r=>{let body='';r.on('data',c=>body+=c);r.on('end',()=>resolve({status:r.statusCode,body,location:r.headers.location}))});q.setTimeout(5000,()=>q.destroy(new Error('timeout')));q.on('error',reject)});
const connect=(authority,payload,nonce)=>new Promise((resolve,reject)=>{const s=net.connect(3128,'127.0.0.1');let received='',sent=false;const timer=setTimeout(()=>{s.destroy();reject(new Error('CONNECT timeout'))},7000);s.on('error',e=>{clearTimeout(timer);reject(e)});s.on('connect',()=>s.write('CONNECT '+authority+' HTTP/1.1\\r\\nHost: '+authority+'\\r\\n\\r\\n'));s.on('data',c=>{received+=c.toString();if(!sent&&received.includes('\\r\\n\\r\\n')){sent=true;if(payload)s.write(payload)}if(received.includes(nonce)){clearTimeout(timer);s.destroy();resolve(received)}})});
`;

describe.runIf(LIVE)("Linux Docker egress real boundary", () => {
  it("enforces the domain policy through the run_shell product path", async () => {
    const image = process.env.CC_DOCKER_EGRESS_IMAGE;
    expect(image).toMatch(/@sha256:[a-f0-9]{64}$/);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-egress-tool-"));
    const upstream = http.createServer((_req, response) =>
      response.end("product-path-nonce"),
    );
    try {
      const { port } = await listen(upstream, 0, "127.0.0.1");
      const script = `const http=require('node:http'),net=require('node:net');
const viaProxy=url=>new Promise((resolve,reject)=>{const request=http.get({host:'127.0.0.1',port:3128,path:url},response=>{let body='';response.on('data',chunk=>body+=chunk);response.on('end',()=>resolve({status:response.statusCode,body}))});request.on('error',reject)});
const direct=()=>new Promise(resolve=>{const socket=net.connect(${port},'127.0.0.1');socket.setTimeout(3000,()=>{socket.destroy();resolve('TIMEOUT')});socket.on('connect',()=>{socket.destroy();resolve('CONNECTED')});socket.on('error',error=>resolve(error.code))});
(async()=>console.log(JSON.stringify({allowed:await viaProxy('http://127.0.0.1:${port}/'),denied:await viaProxy('http://blocked.invalid/'),direct:await direct()})))().catch(error=>{console.error(error);process.exitCode=1});`;
      fs.writeFileSync(path.join(root, "probe.cjs"), script);
      const sandbox = normalizeAgentSandbox(true, {
        cwd: root,
        network: true,
        settings: {
          engine: "docker-egress",
          image,
          relayImage: image,
          network: { allowedDomains: ["127.0.0.1"] },
        },
      });
      const result = await executeTool(
        "run_shell",
        { command: "node /workspace/probe.cjs" },
        {
          cwd: root,
          sandbox,
          approvalGate: {
            decide: async () => ({
              decision: "allow",
              via: "policy",
              policy: "autopilot",
            }),
          },
        },
      );
      expect(result.exitCode, result.error).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        allowed: { status: 200, body: "product-path-nonce" },
        denied: { status: 403 },
      });
      expect(JSON.parse(result.stdout).direct).not.toBe("CONNECTED");
      expect(result.sandboxCapabilities).toMatchObject({
        status: "applied",
        execution: { started: true },
      });
      expect(result.sandboxCapabilities.applied).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "network.domain-policy" }),
        ]),
      );
    } finally {
      await new Promise((resolve) => upstream.close(resolve));
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 180_000);

  it("allows proxy traffic but rejects direct host traffic and workspace Unix sockets", async () => {
    expect(process.platform).toBe("linux");
    const image = process.env.CC_DOCKER_EGRESS_IMAGE;
    expect(image).toMatch(/@sha256:[a-f0-9]{64}$/);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-docker-live-"));
    const workspace = path.join(root, "workspace");
    fs.mkdirSync(workspace);
    let httpRequests = 0;
    let unixConnections = 0;
    const upstream = http.createServer((_req, res) => {
      httpRequests += 1;
      res.end("host-nonce");
    });
    const sentinel = net.createServer((socket) => {
      unixConnections += 1;
      socket.end("unix-nonce");
    });
    let proxy;
    let session;
    let cleanup;
    try {
      const { port } = await listen(upstream, 0, "127.0.0.1");
      const sentinelPath = path.join(workspace, "host.sock");
      await listen(sentinel, sentinelPath);
      // Prove both forbidden endpoints work before attributing failure to isolation.
      const control = await fetch(`http://127.0.0.1:${port}/`);
      expect(await control.text()).toBe("host-nonce");
      expect(
        await new Promise((resolve, reject) => {
          const socket = net.connect(sentinelPath);
          socket.on("error", reject);
          socket.on("data", (data) => resolve(String(data)));
        }),
      ).toBe("unix-nonce");
      const initialUnixConnections = unixConnections;
      proxy = await startEgressProxyWorker(
        { allowedDomains: ["127.0.0.1"] },
        {
          socketPath: path.join(root, "broker.sock"),
        },
      );
      const script = `const http=require('node:http'),net=require('node:net'),dgram=require('node:dgram');
const request=(target)=>new Promise((resolve,reject)=>{const q=http.get({host:'127.0.0.1',port:3128,path:target},r=>{let body='';r.on('data',c=>body+=c);r.on('end',()=>resolve({status:r.statusCode,body}))});q.on('error',reject);q.setTimeout(5000,()=>q.destroy(new Error('timeout')))});
const direct=(opts)=>new Promise(resolve=>{const s=net.connect(opts);s.on('connect',()=>{s.destroy();resolve('CONNECTED')});s.on('error',e=>resolve(e.code));s.setTimeout(3000,()=>{s.destroy();resolve('TIMEOUT')})});
(async()=>{const allowed=await request('http://127.0.0.1:${port}/');const denied=await request('http://blocked.invalid/');
for(const key of Object.keys(process.env))if(/proxy/i.test(key))delete process.env[key];
const tcp=await direct({host:'127.0.0.1',port:${port}});const unix=await direct({path:'/workspace/host.sock'});
const udp=await new Promise(resolve=>{const s=dgram.createSocket('udp4');s.on('error',e=>{s.close();resolve(e.code)});s.send('escape',${port},'127.0.0.1',e=>{if(e){try{s.close()}catch{}resolve(e.code)}else{s.close();resolve('SENT')}})});
console.log(JSON.stringify({allowed,denied:denied.status,tcp,unix,udp}));})().catch(e=>{console.error(e);process.exitCode=1});`;
      fs.writeFileSync(path.join(workspace, "probe.cjs"), script);
      session = await startDockerEgressSession({
        workspaceRoot: workspace,
        brokerSocketPath: proxy.socketPath,
        relayImage: image,
      });
      const result = await session.run("node /workspace/probe.cjs");
      expect(result.exitCode, result.stdout).toBe(0);
      const report = JSON.parse(result.stdout);
      expect(report.allowed).toEqual({ status: 200, body: "host-nonce" });
      expect(report.denied).toBe(403);
      expect(report.tcp).not.toBe("CONNECTED");
      expect(["EPERM", "EACCES"]).toContain(report.unix);
      expect(["EPERM", "EACCES"]).toContain(report.udp);
      expect(unixConnections).toBe(initialUnixConnections);
      expect(httpRequests).toBe(2); // Host control plus the approved proxy request.
    } finally {
      cleanup = await Promise.allSettled([session?.close(), proxy?.close()]);
      await Promise.all(
        [upstream, sentinel].map(
          (server) => new Promise((resolve) => server.close(resolve)),
        ),
      );
      fs.rmSync(root, { recursive: true, force: true });
    }
    const failed = cleanup.find((entry) => entry.status === "rejected");
    if (failed) throw failed.reason;
  }, 180_000);
});

describe.runIf(LIVE)("Docker egress extended real traffic", () => {
  it("checks IPv6, redirect authorities, WebSocket CONNECT and descendant processes", async () => {
    const f = await liveFixture({ allowedDomains: ["127.0.0.1", "::1"] });
    let ipv6Connections = 0;
    let wsUpgrades = 0;
    let deniedPathRequests = 0;
    let allowedRequests = 0;
    const ipv6 = f.track(
      net.createServer((socket) => {
        ipv6Connections += 1;
        socket.end("ipv6-nonce");
      }),
    );
    const upstream = f.track(
      http.createServer((req, res) => {
        if (req.url === "/redirect") {
          res.writeHead(302, {
            location: `http://localhost:${upstream.address().port}/denied`,
          });
          res.end();
        } else if (req.url === "/denied") {
          deniedPathRequests += 1;
          res.end("denied-host-control");
        } else {
          allowedRequests += 1;
          res.end("allowed-nonce");
        }
      }),
    );
    upstream.on("upgrade", (req, socket) => {
      wsUpgrades += 1;
      const accept = crypto
        .createHash("sha1")
        .update(
          req.headers["sec-websocket-key"] +
            "258EAFA5-E914-47DA-95CA-C5AB0DC85B11",
        )
        .digest("base64");
      const payload = Buffer.from("websocket-nonce");
      socket.write(
        `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
      );
      socket.write(
        Buffer.concat([Buffer.from([0x81, payload.length]), payload]),
      );
    });
    try {
      // IPv6 is required in this live cell: unsupported hosts fail, not pass.
      const { port: ipv6Port } = await listen(ipv6, {
        host: "::1",
        port: 0,
        ipv6Only: true,
      });
      const { port } = await listen(upstream, 0, "127.0.0.1");
      expect(
        await new Promise((resolve, reject) => {
          const socket = net.connect(ipv6Port, "::1");
          socket.on("error", reject);
          socket.on("data", (bytes) => {
            socket.destroy();
            resolve(String(bytes));
          });
        }),
      ).toBe("ipv6-nonce");
      // Same HTTP listener is reachable by the forbidden authority outside the enclosure.
      const control = await new Promise((resolve, reject) => {
        http
          .get(
            { hostname: "localhost", family: 4, port, path: "/denied" },
            (response) => {
              let body = "";
              response.on("data", (chunk) => (body += chunk));
              response.on("end", () => resolve(body));
            },
          )
          .on("error", reject);
      });
      expect(control).toBe("denied-host-control");
      const wsRequest = `GET /ws HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n`;
      const wsControl = await new Promise((resolve, reject) => {
        const socket = net.connect(port, "127.0.0.1");
        let data = "";
        socket.on("error", reject);
        socket.on("connect", () => socket.write(wsRequest));
        socket.on("data", (chunk) => {
          data += chunk;
          if (data.includes("websocket-nonce")) {
            socket.destroy();
            resolve(data);
          }
        });
      });
      expect(wsControl).toContain("101 Switching Protocols");
      const script =
        CLIENT_HELPERS +
        `
(async()=>{const v6=await connect('[::1]:${ipv6Port}',null,'ipv6-nonce');
const ws=await connect('127.0.0.1:${port}',${JSON.stringify(wsRequest)},'websocket-nonce');
const wsDenied=await connect('localhost:${port}',null,'403 Forbidden');
const redirect=await request('http://127.0.0.1:${port}/redirect');const followed=await request(redirect.location);
for(const key of Object.keys(process.env))if(/proxy/i.test(key))delete process.env[key];
const direct6=await direct('::1',${ipv6Port});
console.log(JSON.stringify({kind:'parent',v6,ws,wsDenied,redirect:redirect.status,followed:followed.status,direct6,pid:process.pid}));
})().catch(e=>{console.error(e);process.exitCode=1});`;
      const child =
        CLIENT_HELPERS +
        `
(async()=>{for(const key of Object.keys(process.env))if(/proxy/i.test(key))delete process.env[key];
const allowed=await request('http://127.0.0.1:${port}/');const direct4=await direct('127.0.0.1',${port});const direct6=await direct('::1',${ipv6Port});
console.log(JSON.stringify({kind:'child',allowed:allowed.body,direct4,direct6,pid:process.pid,ppid:process.ppid}));})().catch(e=>{console.error(e);process.exitCode=1});`;
      fs.writeFileSync(path.join(f.workspace, "matrix.cjs"), script);
      fs.writeFileSync(path.join(f.workspace, "child.cjs"), child);
      const { session } = await f.start();
      // An actual shell descendant execs Node with the same kernel restrictions.
      const result = await session.run(
        "node /workspace/matrix.cjs && sh -c 'node /workspace/child.cjs'",
      );
      expect(result.exitCode, result.stderr).toBe(0);
      const [parent, descendant] = result.stdout
        .trim()
        .split(/\r?\n/)
        .map(JSON.parse);
      expect(parent.v6).toContain("200 Connection Established");
      expect(parent.ws).toContain("101 Switching Protocols");
      expect(parent.ws).toContain("websocket-nonce");
      expect(parent.wsDenied).toContain("403 Forbidden");
      expect(parent.redirect).toBe(302);
      expect(parent.followed).toBe(403);
      expect(parent.direct6).not.toBe("CONNECTED");
      expect(descendant).toMatchObject({
        kind: "child",
        allowed: "allowed-nonce",
      });
      expect(descendant.pid).not.toBe(parent.pid);
      expect(descendant.direct4).not.toBe("CONNECTED");
      expect(descendant.direct6).not.toBe("CONNECTED");
      expect(ipv6Connections).toBe(2); // Host control + approved CONNECT only.
      expect(wsUpgrades).toBe(2); // Host control + approved CONNECT only.
      expect(deniedPathRequests).toBe(1); // Only the host positive control.
      expect(allowedRequests).toBe(1);
    } finally {
      await f.close();
    }
  }, 180_000);

  it.each(["broker", "relay"])(
    "closes existing tunnels after %s failure and removes owned containers",
    async (failure) => {
      const f = await liveFixture({ allowedDomains: ["127.0.0.1"] });
      let connections = 0;
      const upstream = f.track(
        net.createServer((socket) => {
          connections += 1;
          socket.write("crash-nonce");
          socket.on("error", () => {});
        }),
      );
      let running;
      try {
        const { port } = await listen(upstream, 0, "127.0.0.1");
        expect(
          await new Promise((resolve, reject) => {
            const socket = net.connect(port, "127.0.0.1");
            socket.on("error", reject);
            socket.on("data", (bytes) => {
              socket.destroy();
              resolve(String(bytes));
            });
          }),
        ).toBe("crash-nonce");
        const script =
          CLIENT_HELPERS +
          `const fs=require('node:fs');
const s=net.connect(3128,'127.0.0.1');let bytes='',ready=false;let done=false;
const deadline=setTimeout(()=>{console.error('tunnel not revoked');process.exit(5)},30000);
s.on('connect',()=>s.write('CONNECT 127.0.0.1:${port} HTTP/1.1\\r\\nHost: 127.0.0.1:${port}\\r\\n\\r\\n'));
s.on('data',c=>{bytes+=c;if(bytes.includes('crash-nonce')&&!ready){ready=true;fs.writeFileSync('/workspace/ready','ready')}});
s.on('error',()=>{});s.on('close',async()=>{if(done)return;done=true;clearTimeout(deadline);if(!ready){process.exitCode=6;return}for(const k of Object.keys(process.env))if(/proxy/i.test(k))delete process.env[k];const raw=await direct('127.0.0.1',${port});console.log(JSON.stringify({ready,closed:true,raw}));});`;
        fs.writeFileSync(path.join(f.workspace, "crash.cjs"), script);
        const { session, proxy } = await f.start();
        const endpoint = await docker([
          "context",
          "inspect",
          "--format",
          "{{.Endpoints.docker.Host}}",
        ]);
        const inspect = JSON.parse(
          await docker(["--host", endpoint, "inspect", session.relayId]),
        )[0];
        const owner = inspect.Config.Labels["chainless.egress.owner"];
        expect(owner).toMatch(/^[a-f0-9]{32}$/);
        running = session.run("node /workspace/crash.cjs", {
          timeoutMs: 60_000,
        });
        // Observe rejections immediately even if readiness fails first.
        void running.catch(() => {});
        await waitForFile(path.join(f.workspace, "ready"));
        if (failure === "broker") await proxy.abort();
        else
          await docker([
            "--host",
            endpoint,
            "kill",
            "--signal",
            "KILL",
            session.relayId,
          ]);
        const result = await running;
        expect(result.exitCode, result.stderr).toBe(0);
        expect(JSON.parse(result.stdout)).toMatchObject({
          ready: true,
          closed: true,
        });
        expect(JSON.parse(result.stdout).raw).not.toBe("CONNECTED");
        expect(connections).toBe(2);
        const remaining = await docker([
          "--host",
          endpoint,
          "ps",
          "--all",
          "--quiet",
          "--filter",
          `label=chainless.egress.owner=${owner}`,
        ]);
        expect(remaining).toBe("");
      } finally {
        try {
          await f.close();
        } finally {
          await running?.catch(() => {});
        }
      }
    },
    180_000,
  );
});
