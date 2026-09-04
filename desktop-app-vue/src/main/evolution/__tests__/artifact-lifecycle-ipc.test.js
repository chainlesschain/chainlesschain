import { beforeEach, describe, expect, it, vi } from "vitest";

const handlers = new Map();
const testIpcMain = {
  handle: vi.fn((channel, handler) => handlers.set(channel, handler)),
};
vi.mock("electron", () => ({
  ipcMain: null,
}));

const { registerArtifactLifecycleIPC } = require("../artifact-lifecycle-ipc");

describe("artifact lifecycle IPC", () => {
  beforeEach(() => {
    handlers.clear();
  });

  it("registers narrow promotion and revalidation surfaces", () => {
    registerArtifactLifecycleIPC({ ipcMain: testIpcMain });
    expect([...handlers.keys()].sort()).toEqual([
      "evolution-artifact:promote",
      "evolution-artifact:revalidate",
    ]);
  });

  it("rejects unavailable, unknown and renderer-expanded authority", async () => {
    registerArtifactLifecycleIPC({ ipcMain: testIpcMain });
    await expect(
      handlers.get("evolution-artifact:promote")(null, {
        type: "skill",
        artifactId: "skill:a",
        candidateId: "candidate-a",
      }),
    ).rejects.toMatchObject({
      code: "CC_ARTIFACT_LIFECYCLE_PRODUCER_UNAVAILABLE",
    });
    await expect(
      handlers.get("evolution-artifact:promote")(null, {
        type: "knowledge",
        artifactId: "knowledge:a",
        candidateId: "candidate-a",
      }),
    ).rejects.toThrow("type is invalid");
    await expect(
      handlers.get("evolution-artifact:revalidate")(null, {
        type: "prompt",
        artifactId: "prompt:a",
        revalidationReceipt: {},
      }),
    ).rejects.toThrow("request is invalid");
  });

  it("rejects an unbranded producer at registration", () => {
    expect(() =>
      registerArtifactLifecycleIPC({
        ipcMain: testIpcMain,
        evolvableArtifactSkillLifecycleProducer: {
          type: "skill",
          promote: vi.fn(),
          revalidate: vi.fn(),
        },
      }),
    ).toThrow("invalid skill producer");
  });
});
