import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  verifyDiagnosticCapture,
  reserveArtifactDirectory,
  archiveDiagnostic,
} from "../lib/verify01-diagnostic-evidence.mjs";

function fixture(t) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-diagnostic-evidence-"),
  );
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const records = [
    {
      sequence: 1,
      generation: "test",
      direction: "output",
      event: { permission_mode: "acceptEdits" },
    },
    { sequence: 2, generation: "test", direction: "input", event: {} },
    {
      sequence: 3,
      generation: "test",
      direction: "exit",
      event: { code: 0, signal: null, stdoutDrained: true },
    },
  ];
  const write = (file, value) =>
    fs.writeFileSync(path.join(directory, file), JSON.stringify(value));
  write("protocol.json", records);
  fs.writeFileSync(
    path.join(directory, "protocol-test.jsonl"),
    records.map(JSON.stringify).join("\n"),
  );
  write(
    "ui.json",
    [
      "submit",
      "background-tab",
      "return-tab",
      "final-result",
      "reload",
      "restored-result",
    ].map((action) => ({ action, resultDigest: `sha256:${"a".repeat(64)}` })),
  );
  write("restart-state.json", { fixture: true });
  write("restored-snapshot.json", { fixture: true });
  return { directory, records, write };
}

test("diagnostic summary verifies raw capture and hashes every artifact", (t) => {
  const { directory } = fixture(t);
  const result = verifyDiagnosticCapture(directory, "jetbrains");
  assert.equal(result.rawRecords, 3);
  assert.equal(result.uiActions, 6);
  assert.equal(Object.keys(result.digests).length, 5);
});

test("summary dropping explicit null is rejected", (t) => {
  const { directory, records, write } = fixture(t);
  delete records.at(-1).event.signal;
  write("protocol.json", records);
  assert.throws(
    () => verifyDiagnosticCapture(directory, "jetbrains"),
    /preserve every raw field/u,
  );
});

test("VS Code UI action log is verified separately from protocol generations", (t) => {
  const { directory } = fixture(t);
  const ui = JSON.parse(
    fs.readFileSync(path.join(directory, "ui.json"), "utf8"),
  );
  fs.writeFileSync(
    path.join(directory, "ui.ndjson"),
    ui.map(JSON.stringify).join("\n"),
  );
  assert.equal(verifyDiagnosticCapture(directory, "jetbrains").rawRecords, 3);
  fs.appendFileSync(path.join(directory, "ui.ndjson"), '\n{"action":"submit"}');
  assert.throws(
    () => verifyDiagnosticCapture(directory, "jetbrains"),
    /raw action log/u,
  );
});

test("second raw generation and incomplete UI sequence are rejected", (t) => {
  const { directory, write } = fixture(t);
  write("extra.ndjson", {});
  assert.throws(
    () => verifyDiagnosticCapture(directory, "jetbrains"),
    /one raw task/u,
  );
  fs.unlinkSync(path.join(directory, "extra.ndjson"));
  write("ui.json", []);
  assert.throws(() => verifyDiagnosticCapture(directory, "jetbrains"));
});

test("archive refuses prior attempts and preserves hidden diagnostic files", (t) => {
  const { directory, write } = fixture(t);
  write(".hidden.json", { fixture: true });
  fs.mkdirSync(path.join(directory, "userDataDir"));
  fs.writeFileSync(path.join(directory, "userDataDir", "profile.json"), "{}");
  const destination = reserveArtifactDirectory(
    path.join(directory, "..", `${path.basename(directory)}-archive`),
  );
  t.after(() => fs.rmSync(destination, { recursive: true, force: true }));
  archiveDiagnostic(directory, destination);
  assert.ok(fs.existsSync(path.join(destination, ".hidden.json")));
  assert.equal(fs.existsSync(path.join(destination, "userDataDir")), false);
  assert.throws(() => reserveArtifactDirectory(destination), {
    code: "EEXIST",
  });
  assert.throws(() => archiveDiagnostic(directory, destination));
});
