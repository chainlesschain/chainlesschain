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
  const savedImages = (s, count) =>
    s.attachmentChips?.length === count &&
    s.attachments?.length === count &&
    s.attachments.every((image) => image.loaded) &&
    s.draftStatus.includes("Draft saved on this device");
  const attachImage = async (fixture, via, count) => {
    await call({ action: "attachImage", fixture, via });
    return wait(`saved ${fixture} attachment via ${via}`, (s) =>
      savedImages(s, count),
    );
  };
  const imageEvidence = (s) => ({
    inputText: s.inputText,
    attachmentChips: s.attachmentChips,
    attachments: s.attachments,
    draftStatus: s.draftStatus,
  });
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
    const bImage = await attachImage("gif", "drop", 1);
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
    await saveDraft("unsent draft A 中文😀");
    const aDraft = await attachImage("png", "paste", 1);
    assert.notEqual(aDraft.attachments[0].sha256, bImage.attachments[0].sha256);
    const rejectedImages = [];
    for (const [fixture, via, message] of [
      ["unsupported", "paste", "Use PNG, JPEG, GIF or WebP images."],
      ["oversized", "drop", "Images must total at most 20 MiB per message."],
      ["malformed", "paste", "Unsupported or malformed image header"],
    ]) {
      await call({ action: "attachImage", fixture, via });
      const rejected = await wait(
        `visible ${fixture} attachment feedback`,
        (s) =>
          s.text.includes(message) &&
          s.attachmentChips?.length === (fixture === "malformed" ? 2 : 1),
      );
      assert.equal(rejected.inputText, aDraft.inputText);
      if (fixture === "malformed") {
        assert.ok(rejected.draftStatus.includes("Draft could not be saved:"));
        await call({ action: "removeAttachment", index: 1 });
        await wait("invalid attachment removed and draft saved", (s) =>
          savedImages(s, 1),
        );
      }
      rejectedImages.push({
        fixture,
        via,
        feedbackText: rejected.text,
        ...imageEvidence(rejected),
      });
    }
    for (let count = 2; count <= 4; count++)
      await attachImage("png", "drop", count);
    await call({ action: "attachImage", fixture: "gif", via: "paste" });
    const limit = await wait(
      "fifth attachment refused",
      (s) =>
        s.text.includes("Attach at most 4 images per message.") &&
        savedImages(s, 4),
    );
    rejectedImages.push({
      fixture: "count-limit",
      via: "paste",
      feedbackText: limit.text,
      ...imageEvidence(limit),
    });
    for (let index = 3; index >= 1; index--) {
      await call({ action: "removeAttachment", index });
      await wait("extra attachment removed", (s) => savedImages(s, index));
    }
    await switchTab(b.id);
    const bRestored = await wait(
      "B draft restored on tab switch",
      (s) => s.inputText === "unsent draft B 中文😀" && savedImages(s, 1),
    );
    await switchTab(a.id);
    const aRestored = await wait(
      "A draft restored on tab switch",
      (s) => s.inputText === "unsent draft A 中文😀" && savedImages(s, 1),
    );
    assert.deepEqual(aRestored.attachments, aDraft.attachments);
    assert.deepEqual(bRestored.attachments, bImage.attachments);
    const sessionA = repeated.savedRows[0].id.split(":").slice(0, -2).join(":");
    assert.equal(completedA.sessionId, sessionA);
    assert.ok(
      completedA.at >= backgroundAt && completedA.at <= foregroundReturnAt,
      "A did not finish while another conversation was active",
    );
    evidence = {
      schema: "cc-ide-conversation-recovery/v3",
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
      images: {
        a: imageEvidence(aDraft),
        b: imageEvidence(bImage),
        tabSwitch: { a: imageEvidence(aRestored), b: imageEvidence(bRestored) },
        rejected: rejectedImages,
      },
    };
  } else {
    const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
    const initial = await wait(
      "persisted conversation tabs",
      (s) =>
        s.tabs.some((t) => t.title.includes("journey:history-A")) &&
        s.tabs.some((t) => t.title.includes("journey:history-B")),
    );
    const restoredImages = {};
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
          s.inputText === baseline[key].draft &&
          savedImages(s, 1),
      );
      assertHistory(restored, letter, turns);
      assert.deepEqual(
        restored.savedRows.map((r) => r.id),
        baseline[key].savedRows.map((r) => r.id),
      );
      restoredImages[key] = imageEvidence(restored);
      assert.deepEqual(
        restored.attachmentChips,
        baseline.images[key].attachmentChips,
      );
      assert.deepEqual(restored.attachments, baseline.images[key].attachments);
    }
    evidence = {
      schema: baseline.schema,
      phase,
      historyIdsPreserved: true,
      composerDraftsPreserved: true,
      automaticInputReplay: false,
      images: restoredImages,
    };
  }
  const trace = readTrace();
  assert.ok(
    !trace.some(
      (r) =>
        r.direction === "in" &&
        r.event?.type === "user" &&
        r.event.images?.length,
    ),
    "attachment draft was automatically dispatched",
  );
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
    assert.ok(
      [
        "cc-ide-conversation-recovery/v2",
        "cc-ide-conversation-recovery/v3",
      ].includes(evidence.schema),
    );
    assert.equal(evidence.phase, phase);
  }
  assert.equal(restart.historyIdsPreserved, true);
  assert.equal(restart.schema, initial.schema);
  assert.equal(restart.composerDraftsPreserved, true);
  assert.equal(restart.automaticInputReplay, false);
  assert.equal(initial.a.savedRows.length, 4);
  assert.equal(initial.b.savedRows.length, 2);
  for (const key of ["a", "b"]) {
    for (const snapshot of [
      initial.images?.[key],
      initial.images?.tabSwitch?.[key],
      restart.images?.[key],
    ]) {
      assert.ok(snapshot, `missing ${key} image draft evidence`);
      assert.equal(snapshot.attachmentChips.length, 1);
      assert.equal(snapshot.attachments.length, 1);
      const image = snapshot.attachments[0];
      assert.match(image.sha256, /^[a-f0-9]{64}$/u);
      assert.equal(image.loaded, true);
      assert.equal(image.naturalWidth, 1);
      assert.equal(image.naturalHeight, 1);
      if (initial.schema === "cc-ide-conversation-recovery/v3") {
        assert.equal(image.decodeSource, "isolated-image-decoder");
        assert.equal(image.decodedFrames, 1);
        assert.equal(image.previewWidth, 40);
        assert.equal(image.previewHeight, 40);
      }
      assert.equal(image.mime, key === "a" ? "image/png" : "image/gif");
      assert.ok(Number.isInteger(image.bytes) && image.bytes > 0);
      assert.deepEqual(snapshot.attachments, initial.images[key].attachments);
      assert.equal(snapshot.inputText, initial[key].draft);
      assert.ok(snapshot.draftStatus.includes("Draft saved on this device"));
      assert.deepEqual(
        snapshot.attachmentChips,
        initial.images[key].attachmentChips,
      );
    }
  }
  assert.notEqual(
    initial.images.a.attachments[0].sha256,
    initial.images.b.attachments[0].sha256,
  );
  const rejected = initial.images.rejected;
  assert.deepEqual(
    rejected.map((r) => r.fixture),
    ["unsupported", "oversized", "malformed", "count-limit"],
  );
  const errors = {
    unsupported: "Use PNG, JPEG, GIF or WebP images.",
    oversized: "Images must total at most 20 MiB per message.",
    malformed: "Unsupported or malformed image header",
    "count-limit": "Attach at most 4 images per message.",
  };
  for (const item of rejected) {
    assert.ok(item.feedbackText.includes(errors[item.fixture]));
    assert.equal(item.inputText, initial.a.draft);
    assert.equal(
      item.attachmentChips.length,
      item.fixture === "malformed" ? 2 : item.fixture === "count-limit" ? 4 : 1,
    );
    if (item.fixture === "malformed") {
      assert.ok(item.draftStatus.includes("Draft could not be saved:"));
      assert.ok(item.draftStatus.includes(errors.malformed));
    }
  }
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
  assert.ok(
    !records.some(
      (r) =>
        r.direction === "in" &&
        r.event?.type === "user" &&
        r.event.images?.length,
    ),
    "attachment draft was automatically dispatched",
  );
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
