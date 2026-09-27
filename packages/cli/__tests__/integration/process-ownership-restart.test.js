import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const brokerUrl = new URL(
  "../../src/lib/process-execution-broker/index.js",
  import.meta.url,
).href;
function executing(pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    return !["Z", "X"].includes(stat.slice(stat.lastIndexOf(")") + 2)[0]);
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

describe.skipIf(process.platform !== "linux")(
  "real Broker restart admission",
  () => {
    it.for([
      "preparation-failure",
      "helper-failure",
      "before-native",
      "owner-crash",
      "supervisor-loss",
      "confirmed-close",
    ])(
      "preserves durable ownership through %s",
      async (scenario, { task }) => {
        const root = fs.mkdtempSync(
          path.join(os.tmpdir(), "cc-ownership-restart-"),
        );
        const workspace = path.join(root, "workspace");
        fs.mkdirSync(workspace);
        const anchor = path.join(root, "authority");
        const readyPath = path.join(root, "ready.json");
        const marker = path.join(workspace, "executed");
        const journal = path.join(anchor, "process-ownership-v1/journal.json");
        const env = {
          ...process.env,
          CHAINLESSCHAIN_SECURITY_ANCHOR_HOME: anchor,
          CHAINLESSCHAIN_HOME: path.join(root, "first-home"),
        };
        const target = `const {spawn}=require('node:child_process');
        process.on('SIGTERM',()=>{});
        const leaf=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setTimeout(()=>process.exit(0),4000)"],{detached:true,stdio:'ignore'});
        process.stdout.write(JSON.stringify([process.pid,leaf.pid])+'\\n');
        setTimeout(()=>process.exit(0),4000);`;
        const deniedBeforeNative = [
          "preparation-failure",
          "helper-failure",
        ].includes(scenario);
        const victimCode = deniedBeforeNative
          ? `import fs from 'node:fs';
          import broker from ${JSON.stringify(brokerUrl)};
          let nativeEntered=false;
          broker._native={spawn(){nativeEntered=true;throw new Error('unexpected native launch')},spawnSync(){throw new Error('fixture compiler unavailable')}};
          if(${JSON.stringify(scenario)}==='preparation-failure')fs.fsyncSync=()=>{throw new Error('fixture fsync failure')};
          try{broker.spawn(process.execPath,['-e','process.exit(0)'],{cwd:${JSON.stringify(workspace)},policy:'allow',linuxSubreaper:{graceMs:50}});throw new Error('unexpected admission');}
          catch(error){fs.writeFileSync(${JSON.stringify(readyPath)},JSON.stringify({pids:[],nativeEntered,denial:error.code}));}`
          : `import fs from 'node:fs';
        import {spawn} from 'node:child_process';
        import broker from ${JSON.stringify(brokerUrl)};
        let raw;
        broker._native={spawn:(...args)=>{
          if(${JSON.stringify(scenario)}==='before-native'){
            fs.writeFileSync(${JSON.stringify(readyPath)},JSON.stringify({pids:[],pending:JSON.parse(fs.readFileSync(${JSON.stringify(journal)})).pending}));
            process.kill(process.pid,'SIGKILL');
          }
          return raw=spawn(...args);
        }};
        const proc=broker.spawn(process.execPath,['-e',${JSON.stringify(target)}],{cwd:${JSON.stringify(workspace)},policy:'allow',linuxSubreaper:{graceMs:50}});
        proc.on('error',()=>{});
        let output='';
        proc.stdout.on('data',chunk=>{
          output+=chunk;
          if(!output.includes('\\n'))return;
          const pids=JSON.parse(output.trim());
          fs.writeFileSync(${JSON.stringify(readyPath)},JSON.stringify({pids}));
          if(${JSON.stringify(scenario)}==='owner-crash')process.kill(process.pid,'SIGKILL');
          else if(${JSON.stringify(scenario)}==='supervisor-loss')raw.kill('SIGKILL');
          else proc.kill('SIGTERM');
        });
        const receipt=await proc.ownedProcessTreeClosed;
        fs.writeFileSync(${JSON.stringify(readyPath)},JSON.stringify({...JSON.parse(fs.readFileSync(${JSON.stringify(readyPath)})),receipt}));`;
        const victim = spawn(
          process.execPath,
          ["--input-type=module", "-e", victimCode],
          { cwd: workspace, env, stdio: ["ignore", "pipe", "pipe"] },
        );
        let stderr = "";
        victim.stderr.on("data", (chunk) => {
          stderr += chunk;
        });
        let ready;
        try {
          const termination = await new Promise((resolve, reject) => {
            victim.once("error", reject);
            victim.once("close", (code, signal) => resolve({ code, signal }));
          });
          expect(stderr).toBe("");
          expect(termination).toEqual(
            ["before-native", "owner-crash"].includes(scenario)
              ? { code: null, signal: "SIGKILL" }
              : { code: 0, signal: null },
          );
          ready = JSON.parse(fs.readFileSync(readyPath, "utf8"));
          const durable = fs.existsSync(journal)
            ? JSON.parse(fs.readFileSync(journal, "utf8"))
            : { pending: [] };
          expect(durable.pending).toHaveLength(
            scenario === "confirmed-close" || deniedBeforeNative ? 0 : 1,
          );
          if (deniedBeforeNative) {
            expect(ready.nativeEntered).toBe(false);
            expect(ready.denial).toBe(
              scenario === "preparation-failure"
                ? "BROKER_PROCESS_OWNERSHIP_JOURNAL_UNAVAILABLE"
                : "EXTERNAL_AGENT_HELPER_UNAVAILABLE",
            );
          }
          if (scenario === "before-native")
            expect(ready.pending).toEqual(durable.pending);
          if (scenario === "supervisor-loss")
            expect(ready.receipt.cleanup.confirmed).toBe(false);
          if (scenario === "confirmed-close")
            expect(ready.receipt.cleanup.confirmed).toBe(true);
          const probeCode = `import broker from ${JSON.stringify(brokerUrl)};
          try{broker.spawnSync(process.execPath,['-e',${JSON.stringify("require('node:fs').writeFileSync(" + JSON.stringify(marker) + ",'executed')")}],{policy:'allow'});console.log(JSON.stringify({started:true}));}
          catch(error){console.log(JSON.stringify({started:false,code:error.code,recoveryRequired:error.recoveryRequired,status:broker.getProcessOwnershipStatus()}));}`;
          const probe = () => {
            const child = spawnSync(
              process.execPath,
              ["--input-type=module", "-e", probeCode],
              {
                cwd: workspace,
                env: {
                  ...env,
                  CHAINLESSCHAIN_HOME: path.join(root, "second-home"),
                },
                encoding: "utf8",
                timeout: 10000,
              },
            );
            expect(child.error).toBeUndefined();
            expect(child.status, child.stderr).toBe(0);
            return JSON.parse(child.stdout);
          };
          const result = probe();
          if (scenario === "confirmed-close" || deniedBeforeNative) {
            expect(result).toEqual({ started: true });
            expect(fs.readFileSync(marker, "utf8")).toBe("executed");
          } else {
            expect(result).toMatchObject({
              started: false,
              code: "BROKER_PROCESS_OWNERSHIP_PENDING",
              recoveryRequired: true,
              status: { blocked: true, durable: true, restartSafe: false },
            });
            expect(fs.existsSync(marker)).toBe(false);
          }
          task.meta.ownershipRestart = {
            scenario,
            termination,
            pending: durable.pending,
            denial: ready.denial ?? null,
            result,
            receipt: ready.receipt ?? null,
          };
          const deadline = Date.now() + 6000;
          while (ready.pids.some(executing) && Date.now() < deadline)
            await new Promise((resolve) => setTimeout(resolve, 25));
          expect(ready.pids.filter(executing)).toEqual([]);
          if (scenario !== "confirmed-close" && !deniedBeforeNative) {
            expect(probe()).toMatchObject({
              started: false,
              code: "BROKER_PROCESS_OWNERSHIP_PENDING",
            });
            expect(JSON.parse(fs.readFileSync(journal)).pending).toEqual(
              durable.pending,
            );
          }
        } finally {
          if (victim.exitCode === null && victim.signalCode === null)
            victim.kill("SIGKILL");
          // Fixtures self-expire; do not kill numeric PIDs or claim journal
          // recovery. Remove only this test-owned authority after the fixture.
          const deadline = Date.now() + 6000;
          while (ready?.pids.some(executing) && Date.now() < deadline)
            await new Promise((resolve) => setTimeout(resolve, 25));
          fs.rmSync(root, { recursive: true, force: true });
        }
      },
      30000,
    );
  },
);
