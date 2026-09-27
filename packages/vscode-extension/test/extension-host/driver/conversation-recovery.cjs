"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/** Drives the installed extension's actual Webview controls, with no access
 * to provider internals or its draft store. Model output is deterministic. */
async function runConversationRecovery({
  commands,
  token,
  phase,
  artifactDir,
  waitForSnapshot,
}) {
  const call = (request) =>
    commands.executeCommand(
      "chainlesschain.internal.hostDomCommand",
      token,
      request,
    );
  const wait = (label, predicate = () => true) =>
    waitForSnapshot({ commands, token, label, predicate, timeoutMs: 60_000 });
  const active = (s) => s.tabs.find((t) => t.selected);
  const readTrace = () =>
    fs
      .readFileSync(process.env.CC_UI_FIXTURE_TRACE, "utf8")
      .trim()
      .split(/\r?\n/u)
      .filter(Boolean)
      .map(JSON.parse);
  const switchTab = async (id) => {
    await call({ action: "switchTab", id });
    return wait("active recovery tab", (s) => active(s)?.id === id);
  };
  const newTab = async () => {
    const before = await wait("before new conversation");
    await call({ action: "click", target: "newTab" });
    return wait(
      "new conversation",
      (s) =>
        s.tabs.length === before.tabs.length + 1 &&
        active(s)?.id !== active(before)?.id,
    );
  };
  const saveDraft = async (text) => {
    await call({ action: "editDraft", text });
    return wait(
      "saved composer draft",
      (s) =>
        s.inputText === text &&
        s.draftStatus.includes("Draft saved on this device"),
    );
  };
  const assertHistory = (snapshot, letter, turns) => {
    assert.equal(snapshot.savedRows.length, turns * 2);
    assert.equal(new Set(snapshot.savedRows.map((r) => r.id)).size, turns * 2);
    assert.equal(
      snapshot.savedRows.filter((r) =>
        r.text.includes(`journey:history-${letter}`),
      ).length,
      turns,
    );
    assert.equal(
      snapshot.savedRows.filter((r) =>
        r.text.includes(`canonical answer ${letter}`),
      ).length,
      turns,
    );
    assert.ok(
      !snapshot.text.includes(`canonical answer ${letter === "A" ? "B" : "A"}`),
      "cross-session output leaked",
    );
  };
  const baselinePath = path.join(
    artifactDir,
    "conversation-recovery-initial.json",
  );
  const original = active(await wait("original conversation"));
  let evidence;
  if (phase === "initial") {
    const a = active(await newTab());
    await call({ action: "send", text: "journey:history-A" });
    await wait("A started", (s) => s.text.includes("checking history fixture"));
    const b = active(await newTab());
    const backgroundAt = new Date().toISOString();
    await call({ action: "send", text: "journey:history-B" });
    const bDone = await wait(
      "B saved history",
      (s) => s.savedRows.length === 2,
    );
    assertHistory(bDone, "B", 1);
    await saveDraft("unsent draft B 中文😀");
    // Keep B selected until A's durable completion is observed. Timestamp
    // bounds alone after switching back could accept a foreground completion.
    const sessionB = bDone.savedRows[0].id.split(":").slice(0, -2).join(":");
    let completedA;
    await wait("A committed while B remains active", (s) => {
      assert.equal(active(s)?.id, b.id);
      completedA = readTrace().find(
        (r) =>
          r.direction === "canonical" &&
          r.at >= backgroundAt &&
          r.sessionId !== sessionB,
      );
      return Boolean(completedA);
    });
    const foregroundReturnAt = new Date().toISOString();
    await switchTab(a.id);
    const aDone = await wait(
      "background A saved history",
      (s) => s.savedRows.length === 2,
    );
    assertHistory(aDone, "A", 1);
    await call({ action: "send", text: "journey:history-A" });
    const repeated = await wait(
      "repeated text with distinct identities",
      (s) => s.savedRows.length === 4,
    );
    assertHistory(repeated, "A", 2);
    assert.ok(
      repeated.text.includes("checking history fixture"),
      "intermediate output was removed",
    );
    const aDraft = await saveDraft("unsent draft A 中文😀");
    await switchTab(b.id);
    await wait(
      "B draft restored on tab switch",
      (s) => s.inputText === "unsent draft B 中文😀",
    );
    await switchTab(a.id);
    await wait(
      "A draft restored on tab switch",
      (s) => s.inputText === "unsent draft A 中文😀",
    );
    const sessionA = repeated.savedRows[0].id.split(":").slice(0, -2).join(":");
    assert.equal(completedA.sessionId, sessionA);
    assert.ok(
      completedA.at >= backgroundAt && completedA.at <= foregroundReturnAt,
      "A did not finish while another conversation was active",
    );
    evidence = {
      schema: "cc-ide-conversation-recovery/v1",
      phase,
      original,
      backgroundAt,
      foregroundReturnAt,
      backgroundCompletedAt: completedA.at,
      a: { id: a.id, draft: aDraft.inputText, savedRows: repeated.savedRows },
      b: {
        id: b.id,
        draft: "unsent draft B 中文😀",
        savedRows: bDone.savedRows,
      },
      model: "deterministic fixture",
      persistence: "production canonical store and actual CLI command",
    };
  } else {
    const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
    const initial = await wait(
      "persisted conversation tabs",
      (s) =>
        s.tabs.some((t) => t.title.includes("journey:history-A")) &&
        s.tabs.some((t) => t.title.includes("journey:history-B")),
    );
    for (const [letter, key, turns] of [
      ["A", "a", 2],
      ["B", "b", 1],
    ]) {
      const tab = initial.tabs.find((t) =>
        t.title.includes(`journey:history-${letter}`),
      );
      await switchTab(tab.id);
      const restored = await wait(
        "history and unsent draft after process restart",
        (s) =>
          s.savedRows.length === turns * 2 &&
          s.inputText === baseline[key].draft,
      );
      assertHistory(restored, letter, turns);
      assert.deepEqual(
        restored.savedRows.map((r) => r.id),
        baseline[key].savedRows.map((r) => r.id),
      );
    }
    evidence = {
      schema: baseline.schema,
      phase,
      historyIdsPreserved: true,
      composerDraftsPreserved: true,
      automaticInputReplay: false,
    };
  }
  const trace = readTrace();
  const sent = trace
    .filter((r) => r.direction === "in" && r.event?.type === "user")
    .map((r) => r.event.text);
  assert.equal(sent.filter((text) => text === "journey:history-A").length, 2);
  assert.equal(sent.filter((text) => text === "journey:history-B").length, 1);
  assert.ok(
    !sent.some((text) => text.startsWith("unsent draft")),
    "draft restoration sent an input",
  );
  await switchTab(original.id);
  fs.mkdirSync(artifactDir, { recursive: true });
  fs.writeFileSync(
    path.join(artifactDir, `conversation-recovery-${phase}.json`),
    JSON.stringify(evidence, null, 2) + "\n",
    { flag: "wx", mode: 0o600 },
  );
}
function assertConversationRecoveryArtifacts(artifactDir, records) {
  const read = (phase) =>
    JSON.parse(
      fs.readFileSync(
        path.join(artifactDir, `conversation-recovery-${phase}.json`),
        "utf8",
      ),
    );
  const initial = read("initial");
  const restart = read("restart");
  for (const [phase, evidence] of [
    ["initial", initial],
    ["restart", restart],
  ]) {
    assert.equal(evidence.schema, "cc-ide-conversation-recovery/v1");
    assert.equal(evidence.phase, phase);
  }
  assert.equal(restart.historyIdsPreserved, true);
  assert.equal(restart.composerDraftsPreserved, true);
  assert.equal(restart.automaticInputReplay, false);
  assert.equal(initial.a.savedRows.length, 4);
  assert.equal(initial.b.savedRows.length, 2);
  assert.equal(
    new Set([...initial.a.savedRows, ...initial.b.savedRows].map((r) => r.id))
      .size,
    6,
  );
  assert.ok(Number.isFinite(Date.parse(initial.backgroundAt)));
  assert.ok(Number.isFinite(Date.parse(initial.foregroundReturnAt)));
  assert.ok(
    initial.backgroundCompletedAt >= initial.backgroundAt &&
      initial.backgroundCompletedAt <= initial.foregroundReturnAt,
  );
  const sessionA = initial.a.savedRows[0].id.split(":").slice(0, -2).join(":");
  assert.ok(
    records.some(
      (r) =>
        r.direction === "canonical" &&
        r.sessionId === sessionA &&
        r.at === initial.backgroundCompletedAt,
    ),
  );
  const inputs = records
    .filter((r) => r.direction === "in" && r.event?.type === "user")
    .map((r) => r.event.text);
  assert.equal(inputs.filter((t) => t === "journey:history-A").length, 2);
  assert.equal(inputs.filter((t) => t === "journey:history-B").length, 1);
  assert.ok(
    !inputs.some((t) => typeof t === "string" && t.startsWith("unsent draft")),
  );
}
module.exports = {
  runConversationRecovery,
  assertConversationRecoveryArtifacts,
};
