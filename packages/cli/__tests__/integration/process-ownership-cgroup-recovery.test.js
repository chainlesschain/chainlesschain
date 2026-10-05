import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { ProcessOwnershipJournal } from "../../src/lib/process-execution-broker/process-ownership-journal.js";
import {
  prepareRecoveryCgroup,
  openRecoveryCgroup,
} from "../../src/lib/process-execution-broker/process-recovery-cgroup.js";

const delegated = process.env.CHAINLESSCHAIN_PROCESS_RECOVERY_CGROUP_ROOT;
const recoveryEvidence = [];
const required =
  process.env.CHAINLESSCHAIN_REQUIRE_CGROUP_RECOVERY_TEST === "1";
const eligible = process.platform === "linux" && Boolean(delegated);
if (required && !eligible)
  throw new Error(
    "Required cgroup recovery probe needs Linux and an explicitly delegated cgroup2 root",
  );
const brokerUrl = new URL(
  "../../src/lib/process-execution-broker/index.js",
  import.meta.url,
).href;
const executing = (pid) => {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    return !["Z", "X"].includes(stat.slice(stat.lastIndexOf(")") + 2)[0]);
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
};

describe.skipIf(!eligible)("real delegated cgroup2 restart recovery", () => {
  afterAll(() => {
    const output = process.env.CHAINLESSCHAIN_CGROUP_RECOVERY_EVIDENCE;
    if (!output) return;
    fs.writeFileSync(
      output,
      JSON.stringify(
        {
          schema: "chainlesschain.process-cgroup-recovery-evidence/v1",
          sourceHead: process.env.EXPECTED_COMMIT || null,
          platform: process.platform,
          arch: process.arch,
          node: process.version,
          delegatedRoot: delegated,
          status: recoveryEvidence.length === 2 ? "passed" : "incomplete",
          scenarios: recoveryEvidence,
          sameUidHostileConfinement: false,
        },
        null,
        2,
      ) + "\n",
    );
  });
  it("recovers live escaped-session descendants after supervisor loss in a fresh Broker without replaying the task", ({
    task,
  }) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-cgroup-restart-"));
    const workspace = path.join(root, "workspace");
    fs.mkdirSync(workspace);
    const marker = path.join(root, "task-starts"),
      ready = path.join(root, "ready.json");
    const anchor = path.join(root, "anchor"),
      journal = path.join(anchor, "process-ownership-v1/journal.json");
    const env = {
      ...process.env,
      CHAINLESSCHAIN_SECURITY_ANCHOR_HOME: anchor,
      CHAINLESSCHAIN_HOME: path.join(root, "home"),
    };
    let identity, id;
    const run = (code) => {
      const result = spawnSync(
        process.execPath,
        ["--input-type=module", "--eval", code],
        { cwd: workspace, env, encoding: "utf8", timeout: 30000 },
      );
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
      return result.stdout.trim() ? JSON.parse(result.stdout.trim()) : null;
    };
    try {
      const target = `const fs=require('node:fs');const {spawn}=require('node:child_process');fs.appendFileSync(${JSON.stringify(marker)},'started\\n');const leaf=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setTimeout(()=>{},25000)"],{detached:true,stdio:'ignore'});process.stdout.write(JSON.stringify([process.pid,leaf.pid])+'\\n');process.on('SIGTERM',()=>{});setTimeout(()=>{},25000);`;
      run(`import fs from 'node:fs';import {spawn} from 'node:child_process';import broker from ${JSON.stringify(brokerUrl)};
        let raw;broker._native={spawn:(...args)=>raw=spawn(...args)};
        const proc=broker.spawn(process.execPath,['-e',${JSON.stringify(target)}],{cwd:${JSON.stringify(workspace)},policy:'allow',linuxSubreaper:{graceMs:20}});proc.on('error',()=>{});
        // Descendants keep the target pipes open after supervisor loss. Drop
        // this fixture owner's read ends only after observing the killed
        // supervisor, so the unconfirmed receipt precedes target self-expiry.
        raw.once('exit',(_code,signal)=>{if(signal==='SIGKILL'){raw.stdout.destroy();raw.stderr.destroy();}});
        let output='';proc.stdout.on('data',chunk=>{output+=chunk;if(output.includes('\\n')){fs.writeFileSync(${JSON.stringify(ready)},output.trim());raw.kill('SIGKILL');}});
        const receipt=await proc.ownedProcessTreeClosed;if(receipt.cleanup.confirmed)throw Error('expected lost supervisor');process.exit(0);`);
      const state = JSON.parse(fs.readFileSync(journal));
      expect(state.pending).toHaveLength(1);
      ({ executionId: id, recovery: identity } = state.pending[0]);
      const pids = JSON.parse(fs.readFileSync(ready));
      expect(pids.every(executing)).toBe(true);
      const status = run(
        `import broker from ${JSON.stringify(brokerUrl)};console.log(JSON.stringify(broker.getProcessOwnershipStatus()));`,
      );
      expect(status).toMatchObject({
        blocked: true,
        recoverableExecutionIds: [id],
        restartSafe: false,
      });
      const receipt = run(
        `import broker from ${JSON.stringify(brokerUrl)};const receipt=await broker.recoverProcessOwnership(${JSON.stringify(id)});const child=broker.spawnSync(process.execPath,['-e','process.exit(0)'],{policy:'allow'});if(child.status!==0)throw Error('admission did not reopen');console.log(JSON.stringify(receipt));`,
      );
      expect(receipt).toMatchObject({
        cleanupConfirmed: true,
        executionResumed: false,
        killIssued: true,
        populated: false,
      });
      expect(pids.some(executing)).toBe(false);
      expect(fs.readFileSync(marker, "utf8")).toBe("started\n");
      const settled = JSON.parse(fs.readFileSync(journal));
      expect(settled.pending).toEqual([]);
      expect(settled.recoveries).toHaveLength(1);
      task.meta.cgroupRecovery = { before: state.pending[0], receipt, settled };
      recoveryEvidence.push({
        name: "owner-loss-kills-descendants-without-replay",
        ...task.meta.cgroupRecovery,
      });
    } finally {
      if (identity) {
        try {
          const group = openRecoveryCgroup(identity, id);
          group.kill();
          group.close();
        } catch {
          /* Recovered groups were removed. Fixtures also self-expire. */
        }
      }
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 45000);

  it("retains old records and rejects boot/object drift; failed durable publication keeps its recoverable kernel object", async ({
    task,
  }) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-cgroup-journal-"));
    let group;
    try {
      const legacy = new ProcessOwnershipJournal(path.join(root, "legacy"));
      const oldId = randomUUID();
      legacy.prepare(oldId).retain();
      await expect(
        new ProcessOwnershipJournal(path.join(root, "legacy")).recover(oldId),
      ).rejects.toThrow(/no recoverable/);
      expect(legacy.inspect().pendingExecutionIds).toEqual([oldId]);
      const id = randomUUID();
      group = prepareRecoveryCgroup(id, delegated);
      const identity = group.identity;
      expect(() =>
        openRecoveryCgroup({ ...identity, bootId: randomUUID() }, id),
      ).toThrow(/boot identity/);
      expect(() =>
        openRecoveryCgroup(
          { ...identity, ino: String(BigInt(identity.ino) + 1n) },
          id,
        ),
      ).toThrow(/identity changed/);
      const directory = path.join(root, "recoverable");
      new ProcessOwnershipJournal(directory).prepare(id, identity).retain();
      const rename = vi.spyOn(fs, "renameSync").mockImplementation(() => {
        throw new Error("injected publication failure");
      });
      try {
        await expect(
          new ProcessOwnershipJournal(directory).recover(id),
        ).rejects.toThrow(/unavailable/);
      } finally {
        rename.mockRestore();
      }
      expect(fs.existsSync(path.join(identity.root, identity.name))).toBe(true);
      expect(
        JSON.parse(fs.readFileSync(path.join(directory, "journal.json")))
          .pending[0].executionId,
      ).toBe(id);
      const receipt = await new ProcessOwnershipJournal(directory).recover(id);
      expect(receipt.cleanupConfirmed).toBe(true);
      task.meta.cgroupRecovery = {
        legacyStillPending: oldId,
        publicationRetry: receipt,
      };
      group.close();
      group = null;
      recoveryEvidence.push({
        name: "legacy-drift-and-publication-failure",
        ...task.meta.cgroupRecovery,
      });
    } finally {
      vi.restoreAllMocks();
      if (group) {
        try {
          group.kill();
          group.close({ remove: true });
        } catch {
          group.close();
        }
      }
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
