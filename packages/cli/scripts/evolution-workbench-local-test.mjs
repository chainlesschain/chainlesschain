#!/usr/bin/env node
// Source-checkout-only test deployment. Never included in the npm CLI payload.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { generateKeyPairSync, sign } from "node:crypto";
import { openWorkbenchRollbackStore } from "../__tests__/fixtures/evolution-workbench-rollback.js";
import {
  seedWorkbenchPendingCandidate,
  workbenchTestIdentity,
} from "../__tests__/fixtures/evolution-workbench-runtime.js";
import {
  computeEvolutionDeploymentDigest as digest,
  serializeEvolutionDeploymentDescriptorPayload,
  EVOLUTION_DEPLOYMENT_DESCRIPTOR_SCHEMA,
} from "../src/lib/evolution/evolution-deployment-loader.js";

const require = createRequire(import.meta.url);
const {
  readWorkbenchProfile,
  PROFILE_SCHEMA,
  createWorkbenchProfileManager,
} = require("../../vscode-extension/src/evolution-workbench-profile.js");
const {
  openEvolutionWorkbench,
} = require("../../vscode-extension/src/ui/evolution-workbench-view.js");
const cliPath = fileURLToPath(
  new URL("../bin/chainlesschain.js", import.meta.url),
);
const fixtureUrl = (name) =>
  new URL(`../__tests__/fixtures/${name}.js`, import.meta.url).href;

function writeNew(file, value) {
  fs.writeFileSync(
    file,
    typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n",
    {
      flag: "wx",
      mode: 0o600,
    },
  );
}

export async function createLocalWorkbenchTest({ root: requestedRoot } = {}) {
  let root;
  if (requestedRoot) {
    if (!path.isAbsolute(requestedRoot))
      throw new Error("--root must be absolute");
    // mkdir without recursive deliberately rejects every existing target.
    fs.mkdirSync(requestedRoot, { mode: 0o700 });
    root = fs.realpathSync.native(requestedRoot);
  } else {
    root = fs.mkdtempSync(
      path.join(
        fs.realpathSync.native(os.tmpdir()),
        "cc-evolution-local-test-",
      ),
    );
  }
  const storeRoot = path.join(root, "governance");
  const workspace = path.join(root, "workspace");
  fs.mkdirSync(workspace);
  const source = `// LOCAL TEST ONLY: fixture keys, identities, Eval and fixed test clock.
export async function createChainlessChainCommandDependencies({ commandName, descriptor, factories }) {
  const { openWorkbenchRollbackStore } = await import(${JSON.stringify(fixtureUrl("evolution-workbench-rollback"))});
  const { workbenchRuntimeOptions, workbenchTestIdentity } = await import(${JSON.stringify(fixtureUrl("evolution-workbench-runtime"))});
  const { workbenchFileResourceOptions } = await import(${JSON.stringify(fixtureUrl("evolution-workbench-file-resources"))});
  const { workbenchControlOptions } = await import(${JSON.stringify(fixtureUrl("evolution-workbench-control-ports"))});
  const root = ${JSON.stringify(storeRoot)};
  const options = workbenchFileResourceOptions(root, {
    tenantId: "tenant:workbench-rollback", streamId: "workbench-rollback", runId: "run:workbench-rollback", skillName: "safe-refactor",
    authorityId: "authority:workbench-rollback-test", revision: 1, handlerArtifactDigest: descriptor.moduleDigest,
  });
  const fileResources = factories.openEvolutionWorkbenchFileResources(options);
  const h = await openWorkbenchRollbackStore(root, { fileResources, fsImpl: options.fsImpl, handlerArtifactDigest: descriptor.moduleDigest });
  const controls = factories.createEvolutionWorkbenchControlPorts(workbenchControlOptions(h, fileResources));
  const runtime = await factories.createEvolutionWorkbenchRuntime(workbenchRuntimeOptions(h, {
    ...controls, identityProvider: workbenchTestIdentity(h, root),
  }));
  return commandName === "serve" ? { evolutionWorkbenchHost: runtime.workbenchHost } : { workbenchHost: runtime.workbenchHost };
}
`;
  const modulePath = path.join(root, "local-test-deployment.mjs");
  writeNew(modulePath, source);
  const moduleDigest = digest(Buffer.from(source));
  const h = await openWorkbenchRollbackStore(storeRoot, {
    seed: true,
    handlerArtifactDigest: moduleDigest,
  });
  await seedWorkbenchPendingCandidate(h);
  workbenchTestIdentity(h, storeRoot, true);
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const publicPem = publicKey.export({ type: "spki", format: "pem" });
  const descriptor = {
    schema: EVOLUTION_DEPLOYMENT_DESCRIPTOR_SCHEMA,
    revision: 1,
    modulePath,
    moduleDigest,
    trustRootDigest: digest(publicPem),
    commands: ["evolution", "serve"],
  };
  descriptor.signature = sign(
    null,
    Buffer.from(serializeEvolutionDeploymentDescriptorPayload(descriptor)),
    privateKey,
  ).toString("base64");
  const descriptorPath = path.join(root, "descriptor.json");
  const trustRootPath = path.join(root, "public.pem");
  writeNew(descriptorPath, descriptor);
  writeNew(trustRootPath, publicPem);
  const profilePath = path.join(root, "workbench-profile.json");
  writeNew(profilePath, {
    schema: PROFILE_SCHEMA,
    mode: "local-test",
    cliPath,
    cwd: workspace,
    stateDirectory: path.join(root, "app-server-state"),
    env: {
      CHAINLESSCHAIN_HOME: path.join(root, "cli-state"),
      CHAINLESSCHAIN_SECURITY_ANCHOR_HOME: path.join(root, "security-anchor"),
      CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_DESCRIPTOR: descriptorPath,
      CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_TRUST_ROOT: trustRootPath,
    },
  });
  writeNew(
    path.join(root, "README.txt"),
    `演化工作台本地测试环境 / LOCAL TEST ONLY

在 IDE 用户设置中配置（需要包含 profile 支持的本地扩展）：
"chainlesschain.evolution.workbench.profile": ${JSON.stringify(profilePath)}
然后执行 ChainlessChain: 演化工作台。

包含：一个当前版本、一个已批准的历史版本和一个待审核候选。
可查看证据、对比版本、批准/拒绝候选、回滚到历史版本。
操作写入本目录的真实测试账本，重启后保留。
测试使用固定时钟、公开 fixture 密钥、模拟真人和 Eval；无需模型/API Key。
Windows 使用测试目录 fsync 适配器；不证明生产文件系统耐久性。
这不是生产自动演化环境，不能用于真实审核或发布。
不要把此配置的环境变量加入系统或普通聊天进程。
重新运行 init 会创建全新的环境；已有环境不会被覆盖。
清空上述 IDE 设置可恢复原工作台部署。
`,
  );
  return { root, profilePath, mode: "local-test" };
}

