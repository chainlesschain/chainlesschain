import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { EventEmitter } from "node:events";
const require = createRequire(import.meta.url),
  Database = require("better-sqlite3");
const { createProjectGoalHost } = require("../project-goal-ipc.js");
const {
  createGoalRecord,
} = require("@chainlesschain/session-core/goal-contract");
const {
  createGoalTransfer,
  verifyGoalTransferCancellation,
} = require("@chainlesschain/session-core/goal-transfer-contract");
const {
  ProjectGoalTransferService,
} = require("@chainlesschain/session-core/project-goal-transfer");
const owner = "did:chainless:owner";

describe("native project goal transfer picker, confirmation and recovery", () => {
  let db, root, actor, generation, event, window, dialog, host, currentDb;
  const native = () =>
    new ProjectGoalTransferService({ db, getActor: () => actor });
  const file = (name) => path.join(root, name);
  async function target() {
    const result = await host.exportTransferTarget(event, { projectId: "p1" });
    return result.target;
  }
  function packet(descriptor) {
    const source = createGoalRecord({
      id: "source-goal",
      storeId: "cli-goals-" + "a".repeat(64),
      objective: "Source objective",
      createdAt: new Date().toISOString(),
    });
    return createGoalTransfer({
      target: descriptor,
      backup: JSON.stringify(source, null, 2) + "\n",
      storeId: source.storeId,
    });
  }
  function selectPacket(value) {
    fs.writeFileSync(file("packet.json"), JSON.stringify(value));
    dialog.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: [file("packet.json")],
    });
  }
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-native-transfer-"));
    db = new Database(":memory:");
    currentDb = db;
    db.exec(
      "CREATE TABLE projects(id TEXT PRIMARY KEY,user_id TEXT,status TEXT,updated_at INTEGER,deleted INTEGER DEFAULT 0)",
    );
    db.prepare("INSERT INTO projects VALUES (?,?,?,?,0)").run(
      "p1",
      owner,
      "active",
      10,
    );
    actor = owner;
    generation = 0;
    window = { isDestroyed: () => false };
    event = {
      sender: new EventEmitter(),
      senderFrame: { url: "http://localhost:5173", parent: null },
    };
    dialog = {
      showSaveDialog: vi.fn(async () => ({
        canceled: false,
        filePath: file("target.json"),
      })),
      showOpenDialog: vi.fn(),
      showMessageBox: vi.fn(async () => ({ response: 1 })),
    };
    host = createProjectGoalHost({
      database: { getDatabase: () => currentDb },
      electron: { BrowserWindow: { fromWebContents: () => window }, dialog },
      getCurrentUserDid: () => actor,
      getAuthenticationGeneration: () => generation,
    });
  });
  afterEach(() => {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  it("exports only a public project-pinned target then confirms and imports a selected file", async () => {
    const descriptor = await target(),
      exported = JSON.parse(fs.readFileSync(file("target.json"), "utf8"));
    expect(exported).toEqual(descriptor);
    expect(exported).not.toHaveProperty("privateKey");
    selectPacket(packet(descriptor));
    const result = await host.importTransfer(event, { projectId: "p1" });
    expect(result).toMatchObject({
      state: "imported",
      goal: {
        status: "paused",
        ownerRef: owner,
        objective: "Source objective",
      },
    });
    expect(dialog.showMessageBox.mock.calls.at(-1)[1]).toMatchObject({
      defaultId: 0,
      cancelId: 0,
    });
    const rows = host.listTransfers(event, { projectId: "p1", afterId: "" });
    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toHaveProperty("backup");
    expect(rows[0]).not.toHaveProperty("privateKey");
    dialog.showSaveDialog.mockResolvedValue({
      canceled: false,
      filePath: file("cancel.json"),
    });
    const cancelled = await host.cancelTransfer(event, {
      projectId: "p1",
      targetId: descriptor.id,
    });
    expect(
      verifyGoalTransferCancellation(
        JSON.parse(fs.readFileSync(file("cancel.json"), "utf8")),
        descriptor,
      ),
    ).toEqual(cancelled.cancellation);
    expect(host.read(event, { id: result.goal.id })).toBeNull();
    await expect(
      host.importTransfer(event, { projectId: "p1" }),
    ).rejects.toThrow("GOAL_TRANSFER_CANCELLED");
  });
  it.each(["path", "ownerRef", "target", "backup"])(
    "rejects renderer supplied %s before opening a file",
    async (key) => {
      await expect(
        host.importTransfer(event, { projectId: "p1", [key]: "untrusted" }),
      ).rejects.toThrow("GOAL_INVALID_REQUEST");
      expect(dialog.showOpenDialog).not.toHaveBeenCalled();
    },
  );
  it("does not create a target or goal after native picker/confirmation cancellation", async () => {
    dialog.showSaveDialog.mockResolvedValue({ canceled: true });
    expect(await host.exportTransferTarget(event, { projectId: "p1" })).toEqual(
      { state: "cancelled" },
    );
    expect(host.listTransfers(event, { projectId: "p1", afterId: "" })).toEqual(
      [],
    );
    dialog.showSaveDialog.mockResolvedValue({
      canceled: false,
      filePath: file("target.json"),
    });
    dialog.showMessageBox.mockResolvedValue({ response: 0 });
    expect(await host.exportTransferTarget(event, { projectId: "p1" })).toEqual(
      { state: "cancelled" },
    );
    expect(fs.existsSync(file("target.json"))).toBe(false);
    dialog.showMessageBox.mockResolvedValue({ response: 1 });
    const descriptor = await target();
    selectPacket(packet(descriptor));
    dialog.showMessageBox.mockResolvedValue({ response: 0 });
    expect(await host.importTransfer(event, { projectId: "p1" })).toEqual({
      state: "cancelled",
    });
    expect(native().status({ targetId: descriptor.id }).state).toBe("prepared");
  });
  it.each([
    "actor",
    "auth-generation",
    "navigation",
    "frame",
    "database",
    "window",
  ])("rejects a stale %s after confirmation", async (kind) => {
    const descriptor = await target();
    selectPacket(packet(descriptor));
    dialog.showMessageBox.mockImplementation(async () => {
      if (kind === "actor") actor = "did:other";
      if (kind === "auth-generation") generation++;
      if (kind === "navigation") event.sender.emit("did-start-navigation");
      if (kind === "frame")
        event.senderFrame = { url: "http://localhost:5173", parent: null };
      if (kind === "database") currentDb = {};
      if (kind === "window") window = { isDestroyed: () => false };
      return { response: 1 };
    });
    await expect(
      host.importTransfer(event, { projectId: "p1" }),
    ).rejects.toThrow();
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM cc_project_goals").get().n,
    ).toBe(0);
  });
  it("refuses a file replaced during native confirmation", async () => {
    const descriptor = await target(),
      value = packet(descriptor);
    selectPacket(value);
    dialog.showMessageBox.mockImplementation(async () => {
      const source = JSON.parse(value.backup);
      source.objective = "Injected objective";
      selectPacket(
        createGoalTransfer({
          target: descriptor,
          backup: JSON.stringify(source),
          storeId: source.storeId,
        }),
      );
      return { response: 1 };
    });
    await expect(
      host.importTransfer(event, { projectId: "p1" }),
    ).rejects.toThrow("GOAL_TRANSFER_SOURCE_CHANGED");
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM cc_project_goals").get().n,
    ).toBe(0);
  });
  it("rechecks project versions after target confirmation", async () => {
    dialog.showMessageBox.mockImplementation(async () => {
      db.prepare("UPDATE projects SET updated_at=11 WHERE id='p1'").run();
      return { response: 1 };
    });
    await expect(target()).rejects.toThrow("GOAL_PROJECT_VERSION_CONFLICT");
    expect(host.listTransfers(event, { projectId: "p1", afterId: "" })).toEqual(
      [],
    );
  });
  it("retains the same prepared target after a failed export and can export it again", async () => {
    dialog.showSaveDialog.mockResolvedValue({
      canceled: false,
      filePath: file("missing/target.json"),
    });
    await expect(target()).rejects.toThrow();
    const [row] = host.listTransfers(event, { projectId: "p1", afterId: "" });
    expect(row.state).toBe("prepared");
    dialog.showSaveDialog.mockResolvedValue({
      canceled: false,
      filePath: file("target.json"),
    });
    expect(
      (
        await host.exportTransferTarget(event, {
          projectId: "p1",
          requestId: row.target.id,
        })
      ).target,
    ).toEqual(row.target);
  });
  it("keeps cancellation durable after receipt file failure and re-exports the same signed receipt", async () => {
    const descriptor = await target();
    selectPacket(packet(descriptor));
    await host.importTransfer(event, { projectId: "p1" });
    dialog.showSaveDialog.mockResolvedValue({
      canceled: false,
      filePath: file("missing/receipt.json"),
    });
    await expect(
      host.cancelTransfer(event, { projectId: "p1", targetId: descriptor.id }),
    ).rejects.toThrow();
    const cancelled = native().status({ targetId: descriptor.id });
    expect(cancelled.state).toBe("cancelled");
    dialog.showSaveDialog.mockResolvedValue({
      canceled: false,
      filePath: file("receipt.json"),
    });
    expect(
      (
        await host.cancelTransfer(event, {
          projectId: "p1",
          targetId: descriptor.id,
        })
      ).cancellation,
    ).toEqual(cancelled.cancellation);
  });
  it("does not cancel newly imported work after a stale prepared-target confirmation", async () => {
    const descriptor = await target(),
      value = packet(descriptor);
    dialog.showSaveDialog.mockResolvedValue({
      canceled: false,
      filePath: file("receipt.json"),
    });
    dialog.showMessageBox.mockImplementation(async () => {
      native().importTransfer(value);
      return { response: 1 };
    });
    await expect(
      host.cancelTransfer(event, { projectId: "p1", targetId: descriptor.id }),
    ).rejects.toThrow("GOAL_TRANSFER_CONFLICT");
    expect(native().status({ targetId: descriptor.id }).state).toBe("imported");
    expect(fs.existsSync(file("receipt.json"))).toBe(false);
  });
  it("never overwrites an unrelated selected output file", async () => {
    fs.writeFileSync(file("target.json"), "keep");
    await expect(target()).rejects.toThrow();
    expect(fs.readFileSync(file("target.json"), "utf8")).toBe("keep");
  });
});
