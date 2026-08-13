import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fork } from "node:child_process";
import { Worker } from "node:worker_threads";
import { afterEach, describe, expect, it } from "vitest";
import {
  DurableSkillExecutionAuthority,
  getSkillExecutionAuthorityPath,
  SKILL_EXECUTION_AUTHORITY_ROLLBACK_CODE,
  SKILL_EXECUTION_AUTHORITY_UNAVAILABLE_CODE,
} from "../../src/lib/skill-execution-authority.js";

const fixtureUrl = new URL(
  "../fixtures/skill-execution-authority-host.mjs",
  import.meta.url,
);
const roots = [];
const hosts = new Set();

function createAuthorityPath() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-skill-authority-"));
  roots.push(root);
  return path.join(root, "state", "skill-execution-authority.json");
}

function acknowledgeTerminalMessage(host, message) {
  if (typeof message?.terminalAckId !== "string") return Promise.resolve();
  const acknowledgement = {
    type: "terminal-ack",
    terminalAckId: message.terminalAckId,
  };
  if (host instanceof Worker) {
    try {
      host.postMessage(acknowledgement);
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(error);
    }
  }
  return new Promise((resolve, reject) => {
    if (!host.connected) {
      reject(
        new Error("Skill authority fixture IPC channel closed before ACK"),
      );
      return;
    }
    host.send(acknowledgement, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function waitForMessage(host, predicate, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    let terminalMessage = null;
    let settled = false;
    const timer = setTimeout(() => {
      settle(
        reject,
        new Error("Timed out waiting for Skill authority fixture"),
      );
    }, timeoutMs);
    const onMessage = (message) => {
      const fixtureFailed = message?.type === "error";
      if (!fixtureFailed && !predicate(message)) return;
      if (typeof message?.terminalAckId !== "string") {
        settle(fixtureFailed ? reject : resolve, fixtureResult(message));
        return;
      }
      if (terminalMessage) return;
      terminalMessage = message;
      void acknowledgeTerminalMessage(host, message).then(
        () => {},
        (error) => {
          settle(reject, error);
        },
      );
    };
    const onError = (error) => {
      settle(reject, error);
    };
    const onExit = (code) => {
      if (code !== 0 || !terminalMessage) {
        settle(
          reject,
          new Error(`Skill authority fixture exited early (${code})`),
        );
        return;
      }
      const fixtureFailed = terminalMessage.type === "error";
      settle(fixtureFailed ? reject : resolve, fixtureResult(terminalMessage));
    };
    const fixtureResult = (message) => {
      if (message?.type !== "error") return message;
      const error = new Error(
        message.message || "Skill authority fixture failed",
      );
      if (message.code) error.code = message.code;
      return error;
    };
    const settle = (handler, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      handler(value);
    };
    const cleanup = () => {
      clearTimeout(timer);
      host.off("message", onMessage);
      host.off("error", onError);
      host.off("exit", onExit);
    };
    host.on("message", onMessage);
    host.on("error", onError);
    host.on("exit", onExit);
  });
}

function spawnChild(filePath, command = "active") {
  const child = fork(fixtureUrl, [filePath, command], {
    execArgv: [],
    silent: true,
  });
  hosts.add(child);
  child.once("exit", () => hosts.delete(child));
  return child;
}

async function stopHost(host) {
  if (!hosts.has(host)) return;
  const stopped = waitForMessage(
    host,
    (message) => message?.type === "stopped",
  );
  host.postMessage?.("shutdown") || host.send?.("shutdown");
  await stopped;
  hosts.delete(host);
  if (host instanceof Worker) await host.terminate();
}

afterEach(async () => {
  for (const host of [...hosts]) {
    if (host instanceof Worker) {
      await host.terminate();
    } else {
      host.kill();
    }
    hosts.delete(host);
  }
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("durable Skill execution authority", () => {
  it("revokes leases across different CLI state roots through one machine authority", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-skill-multi-home-"));
    roots.push(root);
    const firstHome = path.join(root, "home-a");
    const secondHome = path.join(root, "home-b");
    const machineAuthority = path.join(root, "machine-security-state");
    const originalHome = process.env.CHAINLESSCHAIN_HOME;
    const originalMachineAuthority =
      process.env.CHAINLESSCHAIN_SECURITY_ANCHOR_HOME;
    let lease;
    try {
      process.env.CHAINLESSCHAIN_HOME = firstHome;
      process.env.CHAINLESSCHAIN_SECURITY_ANCHOR_HOME = machineAuthority;
      const firstPath = getSkillExecutionAuthorityPath();
      const first = new DurableSkillExecutionAuthority({ pollIntervalMs: 10 });
      lease = first.acquireLease({ skillId: "cross-home-skill" });
      const aborted = new Promise((resolve) =>
        lease.signal.addEventListener(
          "abort",
          () => resolve(lease.signal.reason),
          {
            once: true,
          },
        ),
      );

      process.env.CHAINLESSCHAIN_HOME = secondHome;
      const secondPath = getSkillExecutionAuthorityPath();
      expect(secondPath).toBe(firstPath);
      expect(path.dirname(secondPath)).toBe(path.resolve(machineAuthority));
      expect(path.relative(firstHome, secondPath)).toMatch(/^\.\./);
      expect(path.relative(secondHome, secondPath)).toMatch(/^\.\./);

      const second = new DurableSkillExecutionAuthority({ pollIntervalMs: 10 });
      const revoked = second.revoke({ reasonCode: "cross-home-revocation" });
      await expect(aborted).resolves.toMatchObject({
        code: "CC_SKILL_EXECUTION_REVOKED",
        generation: revoked.generation,
      });
    } finally {
      lease?.release();
      if (originalHome === undefined) delete process.env.CHAINLESSCHAIN_HOME;
      else process.env.CHAINLESSCHAIN_HOME = originalHome;
      if (originalMachineAuthority === undefined) {
        delete process.env.CHAINLESSCHAIN_SECURITY_ANCHOR_HOME;
      } else {
        process.env.CHAINLESSCHAIN_SECURITY_ANCHOR_HOME =
          originalMachineAuthority;
      }
    }
  });

  it("persists a monotonic audit chain across restart and fails closed on corruption or rollback", () => {
    const filePath = createAuthorityPath();
    const first = new DurableSkillExecutionAuthority({ filePath });
    const revoked = first.revoke({
      message: "must remain process-local",
      reasonCode: "unit-revocation",
    });
    expect(revoked.generation).toBe("1");

    const restarted = new DurableSkillExecutionAuthority({ filePath });
    expect(restarted.readGeneration()).toBe(1n);
    const persisted = JSON.parse(fs.readFileSync(filePath, "utf8"));
    expect(persisted).toMatchObject({ version: 1, generation: "1" });
    expect(persisted.events).toEqual([
      expect.objectContaining({
        generation: "1",
        previousGeneration: "0",
        reasonCode: "unit-revocation",
      }),
    ]);
    expect(JSON.stringify(persisted)).not.toContain(
      "must remain process-local",
    );

    const lease = restarted.acquireLease({ skillId: "corruption-fence" });
    fs.writeFileSync(filePath, "{broken", "utf8");
    expect(() => restarted.readGeneration()).toThrow(
      expect.objectContaining({
        code: SKILL_EXECUTION_AUTHORITY_UNAVAILABLE_CODE,
      }),
    );
    expect(lease.signal.aborted).toBe(true);

    fs.writeFileSync(
      filePath,
      `${JSON.stringify({ version: 1, generation: "0", events: [] })}\n`,
      "utf8",
    );
    expect(() => restarted.readGeneration()).toThrow(
      expect.objectContaining({
        code: SKILL_EXECUTION_AUTHORITY_ROLLBACK_CODE,
      }),
    );
    lease.release();
  });

  it("interrupts an active Worker lease after another isolate revokes", async () => {
    const filePath = createAuthorityPath();
    const worker = new Worker(fixtureUrl, {
      workerData: { filePath, command: "active" },
    });
    hosts.add(worker);
    worker.once("exit", () => hosts.delete(worker));
    await waitForMessage(worker, (message) => message?.type === "ready");

    const authority = new DurableSkillExecutionAuthority({ filePath });
    const abortedPromise = waitForMessage(
      worker,
      (message) => message?.type === "aborted",
    );
    const revoked = authority.revoke({ reasonCode: "worker-revocation" });
    const aborted = await abortedPromise;
    expect(aborted).toMatchObject({
      code: "CC_SKILL_EXECUTION_REVOKED",
      generation: revoked.generation,
    });
    await stopHost(worker);
  });

  it("interrupts an independent child and preserves the generation for its replacement", async () => {
    const filePath = createAuthorityPath();
    const child = spawnChild(filePath);
    await waitForMessage(child, (message) => message?.type === "ready");

    const authority = new DurableSkillExecutionAuthority({ filePath });
    const abortedPromise = waitForMessage(
      child,
      (message) => message?.type === "aborted",
    );
    const revoked = authority.revoke({ reasonCode: "child-revocation" });
    await expect(abortedPromise).resolves.toMatchObject({
      code: "CC_SKILL_EXECUTION_REVOKED",
      generation: revoked.generation,
    });
    await stopHost(child);

    const replacement = spawnChild(filePath, "read");
    const observed = await waitForMessage(
      replacement,
      (message) => message?.type === "generation",
    );
    expect(observed.generation).toBe(revoked.generation);
  });

  it("serializes concurrent revocations without losing a generation or audit event", async () => {
    const filePath = createAuthorityPath();
    const results = await Promise.all(
      Array.from({ length: 6 }, () => {
        const child = spawnChild(filePath, "revoke");
        return waitForMessage(child, (message) => message?.type === "revoked");
      }),
    );
    expect(
      results.map((result) => Number(result.generation)).sort((a, b) => a - b),
    ).toEqual([1, 2, 3, 4, 5, 6]);

    const restarted = new DurableSkillExecutionAuthority({ filePath });
    expect(restarted.readGeneration()).toBe(6n);
    const persisted = JSON.parse(fs.readFileSync(filePath, "utf8"));
    expect(persisted.events).toHaveLength(6);
    expect(persisted.events.at(-1)).toMatchObject({
      generation: "6",
      previousGeneration: "5",
    });
  });
});
