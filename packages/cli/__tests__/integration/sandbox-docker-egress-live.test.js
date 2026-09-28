/** Real Linux Docker cell; missing primitives/images are failures when enabled.
 * This is initial enforcement evidence, not the complete NET-01 matrix.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import net from "node:net";
import { describe, expect, it } from "vitest";
import { startEgressProxyWorker } from "../../src/lib/sandbox-egress-worker.js";
import { startDockerEgressSession } from "../../src/lib/sandbox-docker-egress.js";

const LIVE = process.env.CC_DOCKER_EGRESS_LIVE === "1";
const listen = (server, ...args) =>
  new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(...args, () => resolve(server.address()));
  });

describe.runIf(LIVE)("Linux Docker egress real boundary", () => {
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
