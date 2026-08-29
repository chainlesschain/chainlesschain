import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  canonicalDigest,
  loadContextMemoryWriterInventory,
  validateContextMemoryWriterInventory,
} from "../index.mjs";
import { CliCanonicalMemoryService } from "../../cli/src/lib/context-memory-kernel/memory-service.js";
import { addMemory as addLegacyMemory } from "../../cli/src/lib/memory-manager.js";
import { storeMemory as storeLegacyHierarchicalMemory } from "../../cli/src/lib/hierarchical-memory.js";
import { CLIPermanentMemory } from "../../cli/src/lib/permanent-memory.js";
import { resolveVscodeContextMemoryAuthority } from "../../vscode-extension/src/context-memory-authority.js";

const require = createRequire(import.meta.url);

const AT = "2026-08-30T00:00:00.000Z";

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function candidateSha() {
  const explicit = option("--candidate-sha", process.env.GITHUB_SHA || "");
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  const value = explicit || head;
  if (!/^[a-f0-9]{40}$/u.test(value)) {
    throw new Error("candidate SHA must be a full commit SHA");
  }
  if (value !== head) throw new Error("candidate SHA must equal checkout HEAD");
  if (
    execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], {
      encoding: "utf8",
    }).trim()
  ) {
    throw new Error("writer probe receipt requires a clean candidate worktree");
  }
  return value;
}

function platformName() {
  if (process.platform === "win32") return "windows";
  if (process.platform === "darwin") return "macos";
  return "linux";
}

function expectFence(probe, expectedCode) {
  try {
    probe();
  } catch (error) {
    assert.equal(error?.code, expectedCode);
    return Object.freeze({ status: "fenced", code: error.code });
  }
  throw new Error(`legacy writer did not fail closed with ${expectedCode}`);
}

async function expectFenceAsync(probe, expectedCode) {
  try {
    await probe();
  } catch (error) {
    assert.equal(error?.code, expectedCode);
    return Object.freeze({ status: "fenced", code: error.code });
  }
  throw new Error(`legacy writer did not fail closed with ${expectedCode}`);
}

const exactCandidateSha = candidateSha();
const {
  DesktopCanonicalMemoryAdapter,
} = require("../../../desktop-app-vue/src/main/context-memory/permanent-memory-adapter.js");
const {
  assertDesktopLegacyMutationAllowed,
} = require("../../../desktop-app-vue/src/main/context-memory/authority.js");
const {
  PromptCompressor,
} = require("../../../desktop-app-vue/src/main/llm/prompt-compressor.js");
const {
  PermanentMemoryManager,
} = require("../../../desktop-app-vue/src/main/llm/permanent-memory-manager.js");
const {
  HierarchicalMemory: DesktopHierarchicalMemory,
} = require("../../../desktop-app-vue/src/main/ai-engine/memory/hierarchical-memory.js");
const {
  MemoryHierarchy,
} = require("../../../desktop-app-vue/src/main/memory/memory-hierarchy.js");
const {
  MemGPTCore,
} = require("../../../desktop-app-vue/src/main/memory/memgpt-core.js");
const {
  MemorySyncService,
} = require("../../../desktop-app-vue/src/main/memory/memory-sync-service.js");
const directory = mkdtempSync(
  join(tmpdir(), "cc-context-memory-writer-probe-"),
);
const previousStage = process.env.CHAINLESSCHAIN_CONTEXT_MEMORY_CLI_STAGE;
const previousDesktopStage =
  process.env.CHAINLESSCHAIN_CONTEXT_MEMORY_DESKTOP_STAGE;
