import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import { registerHubCommand, _internal } from "../../src/commands/hub.js";

describe("derivation retention CLI boundary", () => {
  let store, hub, getHub, stdout, output, exit;
  beforeEach(() => {
    store = {
      listConsumers: vi.fn(() => [
        { consumerId: "retired-1", state: "retired", kind: "ephemeral" },
      ]),
      pruneRetiredConsumers: vi.fn(() => ({
        deletedReceipts: 2,
        retainedRunning: 1,
        remainingReceipts: 1,
      })),
    };
    hub = {
      vault: { getDerivationStore: () => store },
      registry: { consumerId: "current-host" },
    };
    getHub = vi.fn(async () => hub);
    stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    output = vi.spyOn(console, "log").mockImplementation(() => {});
    exit = vi.spyOn(process, "exit").mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it("exposes bounded listing and explicit selected-consumer confirmation", () => {
    const program = new Command();
    registerHubCommand(program);
    const commands = program.commands.find(
      (command) => command.name() === "hub",
    ).commands;
    expect(
      commands
        .find((command) => command.name() === "derivation-consumers")
        .options.map((option) => option.long),
    ).toEqual(
      expect.arrayContaining(["--state", "--kind", "--after", "--limit"]),
    );
    const prune = commands.find(
      (command) => command.name() === "prune-derivations",
    );
    expect(
      prune.options.find((option) => option.long === "--consumer").mandatory,
    ).toBe(true);
    expect(prune.options.map((option) => option.long)).toContain("--confirm");
  });

  it("lists only lifecycle data through the store's bounded filters", async () => {
    const result = await _internal.cmdDerivation("consumers", null, {
      state: "retired",
      kind: "ephemeral",
      after: "older-id",
      limit: "10",
      json: true,
      _getHub: getHub,
    });
    expect(result).toEqual([
      { consumerId: "retired-1", state: "retired", kind: "ephemeral" },
    ]);
    expect(store.listConsumers).toHaveBeenCalledWith({
      state: "retired",
      kind: "ephemeral",
      afterConsumerId: "older-id",
      limit: 10,
    });
  });

  it.each([
    { consumer: ["retired-1"] },
    { consumer: [], confirm: true },
    { consumer: [" "], confirm: true },
    { consumer: ["retired-1"], confirm: true, limit: "1001" },
  ])("rejects invalid cleanup before opening a vault", async (options) => {
    await _internal.cmdDerivation("prune", null, {
      ...options,
      json: true,
      _getHub: getHub,
    });
    expect(exit).toHaveBeenCalledWith(1);
    expect(getHub).not.toHaveBeenCalled();
    expect(store.pruneRetiredConsumers).not.toHaveBeenCalled();
  });

  it("takes active consumer identity from the host and preserves unresolved counts", async () => {
    const result = await _internal.cmdDerivation("prune", null, {
      consumer: ["retired-1"],
      confirm: true,
      limit: "5",
      activeConsumerId: "forged",
      json: true,
      _getHub: getHub,
    });
    expect(store.pruneRetiredConsumers).toHaveBeenCalledWith({
      consumerIds: ["retired-1"],
      activeConsumerId: "current-host",
      limit: 5,
    });
    expect(result).toEqual({
      deletedReceipts: 2,
      retainedRunning: 1,
      remainingReceipts: 1,
    });
    expect(exit).not.toHaveBeenCalled();
  });

  it("surfaces lifecycle protection errors without claiming cleanup success", async () => {
    store.pruneRetiredConsumers.mockImplementation(() => {
      throw new Error(
        "Only explicitly retired ephemeral consumers can be pruned",
      );
    });
    const result = await _internal.cmdDerivation("prune", null, {
      consumer: ["active-generation"],
      confirm: true,
      json: true,
      _getHub: getHub,
    });
    expect(result).toBeUndefined();
    expect(exit).toHaveBeenCalledWith(1);
    expect(output.mock.calls.map((call) => String(call[0])).join("")).toContain(
      "Only explicitly retired",
    );
  });
});
