import { afterEach, describe, expect, it, vi } from "vitest";
import { createBaseProgram } from "../../src/program-base.js";
import logger from "../../src/lib/logger.js";
import {
  argvRequestsMachineReadableOutput,
  getOutputContext,
  isMachineReadableOptions,
  resetOutputContext,
} from "../../src/lib/output-context.js";

afterEach(() => {
  resetOutputContext();
  vi.restoreAllMocks();
});

function programWithProbe(action) {
  const program = createBaseProgram();
  program
    .command("probe")
    .option("--json")
    .option("--output-format <format>", "output format", "text")
    .action(action);
  return program;
}

describe("Commander OutputContext lifecycle", () => {
  it("keeps JSON stdout parseable while verbose diagnostics use stderr", async () => {
    const stdout = vi.spyOn(console, "log").mockImplementation(() => {});
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
    const program = programWithProbe(() => {
      logger.info("progress");
      logger.verbose("trace");
      logger.log(JSON.stringify({ ok: true }));
    });

    await program.parseAsync(["node", "cc", "--verbose", "probe", "--json"]);

    expect(stdout).toHaveBeenCalledTimes(1);
    expect(JSON.parse(stdout.mock.calls[0][0])).toEqual({ ok: true });
    expect(stderr).toHaveBeenCalledTimes(2);
    expect(getOutputContext()).toMatchObject({
      quiet: false,
      verbose: false,
      machineReadable: false,
    });
  });

  it("suppresses human results under quiet but preserves errors", async () => {
    const stdout = vi.spyOn(console, "log").mockImplementation(() => {});
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
    const program = programWithProbe(() => {
      logger.log("human result");
      logger.error("failure");
    });

    await program.parseAsync(["node", "cc", "--quiet", "probe"]);

    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledOnce();
  });

  it("preserves a JSON result when quiet and json are combined", async () => {
    const stdout = vi.spyOn(console, "log").mockImplementation(() => {});
    const program = programWithProbe(() => {
      logger.info("progress");
      logger.log(JSON.stringify({ ok: true }));
    });

    await program.parseAsync(["node", "cc", "--quiet", "probe", "--json"]);

    expect(stdout).toHaveBeenCalledOnce();
    expect(JSON.parse(stdout.mock.calls[0][0])).toEqual({ ok: true });
  });
});

describe("machine-readable mode detection", () => {
  it("recognizes JSON, JSONL and structured agent output", () => {
    expect(isMachineReadableOptions({ json: true })).toBe(true);
    expect(isMachineReadableOptions({ format: "ndjson" })).toBe(true);
    expect(isMachineReadableOptions({ outputFormat: "stream-json" })).toBe(
      true,
    );
    expect(isMachineReadableOptions({ jsonSchema: "schema.json" })).toBe(true);
    expect(isMachineReadableOptions({ format: "markdown" })).toBe(false);

    expect(
      argvRequestsMachineReadableOutput([
        "node",
        "cc",
        "x",
        "--format",
        "json",
      ]),
    ).toBe(true);
    expect(
      argvRequestsMachineReadableOutput([
        "node",
        "cc",
        "agent",
        "--json-schema=x.json",
      ]),
    ).toBe(true);
    expect(
      argvRequestsMachineReadableOutput([
        "node",
        "cc",
        "x",
        "--output-format=NDJSON",
      ]),
    ).toBe(true);
    expect(
      argvRequestsMachineReadableOutput([
        "node",
        "cc",
        "agent",
        "--",
        "--json",
      ]),
    ).toBe(false);
  });
});
