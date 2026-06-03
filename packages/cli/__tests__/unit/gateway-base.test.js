/**
 * Unit tests for gateway-base + telegram-formatter + discord-formatter.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { GatewayBase } from "../../src/gateways/gateway-base.js";
import {
  escapeMarkdownV2,
  formatForTelegram,
} from "../../src/gateways/telegram/telegram-formatter.js";
import {
  formatForDiscord,
  splitForDiscord,
  codeBlock,
  quoteBlock,
} from "../../src/gateways/discord/discord-formatter.js";

// ─── GatewayBase ────────────────────────────────────────────────────

describe("GatewayBase", () => {
  let gw;

  beforeEach(() => {
    gw = new GatewayBase({ platform: "test" });
  });

  // Lifecycle

  describe("lifecycle", () => {
    it("starts and reports running", async () => {
      expect(gw.isRunning()).toBe(false);
      await gw.start();
      expect(gw.isRunning()).toBe(true);
    });

    it("stops and clears sessions", async () => {
      await gw.start();
      gw.getOrCreateSession("chat1");
      expect(gw.getSessionCount()).toBe(1);
      await gw.stop();
      expect(gw.isRunning()).toBe(false);
      expect(gw.getSessionCount()).toBe(0);
    });

    it("emits started/stopped events", async () => {
      const started = vi.fn();
      const stopped = vi.fn();
      gw.on("started", started);
      gw.on("stopped", stopped);
      await gw.start();
      expect(started).toHaveBeenCalledWith({ platform: "test" });
      await gw.stop();
      expect(stopped).toHaveBeenCalledWith({ platform: "test" });
    });
  });

  // Session management

  describe("sessions", () => {
    it("creates new session on first access", () => {
      const session = gw.getOrCreateSession("chat1");
      expect(session.isNew).toBe(true);
      expect(session.messages).toEqual([]);
    });

    it("returns existing session on subsequent access", () => {
      gw.getOrCreateSession("chat1");
      const session = gw.getOrCreateSession("chat1");
      expect(session.isNew).toBe(false);
    });

    it("adds messages to session", () => {
      gw.getOrCreateSession("chat1");
      gw.addMessage("chat1", "user", "hello");
      gw.addMessage("chat1", "assistant", "hi there");
      const session = gw.getOrCreateSession("chat1");
      // Messages are stored in the internal Map, not returned copies
      const internalSession = gw.sessions.get("chat1");
      expect(internalSession.messages).toHaveLength(2);
    });

    it("clears a specific session", () => {
      gw.getOrCreateSession("chat1");
      gw.getOrCreateSession("chat2");
      gw.clearSession("chat1");
      expect(gw.getSessionCount()).toBe(1);
    });

    it("addMessage is no-op for unknown chatId", () => {
      gw.addMessage("nonexistent", "user", "hello");
      expect(gw.getSessionCount()).toBe(0);
    });
  });

  // Rate limiting

  describe("rate limiting", () => {
    it("allows messages within limit", () => {
      gw = new GatewayBase({ platform: "test", rateLimitMax: 3 });
      gw.recordMessage("chat1");
      gw.recordMessage("chat1");
      expect(gw.isRateLimited("chat1")).toBe(false);
    });

    it("blocks messages at limit", () => {
      gw = new GatewayBase({
        platform: "test",
        rateLimitMax: 2,
        rateLimitWindow: 60000,
      });
      gw.recordMessage("chat1");
      gw.recordMessage("chat1");
      expect(gw.isRateLimited("chat1")).toBe(true);
    });

    it("returns false for unknown chatId", () => {
      expect(gw.isRateLimited("unknown")).toBe(false);
    });
  });

  // Response splitting

  describe("splitResponse", () => {
    it("returns single chunk for short text", () => {
      expect(gw.splitResponse("hello")).toEqual(["hello"]);
    });

    it("returns empty string for empty input", () => {
      expect(gw.splitResponse("")).toEqual([""]);
      expect(gw.splitResponse(null)).toEqual([""]);
    });

    it("splits long text into chunks", () => {
      const text = "line\n".repeat(1000);
      const chunks = gw.splitResponse(text, 100);
      expect(chunks.length).toBeGreaterThan(1);
      for (const chunk of chunks) {
        expect(chunk.length).toBeLessThanOrEqual(100);
      }
    });
  });

  // Stats

  describe("getStats", () => {
    it("returns platform, running, sessions", () => {
      const stats = gw.getStats();
      expect(stats.platform).toBe("test");
      expect(stats.running).toBe(false);
      expect(stats.sessions).toBe(0);
    });
  });
});

// ─── Telegram Formatter ─────────────────────────────────────────────

describe("Telegram Formatter", () => {
  describe("escapeMarkdownV2", () => {
    it("escapes special characters", () => {
      expect(escapeMarkdownV2("hello_world")).toBe("hello\\_world");
      expect(escapeMarkdownV2("a*b")).toBe("a\\*b");
      expect(escapeMarkdownV2("1.2")).toBe("1\\.2");
    });

    it("returns empty for null/empty", () => {
      expect(escapeMarkdownV2("")).toBe("");
      expect(escapeMarkdownV2(null)).toBe("");
    });
  });

  describe("formatForTelegram", () => {
    it("converts headers to bold", () => {
      expect(formatForTelegram("## Title")).toBe("*Title*");
    });

    it("converts **bold** to *bold*", () => {
      expect(formatForTelegram("**important**")).toBe("*important*");
    });

    it("truncates long messages", () => {
      const long = "x".repeat(5000);
      const result = formatForTelegram(long, { maxLength: 100 });
      expect(result.length).toBe(100);
      expect(result).toMatch(/\.\.\.$/);
    });

    it("returns empty for null", () => {
      expect(formatForTelegram(null)).toBe("");
    });
  });
});

// ─── Discord Formatter ──────────────────────────────────────────────

describe("Discord Formatter", () => {
  describe("formatForDiscord", () => {
    it("passes through short text unchanged", () => {
      expect(formatForDiscord("hello")).toBe("hello");
    });

    it("truncates text over 2000 chars", () => {
      const long = "x".repeat(3000);
      const result = formatForDiscord(long);
      expect(result.length).toBe(2000);
      expect(result).toMatch(/\.\.\.$/);
    });

    it("returns empty for null", () => {
      expect(formatForDiscord(null)).toBe("");
    });
  });

  describe("splitForDiscord", () => {
    it("returns single chunk for short text", () => {
      expect(splitForDiscord("hello")).toEqual(["hello"]);
    });

    it("splits long text at newlines", () => {
      const text = "line\n".repeat(600);
      const chunks = splitForDiscord(text);
      expect(chunks.length).toBeGreaterThan(1);
      for (const chunk of chunks) {
        expect(chunk.length).toBeLessThanOrEqual(2000);
      }
    });
  });

  describe("codeBlock", () => {
    it("wraps code in fenced block", () => {
      expect(codeBlock("const x = 1;", "js")).toBe("```js\nconst x = 1;\n```");
    });

    it("works without language", () => {
      expect(codeBlock("hello")).toBe("```\nhello\n```");
    });
  });

  describe("quoteBlock", () => {
    it("formats title and quoted content", () => {
      const result = quoteBlock("Info", "line1\nline2");
      expect(result).toBe("**Info**\n> line1\n> line2");
    });
  });
});

// ─── Edge-case coverage (Hermes parity) ────────────────────────────

describe("GatewayBase — rate limit window expiry", () => {
  it("old messages fall off after window expires", () => {
    const gw = new GatewayBase({
      platform: "test",
      rateLimitMax: 2,
      rateLimitWindow: 100, // 100ms window
    });
    // Record 2 messages, hitting the limit
    gw.recordMessage("chat1");
    gw.recordMessage("chat1");
    expect(gw.isRateLimited("chat1")).toBe(true);

    // Manually age the timestamps so they fall outside the window
    const bucket = gw._rateLimitBuckets.get("chat1");
    bucket[0] = Date.now() - 200;
    bucket[1] = Date.now() - 200;

    // Now they should have expired
    expect(gw.isRateLimited("chat1")).toBe(false);
  });
});

describe("GatewayBase — custom maxResponseLength", () => {
  it("uses custom maxResponseLength in splitResponse", () => {
    const gw = new GatewayBase({ platform: "test", maxResponseLength: 50 });
    expect(gw.maxResponseLength).toBe(50);
    const text = "a".repeat(100);
    const chunks = gw.splitResponse(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(50);
    }
  });
});

describe("GatewayBase — multiple chats with independent sessions", () => {
  it("maintains separate sessions per chatId", () => {
    const gw = new GatewayBase({ platform: "test" });
    gw.getOrCreateSession("chat-a");
    gw.getOrCreateSession("chat-b");
    gw.addMessage("chat-a", "user", "hello from A");
    gw.addMessage("chat-b", "user", "hello from B");
    gw.addMessage("chat-b", "assistant", "reply to B");

    const sessionA = gw.sessions.get("chat-a");
    const sessionB = gw.sessions.get("chat-b");
    expect(sessionA.messages).toHaveLength(1);
    expect(sessionB.messages).toHaveLength(2);
    expect(gw.getSessionCount()).toBe(2);
  });
});

describe("GatewayBase — splitResponse with no newlines (long single line)", () => {
  it("splits at maxLength when there are no newlines", () => {
    const gw = new GatewayBase({ platform: "test" });
    const longLine = "x".repeat(10000); // no newlines at all
    const chunks = gw.splitResponse(longLine, 200);
    expect(chunks.length).toBeGreaterThan(1);
    // Each chunk should be <= 200
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(200);
    }
    // All content should be preserved
    expect(chunks.join("")).toBe(longLine);
  });
});

describe("escapeMarkdownV2 — all special chars", () => {
  it("escapes individual special chars: _ * [ ] ( ) ~ > # + - = | { } . !", () => {
    expect(escapeMarkdownV2("-")).toBe("\\-");
    expect(escapeMarkdownV2("=")).toBe("\\=");
    expect(escapeMarkdownV2("|")).toBe("\\|");
    expect(escapeMarkdownV2("{")).toBe("\\{");
    expect(escapeMarkdownV2("}")).toBe("\\}");
    expect(escapeMarkdownV2("~")).toBe("\\~");
    expect(escapeMarkdownV2(">")).toBe("\\>");
    expect(escapeMarkdownV2("#")).toBe("\\#");
    expect(escapeMarkdownV2("+")).toBe("\\+");
    expect(escapeMarkdownV2("!")).toBe("\\!");
  });
});

describe("splitForDiscord — code block boundary", () => {
  it("tries to split at code block boundary when present", () => {
    // Build text with a code block that sits near the 2000-char boundary
    const before = "x".repeat(1500);
    const codeSection = "\n```js\nconst a = 1;\n```\n";
    const after = "y".repeat(1500);
    const text = before + codeSection + after;

    const chunks = splitForDiscord(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(2000);
    }
  });
});

describe("formatForTelegram — code blocks preserved", () => {
  it("preserves code blocks in output", () => {
    const input = "Here is code:\n```js\nconst x = 1;\n```\nDone.";
    const result = formatForTelegram(input);
    expect(result).toContain("```");
    expect(result).toContain("const x = 1;");
  });
});

describe("quoteBlock — multi-line content", () => {
  it("prefixes each line with > for multi-line content", () => {
    const result = quoteBlock("Title", "line1\nline2\nline3");
    expect(result).toBe("**Title**\n> line1\n> line2\n> line3");
    // Verify each content line starts with >
    const lines = result.split("\n");
    expect(lines[0]).toBe("**Title**");
    expect(lines[1]).toBe("> line1");
    expect(lines[2]).toBe("> line2");
    expect(lines[3]).toBe("> line3");
  });
});
