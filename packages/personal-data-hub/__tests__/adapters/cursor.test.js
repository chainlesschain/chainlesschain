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
  CursorAdapter,
  CURSOR_NAME,
  CURSOR_VERSION,
  defaultCursorHome,
  defaultCursorRoot,
  readAgentTranscripts,
  readAiTracking,
} = require("../../lib/adapters/cursor");
const { VSCodeAdapter } = require("../../lib/adapters/vscode");
const { assertAdapter } = require("../../lib/adapter-spec");
const { validate } = require("../../lib/schemas");

let tempRoot;
let cursorRoot;
let cursorHome;

function makeEditorState() {
  const workspaceDirectory = join(
    cursorRoot,
    "User",
    "workspaceStorage",
    "private-workspace-storage-id",
  );
  mkdirSync(workspaceDirectory, { recursive: true });
  const workspaceManifest = join(workspaceDirectory, "workspace.json");
  writeFileSync(
    workspaceManifest,
    JSON.stringify({ folder: "file:///c%3A/private/cursor-project" }),
    "utf8",
  );
  utimesSync(workspaceManifest, 1_700_000_001, 1_700_000_001);

  const globalStorage = join(cursorRoot, "User", "globalStorage");
  mkdirSync(globalStorage, { recursive: true });
  const db = new Database(join(globalStorage, "state.vscdb"));
  db.exec("CREATE TABLE ItemTable(key TEXT PRIMARY KEY, value BLOB)");
  const put = db.prepare("INSERT INTO ItemTable(key, value) VALUES(?, ?)");
  put.run(
    "terminal.history.entries.commands",
    JSON.stringify({
      entries: [{ key: "npm test", value: { shellType: "pwsh" } }],
    }),
  );
  put.run(
    "terminal.history.entries.dirs",
    JSON.stringify({
      entries: [
        {
          key: "C:\\private\\cursor-project",
          value: { shellType: "pwsh" },
        },
      ],
    }),
  );
  put.run("terminal.history.timestamp.commands", "1700000010000");
  put.run("terminal.history.timestamp.dirs", "1700000020000");
  db.close();

  const historyDirectory = join(
    cursorRoot,
    "User",
    "History",
    "private-history-id",
  );
  mkdirSync(historyDirectory, { recursive: true });
  writeFileSync(
    join(historyDirectory, "entries.json"),
    JSON.stringify({
      version: 1,
      resource: "file:///c%3A/private/cursor-project/secret.ts",
      entries: [
        {
          id: "private-copy.ts",
          timestamp: 1_700_000_030_000,
          source: "private source label",
        },
      ],
    }),
    "utf8",
  );
  writeFileSync(
    join(historyDirectory, "private-copy.ts"),
    "private source content",
    "utf8",
  );
}

function makeAgentTranscript({ malformed = false } = {}) {
  const directory = join(
    cursorHome,
    "projects",
    "c-private-cursor-project",
    "agent-transcripts",
    "private-agent-id",
  );
  mkdirSync(directory, { recursive: true });
  const transcriptPath = join(directory, "private-conversation-id.jsonl");
  const lines = [
    JSON.stringify({
      role: "user",
      message: {
        content: [{ type: "text", text: "Please explain this test." }],
      },
    }),
    JSON.stringify({
      role: "assistant",
      message: {
        content: [
          { type: "text", text: "This test verifies local collection." },
          { type: "tool-call", name: "private-tool", arguments: "secret" },
        ],
      },
    }),
    JSON.stringify({ type: "turn_ended", status: "success" }),
  ];
  if (malformed) lines.push("{not-json");
  writeFileSync(transcriptPath, `${lines.join("\n")}\n`, "utf8");
  utimesSync(transcriptPath, 1_700_000_040, 1_700_000_040);
  return transcriptPath;
}

