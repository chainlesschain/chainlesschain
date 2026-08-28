import nativeFs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const {
  FILESYSTEM_BROKER_BRAND,
  bundledSkillFs,
  createBundledSkillFilesystemBroker,
  requireBundledSkillFilesystemBroker,
  withBundledSkillFilesystem,
} = require("../bundled-skill-filesystem-broker.js");
const {
  BUNDLED_SKILL_CAPABILITY_CATALOG,
} = require("../bundled-skill-capability-catalog.js");

const MIGRATED_FILESYSTEM_HANDLERS = Object.freeze(
  Object.values(BUNDLED_SKILL_CAPABILITY_CATALOG)
    .filter(({ executionCapabilities }) =>
      executionCapabilities.includes("host:filesystem"),
    )
    .map(({ skillId }) => skillId)
    .sort(),
);
const roots = [];

function temporaryRoot(label) {
  const root = nativeFs.mkdtempSync(path.join(os.tmpdir(), `${label}-`));
  roots.push(root);
  return root;
}

function createBroker(skillId, root, overrides = {}) {
  const auditEvents = [];
  const broker = createBundledSkillFilesystemBroker(
    {
      skillId,
      authorityId: `test:${skillId}`,
      allowedRoots: [root],
      allowedOperations: [
        "appendFileSync",
        "existsSync",
        "mkdirSync",
        "readFileSync",
        "readdirSync",
        "statSync",
        "unlinkSync",
        "writeFileSync",
      ],
      cwd: root,
      ...overrides.policy,
    },
    {
      invoke: ({ operation, args }) => nativeFs[operation](...args),
      auditSink: (event) => auditEvents.push(event),
      ...overrides.dependencies,
    },
  );
  return { broker, auditEvents };
}

function contextFor(broker) {
  return { host: { filesystem: broker } };
}

afterEach(() => {
  while (roots.length > 0) {
    nativeFs.rmSync(roots.pop(), { recursive: true, force: true });
  }
});