try {
  const inventory = loadContextMemoryWriterInventory();
  const staticResult = validateContextMemoryWriterInventory(inventory);
  assert.equal(staticResult.valid, true, staticResult.errors.join("\n"));
  const writableLegacy = inventory.entries.filter(
    (entry) =>
      entry.role === "legacy_writer" &&
      entry.currentStage !== "legacy_read_only",
  );
  assert.deepEqual(writableLegacy, []);
  const callGraph = inventory.entries.map((entry) => ({
    id: entry.id,
    role: entry.role,
    stage: entry.currentStage,
    targetAuthority: entry.targetAuthority,
    mutationFunctions: entry.mutationFunctions,
    stores: entry.stores,
  }));
  const callGraphNodes = new Set();
  let callGraphEdgeCount = 0;
  for (const entry of callGraph) {
    callGraphNodes.add(`entry:${entry.id}`);
    callGraphNodes.add(`authority:${entry.targetAuthority}`);
    callGraphEdgeCount += 1;
    for (const mutation of entry.mutationFunctions) {
      callGraphNodes.add(`mutation:${mutation}`);
      callGraphEdgeCount += 1;
    }
    for (const store of entry.stores) {
      callGraphNodes.add(`store:${store}`);
      callGraphEdgeCount += 1;
    }
  }

  process.env.CHAINLESSCHAIN_CONTEXT_MEMORY_CLI_STAGE = "canonical_default";
  const canonicalPath = join(directory, "canonical-memory.json");
  const cliService = new CliCanonicalMemoryService({
    env: { CHAINLESSCHAIN_CONTEXT_MEMORY_CLI_STAGE: "canonical_default" },
    memoryFilePath: canonicalPath,
    clock: () => Date.parse(AT),
  });
  const cliMutation = await cliService.add("writer probe canonical payload", {
    category: "writer-probe",
    importance: 1,
  });
  assert.equal(existsSync(canonicalPath), true);
  assert.match(
    readFileSync(canonicalPath, "utf8"),
    /writer probe canonical payload/u,
  );

  const legacyCli = {
    memoryManager: expectFence(
      () => addLegacyMemory(null, "legacy writer probe"),
      "legacy_writer_fenced",
    ),
    hierarchicalMemory: expectFence(
      () => storeLegacyHierarchicalMemory(null, "legacy writer probe"),
      "legacy_writer_fenced",
    ),
    permanentMemory: expectFence(
      () =>
        new CLIPermanentMemory({
          memoryDir: join(directory, "legacy"),
        }).initialize(),
      "legacy_writer_fenced",
    ),
  };

  const forwarded = [];
  const pilot = {
    memoryRecall: async (params) => {
      forwarded.push({ method: "memory/recall", params });
      return { results: [], memoryRevision: 0 };
    },
    memoryPropose: async (params) => {
      forwarded.push({ method: "memory/propose", params });
      return {
        record: {
          memoryId: "desktop-writer-probe",
          revision: 1,
          createdAt: AT,
        },
        receipt: { status: "committed" },
      };
    },
    memoryDecide: async (params) => {
      forwarded.push({ method: "memory/decide", params });
      return { status: "committed" };
    },
    memoryDelete: async (params) => {
      forwarded.push({ method: "memory/delete", params });
      return { status: "purged" };
    },
  };
  const desktop = new DesktopCanonicalMemoryAdapter({
    getPilot: () => pilot,
    now: () => Date.parse(AT),
    uuid: () => "desktop-writer-probe-request",
  });
  const desktopMutation = await desktop.appendToMemory("desktop writer probe", {
    section: "Writer Probe",
  });
  assert.equal(desktopMutation.receipt.status, "committed");
  assert.deepEqual(
    forwarded.map((entry) => entry.method),
    ["memory/propose"],
  );
  process.env.CHAINLESSCHAIN_CONTEXT_MEMORY_DESKTOP_STAGE = "canonical_default";
  const legacyDesktop = {
    authority: expectFence(
      () =>
        assertDesktopLegacyMutationAllowed({
          env: {
            CHAINLESSCHAIN_CONTEXT_MEMORY_DESKTOP_STAGE: "canonical_default",
          },
          scopeKey: "desktop:writer-probe",
          replacement: "memory/propose",
        }),
      "CONTEXT_MEMORY_LEGACY_WRITER_FENCED",
    ),
    promptCompressor: await expectFenceAsync(
      () => PromptCompressor.prototype.compress.call({}, []),
      "CONTEXT_MEMORY_LEGACY_WRITER_FENCED",
    ),
    permanentMemory: await expectFenceAsync(
      () => PermanentMemoryManager.prototype.writeDailyNote.call({}, "legacy"),
      "CONTEXT_MEMORY_LEGACY_WRITER_FENCED",
    ),
    hierarchicalMemory: expectFence(
      () => DesktopHierarchicalMemory.prototype.store.call({}, "legacy"),
      "CONTEXT_MEMORY_LEGACY_WRITER_FENCED",
    ),
    memoryHierarchy: await expectFenceAsync(
      () => MemoryHierarchy.prototype.addMemory.call({}, { content: "legacy" }),
      "CONTEXT_MEMORY_LEGACY_WRITER_FENCED",
    ),
    memgpt: await expectFenceAsync(
      () => MemGPTCore.prototype.learnUserFact.call({}, "legacy"),
      "CONTEXT_MEMORY_LEGACY_WRITER_FENCED",
    ),
    memorySync: await expectFenceAsync(
      () => MemorySyncService.prototype.syncAll.call({}),
      "CONTEXT_MEMORY_LEGACY_WRITER_FENCED",
    ),
  };

  const vscode = resolveVscodeContextMemoryAuthority({ env: {} });
  assert.deepEqual(
    {
      stage: vscode.stage,
      canonical: vscode.canonical,
      projectionOnly: vscode.projectionOnly,
    },
    { stage: "canonical_default", canonical: true, projectionOnly: true },
  );

  const receipt = {
    schema: "chainlesschain.context-memory-writer-probe/v1",
    schemaVersion: 1,
    candidateSha: exactCandidateSha,
    platform: platformName(),
    status: "passed",
    staticCallGraph: {
      inventoryDigest: staticResult.digest,
      classifiedFileCount: staticResult.classifiedFileCount,
      unknownWriterCount: staticResult.unknownWriterCount,
      canonicalRuntimeCount: inventory.entries.filter(
        (entry) => entry.role === "canonical_runtime",
      ).length,
      writableLegacyCount: writableLegacy.length,
      nodeCount: callGraphNodes.size,
      edgeCount: callGraphEdgeCount,
      graphDigest: canonicalDigest(
        callGraph,
        "chainlesschain.context-memory-static-call-graph/v1",
      ),
    },
    runtime: {
      cli: {
        canonicalMutationStatus: cliMutation.receipt.status,
        canonicalStoreCreated: true,
        legacyWriters: legacyCli,
      },
      desktop: {
        forwardedMethods: forwarded.map((entry) => entry.method),
        legacyWriters: legacyDesktop,
      },
      vscode: {
        stage: vscode.stage,
        projectionOnly: vscode.projectionOnly,
      },
    },
  };
  receipt.digest = canonicalDigest(receipt, receipt.schema);
  const output = `${JSON.stringify(receipt, null, 2)}\n`;
  const outputPath = option("--output");
  if (outputPath) writeFileSync(outputPath, output, "utf8");
  else process.stdout.write(output);
} finally {
  if (previousStage === undefined) {
    delete process.env.CHAINLESSCHAIN_CONTEXT_MEMORY_CLI_STAGE;
  } else {
    process.env.CHAINLESSCHAIN_CONTEXT_MEMORY_CLI_STAGE = previousStage;
  }
  if (previousDesktopStage === undefined) {
    delete process.env.CHAINLESSCHAIN_CONTEXT_MEMORY_DESKTOP_STAGE;
  } else {
    process.env.CHAINLESSCHAIN_CONTEXT_MEMORY_DESKTOP_STAGE =
      previousDesktopStage;
  }
  rmSync(directory, { recursive: true, force: true });
}
