import { afterEach, describe, it, expect, vi } from "vitest";
import { readFileSync } from "fs";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "url";
import { join, dirname } from "path";
import {
  dispatchManifestEntry,
  isFastReadOnlyInvocation,
  prepareInvocation,
  resolveCommandToken,
  withDefaultEventRuntimeLifecycle,
} from "../../src/lazy-dispatch.js";
import { createProgram } from "../../src/index.js";
import { EventRuntimeStore } from "../../src/lib/event-runtime-store.js";
import { _resetDefaultEventRuntimeHostForTests } from "../../src/lib/event-runtime-host.js";

const cliRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const manifest = JSON.parse(
  readFileSync(join(cliRoot, "src", "command-manifest.json"), "utf-8"),
);
const helpIndex = JSON.parse(
  readFileSync(join(cliRoot, "src", "command-help-index.json"), "utf-8"),
);
const runtimeDirs = [];

afterEach(() => {
  delete process.env.CC_EVENT_RUNTIME_DURABLE;
  _resetDefaultEventRuntimeHostForTests();
  for (const dir of runtimeDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("command manifest ⇄ eager program (drift guard)", () => {
  // The lazy dispatcher trusts the generated manifest to map a command name to
  // its module. If a command is added/removed/renamed without regenerating the
  // manifest (node scripts/gen-command-manifest.mjs), the lazy path would 404
  // it to the eager fallback (slow) or miss an alias. This test makes that a
  // red CI signal instead of a silent slowdown.
  const eager = createProgram();
  const eagerNames = eager.commands.map((c) => c.name()).sort();
  const manifestNames = manifest.commands.map((c) => c.name).sort();

  it("every eager top-level command is in the manifest", () => {
    const missing = eagerNames.filter((n) => !manifestNames.includes(n));
    expect(
      missing,
      `Run: node scripts/gen-command-manifest.mjs — missing: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("the manifest has no commands the eager program lacks", () => {
    const extra = manifestNames.filter((n) => !eagerNames.includes(n));
    expect(
      extra,
      `Stale manifest entries — run: node scripts/gen-command-manifest.mjs — extra: ${extra.join(", ")}`,
    ).toEqual([]);
  });

  it("manifest aliases match the eager program's aliases", () => {
    const eagerAliases = {};
    for (const c of eager.commands) eagerAliases[c.name()] = c.aliases().sort();
    for (const entry of manifest.commands) {
      const expected = eagerAliases[entry.name] || [];
      expect(
        (entry.aliases || []).slice().sort(),
        `aliases drift for "${entry.name}"`,
      ).toEqual(expected);
    }
  });

  it("describes the generated stable and compatibility surfaces", () => {
    expect(manifest.schema).toBe("chainlesschain.command-manifest.v3");
    expect(manifest.surface).toMatchObject({
      schema: "chainlesschain.command-surface.v2",
      defaultCommand: "agent",
      topLevelGrowth: {
        baselineCommandCount: 175,
        registeredCommandCount: 175,
        recommendedTopLevelCommandCount: 151,
        netGrowth: 0,
      },
    });

    const groupedCore = manifest.surface.coreGroups
      .flatMap((group) => group.commands)
      .sort();
    const taggedCore = manifest.commands
      .filter((entry) => entry.visibility === "core")
      .map((entry) => entry.name)
      .sort();
    expect(taggedCore).toEqual(groupedCore);

    for (const entry of manifest.commands) {
      expect(["stable", "compatibility"]).toContain(entry.stability);
      expect(["core", "extended"]).toContain(entry.visibility);
      expect(entry.category).toMatch(/^[a-z][a-z-]*$/);
      expect(
        entry.replacement === null || typeof entry.replacement === "string",
      ).toBe(true);
      expect(["active", "deprecated"]).toContain(entry.lifecycle?.state);
      if (entry.lifecycle?.state === "deprecated") {
        expect(entry.replacement).toMatch(/^lab [a-z0-9-]+$/);
        expect(entry.lifecycle).toMatchObject({
          minimumReleaseCycles: 2,
          releaseCycle: "minor",
        });
      }
    }
  });

  it("every manifest entry points at an importable module + register fn name", () => {
    for (const entry of manifest.commands) {
      expect(entry.module, `module for ${entry.name}`).toMatch(/^\.\/.+\.js$/);
      expect(entry.register, `register fn for ${entry.name}`).toMatch(
        /^register/,
      );
    }
  });

  it("the phase-0 help index covers every manifest command", () => {
    expect(helpIndex.commandCount).toBe(manifest.commandCount);
    expect(Object.keys(helpIndex.commands).sort()).toEqual(manifestNames);
    for (const entry of manifest.commands) {
      expect(helpIndex.commands[entry.name]).toContain(entry.name);
    }
  });

  it("the generated help text matches the canonical Commander commands", () => {
    for (const command of eager.commands) {
      command.configureHelp({ helpWidth: 80 });
      expect(
        helpIndex.commands[command.name()],
        `Run: node scripts/gen-command-help-index.mjs — stale help for ${command.name()}`,
      ).toBe(command.helpInformation());
    }
  });
});

describe("resolveCommandToken", () => {
  const argv = (...rest) => ["node", "cc", ...rest];

  it("returns the first positional as the command", () => {
    expect(resolveCommandToken(argv("status"))).toBe("status");
    expect(resolveCommandToken(argv("hub", "ask", "hi"))).toBe("hub");
  });

  it("skips leading global flags", () => {
    expect(resolveCommandToken(argv("--verbose", "status"))).toBe("status");
    expect(resolveCommandToken(argv("--quiet", "--verbose", "doctor"))).toBe(
      "doctor",
    );
  });

  it("skips global options with values before the command", () => {
    expect(
      resolveCommandToken(
        argv("--otlp-endpoint", "http://localhost:4318", "eval"),
      ),
    ).toBe("eval");
    expect(
      resolveCommandToken(
        argv("--otlp-endpoint=http://localhost:4318", "agent"),
      ),
    ).toBe("agent");
    expect(
      resolveCommandToken(argv("--jsii-runtime", "native", "status")),
    ).toBe("status");
  });

  it("returns null for version/help flags with no command", () => {
    expect(resolveCommandToken(argv("--version"))).toBeNull();
    expect(resolveCommandToken(argv("-v"))).toBeNull();
    expect(resolveCommandToken(argv("--help"))).toBeNull();
    expect(resolveCommandToken(argv())).toBeNull();
  });

  it("stops scanning at -- (end of options)", () => {
    expect(resolveCommandToken(argv("--", "status"))).toBeNull();
  });
});

describe("phase-1-only read paths", () => {
  const argv = (...rest) => ["node", "cc", ...rest];

  it("keeps quick status lightweight but sends deep/OTLP status to phase 2", () => {
    expect(isFastReadOnlyInvocation(argv("status"), {})).toBe(true);
    expect(isFastReadOnlyInvocation(argv("status", "--json"), {})).toBe(true);
    expect(isFastReadOnlyInvocation(argv("status", "--deep"), {})).toBe(false);
    expect(
      isFastReadOnlyInvocation(
        argv("--otlp-endpoint", "http://localhost:4318", "status"),
        {},
      ),
    ).toBe(false);
    expect(
      isFastReadOnlyInvocation(argv("status"), {
        OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318",
      }),
    ).toBe(false);
  });

  it("keeps canonical JSONL session show on the read-only cold path", () => {
    expect(
      isFastReadOnlyInvocation(
        argv("session", "show", "session-1", "--json"),
        {},
      ),
    ).toBe(true);
    expect(
      isFastReadOnlyInvocation(
        argv(
          "--otlp-endpoint",
          "http://localhost:4318",
          "session",
          "show",
          "session-1",
        ),
        {},
      ),
    ).toBe(false);
    expect(
      isFastReadOnlyInvocation(argv("session", "resume", "session-1"), {}),
    ).toBe(false);
  });
});

describe("phase-0 invocation", () => {
  const argv = (...rest) => ["node", "cc", ...rest];
  const output = () => {
    let value = "";
    return {
      stream: { isTTY: false, write: (chunk) => (value += String(chunk)) },
      value: () => value,
    };
  };

  it("renders version and manifest help without entering phase 1", async () => {
    const versionOut = output();
    const version = await prepareInvocation(argv("--version"), {
      stdout: versionOut.stream,
      stdin: { isTTY: false },
      version: "1.2.3",
    });
    expect(version).toMatchObject({ handled: true, kind: "version" });
    expect(versionOut.value()).toBe("1.2.3\n");

    const helpOut = output();
    const help = await prepareInvocation(argv("help"), {
      stdout: helpOut.stream,
      stdin: { isTTY: false },
    });
    expect(help).toMatchObject({ handled: true, kind: "help" });
    expect(helpOut.value()).toContain("Core commands:");
    expect(helpOut.value()).toContain("cc help --all");

    const jsonOut = output();
    await prepareInvocation(argv("help", "--json"), {
      stdout: jsonOut.stream,
      stdin: { isTTY: false },
    });
    const document = JSON.parse(jsonOut.value());
    expect(document).toMatchObject({
      schema: "chainlesschain.help.v1",
      scope: "core",
      defaultCommand: "agent",
      commandCount: 10,
    });
    expect(document.commands).toContainEqual(
      expect.objectContaining({
        name: "agent",
        stability: "stable",
        category: "code",
        visibility: "core",
        replacement: null,
        lifecycle: { state: "active" },
      }),
    );

    const allOut = output();
    await prepareInvocation(argv("help", "--all", "--json"), {
      stdout: allOut.stream,
      stdin: { isTTY: false },
    });
    const allDocument = JSON.parse(allOut.value());
    expect(allDocument.commandCount).toBe(manifest.commandCount);
    expect(allDocument.commands).toContainEqual(
      expect.objectContaining({
        name: "setup",
        category: "compatibility",
        visibility: "extended",
      }),
    );
  });

  it("routes an empty TTY invocation to the interactive agent", async () => {
    const prepared = await prepareInvocation(argv("--verbose"), {
      stdin: { isTTY: true },
      stdout: { isTTY: true, write: vi.fn() },
    });
    expect(prepared).toEqual({
      handled: false,
      argv: argv("--verbose", "agent"),
      kind: "default-agent",
    });
  });

  it("routes piped text to a headless agent and empty input to help", async () => {
    const promptOut = output();
    const prompt = await prepareInvocation(argv(), {
      stdin: { isTTY: false },
      stdout: promptOut.stream,
      readStdin: async () => "fix the failing test\n",
    });
    expect(prompt).toEqual({
      handled: false,
      argv: argv("agent", "--print=fix the failing test\n"),
      kind: "default-agent-stdin",
    });

    const optionLikePrompt = await prepareInvocation(argv(), {
      stdin: { isTTY: false },
      stdout: promptOut.stream,
      readStdin: async () => "--explain this flag",
    });
    expect(optionLikePrompt.argv).toEqual(
      argv("agent", "--print=--explain this flag"),
    );

    const emptyOut = output();
    const empty = await prepareInvocation(argv(), {
      stdin: { isTTY: false },
      stdout: emptyOut.stream,
      readStdin: async () => "",
    });
    expect(empty).toMatchObject({
      handled: true,
      kind: "non-interactive-help",
    });
    expect(emptyOut.value()).toContain("Usage: cc");
  });

  it("renders generated command help without loading the command module", async () => {
    const helpOut = output();
    const prepared = await prepareInvocation(argv("help", "status"), {
      stdin: { isTTY: false },
      stdout: helpOut.stream,
    });
    expect(prepared).toMatchObject({ handled: true, kind: "command-help" });
    expect(helpOut.value()).toContain("Usage: chainlesschain status");
    expect(helpOut.value()).toContain("--deep");

    const directOut = output();
    const direct = await prepareInvocation(argv("status", "--help"), {
      stdin: { isTTY: false },
      stdout: directOut.stream,
    });
    expect(direct).toMatchObject({ handled: true, kind: "command-help" });
    expect(directOut.value()).toBe(helpOut.value());
  });

  it("defers nested command help to the domain registrar", async () => {
    for (const args of [
      ["cli-anything", "doctor", "--help"],
      ["learning", "stats", "--help"],
      ["evomap", "federation", "--help"],
      ["dao", "propose", "--help"],
      ["scim", "users", "list", "--help"],
      ["hardening", "baseline", "--help"],
      ["social", "contact", "--help"],
      ["cowork", "debate", "--help"],
      ["lowcode", "deploy", "--help"],
      ["skill", "sync-cli", "--help"],
      ["crosschain", "bridge", "--help"],
      ["mtc", "federation", "--help"],
      ["audit", "mtc", "--help"],
      ["pair", "token", "--help"],
    ]) {
      const nestedOut = output();
      const prepared = await prepareInvocation(argv(...args), {
        stdin: { isTTY: false },
        stdout: nestedOut.stream,
        stderr: output().stream,
      });
      expect(prepared).toEqual({
        handled: false,
        argv: argv(...args),
        kind: "command",
      });
      expect(nestedOut.value()).toBe("");
    }
  });
});

describe("lazy action execution boundary", () => {
  const entry = {
    name: "mutate",
    module: "./commands/mutate.js",
    register: "registerMutateCommand",
  };

  it("never falls back after parseAsync starts and an action fails", async () => {
    const actionError = new Error("failed after side effect");
    let sideEffects = 0;
    const loadFullProgram = vi.fn();

    await expect(
      dispatchManifestEntry(["node", "cc", "mutate"], entry, {
        createBaseProgram: async () => ({
          parseAsync: async () => {
            sideEffects++;
            throw actionError;
          },
        }),
        loadCommandModule: async () => ({
          registerMutateCommand: () => {},
        }),
        loadFullProgram,
      }),
    ).rejects.toBe(actionError);

    expect(sideEffects).toBe(1);
    expect(loadFullProgram).not.toHaveBeenCalled();
  });

  it("may use the compatibility program before parse when registration fails", async () => {
    const parseAsync = vi.fn(async () => {});
    const loadFullProgram = vi.fn(async () => ({ parseAsync }));
    await dispatchManifestEntry(["node", "cc", "mutate"], entry, {
      createBaseProgram: async () => ({}),
      loadCommandModule: async () => ({}),
      loadFullProgram,
    });
    expect(loadFullProgram).toHaveBeenCalledOnce();
    expect(parseAsync).toHaveBeenCalledOnce();
  });
});

describe("lazy binary Event Runtime lifecycle", () => {
  it("starts after handler registration and final-drains a short command", async () => {
    const dir = fs.mkdtempSync(join(os.tmpdir(), "cc-lazy-event-runtime-"));
    runtimeDirs.push(dir);
    const store = new EventRuntimeStore({ dir, owner: "lazy-host" });
    process.env.CC_EVENT_RUNTIME_DURABLE = "1";

    await withDefaultEventRuntimeLifecycle(
      async (host) => {
        expect(host?.status()).toMatchObject({
          running: true,
          id: "lazy-host",
        });
        host.registerHandler(() => ({ from: "lazy-command" }), {
          type: "lazy.short",
        });
        store.enqueueInbox({
          event_id: "lazy-short-1",
          type: "lazy.short",
          requiresHandler: true,
        });
      },
      { hostOptions: { store } },
    );

    expect(store.listInbox()[0]).toMatchObject({
      status: "done",
      result: expect.objectContaining({ handlerCount: 1 }),
    });
    expect(store.getHealthSnapshot().hosts).toMatchObject({
      running: 0,
      stopped: 1,
    });
  });
});
