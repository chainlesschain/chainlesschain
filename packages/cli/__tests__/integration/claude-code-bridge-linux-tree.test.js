import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  ClaudeAdapter,
  ClaudeCodeAgent,
  _deps,
} from "../../src/lib/claude-code-bridge.js";
import broker from "../../src/lib/process-execution-broker/index.js";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
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
  "production Bridge and Broker Linux tree ownership",
  () => {
    it.for([
      "same-group",
      "detached",
      "root-exit",
      "root-term-exit",
      "double-fork",
      "timeout",
      "post-spawn-error",
      "supervisor-loss",
    ])(
      "retains ownership through %s",
      async (scenario, { task }) => {
        const root = fs.mkdtempSync(
          path.join(os.tmpdir(), "cc-bridge-linux-tree-"),
        );
        const readyPath = path.join(root, "ready.json");
        const fixture = path.join(root, "tree.cjs");
        fs.writeFileSync(
          fixture,
          `
      const {spawn}=require('node:child_process');
      const fs=require('node:fs');
      const role=process.argv[2]||'root';
      setTimeout(()=>process.exit(0),6000);
      process.on('SIGTERM',()=>{if(role==='root'&&${scenario === "root-term-exit"})process.exit(0)});
      if(role==='leaf') process.send({pids:[process.pid]});
      else {
        const child=spawn(process.execPath,[__filename,role==='root'&&${scenario === "double-fork"}?'middle':'leaf'],{detached:${scenario !== "same-group"},stdio:['ignore','ignore','ignore','ipc']});
        child.once('message',message=>{
          const pids=[process.pid,...message.pids];
          if(role==='middle') process.send({pids},()=>process.exit(0));
          else {
            const ready=()=>{
              fs.writeFileSync(${JSON.stringify(readyPath)},JSON.stringify(pids));
              process.stdout.write(JSON.stringify({type:'system',fixturePids:pids})+'\\n',()=>{
                if(${scenario === "root-exit"}) process.stdout.write(JSON.stringify({type:'result',subtype:'success',result:'done'})+'\\n',()=>process.exit(0));
              });
            };
            if(${scenario === "double-fork"}) child.once('close',ready); else ready();
          }
        });
      }
    `,
        );
        const originalSpawn = _deps.spawn;
        const originalHook = broker._emitHooksEvent;
        const originalNative = broker._native;
        let raw;
        let child;
        let pids;
        let readyAt;
        let observedClose = false;
        let output = "";
        let outcome;
        const adapter = new ClaudeAdapter({ command: process.execPath });
        adapter.buildArgs = () => [fixture];
        const agent = new ClaudeCodeAgent({ adapter });
        const completed = vi.fn();
        agent.on("task:complete", completed);
        broker._native = {
          ...originalNative,
          spawn: (...args) => (raw = spawn(...args)),
        };
        broker._emitHooksEvent = function (event, payload) {
          if (
            scenario === "post-spawn-error" &&
            event === "tool:start" &&
            payload.component === "claude-code-bridge:agent"
          ) {
            // Let the real target create descendants before injecting the existing
            // synchronous bookkeeping failure. No spawn or sandbox plan is faked.
            const deadline = Date.now() + 3000;
            while (!fs.existsSync(readyPath) && Date.now() < deadline)
              Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
            pids = JSON.parse(fs.readFileSync(readyPath, "utf8"));
            readyAt = performance.now();
            throw new Error(
              "fixture bookkeeping failed after descendants started",
            );
          }
          return originalHook.call(this, event, payload);
        };
        _deps.spawn = (...args) => {
          try {
            child = originalSpawn(...args);
          } catch (error) {
            child = error.spawnedProcess;
            throw error;
          } finally {
            child?.once("close", () => {
              observedClose = true;
            });
          }
          return child;
        };
        agent.on("output", ({ chunk }) => {
          output += chunk;
          if (pids || !output.includes("\n")) return;
          pids = JSON.parse(output.split("\n")[0]).fixturePids;
          readyAt = performance.now();
          if (scenario === "supervisor-loss") raw.kill("SIGKILL");
          else if (!["root-exit", "timeout"].includes(scenario)) {
            agent.abort();
            agent.abort();
          }
        });
        try {
          const pending = agent.executeTask("synthetic tree", {
            cwd: root,
            timeout: scenario === "timeout" ? 2000 : 15000,
            killGraceMs: 100,
          });
          // On an unconfirmed cleanup the bridge intentionally stays occupied;
          // await the owner's diagnostic receipt, not a fabricated task terminal.
          const receipt = await child.ownedProcessTreeClosed;
          const audit = broker
            .getAuditLog()
            .findLast((entry) => entry.pid === child.pid);
          expect(audit.processLifecycleOwner).toBe("linux-subreaper");
          expect(audit.sandboxBackend).toBe("linux-prlimit");
          expect(audit.sandboxGuarantees).not.toContain("process-tree");
          expect(pids).toHaveLength(scenario === "double-fork" ? 3 : 2);
          const elapsedAfterReadyMs = performance.now() - readyAt;
          task.meta.bridgeTree = {
            scenario,
            pids,
            receipt,
            elapsedAfterReadyMs,
            sandboxBackend: audit.sandboxBackend,
            sandboxGuarantees: audit.sandboxGuarantees,
          };
          if (scenario === "supervisor-loss") {
            expect(receipt.cleanup.confirmed).toBe(false);
            expect(pids.some(executing)).toBe(true);
            expect(observedClose).toBe(false);
            expect(completed).not.toHaveBeenCalled();
            expect(agent.status).toBe("running");
            await expect(
              agent.executeTask("must remain owned"),
            ).rejects.toThrow("already has a running task");
            agent.abort();
          } else {
            outcome = await pending;
            task.meta.bridgeTree.result = outcome;
            expect(receipt.helper.binding).toBe("unlinked-inherited-fd");
            expect(receipt.cleanup.confirmed).toBe(true);
            expect(receipt.cleanup.processTreeContained).toBe(false);
            expect(pids.filter(executing)).toEqual([]);
            for (const pid of pids)
              expect(fs.existsSync(`/proc/${pid}`)).toBe(false);
            expect(observedClose).toBe(true);
            expect(elapsedAfterReadyMs).toBeLessThan(
              scenario === "timeout" ? 4000 : 2000,
            );
            expect(completed).toHaveBeenCalledOnce();
            if (scenario === "post-spawn-error")
              expect(outcome.errorCode).toBe("EXTERNAL_AGENT_SPAWN_FAILED");
            else if (scenario === "timeout")
              expect(outcome.timedOut).toBe(true);
            else if (scenario === "root-exit")
              expect(outcome.success).toBe(true);
            else expect(outcome.cancelled).toBe(true);
          }
        } finally {
          agent.abort();
          child?.kill("SIGKILL");
          _deps.spawn = originalSpawn;
          broker._emitHooksEvent = originalHook;
          broker._native = originalNative;
          // The loss counterexample uses a bounded fixture, never a delayed PID
          // signal that could hit an unrelated process after PID reuse.
          const deadline = Date.now() + 7000;
          while (pids?.some(executing) && Date.now() < deadline)
            await delay(25);
          if (pids) expect(pids.filter(executing)).toEqual([]);
          fs.rmSync(root, { recursive: true, force: true });
        }
      },
      20000,
    );
  },
);
