import { afterAll, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const root = mkdtempSync(join(tmpdir(), "cc-verify-08-"));
// Integration fixtures use the real store and an isolated session directory.
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
const { resolveSessionBranchHistory } = await import(
  "../../src/lib/session-branch-history.js"
);
const { ContextMemoryKernel } = await import(
  "@chainlesschain/context-memory-kernel"
);
const { JsonlSessionContextPort } = await import(
  "../../src/lib/context-memory-kernel/jsonl-session-context-port.js"
);
const { getDurableSystemMessageProvenance } = await import(
  "../../src/lib/session-message-provenance.js"
);

function assertForkNotice(id, parent) {
  const notices = store
    .readVerifiedMessages(id)
    .filter(
      (message) =>
        getDurableSystemMessageProvenance(message)?.kind === "fork-lineage",
    );
  expect(notices).toHaveLength(1);
  expect(notices[0].role).toBe("system");
  expect(notices[0].content).toBe(`[Forked from session ${parent}]`);
}

afterAll(() => rmSync(root, { recursive: true, force: true }));

function pair(id, question, answer) {
  store.appendUserMessage(id, question);
  store.appendAssistantMessage(id, answer);
}

function projectBranch(parentSessionId, messages, consume) {
  const head = store.findLatestEvent(parentSessionId, null).hash;
  return store.withSessionAuthorityTransaction(
    parentSessionId,
    head,
    (transaction) =>
      transaction.readProjection(() =>
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
  return projectBranch(parentSessionId, messages, (history) =>
    store.createBranchSession({
      parentSessionId,
      branchSessionId,
      parentTurnId: "selected",
      messages,
      history,
    }),
  );
}

function history(id) {
  return readSessionTranscriptHistory(id, { limit: 100 });
}
function body(page) {
  return page.messages
    .filter((row) => row.role === "user" || row.role === "assistant")
    .map(({ role, text }) => ({ role, text }));
}
function expectedPair(question, answer) {
  return [
    { role: "user", text: question },
    { role: "assistant", text: answer },
  ];
}

async function compact(id) {
  const kernel = new ContextMemoryKernel({
    sessionPort: new JsonlSessionContextPort({ sessionId: id }),
  });
  const result = await kernel.compactContext({
    operationId: `${id}-compact`,
    sessionId: id,
    modelWindowTokens: 150,
    reservedOutputTokens: 20,
    safetyMarginTokens: 10,
    recoveryReserveTokens: 10,
    sink: "provider.local",
    scopeAdmissions: [{ scope: "session", scopeId: id }],
    policyVersion: "test",
    modelProfile: "test",
    now: "2026-09-27T00:00:00.000Z",
  });
  expect(result.status).toBe("committed");
}

describe("verify-08: fork history ownership", () => {
  it("restores imported ancestors in two forks and never reads later parent or sibling bodies", async () => {
    const parent = "v08-compacted-parent";
    const seed = "v08-history-seed";
    store.startSession(parent, { provider: "test", model: "test" });
    const ancestors = [];
    for (let i = 0; i < 6; i++) {
      const q = `ancestor-${i}: ${"x".repeat(90)}`;
      const a = `answer-${i}: ${"y".repeat(90)}`;
      pair(parent, q, a);
      ancestors.push(...expectedPair(q, a));
    }
    store.appendUserMessage(parent, "excluded selected turn");
    await compact(parent);
    const active = store.readVerifiedMessages(parent);
    expect(branch(parent, seed, active.length - 1).created).toBe(true);
    const seedEvents = store.readVerifiedEvents(seed);
    expect(seedEvents.some((e) => e.type === "session_history_message")).toBe(
      true,
    );
    expect(body(history(seed))).toEqual(ancestors);

    const left = store.forkSession(seed, { requestId: "left" });
    const right = store.forkSession(seed, { requestId: "right" });
    expect(typeof left).toBe("string");
    expect(typeof right).toBe("string");
    expect(left).not.toBe(right);
    for (const id of [left, right]) {
      // A full fork copies the verified import, rather than minting fake ancestry.
      expect(store.readVerifiedEvents(id).slice(0, seedEvents.length)).toEqual(
        seedEvents,
      );
      expect(body(history(id))).toEqual(ancestors);
    }
    pair(left, "left question", "left answer");
    pair(right, "right question", "right answer");
    pair(seed, "late seed question", "late seed answer");
    pair(parent, "late parent question", "late parent answer");
    store.deleteJsonlSession(parent);
    store.deleteJsonlSession(seed);

    const leftPage = history(left);
    const rightPage = history(right);
    assertForkNotice(left, seed);
    assertForkNotice(right, seed);
    expect(body(leftPage)).toEqual([
      ...ancestors,
      ...expectedPair("left question", "left answer"),
    ]);
    expect(body(rightPage)).toEqual([
      ...ancestors,
      ...expectedPair("right question", "right answer"),
    ]);
    for (const page of [leftPage, rightPage]) {
      expect(page.coverage.kind).toBe("from-origin");
      // Host lineage is checked separately, not silently counted as conversation.
      expect(
        page.messages.every((m) =>
          ["user", "assistant", "tool"].includes(m.role),
        ),
      ).toBe(true);
    }
    expect(leftPage.messages[0].id).not.toBe(rightPage.messages[0].id);
    expect(
      store
        .readVerifiedMessages(left)
        .filter((m) => m.role === "user")
        .at(-1).content,
    ).toBe("left question");
    expect(
      store
        .readVerifiedMessages(right)
        .filter((m) => m.role === "user")
        .at(-1).content,
    ).toBe("right question");
  });

  it("branches each fork at its own cutoff, preserving its body but excluding its later turns", () => {
    const parent = "v08-cut-parent";
    store.startSession(parent, {});
    pair(parent, "shared question", "shared answer");
    const ancestor = expectedPair("shared question", "shared answer");
    const left = store.forkSession(parent, { requestId: "cut-left" });
    const right = store.forkSession(parent, { requestId: "cut-right" });
    const children = [];
    for (const [source, label] of [
      [left, "left"],
      [right, "right"],
    ]) {
      pair(source, `${label} retained question`, `${label} retained answer`);
      const retained = store.readVerifiedMessages(source).length;
      pair(source, `${label} excluded question`, `${label} excluded answer`);
      const sourceBefore = store.readVerifiedEvents(source);
      const child = `v08-cut-${label}`;
      expect(branch(source, child, retained).created).toBe(true);
      expect(store.readVerifiedEvents(source)).toEqual(sourceBefore);
      const lineage = store
        .readVerifiedEvents(child)
        .find((e) => e.type === "session_branch");
      expect(lineage.data.parentSessionId).toBe(source);
      expect(lineage.data.parentTurnId).toBe("selected");
      pair(child, `${label} child question`, `${label} child answer`);
      pair(source, `${label} later question`, `${label} later answer`);
      children.push([child, label]);
    }
    for (const id of [parent, left, right]) store.deleteJsonlSession(id);
    for (const [child, label] of children) {
      const page = history(child);
      expect(page.sessionId).toBe(child);
      expect(page.coverage.kind).toBe("from-origin");
      expect(body(page)).toEqual([
        ...ancestor,
        ...expectedPair(
          `${label} retained question`,
          `${label} retained answer`,
        ),
        ...expectedPair(`${label} child question`, `${label} child answer`),
      ]);
      assertForkNotice(child, parent);
      expect(
        page.messages.every((m) =>
          ["user", "assistant", "tool"].includes(m.role),
        ),
      ).toBe(true);
      expect(page.messages.every((m) => m.id.startsWith(`${child}:`))).toBe(
        true,
      );
    }
  });

  it("rejects wrong-parent, changed-body, forged and expired capabilities at the real branch boundary", () => {
    const parent = "v08-authority-parent";
    const twin = "v08-authority-twin";
    for (const id of [parent, twin]) {
      store.startSession(id, {});
      pair(id, "identical question", "identical answer");
    }
    const messages = store.readVerifiedMessages(parent);
    expect(store.readVerifiedMessages(twin)).toEqual(messages);
    const parentBefore = store.readVerifiedEvents(parent);
    const twinBefore = store.readVerifiedEvents(twin);
    const target = "v08-authority-child";
    let expired;
    const create = (
      history,
      parentSessionId = parent,
      bodyMessages = messages,
    ) =>
      store.createBranchSession({
        parentSessionId,
        branchSessionId: target,
        parentTurnId: "selected",
        messages: bodyMessages,
        history,
      });
    projectBranch(parent, messages, (capability) => {
      expect(capability).toBeTruthy();
      expired = capability;
      expect(() => create(capability, twin)).toThrow(
        /expired or does not match/,
      );
      expect(existsSync(store.sessionPath(target))).toBe(false);
      const changed = [
        { ...messages[0], content: "different question" },
        messages[1],
      ];
      expect(() => create(capability, parent, changed)).toThrow(
        /expired or does not match/,
      );
      expect(existsSync(store.sessionPath(target))).toBe(false);
      expect(() => create({})).toThrow(/expired or does not match/);
      expect(existsSync(store.sessionPath(target))).toBe(false);
      // Same consumer, same valid prerequisites: only the rejected binding differs.
      const plan = resolveSessionBranchHistory(capability, parent, messages);
      expect(plan.parentSessionId).toBe(parent);
      expect(create(capability).created).toBe(true);
    });
    // Validation also precedes the idempotent-existing-target path.
    expect(() => create(expired)).toThrow(/expired or does not match/);
    expect(store.readVerifiedEvents(parent)).toEqual(parentBefore);
    expect(store.readVerifiedEvents(twin)).toEqual(twinBefore);
    expect(body(history(target))).toEqual(
      expectedPair("identical question", "identical answer"),
    );
    expect(
      store.readVerifiedEvents(target).find((e) => e.type === "session_branch")
        .data.parentSessionId,
    ).toBe(parent);
  });
});