function makeAiTracking() {
  const trackingDirectory = join(cursorHome, "ai-tracking");
  mkdirSync(trackingDirectory, { recursive: true });
  const db = new Database(join(trackingDirectory, "ai-code-tracking.db"));
  db.exec(`
    CREATE TABLE conversation_summaries (
      conversationId TEXT,
      title TEXT,
      tldr TEXT,
      overview TEXT,
      summaryBullets TEXT,
      model TEXT,
      mode TEXT,
      updatedAt INTEGER
    );
    CREATE TABLE ai_code_hashes (
      hash TEXT,
      source TEXT,
      fileExtension TEXT,
      fileName TEXT,
      requestId TEXT,
      conversationId TEXT,
      timestamp INTEGER,
      model TEXT,
      createdAt INTEGER
    );
    CREATE TABLE tracked_file_content (
      gitPath TEXT,
      content TEXT,
      conversationId TEXT,
      model TEXT,
      fileExtension TEXT,
      createdAt INTEGER
    );
  `);
  db.prepare(
    `INSERT INTO conversation_summaries
      (conversationId,title,tldr,overview,summaryBullets,model,mode,updatedAt)
      VALUES (?,?,?,?,?,?,?,?)`,
  ).run(
    "private-conversation-id",
    "Fixture conversation",
    "A concise summary",
    "A private but intentionally collected overview",
    JSON.stringify(["first point", "second point"]),
    "fixture-model",
    "agent",
    1_700_000_050_000,
  );
  db.prepare(
    `INSERT INTO ai_code_hashes
      (hash,source,fileExtension,fileName,requestId,conversationId,timestamp,model,createdAt)
      VALUES (?,?,?,?,?,?,?,?,?)`,
  ).run(
    "private-raw-code-hash",
    "composer",
    ".ts",
    "private-file-name.ts",
    "private-request-id",
    "private-conversation-id",
    1_700_000_060,
    "fixture-model",
    null,
  );
  db.prepare(
    `INSERT INTO tracked_file_content
      (gitPath,content,conversationId,model,fileExtension,createdAt)
      VALUES (?,?,?,?,?,?)`,
  ).run(
    "private/git/path.ts",
    "private tracked source content",
    "private-conversation-id",
    "fixture-model",
    ".ts",
    1_700_000_070_000,
  );
  db.close();
}

async function collect(adapter, options = {}) {
  const records = [];
  for await (const record of adapter.sync(options)) records.push(record);
  return records;
}

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "cursor-adapter-test-"));
  cursorRoot = join(tempRoot, "Cursor");
  cursorHome = join(tempRoot, ".cursor");
});

