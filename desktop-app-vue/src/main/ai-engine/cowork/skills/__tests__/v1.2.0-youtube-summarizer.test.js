/**
 * Unit tests for youtube-summarizer skill handler (v1.2.0)
 *
 * The handler fetches the YouTube watch page + caption XML over HTTPS. Tests
 * stub that single network boundary via the handler's _deps.fetchText seam
 * (vi.mock("https") does not work for inlined CJS — see .claude/rules/testing.md),
 * so the suite is deterministic and never touches the network.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

vi.mock("../../../../utils/logger.js", () => {
  const fake = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { logger: fake, default: fake };
});

const handler = require("../builtin/youtube-summarizer/handler.js");

const origFetchText = handler._deps.fetchText;

// A watch page that advertises an English caption track.
const PAGE_WITH_CAPTIONS =
  'var ytInitialPlayerResponse = {"captions":{"playerCaptionsTracklistRenderer":' +
  '{"captionTracks":[{"baseUrl":"https://youtube.com/api/timedtext?v=x","languageCode":"en"}]}}};';

// A watch page with no caption tracks at all.
const PAGE_NO_CAPTIONS = "var ytInitialPlayerResponse = {};";

const TRANSCRIPT_XML =
  '<?xml version="1.0" encoding="utf-8"?><transcript>' +
  '<text start="0.0" dur="2.5">Hello and welcome</text>' +
  '<text start="2.5" dur="3.0">The most important point is preparation</text>' +
  '<text start="5.5" dur="2.0">Finally, the conclusion follows</text>' +
  "</transcript>";

// fetchText stub: watch page → caption-bearing HTML; anything else → XML.
function stubWithCaptions() {
  handler._deps.fetchText = vi.fn(async (url) => {
    if (url.includes("/watch?v=")) {
      return PAGE_WITH_CAPTIONS;
    }
    return TRANSCRIPT_XML;
  });
  return handler._deps.fetchText;
}

function stubNoCaptions() {
  handler._deps.fetchText = vi.fn(async () => PAGE_NO_CAPTIONS);
  return handler._deps.fetchText;
}

beforeEach(() => {
  vi.clearAllMocks();
  stubWithCaptions(); // default: a video that has captions
});

afterAll(() => {
  handler._deps.fetchText = origFetchText;
});

describe("youtube-summarizer handler", () => {
  describe("init()", () => {
    it("initializes without throwing", async () => {
      await expect(
        handler.init({ name: "youtube-summarizer" }),
      ).resolves.not.toThrow();
    });
  });

  describe("execute() - summarize action", () => {
    it("summarizes a full youtube.com watch URL", async () => {
      const result = await handler.execute(
        { input: "summarize https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.action).toBe("summarize");
      expect(result.videoId).toBe("dQw4w9WgXcQ");
      expect(result.summary.wordCount).toBeGreaterThan(0);
      expect(result.summary.segments.length).toBeGreaterThan(0);
      // "important" + "finally" + "conclusion" all score → at least one key point
      expect(result.summary.keyPoints.length).toBeGreaterThan(0);
    });

    it("handles a youtu.be short URL", async () => {
      const result = await handler.execute(
        { input: "summarize https://youtu.be/dQw4w9WgXcQ" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.videoId).toBe("dQw4w9WgXcQ");
    });

    it("handles a bare 11-char video ID", async () => {
      const result = await handler.execute(
        { input: "summarize dQw4w9WgXcQ" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.videoId).toBe("dQw4w9WgXcQ");
    });

    it("fails gracefully when the video has no captions", async () => {
      stubNoCaptions();
      const result = await handler.execute(
        { input: "summarize dQw4w9WgXcQ" },
        {},
        {},
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("No transcript found");
    });
  });

  describe("execute() - transcript action", () => {
    it("returns parsed transcript segments", async () => {
      const result = await handler.execute(
        { input: "transcript dQw4w9WgXcQ" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.action).toBe("transcript");
      expect(result.segmentCount).toBe(3);
      expect(result.transcript[0].text).toBe("Hello and welcome");
      expect(result.transcript[0].start).toBe(0);
    });

    it("fails when captions are disabled", async () => {
      stubNoCaptions();
      const result = await handler.execute(
        { input: "transcript dQw4w9WgXcQ" },
        {},
        {},
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("Captions may be disabled");
    });
  });

  describe("execute() - chapters action", () => {
    it("extracts chapters from the transcript", async () => {
      const result = await handler.execute(
        { input: "chapters dQw4w9WgXcQ" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.action).toBe("chapters");
      expect(result.chapters.length).toBeGreaterThan(0);
    });
  });

  describe("execute() - error handling", () => {
    it("fails on empty input without hitting the network", async () => {
      const spy = stubWithCaptions();
      const result = await handler.execute({ input: "" }, {}, {});
      expect(result.success).toBe(false);
      expect(spy).not.toHaveBeenCalled();
    });

    it("fails on missing input", async () => {
      const result = await handler.execute({}, {}, {});
      expect(result.success).toBe(false);
    });

    it("fails on an unparseable URL without hitting the network", async () => {
      const spy = stubWithCaptions();
      const result = await handler.execute(
        { input: "summarize not-a-valid-url-at-all" },
        {},
        {},
      );
      expect(result.success).toBe(false);
      expect(spy).not.toHaveBeenCalled();
    });

    it("surfaces a network error as a failed result (no throw)", async () => {
      handler._deps.fetchText = vi.fn(async () => {
        throw new Error("ENOTFOUND www.youtube.com");
      });
      const result = await handler.execute(
        { input: "summarize dQw4w9WgXcQ" },
        {},
        {},
      );
      // fetchTranscript swallows the error → empty transcript → graceful failure
      expect(result.success).toBe(false);
      expect(result.error).toContain("No transcript found");
    });
  });
});
