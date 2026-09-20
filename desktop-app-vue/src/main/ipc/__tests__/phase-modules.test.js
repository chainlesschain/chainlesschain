/**
 * Phase Modules Smoke Test
 *
 * Locks in the H2 IPC Registry split: verifies each extracted phase
 * module exports the expected registrar function and that invoking
 * the registrar with a stubbed safeRegister wires the expected
 * number of safeRegister() calls.
 *
 * This is intentionally a thin contract test — it does NOT exercise
 * the underlying IPC handler code paths (covered by per-domain
 * `*-ipc.test.js` suites). Its purpose is to catch regressions in
 * the registrar plumbing introduced by the file split.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

const PHASE_MODULES = [
  {
    file: "../phases/phase-1-ai",
    exportName: "registerPhase1AI",
    // 16 safeRegister calls total: 15 unconditional + 1 gated on ragManager
    // (RAG IPC). With null deps, only the 15 unconditional fire. Legacy helper
    // renderer surfaces are retired after their internal consumers cut over.
    expectedRegistrations: 15,
    needsRegisteredModules: false,
  },
  {
    file: "../phases/phase-2-core",
    exportName: "registerPhase2Core",
    // 8 unconditional safeRegister calls (U-Key, Database, Database
    // Performance, FamilyGuard, Git, MCP Basic Config, System early,
    // Notification early)
    expectedRegistrations: 8,
    needsRegisteredModules: false,
  },
  {
    file: "../phases/phase-6-7-content",
    exportName: "registerPhases6to7Content",
    // 5 unconditional safeRegister (Office File, Template, Screenshot, PDF,
    // Document). Speech IPC is gated on app.initializeSpeechManager which is
    // null in stub deps. File/Knowledge/Prompt Template/Image/Video are
    // gated on their respective managers and don't fire with null deps.
    expectedRegistrations: 5,
    needsRegisteredModules: false,
  },
  {
    file: "../phases/phase-8-9-extras",
    exportName: "registerPhases8to9Extras",
    // 12 unconditional safeRegister calls fire with null stub deps:
    // Blockchain, Collaboration, Automation, Plugin, Sync, WebDAV, OSS,
    // Mobile Sync, Preference, Conversation, Config, Workflow. The rest are
    // gated on managers (llmManager / reviewManager / vcTemplateManager /
    // database / app.graphExtractor / creditScoreManager / fileImporter)
    // and don't fire with null deps.
    expectedRegistrations: 12,
    needsRegisteredModules: true,
  },
  {
    file: "../phases/phase-3-4-social",
    exportName: "registerPhases3to4Social",
    // 10 unconditional safeRegister calls (MTC, Social, Call, Album, Social
    // Collab, Community, Time Machine, Livestream, Future Social,
    // Organization). 6 others are gated on non-null managers and won't fire
    // with stub deps.
    expectedRegistrations: 10,
    needsRegisteredModules: true,
  },
  {
    file: "../phases/phase-5-project",
    exportName: "registerPhase5Project",
    expectedRegistrations: 5, // Project Core/AI/Export/RAG/Git
    needsRegisteredModules: true,
  },
  {
    file: "../phases/phase-9-15-core",
    exportName: "registerPhases9to15",
    expectedRegistrations: 7, // Phases 9-15
    needsRegisteredModules: true,
  },
  {
    file: "../phases/phase-16-20-skill-evo",
    exportName: "registerPhases16to20",
    expectedRegistrations: 11, // Phase 16 (4) + 17 (1) + 18 (1) + 19 (4) + 20 (1) = 11
    needsRegisteredModules: true,
  },
  {
    file: "../phases/phase-21-30-enterprise",
    exportName: "registerPhases21to30",
    expectedRegistrations: 10, // Phases 21-30
    needsRegisteredModules: true,
  },
  {
    file: "../phases/phase-31-ai-models",
    exportName: "registerPhase31",
    expectedRegistrations: 7, // Benchmark, MemAug, DualModel, Quant, FineTune, Whisper, FedLearn
    needsRegisteredModules: false,
  },
  {
    file: "../phases/phase-33-40-collab-ops",
    exportName: "registerPhases33to40",
    expectedRegistrations: 8, // Phases 33-40
    needsRegisteredModules: true,
  },
  {
    file: "../phases/phase-41-evomap-gep",
    exportName: "registerPhase41",
    expectedRegistrations: 1,
    needsRegisteredModules: true,
  },
  {
    file: "../phases/phase-42-50-v1-1",
    exportName: "registerPhases42to50",
    expectedRegistrations: 9, // Phases 42-50
    needsRegisteredModules: true,
  },
  {
    file: "../phases/phase-51-57-v1-1",
    exportName: "registerPhases51to57",
    expectedRegistrations: 7, // Phases 51-57
    needsRegisteredModules: true,
  },
  {
    file: "../phases/phase-58-77-v2-v3",
    exportName: "registerPhases58to77",
    expectedRegistrations: 20, // Phases 58-77
    needsRegisteredModules: true,
  },
  {
    file: "../phases/phase-q1-2027",
    exportName: "registerPhaseQ12027",
    expectedRegistrations: 5, // WebAuthn, ZKP, FL, IPFS Cluster, GraphQL
    needsRegisteredModules: false,
  },
];

describe("ipc/phases — extracted phase module contracts", () => {
  let safeRegister;
  let logger;

  beforeEach(() => {
    safeRegister = vi.fn(() => true);
    logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
  });

  for (const spec of PHASE_MODULES) {
    describe(spec.file, () => {
      it(`exports ${spec.exportName}`, () => {
        const mod = require(spec.file);
        expect(typeof mod[spec.exportName]).toBe("function");
      });

      it(`calls safeRegister exactly ${spec.expectedRegistrations} times`, () => {
        const mod = require(spec.file);
        const registrar = mod[spec.exportName];

        // Minimal deps — registrar functions defer all module loading
        // into safeRegister callbacks, which we never invoke here.
        const deps = {
          database: null,
          mainWindow: null,
          app: null,
          llmManager: null,
          p2pManager: null,
          hookSystem: null,
        };
        const registeredModules = {};

        const args = { safeRegister, logger, deps };
        if (spec.needsRegisteredModules) {
          args.registeredModules = registeredModules;
        }

        registrar(args);

        expect(safeRegister).toHaveBeenCalledTimes(spec.expectedRegistrations);
      });

      it("registers each phase with a callable register() option", () => {
        const mod = require(spec.file);
        const registrar = mod[spec.exportName];
        const args = { safeRegister, logger, deps: { database: null } };
        if (spec.needsRegisteredModules) {
          args.registeredModules = {};
        }
        registrar(args);

        for (const call of safeRegister.mock.calls) {
          const [name, options] = call;
          expect(typeof name).toBe("string");
          expect(name.length).toBeGreaterThan(0);
          expect(options).toBeTypeOf("object");
          expect(typeof options.register).toBe("function");
        }
      });
    });
  }

  it("keeps the retired Context Engineering IPC surface out of Phase 1", () => {
    const { registerPhase1AI } = require("../phases/phase-1-ai");
    registerPhase1AI({ safeRegister, logger, deps: { database: null } });

    expect(safeRegister.mock.calls.map(([name]) => name)).not.toContain(
      "Context Engineering IPC",
    );
    const legacyHelpers = require("../../llm/context-engineering-ipc");
    expect(legacyHelpers.registerContextEngineeringIPC).toBeUndefined();
    expect(legacyHelpers.unregisterContextEngineeringIPC).toBeUndefined();
    expect(Object.keys(legacyHelpers).sort()).toEqual(
      [
        "TokenEstimator",
        "getOrCreateCompressor",
        "getOrCreateContextEngineering",
        "getTokenEstimator",
      ].sort(),
    );
  });

  it("keeps the internal Message Aggregator out of the renderer IPC surface", () => {
    const { registerPhase1AI } = require("../phases/phase-1-ai");
    registerPhase1AI({ safeRegister, logger, deps: { database: null } });

    expect(safeRegister.mock.calls.map(([name]) => name)).not.toContain(
      "Message Aggregator IPC",
    );
    const internalAggregator = require("../../utils/message-aggregator");
    expect(internalAggregator.registerMessageAggregatorIPC).toBeUndefined();
    expect(Object.keys(internalAggregator).sort()).toEqual(
      [
        "MessageAggregator",
        "destroyGlobalAggregator",
        "getMessageAggregator",
      ].sort(),
    );
  });

  it("keeps the internal Progress Emitter out of the renderer IPC surface", () => {
    const { registerPhase1AI } = require("../phases/phase-1-ai");
    registerPhase1AI({ safeRegister, logger, deps: { database: null } });

    expect(safeRegister.mock.calls.map(([name]) => name)).not.toContain(
      "Progress Emitter IPC",
    );
    const InternalProgressEmitter = require("../../utils/progress-emitter");
    expect(InternalProgressEmitter.registerProgressEmitterIPC).toBeUndefined();
    expect(typeof InternalProgressEmitter).toBe("function");
    expect(Object.keys(InternalProgressEmitter).sort()).toEqual(
      ["DEFAULT_LIMITS", "HARD_LIMITS", "Stage"].sort(),
    );
  });

  it("keeps the internal Resource Monitor out of the renderer IPC surface", () => {
    const { registerPhase1AI } = require("../phases/phase-1-ai");
    registerPhase1AI({ safeRegister, logger, deps: { database: null } });

    expect(safeRegister.mock.calls.map(([name]) => name)).not.toContain(
      "Resource Monitor IPC",
    );
    const internalMonitor = require("../../utils/resource-monitor");
    expect(internalMonitor.registerResourceMonitorIPC).toBeUndefined();
    expect(Object.keys(internalMonitor).sort()).toEqual(
      ["ResourceMonitor", "getResourceMonitor"].sort(),
    );
  });

  it("keeps the internal Web Search utility out of the renderer IPC surface", () => {
    const { registerPhase1AI } = require("../phases/phase-1-ai");
    registerPhase1AI({ safeRegister, logger, deps: { database: null } });

    expect(safeRegister.mock.calls.map(([name]) => name)).not.toContain(
      "Web Search IPC",
    );
    const internalSearch = require("../../utils/web-search");
    expect(internalSearch.registerWebSearchIPC).toBeUndefined();
    expect(Object.keys(internalSearch).sort()).toEqual(
      [
        "enhanceChatWithSearch",
        "formatSearchResults",
        "search",
        "searchBing",
        "searchDuckDuckGo",
      ].sort(),
    );
  });

  it("keeps HookSystem internal while omitting the renderer Hooks IPC", () => {
    const { registerPhase1AI } = require("../phases/phase-1-ai");
    const { getHookSystem } = require("../../hooks");
    const result = registerPhase1AI({
      safeRegister,
      logger,
      deps: { database: null },
    });

    expect(safeRegister.mock.calls.map(([name]) => name)).not.toContain(
      "Hooks IPC",
    );
    expect(result.hookSystem).toBe(getHookSystem());
    expect(require("../../hooks").registerHooksIPC).toBeUndefined();
  });

  it("keeps PlanModeManager internal while omitting its renderer IPC", () => {
    const { registerPhase1AI } = require("../phases/phase-1-ai");
    const {
      getPlanModeManager,
    } = require("../../ai-engine/plan-mode");
    const result = registerPhase1AI({
      safeRegister,
      logger,
      deps: { database: null },
    });

    expect(safeRegister.mock.calls.map(([name]) => name)).not.toContain(
      "Plan Mode IPC",
    );
    expect(getPlanModeManager().hookSystem).toBe(result.hookSystem);
  });
});
