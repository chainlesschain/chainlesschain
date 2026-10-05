import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

export function verifyDiagnosticCapture(directory, host) {
  assert.ok(["vscode", "jetbrains"].includes(host));
  const read = (file) =>
    JSON.parse(fs.readFileSync(path.join(directory, file), "utf8"));
  const records = read("protocol.json");
  const rawFiles = fs
    .readdirSync(directory)
    .filter(
      (file) => file !== "ui.ndjson" && /\.(?:ndjson|jsonl)$/u.test(file),
    );
  assert.equal(rawFiles.length, 1, "exactly one raw task generation required");
  const raw = fs
    .readFileSync(path.join(directory, rawFiles[0]), "utf8")
    .trim()
    .split(/\r?\n/u)
    .map(JSON.parse);
  assert.deepEqual(
    records,
    raw,
    "protocol summary must preserve every raw field",
  );
  records.forEach((row, index) => assert.equal(row.sequence, index + 1));
  assert.equal(new Set(records.map((row) => row.generation)).size, 1);
  assert.equal(records.filter((row) => row.direction === "input").length, 1);
  assert.equal(records[0].event.permission_mode, "acceptEdits");
  assert.deepEqual(records.at(-1).event, {
    code: 0,
    signal: null,
    stdoutDrained: true,
  });
  const ui = read("ui.json");
  if (fs.existsSync(path.join(directory, "ui.ndjson")))
    assert.deepEqual(
      ui,
      fs
        .readFileSync(path.join(directory, "ui.ndjson"), "utf8")
        .trim()
        .split(/\r?\n/u)
        .map(JSON.parse),
      "UI summary must preserve the raw action log",
    );
  assert.deepEqual(
    ui.map((row) => row.action),
    [
      "submit",
      "background-tab",
      "return-tab",
      "final-result",
      "reload",
      "restored-result",
    ],
  );
  assert.equal(ui[3].resultDigest, ui[5].resultDigest);
  assert.match(ui[3].resultDigest, /^sha256:[0-9a-f]{64}$/u);
  // Per-host drivers additionally assert real PID/profile/session/text identities.
  const initial = read(
    host === "vscode" ? "vscode-initial.json" : "restart-state.json",
  );
  const restart = read(
    host === "vscode" ? "vscode-restart.json" : "restored-snapshot.json",
  );
  const digests = Object.fromEntries(
    fs
      .readdirSync(directory)
      .filter((file) => /\.(?:json|jsonl|ndjson)$/u.test(file))
      .map((file) => [
        file,
        `sha256:${createHash("sha256")
          .update(fs.readFileSync(path.join(directory, file)))
          .digest("hex")}`,
      ]),
  );
  return {
    rawRecords: records.length,
    uiActions: ui.length,
    initial,
    restart,
    digests,
  };
}

export function reserveArtifactDirectory(directory) {
  if (!directory) return null;
  const destination = path.resolve(directory);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.mkdirSync(destination); // Never replace a prior attempt.
  return destination;
}

export function archiveDiagnostic(root, destination) {
  if (!destination) return;
  // Preserve raw evidence and logs, not the live IDE profile, extensions or
  // canonical store. Profiles contain platform sockets/locks and are not
  // portable artifacts. The original isolated profile remains at root.
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (
      entry.isFile() ||
      (entry.isDirectory() && ["capture", "captureDir"].includes(entry.name))
    ) {
      fs.cpSync(
        path.join(root, entry.name),
        path.join(destination, entry.name),
        {
          recursive: true,
          force: false,
          errorOnExist: true,
        },
      );
    }
  }
}
