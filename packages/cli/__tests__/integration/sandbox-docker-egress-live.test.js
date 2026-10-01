/** Real Linux Docker cell; missing primitives/images are failures when enabled.
 * This is initial enforcement evidence, not the complete NET-01 matrix.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import net from "node:net";
import dgram from "node:dgram";
import dns from "node:dns";
import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import executionBroker from "../../src/lib/process-execution-broker/index.js";
import { startEgressProxyWorker } from "../../src/lib/sandbox-egress-worker.js";
import { startDockerEgressSession } from "../../src/lib/sandbox-docker-egress.js";
import { normalizeAgentSandbox } from "../../src/lib/agent-sandbox.js";
import { executeTool } from "../../src/runtime/agent-core.js";
import { WSSessionManager } from "../../src/gateways/ws/ws-session-gateway.js";
import { ApprovalGate, APPROVAL_POLICY } from "@chainlesschain/session-core";
import {
  createAutoModeApprovalGate,
  resolveAutoModeDecisions,
} from "../../src/lib/auto-mode-config.js";
import dnsFixture from "../fixtures/dns-egress-fixture.cjs";
import settingsLoader from "../../src/lib/settings-loader.cjs";
import { createPermissionRulesProvider } from "../../src/lib/permission-authority.js";

const { queryDns, startDnsFixture } = dnsFixture;
const DNS_TRANSPORTS = [
  { transport: "udp", family: 4 },
  { transport: "udp", family: 6 },
  { transport: "tcp", family: 4 },
  { transport: "tcp", family: 6 },
];

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
    get openSockets() {
      return sockets.size;
    },
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

describe("real host DNS controls for Docker boundary probes", () => {
  for (const options of DNS_TRANSPORTS) {
    // NET-01 promises a Linux boundary. IPv6 is mandatory in that live cell;
    // other hosts run the IPv4 controls without acquiring a new IPv6 promise.
    it.runIf(options.family === 4 || process.platform === "linux")(
      `exchanges an A answer over ${options.transport} / IPv${options.family}`,
      async () => {
        const server = await startDnsFixture(options);
        try {
          const response = await queryDns({
            ...options,
            host: server.host,
            port: server.port,
            name: `${crypto.randomUUID()}.policy.test`,
          });
          expect([...response.subarray(-4)]).toEqual([127, 0, 0, 9]);
          expect(server.queries).toBe(1);
        } finally {
          await server.close();
        }
      },
    );
  }
});

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

  it.each([
    "permission-rules",
    "auto-mode-aba",
    "host-policy",
    "host-policy-aba",
    "settings-api",
    "settings-api-aba",
  ])(
    "cuts an established product tunnel on %s revocation",
    async (source) => {
      const image = process.env.CC_DOCKER_EGRESS_IMAGE;
      expect(image).toMatch(/@sha256:[a-f0-9]{64}$/);
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-egress-revoke-"));
      const sockets = new Set();
      let receivedBytes = 0;
      const upstream = net.createServer((socket) => {
        sockets.add(socket);
        socket.on("error", () => {});
        socket.on("data", (chunk) => {
          receivedBytes += chunk.length;
        });
        socket.once("close", () => sockets.delete(socket));
      });
      let denied = false;
      const gate = createAutoModeApprovalGate(
        new ApprovalGate({
          defaultPolicy:
            source === "auto-mode-aba"
              ? APPROVAL_POLICY.STRICT
              : APPROVAL_POLICY.AUTOPILOT,
        }),
        resolveAutoModeDecisions({ decisions: { medium: "allow" } }),
      );
      let pending;
      const manager = new WSSessionManager({ defaultProjectRoot: root });
      const allowedHostPolicy = { tools: { run_shell: { allowed: true } } };
      const { sessionId: hostSessionId } = manager.createSession({
        hostManagedToolPolicy: allowedHostPolicy,
      });
      const hostSession = manager.getSession(hostSessionId);
      try {
        const before = await docker([
          "ps",
          "-a",
          "--filter",
          "label=chainless.egress.owner",
          "--format",
          "{{.Names}}",
        ]);
        const { port } = await listen(upstream, 0, "127.0.0.1");
        fs.writeFileSync(
          path.join(root, "tunnel.cjs"),
          `const fs=require('node:fs'),net=require('node:net');
const socket=net.connect(3128,'127.0.0.1');let header='';let ready=false;
socket.on('connect',()=>socket.write('CONNECT 127.0.0.1:${port} HTTP/1.1\\r\\nHost: 127.0.0.1:${port}\\r\\n\\r\\n'));
socket.on('data',chunk=>{if(ready)return;header+=chunk.toString();if(header.includes('\\r\\n\\r\\n')){if(!/^HTTP\\/1\\.[01] 200 /.test(header))process.exit(3);ready=true;fs.writeFileSync('/workspace/tunnel-ready','ready')}});
socket.on('error',()=>{});socket.on('close',()=>{});
setInterval(()=>{if(ready&&!socket.destroyed)socket.write('ping')},50);
setInterval(()=>fs.writeFileSync('/workspace/heartbeat',String(Date.now())),50);`,
        );
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
        pending = executeTool(
          "run_shell",
          { command: "node /workspace/tunnel.cjs", timeout: 30_000 },
          {
            cwd: root,
            sandbox,
            sessionId: "live-auto-revoke",
            ...(source.startsWith("host-policy")
              ? {
                  hostManagedToolPolicy: hostSession.hostManagedToolPolicy,
                  hostManagedToolPolicyAuthority:
                    hostSession.hostManagedToolPolicyAuthority,
                }
              : {}),
            permissionRulesProvider: source.startsWith("settings-api")
              ? createPermissionRulesProvider({ cwd: root, env: {} })
              : async () => ({
                  rules: {
                    allow: [],
                    ask: [],
                    deny: denied ? ["run_shell"] : [],
                  },
                  sources: {},
                  scoped: { rules: [] },
                }),
            approvalGate: gate,
          },
        );
        await waitForFile(path.join(root, "tunnel-ready"));
        const trafficDeadline = Date.now() + 5_000;
        while (!receivedBytes && Date.now() < trafficDeadline) await delay(25);
        expect(receivedBytes).toBeGreaterThan(0);
        if (source === "auto-mode-aba") {
          gate.setActive(false);
          gate.setActive(true);
          expect(
            gate.getAuthorizationPolicySnapshot("live-auto-revoke"),
          ).toMatchObject({ active: true, activeRevision: 2 });
        } else if (source.startsWith("host-policy")) {
          manager.updateSessionPolicy(hostSessionId, {
            tools: { run_shell: { allowed: false } },
          });
          if (source === "host-policy-aba")
            manager.updateSessionPolicy(hostSessionId, allowedHostPolicy);
          expect(
            hostSession.hostManagedToolPolicyAuthority.getSnapshot().revision,
          ).toBe(source === "host-policy-aba" ? 2 : 1);
        } else if (source.startsWith("settings-api")) {
          const settings = path.join(root, ".claude", "settings.json");
          const existed = fs.existsSync(settings);
          const original = existed ? fs.readFileSync(settings, "utf8") : "{}";
          const revision =
            settingsLoader.getSettingsPermissionRevision().revision;
          settingsLoader.addRule({ cwd: root, kind: "deny", rule: "Bash" });
          if (source === "settings-api-aba")
            fs.writeFileSync(settings, original);
          expect(settingsLoader.getSettingsPermissionRevision().revision).toBe(
            revision + 1,
          );
        } else denied = true;
        const result = await Promise.race([
          pending,
          delay(10_000).then(() => {
            throw new Error("Running Docker shell ignored revoked authority");
          }),
        ]);
        expect(result.exitCode, result.error).toBe(1);
        expect(result.retrySafe).toBe(false);
        expect(result.authorityFailure).toMatchObject({
          code: "CC_SHELL_POLICY_AUTHORITY_CHANGED",
        });
        expect(result.sandboxCapabilities.applied).toEqual([]);
        const deadline = Date.now() + 10_000;
        while (sockets.size && Date.now() < deadline) await delay(25);
        expect(sockets.size).toBe(0);
        const bytesAtTeardown = receivedBytes;
        await delay(250);
        expect(receivedBytes).toBe(bytesAtTeardown);
        const after = await docker([
          "ps",
          "-a",
          "--filter",
          "label=chainless.egress.owner",
          "--format",
          "{{.Names}}",
        ]);
        expect(after).toBe(before);
        const heartbeatAtTeardown = fs.readFileSync(
          path.join(root, "heartbeat"),
          "utf8",
        );
        await delay(250);
        expect(fs.readFileSync(path.join(root, "heartbeat"), "utf8")).toBe(
          heartbeatAtTeardown,
        );
      } finally {
        denied = true;
        manager.updateSessionPolicy(hostSessionId, {
          tools: { run_shell: { allowed: false } },
        });
        await pending?.catch(() => {});
        manager.closeSession(hostSessionId);
        for (const socket of sockets) socket.destroy();
        await new Promise((resolve) => upstream.close(resolve));
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
    180_000,
  );

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
  it("blocks direct TCP and UDP DNS over both IPv4 and IPv6 with reachable host controls", async () => {
    const f = await liveFixture({ allowedDomains: ["127.0.0.1", "::1"] });
    const services = [];
    try {
      const probes = [];
      for (const options of DNS_TRANSPORTS) {
        const server = await startDnsFixture(options);
        services.push(server);
        const probe = {
          ...options,
          host: server.host,
          port: server.port,
          name: `${crypto.randomUUID()}.policy.test`,
          queryId: crypto.randomInt(0x10000),
        };
        const response = await queryDns(probe);
        expect([...response.subarray(-4)]).toEqual([127, 0, 0, 9]);
        expect(server.queries).toBe(1);
        probes.push(probe);
      }
      fs.copyFileSync(
        new URL("../fixtures/dns-egress-fixture.cjs", import.meta.url),
        path.join(f.workspace, "dns-egress-fixture.cjs"),
      );
      fs.writeFileSync(
        path.join(f.workspace, "dns-matrix.cjs"),
        `const {queryDns}=require('./dns-egress-fixture.cjs');
for(const key of Object.keys(process.env))if(/proxy/i.test(key))delete process.env[key];
(async()=>{const results=[];for(const probe of ${JSON.stringify(probes)}){
try{const answer=await queryDns(probe);results.push({transport:probe.transport,family:probe.family,answer:[...answer.subarray(-4)]})}
catch(error){results.push({transport:probe.transport,family:probe.family,error:error.code||error.message})}}
console.log(JSON.stringify(results))})().catch(error=>{console.error(error);process.exitCode=1});`,
      );
      const { session } = await f.start();
      const result = await session.run("node /workspace/dns-matrix.cjs", {
        timeoutMs: 15_000,
      });
      expect(result.exitCode, result.stderr).toBe(0);
      const reports = JSON.parse(result.stdout);
      expect(reports).toHaveLength(4);
      for (const [index, report] of reports.entries()) {
        expect(report).toMatchObject(DNS_TRANSPORTS[index]);
        expect(report.answer).toBeUndefined();
        expect(report.error).toBeTruthy();
        expect(services[index].queries).toBe(1);
      }
    } finally {
      try {
        await f.close();
      } finally {
        await Promise.all(services.map((service) => service.close()));
      }
    }
  }, 180_000);

  it("blocks direct UDP DNS queries while the host DNS service is reachable", async () => {
    const f = await liveFixture({ allowedDomains: ["127.0.0.1"] });
    const server = dgram.createSocket("udp4");
    let queries = 0;
    server.on("message", (message, peer) => {
      queries += 1;
      let end = 12;
      while (message[end] !== 0) end += message[end] + 1;
      end += 5; // zero terminator, QTYPE and QCLASS
      const header = Buffer.alloc(12);
      message.copy(header, 0, 0, 2);
      header.writeUInt16BE(0x8180, 2);
      header.writeUInt16BE(1, 4);
      header.writeUInt16BE(1, 6);
      const answer = Buffer.from([
        0xc0,
        0x0c, // compression pointer to the question name
        0,
        1,
        0,
        1, // A / IN
        0,
        0,
        0,
        0, // TTL
        0,
        4,
        127,
        0,
        0,
        9,
      ]);
      server.send(
        Buffer.concat([header, message.subarray(12, end), answer]),
        peer.port,
        peer.address,
      );
    });
    try {
      const port = await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.bind(0, "127.0.0.1", () => resolve(server.address().port));
      });
      const hostResolver = new dns.promises.Resolver({
        timeout: 1_000,
        tries: 1,
      });
      hostResolver.setServers([`127.0.0.1:${port}`]);
      expect(await hostResolver.resolve4("nonce.policy.test")).toEqual([
        "127.0.0.9",
      ]);
      expect(queries).toBe(1);
      fs.writeFileSync(
        path.join(f.workspace, "dns.cjs"),
        `const dns=require('node:dns');
const resolver=new dns.promises.Resolver({timeout:1000,tries:1});
resolver.setServers(['127.0.0.1:${port}']);
resolver.resolve4('nonce.policy.test').then(addresses=>console.log(JSON.stringify({addresses})),error=>console.log(JSON.stringify({error:error.code})));`,
      );
      const { session } = await f.start();
      const result = await session.run("node /workspace/dns.cjs", {
        timeoutMs: 10_000,
      });
      expect(result.exitCode, result.stderr).toBe(0);
      const report = JSON.parse(result.stdout);
      expect(report.addresses).toBeUndefined();
      expect(report.error).toBeTruthy();
      expect(queries).toBe(1);
    } finally {
      try {
        await f.close();
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }
    }
  }, 180_000);

  it("revokes ongoing HTTP and WebSocket streams inside the real Docker cell", async () => {
    const f = await liveFixture({ allowedDomains: ["127.0.0.1"] });
    let httpResponse;
    let httpSocket;
    let webSocket;
    const upstream = f.track(
      http.createServer((_request, response) => {
        httpResponse = response;
        httpSocket = response.socket;
        response.writeHead(200, { "content-type": "text/plain" });
        response.write("first-http-frame\n");
      }),
    );
    const webSocketFrame = (text) =>
      Buffer.concat([
        Buffer.from([0x81, Buffer.byteLength(text)]),
        Buffer.from(text),
      ]);
    upstream.on("upgrade", (request, socket) => {
      webSocket = socket;
      // Node leaves upgraded sockets half-open after the peer sends FIN.
      // Model a WebSocket server that closes its writable side on EOF.
      socket.once("end", () => socket.end());
      const accept = crypto
        .createHash("sha1")
        .update(
          request.headers["sec-websocket-key"] +
            "258EAFA5-E914-47DA-95CA-C5AB0DC85B11",
        )
        .digest("base64");
      socket.write(
        `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
      );
      socket.write(webSocketFrame("first-ws-frame"));
    });
    let running;
    try {
      const { port } = await listen(upstream, 0, "127.0.0.1");
      fs.writeFileSync(
        path.join(f.workspace, "streams.cjs"),
        `const fs=require('node:fs'),http=require('node:http'),net=require('node:net');
const seen={http:'',ws:''},closed={http:false,ws:false};
let ready=false,finished=false;
const deadline=setTimeout(()=>{console.error('stream teardown timed out');process.exit(5)},20000);
function finish(){if(finished||!closed.http||!closed.ws)return;finished=true;clearTimeout(deadline);console.log(JSON.stringify({seen,closed}));}
function markReady(){if(!ready&&seen.http.includes('first-http-frame')&&seen.ws.includes('first-ws-frame')){ready=true;fs.writeFileSync('/workspace/streams-ready','ready')}}
const req=http.get({host:'127.0.0.1',port:3128,path:'http://127.0.0.1:${port}/stream'},res=>{if(res.statusCode!==200)process.exit(6);res.on('data',chunk=>{seen.http+=chunk;markReady()});res.on('close',()=>{closed.http=true;finish()})});
req.on('error',()=>{closed.http=true;finish()});
const ws=net.connect(3128,'127.0.0.1');let tunnel=false;
ws.on('connect',()=>ws.write('CONNECT 127.0.0.1:${port} HTTP/1.1\\r\\nHost: 127.0.0.1:${port}\\r\\n\\r\\n'));
ws.on('data',chunk=>{seen.ws+=chunk;if(!tunnel&&seen.ws.includes('\\r\\n\\r\\n')){if(!seen.ws.startsWith('HTTP/1.1 200'))process.exit(7);tunnel=true;ws.write('GET /ws HTTP/1.1\\r\\nHost: 127.0.0.1:${port}\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\nSec-WebSocket-Version: 13\\r\\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\\r\\n\\r\\n')}markReady()});
ws.on('error',()=>{});ws.on('close',()=>{closed.ws=true;finish()});`,
      );
      const { proxy, session } = await f.start();
      running = session.run("node /workspace/streams.cjs", {
        timeoutMs: 30_000,
      });
      void running.catch(() => {});
      await waitForFile(path.join(f.workspace, "streams-ready"));
      expect(httpResponse).toBeDefined();
      expect(webSocket).toBeDefined();
      expect(
        await proxy.updatePolicy({ allowedDomains: ["elsewhere.test"] }, 0),
      ).toBe(1);
      // The upstream tries another frame after the revision acknowledgement.
      httpResponse.write("after-http-revocation\n");
      webSocket.write(webSocketFrame("after-ws-revocation"));
      const result = await running;
      expect(result.exitCode, result.stderr).toBe(0);
      const report = JSON.parse(result.stdout);
      expect(report.closed).toEqual({ http: true, ws: true });
      expect(report.seen.http).toContain("first-http-frame");
      expect(report.seen.ws).toContain("first-ws-frame");
      expect(report.seen.http).not.toContain("after-http-revocation");
      expect(report.seen.ws).not.toContain("after-ws-revocation");
      const deadline = Date.now() + 5_000;
      while (f.openSockets && Date.now() < deadline) await delay(25);
      expect({
        httpDestroyed: httpSocket?.destroyed,
        webSocketDestroyed: webSocket?.destroyed,
        openSockets: f.openSockets,
      }).toEqual({
        httpDestroyed: true,
        webSocketDestroyed: true,
        openSockets: 0,
      });
    } finally {
      await f.close();
      await running?.catch(() => {});
    }
  }, 180_000);

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
