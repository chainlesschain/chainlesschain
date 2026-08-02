import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  dispatchManifestEntry,
  formatCommandDeprecationWarning,
  prepareInvocation,
  resolveCommandLifecycleInvocation,
  runCli,
} from "../../src/lazy-dispatch.js";
import { validateCommandSurface } from "../../src/command-surface-policy.js";

const packageRoot = path.resolve(import.meta.dirname, "../..");
const repositoryRoot = path.resolve(packageRoot, "../..");
const manifest = JSON.parse(
  readFileSync(path.join(packageRoot, "src", "command-manifest.json"), "utf8"),
);
const argv = (...args) => ["node", "cc", ...args];

function output(isTTY = false) {
  let value = "";
  return {
    stream: { isTTY, write: (chunk) => (value += String(chunk)) },
    value: () => value,
  };
}

describe("command lifecycle policy", () => {
  it("keeps the actual canonical top-level graph at 175 with net growth zero", () => {
    expect(manifest.commandCount).toBe(175);
    expect(manifest.surface.topLevelGrowth).toEqual({
      baselineCommandCount: 175,
      maximumNetGrowth: 0,
      registeredCommandCount: 175,
      activeRegisteredCommandCount: 173,
      virtualNamespaceCount: 1,
      deprecatedCompatibilityCount: 2,
      recommendedTopLevelCommandCount: 174,
      netGrowth: 0,
    });
    expect(manifest.commands.some((entry) => entry.name === "lab")).toBe(false);

    const cliCi = readFileSync(
      path.join(repositoryRoot, ".github", "workflows", "cli-ci.yml"),
      "utf8",
    );
    expect(cliCi).toContain("npm run commands:manifest:check");

    expect(() =>
      validateCommandSurface([
        ...manifest.commands,
        {
          name: "accidental-top-level-growth",
          lifecycle: { state: "active" },
        },
      ]),
    ).toThrow("Top-level command net growth is 1; maximum is 0");

    expect(() =>
      validateCommandSurface(
        manifest.commands.map((entry, index) =>
          index === 0 ? { ...entry, aliases: ["lab"] } : entry,
        ),
      ),
    ).toThrow(
      "Virtual command namespace 'lab' collides with a registered top-level command or alias",
    );
  });

  it("enforces two numeric minor release cycles for each pilot migration", () => {
    expect(manifest.surface.lifecyclePolicy).toEqual({
      schema: "chainlesschain.command-lifecycle.v1",
      minimumCompatibilityReleaseCycles: 2,
      releaseCycle: "minor",
    });
    expect(manifest.surface.namespaces).toEqual([
      expect.objectContaining({ name: "lab", commands: ["dao", "evomap"] }),
    ]);

    for (const command of ["dao", "evomap"]) {
      const entry = manifest.commands.find(
        (candidate) => candidate.name === command,
      );
      const from = entry.lifecycle.deprecatedSince.split(".").map(Number);
      const until = entry.lifecycle.removalNotBefore.split(".").map(Number);
      expect(entry).toMatchObject({
        replacement: `lab ${command}`,
        lifecycle: {
          state: "deprecated",
          minimumReleaseCycles: 2,
          releaseCycle: "minor",
        },
      });
      expect(until[0]).toBe(from[0]);
      expect(until[1] - from[1]).toBeGreaterThanOrEqual(
        entry.lifecycle.minimumReleaseCycles,
      );
    }
  });
});

