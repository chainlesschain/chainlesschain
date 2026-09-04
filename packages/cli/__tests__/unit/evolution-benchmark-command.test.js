import { Command } from "commander";
import { describe, expect, it } from "vitest";

import { registerWikiSkillBenchmarkCommands } from "../../src/commands/evolution-benchmark.js";
import {
  createWikiSkillBenchmarkCliHost,
  isWikiSkillBenchmarkCliHost,
} from "../../src/lib/evolution/wikiskill-benchmark-cli-host.js";

describe("WikiSkill Benchmark CLI deployment boundary", () => {
  it("registers run/show but rejects an unbranded deployment host before file access", async () => {
    const root = new Command().exitOverride();
    const evolution = root.command("evolution");
    registerWikiSkillBenchmarkCommands(evolution, {
      wikiSkillBenchmarkHost: {},
    });
    const benchmark = evolution.commands.find(
      (command) => command.name() === "benchmark",
    );
    expect(benchmark?.commands.map((command) => command.name())).toEqual([
      "run",
      "show",
    ]);

    await expect(
      root.parseAsync([
        "node",
        "cc",
        "evolution",
        "benchmark",
        "run",
        "absent-plan.json",
        "absent-manifest.json",
      ]),
    ).rejects.toThrow("trusted deployment host");
  });

  it("does not accept a structurally similar or prototype-forged host", () => {
    const similar = Object.freeze({
      run: async () => ({}),
      show: async () => ({}),
    });
    expect(isWikiSkillBenchmarkCliHost(similar)).toBe(false);
    expect(
      isWikiSkillBenchmarkCliHost(
        Object.create(createWikiSkillBenchmarkCliHost.prototype),
      ),
    ).toBe(false);
    expect(() =>
      createWikiSkillBenchmarkCliHost({
        datasetProvider: {},
        runner: {},
        grader: {},
        reportAttestor: {},
        ledgerAdapter: {},
      }),
    ).toThrow("WikiSkillBenchmarkLedgerAdapter");
  });
});
