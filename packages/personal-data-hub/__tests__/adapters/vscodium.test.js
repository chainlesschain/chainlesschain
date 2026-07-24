"use strict";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

const {
  VSCodiumAdapter,
  VSCODIUM_NAME,
  VSCODIUM_VERSION,
  defaultVscodiumRoot,
} = require("../../lib/adapters/vscodium");
const { VSCodeAdapter } = require("../../lib/adapters/vscode");
const { assertAdapter } = require("../../lib/adapter-spec");
const { validateEvent, validateItem } = require("../../lib/schemas");

let tempRoot;
let vscodiumRoot;

function buildFixture() {
  const workspaceDirectory = join(
    vscodiumRoot,
    "User",
    "workspaceStorage",
    "fixture-workspace",
  );
  mkdirSync(workspaceDirectory, { recursive: true });
  const workspaceManifest = join(workspaceDirectory, "workspace.json");
  writeFileSync(
    workspaceManifest,
    JSON.stringify({ folder: "file:///c%3A/private/codium-project" }),
    "utf8",
  );
  utimesSync(workspaceManifest, 1_700_000_001, 1_700_000_001);

  const globalStorage = join(vscodiumRoot, "User", "globalStorage");
  mkdirSync(globalStorage, { recursive: true });
  const db = new Database(join(globalStorage, "state.vscdb"));
  db.exec("CREATE TABLE ItemTable(key TEXT PRIMARY KEY, value BLOB)");
  const put = db.prepare("INSERT INTO ItemTable(key, value) VALUES(?, ?)");
  put.run(
    "terminal.history.entries.commands",
    JSON.stringify({
      entries: [{ key: "git status", value: { shellType: "pwsh" } }],
    }),
  );
  put.run(
    "terminal.history.entries.dirs",
    JSON.stringify({
      entries: [
        {
          key: "C:\\private\\codium-project",
          value: { shellType: "pwsh" },
        },
      ],
    }),
  );
  put.run("terminal.history.timestamp.commands", "1700000010000");
  put.run("terminal.history.timestamp.dirs", "1700000020000");
  db.close();

  const historyDirectory = join(
    vscodiumRoot,
    "User",
    "History",
    "fixture-history",
  );
  mkdirSync(historyDirectory, { recursive: true });
  writeFileSync(
    join(historyDirectory, "entries.json"),
    JSON.stringify({
      version: 1,
      resource: "file:///c%3A/private/codium-project/secret.ts",
      entries: [
        {
          id: "private-copy.ts",
          timestamp: 1_700_000_030_000,
          source: "sensitive save source",
        },
      ],
    }),
    "utf8",
  );
  writeFileSync(
    join(historyDirectory, "private-copy.ts"),
    "private source content must never be opened",
    "utf8",
  );
}

async function collect(adapter, options = {}) {
  const records = [];
  for await (const record of adapter.sync(options)) records.push(record);
  return records;
}

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "vscodium-adapter-test-"));
  vscodiumRoot = join(tempRoot, "VSCodium");
});

