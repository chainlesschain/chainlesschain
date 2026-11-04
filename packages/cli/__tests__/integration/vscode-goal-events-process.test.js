import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
const require = createRequire(import.meta.url);
const {
  startGoalWatch,
} = require("../../../vscode-extension/src/goal-events.js");

describe("VS Code event observer real process lifecycle", () => {
  it.each(["stop", "invalid", "end"])(
    "runs a real protocol child through %s and confirms closure",
    async (mode) => {
      const directory = fs.mkdtempSync(
        path.join(os.tmpdir(), "cc-vscode-goal-events-"),
      );
      const script = path.join(directory, "fixture.cjs");
      fs.writeFileSync(
        script,
        `
const ref={id:'goal-1',storeId:'project-goals-12345678-1234-1234-1234-123456789abc',revision:2,controlGeneration:1};
const base={schema:'chainlesschain.goal-extension-stream/v1',source:'desktop-project',plugin:{name:'observer',scope:'project',version:'0.1.0'},observedAt:'2026-11-04T12:00:00.000Z',delivery:'polling',replay:false};
process.stderr.write('NEVER DISPLAY raw stderr');
if(${JSON.stringify(mode)}==='invalid')console.log(JSON.stringify({key:'NEVER DISPLAY secret'}));
else {console.log(JSON.stringify({...base,kind:'ready',goalRef:ref}));console.log(JSON.stringify({...base,kind:'event',event:{type:'risk.review.completed',goalRef:ref,summary:'Real child observation',occurredAt:base.observedAt}}));}
if(${JSON.stringify(mode)}!=='end')setInterval(()=>{},1000);
`,
      );
      let owned;
      let observed;
      const ready = new Promise((resolve) => {
        observed = resolve;
      });
      const records = [];
      const watch = startGoalWatch({
        command: process.execPath,
        cwd: directory,
        input: {
          id: "goal-1",
          name: "observer",
          scope: "project",
          connection: path.join(directory, "selected connection.json"),
        },
        onRecord: (record) => {
          records.push(record);
          if (record.kind === "event") observed();
        },
        onEnd: () => {},
        deps: {
          spawn(command, args, options) {
            if (command === process.execPath) {
              owned = spawn(command, [script, ...args], {
                ...options,
                shell: false,
              });
              return owned;
            }
            return spawn(command, args, options);
          },
        },
      });
      try {
        if (mode === "stop") {
          await ready;
          expect(owned.exitCode).toBeNull();
          await watch.stop();
        }
        expect(await watch.completion).toBe(
          mode === "stop"
            ? "stopped"
            : mode === "invalid"
              ? "unavailable"
              : "ended",
        );
        expect(owned.exitCode !== null || owned.signalCode !== null).toBe(true);
        expect(JSON.stringify(records)).not.toContain("NEVER DISPLAY");
        expect(records).toHaveLength(mode === "invalid" ? 0 : 2);
      } finally {
        await watch.stop();
        fs.rmSync(directory, { recursive: true, force: true });
      }
    },
    15000,
  );
});