describe("phase-0 compatibility namespace", () => {
  it(
    "keeps the legacy binary behavior and forwards the new spelling to it",
    { timeout: 30_000 },
    () => {
      const binary = path.join(packageRoot, "bin", "chainlesschain.js");
      const run = (args) =>
        spawnSync(process.execPath, [binary, ...args], {
          cwd: packageRoot,
          encoding: "utf8",
          env: {
            ...process.env,
            CC_EVENT_RUNTIME_DURABLE: "0",
            NO_COLOR: "1",
          },
        });
      const legacy = run([
        "--quiet",
        "--verbose",
        "dao",
        "config-v2",
        "--json",
      ]);
      const replacement = run([
        "--quiet",
        "lab",
        "--verbose",
        "dao",
        "config-v2",
        "--json",
      ]);

      expect(legacy.status, legacy.stderr).toBe(0);
      expect(replacement.status, replacement.stderr).toBe(0);
      expect(JSON.parse(replacement.stdout)).toEqual(JSON.parse(legacy.stdout));
      expect(legacy.stderr).toContain("use 'cc lab dao'");
      expect(replacement.stderr).not.toContain("Deprecated command");
    },
  );

  it("rewrites lab commands to the exact same manifest route", () => {
    for (const command of ["dao", "evomap"]) {
      const legacyEntry = manifest.commands.find(
        (candidate) => candidate.name === command,
      );
      const resolved = resolveCommandLifecycleInvocation(
        argv("lab", command, "status", "--json"),
        manifest,
      );
      expect(resolved).toMatchObject({
        kind: "namespace-rewrite",
        entry: legacyEntry,
        argv: argv(command, "status", "--json"),
      });
      expect(resolved.entry).toBe(legacyEntry);
    }
  });

  it("preserves global flags and an end-of-options marker after the target", () => {
    expect(
      resolveCommandLifecycleInvocation(
        argv("--quiet", "lab", "--verbose", "dao", "stats", "--json"),
        manifest,
      ).argv,
    ).toEqual(argv("--quiet", "--verbose", "dao", "stats", "--json"));
    expect(
      resolveCommandLifecycleInvocation(
        argv(
          "--otlp-endpoint",
          "http://localhost:4318",
          "lab",
          "--jsii-runtime",
          "native",
          "evomap",
          "--",
          "--literal",
        ),
        manifest,
      ).argv,
    ).toEqual(
      argv(
        "--otlp-endpoint",
        "http://localhost:4318",
        "--jsii-runtime",
        "native",
        "evomap",
        "--",
        "--literal",
      ),
    );
  });

  it("handles lab help and command help without loading the full graph", async () => {
    const namespaceOut = output();
    const namespaceErr = output();
    expect(
      await prepareInvocation(argv("lab", "--help"), {
        manifestData: manifest,
        stdin: { isTTY: false },
        stdout: namespaceOut.stream,
        stderr: namespaceErr.stream,
      }),
    ).toMatchObject({ handled: true, kind: "namespace-help" });
    expect(namespaceOut.value()).toContain("Usage: cc lab <command>");
    expect(namespaceOut.value()).toContain("dao");
    expect(namespaceOut.value()).toContain("evomap");
    expect(namespaceErr.value()).toBe("");

    const namespaceJsonOut = output();
    await prepareInvocation(argv("help", "lab", "--json"), {
      manifestData: manifest,
      stdin: { isTTY: false },
      stdout: namespaceJsonOut.stream,
      stderr: output().stream,
    });
    expect(JSON.parse(namespaceJsonOut.value())).toMatchObject({
      schema: "chainlesschain.namespace-help.v1",
      name: "lab",
      commandCount: 2,
    });

    const legacyOut = output();
    const legacyErr = output();
    await prepareInvocation(argv("dao", "--help"), {
      manifestData: manifest,
      stdin: { isTTY: false },
      stdout: legacyOut.stream,
      stderr: legacyErr.stream,
    });
    const replacementOut = output();
    const replacementErr = output();
    await prepareInvocation(
      argv(
        "--quiet",
        "help",
        "--otlp-endpoint",
        "http://localhost:4318",
        "lab",
        "--verbose",
        "dao",
      ),
      {
        manifestData: manifest,
        stdin: { isTTY: false },
        stdout: replacementOut.stream,
        stderr: replacementErr.stream,
      },
    );
    expect(replacementOut.value()).toBe(legacyOut.value());
    expect(replacementErr.value()).toBe("");

    const reorderedReplacementOut = output();
    const reorderedReplacementErr = output();
    await prepareInvocation(argv("help", "lab", "--json", "dao"), {
      manifestData: manifest,
      stdin: { isTTY: false },
      stdout: reorderedReplacementOut.stream,
      stderr: reorderedReplacementErr.stream,
    });
    expect(JSON.parse(reorderedReplacementOut.value())).toMatchObject({
      schema: "chainlesschain.command-help.v1",
      command: { name: "dao" },
    });
    expect(reorderedReplacementErr.value()).toBe("");

    const legacyHelpOut = output();
    const legacyHelpErr = output();
    await prepareInvocation(argv("help", "dao", "--json"), {
      manifestData: manifest,
      stdin: { isTTY: false },
      stdout: legacyHelpOut.stream,
      stderr: legacyHelpErr.stream,
    });
    expect(JSON.parse(legacyHelpOut.value())).toMatchObject({
      schema: "chainlesschain.command-help.v1",
      command: { name: "dao" },
    });
    expect(legacyHelpErr.value()).toContain("use 'cc lab dao'");

    const directReplacementOut = output();
    const directReplacementErr = output();
    await prepareInvocation(argv("lab", "dao", "--help"), {
      manifestData: manifest,
      stdin: { isTTY: false },
      stdout: directReplacementOut.stream,
      stderr: directReplacementErr.stream,
    });
    expect(directReplacementOut.value()).toBe(legacyOut.value());
    expect(directReplacementErr.value()).toBe("");
    expect(legacyErr.value()).toBe(
      `${formatCommandDeprecationWarning(
        manifest.commands.find((entry) => entry.name === "dao"),
        "dao",
      )}\n`,
    );
  });

  it("reports unknown and misplaced lab targets entirely in phase 0", async () => {
    for (const args of [
      ["lab", "unknown"],
      ["lab", "--json", "dao"],
      ["lab", "--otlp-endpoint"],
      ["lab", "--", "dao"],
      ["--", "lab", "dao"],
    ]) {
      const stdout = output();
      const stderr = output();
      const loadFullProgram = vi.fn();
      const exitCodes = [];
      await runCli(argv(...args), {
        manifestData: manifest,
        stdin: { isTTY: false },
        stdout: stdout.stream,
        stderr: stderr.stream,
        loadFullProgram,
        setExitCode: (code) => exitCodes.push(code),
      });
      expect(stdout.value()).toBe("");
      expect(stderr.value()).toContain("Run 'cc lab --help'");
      expect(loadFullProgram).not.toHaveBeenCalled();
      expect(exitCodes).toEqual([1]);
    }
  });

  it("keeps JSON stdout clean and warns only for the legacy spelling", async () => {
    const legacyStdout = output();
    const legacyStderr = output();
    const legacy = await prepareInvocation(argv("dao", "stats", "--json"), {
      manifestData: manifest,
      stdin: { isTTY: false },
      stdout: legacyStdout.stream,
      stderr: legacyStderr.stream,
    });
    const replacementStdout = output();
    const replacementStderr = output();
    const replacement = await prepareInvocation(
      argv("lab", "dao", "stats", "--json"),
      {
        manifestData: manifest,
        stdin: { isTTY: false },
        stdout: replacementStdout.stream,
        stderr: replacementStderr.stream,
      },
    );

    expect(legacy).toMatchObject({
      handled: false,
      argv: argv("dao", "stats", "--json"),
    });
    expect(replacement).toMatchObject({
      handled: false,
      argv: argv("dao", "stats", "--json"),
    });
    expect(legacyStdout.value()).toBe("");
    expect(replacementStdout.value()).toBe("");
    expect(legacyStderr.value()).toContain("use 'cc lab dao'");
    expect(replacementStderr.value()).toBe("");
  });

  it("runs a rewritten action once and never retries an action failure", async () => {
    const prepared = await prepareInvocation(argv("lab", "dao", "stats"), {
      manifestData: manifest,
      stdin: { isTTY: false },
      stdout: output().stream,
      stderr: output().stream,
    });
    const entry = manifest.commands.find(
      (candidate) => candidate.name === "dao",
    );
    const actionError = new Error("failed after lifecycle route side effect");
    const parseAsync = vi.fn(async () => {
      throw actionError;
    });
    const loadFullProgram = vi.fn();

    await expect(
      dispatchManifestEntry(prepared.argv, entry, {
        createBaseProgram: async () => ({ parseAsync }),
        loadCommandModule: async () => ({ registerDaoCommand: () => {} }),
        loadFullProgram,
      }),
    ).rejects.toBe(actionError);
    expect(parseAsync).toHaveBeenCalledOnce();
    expect(parseAsync).toHaveBeenCalledWith(argv("dao", "stats"));
    expect(loadFullProgram).not.toHaveBeenCalled();
  });

  it("projects lifecycle metadata through all-help text and JSON", async () => {
    const textOut = output();
    await prepareInvocation(argv("help", "--all"), {
      manifestData: manifest,
      stdin: { isTTY: false },
      stdout: textOut.stream,
      stderr: output().stream,
    });
    expect(textOut.value()).toContain("deprecated; use cc lab dao");
    expect(textOut.value()).toContain("Compatibility namespace: lab");

    const jsonOut = output();
    await prepareInvocation(argv("help", "--all", "--json"), {
      manifestData: manifest,
      stdin: { isTTY: false },
      stdout: jsonOut.stream,
      stderr: output().stream,
    });
    const document = JSON.parse(jsonOut.value());
    expect(document.namespaces).toEqual([
      expect.objectContaining({
        name: "lab",
        commands: [
          expect.objectContaining({ name: "dao" }),
          expect.objectContaining({ name: "evomap" }),
        ],
      }),
    ]);
    expect(
      document.commands.find((entry) => entry.name === "dao"),
    ).toMatchObject({
      replacement: "lab dao",
      lifecycle: {
        state: "deprecated",
        minimumReleaseCycles: 2,
      },
    });
  });
});
