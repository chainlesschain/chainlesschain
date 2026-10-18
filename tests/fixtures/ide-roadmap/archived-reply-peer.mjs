#!/usr/bin/env node
/** Fixed archived bytes only. No provider, agent runtime, tools or network client. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { randomUUID } from "node:crypto";
import { canonicalTranscriptPeer } from "./canonical-transcript-peer.mjs";
import {
  digest,
  validateReplyFixture,
} from "../../../packages/jetbrains-plugin/scripts/archived-reply-evidence.mjs";

const argv = process.argv.slice(2);
const tracePath = process.env.CC_ARCHIVED_REPLY_TRACE;
assert.ok(tracePath && path.isAbsolute(tracePath));
function trace(record) {
  fs.appendFileSync(
    tracePath,
    JSON.stringify({
      at: new Date().toISOString(),
      processId: process.pid,
      ...record,
    }) + "\n",
    { mode: 0o600 },
  );
}
function emit(event) {
  process.stdout.write(JSON.stringify(event) + "\n");
}
async function done(code = 0) {
  await new Promise((resolve) => process.stdout.write("", resolve));
  process.exit(code);
}
let stage = "validate-fixture";
try {
  const file = process.env.CC_ARCHIVED_REPLY_MANIFEST;
  assert.ok(
    file && path.isAbsolute(file) && !fs.lstatSync(file).isSymbolicLink(),
  );
  assert.ok(fs.statSync(file).size <= 2 * 1024 * 1024);
  const bytes = fs.readFileSync(file);
  assert.equal(digest(bytes), process.env.CC_ARCHIVED_REPLY_MANIFEST_DIGEST);
  const fixture = validateReplyFixture(JSON.parse(bytes));
  stage = "validate-invocation";
  if (argv.length === 1 && argv[0] === "--version") {
    trace({ command: "archived-peer-version" });
    process.stdout.write("0.999.0-archived-reply\n");
    await done();
  }
  if (argv[0] === "config" && argv[1] === "list") {
    emit({
      llm: {
        provider: "ollama",
        model: "archived-reply-fixture",
        baseUrl: "http://127.0.0.1:1",
        apiKey: null,
      },
    });
    await done();
  }
  if (
    argv.length === 3 &&
    argv[0] === "config" &&
    argv[1] === "get" &&
    argv[2] === "llm.provider"
  ) {
    trace({ command: "archived-peer-config-provider" });
    process.stdout.write("ollama\n");
    await done();
  }
  if (argv[0] === "context") {
    emit({ total: 0, window: 4096, pct: 0, overflow: false });
    await done();
  }
  assert.ok(
    argv[0] === "agent" ||
      (argv[0] === "session" &&
        argv[1] === "show" &&
        (argv.includes("--history") || argv.includes("--input-receipt"))),
    "only archived reply or read-only canonical history is allowed",
  );
  stage = "load-canonical-store";
  const canonical = await canonicalTranscriptPeer(
    process.env.CC_UI_CANONICAL_ROOT,
    trace,
  );
  stage = "canonical-history";
  if (await canonical.command(argv)) await done(process.exitCode || 0);
  trace({ command: "archived-agent-start" });
  // A second launch is an error even if the GUI tries to restore automatically.
  fs.writeFileSync(
    path.join(process.env.CC_UI_CANONICAL_ROOT, "archived-agent-started"),
    "one reply only\n",
    { flag: "wx", mode: 0o600 },
  );
  const index = argv.indexOf("--resume");
  const sessionId = index >= 0 ? argv[index + 1] : `archived-${randomUUID()}`;
  assert.ok(sessionId);
  stage = "start-canonical-session";
  const prior = canonical.start(sessionId);
  assert.equal(prior.messages, 0);
  emit({
    type: "system",
    subtype: "init",
    protocol_version: 1,
    provider: "fixture",
    model: "archived-reply",
    session_id: sessionId,
    permission_mode: "default",
    resumed_messages: 0,
    slash_commands: [],
    input_receipts: { version: 1 },
  });
  const timeout = setTimeout(() => {
    trace({ command: "archived-peer-rejected", reason: "input deadline" });
    process.exit(1);
  }, 60000);
  const input = readline.createInterface({ input: process.stdin });
  stage = "read-fixed-input";
  for await (const line of input) {
    assert.ok(Buffer.byteLength(line) <= 16384);
    const event = JSON.parse(line);
    assert.equal(event.type, "user");
    assert.equal(event.text, fixture.prompt);
    assert.ok(
      !event.images?.length,
      "no attachments or new task input permitted",
    );
    stage = "persist-fixed-input";
    const accepted = canonical.accept(sessionId, event, emit);
    assert.equal(accepted.duplicate, false);
    emit({
      type: "stream_event",
      event: { delta: { type: "text_delta", text: fixture.source } },
    });
    stage = "persist-fixed-reply";
    const refs = canonical.finish(sessionId, fixture.source, accepted);
    emit({
      type: "result",
      subtype: "success",
      is_error: false,
      turn: 1,
      result: fixture.source,
      session_id: sessionId,
      transcript_refs: refs,
    });
    trace({
      command: "archived-reply",
      sessionId,
      sourceDigest: fixture.sourceDigest,
      modelRequests: 0,
    });
    clearTimeout(timeout);
    await done();
  }
  throw new Error("archived reply input missing");
} catch (error) {
  trace({
    command: "archived-peer-rejected",
    reason: error.code || "INVALID_REPLAY",
    stage,
    invocation: ["--version", "config", "context", "agent", "session"].includes(
      argv[0],
    )
      ? argv[0]
      : "unsupported",
  });
  process.stderr.write(
    `Archived reply fixture rejected the invocation or input at ${stage} (${error.code || error.name || "Error"}).\n`,
  );
  await done(1);
}
