import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  exportCliGoalDraftAccess,
  readCliGoalDraftSources,
  sendCliGoalDraft,
  readCliGoalDraftReceipt,
  _deps,
} from "../../src/lib/plugin-runtime/cli-goal-drafts.js";
import {
  validateGoalDraftSubmissionReference,
  validateGoalDraftAccess,
} from "@chainlesschain/session-core/goal-draft-connection-contract";
import { digestBusinessObjectContent as digest } from "@chainlesschain/session-core/business-object-contract";
import {
  trustPlugin,
  _deps as trustDeps,
} from "../../src/lib/plugin-runtime/trust.js";
import {
  consentPluginCapabilities,
  _deps as consentDeps,
} from "../../src/lib/plugin-runtime/capability-consent.js";
import { normalizeCapabilities } from "../../src/lib/plugin-runtime/capabilities.js";

let temp, options, sample, connection, ref, stored, pluginDirectory;
function allow() {
  trustPlugin(sample.name, {
    scope: "project",
    version: sample.version,
    workspaceRoot: options.cwd,
  });
  consentPluginCapabilities(sample.name, {
    scope: "project",
    version: sample.version,
    capabilities: normalizeCapabilities(sample.permissions),
  });
}
function disable() {
  fs.writeFileSync(path.join(pluginDirectory, ".disabled"), "disabled");
}
function record() {
  return validateGoalDraftSubmissionReference(
    JSON.parse(fs.readFileSync(options.record, "utf8")),
  );
}
beforeEach(() => {
  temp = fs.mkdtempSync(path.join(os.tmpdir(), "cc-online-drafts-"));
  const cwd = path.join(temp, "workspace");
  sample = JSON.parse(
    fs.readFileSync(
      new URL(
        "../../src/lib/plugin-runtime/examples/goal-description-drafter/plugin.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  pluginDirectory = path.join(cwd, ".chainlesschain", "plugins", sample.name);
  fs.mkdirSync(path.join(pluginDirectory, sample.version), { recursive: true });
  fs.writeFileSync(
    path.join(pluginDirectory, sample.version, "plugin.json"),
    JSON.stringify(sample),
  );
  fs.writeFileSync(path.join(pluginDirectory, ".active"), sample.version);
  vi.spyOn(trustDeps, "storePath").mockReturnValue(
    path.join(temp, "trust.json"),
  );
  vi.spyOn(trustDeps, "workspaceTrustStorePath").mockReturnValue(
    path.join(temp, "workspace-trust.json"),
  );
  vi.spyOn(consentDeps, "storePath").mockReturnValue(
    path.join(temp, "consent.json"),
  );
  options = {
    cwd,
    connection: path.join(temp, "connection.json"),
    plugin: sample.name,
    scope: "project",
    source: `goal-proposal-${"a".repeat(64)}`,
    requestId: "stable-request",
    title: "Follow-up",
    descriptionFile: "description.txt",
    record: path.join(temp, "submission.json"),
    out: path.join(temp, "access.json"),
    managedSettingsFile: path.join(temp, "managed.json"),
    env: {
      ...process.env,
      CC_PLUGINS: "1",
      CC_PLUGIN_SCOPES: "project",
      CC_PLUGIN_TRANSACTION_HOME: path.join(temp, "transactions"),
    },
  };
  fs.writeFileSync(
    path.join(cwd, options.descriptionFile),
    "Proposed plain text\nwith two lines.",
  );
  ref = {
    id: "goal-1",
    storeId: "project-goals-12345678-1234-1234-1234-123456789abc",
    revision: 2,
    controlGeneration: 1,
  };
  stored = null;
  connection = {
    drafts: true,
    goalRef: ref,
    plugin: { name: sample.name, scope: "project", version: sample.version },
    declarationDigest: digest(sample.goalExtension),
    grantRef: { id: `goal-external-grant-${"b".repeat(64)}`, epoch: 1 },
    read: vi.fn(async () => ({
      goalRef: { ...ref },
      objective: "Delivery",
      status: "active",
    })),
    sources: vi.fn(async () => ({
      entries: [
        {
          id: options.source,
          sourceTaskId: "task-1",
          reviewId: "review-1",
          reviewDigest: digest("review"),
        },
      ],
      scannedCount: 1,
      unavailableCount: 0,
      nextCursor: null,
    })),
    enqueue: vi.fn(async (proposal) => {
      stored = {
        state: "saved",
        proposalId: `goal-extension-${"c".repeat(64)}`,
        requestId: proposal.requestId,
        inputDigest: digest(proposal),
      };
      return { ...stored };
    }),
    receipt: vi.fn(async (input) =>
      stored
        ? { ...stored }
        : { state: "not-found", proposalId: null, ...input },
    ),
  };
  vi.spyOn(_deps, "createProjectGoalConnection").mockReturnValue(connection);
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(temp, { recursive: true, force: true });
});

describe("CLI online native pending drafts", () => {
  it("exports only an admitted plugin label for separate native authorization", async () => {
    await expect(exportCliGoalDraftAccess(options)).rejects.toThrow(
      "NOT_ADMITTED",
    );
    allow();
    const result = await exportCliGoalDraftAccess(options);
    expect(result).toMatchObject({
      schema: "chainlesschain.goal-draft-access-export/v1",
      state: "access-exported",
      file: options.out,
    });
    expect(
      validateGoalDraftAccess(JSON.parse(fs.readFileSync(options.out, "utf8"))),
    ).toEqual({
      schema: "chainlesschain.goal-draft-access/v1",
      plugin: connection.plugin,
      declarationDigest: connection.declarationDigest,
    });
    expect(_deps.createProjectGoalConnection).not.toHaveBeenCalled();
    await expect(exportCliGoalDraftAccess(options)).rejects.toThrow();
  });
  it("requires real trust and consent before source reads or send", async () => {
    await expect(readCliGoalDraftSources(ref.id, options)).rejects.toThrow(
      "NOT_ADMITTED",
    );
    trustPlugin(sample.name, {
      scope: "project",
      version: sample.version,
      workspaceRoot: options.cwd,
    });
    await expect(sendCliGoalDraft(ref.id, options)).rejects.toThrow(
      "NOT_ADMITTED",
    );
    expect(connection.sources).not.toHaveBeenCalled();
    expect(connection.enqueue).not.toHaveBeenCalled();
    expect(fs.existsSync(options.record)).toBe(false);
  });
  it.each(["read-only", "plugin", "version", "declaration", "store"])(
    "rejects a mismatched %s connection before any mutation",
    async (kind) => {
      allow();
      if (kind === "read-only") connection.drafts = false;
      if (kind === "plugin")
        connection.plugin = { ...connection.plugin, name: "other" };
      if (kind === "version")
        connection.plugin = { ...connection.plugin, version: "9.0.0" };
      if (kind === "declaration")
        connection.declarationDigest = digest("other");
      if (kind === "store") options.expectedStore = "other-store";
      await expect(sendCliGoalDraft(ref.id, options)).rejects.toThrow();
      expect(connection.enqueue).not.toHaveBeenCalled();
      expect(fs.existsSync(options.record)).toBe(false);
    },
  );
  it("reads bounded source IDs and discards them when local admission changes during I/O", async () => {
    allow();
    const page = await readCliGoalDraftSources(ref.id, options);
    expect(page).toMatchObject({
      schema: "chainlesschain.goal-draft-source-page/v1",
      goalRef: ref,
      plugin: connection.plugin,
      grantRef: connection.grantRef,
    });
    expect(page.sources.entries).toHaveLength(1);
    connection.sources.mockImplementationOnce(async () => {
      disable();
      return page.sources;
    });
    await expect(readCliGoalDraftSources(ref.id, options)).rejects.toThrow(
      "NOT_ADMITTED",
    );
  });
  it("fsyncs a credential-free durable reference before using the real SDK enqueue adapter", async () => {
    allow();
    const sdk = vi.spyOn(_deps, "proposeGoalExtensionAction");
    const sync = vi.spyOn(fs, "fsyncSync");
    connection.enqueue.mockImplementationOnce(async (proposal) => {
      const saved = record();
      expect(sync).toHaveBeenCalled();
      expect(saved.inputDigest).toBe(digest(proposal));
      expect(saved.requestId).toBe(proposal.requestId);
      expect(JSON.stringify(saved)).not.toContain("Proposed plain text");
      for (const field of [
        "key",
        "endpoint",
        "connection",
        "description",
        "title",
        "sourceRef",
      ])
        expect(saved).not.toHaveProperty(field);
      return {
        state: "saved",
        proposalId: `goal-extension-${"c".repeat(64)}`,
        requestId: proposal.requestId,
        inputDigest: digest(proposal),
      };
    });
    const result = await sendCliGoalDraft(ref.id, options);
    expect(sdk).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      schema: "chainlesschain.goal-draft-submission/v1",
      state: "saved",
      record: options.record,
      requestId: options.requestId,
    });
    expect(connection.enqueue).toHaveBeenCalledTimes(1);
  });
  it("does not dispatch if fsync fails", async () => {
    allow();
    vi.spyOn(fs, "fsyncSync").mockImplementation(() => {
      throw new Error("fsync failed");
    });
    await expect(sendCliGoalDraft(ref.id, options)).rejects.toThrow(
      "fsync failed",
    );
    expect(connection.enqueue).not.toHaveBeenCalled();
  });
  it("queries an existing identical reference without resending, even after source reads expire", async () => {
    allow();
    const first = await sendCliGoalDraft(ref.id, options);
    connection.read.mockRejectedValue(new Error("source expired"));
    expect(await sendCliGoalDraft(ref.id, options)).toEqual(first);
    expect(connection.enqueue).toHaveBeenCalledTimes(1);
    fs.unlinkSync(path.join(options.cwd, options.descriptionFile));
    expect(await readCliGoalDraftReceipt(ref.id, options)).toEqual(first);
    expect(connection.read).toHaveBeenCalledTimes(1);
    expect(connection.receipt).toHaveBeenCalledTimes(2);
  });
  it("preserves unknown outcomes and a subsequent not-found query never automatically resends", async () => {
    allow();
    connection.enqueue.mockRejectedValue(new Error("response lost"));
    const unknown = await sendCliGoalDraft(ref.id, options);
    expect(unknown).toMatchObject({
      state: "unknown",
      proposalId: null,
      record: options.record,
      requestId: options.requestId,
    });
    expect(record().inputDigest).toBe(unknown.inputDigest);
    const result = await sendCliGoalDraft(ref.id, options);
    expect(result).toMatchObject({
      state: "not-found",
      proposalId: null,
      inputDigest: unknown.inputDigest,
    });
    expect(connection.enqueue).toHaveBeenCalledTimes(1);
    connection.receipt.mockRejectedValue(new Error("connection expired"));
    expect(await readCliGoalDraftReceipt(ref.id, options)).toMatchObject({
      state: "unknown",
      inputDigest: unknown.inputDigest,
    });
  });
  it("rejects reuse of a reference for different contents or grant epoch", async () => {
    allow();
    await sendCliGoalDraft(ref.id, options);
    const original = fs.readFileSync(options.record, "utf8");
    await expect(
      sendCliGoalDraft(ref.id, { ...options, title: "Changed" }),
    ).rejects.toThrow("RECORD_CONFLICT");
    connection.grantRef = { ...connection.grantRef, epoch: 3 };
    await expect(readCliGoalDraftReceipt(ref.id, options)).rejects.toThrow(
      "RECORD_CONFLICT",
    );
    expect(fs.readFileSync(options.record, "utf8")).toBe(original);
    expect(connection.enqueue).toHaveBeenCalledTimes(1);
    expect(connection.receipt).not.toHaveBeenCalled();
  });
  it("does not turn an authenticated saved result into failure if local consent changes after submission", async () => {
    allow();
    connection.enqueue.mockImplementationOnce(async (proposal) => {
      disable();
      return {
        state: "saved",
        proposalId: `goal-extension-${"c".repeat(64)}`,
        requestId: proposal.requestId,
        inputDigest: digest(proposal),
      };
    });
    expect(await sendCliGoalDraft(ref.id, options)).toMatchObject({
      state: "saved",
    });
  });
  it("rechecks policy before POST, keeping the reference when pre-dispatch authorization changes", async () => {
    allow();
    connection.read.mockImplementationOnce(async () => {
      fs.writeFileSync(
        options.managedSettingsFile,
        JSON.stringify({ deniedPlugins: [sample.name] }),
      );
      return { goalRef: ref, status: "active" };
    });
    await expect(sendCliGoalDraft(ref.id, options)).rejects.toThrow(
      "NOT_ADMITTED",
    );
    expect(connection.enqueue).not.toHaveBeenCalled();
    expect(record().requestId).toBe(options.requestId);
  });
  it("pins caller options, environment, destination and managed policy before awaiting", async () => {
    allow();
    const original = { ...options };
    connection.read.mockImplementationOnce(async () => {
      options.plugin = "different";
      options.scope = "user";
      options.source = "different";
      options.requestId = "different";
      options.descriptionFile = "different";
      options.record = path.join(temp, "unexpected.json");
      options.managedSettingsFile = path.join(temp, "unexpected-policy.json");
      options.env.CC_PLUGIN_SCOPES = "user";
      return { goalRef: ref, status: "active" };
    });
    const result = await sendCliGoalDraft(ref.id, options);
    expect(result).toMatchObject({
      state: "saved",
      record: original.record,
      requestId: original.requestId,
    });
    expect(fs.existsSync(options.record)).toBe(false);
    expect(connection.enqueue.mock.calls[0][0].sourceRef).toBe(original.source);
  });
  it("does not send if the persisted reference changes while authorizing", async () => {
    allow();
    connection.read.mockImplementationOnce(async () => {
      fs.writeFileSync(options.record, "tampered");
      return { goalRef: ref, status: "active" };
    });
    await expect(sendCliGoalDraft(ref.id, options)).rejects.toThrow(
      "RECORD_CHANGED",
    );
    expect(connection.enqueue).not.toHaveBeenCalled();
  });
  it("reports a malformed post-dispatch response as unknown with the original reference", async () => {
    allow();
    connection.enqueue.mockResolvedValue({
      state: "saved",
      proposalId: "bad",
      requestId: options.requestId,
      inputDigest: digest("bad"),
    });
    expect(await sendCliGoalDraft(ref.id, options)).toMatchObject({
      state: "unknown",
      record: options.record,
      requestId: options.requestId,
    });
    expect(record().requestId).toBe(options.requestId);
  });
  it("rejects oversized or malformed existing records instead of overwriting or sending", async () => {
    allow();
    for (const text of ["not-json", " ".repeat(4097)]) {
      fs.writeFileSync(options.record, text);
      await expect(sendCliGoalDraft(ref.id, options)).rejects.toThrow();
      expect(fs.readFileSync(options.record, "utf8")).toBe(text);
    }
    expect(connection.enqueue).not.toHaveBeenCalled();
  });
});
