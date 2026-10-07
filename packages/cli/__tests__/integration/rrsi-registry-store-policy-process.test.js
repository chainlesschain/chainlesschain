import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { openLedgerV2Fixture } from "../fixtures/evolution-ledger-v2-store.js";
import { repairPrivatePath } from "../../src/lib/secure-fs.js";
import {
  createRrsiRegistryStorePolicy,
  RRSI_REGISTRY_STORE_POLICY_EVENT_TYPE,
} from "../../src/lib/evolution/rrsi-registry-store-policy.js";

const roots = [],
  children = [];
const temporaryParent = fs.realpathSync.native(os.tmpdir());
const scope = {
  tenantId: "tenant-a",
  artifactTenantId: "artifact-tenant-a-release",
  audience: "evolution-runtime",
};
const operationId = "test:process:provision";
const helper = fileURLToPath(
  new URL(
    "../fixtures/rrsi-registry-store-policy-process.mjs",
    import.meta.url,
  ),
);
function fixture() {
  const root = fs.mkdtempSync(
    path.join(temporaryParent, "cc-rrsi-store-policy-process-"),
  );
  roots.push(root);
  const store = openLedgerV2Fixture(path.join(root, "store"), scope);
  fs.mkdirSync(path.join(root, "provisioned"), { mode: 0o700 });
  repairPrivatePath(path.join(root, "provisioned"));
  const policy = createRrsiRegistryStorePolicy({
    backend: store.backend,
    artifactPorts: store.artifactPorts,
    ledgerArtifactResolver: store.resolver,
    descriptor: { ...scope, purpose: "evolution-ledger" },
  });
  return { root, store, policy };
}
function child(root, mode) {
  return spawnSync(process.execPath, [helper, root, mode, operationId], {
    encoding: "utf8",
    timeout: 60_000,
    windowsHide: true,
  });
}
function liveChild(root) {
  const processHandle = spawn(
    process.execPath,
    [helper, root, "hold-second-marker", operationId],
    { windowsHide: true },
  );
  children.push(processHandle);
  let stdout = "",
    stderr = "";
  processHandle.stdout.on("data", (bytes) => {
    stdout += bytes;
  });
  processHandle.stderr.on("data", (bytes) => {
    stderr += bytes;
  });
  const exited = new Promise((resolve, reject) => {
    processHandle.once("error", reject);
    processHandle.once("close", (code, signal) =>
      resolve({ code, signal, stdout, stderr }),
    );
  });
  return { processHandle, exited };
}
async function ready(root, processHandle) {
  const deadline = Date.now() + 45_000;
  const file = path.join(root, "ready.json");
  while (!fs.existsSync(file)) {
    if (
      processHandle.exitCode !== null ||
      processHandle.signalCode !== null ||
      Date.now() > deadline
    )
      throw new Error("TEST ONLY provisioning owner did not reach publication");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
afterEach(async () => {
  for (const handle of children.splice(0)) {
    if (handle.exitCode === null && handle.signalCode === null) {
      const exited = new Promise((resolve) => handle.once("close", resolve));
      handle.kill("SIGKILL");
      await exited;
    }
  }
  for (const root of roots.splice(0)) {
    if (
      path.dirname(path.resolve(root)) !== temporaryParent ||
      !path.basename(root).startsWith("cc-rrsi-store-policy-process-")
    )
      throw new Error("unsafe store policy process cleanup");
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("Registry store policy native process lifetime and reopen", () => {
  it("provisions in a real child and reads the same physical pair in another process", () => {
    const { root, policy, store } = fixture();
    const initial = child(root, "provision");
    expect(initial.status, initial.stderr).toBe(0);
    const expected = JSON.parse(initial.stdout);
    expect(expected.phase).toBe("committed");
    const reopened = child(root, "read");
    expect(reopened.status, reopened.stderr).toBe(0);
    expect(JSON.parse(reopened.stdout)).toEqual(expected);
    expect(policy.read(operationId)).toEqual(expected);
    expect(
      store.journal
        .read()
        .filter(
          (event) => event.type === RRSI_REGISTRY_STORE_POLICY_EVENT_TYPE,
        ),
    ).toHaveLength(3);
  }, 90_000);

  it("denies a second live policy process until the original installer leaves both publication boundaries", async () => {
    const { root, policy } = fixture();
    const owner = liveChild(root);
    const staged = await ready(root, owner.processHandle);
    expect(staged.pid).toBe(owner.processHandle.pid);
    expect(fs.existsSync(staged.target)).toBe(false);
    expect(() => policy.read(operationId)).toThrow();
    const denied = child(root, "recover");
    expect(denied.status).toBe(2);
    expect(fs.existsSync(staged.target)).toBe(false);
    fs.writeFileSync(
      path.join(root, "release-owner"),
      "TEST ONLY release the original owner",
    );
    const finished = await owner.exited;
    expect(finished.code, finished.stderr).toBe(0);
    const expected = JSON.parse(finished.stdout);
    expect(policy.read(operationId)).toEqual(expected);
  }, 90_000);

  it("reclaims only a confirmed dead owner and leaves partial publication on HOLD", async () => {
    const { root, policy, store } = fixture();
    const owner = liveChild(root);
    const staged = await ready(root, owner.processHandle);
    owner.processHandle.kill("SIGKILL");
    const stopped = await owner.exited;
    expect(stopped.code === null || stopped.code !== 0).toBe(true);
    const before = fs.readFileSync(staged.source);
    expect(() => policy.recover(operationId)).toThrow(/inventory/);
    const reopened = child(root, "recover");
    expect(reopened.status).toBe(2);
    expect(JSON.parse(reopened.stderr).message).toMatch(/inventory/);
    expect(fs.existsSync(staged.target)).toBe(false);
    expect(fs.readFileSync(staged.source)).toEqual(before);
    expect(
      store.journal
        .read()
        .filter(
          (event) => event.type === RRSI_REGISTRY_STORE_POLICY_EVENT_TYPE,
        ),
    ).toHaveLength(1);
  }, 90_000);
});
