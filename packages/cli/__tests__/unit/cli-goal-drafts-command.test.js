import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import { registerGoalCommand } from "../../src/commands/goal.js";
import { exportCliGoalTaskCreateRequest } from "../../src/lib/plugin-runtime/cli-goal-draft-request.js";
vi.mock("../../src/lib/plugin-runtime/cli-goal-draft-request.js", () => ({
  exportCliGoalTaskCreateRequest: vi.fn(),
  exportCliGoalDraftRequest: vi.fn(),
}));
import {
  exportCliGoalDraftAccess,
  exportCliGoalCreateDraftAccess,
  readCliGoalCreateDraftSources,
  sendCliGoalCreateDraft,
  readCliGoalCreateDraftReceipt,
  readCliGoalDraftSources,
  sendCliGoalDraft,
  readCliGoalDraftReceipt,
} from "../../src/lib/plugin-runtime/cli-goal-drafts.js";
vi.mock("../../src/lib/plugin-runtime/cli-goal-drafts.js", () => ({
  exportCliGoalDraftAccess: vi.fn(),
  exportCliGoalCreateDraftAccess: vi.fn(),
  readCliGoalCreateDraftSources: vi.fn(),
  sendCliGoalCreateDraft: vi.fn(),
  readCliGoalCreateDraftReceipt: vi.fn(),
  readCliGoalDraftSources: vi.fn(),
  sendCliGoalDraft: vi.fn(),
  readCliGoalDraftReceipt: vi.fn(),
}));
let program, logs, exitCode;
const common = [
  "--connection",
  "connection.json",
  "--plugin",
  "drafter",
  "--scope",
  "project",
];
beforeEach(() => {
  exitCode = process.exitCode;
  program = new Command();
  program.exitOverride().configureOutput({ writeOut() {}, writeErr() {} });
  registerGoalCommand(program);
  logs = vi.spyOn(console, "log").mockImplementation(() => {});
  vi.clearAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = exitCode;
});
const run = (args) => program.parseAsync(["node", "cc", "goal", ...args]);
describe("online draft command registration", () => {
  it("routes separate creation access, source, send and receipt commands without using description exporters", async () => {
    exportCliGoalCreateDraftAccess.mockResolvedValue({
      state: "access-exported",
    });
    await run([
      "draft-create-access",
      "--plugin",
      "drafter",
      "--scope",
      "project",
      "--out",
      "create-access.json",
      "--json",
    ]);
    expect(exportCliGoalCreateDraftAccess).toHaveBeenCalledOnce();
    expect(exportCliGoalDraftAccess).not.toHaveBeenCalled();
    readCliGoalCreateDraftSources.mockResolvedValue({
      sources: { entries: [] },
    });
    await run(["draft-create-sources", "g1", ...common, "--json"]);
    expect(readCliGoalCreateDraftSources).toHaveBeenCalledOnce();
    const args = [
      "draft-create-send",
      "g1",
      ...common,
      "--source",
      "native-create",
      "--request-id",
      "stable",
      "--title",
      "Create follow-up",
      "--description-file",
      "body.txt",
      "--record",
      "create-record.json",
      "--json",
    ];
    await expect(run(args)).rejects.toThrow("--task-type");
    sendCliGoalCreateDraft.mockResolvedValue({ state: "saved" });
    await run([...args, "--task-type", "query_info"]);
    expect(sendCliGoalCreateDraft).toHaveBeenCalledWith(
      "g1",
      expect.objectContaining({
        taskType: "query_info",
        record: "create-record.json",
      }),
    );
    expect(sendCliGoalDraft).not.toHaveBeenCalled();
    readCliGoalCreateDraftReceipt.mockResolvedValue({ state: "unknown" });
    await run([
      "draft-create-receipt",
      "g1",
      ...common,
      "--record",
      "create-record.json",
      "--json",
    ]);
    expect(readCliGoalCreateDraftReceipt).toHaveBeenCalledOnce();
  });
  it("requires an explicit task type for the separate creation export command", async () => {
    const args = [
      "draft-create-request",
      "g1",
      ...common,
      "--source",
      "native-source",
      "--request-id",
      "stable-create",
      "--title",
      "Create follow-up",
      "--description-file",
      "body.txt",
      "--out",
      "create-request.json",
      "--json",
    ];
    await expect(run(args)).rejects.toThrow("--task-type");
    expect(exportCliGoalTaskCreateRequest).not.toHaveBeenCalled();
    exportCliGoalTaskCreateRequest.mockResolvedValue({
      state: "request-exported",
      file: "create-request.json",
    });
    await run([...args, "--task-type", "analyze_data"]);
    expect(exportCliGoalTaskCreateRequest).toHaveBeenCalledWith(
      "g1",
      expect.objectContaining({
        taskType: "analyze_data",
        source: "native-source",
        out: "create-request.json",
      }),
    );
    expect(JSON.parse(logs.mock.calls[0][0]).state).toBe("request-exported");
  });
  it("exports a selected plugin access file without a connection argument", async () => {
    exportCliGoalDraftAccess.mockResolvedValue({
      schema: "chainlesschain.goal-draft-access-export/v1",
      state: "access-exported",
      file: "access.json",
    });
    await run([
      "draft-access",
      "--plugin",
      "drafter",
      "--scope",
      "project",
      "--out",
      "access.json",
      "--json",
    ]);
    expect(exportCliGoalDraftAccess).toHaveBeenCalledWith(
      expect.objectContaining({
        plugin: "drafter",
        scope: "project",
        out: "access.json",
        cwd: process.cwd(),
        env: expect.any(Object),
      }),
    );
    expect(JSON.parse(logs.mock.calls[0][0]).state).toBe("access-exported");
  });
  it("requires --record before accepting a send", async () => {
    await expect(
      run([
        "draft-send",
        "g1",
        ...common,
        "--source",
        "source-1",
        "--request-id",
        "request-1",
        "--title",
        "Title",
        "--description-file",
        "body.txt",
      ]),
    ).rejects.toThrow("--record");
    expect(sendCliGoalDraft).not.toHaveBeenCalled();
  });
  it("prints structured unknown results without a nonzero exit code", async () => {
    const result = {
      schema: "chainlesschain.goal-draft-submission/v1",
      state: "unknown",
      requestId: "r1",
      inputDigest: "digest",
      record: "record.json",
    };
    sendCliGoalDraft.mockResolvedValue(result);
    await run([
      "draft-send",
      "g1",
      ...common,
      "--source",
      "source-1",
      "--request-id",
      "r1",
      "--title",
      "Title",
      "--description-file",
      "body.txt",
      "--record",
      "record.json",
      "--json",
    ]);
    expect(sendCliGoalDraft).toHaveBeenCalledWith(
      "g1",
      expect.objectContaining({
        requestId: "r1",
        record: "record.json",
        descriptionFile: "body.txt",
      }),
    );
    expect(JSON.parse(logs.mock.calls[0][0])).toEqual(result);
    expect(process.exitCode).toBe(exitCode);
  });
  it("queries receipts with only a selected connection and reference, without request body fields", async () => {
    readCliGoalDraftReceipt.mockResolvedValue({
      state: "not-found",
      record: "record.json",
    });
    await run([
      "draft-receipt",
      "g1",
      ...common,
      "--record",
      "record.json",
      "--json",
    ]);
    expect(readCliGoalDraftReceipt).toHaveBeenCalledWith(
      "g1",
      expect.objectContaining({ record: "record.json" }),
    );
    expect(sendCliGoalDraft).not.toHaveBeenCalled();
  });
  it("passes source paging through without any write option", async () => {
    readCliGoalDraftSources.mockResolvedValue({
      sources: {
        entries: [],
        scannedCount: 0,
        unavailableCount: 0,
        nextCursor: null,
      },
    });
    await run([
      "draft-sources",
      "g1",
      ...common,
      "--after",
      "cursor",
      "--json",
    ]);
    expect(readCliGoalDraftSources).toHaveBeenCalledWith(
      "g1",
      expect.objectContaining({ after: "cursor" }),
    );
    expect(sendCliGoalDraft).not.toHaveBeenCalled();
  });
});