afterEach(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

describe("VSCodiumAdapter", () => {
  it("has an isolated contract, identity, and profile-directory capability", () => {
    const adapter = new VSCodiumAdapter();

    expect(assertAdapter(adapter)).toEqual({ ok: true });
    expect(adapter.name).toBe(VSCODIUM_NAME);
    expect(adapter.name).toBe("vscodium");
    expect(adapter.version).toBe(VSCODIUM_VERSION);
    expect(adapter.version).toBe("0.1.0");
    expect(adapter.capabilities).toEqual(
      expect.arrayContaining([
        "sync:vscodium-workspace-storage",
        "sync:vscodium-globalstorage-sqlite",
        "sync:vscodium-local-history-metadata",
        "sync:profile-directory",
      ]),
    );
    expect(adapter.runtimeCredentialOption).toBe("vscodiumRoot");
    expect(defaultVscodiumRoot()).toMatch(/VSCodium$/u);
  });

  it("reports product-specific setup errors without disclosing a path", async () => {
    const unresolved = new VSCodiumAdapter({ defaultRoot: () => null });
    expect(await unresolved.authenticate()).toMatchObject({
      ok: false,
      reason: "VSCODIUM_ROOT_UNRESOLVED",
    });

    const missing = new VSCodiumAdapter({ vscodiumRoot });
    const result = await missing.authenticate();
    expect(result).toMatchObject({
      ok: false,
      reason: "VSCODIUM_NOT_FOUND",
    });
    expect(JSON.stringify(result)).not.toContain(vscodiumRoot);
  });

  it("collects workspaces, terminal history, and save metadata via the shared reader", async () => {
    buildFixture();
    const adapter = new VSCodiumAdapter({ defaultRoot: () => vscodiumRoot });
    const records = await collect(adapter);

    expect(records.map((record) => record.kind)).toEqual([
      "workspace",
      "terminal-command",
      "terminal-dir",
      "local-history-save",
    ]);
    expect(
      records.every((record) =>
        record.originalId.startsWith(`vscodium-${record.kind}:`),
      ),
    ).toBe(true);
    expect(
      records.find((record) => record.kind === "workspace").payload,
    ).toMatchObject({
      name: "codium-project",
      resourceScheme: "file",
    });
    expect(
      records.find((record) => record.kind === "terminal-dir").payload.pathHash,
    ).toMatch(/^[0-9a-f]{64}$/u);
    expect(
      records.find((record) => record.kind === "local-history-save").payload,
    ).toMatchObject({
      fileName: "secret.ts",
      fileExtension: ".ts",
      hasSaveSource: true,
    });

    const serialized = JSON.stringify(records);
    expect(serialized).not.toContain(vscodiumRoot);
    expect(serialized).not.toContain("C:\\private");
    expect(serialized).not.toContain("c%3A/private");
    expect(serialized).not.toContain("sensitive save source");
    expect(serialized).not.toContain("private source content");
  });

  it("normalizes with VSCodium source and editor identity", async () => {
    buildFixture();
    const adapter = new VSCodiumAdapter({ vscodiumRoot });
    const records = await collect(adapter);
    const normalized = records.map((record) => adapter.normalize(record));
    const events = normalized.flatMap((entry) => entry.events);
    const items = normalized.flatMap((entry) => entry.items);

    expect(events).toHaveLength(3);
    expect(items).toHaveLength(1);
    expect(events.every((event) => validateEvent(event).valid)).toBe(true);
    expect(items.every((item) => validateItem(item).valid)).toBe(true);
    expect(
      [...events, ...items].every(
        (entity) =>
          entity.source.adapter === "vscodium" &&
          entity.extra.editor === "vscodium",
      ),
    ).toBe(true);
    expect(
      events.every((event) => event.id.startsWith("event-vscodium-")),
    ).toBe(true);
    expect(items[0].id).toMatch(/^item-vscodium-workspace-/u);
  });

  it("supports profilePath, opt-outs, incremental filtering, and complete-scan watermarking", async () => {
    buildFixture();
    const adapter = new VSCodiumAdapter();
    let complete = false;
    const records = await collect(adapter, {
      profilePath: vscodiumRoot,
      since: 1_700_000_015_000,
      include: { workspaces: false, terminal: false },
      markWatermarkComplete: () => {
        complete = true;
      },
    });

    expect(records).toHaveLength(1);
    expect(records[0].kind).toBe("local-history-save");
    expect(complete).toBe(true);

    let limitedComplete = false;
    const limited = await collect(adapter, {
      profilePath: vscodiumRoot,
      limit: 1,
      markWatermarkComplete: () => {
        limitedComplete = true;
      },
    });
    expect(limited).toHaveLength(1);
    expect(limitedComplete).toBe(false);
  });

  it("keeps VSCodium and VS Code account scopes and record ids disjoint", async () => {
    buildFixture();
    const codium = new VSCodiumAdapter({ vscodiumRoot });
    const vscode = new VSCodeAdapter({ vscodeRoot: vscodiumRoot });
    const [codiumRecords, vscodeRecords] = await Promise.all([
      collect(codium),
      collect(vscode),
    ]);

    expect(codium.resolveDefaultScope()).not.toBe(vscode.resolveDefaultScope());
    expect(
      new Set(codiumRecords.map((record) => record.originalId)),
    ).not.toEqual(new Set(vscodeRecords.map((record) => record.originalId)));
  });
});
