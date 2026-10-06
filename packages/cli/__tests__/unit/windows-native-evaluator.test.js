import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createWindowsNativeEvaluator,
  consumeWindowsNativeEvaluatorPolicy,
} from "../../src/lib/process-execution-broker/windows-native-evaluator.js";
import { executionBroker } from "../../src/lib/process-execution-broker/index.js";
import { resetWindowsSandboxAdapterCache } from "../../src/lib/process-execution-broker/platform-sandbox.js";
import { installWindowsSandboxAdapterTestRoot } from "../../test/helpers/windows-sandbox-adapter-temp-root.js";

describe.runIf(process.platform === "win32")(
  "private staged Windows native evaluator",
  () => {
    let sourceRoot, adapterRoot, original, evidenceRoot, sourceIdentities;
    const receipts = [];
    beforeAll(() => {
      sourceRoot = fs.mkdtempSync(
        path.join(fs.realpathSync.native(os.tmpdir()), "cc-native-source-"),
      );
      fs.writeFileSync(
        path.join(sourceRoot, "math.cjs"),
        "module.exports = (a,b) => a+b;\n",
      );
      adapterRoot = installWindowsSandboxAdapterTestRoot();
      original = {
        sandbox: executionBroker._sandboxEnabled,
        platform: executionBroker._platformSandboxEnabled,
        log: executionBroker._logPath,
      };
      executionBroker._sandboxEnabled = true;
      executionBroker._platformSandboxEnabled = true;
      executionBroker._logPath = path.join(sourceRoot, "audit.jsonl");
      evidenceRoot = process.env.CC_WINDOWS_NATIVE_EVALUATOR_EVIDENCE_DIR;
      if (evidenceRoot) fs.mkdirSync(evidenceRoot, { mode: 0o700 });
      sourceIdentities = [
        "windows-native-evaluator.js",
        "platform-sandbox.js",
        "index.js",
        "windows-sandbox.cs",
        "windows-sandbox-helper.exe",
        "windows-sandbox-helper.dll",
      ].map((file) => ({
        file,
        sha256: createHash("sha256")
          .update(
            fs.readFileSync(
              new URL(
                "../../src/lib/process-execution-broker/" + file,
                import.meta.url,
              ),
            ),
          )
          .digest("hex"),
      }));
    });
    afterAll(() => {
      if (evidenceRoot)
        fs.writeFileSync(
          path.join(evidenceRoot, "receipt.json"),
          JSON.stringify(
            {
              schema: "chainlesschain.windows-native-evaluator-diagnostic/v1",
              platform: process.platform,
              nodeVersion: process.version,
              files: sourceIdentities,
              fullReviewPackAssessed: false,
              providerAssessed: false,
              durableAuthorityAssessed: false,
              receipts,
            },
            null,
            2,
          ) + "\n",
          { flag: "wx" },
        );
      executionBroker._sandboxEnabled = original.sandbox;
      executionBroker._platformSandboxEnabled = original.platform;
      executionBroker._logPath = original.log;
      executionBroker.flushAuditLog();
      resetWindowsSandboxAdapterCache();
      adapterRoot.teardown();
      fs.rmSync(sourceRoot, { recursive: true });
    });
    const create = (checkSource) =>
      createWindowsNativeEvaluator({
        sourceRoot,
        files: ["math.cjs"],
        checkSource,
        wallTimeMs: 10000,
      });
    async function execute(evaluator, kind) {
      const entry = {
        kind,
        stage: evaluator.root,
        manifestDigest: evaluator.manifestDigest,
      };
      receipts.push(entry);
      try {
        const outcome = await evaluator.execute();
        Object.assign(entry, {
          status: outcome.result.status,
          signal: outcome.result.signal,
          error: outcome.result.error?.message ?? null,
          stdout: outcome.result.stdout,
          stderr: outcome.result.stderr,
          settlement: outcome.receipt,
        });
        return outcome;
      } catch (error) {
        entry.error = error.message;
        throw error;
      }
    }

    it("rejects forged policy, reused destinations, excessive files, path aliases and hardlinks", () => {
      expect(() => consumeWindowsNativeEvaluatorPolicy({}, {}, {})).toThrow(
        /unissued/,
      );
      const defaults = {
        sourceRoot,
        files: ["math.cjs"],
        checkSource: "console.log('unused')",
      };
      for (const override of [
        { tempRoot: sourceRoot },
        { files: Array(65).fill("math.cjs") },
        { files: ["../math.cjs"] },
        { files: ["math.cjs", "MATH.cjs"] },
        { files: ["CON.js"] },
        { checkSource: "x".repeat(1024 * 1024 + 1) },
      ])
        expect(() =>
          createWindowsNativeEvaluator({ ...defaults, ...override }),
        ).toThrow();
      fs.linkSync(
        path.join(sourceRoot, "math.cjs"),
        path.join(sourceRoot, "alias.cjs"),
      );
      try {
        expect(() => createWindowsNativeEvaluator(defaults)).toThrow(
          /hard-linked/,
        );
      } finally {
        fs.unlinkSync(path.join(sourceRoot, "alias.cjs"));
      }
    });

    it("executes a real staged Node check with immutable source/control and writable scratch", async () => {
      const evaluator = create(`
      const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
      const workspace=process.argv[2],scratch=process.argv[3];
      assert.equal(require(path.join(workspace,'math.cjs'))(2,3),5);
      for(const file of [path.join(workspace,'math.cjs'),__filename]) {
        assert.throws(()=>fs.writeFileSync(file,'corrupt'),error=>['EACCES','EPERM','EBUSY'].includes(error.code));
      }
      assert.throws(()=>fs.writeFileSync(path.join(workspace,'new.cjs'),'corrupt'),error=>['EACCES','EPERM'].includes(error.code));
      for(const operation of [
        ()=>fs.unlinkSync(path.join(workspace,'math.cjs')),
        ()=>fs.renameSync(workspace,path.join(scratch,'renamed')),
        ()=>fs.linkSync(path.join(workspace,'math.cjs'),path.join(scratch,'alias.cjs')),
      ]) assert.throws(operation,error=>['EACCES','EPERM','EBUSY'].includes(error.code));
      fs.writeFileSync(path.join(scratch,'output.txt'),'allowed');
      assert.equal(fs.readFileSync(path.join(scratch,'output.txt'),'utf8'),'allowed');
      assert.equal(process.env.OPENAI_API_KEY,undefined);
      assert.equal(process.env.VOLCENGINE_API_KEY,undefined);
      console.log(JSON.stringify({sum:5,sourceWriteDenied:true,checkWriteDenied:true,scratchWritable:true}));
    `);
      const outcome = await execute(evaluator, "readonly-check");
      expect(outcome.result.status, outcome.result.stderr).toBe(0);
      expect(JSON.parse(outcome.result.stdout)).toMatchObject({
        sum: 5,
        sourceWriteDenied: true,
        checkWriteDenied: true,
        scratchWritable: true,
      });
      expect(outcome.receipt).toMatchObject({
        cleanupConfirmed: true,
        capabilityCount: 0,
        executionFailed: false,
      });
      await expect(evaluator.execute()).rejects.toThrow(/already consumed/);
      expect(fs.readFileSync(path.join(sourceRoot, "math.cjs"), "utf8")).toBe(
        "module.exports = (a,b) => a+b;\n",
      );
      evaluator.dispose();
    }, 30000);

    it("rejects changed staged source before target creation instead of blessing its old digest", async () => {
      const evaluator = create("throw new Error('must never run');");
      fs.writeFileSync(
        path.join(evaluator.root, "workspace", "math.cjs"),
        "module.exports = () => 0;\n",
      );
      const outcome = await execute(evaluator, "tampered-source");
      expect(outcome.result.status).toBe(125);
      expect(outcome.result.stderr).toMatch(
        /Native evaluator file (?:digest|identity)/,
      );
      expect(outcome.receipt).toMatchObject({
        targetPid: 0,
        cleanupConfirmed: true,
        executionFailed: true,
      });
      evaluator.dispose();
    }, 30000);

    it("attests zero-capability network policy without loopback exemptions and records real TCP failures", async () => {
      let connections = 0;
      const listener = net.createServer((socket) => {
        connections++;
        socket.destroy();
      });
      listener.listen(0, "127.0.0.1");
      await once(listener, "listening");
      try {
        const baselineAccepted = once(listener, "connection");
        const baseline = net.connect({
          host: "127.0.0.1",
          port: listener.address().port,
        });
        await Promise.all([once(baseline, "connect"), baselineAccepted]);
        baseline.destroy();
        await new Promise((resolve) => setImmediate(resolve));
        expect(connections).toBe(1);
        const evaluator = create(`
        const net=require('node:net');
        async function observe(host,port){return new Promise((resolve,reject)=>{
          const socket=net.connect({host,port});
          socket.setTimeout(1500,()=>{socket.destroy();reject(new Error('timeout does not prove deny'));});
          socket.once('connect',()=>{socket.destroy();reject(new Error('network unexpectedly connected'));});
          socket.once('error',error=>{socket.destroy();resolve({host,code:error.code,errno:error.errno,message:error.message});});
        });}
        Promise.all([observe('127.0.0.1',${listener.address().port}),observe('1.1.1.1',443)])
          .then(results=>console.log(JSON.stringify({observedFailures:results}))).catch(error=>{console.error(error);process.exitCode=1;});
      `);
        const outcome = await execute(
          evaluator,
          "network-policy-and-reachability",
        );
        expect(outcome.result.status, outcome.result.stderr).toBe(0);
        expect(outcome.receipt).toMatchObject({
          capabilityCount: 0,
          loopbackExemptionAbsent: true,
        });
        const observations = JSON.parse(outcome.result.stdout).observedFailures;
        expect(observations).toHaveLength(2);
        for (const observation of observations)
          expect(["EACCES", "EPERM", "ETIMEDOUT"]).toContain(observation.code);
        await new Promise((resolve) => setImmediate(resolve));
        expect(connections).toBe(1);
        const afterAccepted = once(listener, "connection");
        const after = net.connect({
          host: "127.0.0.1",
          port: listener.address().port,
        });
        await Promise.all([once(after, "connect"), afterAccepted]);
        after.destroy();
        await new Promise((resolve) => setImmediate(resolve));
        expect(connections).toBe(2);
        // A socket timeout alone does not certify denial. The native receipt
        // independently attests a zero-capability target and no loopback
        // exemptions before launch and after its empty-Job fence. Preserve the
        // actual Winsock errors instead of rewriting them as access denied.
        Object.assign(receipts.at(-1), {
          loopbackPositiveControlBeforeAndAfter: true,
          unexpectedLoopbackConnections: connections - 2,
          explicitAccessDenied: observations.every((item) =>
            ["EACCES", "EPERM"].includes(item.code),
          ),
          timeoutAloneAcceptedAsDeny: false,
        });
        evaluator.dispose();
      } finally {
        await new Promise((resolve) => listener.close(resolve));
      }
    }, 30000);

    it("fences a detached AppContainer descendant after the evaluator exits", async () => {
      const evaluator = create(`
      const fs=require('node:fs'),path=require('node:path');
      const ready=path.join(process.argv[3],'child-ready.txt');
      const child=require('node:child_process').spawn(process.execPath,
        ['-e','require("node:fs").writeFileSync(process.argv[1],String(process.pid));setInterval(()=>{},1000)',ready],
        {detached:true,windowsHide:true,stdio:'inherit'});
      child.on('error',error=>{console.error(error);process.exit(81);});
      setInterval(()=>{if(fs.existsSync(ready)){console.log(JSON.stringify({parent:process.pid,descendant:Number(fs.readFileSync(ready,'utf8'))}));process.exit(0);}},20);
    `);
      const outcome = await execute(evaluator, "detached-descendant");
      expect(outcome.result.status, outcome.result.stderr).toBe(0);
      const identities = JSON.parse(outcome.result.stdout);
      for (const pid of Object.values(identities))
        expect(() => process.kill(pid, 0)).toThrowError(
          expect.objectContaining({ code: "ESRCH" }),
        );
      receipts.at(-1).observedProcessesAbsent = true;
      evaluator.dispose();
    }, 30000);
  },
);
