import { afterAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const root = mkdtempSync(join(tmpdir(), "cc-verify-08-"));
// Keep every persisted fixture inside this suite's private session directory.
vi.mock("../../src/lib/paths.js", () => ({
  getHomeDir: () => join(root, "home"),
  getSessionStoreDir: () => join(root, "home", "sessions"),
  getClaudeProjectStorageDir: () => null,
  getStatePath: () => join(root, "home", "state"),
  getMachineSecurityAnchorDir: () => join(root, "security"),
}));
const store = await import("../../src/harness/jsonl-session-store.js");
const {
  readSessionTranscriptHistory,
  createSessionTranscriptBranchProjection,
} = await import("../../src/lib/session-transcript-history.js");
const { createBranchHistoryImport, BRANCH_HISTORY_MESSAGE } = await import(
  "../../src/lib/session-branch-history.js"
);
afterAll(() => rmSync(root, { recursive: true, force: true }));

function pair(id, label) {
  store.appendUserMessage(id, `${label}: question`);
  store.appendAssistantMessage(id, `${label}: answer`);
}
function start(id) {
  store.startSession(id, { provider: "test", model: "test" });
  pair(id, "ancestor");
}
const pairTexts = (label) => [`${label}: question`, `${label}: answer`];
const texts = (id) =>
  readSessionTranscriptHistory(id).messages.map((m) => m.text);
const body = (id) =>
  store
    .readVerifiedMessages(id)
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => m.content);

function project(parentSessionId, messages, consume) {
  const head = store.findLatestEvent(parentSessionId, null).hash;
  return store.withSessionAuthorityTransaction(parentSessionId, head, (tx) =>
    tx.readProjection(() =>
      createSessionTranscriptBranchProjection(
        parentSessionId,
        messages,
        consume,
      ),
    ),
  );
}
function branch(parentSessionId, branchSessionId, count) {
  const messages = store.readVerifiedMessages(parentSessionId).slice(0, count);
  return project(parentSessionId, messages, (history) =>
    store.createBranchSession({
      parentSessionId,
      branchSessionId,
      parentTurnId: "selected",
      messages,
      history,
    }),
  );
}
function replay(events) {
  const importer = createBranchHistoryImport();
  const results = events.map((event) => importer.accept(event));
  importer.finish();
  return results;
}

