import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { executionBroker } from "../../src/lib/process-execution-broker/index.js";
import { resetWindowsSandboxAdapterCache } from "../../src/lib/process-execution-broker/platform-sandbox.js";
import { installWindowsSandboxAdapterTestRoot } from "../../test/helpers/windows-sandbox-adapter-temp-root.js";

const brokerRoot = fileURLToPath(
  new URL("../../src/lib/process-execution-broker/", import.meta.url),
);
const hash = (file) =>
  createHash("sha256").update(fs.readFileSync(file)).digest("hex");

describe.runIf(process.platform === "win32")(
  "real Windows broker native wall-time watchdog",
  () => {
    let root, adapterRoot, original, evidenceRoot;
    const receipts = [];
    beforeAll(() => {
      root = fs.mkdtempSync(
        path.join(fs.realpathSync.native(os.tmpdir()), "cc-native-walltime-"),
      );
      adapterRoot = installWindowsSandboxAdapterTestRoot();
      original = {
        sandbox: executionBroker._sandboxEnabled,
        platform: executionBroker._platformSandboxEnabled,
        log: executionBroker._logPath,
      };
      executionBroker._sandboxEnabled = true;
      executionBroker._platformSandboxEnabled = true;
      executionBroker._logPath = path.join(root, "audit.jsonl");
      evidenceRoot = process.env.CC_WINDOWS_WALL_TIME_EVIDENCE_DIR;
      if (evidenceRoot) fs.mkdirSync(evidenceRoot, { mode: 0o700 });
    });
    afterAll(() => {
      if (evidenceRoot)
        fs.writeFileSync(
          path.join(evidenceRoot, "receipt.json"),
          JSON.stringify(
            {
              schema: "chainlesschain.windows-native-wall-time-diagnostic/v1",
              platform: process.platform,
              nodeVersion: process.version,
              sourceSha256: hash(path.join(brokerRoot, "windows-sandbox.cs")),
              helperExeSha256: hash(
                path.join(brokerRoot, "windows-sandbox-helper.exe"),
              ),
              helperDllSha256: hash(
                path.join(brokerRoot, "windows-sandbox-helper.dll"),
              ),
              adapterSha256: hash(path.join(brokerRoot, "platform-sandbox.js")),
              brokerSha256: hash(path.join(brokerRoot, "index.js")),
              nativeReviewAcceptance: false,
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
      fs.rmSync(root, { recursive: true });
    });

    it("executes the rebuilt helper with the exact C# source digest", () => {
      const result = spawnSync(
        path.join(brokerRoot, "windows-sandbox-helper.exe"),
        ["--probe-helper"],
        { windowsHide: true, encoding: "utf8", timeout: 10000 },
      );
      expect(result.error, result.stderr).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
      const probe = JSON.parse(result.stdout);
      expect(probe).toMatchObject({
        ready: true,
        sourceSha256: hash(path.join(brokerRoot, "windows-sandbox.cs")),
      });
      receipts.push({ kind: "compiled-source-identity", ...probe });
    });

    for (const earlyExit of [false, true]) {
      it(
        earlyExit
          ? "normal parent exit still fences its detached descendant"
          : "native wall time stops a sleeping parent and detached descendant without the outer timeout",
        () => {
          const code = `
        const child = require('node:child_process').spawn(process.execPath,
          ['-e', 'console.log(process.pid); setInterval(() => {}, 1000)'],
          { detached: true, windowsHide: true, stdio: ['ignore', 'pipe', 'inherit'] });
        child.on('error', error => { console.error(error); process.exit(81); });
        child.stdout.once('data', data => {
          console.log(JSON.stringify({parent:process.pid, descendant:Number(data.toString().trim())}));
          ${earlyExit ? "process.exit(7);" : "setInterval(() => {}, 1000);"}
        });
      `;
          const started = Date.now();
          const result = executionBroker.spawnSync(
            process.execPath,
            ["-e", code],
            {
              cwd: root,
              encoding: "utf8",
              windowsHide: true,
              shell: false,
              timeout: 20000,
              maxBuffer: 1024 * 1024,
              env: {
                SystemRoot: process.env.SystemRoot,
                WINDIR: process.env.WINDIR,
                PATH: path.dirname(process.execPath),
              },
              origin: "test:native-wall-time",
              scope: "native-wall-time-diagnostic",
              policy: "allow",
              sandboxPolicy: {
                profile: "default",
                limits: { wallTimeMs: 2000 },
              },
            },
          );
          const receipt = {
            kind: earlyExit ? "normal-exit" : "wall-time-expired",
            elapsedMs: Date.now() - started,
            exitCode: result.status,
            signal: result.signal,
            error: result.error?.message ?? null,
            stdout: result.stdout,
            stderr: result.stderr,
          };
          receipts.push(receipt);
          expect(result.error, result.stderr).toBeUndefined();
          expect(result.signal).toBeNull();
          expect(result.status, result.stderr).toBe(earlyExit ? 7 : 125);
          if (!earlyExit)
            expect(result.stderr).toContain(
              "Windows sandbox wall-time limit exceeded",
            );
          const identities = JSON.parse(result.stdout.trim());
          for (const pid of Object.values(identities)) {
            expect(Number.isSafeInteger(pid) && pid > 0).toBe(true);
            expect(() => process.kill(pid, 0)).toThrowError(
              expect.objectContaining({ code: "ESRCH" }),
            );
          }
          receipt.identities = identities;
          receipt.allObservedProcessesAbsent = true;
          const audit = executionBroker.getAuditLog(1)[0];
          expect(audit.sandboxed).toBe(true);
          expect(audit.sandboxBackend).toBe("windows-job-restricted-token");
          expect(audit.sandboxGuarantees).toContain("process-tree");
          receipt.backend = audit.sandboxBackend;
        },
        30000,
      );
    }
  },
);
