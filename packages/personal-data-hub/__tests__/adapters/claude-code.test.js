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

const {
  ClaudeCodeAdapter,
  CLAUDE_CODE_NAME,
  CLAUDE_CODE_VERSION,
  defaultClaudeCodeHome,
  discoverTranscriptFiles,
  readClaudeCodeTranscripts,
  readClaudeCodeStats,
} = require("../../lib/adapters/claude-code");
const { assertAdapter } = require("../../lib/adapter-spec");
const { validate } = require("../../lib/schemas");

let tempRoot;
let claudeHome;

function makeTranscriptTree(home = claudeHome, { malformed = false } = {}) {
  const projectDirectory = join(
    home,
    "projects",
    "C--Users--private-user--secret-project",
  );
  mkdirSync(projectDirectory, { recursive: true });
  const mainPath = join(projectDirectory, "private-session-id.jsonl");
  const mainRows = [
    {
      type: "ai-title",
      aiTitle: "Fixture coding session",
      sessionId: "private-session-id",
    },
    {
      type: "user",
      uuid: "private-user-message-id",
      cwd: "C:\\private\\secret-project",
      gitBranch: "private-branch",
      timestamp: "2023-11-14T22:13:20.000Z",
      message: {
        role: "user",
        content: "Please explain the fixture.",
      },
    },
    {
      type: "assistant",
      uuid: "private-assistant-message-id",
      requestId: "private-request-id",
      timestamp: "2023-11-14T22:13:30.000Z",
      message: {
        role: "assistant",
        model: "claude-fixture-model",
        stop_reason: "end_turn",
        usage: {
          input_tokens: 10,
          output_tokens: 20,
          cache_creation_input_tokens: 3,
          cache_read_input_tokens: 4,
          inference_geo: "private-region",
        },
        content: [
          {
            type: "thinking",
            thinking: "private chain of thought",
          },
          {
            type: "text",
            text: "The fixture verifies safe local collection.",
          },
          {
            type: "tool_use",
            id: "private-tool-call-id",
            name: "Bash",
            input: { command: "private destructive command" },
          },
        ],
      },
    },
    {
      type: "user",
      uuid: "private-tool-result-message-id",
      timestamp: "2023-11-14T22:13:40.000Z",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "private-tool-call-id",
            content: "private command output",
          },
        ],
      },
    },
    {
      type: "user",
      uuid: "private-meta-message-id",
      isMeta: true,
      timestamp: "2023-11-14T22:13:50.000Z",
      message: {
        role: "user",
        content: "private internal metadata",
      },
    },
  ];
  const lines = mainRows.map((row) => JSON.stringify(row));
  if (malformed) lines.push("{not-json");
  writeFileSync(mainPath, `${lines.join("\n")}\n`, "utf8");
  utimesSync(mainPath, 1_700_000_050, 1_700_000_050);

  const subagentDirectory = join(
    projectDirectory,
    "private-session-id",
    "subagents",
  );
  mkdirSync(subagentDirectory, { recursive: true });
  const subagentPath = join(subagentDirectory, "agent-private-agent-id.jsonl");
  writeFileSync(
    subagentPath,
    [
      JSON.stringify({
        type: "user",
        uuid: "private-subagent-user-id",
        timestamp: "2023-11-14T22:14:00.000Z",
        message: {
          role: "user",
          content: [{ type: "text", text: "Inspect the fixture." }],
        },
      }),
      JSON.stringify({
        type: "assistant",
        uuid: "private-subagent-assistant-id",
        timestamp: "2023-11-14T22:14:10.000Z",
        message: {
          role: "assistant",
          model: "claude-fixture-model",
          content: [{ type: "text", text: "Inspection completed safely." }],
        },
      }),
    ].join("\n") + "\n",
    "utf8",
  );
  utimesSync(subagentPath, 1_700_000_060, 1_700_000_060);

  writeFileSync(
    join(home, ".credentials.json"),
    JSON.stringify({ oauthToken: "private-oauth-token" }),
    "utf8",
  );
  writeFileSync(
    join(home, "history.jsonl"),
    JSON.stringify({
      display: "private duplicate prompt",
      project: "C:\\private\\secret-project",
      sessionId: "private-session-id",
    }) + "\n",
    "utf8",
  );
  return { mainPath, subagentPath };
}

function makeStats(home = claudeHome) {
  writeFileSync(
    join(home, "stats-cache.json"),
    JSON.stringify({
      version: 2,
      dailyActivity: [
        {
          date: "2023-11-14",
          messageCount: 5,
          sessionCount: 2,
          toolCallCount: 3,
        },
      ],
      dailyModelTokens: [
        {
          date: "2023-11-14",
          tokensByModel: {
            "claude-fixture-model": 120,
            "claude-secondary-model": 30,
          },
        },
      ],
      longestSession: {
        sessionId: "private-longest-session-id",
        messageCount: 999,
      },
      modelUsage: {
        "claude-fixture-model": {
          inputTokens: 999,
          outputTokens: 999,
        },
      },
    }),
    "utf8",
  );
}

