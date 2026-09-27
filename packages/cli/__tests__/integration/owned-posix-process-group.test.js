import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  inspectPosixProcessGroup,
  spawnOwnedPosixProcessGroup,
} from "../../src/lib/process-execution-broker/owned-posix-process-group.js";

const native = { spawn, spawnSync };
const environment = Object.fromEntries(
  Object.entries(process.env).filter(([, value]) => typeof value === "string"),
);

function start(source, options = {}) {
  return spawnOwnedPosixProcessGroup(
    process.execPath,
    ["-e", source],
    {
      cwd: process.cwd(),
      env: environment,
      graceMs: 100,
      ...options,
    },
    native,
  );
}

async function withTree(rootMode, action) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-owned-group-"));
  const fixture = path.join(root, "tree.cjs");
  fs.writeFileSync(
    fixture,
    `
    const {spawn} = require('node:child_process');
    setTimeout(() => process.exit(0), 5000);
    process.on('SIGTERM', () => { if (process.argv[2] !== 'leaf' && ${JSON.stringify(rootMode)} === 'term-exit') process.exit(0); });
    if (process.argv[2] === 'leaf') {
      process.send({ready:true});
      setInterval(()=>{}, 100);
    } else {
      const child = spawn(process.execPath, [__filename, 'leaf'], {stdio:['ignore','ignore','ignore','ipc']});
      child.once('message', () => {
        process.stdout.write(JSON.stringify({parent:process.pid,leaf:child.pid})+'\\n', () => {
          if (${JSON.stringify(rootMode)} === 'exit') process.exit(0);
        });
      });
    }
  `,
  );
  const owner = spawnOwnedPosixProcessGroup(
    process.execPath,
    [fixture],
    {
      cwd: root,
      env: environment,
      graceMs: 100,
    },
    native,
  );
  let text = "";
  let pids;
  owner.child.stdout.on("data", (chunk) => {
    text += chunk.toString();
    if (!pids && text.includes("\n")) {
      pids = JSON.parse(text.slice(0, text.indexOf("\n")));
      action?.(owner);
    }
  });
  try {
    const receipt = await owner.completion;
    expect(pids, "fixture must reach both actual processes").toBeDefined();
    expect(receipt.cleanup).toMatchObject({
      confirmed: true,
      groupStopped: true,
      processTreeContained: false,
    });
    for (const pid of Object.values(pids)) {
      if (process.platform === "linux") {
        try {
          const raw = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
          expect(["Z", "X"]).toContain(raw.slice(raw.lastIndexOf(")") + 2)[0]);
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
      } else {
        const probe = spawnSync("/bin/ps", ["-p", String(pid), "-o", "stat="], {
          encoding: "utf8",
        });
        expect(probe.error).toBeUndefined();
        expect(
          probe.stdout.trim() === "" || /^[ZX]/.test(probe.stdout.trim()),
        ).toBe(true);
      }
    }
    return receipt;
  } finally {
    owner.terminate("SIGKILL");
    await owner.completion;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe.skipIf(process.platform === "win32")(
  "owned POSIX group: real processes",
  () => {
    it("preserves exact stdout, Unicode argv/environment and successful target exit", async () => {
      const owner = spawnOwnedPosixProcessGroup(
        process.execPath,
        [
          "-e",
          "process.stdout.write(process.argv[1] + process.env.CC_GROUP_VALUE)",
          "中文😀",
        ],
        {
          cwd: process.cwd(),
          env: { ...environment, CC_GROUP_VALUE: "完成" },
          graceMs: 10,
        },
        native,
      );
      const chunks = [];
      owner.child.stdout.on("data", (chunk) => chunks.push(chunk));
      const result = await owner.completion;
      expect(Buffer.concat(chunks).toString()).toBe("中文😀完成");
      expect(result.target).toEqual({
        code: 0,
        signal: null,
        spawnError: null,
      });
      expect(result.cleanup.confirmed).toBe(true);
    });

    it("decodes a multi-chunk Unicode launch without changing target arguments", async () => {
      const value = "中文😀".repeat(8000);
      const owner = spawnOwnedPosixProcessGroup(
        process.execPath,
        ["-e", "process.stdout.write(process.argv[1])", value],
        {
          cwd: process.cwd(),
          env: environment,
          graceMs: 10,
        },
        native,
      );
      const chunks = [];
      owner.child.stdout.on("data", (chunk) => chunks.push(chunk));
      const receipt = await owner.completion;
      expect(Buffer.concat(chunks).toString()).toBe(value);
      expect(receipt.target.code).toBe(0);
      expect(receipt.cleanup.confirmed).toBe(true);
    });

    it("cleans an ignoring descendant after the original root exits normally", async () => {
      const result = await withTree("exit");
      expect(result.target.code).toBe(0);
    });

    it("keeps the group leader alive when the root exits on TERM", async () => {
      const result = await withTree("term-exit", (owner) => owner.terminate());
      expect(result.target.code).toBe(0);
    });

    it("cleans two TERM-ignoring processes after repeated cancellation", async () => {
      await withTree("ignore", (owner) => {
        expect(owner.terminate()).toBe(true);
        expect(owner.terminate()).toBe(true);
        expect(owner.terminate()).toBe(true);
      });
    });

    it("forwards hard cancellation through the living group owner", async () => {
      await withTree("ignore", (owner) => owner.terminate("SIGKILL"));
    });

    it("does not load target NODE_OPTIONS into the supervisor", async () => {
      const owner = start("process.exit(0)", {
        env: {
          ...environment,
          NODE_OPTIONS: "--require=/missing-cc-group-module.cjs",
        },
      });
      owner.child.stderr.resume();
      const result = await owner.completion;
      expect(result.target.code).not.toBe(0);
      expect(result.cleanup.confirmed).toBe(true);
    });

    it("reports missing executables and still confirms group cleanup", async () => {
      const owner = spawnOwnedPosixProcessGroup(
        "/missing-cc-group-executable",
        [],
        {
          cwd: process.cwd(),
          env: environment,
          graceMs: 10,
        },
        native,
      );
      const result = await owner.completion;
      expect(result.target.spawnError).toBe("ENOENT");
      expect(result.cleanup.confirmed).toBe(true);
    });

    it("cleans on a lost caller lifeline without inventing a control receipt", async () => {
      const owner = start(
        "process.on('SIGTERM',()=>{}); console.log('ready'); setTimeout(()=>process.exit(0), 5000)",
      );
      owner.child.stdout.once("data", () => owner.child.stdio[3].destroy());
      const result = await owner.completion;
      expect(result.cleanup.groupStopped).toBe(true);
      expect(result.cleanup.confirmed).toBe(false);
    });

    it("reports only group cleanup when a descendant escapes with a new session", async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-group-escape-"));
      const fixture = path.join(root, "escape.cjs");
      fs.writeFileSync(
        fixture,
        `
        const {spawn}=require('node:child_process');
        if (process.argv[2] === 'leaf') {
          process.send({ready:true});
          setTimeout(()=>process.exit(0), 5000);
        } else {
          const child=spawn(process.execPath,[__filename,'leaf'],{detached:true,stdio:['ignore','ignore','ignore','ipc']});
          child.once('message',()=>process.stdout.write(String(child.pid)+'\\n',()=>process.exit(0)));
        }
      `,
      );
      const owner = spawnOwnedPosixProcessGroup(
        process.execPath,
        [fixture],
        {
          cwd: root,
          env: environment,
          graceMs: 100,
        },
        native,
      );
      let output = "";
      owner.child.stdout.on("data", (chunk) => {
        output += chunk;
      });
      let escapedPid;
      try {
        const receipt = await owner.completion;
        escapedPid = Number(output.trim());
        expect(Number.isSafeInteger(escapedPid) && escapedPid > 0).toBe(true);
        expect(receipt.cleanup).toMatchObject({
          confirmed: true,
          groupStopped: true,
          processTreeContained: false,
        });
        const escapedStates = inspectPosixProcessGroup(escapedPid, {
          platform: process.platform,
          spawnSync,
        });
        expect(escapedStates).not.toBeNull();
        expect(escapedStates.some((state) => !["Z", "X"].includes(state))).toBe(
          true,
        );
      } finally {
        owner.terminate("SIGKILL");
        await owner.completion;
        // The counterexample is lifetime-bounded; do not signal a stale PID.
        const deadline = Date.now() + 6000;
        while (escapedPid && Date.now() < deadline) {
          const states = inspectPosixProcessGroup(escapedPid, {
            platform: process.platform,
            spawnSync,
          });
          if (states && states.every((state) => ["Z", "X"].includes(state)))
            break;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        if (escapedPid) {
          const finalStates = inspectPosixProcessGroup(escapedPid, {
            platform: process.platform,
            spawnSync,
          });
          expect(finalStates).not.toBeNull();
          expect(finalStates.every((state) => ["Z", "X"].includes(state))).toBe(
            true,
          );
        }
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    it("never sends signals through an exited leader's numeric identity", async () => {
      const owner = start("process.exit(0)");
      const result = await owner.completion;
      expect(result.cleanup.confirmed).toBe(true);
      expect(owner.terminate()).toBe(false);
      expect(owner.terminate("SIGKILL")).toBe(false);
      expect(
        inspectPosixProcessGroup(-1, { platform: process.platform, spawnSync }),
      ).toBeNull();
    });
  },
);
