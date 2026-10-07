import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createWindowsNativeEvaluator,
  consumeWindowsNativeEvaluatorPolicy,
} from "../../src/lib/process-execution-broker/windows-native-evaluator.js";
import { executionBroker } from "../../src/lib/process-execution-broker/index.js";
import { resetWindowsSandboxAdapterCache } from "../../src/lib/process-execution-broker/platform-sandbox.js";
import { installWindowsSandboxAdapterTestRoot } from "../../test/helpers/windows-sandbox-adapter-temp-root.js";

const windowsDirectory = process.env.SystemRoot || "C:\\Windows";
const frameworkHost = path.join(
  windowsDirectory,
  "System32",
  "WindowsPowerShell",
  "v1.0",
  "powershell.exe",
);
const coreHost =
  process.env.CC_WINDOWS_NATIVE_EVALUATOR_TEST_PWSH ||
  path.join(
    path.parse(windowsDirectory).root,
    "Program Files",
    "PowerShell",
    "7",
    "pwsh.exe",
  );
const nativeRuntimeHosts = [
  { label: ".NET Framework", command: frameworkHost },
  ...(fs.existsSync(coreHost)
    ? [{ label: ".NET Core", command: coreHost }]
    : []),
];

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

    it("attests native directory identity without accepting it as a regular file", () => {
      const assembly = fileURLToPath(
        new URL(
          "../../src/lib/process-execution-broker/windows-sandbox-helper.dll",
          import.meta.url,
        ),
      );
      const quote = (value) => `'${value.replaceAll("'", "''")}'`;
      const script = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$assembly = [Reflection.Assembly]::LoadFile(${quote(assembly)})
$native = $assembly.GetType('ChainlessChain.WindowsSandbox.Native', $true)
$flags = [Reflection.BindingFlags]'Static,NonPublic'
$hold = $native.GetMethod('HoldEvaluatorPath', $flags)
$read = $native.GetMethod('ReadLaunchPathFileIdentity', $flags)
$close = $native.GetMethod('CloseHandle', $flags)
$guards = [System.Collections.Generic.List[IntPtr]]::new()
try {
  $handle = $hold.Invoke($null, @(${quote(sourceRoot)}, $true, $guards.psobject.BaseObject))
  $identity = $read.Invoke($null, @([IntPtr]$handle, $true))
  $rejected = $false
  try { $null = $read.Invoke($null, @([IntPtr]$handle, $false)) }
  catch { $rejected = $_.Exception.InnerException.Message -match 'not a regular non-reparse file' }
  @{directoryAttested = $null -ne $identity; fileOnlyRejected = $rejected} | ConvertTo-Json -Compress
} finally {
  foreach ($guard in $guards) { $null = $close.Invoke($null, @([IntPtr]$guard)) }
}
`;
      const output = execFileSync(
        path.join(
          process.env.SystemRoot,
          "System32",
          "WindowsPowerShell",
          "v1.0",
          "powershell.exe",
        ),
        [
          "-NoProfile",
          "-NonInteractive",
          "-EncodedCommand",
          Buffer.from(script, "utf16le").toString("base64"),
        ],
        { encoding: "utf8", windowsHide: true, timeout: 15000 },
      );
      expect(JSON.parse(output)).toEqual({
        directoryAttested: true,
        fileOnlyRejected: true,
      });
    });

    it.each(nativeRuntimeHosts)(
      "executes a real staged Node check with immutable source/control and writable scratch on $label",
      async ({ command, label }) => {
        const started = performance.now();
        const timings = { runtime: label };
        let outcome;
        try {
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
          timings.prepareMs = Math.round(performance.now() - started);
          const originalNative = executionBroker._native;
          let hostLaunches = 0;
          executionBroker._native = {
            ...originalNative,
            spawnSync: (requested, args, options) => {
              expect(["powershell.exe", "pwsh.exe"]).toContain(
                path.basename(requested).toLowerCase(),
              );
              expect(args).toContain("-EncodedCommand");
              hostLaunches++;
              // Exercise the unchanged byte-loaded helper/bootstrap and target
              // policy in each installed CLR, including portable pwsh for local
              // reproduction. No helper or AppContainer boundary is mocked.
              const supervisorStarted = performance.now();
              try {
                return spawnSync(command, args, options);
              } finally {
                timings.supervisorMs = Math.round(
                  performance.now() - supervisorStarted,
                );
              }
            },
          };
          const executionStarted = performance.now();
          try {
            outcome = await execute(evaluator, "readonly-check");
          } finally {
            executionBroker._native = originalNative;
            timings.executeMs = Math.round(
              performance.now() - executionStarted,
            );
          }
          expect(hostLaunches).toBe(1);
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
            wallTimeMs: 10000,
          });
          await expect(evaluator.execute()).rejects.toThrow(/already consumed/);
          expect(
            fs.readFileSync(path.join(sourceRoot, "math.cjs"), "utf8"),
          ).toBe("module.exports = (a,b) => a+b;\n");
          const disposalStarted = performance.now();
          evaluator.dispose();
          timings.disposeMs = Math.round(performance.now() - disposalStarted);
        } finally {
          console.info(
            "[native-evaluator] " +
              JSON.stringify({
                ...timings,
                totalMs: Math.round(performance.now() - started),
                status: outcome?.result.status ?? null,
                cleanupConfirmed: outcome?.receipt.cleanupConfirmed ?? false,
                targetWallTimeMs: outcome?.receipt.wallTimeMs ?? null,
              }),
          );
        }
      },
      // This includes runtime capture, cold adapter probes, CLR startup and
      // disposal. The target still has its independently attested 10s native
      // watchdog. Hosted cold starts exceeded the old 30s test-only budget
      // (30.5s); use the existing suite's 90s subprocess budget for both CLRs.
      90000,
    );

    it("preserves supervisor diagnostics when native settlement is missing", async () => {
      const evaluator = create("throw new Error('must never run');");
      const result = {
        status: 125,
        signal: null,
        stderr: "Path stat identity does not match the locked launch handle",
        stdout: "",
      };
      const spawn = vi
        .spyOn(executionBroker, "spawnSync")
        .mockReturnValue(result);
      try {
        const error = await evaluator.execute().catch((value) => value);
        expect(error.message).toContain(result.stderr);
        expect(error.nativeEvaluator).toMatchObject({
          result,
          manifestDigest: evaluator.manifestDigest,
          stage: evaluator.root,
        });
        expect(error.cause.code).toBe("ENOENT");
        expect(() => evaluator.dispose()).toThrow(/unconfirmed native cleanup/);
      } finally {
        spawn.mockRestore();
        // The mock never creates a native process. Remove only this factory's
        // private stage after checking its canonical temp-root binding.
        const stage = fs.realpathSync.native(evaluator.root);
        expect(path.dirname(stage)).toBe(fs.realpathSync.native(os.tmpdir()));
        expect(path.basename(stage)).toMatch(/^cc-native-evaluator-[\w-]{6}$/u);
        fs.rmSync(stage, { recursive: true });
      }
    });

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
      // Expose an empty temporary file, then a complete temporary file, for
      // 25ms each. Neither state may be mistaken for the published PID.
      const child=require('node:child_process').spawn(process.execPath,
        ['-e','const fs=require("node:fs"),ready=process.argv[1],pending=ready+".pending";fs.writeFileSync(pending,"");setTimeout(()=>{fs.writeFileSync(pending,String(process.pid));setTimeout(()=>fs.renameSync(pending,ready),25);},25);setInterval(()=>{},1000)',ready],
        {detached:true,windowsHide:true,stdio:'inherit'});
      child.on('error',error=>{console.error(error);process.exit(81);});
      setInterval(()=>{if(fs.existsSync(ready)){
        const descendant=Number(fs.readFileSync(ready,'utf8'));
        if(!Number.isSafeInteger(descendant)||descendant<=0||descendant!==child.pid)throw new Error('Invalid published descendant PID: '+descendant+'; expected '+child.pid);
        console.log(JSON.stringify({parent:process.pid,descendant}));process.exit(0);
      }},20);
    `);
      const outcome = await execute(evaluator, "detached-descendant");
      expect(outcome.result.status, outcome.result.stderr).toBe(0);
      const identities = JSON.parse(outcome.result.stdout);
      receipts.at(-1).identities = identities;
      expect(identities.parent).toBe(outcome.receipt.targetPid);
      expect(identities.descendant).not.toBe(identities.parent);
      for (const role of ["parent", "descendant"]) {
        const pid = identities[role];
        expect(Number.isSafeInteger(pid), `${role} PID: ${pid}`).toBe(true);
        expect(pid, `${role} PID: ${pid}`).toBeGreaterThan(0);
        expect(() => process.kill(pid, 0), `${role} PID: ${pid}`).toThrowError(
          expect.objectContaining({ code: "ESRCH" }),
        );
      }
      receipts.at(-1).observedProcessesAbsent = true;
      evaluator.dispose();
    }, 30000);
  },
);
