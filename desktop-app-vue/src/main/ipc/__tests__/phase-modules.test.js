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
    file: "../phases/phase-31-ai-models",
    exportName: "registerPhase31",
    expectedRegistrations: 7, // Benchmark, MemAug, DualModel, Quant, FineTune, Whisper, FedLearn
    needsRegisteredModules: false,
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
});
