import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => "."),
  },
}));

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { InitializerFactory } = require("../initializer-factory");
const { INIT_PHASES } = require("../index");
const { registerSocialInitializers } = require("../social-initializer");
const {
  ACTIVE_SOCIAL_MODULES,
  DORMANT_SOCIAL_MODULES,
  SOCIAL_ACTIVE_LIFECYCLE_MODULES,
  SOCIAL_BUSINESS_MANAGER_CLEANUP,
  SOCIAL_COLLAB_MANAGER_CLEANUP,
  SOCIAL_ENTERPRISE_MANAGER_CLEANUP,
  SOCIAL_FOUNDATION_MANAGER_CLEANUP,
  SOCIAL_INITIALIZER_MODULES,
  SOCIAL_PASSIVE_MODULES,
  SOCIAL_REMOTE_MANAGER_CLEANUP,
  SOCIAL_RUNTIME_MANAGER_CLEANUP,
  SOCIAL_STARTUP_PHASE_MODULES,
  applySocialStartupPolicy,
} = require("../social-startup-policy");

function createRegisteredFactory() {
  const factory = new InitializerFactory();
  registerSocialInitializers(factory);
  return factory;
}

describe("social startup policy", () => {
  it("classifies every social initializer exactly once", () => {
    const factory = createRegisteredFactory();
    const registered = [...factory.initializers.keys()];
    const classified = [...SOCIAL_INITIALIZER_MODULES];

    expect(new Set(classified).size).toBe(classified.length);
    expect(registered.sort()).toEqual(classified.sort());
    expect(new Set(ACTIVE_SOCIAL_MODULES).size).toBe(
      ACTIVE_SOCIAL_MODULES.length,
    );
    expect(new Set(DORMANT_SOCIAL_MODULES).size).toBe(
      DORMANT_SOCIAL_MODULES.length,
    );
  });

  it("marks dormant managers lazy and excludes them from every startup phase", () => {
    const factory = createRegisteredFactory();
    const phasedModules = INIT_PHASES.flatMap((phase) => phase.modules);

    for (const name of DORMANT_SOCIAL_MODULES) {
      expect(factory.initializers.get(name)?.lazy, name).toBe(true);
      expect(phasedModules, name).not.toContain(name);
    }

    for (const name of ACTIVE_SOCIAL_MODULES) {
      expect(factory.initializers.get(name)?.lazy, name).toBe(false);
      expect(
        phasedModules.filter((moduleName) => moduleName === name),
        name,
      ).toHaveLength(1);
    }

    for (const [phase, modules] of Object.entries(
      SOCIAL_STARTUP_PHASE_MODULES,
    )) {
      for (const name of modules) {
        expect(phasedModules, "phase " + phase + ": " + name).toContain(name);
      }
    }
  });

  it("still skips dormant managers if a phase accidentally names them", async () => {
    const factory = createRegisteredFactory();
    const dormantInitializers = DORMANT_SOCIAL_MODULES.map((name) => {
      const initializer = factory.initializers.get(name);
      initializer.init = vi.fn();
      return initializer;
    });

    await factory.runPhased(
      [
        {
          name: "dormant regression probe",
          progress: 1,
          modules: DORMANT_SOCIAL_MODULES,
        },
      ],
      {},
    );

    for (const initializer of dormantInitializers) {
      expect(initializer.init).not.toHaveBeenCalled();
    }
    expect(factory.getAllInstances()).toEqual({});
  });

  it("fails closed when a new social initializer has no policy entry", () => {
    expect(() =>
      applySocialStartupPolicy({
        name: "unclassifiedManager",
        init: vi.fn(),
      }),
    ).toThrow(/Unclassified social initializer/);
  });

  it("does not hoist or expose dormant managers through the main IPC bag", () => {
    const testDirectory = path.dirname(fileURLToPath(import.meta.url));
    const mainSource = readFileSync(
      path.resolve(testDirectory, "..", "..", "index.js"),
      "utf8",
    );

    for (const name of DORMANT_SOCIAL_MODULES) {
      expect(mainSource, name).not.toContain(
        `this.${name} = instances.${name}`,
      );
      expect(mainSource, name).not.toContain(`${name}: this.${name}`);
    }
  });

  it("makes main own and close active wiring handles in dependency order", () => {
    const testDirectory = path.dirname(fileURLToPath(import.meta.url));
    const mainSource = readFileSync(
      path.resolve(testDirectory, "..", "..", "index.js"),
      "utf8",
    );

    for (const name of ["mtcAutoBridge", "gossipReceiver"]) {
      expect(mainSource).toContain(`this.${name} = instances.${name}`);
    }
    expect(SOCIAL_RUNTIME_MANAGER_CLEANUP).toEqual([
      ["gossipReceiver", "close"],
      ["mtcAutoBridge", "close"],
      ["channelEnvelopeDistribution", "close"],
      ["autoArchiveScheduler", "stop"],
      ["channelEventBatcher", "close"],
      ["mtcFederationManager", "close"],
    ]);
    expect(mainSource).toContain(
      "cleanupOwnedManagers(this, SOCIAL_RUNTIME_MANAGER_CLEANUP",
    );
  });

  it("classifies every active manager as bounded cleanup or passive", () => {
    expect(SOCIAL_ACTIVE_LIFECYCLE_MODULES).toHaveLength(
      ACTIVE_SOCIAL_MODULES.length,
    );
    expect(new Set(SOCIAL_ACTIVE_LIFECYCLE_MODULES)).toEqual(
      new Set(ACTIVE_SOCIAL_MODULES),
    );
    expect(SOCIAL_PASSIVE_MODULES).toEqual([
      "crossFedTrust",
      "governanceMultiSig",
      "channelEnvelopeArchiver",
      "archiveProviderFactory",
    ]);

    const testDirectory = path.dirname(fileURLToPath(import.meta.url));
    for (const fileName of [
      "cross-fed-trust.js",
      "governance-multisig.js",
      "channel-envelope-archiver.js",
      "archive-provider-factory.js",
    ]) {
      const source = readFileSync(
        path.resolve(testDirectory, "..", "..", "mtc", fileName),
        "utf8",
      );
      expect(source, fileName).not.toMatch(
        /setInterval\(|setTimeout\(|\.on\(|addEventListener\(|\.handle\(/,
      );
    }
  });

  it("closes all active resource owners in dependency order", () => {
    expect(SOCIAL_COLLAB_MANAGER_CLEANUP).toEqual([
      ["collabSync", "destroy"],
      ["collabAwareness", "destroy"],
      ["collabEngine", "destroy"],
      ["gossipProtocol", "destroy"],
    ]);
    expect(SOCIAL_ENTERPRISE_MANAGER_CLEANUP).toEqual([
      ["collaborationManager", "stopServer"],
      ["syncEngine", "close"],
      ["organizationManager", "close"],
    ]);
    expect(SOCIAL_BUSINESS_MANAGER_CLEANUP).toEqual([
      ["governanceEngine", "close"],
      ["contentModerator", "close"],
      ["vcTemplateManager", "close"],
      ["vcManager", "close"],
      ["channelManager", "close"],
      ["communityManager", "close"],
      ["postManager", "close"],
      ["friendManager", "close"],
      ["contactManager", "close"],
    ]);
    expect(SOCIAL_FOUNDATION_MANAGER_CLEANUP).toEqual([
      ["didManager", "close"],
      ["p2pManager", "close"],
    ]);
    expect(SOCIAL_REMOTE_MANAGER_CLEANUP).toEqual([["remoteGateway", "stop"]]);
    for (const [name] of [
      ...SOCIAL_RUNTIME_MANAGER_CLEANUP,
      ...SOCIAL_COLLAB_MANAGER_CLEANUP,
      ...SOCIAL_ENTERPRISE_MANAGER_CLEANUP,
      ...SOCIAL_BUSINESS_MANAGER_CLEANUP,
      ...SOCIAL_REMOTE_MANAGER_CLEANUP,
      ...SOCIAL_FOUNDATION_MANAGER_CLEANUP,
    ]) {
      expect(ACTIVE_SOCIAL_MODULES).toContain(name);
    }

    const testDirectory = path.dirname(fileURLToPath(import.meta.url));
    const mainSource = readFileSync(
      path.resolve(testDirectory, "..", "..", "index.js"),
      "utf8",
    );
    const runtimeCleanup = mainSource.indexOf(
      "cleanupOwnedManagers(this, SOCIAL_RUNTIME_MANAGER_CLEANUP",
    );
    const collaborationCleanup = mainSource.indexOf(
      "cleanupOwnedManagers(this, SOCIAL_COLLAB_MANAGER_CLEANUP",
    );
    const enterpriseCleanup = mainSource.indexOf(
      "cleanupOwnedManagers(this, SOCIAL_ENTERPRISE_MANAGER_CLEANUP",
    );
    const businessCleanup = mainSource.indexOf(
      "cleanupOwnedManagers(this, SOCIAL_BUSINESS_MANAGER_CLEANUP",
    );
    const mobileCleanup = mainSource.indexOf("if (this.mobileBridge)");
    const remoteCleanup = mainSource.indexOf(
      "cleanupOwnedManagers(this, SOCIAL_REMOTE_MANAGER_CLEANUP",
    );
    const foundationCleanup = mainSource.indexOf(
      "cleanupOwnedManagers(this, SOCIAL_FOUNDATION_MANAGER_CLEANUP",
    );

    expect(runtimeCleanup).toBeGreaterThan(-1);
    expect(collaborationCleanup).toBeGreaterThan(runtimeCleanup);
    expect(enterpriseCleanup).toBeGreaterThan(collaborationCleanup);
    expect(businessCleanup).toBeGreaterThan(enterpriseCleanup);
    expect(mobileCleanup).toBeGreaterThan(businessCleanup);
    expect(remoteCleanup).toBeGreaterThan(mobileCleanup);
    expect(foundationCleanup).toBeGreaterThan(remoteCleanup);
  });
});
