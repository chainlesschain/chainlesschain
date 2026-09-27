import { afterEach, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { canonicalTranscriptPeer } from "../../../../tests/fixtures/ide-roadmap/canonical-transcript-peer.mjs";
const roots = [],
  children = [];
const script = fileURLToPath(
  new URL(
    "../../../../tests/fixtures/ide-roadmap/fake-stream-json-agent.mjs",
    import.meta.url,
  ),
);
function harness() {
  const root = mkdtempSync(join(tmpdir(), "cc-canonical-peer-test-"));
  roots.push(root);
  const env = {
    ...process.env,
    CC_UI_CANONICAL_ROOT: root,
    CC_UI_FIXTURE_STATE: join(root, "state.json"),
    CC_UI_FIXTURE_TRACE: join(root, "trace.jsonl"),
  };
  return {
    query: (args) => {
      const result = spawnSync(process.execPath, [script, ...args], {
        env,
        encoding: "utf8",
        timeout: 30_000,
        windowsHide: true,
      });
      expect(result.status, result.stderr).toBe(0);
      return JSON.parse(result.stdout);
    },
    peer: (sid) => {
      const child = spawn(
        process.execPath,
        [
          script,
          "agent",
          "--resume",
          sid,
          "--input-format",
          "stream-json",
          "--output-format",
          "stream-json",
        ],
        { env, windowsHide: true },
      );
      children.push(child);
      const events = [];
      let errors = "";
      child.stderr.on("data", (buffer) => {
        errors += buffer.toString();
      });
      createInterface({ input: child.stdout }).on("line", (line) =>
        events.push(JSON.parse(line)),
      );
      return {
        events,
        child,
        send: (event) => child.stdin.write(JSON.stringify(event) + "\n"),
        wait: async (predicate) => {
          for (let i = 0; i < 400; i++) {
            const event = events.find(predicate);
            if (event) return event;
            if (child.exitCode !== null) throw new Error(errors);
            await new Promise((r) => setTimeout(r, 25));
          }
          throw new Error("Fixture event timed out: " + errors);
        },
      };
    },
  };
}
afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode !== null) continue;
    child.stdin.end();
    await new Promise((resolve) => child.once("exit", resolve));
  }
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
it("refuses a canonical fixture root inside the worktree before initializing storage", async () => {
  await expect(canonicalTranscriptPeer(resolve("."), () => {})).rejects.toThrow(
    /outside the worktree/,
  );
});
it("persists real receipts and history across fixture/CLI processes without replaying duplicate input", async () => {
  const h = harness(),
    peer = h.peer("peer-a");
  await peer.wait((e) => e.subtype === "init");
  peer.send({
    type: "user",
    text: "journey:history-B",
    client_message_id: "input-1",
  });
  const done = await peer.wait((e) => e.type === "result");
  const baseline = h.query([
    "session",
    "show",
    "--json",
    "--history",
    "--",
    "peer-a",
  ]);
  expect(baseline.messages.map((m) => m.text)).toEqual([
    "journey:history-B",
    "canonical answer B",
  ]);
  expect(done.transcript_refs.assistantEventId).toBe(
    baseline.messages[1].eventId,
  );
  expect(done.transcript_refs.userEventId).toBe(baseline.messages[0].eventId);
  peer.send({
    type: "user",
    text: "journey:history-B",
    client_message_id: "input-1",
  });
  await peer.wait((e) => e.subtype === "input_already_accepted");
  const receipt = h.query([
    "session",
    "show",
    "--json",
    "--input-receipt",
    "input-1",
    "--",
    "peer-a",
  ]);
  expect(receipt.accepted).toBe(true);
  const delta = h.query([
    "session",
    "show",
    "--json",
    "--history",
    "--after",
    baseline.syncCursor,
    "--",
    "peer-a",
  ]);
  expect(delta.messages).toEqual([]);
});
it("uses separate durable session identities for equal text and resumes the real user-turn count", async () => {
  const h = harness(),
    a = h.peer("peer-a"),
    b = h.peer("peer-b");
  await Promise.all([
    a.wait((e) => e.subtype === "init"),
    b.wait((e) => e.subtype === "init"),
  ]);
  for (const peer of [a, b])
    peer.send({ type: "user", text: "same", client_message_id: "same-id" });
  await Promise.all([
    a.wait((e) => e.type === "result"),
    b.wait((e) => e.type === "result"),
  ]);
  const aa = h.query([
    "session",
    "show",
    "--json",
    "--history",
    "--",
    "peer-a",
  ]);
  const bb = h.query([
    "session",
    "show",
    "--json",
    "--history",
    "--",
    "peer-b",
  ]);
  expect(aa.messages[0].id).not.toBe(bb.messages[0].id);
  a.child.stdin.end();
  await new Promise((resolve) => a.child.once("exit", resolve));
  const restored = h.peer("peer-a");
  expect(
    (await restored.wait((e) => e.subtype === "init")).resumed_messages,
  ).toBe(2);
  restored.send({ type: "user", text: "same", client_message_id: "next-id" });
  expect((await restored.wait((e) => e.type === "result")).turn).toBe(2);
});
