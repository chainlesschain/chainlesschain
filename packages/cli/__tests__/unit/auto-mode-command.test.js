import { Command } from "commander";
import { describe, expect, it } from "vitest";
import {
  registerAutoModeCommand,
  runAutoModeSafetyEvalCommand,
} from "../../src/commands/auto-mode.js";
import {
  AutoModeSafetyDatasetError,
  loadAutoModeSafetyDataset,
} from "../../src/lib/auto-mode-safety-eval.js";

describe("registerAutoModeCommand", () => {
  it("registers eval beside the existing defaults/config subcommands", () => {
    const program = new Command();
    registerAutoModeCommand(program);
    const autoMode = program.commands.find(
      (command) => command.name() === "auto-mode",
    );
    expect(autoMode).toBeTruthy();
    expect(autoMode.alias()).toBe("automode");
    expect(autoMode.commands.map((command) => command.name())).toEqual([
      "defaults",
      "config",
      "eval",
    ]);
    const evalCommand = autoMode.commands.find(
      (command) => command.name() === "eval",
    );
    expect(evalCommand.options.map((option) => option.long)).toEqual([
      "--dataset",
      "--json",
    ]);
  });
});

describe("runAutoModeSafetyEvalCommand", () => {
  it("emits exactly one parseable JSON report for the built-in corpus", () => {
    const output = [];
    const exitCodes = [];
    const report = runAutoModeSafetyEvalCommand(
      { json: true },
      {
        output: (line) => output.push(line),
        setExitCode: (code) => exitCodes.push(code),
      },
    );
    expect(report.ok).toBe(true);
    expect(output).toHaveLength(1);
    expect(JSON.parse(output[0])).toMatchObject({
      schema: "chainlesschain.auto-mode-safety-report/v1",
      ok: true,
      overall: { total: 145, failed: 0 },
    });
    expect(exitCodes).toEqual([]);
  });

  it("keeps the JSON report and sets exit code 1 when a gate fails", () => {
    const output = [];
    const exitCodes = [];
    const dataset = loadAutoModeSafetyDataset();
    const report = runAutoModeSafetyEvalCommand(
      { json: true },
      {
        output: (line) => output.push(line),
        setExitCode: (code) => exitCodes.push(code),
        loadDataset: () => dataset,
        runEval: () => ({
          schema: "chainlesschain.auto-mode-safety-report/v1",
          ok: false,
          overall: { total: 1, failed: 1 },
        }),
      },
    );
    expect(report.ok).toBe(false);
    expect(JSON.parse(output[0]).ok).toBe(false);
    expect(exitCodes).toEqual([1]);
  });

  it("returns a machine-readable error envelope for an invalid dataset", () => {
    const output = [];
    const exitCodes = [];
    const result = runAutoModeSafetyEvalCommand(
      { json: true, dataset: "bad.json" },
      {
        output: (line) => output.push(line),
        setExitCode: (code) => exitCodes.push(code),
        loadDataset: () => {
          throw new AutoModeSafetyDatasetError("invalid fixture", [
            { code: "duplicate-id", path: "/cases/1/id", message: "duplicate" },
          ]);
        },
      },
    );
    expect(result).toMatchObject({
      schema: "chainlesschain.auto-mode-safety-error/v1",
      ok: false,
      error: {
        code: "invalid-safety-dataset",
        validationErrors: [
          {
            code: "duplicate-id",
            path: "/cases/1/id",
            message: "duplicate",
          },
        ],
      },
    });
    expect(JSON.parse(output[0])).toEqual(result);
    expect(exitCodes).toEqual([1]);
  });
});