async function collect(adapter, options = {}) {
  const records = [];
  for await (const record of adapter.sync(options)) records.push(record);
  return records;
}

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "claude-code-adapter-test-"));
  claudeHome = join(tempRoot, ".claude");
  mkdirSync(claudeHome, { recursive: true });
});

afterEach(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

describe("Claude Code local readers", () => {
  it("collects main and subagent text while excluding tools, thoughts, paths, and raw ids", () => {
    makeTranscriptTree();
    const discovery = discoverTranscriptFiles(claudeHome);
    const result = readClaudeCodeTranscripts(claudeHome);

    expect(discovery.complete).toBe(true);
    expect(discovery.files).toHaveLength(2);
    expect(result.complete).toBe(true);
    expect(result.messages).toHaveLength(4);
    expect(result.messages.map((record) => record.payload.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
    expect(result.messages[1].payload).toMatchObject({
      text: "The fixture verifies safe local collection.",
      model: "claude-fixture-model",
      stopReason: "end_turn",
      textPartCount: 1,
      sessionTitle: "Fixture coding session",
      isSubagent: false,
      usage: {
        inputTokens: 10,
        outputTokens: 20,
        cacheCreationInputTokens: 3,
        cacheReadInputTokens: 4,
      },
    });
    expect(result.messages[2].payload.isSubagent).toBe(true);
    expect(result.messages[2].payload.parentSessionHash).toMatch(
      /^[0-9a-f]{64}$/u,
    );
    expect(result.messages[2].payload.agentHash).toMatch(/^[0-9a-f]{64}$/u);

    const serialized = JSON.stringify(result);
    for (const forbidden of [
      "private-user",
      "secret-project",
      "private-session-id",
      "private-agent-id",
      "private-request-id",
      "private-tool-call-id",
      "private destructive command",
      "private command output",
      "private chain of thought",
      "private internal metadata",
      "private-oauth-token",
      "private duplicate prompt",
      "private-region",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("supports subagent opt-out, timestamp filtering, and bounded output", () => {
    makeTranscriptTree();
    const noSubagents = readClaudeCodeTranscripts(claudeHome, {
      includeSubagents: false,
      since: Date.parse("2023-11-14T22:13:25.000Z"),
    });
    expect(noSubagents.complete).toBe(true);
    expect(noSubagents.messages).toHaveLength(1);
    expect(noSubagents.messages[0].payload.role).toBe("assistant");

    const limited = readClaudeCodeTranscripts(claudeHome, { limit: 2 });
    expect(limited.messages).toHaveLength(2);
    expect(limited.complete).toBe(false);
  });

  it("defers the watermark for malformed or truncated input", () => {
    makeTranscriptTree(claudeHome, { malformed: true });
    const result = readClaudeCodeTranscripts(claudeHome, {
      maxMessageChars: 12,
    });

    expect(result.complete).toBe(false);
    expect(result.messages).toHaveLength(4);
    expect(
      result.messages.every((record) => record.payload.text.length <= 12),
    ).toBe(true);
  });

  it("reads only dated aggregate statistics and excludes global session ids", () => {
    makeStats();
    const result = readClaudeCodeStats(claudeHome);

    expect(result.complete).toBe(true);
    expect(result.activity).toHaveLength(1);
    expect(result.modelUsage).toHaveLength(2);
    expect(result.activity[0].payload).toMatchObject({
      date: "2023-11-14",
      messageCount: 5,
      sessionCount: 2,
      toolCallCount: 3,
    });
    expect(result.modelUsage[0].payload.tokenCount).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toContain("private-longest-session-id");

    const incremental = readClaudeCodeStats(claudeHome, {
      since: Date.now() - 60_000,
    });
    expect(incremental.activity).toHaveLength(1);
    expect(incremental.modelUsage).toHaveLength(2);
    expect(incremental.activity[0].payload.occurredAt).toBe(
      Date.parse("2023-11-14T00:00:00.000Z"),
    );
    expect(incremental.activity[0].capturedAt).toBeGreaterThan(
      incremental.activity[0].payload.occurredAt,
    );
  });
});

describe("ClaudeCodeAdapter", () => {
  it("declares a high-sensitivity local-only contract with explicit exclusions", () => {
    const adapter = new ClaudeCodeAdapter({
      defaultClaudeCodeHome: () => null,
    });

    expect(assertAdapter(adapter)).toEqual({ ok: true });
    expect(adapter.name).toBe(CLAUDE_CODE_NAME);
    expect(adapter.name).toBe("claude-code");
    expect(adapter.version).toBe(CLAUDE_CODE_VERSION);
    expect(adapter.version).toBe("0.1.0");
    expect(adapter.watermarkStrategy).toBe("max-captured-at");
    expect(adapter.watermarkRequiresCompleteScan).toBe(true);
    expect(adapter.capabilities).toEqual(
      expect.arrayContaining([
        "sync:claude-code-session-jsonl",
        "sync:claude-code-subagent-jsonl",
        "sync:claude-code-stats-json",
        "sync:profile-directory",
      ]),
    );
    expect(adapter.dataDisclosure.sensitivity).toBe("high");
    expect(adapter.dataDisclosure.excludedFields).toEqual(
      expect.arrayContaining([
        "~/.claude/.credentials.json",
        "raw project paths and directory keys",
        "tool_use blocks and tool inputs",
        "thinking blocks",
      ]),
    );
    expect(defaultClaudeCodeHome()).toEqual(expect.any(String));
  });

  it("authenticates without returning the selected local path", async () => {
    makeTranscriptTree();
    const adapter = new ClaudeCodeAdapter({ profilePath: claudeHome });
    const result = await adapter.authenticate();

    expect(result).toMatchObject({
      ok: true,
      mode: "file-import",
      hasTranscripts: true,
      hasStats: false,
    });
    expect(JSON.stringify(result)).not.toContain(tempRoot);
  });

  it("combines transcript and aggregate streams with safe ids and a complete watermark", async () => {
    makeTranscriptTree();
    makeStats();
    const adapter = new ClaudeCodeAdapter({ claudeHome });
    let watermarkCompleted = false;
    const records = await collect(adapter, {
      markWatermarkComplete: () => {
        watermarkCompleted = true;
      },
    });

    expect(records).toHaveLength(7);
    expect(
      Object.fromEntries(
        [...new Set(records.map((record) => record.kind))].map((kind) => [
          kind,
          records.filter((record) => record.kind === kind).length,
        ]),
      ),
    ).toEqual({
      "claude-code-daily-activity": 1,
      "claude-code-daily-model-usage": 2,
      "claude-code-message": 4,
    });
    expect(watermarkCompleted).toBe(true);
    expect(
      records.every((record) => record.originalId.startsWith("claude-code-")),
    ).toBe(true);
    const metadataOnly = records.map((record) => ({
      ...record,
      payload:
        record.kind === "claude-code-message"
          ? { ...record.payload, text: "<redacted-for-test>" }
          : record.payload,
    }));
    const serialized = JSON.stringify(metadataOnly);
    expect(serialized).not.toContain(tempRoot);
    expect(serialized).not.toContain("private-session-id");
    expect(serialized).not.toContain("private-agent-id");
    expect(serialized).not.toContain("private-request-id");
  });

  it("normalizes every stream into schema-valid isolated entities", async () => {
    makeTranscriptTree();
    makeStats();
    const adapter = new ClaudeCodeAdapter({ claudeHome });
    const records = await collect(adapter);
    const entities = records.flatMap((record) => {
      const batch = adapter.normalize(record);
      return [
        ...batch.events,
        ...batch.persons,
        ...batch.places,
        ...batch.items,
        ...batch.topics,
      ];
    });

    expect(entities.every((entity) => validate(entity).valid)).toBe(true);
    expect(
      entities.every((entity) => entity.source.adapter === "claude-code"),
    ).toBe(true);
    expect(
      entities.some(
        (entity) => entity.type === "event" && entity.subtype === "ai-message",
      ),
    ).toBe(true);
    expect(
      entities.some(
        (entity) => entity.type === "topic" && entity.extra.isSubagent === true,
      ),
    ).toBe(true);
  });

  it("honors stream opt-outs and defers a limited scan watermark", async () => {
    makeTranscriptTree();
    makeStats();
    const adapter = new ClaudeCodeAdapter({ claudeHome });
    let watermarkCompleted = false;
    const mainOnly = await collect(adapter, {
      include: {
        subagentTranscripts: false,
        stats: false,
      },
      markWatermarkComplete: () => {
        watermarkCompleted = true;
      },
    });
    expect(mainOnly).toHaveLength(2);
    expect(
      mainOnly.every((record) => record.payload.isSubagent === false),
    ).toBe(true);
    expect(watermarkCompleted).toBe(true);

    watermarkCompleted = false;
    const limited = await collect(adapter, {
      pageSize: 1,
      maxPages: 1,
      markWatermarkComplete: () => {
        watermarkCompleted = true;
      },
    });
    expect(limited).toHaveLength(1);
    expect(watermarkCompleted).toBe(false);
  });

  it("isolates scope and raw ids for two Claude Code homes", async () => {
    const secondHome = join(tempRoot, "second-claude-home");
    mkdirSync(secondHome, { recursive: true });
    makeTranscriptTree(claudeHome);
    makeTranscriptTree(secondHome);
    const first = new ClaudeCodeAdapter({ claudeHome });
    const second = new ClaudeCodeAdapter({ claudeHome: secondHome });
    const [firstRecords, secondRecords] = await Promise.all([
      collect(first, {
        include: { subagentTranscripts: false, stats: false },
      }),
      collect(second, {
        include: { subagentTranscripts: false, stats: false },
      }),
    ]);

    expect(first.defaultScope).not.toBe(second.defaultScope);
    expect(firstRecords[0].originalId).not.toBe(secondRecords[0].originalId);
  });
});