describe("fork history ownership (independent regression)", () => {
  it("restores two different retained prefixes and keeps all later bodies isolated", () => {
    const parent = "verify08-parent";
    const left = "verify08-left";
    const right = "verify08-right";
    start(parent);
    pair(parent, "later ancestor");
    pair(parent, "excluded parent tail");
    const source = store
      .readVerifiedEvents(parent)
      .filter(
        (e) => e.type === "user_message" || e.type === "assistant_message",
      );
    expect(branch(parent, left, 2)).toMatchObject({
      branchSessionId: left,
      created: true,
    });
    expect(branch(parent, right, 4)).toMatchObject({
      branchSessionId: right,
      created: true,
    });
    pair(left, "left only");
    pair(right, "right only");
    pair(parent, "parent after branching");

    for (const [id, count, own] of [
      [left, 2, "left only"],
      [right, 4, "right only"],
    ]) {
      const inherited =
        count === 2
          ? pairTexts("ancestor")
          : [...pairTexts("ancestor"), ...pairTexts("later ancestor")];
      const expected = [...inherited, ...pairTexts(own)];
      expect(texts(id)).toEqual(expected);
      expect(body(id)).toEqual(expected);
      expect(readSessionTranscriptHistory(id).coverage.kind).toBe(
        "from-origin",
      );
      const archive = store
        .readVerifiedEvents(id)
        .filter((e) => e.type === BRANCH_HISTORY_MESSAGE);
      expect(archive.map((e) => e.data.text)).toEqual(inherited);
      expect(archive.map((e) => e.data.sourceEventId)).toEqual(
        source.slice(0, count).map((e) => e.hash),
      );
      expect(archive.map((e) => e.data.sourceItemIndex)).toEqual(
        Array(count).fill(0),
      );
    }
    expect(texts(parent)).toEqual([
      ...pairTexts("ancestor"),
      ...pairTexts("later ancestor"),
      ...pairTexts("excluded parent tail"),
      ...pairTexts("parent after branching"),
    ]);
    store.deleteJsonlSession(parent);
    expect(texts(left)).toEqual([
      ...pairTexts("ancestor"),
      ...pairTexts("left only"),
    ]);
    expect(texts(right)).toEqual([
      ...pairTexts("ancestor"),
      ...pairTexts("later ancestor"),
      ...pairTexts("right only"),
    ]);
  });

  it("forks the same verified history twice without sharing later messages", () => {
    const parent = "verify08-fork-parent";
    const selected = "verify08-fork-selected";
    start(parent);
    pair(parent, "not retained");
    branch(parent, selected, 2);
    pair(selected, "before fork");
    const left = store.forkSession(selected, { requestId: "left" });
    const right = store.forkSession(selected, { requestId: "right" });
    expect(typeof left).toBe("string");
    expect(typeof right).toBe("string");
    expect(left).not.toBe(right);
    expect(left).not.toBe(selected);
    expect(right).not.toBe(selected);
    const prefix = [...pairTexts("ancestor"), ...pairTexts("before fork")];
    pair(left, "fork left");
    pair(right, "fork right");
    pair(selected, "source after fork");
    for (const [id, own] of [
      [left, "fork left"],
      [right, "fork right"],
    ]) {
      expect(texts(id)).toEqual([...prefix, ...pairTexts(own)]);
      expect(body(id)).toEqual([...prefix, ...pairTexts(own)]);
      // Host lineage is durable context, not a user/assistant display row.
      expect(
        store
          .readVerifiedMessages(id)
          .filter((m) => m.role === "system")
          .map((m) => m.content),
      ).toEqual([`[Forked from session ${selected}]`]);
      const copied = store
        .readVerifiedEvents(id)
        .filter((e) => e.type === BRANCH_HISTORY_MESSAGE);
      const original = store
        .readVerifiedEvents(selected)
        .filter((e) => e.type === BRANCH_HISTORY_MESSAGE);
      expect(copied.map((e) => e.hash)).toEqual(original.map((e) => e.hash));
      expect(copied.map((e) => e.data)).toEqual(original.map((e) => e.data));
    }
    expect(texts(selected)).toEqual([
      ...prefix,
      ...pairTexts("source after fork"),
    ]);
    store.deleteJsonlSession(parent);
    store.deleteJsonlSession(selected);
    expect(texts(left)).toEqual([...prefix, ...pairTexts("fork left")]);
    expect(texts(right)).toEqual([...prefix, ...pairTexts("fork right")]);
  });

  it("binds a live history capability to its parent and exact retained body", () => {
    const parent = "verify08-cap-parent";
    const other = "verify08-cap-other";
    start(parent);
    start(other); // Identical text is not identical ownership.
    const messages = store.readVerifiedMessages(parent);
    const before = store.readVerifiedEvents(parent);
    let expired;
    project(parent, messages, (history) => {
      expect(history).toBeTruthy();
      expired = history;
      const create = (id, owner, body) =>
        store.createBranchSession({
          parentSessionId: owner,
          branchSessionId: id,
          messages: body,
          history,
        });
      expect(() => create("verify08-wrong-parent", other, messages)).toThrow(
        "does not match the branch",
      );
      expect(() =>
        create("verify08-wrong-body", parent, [
          { ...messages[0], content: "foreign body" },
          ...messages.slice(1),
        ]),
      ).toThrow("does not match the branch");
      expect(create("verify08-cap-valid", parent, messages).created).toBe(true);
    });
    expect(() =>
      store.createBranchSession({
        parentSessionId: parent,
        branchSessionId: "verify08-expired",
        messages,
        history: expired,
      }),
    ).toThrow("expired");
    for (const id of [
      "verify08-wrong-parent",
      "verify08-wrong-body",
      "verify08-expired",
    ]) {
      expect(store.readVerifiedEvents(id)).toEqual([]);
    }
    expect(store.readVerifiedEvents(parent)).toEqual(before);
    expect(texts("verify08-cap-valid")).toEqual(pairTexts("ancestor"));
  });

  it("accepts a complete real import but rejects wrong origins, digest and truncation", () => {
    const parent = "verify08-import-parent";
    const child = "verify08-import-child";
    start(parent);
    branch(parent, child, 2);
    const events = store.readVerifiedEvents(child);
    const accepted = replay(events);
    expect(
      accepted
        .filter((r) => r?.kind === "archive")
        .map((r) => r.message.content),
    ).toEqual(pairTexts("ancestor"));
    expect(accepted.filter((r) => r?.kind === "complete")).toHaveLength(1);
    const originIndex = accepted.findIndex((r) => r?.kind === "origin");
    const completeIndex = accepted.findIndex((r) => r?.kind === "complete");
    expect(originIndex).toBeGreaterThan(1);
    expect(completeIndex).toBeGreaterThan(originIndex);
    for (const corrupt of [
      (copy) => {
        copy[originIndex].data.messageDigest = "wrong-message";
      },
      (copy) => {
        copy[originIndex].data.origin.last = 2;
      },
      (copy) => {
        copy[completeIndex].data.inputDigest = "sha256:" + "0".repeat(64);
      },
      (copy) => {
        copy.splice(completeIndex);
      },
    ]) {
      const copy = structuredClone(events);
      corrupt(copy);
      // This boundary validates the import, not the outer transcript hash chain.
      expect(() => replay(copy)).toThrowError(
        expect.objectContaining({
          code: "SESSION_BRANCH_HISTORY_INVALID",
        }),
      );
    }
    expect(texts(child)).toEqual(pairTexts("ancestor"));
  });
});
