import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { generateKeyPairSync, sign } from "node:crypto";
import { expect, it } from "vitest";
import { openWorkbenchRollbackStore } from "../fixtures/evolution-workbench-rollback.js";
import {
  seedWorkbenchPendingCandidate,
  workbenchTestIdentity,
} from "../fixtures/evolution-workbench-runtime.js";
import {
  computeEvolutionDeploymentDigest as digest,
  serializeEvolutionDeploymentDescriptorPayload,
  EVOLUTION_DEPLOYMENT_DESCRIPTOR_SCHEMA,
} from "../../src/lib/evolution/evolution-deployment-loader.js";
import { APP_SERVER_PROTOCOL_VERSION } from "../../src/lib/app-server/protocol.js";

const bin = fileURLToPath(
  new URL("../../bin/chainlesschain.js", import.meta.url),
);
const resourcesUrl = new URL(
  "../fixtures/evolution-workbench-rollback.js",
  import.meta.url,
).href;
const runtimeUrl = new URL(
  "../fixtures/evolution-workbench-runtime.js",
  import.meta.url,
).href;

function runCli(args, env, root, executable = bin) {
  const result = spawnSync(process.execPath, [executable, ...args], {
    env,
    cwd: path.join(root, "workspace"),
    encoding: "utf8",
    timeout: 90_000,
    maxBuffer: 2 * 1024 * 1024,
    windowsHide: true,
  });
  expect(result.error, result.stderr).toBeUndefined();
  return result;
}
function jsonCli(args, env, root) {
  const result = runCli(args, env, root);
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout);
}
function stdioClient(env, root) {
  const child = spawn(
    process.execPath,
    [
      bin,
      "serve",
      "--app-server",
      "--app-server-state-dir",
      path.join(root, "app-server-state"),
    ],
    {
      env,
      cwd: path.join(root, "workspace"),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  let sequence = 0;
  let buffer = "";
  let stderr = "";
  let ended = false;
  const pending = new Map();
  child.stderr.on("data", (chunk) => {
    stderr = (stderr + chunk.toString()).slice(-32_768);
  });
  const completion = new Promise((resolve) => {
    child.once("error", (error) => {
      for (const request of pending.values()) request.reject(error);
    });
    child.once("close", (code, signal) => {
      ended = true;
      for (const request of pending.values())
        request.reject(new Error(`CLI closed ${code}/${signal}: ${stderr}`));
      resolve({ code, signal });
    });
  });
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      try {
        const response = JSON.parse(line);
        const request = pending.get(response.id);
        if (request) {
          pending.delete(response.id);
          request.resolve(response);
        }
      } catch (error) {
        for (const request of pending.values()) request.reject(error);
      }
    }
  });
  return {
    async request(method, params = {}) {
      if (ended) throw new Error(`CLI already stopped: ${stderr}`);
      const id = ++sequence;
      let timer;
      try {
        return await new Promise((resolve, reject) => {
          timer = setTimeout(() => {
            pending.delete(id);
            reject(new Error(`CLI RPC timeout: ${method}: ${stderr}`));
          }, 90_000);
          pending.set(id, { resolve, reject });
          child.stdin.write(
            JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n",
          );
        });
      } finally {
        clearTimeout(timer);
        pending.delete(id);
      }
    },
    async close() {
      child.stdin.end();
      const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
      try {
        const result = await completion;
        expect(result.code, stderr).toBe(0);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

it("loads a signed deployment in real CLI and stdio App Server processes, retaining actual review/rollback effects", async () => {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), "cc-workbench-signed-startup-"),
  );
  let client;
  try {
    fs.mkdirSync(path.join(root, "workspace"));
    const storeRoot = path.join(root, "governance");
    // Test deployment explicitly imports TEST authorities. The production
    // factory/CLI/descriptor verifier are unmocked; no user environment is set.
    const source = `export async function createChainlessChainCommandDependencies({ commandName, descriptor, factories }) {
      const { openWorkbenchRollbackStore } = await import(${JSON.stringify(resourcesUrl)});
      const { workbenchRuntimeOptions, workbenchTestIdentity } = await import(${JSON.stringify(runtimeUrl)});
      const h = await openWorkbenchRollbackStore(${JSON.stringify(storeRoot)}, { handlerArtifactDigest: descriptor.moduleDigest });
      const runtime = await factories.createEvolutionWorkbenchRuntime(workbenchRuntimeOptions(h, { identityProvider: workbenchTestIdentity(h, ${JSON.stringify(storeRoot)}) }));
      return commandName === "serve" ? { evolutionWorkbenchHost: runtime.workbenchHost } : { workbenchHost: runtime.workbenchHost };
    }\n`;
    const modulePath = path.join(root, "test-deployment.mjs");
    fs.writeFileSync(modulePath, source, { flag: "wx" });
    const moduleDigest = digest(Buffer.from(source));
    const h = await openWorkbenchRollbackStore(storeRoot, {
      seed: true,
      handlerArtifactDigest: moduleDigest,
    });
    const pending = await seedWorkbenchPendingCandidate(h);
    workbenchTestIdentity(h, storeRoot, true);
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const trustRoot = publicKey.export({ type: "spki", format: "pem" });
    const descriptor = {
      schema: EVOLUTION_DEPLOYMENT_DESCRIPTOR_SCHEMA,
      revision: 1,
      modulePath,
      moduleDigest,
      trustRootDigest: digest(trustRoot),
      commands: ["evolution", "serve"],
    };
    descriptor.signature = sign(
      null,
      Buffer.from(serializeEvolutionDeploymentDescriptorPayload(descriptor)),
      privateKey,
    ).toString("base64");
    const descriptorPath = path.join(root, "descriptor.json");
    const trustRootPath = path.join(root, "public.pem");
    fs.writeFileSync(descriptorPath, JSON.stringify(descriptor), {
      flag: "wx",
    });
    fs.writeFileSync(trustRootPath, trustRoot, { flag: "wx" });
    const env = {
      ...process.env,
      FORCE_COLOR: "0",
      CHAINLESSCHAIN_HOME: path.join(root, "cli-state"),
      CHAINLESSCHAIN_SECURITY_ANCHOR_HOME: path.join(root, "security-anchor"),
      CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_DESCRIPTOR: descriptorPath,
      CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_TRUST_ROOT: trustRootPath,
    };
    const initial = jsonCli(["evolution", "workbench", "list"], env, root);
    expect(
      initial.candidates.find(
        (candidate) => candidate.packetDigest === pending.packetDigest,
      ).status,
    ).toBe("pending");
    const reviewed = jsonCli(
      [
        "evolution",
        "workbench",
        "review",
        "approve",
        pending.packetDigest,
        "--reason",
        "Test human approves the exact candidate.",
      ],
      env,
      root,
    );
    expect(reviewed.items).toHaveLength(1);
    expect(
      (await h.review.readReview(pending.packetDigest)).decision.decision,
    ).toBe("approved");
    client = stdioClient(env, root);
    const initialized = await client.request("initialize", {
      protocolVersion: APP_SERVER_PROTOCOL_VERSION,
      minimumProtocolVersion: 1,
      client: { name: "test-ide-workbench-startup", version: "1" },
      features: [],
    });
    expect(initialized.error).toBeUndefined();
    expect(initialized.result.evolutionWorkbench.available).toBe(true);
    const comparison = await client.request("evolution/workbench/compare", {
      leftPacketDigest: h.packets[1].packetDigest,
      rightPacketDigest: h.packets[0].packetDigest,
    });
    expect(comparison.error).toBeUndefined();
    const rolledBack = await client.request("evolution/workbench/rollback", {
      fromPacketDigest: h.packets[1].packetDigest,
      toPacketDigest: h.packets[0].packetDigest,
      reason: "Test human restores the approved LKG.",
    });
    expect(rolledBack.error).toBeUndefined();
    expect(h.release.readActive().release.releaseDigest).toBe(
      h.release.baseline.releaseDigest,
    );
    const listed = await client.request("evolution/workbench/list");
    expect(listed.result.governance.activeReleaseId).toBe(
      h.release.baseline.releaseDigest,
    );
    expect(listed.result.governance.lastKnownGoodReleaseId).toBe(
      h.release.baseline.releaseDigest,
    );
    await client.close();
    client = null;
    const sequence = h.backend.ledger.verify().sequence;
    const reopened = jsonCli(["evolution", "workbench", "list"], env, root);
    expect(reopened).toEqual(listed.result);
    expect(h.backend.ledger.verify().sequence).toBe(sequence);
    fs.appendFileSync(modulePath, "// altered authenticated bytes\n");
    const rejected = runCli(["evolution", "workbench", "list"], env, root);
    expect(rejected.status).not.toBe(0);
    expect(rejected.stderr).toContain("module digest mismatch");
    const eagerRejected = runCli(
      ["evolution", "workbench", "list"],
      env,
      root,
      fileURLToPath(new URL("../../src/index.js", import.meta.url)),
    );
    expect(eagerRejected.status).not.toBe(0);
    expect(eagerRejected.stderr).toContain("module digest mismatch");
    expect(h.backend.ledger.verify().sequence).toBe(sequence);
  } finally {
    try {
      await client?.close();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
}, 300_000);
