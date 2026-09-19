import { beforeEach, describe, expect, it, vi } from "vitest";

const sink = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const { RecordingStorage } = require("../recording/recording-storage");
const { WorkflowStorage } = require("../workflow/workflow-storage");

describe("recording and workflow log redaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redacts successful and failed storage operation fields", async () => {
    const db = { run: vi.fn() };
    const recordingStorage = new RecordingStorage(db, { logSink: sink });
    const workflowStorage = new WorkflowStorage(db, { logSink: sink });

    await recordingStorage.saveRecording({
      id: "recording-id-secret",
      name: "recording-name-secret",
      startUrl: "https://recording.secret.example/private",
    });
    await workflowStorage.createWorkflow({
      id: "workflow-id-secret",
      name: "workflow-name-secret",
    });

    db.run.mockImplementation(() => {
      throw new Error(
        "storage-error-secret at C:\\private\\browser-workflow.json",
      );
    });
    await expect(
      recordingStorage.saveRecording({ id: "failed-recording-secret" }),
    ).rejects.toThrow("storage-error-secret");
    await expect(
      workflowStorage.createWorkflow({ id: "failed-workflow-secret" }),
    ).rejects.toThrow("storage-error-secret");

    const serialized = JSON.stringify({
      info: sink.info.mock.calls,
      error: sink.error.mock.calls,
    });
    for (const secret of [
      "recording-id-secret",
      "recording-name-secret",
      "workflow-id-secret",
      "workflow-name-secret",
      "storage-error-secret",
      "private\\browser-workflow.json",
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(serialized).toContain("valueDigest");
  });

  it("keeps corrupt JSON parser details out of warning messages", () => {
    const recordingStorage = new RecordingStorage({}, { logSink: sink });
    const workflowStorage = new WorkflowStorage({}, { logSink: sink });

    recordingStorage._deserializeRecording({
      events: "recording-parse-secret",
      screenshots: "[]",
      tags: "[]",
      recording_options: "{}",
    });
    workflowStorage._deserializeWorkflow({
      steps: "workflow-parse-secret",
      variables: "{}",
      triggers: "[]",
      tags: "[]",
    });

    const serialized = JSON.stringify(sink.warn.mock.calls);
    expect(serialized).not.toContain("recording-parse-secret");
    expect(serialized).not.toContain("workflow-parse-secret");
    expect(serialized).toContain("valueDigest");
  });
});