describe("bundled Skill filesystem broker", () => {
  it("routes bounded reads and writes through a branded exact-skill authority", () => {
    const root = temporaryRoot("cc-fs-broker");
    const { broker, auditEvents } = createBroker("csv-processor", root);
    const handler = withBundledSkillFilesystem("csv-processor", {
      execute() {
        bundledSkillFs.mkdirSync("reports", { recursive: true });
        bundledSkillFs.writeFileSync("reports/result.txt", "safe", "utf8");
        return bundledSkillFs.readFileSync("reports/result.txt", "utf8");
      },
    });

    expect(handler.execute({}, contextFor(broker))).toBe("safe");
    expect(broker[FILESYSTEM_BROKER_BRAND]).toBe(true);
    expect(auditEvents.map((event) => event.operation)).toEqual([
      "mkdirSync",
      "writeFileSync",
      "readFileSync",
    ]);
    expect(JSON.stringify(auditEvents)).not.toContain("reports/result.txt");
    expect(
      auditEvents.every((event) => /^[a-f0-9]{64}$/.test(event.pathSha256)),
    ).toBe(true);
  });

  it("denies lexical and symlink escapes before calling the host adapter", () => {
    const root = temporaryRoot("cc-fs-root");
    const outside = temporaryRoot("cc-fs-outside");
    const calls = [];
    const { broker } = createBroker("data-exporter", root, {
      dependencies: {
        invoke: ({ operation, args }) => {
          calls.push({ operation, args });
          return nativeFs[operation](...args);
        },
        auditSink: () => {},
      },
    });
    const handler = withBundledSkillFilesystem("data-exporter", {
      execute(task) {
        return bundledSkillFs.writeFileSync(task.path, "denied", "utf8");
      },
    });

    expect(() =>
      handler.execute(
        { path: path.join(root, "..", "escape.txt") },
        contextFor(broker),
      ),
    ).toThrow(/outside approved roots/i);
    expect(calls).toHaveLength(0);

    const link = path.join(root, "escape-link");
    nativeFs.symlinkSync(outside, link, "junction");
    expect(() =>
      handler.execute(
        { path: path.join(link, "escape.txt") },
        contextFor(broker),
      ),
    ).toThrow(/outside approved roots/i);
    expect(calls).toHaveLength(0);

    const readHandler = withBundledSkillFilesystem("data-exporter", {
      execute(task) {
        return bundledSkillFs.readFileSync(task.path, "utf8");
      },
    });
    expect(() =>
      readHandler.execute(
        { path: path.join(link, "missing.txt") },
        contextFor(broker),
      ),
    ).toThrow(/outside approved roots/i);
    expect(calls).toHaveLength(0);
  });

  it("enforces exact operations and read/write/directory bounds", () => {
    const root = temporaryRoot("cc-fs-bounds");
    nativeFs.writeFileSync(path.join(root, "large.txt"), "12345", "utf8");
    nativeFs.mkdirSync(path.join(root, "entries"));
    nativeFs.writeFileSync(path.join(root, "entries", "a"), "a");
    nativeFs.writeFileSync(path.join(root, "entries", "b"), "b");
    const { broker } = createBroker("rules-engine", root, {
      policy: {
        allowedOperations: ["readFileSync", "readdirSync", "writeFileSync"],
        maxReadBytes: 4,
        maxWriteBytes: 4,
        maxDirectoryEntries: 1,
      },
    });

    expect(() => broker.invoke("unlinkSync", ["large.txt"])).toThrow(
      /not approved/i,
    );
    expect(() => broker.invoke("readFileSync", ["large.txt", "utf8"])).toThrow(
      /read exceeded/i,
    );
    expect(() =>
      broker.invoke("writeFileSync", ["out.txt", "12345", "utf8"]),
    ).toThrow(/write exceeded/i);
    expect(() => broker.invoke("readdirSync", ["entries"])).toThrow(
      /directory result exceeded/i,
    );
  });

  it("fails closed for missing, forged, or cross-skill authority", () => {
    const root = temporaryRoot("cc-fs-authority");
    const { broker } = createBroker("word-generator", root);
    expect(() =>
      requireBundledSkillFilesystemBroker({}, "word-generator"),
    ).toThrow(/branded filesystem authority is required/i);
    expect(() =>
      requireBundledSkillFilesystemBroker(
        {
          host: {
            filesystem: {
              [FILESYSTEM_BROKER_BRAND]: true,
              skillId: "word-generator",
              invoke() {},
            },
          },
        },
        "word-generator",
      ),
    ).toThrow(/branded filesystem authority is required/i);
    expect(() =>
      requireBundledSkillFilesystemBroker(
        contextFor(broker),
        "subtitle-generator",
      ),
    ).toThrow(/branded filesystem authority is required/i);
  });

  it("fails closed when a wrapped handler reaches filesystem without authority", () => {
    const handler = withBundledSkillFilesystem("markdown-enhancer", {
      execute() {
        return bundledSkillFs.existsSync("README.md");
      },
    });
    expect(() => handler.execute({}, {})).toThrow(
      /branded filesystem authority is required/i,
    );
  });

  it("keeps concurrent execution authorities isolated across async boundaries", async () => {
    const firstRoot = temporaryRoot("cc-fs-first");
    const secondRoot = temporaryRoot("cc-fs-second");
    nativeFs.writeFileSync(path.join(firstRoot, "value.txt"), "first");
    nativeFs.writeFileSync(path.join(secondRoot, "value.txt"), "second");
    const first = createBroker("memory-insights", firstRoot).broker;
    const second = createBroker("memory-insights", secondRoot).broker;
    const handler = withBundledSkillFilesystem("memory-insights", {
      async execute() {
        await Promise.resolve();
        return bundledSkillFs.readFileSync("value.txt", "utf8");
      },
    });

    await expect(
      Promise.all([
        handler.execute({}, contextFor(first)),
        handler.execute({}, contextFor(second)),
      ]),
    ).resolves.toEqual(["first", "second"]);
  });

  it("bounds watcher events and returns only a close capability", () => {
    const root = temporaryRoot("cc-fs-watch");
    let adapterListener;
    const close = vi.fn();
    const { broker, auditEvents } = createBroker("proactive-agent", root, {
      policy: {
        allowedOperations: ["watch"],
        maxWatchEvents: 1,
        maxWatcherLifetimeMs: 1_000,
      },
      dependencies: {
        invoke: ({ operation, args }) => {
          expect(operation).toBe("watch");
          adapterListener = args[2];
          return { close };
        },
      },
    });
    const events = [];
    const handler = withBundledSkillFilesystem("proactive-agent", {
      execute() {
        return bundledSkillFs.watch(
          ".",
          { recursive: true },
          (eventType, filename) => events.push({ eventType, filename }),
        );
      },
    });

    const watcher = handler.execute({}, contextFor(broker));
    expect(Object.keys(watcher)).toEqual(["close"]);
    adapterListener("change", "safe.txt");
    adapterListener("rename", "over-limit.txt");
    expect(events).toEqual([{ eventType: "change", filename: "safe.txt" }]);
    expect(close).toHaveBeenCalledOnce();
    expect(
      auditEvents.some((event) => event.reason === "watch_event_limit_reached"),
    ).toBe(true);
  });

  it("routes stream processing through a bounded whole-file read", async () => {
    const root = temporaryRoot("cc-fs-stream");
    nativeFs.writeFileSync(
      path.join(root, "events.log"),
      "[INFO] started\n[ERROR] failed\n",
      "utf8",
    );
    const { broker, auditEvents } = createBroker("stream-processor", root, {
      policy: { allowedOperations: ["existsSync", "readFileSync"] },
    });
    const handler = require("../builtin/stream-processor/handler.js");

    const result = await handler.execute(
      { input: "events.log" },
      contextFor(broker),
    );

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ totalLines: 2, matchedLines: 2 });
    expect(auditEvents.map(({ operation }) => operation)).toEqual([
      "existsSync",
      "readFileSync",
    ]);
  });

  it("keeps every filesystem handler free of native fs imports and wrapped", () => {
    expect(MIGRATED_FILESYSTEM_HANDLERS).toHaveLength(84);
    for (const skillId of MIGRATED_FILESYSTEM_HANDLERS) {
      const source = nativeFs.readFileSync(
        path.join(__dirname, "..", "builtin", skillId, "handler.js"),
        "utf8",
      );
      expect(source).not.toMatch(/require\(["'](?:node:)?fs["']\)/);
      expect(source).not.toContain("_deps.fs");
      expect(source).toContain("bundled-skill-filesystem-broker.js");
      expect(source).toMatch(
        new RegExp(
          `withBundledSkillFilesystem\\(\\s*["']${skillId}["']\\s*,\\s*module\\.exports\\s*,?\\s*\\)`,
        ),
      );
    }

    const builtinDirectory = path.join(__dirname, "..", "builtin");
    for (const entry of nativeFs.readdirSync(builtinDirectory, {
      withFileTypes: true,
    })) {
      const handlerPath = path.join(builtinDirectory, entry.name, "handler.js");
      if (!entry.isDirectory() || !nativeFs.existsSync(handlerPath)) continue;
      const source = nativeFs.readFileSync(handlerPath, "utf8");
      expect(source, entry.name).not.toMatch(/require\(["'](?:node:)?fs["']\)/);
    }
  });
});
