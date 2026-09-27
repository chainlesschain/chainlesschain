import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { spawnLinuxSubreaper } from "../../src/lib/process-execution-broker/linux-subreaper-process.js";

const source = fileURLToPath(
  new URL(
    "../../src/lib/process-execution-broker/linux-subreaper-supervisor.c",
    import.meta.url,
  ),
);
const environment = Object.fromEntries(
  Object.entries(process.env).filter(([, value]) => typeof value === "string"),
);
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
  "Linux subreaper: real adopted descendants",
  () => {
    let root;
    let helperPath;
    let build;
    let receipts;
    beforeAll(() => {
      root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-subreaper-tests-"));
      helperPath = path.join(root, "supervisor");
      const built = spawnSync(
        "/usr/bin/cc",
        [
          "-std=c11",
          "-Wall",
          "-Wextra",
          "-Werror",
          "-O2",
          "-fstack-protector-strong",
          "-D_FORTIFY_SOURCE=2",
          source,
          "-o",
          helperPath,
        ],
        { encoding: "utf8", timeout: 30000 },
      );
      expect(built.error).toBeUndefined();
      expect(built.status, built.stderr).toBe(0);
      const digest = (file) =>
        "sha256:" +
        crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
      build = {
        sourceDigest: digest(source),
        binaryDigest: digest(helperPath),
        platform: process.platform,
        arch: process.arch,
      };
    });
    beforeEach(({ task }) => {
      receipts = [];
      task.meta.subreaperBuild = build;
      task.meta.lifecycleReceipts = receipts;
    });
    afterAll(() => {
      if (root) fs.rmSync(root, { recursive: true, force: true });
    });

    function launch(command, args, options = {}) {
      return spawnLinuxSubreaper(
        command,
        args,
        { helperPath, cwd: root, env: environment, graceMs: 100, ...options },
        { spawn },
      );
    }

    async function tree({
      exit = false,
      termExit = false,
      detached = true,
      doubleFork = false,
      action = "term",
    } = {}) {
      const fixture = path.join(
        root,
        "tree-" + Math.random().toString(36).slice(2) + ".cjs",
      );
      fs.writeFileSync(
        fixture,
        `
      const {spawn}=require('node:child_process');
      const role=process.argv[2]||'root';
      setTimeout(()=>process.exit(0),5000);
      process.on('SIGTERM',()=>{if(role==='root'&&${termExit})process.exit(0)});
      if(role==='leaf'){process.send({ready:true,pids:[process.pid]})}
      else {
        const child=spawn(process.execPath,[__filename,role==='root'&&${doubleFork}?'middle':'leaf'],{detached:${detached},stdio:['ignore','ignore','ignore','ipc']});
        child.once('message',message=>{
          const pids=[process.pid,...message.pids];
          if(role==='middle'){process.send({ready:true,pids},()=>process.exit(0));}
          else {
            const publish=()=>process.stdout.write(JSON.stringify(pids)+'\\n',()=>{if(${exit})process.exit(0)});
            if(${doubleFork}) child.once('close',publish);
            else publish();
          }
        });
      }
    `,
      );
      const owner = launch(process.execPath, [fixture]);
      let output = "";
      let pids;
      let readyAt;
      owner.child.stdout.on("data", (chunk) => {
        output += chunk;
        if (!pids && output.includes("\n")) {
          pids = JSON.parse(output.trim());
          readyAt = performance.now();
          if (action === "term") {
            owner.terminate();
            owner.terminate();
          }
          if (action === "kill") owner.terminate("SIGKILL");
          if (action === "disconnect") owner.child.stdio[3].destroy();
          if (action === "supervisor-killed") owner.child.kill("SIGKILL");
        }
      });
      try {
        const receipt = await owner.completion;
        const elapsedAfterReadyMs = performance.now() - readyAt;
        receipts.push({ pids, receipt, elapsedAfterReadyMs });
        expect(pids, "fixture must spawn the descendants").toBeDefined();
        expect(pids).toHaveLength(doubleFork ? 3 : 2);
        // A broken cancellation path must not pass by waiting for the fixture's
        // five-second emergency exit. Startup time is excluded from this bound.
        expect(elapsedAfterReadyMs).toBeLessThan(2000);
        if (action === "supervisor-killed") {
          expect(receipt.cleanup.confirmed).toBe(false);
          expect(pids.some(executing)).toBe(true);
        } else {
          expect(receipt.cleanup.confirmed).toBe(action !== "disconnect");
          // In the double-fork fixture Node has already reaped the middle
          // process before publishing readiness. The supervisor owns and
          // reaps the root plus adopted leaf; all three must be absent below.
          expect(receipt.cleanup.reaped).toBe(
            action === "disconnect" ? null : 2,
          );
          expect(pids.filter(executing)).toEqual([]);
          for (const pid of pids)
            expect(fs.existsSync(`/proc/${pid}`)).toBe(false);
        }
        expect(owner.terminate("SIGKILL")).toBe(false);
        return receipt;
      } finally {
        owner.terminate("SIGKILL");
        await owner.completion;
        // The supervisor-death counterexample is bounded by fixture lifetimes.
        // Do not attempt a delayed numeric PID signal during test cleanup.
        const deadline = Date.now() + 6000;
        while (pids?.some(executing) && Date.now() < deadline) await delay(50);
        if (pids) expect(pids.filter(executing)).toEqual([]);
      }
    }

    it("preserves multi-chunk Unicode args/environment and ordinary target exit", async () => {
      const value = "中文😀".repeat(8000);
      const owner = launch(
        process.execPath,
        [
          "-e",
          "process.stdout.write(process.argv[1]+process.env.CC_SUBREAPER_VALUE)",
          value,
        ],
        { env: { ...environment, CC_SUBREAPER_VALUE: "完成" } },
      );
      let output = "";
      owner.child.stdout.setEncoding("utf8");
      owner.child.stdout.on("data", (chunk) => {
        output += chunk;
      });
      const result = await owner.completion;
      expect(output).toBe(value + "完成");
      expect(result.target).toEqual({ code: 0, signal: 0, spawnErrno: 0 });
      expect(result.cleanup).toMatchObject({
        confirmed: true,
        descendantsReaped: true,
        reaped: 1,
        processTreeContained: false,
      });
    });

    it("cleans a TERM-ignoring parent and child in the same group", async () => {
      await tree({ detached: false });
    });
    it("cleans a TERM-ignoring descendant in a separate session", async () => {
      await tree();
    });
    it("cleans detached descendants after root exits normally", async () => {
      const receipt = await tree({ exit: true, action: "none" });
      expect(receipt.target.code).toBe(0);
    });
    it("cleans detached descendants after root exits on TERM", async () => {
      const receipt = await tree({ termExit: true });
      expect(receipt.target.code).toBe(0);
    });
    it("adopts the double-forked leaf after its intermediary was reaped by the root", async () => {
      await tree({ doubleFork: true });
    });
    it("cleans all adopted descendants on a hard cancel", async () => {
      await tree({ doubleFork: true, action: "kill" });
    });
    it("cleans when the caller lifeline disappears without claiming a lost receipt", async () => {
      await tree({ action: "disconnect" });
    });
    it("does not claim cleanup after its supervisor is killed externally", async () => {
      await tree({ action: "supervisor-killed" });
    });

    it("reports an actual exec failure while confirming no descendants remain", async () => {
      const owner = launch("/missing-cc-subreaper-executable", []);
      const receipt = await owner.completion;
      expect(receipt.target).toMatchObject({ code: 127, spawnErrno: 2 });
      expect(receipt.cleanup.confirmed).toBe(true);
    });

    it("does not claim cleanup when the native helper itself cannot start", async () => {
      const owner = launch(process.execPath, ["-e", "process.exit(0)"], {
        helperPath: path.join(root, "missing-supervisor"),
      });
      const receipt = await owner.completion;
      expect(receipt.targetPid).toBeNull();
      expect(receipt.cleanup.confirmed).toBe(false);
      expect(receipt.cleanup.protocolError).not.toBeNull();
    });

    it("does not invoke a shell for an executable file without a valid format", async () => {
      const executable = path.join(root, "not-a-binary");
      fs.writeFileSync(executable, "touch unapproved-shell-marker\n", {
        mode: 0o700,
      });
      const owner = launch(executable, []);
      const receipt = await owner.completion;
      expect(receipt.target.spawnErrno).toBe(8);
      expect(receipt.cleanup.confirmed).toBe(true);
      expect(fs.existsSync(path.join(root, "unapproved-shell-marker"))).toBe(
        false,
      );
    });

    it("keeps stdin/stdout separate from cleanup control messages", async () => {
      const owner = launch(process.execPath, [
        "-e",
        "process.stdin.pipe(process.stdout)",
      ]);
      const content =
        '{"type":"cleanup","confirmed":true,"reaped":999}\n' +
        "payload".repeat(10000);
      let output = "";
      owner.child.stdout.on("data", (chunk) => {
        output += chunk;
      });
      owner.child.stdin.end(content);
      const receipt = await owner.completion;
      expect(output).toBe(content);
      expect(receipt.cleanup.reaped).toBe(1);
      expect(receipt.cleanup.confirmed).toBe(true);
    });
  },
);