// Real IDE adapter + real stdio CLI + signed file-backed runtime. The small UI
// driver chooses TEST actions only; it never submits an approval to user data.
export async function verifyLocalWorkbenchTest(profilePath) {
  const options = readWorkbenchProfile(profilePath);
  if (options.mode !== "local-test")
    throw new Error("verify only accepts a local-test profile");
  const manager = createWorkbenchProfileManager();
  let pilot = await manager.get(profilePath);
  const documents = [];
  const titles = [];
  let selections = [];
  const vscode = {
    window: {
      showQuickPick: async (items, opts) => {
        titles.push(opts.title);
        const choose = selections.shift();
        assert.equal(typeof choose, "function", "unexpected UI selection");
        const selected = choose(items);
        assert.ok(selected, "expected test action is available");
        return selected;
      },
      showInputBox: async () =>
        "LOCAL TEST: verify the exact candidate and rollback.",
      showWarningMessage: async (_message, _options, action) => action,
      showInformationMessage: async (message) => {
        throw new Error(message);
      },
      showTextDocument: async () => {},
    },
    workspace: {
      openTextDocument: async (document) => {
        documents.push(JSON.parse(document.content));
        return document;
      },
    },
  };
  const choosePacket = (packetDigest) => (items) =>
    items.find((item) => item.candidate?.packetDigest === packetDigest);
  const chooseAction = (id) => (items) => items.find((item) => item.id === id);
  async function interact(...choices) {
    selections = choices;
    const result = await openEvolutionWorkbench(vscode, {
      getPilot: async () => pilot,
    });
    assert.equal(selections.length, 0);
    return result;
  }
  try {
    const capabilities = await pilot.start();
    assert.equal(capabilities.evolutionWorkbench?.available, true);
    for (const method of ["list", "compare", "review", "rollback"])
      assert.ok(capabilities.evolutionWorkbench.methods.includes(method));
    const before = await pilot.evolutionWorkbenchList({ limit: 500 });
    const active = before.candidates.find(
      (candidate) => candidate.actualUsage.active,
    );
    const previous = before.candidates.find(
      (candidate) =>
        candidate.status === "approved" && !candidate.actualUsage.active,
    );
    const pending = before.candidates.find(
      (candidate) => candidate.status === "pending",
    );
    assert.ok(
      active && previous && pending,
      "verify requires a fresh init environment",
    );
    await interact(choosePacket(active.packetDigest), chooseAction("details"));
    await interact(
      choosePacket(active.packetDigest),
      chooseAction("compare"),
      choosePacket(previous.packetDigest),
    );
    await interact(choosePacket(pending.packetDigest), chooseAction("approve"));
    const approved = await pilot.evolutionWorkbenchList({});
    assert.equal(
      approved.candidates.find((c) => c.packetDigest === pending.packetDigest)
        .status,
      "approved",
    );
    await interact(
      choosePacket(previous.packetDigest),
      chooseAction("rollback"),
    );
    const after = await pilot.evolutionWorkbenchList({});
    assert.equal(
      after.candidates.find((c) => c.packetDigest === previous.packetDigest)
        .actualUsage.active,
      true,
    );
    assert.notEqual(
      after.governance.activeReleaseId,
      before.governance.activeReleaseId,
    );
    assert.ok(documents.every((doc) => doc.title.includes("LOCAL TEST")));
    assert.ok(titles.some((title) => title.includes("LOCAL TEST")));
    await manager.close();
    pilot = await manager.get(profilePath);
    await pilot.start();
    assert.deepEqual(await pilot.evolutionWorkbenchList({}), after);
    return {
      mode: "local-test",
      available: true,
      candidateCount: before.candidates.length,
      checks: [
        "signed-startup",
        "ide-list",
        "ide-evidence",
        "ide-compare",
        "ide-approve",
        "ide-rollback",
        "restart-persistence",
        "test-mode-label",
      ],
    };
  } finally {
    await manager.close();
  }
}

async function main(args) {
  if (
    args[0] === "init" &&
    (args.length === 1 || (args.length === 3 && args[1] === "--root"))
  ) {
    const result = await createLocalWorkbenchTest({ root: args[2] });
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (args[0] === "verify" && args.length === 2) {
    console.log(
      JSON.stringify(
        await verifyLocalWorkbenchTest(path.resolve(args[1])),
        null,
        2,
      ),
    );
    return;
  }
  throw new Error(
    "Usage: node packages/cli/scripts/evolution-workbench-local-test.mjs init [--root <new absolute directory>] | verify <test profile.json>",
  );
}
if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