afterEach(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

describe("Cursor local readers", () => {
  it("expands project discovery with the scan limit instead of a fixed default", () => {
    const projectsRoot = join(cursorHome, "projects");
    const projectCount = 10_001;
    const projectEntries = Array.from({ length: projectCount }, (_, index) => ({
      name: `project-${String(index).padStart(5, "0")}`,
      isDirectory: () => true,
      isSymbolicLink: () => false,
    }));
    const fsMod = {
      existsSync: (candidate) => candidate === projectsRoot,
      readdirSync: (candidate) => {
        expect(candidate).toBe(projectsRoot);
        return projectEntries;
      },
    };

    const result = readAgentTranscripts(cursorHome, {
      fs: fsMod,
      limit: projectCount,
    });

    expect(result).toEqual({ messages: [], complete: true });
  });

  it("parses only bounded user/assistant text without leaking path-shaped identifiers", () => {
    makeAgentTranscript();
    const result = readAgentTranscripts(cursorHome);

    expect(result.complete).toBe(true);
    expect(result.messages).toHaveLength(2);
    expect(result.messages.map((record) => record.payload.role)).toEqual([
      "user",
      "assistant",
    ]);
    expect(result.messages[1].payload.text).toBe(
      "This test verifies local collection.",
    );
    expect(result.messages[1].payload.contentPartCount).toBe(1);
    expect(result.messages[0].payload.projectHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(result.messages[0].payload.transcriptHash).toMatch(
      /^[0-9a-f]{64}$/u,
    );
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("c-private-cursor-project");
    expect(serialized).not.toContain("private-agent-id");
    expect(serialized).not.toContain("private-conversation-id");
    expect(serialized).not.toContain("private-tool");
  });

  it("preserves the watermark when a transcript is malformed or text is truncated", () => {
    makeAgentTranscript({ malformed: true });
    const result = readAgentTranscripts(cursorHome, {
      maxMessageChars: 8,
    });

    expect(result.complete).toBe(false);
    expect(result.messages).toHaveLength(2);
    expect(
      result.messages.every((record) => record.payload.text.length <= 8),
    ).toBe(true);
  });

  it("schema-probes AI tracking and never queries source content or raw identifiers", () => {
    makeAiTracking();
    const result = readAiTracking(cursorHome);

    expect(result.complete).toBe(true);
    expect(result.summaries).toHaveLength(1);
    expect(result.aiCodeEvents).toHaveLength(1);
    expect(result.summaries[0].payload).toMatchObject({
      title: "Fixture conversation",
      model: "fixture-model",
      mode: "agent",
      updatedAt: 1_700_000_050_000,
    });
    expect(result.summaries[0].payload.conversationHash).toMatch(
      /^[0-9a-f]{64}$/u,
    );
    expect(result.aiCodeEvents[0].payload).toMatchObject({
      source: "composer",
      fileExtension: ".ts",
      model: "fixture-model",
      occurredAt: 1_700_000_060_000,
    });
    expect(result.aiCodeEvents[0].payload.recordHash).toMatch(
      /^[0-9a-f]{64}$/u,
    );

    const serialized = JSON.stringify(result);
    for (const forbidden of [
      "private-conversation-id",
      "private-raw-code-hash",
      "private-file-name.ts",
      "private-request-id",
      "private/git/path.ts",
      "private tracked source content",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});

describe("CursorAdapter", () => {
  it("has a high-sensitivity contract with explicit exclusions", () => {
    const adapter = new CursorAdapter({
      defaultRoot: () => null,
      defaultCursorHome: () => null,
    });

    expect(assertAdapter(adapter)).toEqual({ ok: true });
    expect(adapter.name).toBe(CURSOR_NAME);
    expect(adapter.name).toBe("cursor");
    expect(adapter.version).toBe(CURSOR_VERSION);
    expect(adapter.version).toBe("0.1.0");
    expect(adapter.capabilities).toEqual(
      expect.arrayContaining([
        "sync:cursor-globalstorage-sqlite",
        "sync:cursor-agent-transcripts",
        "sync:cursor-ai-tracking-sqlite",
        "sync:profile-directory",
      ]),
    );
    expect(adapter.dataDisclosure.sensitivity).toBe("high");
    expect(adapter.dataDisclosure.excludedFields).toEqual(
      expect.arrayContaining([
        "cursorAuth/accessToken",
        "cursorAuth/refreshToken",
        "tracked_file_content.content",
        "absolute project/configuration paths",
      ]),
    );
    expect(defaultCursorRoot()).toMatch(/Cursor$/u);
    expect(defaultCursorHome()).toMatch(/\.cursor$/u);
  });

  it("authenticates from Agent data alone without returning local paths", async () => {
    makeAgentTranscript();
    const adapter = new CursorAdapter({
      cursorRoot,
      cursorHome,
    });
    const result = await adapter.authenticate();

    expect(result).toMatchObject({
      ok: true,
      hasWorkspaces: false,
      hasTerminalHistory: false,
      hasLocalHistory: false,
      hasAgentTranscripts: true,
      hasAiTracking: false,
    });
    expect(JSON.stringify(result)).not.toContain(tempRoot);
  });

  it("combines editor, Agent transcript, summary, and AI code streams with safe ids", async () => {
    makeEditorState();
    makeAgentTranscript();
    makeAiTracking();
    const adapter = new CursorAdapter({ cursorRoot, cursorHome });
    let watermarkCompleted = false;
    const records = await collect(adapter, {
      markWatermarkComplete: () => {
        watermarkCompleted = true;
      },
    });

    expect(records).toHaveLength(8);
    expect(
      Object.fromEntries(
        [...new Set(records.map((record) => record.kind))].map((kind) => [
          kind,
          records.filter((record) => record.kind === kind).length,
        ]),
      ),
    ).toEqual({
      workspace: 1,
      "terminal-command": 1,
      "terminal-dir": 1,
      "local-history-save": 1,
      "cursor-agent-message": 2,
      "cursor-conversation-summary": 1,
      "cursor-ai-code-activity": 1,
    });
    expect(watermarkCompleted).toBe(true);
    expect(
      records.every((record) => record.originalId.startsWith("cursor-")),
    ).toBe(true);

    const metadataOnly = records.map((record) => ({
      kind: record.kind,
      originalId: record.originalId,
      payload:
        record.kind === "cursor-agent-message"
          ? { ...record.payload, text: "<redacted-for-test>" }
          : record.payload,
    }));
    const serialized = JSON.stringify(metadataOnly);
    expect(serialized).not.toContain(tempRoot);
    expect(serialized).not.toContain("c%3A/private");
    expect(serialized).not.toContain("private-agent-id");
    expect(serialized).not.toContain("private-conversation-id");
    expect(serialized).not.toContain("private tracked source content");
  });

  it("normalizes every stream into schema-valid, source-isolated entities", async () => {
    makeEditorState();
    makeAgentTranscript();
    makeAiTracking();
    const adapter = new CursorAdapter({ cursorRoot, cursorHome });
    const records = await collect(adapter);
    const batches = records.map((record) => adapter.normalize(record));
    const entities = batches.flatMap((batch) => [
      ...batch.events,
      ...batch.persons,
      ...batch.places,
      ...batch.items,
      ...batch.topics,
    ]);

    expect(entities.length).toBeGreaterThan(records.length);
    expect(entities.every((entity) => validate(entity).valid)).toBe(true);
    expect(entities.every((entity) => entity.source.adapter === "cursor")).toBe(
      true,
    );
    expect(
      batches
        .flatMap((batch) => batch.events)
        .filter((event) => event.extra.kind === "cursor-agent-message"),
    ).toHaveLength(2);
  });

  it("supports independent stream opt-outs, since filtering, and complete-scan limits", async () => {
    makeEditorState();
    makeAgentTranscript();
    makeAiTracking();
    const adapter = new CursorAdapter({ cursorRoot, cursorHome });

    const agentOnly = await collect(adapter, {
      since: 1_700_000_035_000,
      include: { editor: false, aiTracking: false },
    });
    expect(agentOnly.map((record) => record.kind)).toEqual([
      "cursor-agent-message",
      "cursor-agent-message",
    ]);

    const trackingOnly = await collect(adapter, {
      since: 1_700_000_045_000,
      include: { editor: false, agentTranscripts: false },
    });
    expect(trackingOnly.map((record) => record.kind)).toEqual([
      "cursor-conversation-summary",
      "cursor-ai-code-activity",
    ]);

    let limitedCompleted = false;
    const limited = await collect(adapter, {
      limit: 1,
      markWatermarkComplete: () => {
        limitedCompleted = true;
      },
    });
    expect(limited).toHaveLength(1);
    expect(limitedCompleted).toBe(false);
  });

  it("keeps Cursor and VS Code scopes and ids disjoint for the same editor root", async () => {
    makeEditorState();
    const cursor = new CursorAdapter({ cursorRoot, cursorHome });
    const vscode = new VSCodeAdapter({ vscodeRoot: cursorRoot });
    const [cursorRecords, vscodeRecords] = await Promise.all([
      collect(cursor, {
        include: { agentTranscripts: false, aiTracking: false },
      }),
      collect(vscode),
    ]);

    expect(cursor.resolveDefaultScope()).not.toBe(vscode.resolveDefaultScope());
    expect(
      new Set(cursorRecords.map((record) => record.originalId)),
    ).not.toEqual(new Set(vscodeRecords.map((record) => record.originalId)));
  });
});
