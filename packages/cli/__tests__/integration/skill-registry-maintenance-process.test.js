import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fork } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { openEvolutionDurableStore } from "../fixtures/evolution-durable-store.js";
import { openRevocationReleaseRegistry } from "../fixtures/skill-revocation-release-registry.js";
import { withSkillRegistryMaintenance } from "../../src/lib/evolution/skill-registry-maintenance.js";

const worker = fileURLToPath(
  new URL("../fixtures/skill-registry-maintenance-child.mjs", import.meta.url),
);
const roots = [],
  children = new Set(),
  temporaryParent = fs.realpathSync.native(os.tmpdir());
const scope = {
  tenantId: "tenant-a",
  artifactTenantId: "artifact-tenant-a-release",
  audience: "evolution-runtime",
};
async function fixture() {
  const root = fs.mkdtempSync(
    path.join(temporaryParent, "cc-registry-maintenance-process-"),
  );
  roots.push(root);
  const storage = openEvolutionDurableStore(path.join(root, "store"), scope);
  const value = await openRevocationReleaseRegistry({
    root,
    storage: { ...storage, now: storage.clock() },
    fsImpl: storage.fsImpl,
    tenantId: scope.tenantId,
    artifactTenantId: scope.artifactTenantId,
    seed: true,
  });
  return {
    root,
    value,
    input: {
      candidateRegistry: value.candidateRegistry,
      releaseRegistry: value.pruningRollbackOptions.releaseRegistry,
    },
  };
}
function waitExit(child) {
  if (child.exitCode !== null || child.signalCode !== null)
    return Promise.resolve();
  return new Promise((resolve) => child.once("exit", resolve));
}
async function launch(root, mode) {
  const child = fork(worker, [root, mode], {
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  children.add(child);
  let diagnostic = "";
  child.stderr.on("data", (bytes) => {
    diagnostic = (diagnostic + bytes.toString()).slice(-4000);
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(new Error(`Registry child startup timed out: ${diagnostic}`)),
      20_000,
    );
    const exited = (code, signal) => {
      clearTimeout(timer);
      reject(
        new Error(`Registry child exited ${code}/${signal}: ${diagnostic}`),
      );
    };
    child.once("exit", exited);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("message", (message) => {
      clearTimeout(timer);
      child.removeListener("exit", exited);
      if (!message.ready)
        reject(new Error("Registry child did not acknowledge readiness"));
      else resolve();
    });
  });
  return child;
}
let sequence = 0;
function command(child, value) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.removeListener("message", received);
      reject(new Error("Registry command timed out"));
    }, 20_000);
    function received(message) {
      if (message.id !== id) return;
      clearTimeout(timer);
      child.removeListener("message", received);
      resolve(message);
    }
    child.on("message", received);
    child.send({ id, command: value });
  });
}
afterEach(async () => {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
    await waitExit(child);
  }
  children.clear();
  for (const root of roots.splice(0)) {
    const target = path.resolve(root);
    if (
      path.dirname(target) !== temporaryParent ||
      !path.basename(target).startsWith("cc-registry-maintenance-process-")
    )
      throw new Error("unsafe Registry process fixture cleanup");
    fs.rmSync(target, { recursive: true, force: true });
  }
});

describe("Registry maintenance with actual independent writers", () => {
  it("blocks cached candidate/rollback writers in another process until both maintenance locks are released", async () => {
    const { root, input, value } = await fixture();
    const child = await launch(root, "cached-writer");
    const before = value.readActive();
    const candidateFiles = fs
      .readdirSync(input.candidateRegistry.rootDir)
      .sort();
    const releaseFiles = fs
      .readdirSync(path.join(input.releaseRegistry.rootDir, "artifacts"))
      .sort();
    await withSkillRegistryMaintenance(input, async (context) => {
      expect(await command(child, "candidate")).toMatchObject({
        ok: false,
        code: "STATE_LOCK_UNAVAILABLE",
      });
      expect(await command(child, "rollback")).toMatchObject({
        ok: false,
        code: "STATE_LOCK_UNAVAILABLE",
      });
      expect(context.assertCurrent()).toBe(true);
      expect(value.readActive()).toEqual(before);
      expect(fs.readdirSync(input.candidateRegistry.rootDir).sort()).toEqual(
        candidateFiles,
      );
      expect(
        fs
          .readdirSync(path.join(input.releaseRegistry.rootDir, "artifacts"))
          .sort(),
      ).toEqual(releaseFiles);
    });
    expect(await command(child, "candidate")).toMatchObject({ ok: true });
    expect(await command(child, "rollback")).toMatchObject({
      ok: true,
      revision: 3,
    });
    expect(value.readActive().release.releaseDigest).toBe(
      value.baseline.releaseDigest,
    );
    child.send({ id: ++sequence, command: "exit" });
    await waitExit(child);
    expect(child.exitCode).toBe(0);
  });
  it("retains exclusion for a live maintenance process and reclaims both exact locks only after confirmed process exit", async () => {
    const { root, input, value } = await fixture();
    const child = await launch(root, "maintenance-owner");
    expect(() => value.createDerivedCandidate()).toThrowError(
      expect.objectContaining({ code: "STATE_LOCK_UNAVAILABLE" }),
    );
    let calls = 0;
    await expect(
      withSkillRegistryMaintenance(input, () => {
        calls++;
      }),
    ).rejects.toThrowError(
      expect.objectContaining({ code: "STATE_LOCK_UNAVAILABLE" }),
    );
    expect(calls).toBe(0);
    child.kill("SIGKILL");
    await waitExit(child);
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
    await withSkillRegistryMaintenance(input, (context) =>
      expect(context.assertCurrent()).toBe(true),
    );
    expect(value.createDerivedCandidate().candidateId).toBeDefined();
  });
});
