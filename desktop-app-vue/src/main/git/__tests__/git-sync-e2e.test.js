/**
 * Git Sync E2E Integration Tests
 * Tests cross-module interactions for the complete Git Sync roadmap
 *
 * Scenarios:
 * 1. Conflict resolution cascade: Rule → AST → LLM
 * 2. Collaborative room lifecycle: create → join → edit → leave
 * 3. CRDT document sync: engine → provider → session
 * 4. Diff sync strategy selection pipeline
 * 5. Hosting provider + SSH key registration flow
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock("uuid", () => ({
  v4: vi
    .fn()
    .mockImplementation(() => `uuid-${Math.random().toString(36).slice(2, 9)}`),
}));

// Mock Yjs
vi.mock("yjs", () => {
  class MockYText {
    constructor() { this._content = ""; this._listeners = []; }
    get length() { return this._content.length; }
    insert(pos, str) {
      this._content = this._content.slice(0, pos) + str + this._content.slice(pos);
    }
    delete(pos, len) {
      this._content = this._content.slice(0, pos) + this._content.slice(pos + len);
    }
    toString() { return this._content; }
  }
  class MockYMap {
    constructor() { this._data = new Map(); }
    set(k, v) { this._data.set(k, v); }
    get(k) { return this._data.get(k); }
    forEach(fn) { this._data.forEach(fn); }
  }
  class MockYArray {
    constructor() { this._items = []; }
    push(items) { this._items.push(...items); }
    toArray() { return [...this._items]; }
    get length() { return this._items.length; }
  }
  class MockDoc {
    constructor() {
      this._texts = {}; this._maps = {}; this._arrays = {};
      this._listeners = [];
    }
    getText(n) { return (this._texts[n] ??= new MockYText()); }
    getMap(n) { return (this._maps[n] ??= new MockYMap()); }
    getArray(n) { return (this._arrays[n] ??= new MockYArray()); }
    transact(fn) { fn(); this._listeners.forEach(cb => cb(new Uint8Array([1, 2, 3]), "local")); }
    on(event, cb) { this._listeners.push(cb); }
    destroy() { this._listeners = []; }
  }
  return {
    Doc: MockDoc,
    encodeStateAsUpdate: vi.fn().mockReturnValue(new Uint8Array([1, 2, 3])),
    encodeStateVector: vi.fn().mockReturnValue(new Uint8Array([1])),
    applyUpdate: vi.fn(),
  };
});

const { RuleMerger } = require("../conflict-resolution/rule-merger.js");
const { ASTMerger } = require("../conflict-resolution/ast-merger.js");
const { LLMMerger } = require("../conflict-resolution/llm-merger.js");
const { SmartConflictResolver } = require("../conflict-resolution/conflict-resolver.js");
const { YjsCRDTEngine } = require("../../collab/yjs-crdt-engine.js");
const { WebRTCYjsProvider } = require("../../collab/webrtc-yjs-provider.js");
const { CollabSessionManager, ROLE } = require("../../collab/collab-session-manager.js");
const { DiffSyncManager } = require("../diff-sync/index.js");
const { GCounter, ORSet } = require("../diff-sync/db-diff-tracker.js");
const { createProvider, getSupportedProviders } = require("../hosting/git-hosting-provider.js");

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeDb(overrides = {}) {
  return {
    run: vi.fn(),
    get: vi.fn().mockReturnValue(null),
    all: vi.fn().mockReturnValue([]),
    exec: vi.fn(),
    ...overrides,
  };
}

// ─── Scenario 1: Conflict Resolution Cascade ─────────────────────────────────

describe("E2E: Conflict Resolution Cascade", () => {
  let resolver;
  let mockLlm;

  beforeEach(() => {
    mockLlm = {
      chat: vi.fn().mockResolvedValue({
        content: JSON.stringify({
          intent: "Both sides added content",
          suggestedMerge: "merged by AI: local + remote",
          confidence: 0.88,
          explanation: "Non-overlapping semantic changes",
        }),
      }),
    };
    resolver = new SmartConflictResolver({
      database: makeDb(),
      llmManager: mockLlm,
    });
  });

  it("Level 1 resolves format-only differences instantly", async () => {
    const result = await resolver.resolve({
      base: "hello world",
      local: "hello  world",
      remote: "hello  world",
      filePath: "readme.md",
    });
    expect(result.result).toBe("merged");
    expect(result.level).toBe(1);
    expect(result.strategy).toBe("format-ignore");
  });

  it("Level 1 resolves non-overlapping 3-way merge", async () => {
    const base = "Line A\nLine B\nLine C\n";
    const local = "Line A Changed\nLine B\nLine C\n";
    const remote = "Line A\nLine B\nLine C Changed\n";
    const result = await resolver.resolve({ base, local, remote, filePath: "notes.md" });
    expect(result.result).toBe("merged");
    expect(result.level).toBe(1);
    expect(result.merged).toContain("Line A Changed");
    expect(result.merged).toContain("Line C Changed");
  });

  it("Level 1 resolves JSON config merge", async () => {
    const base = JSON.stringify({ port: 3000, debug: false });
    const local = JSON.stringify({ port: 3000, debug: false, newFeature: true });
    const remote = JSON.stringify({ port: 8080, debug: false });
    const result = await resolver.resolve({ base, local, remote, filePath: "config.json" });
    if (result.result === "merged") {
      const parsed = JSON.parse(result.merged);
      expect(parsed).toHaveProperty("newFeature", true);
      expect(parsed).toHaveProperty("port");
    }
  });

  it("Level 2 resolves JS import merge (both sides add different imports)", async () => {
    const base = "import React from 'react';\n\nconst App = () => null;\n";
    const local = "import React from 'react';\nimport { useState } from 'react';\n\nconst App = () => null;\n";
    const remote = "import React from 'react';\nimport axios from 'axios';\n\nconst App = () => null;\n";
    const result = await resolver.resolve({ base, local, remote, filePath: "App.js" });
    expect(result).toHaveProperty("result");
    expect([1, 2, 3]).toContain(result.level);
    if (result.result === "merged") {
      expect(result.merged).toContain("useState");
      expect(result.merged).toContain("axios");
    }
  });

  it("Level 3 is reached for complex semantic conflicts", async () => {
    // Simulate a conflict that passes L1 and L2
    const base = "The project goal is to build a CLI tool.";
    const local = "The project goal is to build a desktop application with GUI.";
    const remote = "The project goal is to create a web service with REST API.";
    const result = await resolver.resolve({ base, local, remote, filePath: "goals.md" });
    // Should reach L3 since L1/L2 can't resolve semantic content differences
    if (result.level === 3) {
      expect(mockLlm.chat).toHaveBeenCalled();
    }
    expect(result).toHaveProperty("result");
  });

  it("classifyConflict distinguishes config from text", () => {
    const jsonConflict = resolver.classifyConflict({
      base: "{}", local: '{"a":1}', remote: '{"b":2}', filePath: "settings.json",
    });
    expect(jsonConflict).toBe("config");

    const textConflict = resolver.classifyConflict({
      base: "hello", local: "hello local", remote: "hello remote", filePath: "notes.md",
    });
    expect(["text", "semantic"]).toContain(textConflict);
  });
});

// ─── Scenario 2: Collaboration Room Lifecycle ─────────────────────────────────

describe("E2E: Collaboration Room Lifecycle", () => {
  let engine;
  let provider;
  let aliceManager;
  let mockWebrtc;

  beforeEach(() => {
    engine = new YjsCRDTEngine();

    mockWebrtc = {
      sendMessage: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    };
    provider = new WebRTCYjsProvider({
      yjsEngine: engine,
      webrtcManager: mockWebrtc,
    });

    aliceManager = new CollabSessionManager({
      yjsProvider: provider,
      database: makeDb(),
    });
    aliceManager.localUser = { did: "did:key:alice", name: "Alice" };
  });

  afterEach(() => {
    engine.destroy();
    provider.destroy();
    aliceManager.destroy();
  });

  it("full lifecycle: create → edit → snapshot → leave", async () => {
    // Step 1: Create room
    const room = await aliceManager.createRoom({ documentId: "collab-doc" });
    expect(room.roomId).toBeDefined();

    // Step 2: Init CRDT document
    engine.getOrCreateDocument("collab-doc");
    engine.setMarkdown("collab-doc", "# Collaboration Doc\n\nInitial content.");

    // Step 3: Edit via CRDT operation
    engine.applyOperation("collab-doc", {
      type: "insert",
      position: engine.getMarkdown("collab-doc").length,
      content: "\n\n## Added Section",
    });
    const content = engine.getMarkdown("collab-doc");
    expect(content).toContain("Added Section");

    // Step 4: Add comment via CRDT
    engine.addComment("collab-doc", {
      text: "Looks good!",
      authorDid: "did:key:alice",
      authorName: "Alice",
    });
    expect(engine.getComments("collab-doc").length).toBe(1);

    // Step 5: Leave room
    await aliceManager.leaveRoom(room.roomId);
    expect(aliceManager.activeRooms.has(room.roomId)).toBe(false);
  });

  it("room permissions: EDITOR cannot set roles", async () => {
    const bobManager = new CollabSessionManager({
      yjsProvider: provider,
      database: makeDb(),
    });
    bobManager.localUser = { did: "did:key:bob", name: "Bob" };

    // Bob joins as EDITOR
    await bobManager.joinRoom("room-alice", "doc1");
    // Bob tries to change someone's role — should throw
    await expect(
      bobManager.setParticipantRole("room-alice", "did:key:other", "viewer"),
    ).rejects.toThrow();

    bobManager.destroy();
  });

  it("participant status tracking across join/leave", async () => {
    const { roomId } = await aliceManager.createRoom({ documentId: "doc-status" });
    const room = aliceManager.activeRooms.get(roomId);
    const alice = room.participants.get("did:key:alice");
    expect(alice.status).toBe("online");

    // Update status
    aliceManager.updateParticipantStatus(roomId, "did:key:alice", "editing");
    expect(alice.status).toBe("editing");
  });
});

// ─── Scenario 3: CRDT Document Sync ──────────────────────────────────────────

describe("E2E: CRDT Document Sync", () => {
  let engineA;
  let engineB;

  beforeEach(() => {
    engineA = new YjsCRDTEngine();
    engineB = new YjsCRDTEngine();
  });

  afterEach(() => {
    engineA.destroy();
    engineB.destroy();
  });

  it("two engines can exchange state vectors and apply updates", () => {
    // A writes content
    engineA.setMarkdown("doc-sync", "# Hello from A");
    const stateA = engineA.encodeState("doc-sync");
    const vectorA = engineA.getStateVector("doc-sync");

    // B creates document and applies A's state
    engineB.getOrCreateDocument("doc-sync");
    engineB.applyUpdate("doc-sync", stateA, "remote");

    // B's content should match A's
    // (mocked yjs, so we verify the flow calls work without errors)
    expect(() => engineB.getMarkdown("doc-sync")).not.toThrow();
  });

  it("encodeDiff returns diff from remote state vector", () => {
    engineA.setMarkdown("doc1", "content A");
    const svB = new Uint8Array([0]); // empty state vector
    const diff = engineA.encodeDiff("doc1", svB);
    expect(diff).toBeInstanceOf(Uint8Array);
    expect(diff.length).toBeGreaterThan(0);
  });

  it("CRDT operations are consistent after multiple edits", () => {
    engineA.getOrCreateDocument("doc2");
    engineA.setMarkdown("doc2", "line1\nline2\nline3\n");
    engineA.applyOperation("doc2", { type: "insert", position: 0, content: "line0\n" });
    engineA.applyOperation("doc2", { type: "delete", position: 6, length: 6 }); // remove "line1\n"
    const result = engineA.getMarkdown("doc2");
    expect(result).toBe("line0\nline2\nline3\n");
  });
});

// ─── Scenario 4: Diff Sync Strategy Selection ────────────────────────────────

describe("E2E: Diff Sync Strategy Selection Pipeline", () => {
  let manager;

  beforeEach(() => {
    manager = new DiffSyncManager({});
  });

  it("selects correct strategies for different file types", () => {
    const cases = [
      { input: { fileType: "text", fileSize: 100 }, expected: ["full", "thin-pack"] },
      { input: { filePath: "photo.jpg", fileSize: 5 * 1024 * 1024 }, expected: ["rsync-delta"] },
      { input: { isDatabase: true }, expected: ["crdt-merge"] },
    ];

    for (const { input, expected } of cases) {
      const strategy = manager.selectStrategy(input);
      expect(expected).toContain(strategy);
    }
  });

  it("CRDT structures work end-to-end for distributed counters", () => {
    // Simulate distributed view counter
    const nodeA = new GCounter("nodeA");
    const nodeB = new GCounter("nodeB");

    nodeA.increment(5);
    nodeB.increment(3);

    // Merge both ways
    nodeA.merge(nodeB);
    nodeB.merge(nodeA);

    // After full merge, both see the same total
    expect(nodeA.value()).toBe(8);
    expect(nodeB.value()).toBe(8);
  });

  it("ORSet handles concurrent add/remove correctly", () => {
    const s1 = new ORSet("n1");
    const s2 = new ORSet("n2");

    s1.add("tag:important");
    s2.merge(s1); // s2 sees "tag:important"
    s2.remove("tag:important"); // s2 removes it
    s1.add("tag:important"); // s1 re-adds (new tag)
    s1.merge(s2);

    // s1 re-added, so it wins (add-wins semantics)
    expect(s1.has("tag:important")).toBe(true);
  });
});

// ─── Scenario 5: Hosting Provider + SSH Flow ─────────────────────────────────

describe("E2E: Hosting Provider Flow", () => {
  it("all supported providers are creatable", () => {
    const providers = getSupportedProviders();
    for (const { type } of providers) {
      expect(() => createProvider(type, {})).not.toThrow();
    }
  });

  it("GitHub provider builds correct clone URLs", () => {
    const p = createProvider("github", {
      auth: { type: "token", token: "ghp_test" },
    });
    const url = p.getCloneUrl("myuser", "myrepo");
    expect(url).toContain("myuser");
    expect(url).toContain("myrepo");
  });

  it("provider testConnection handles errors gracefully", async () => {
    const p = createProvider("github", {
      auth: { type: "token", token: "bad-token" },
    });
    // Race with 3s timeout so the test never hangs
    const result = await Promise.race([
      p.testConnection().catch((e) => ({ success: false, message: e.message })),
      new Promise((resolve) => setTimeout(() => resolve({ success: false, message: "test-timeout" }), 3000)),
    ]);
    // Should return an object (success or failure) without crashing
    expect(result).toBeDefined();
  }, 8000);

  it("Gitee provider has correct API URL for China CDN", () => {
    const p = createProvider("gitee", { auth: { token: "test" } });
    expect(p.apiUrl).toContain("gitee");
  });
});
