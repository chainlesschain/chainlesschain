/**
 * PDH cross-session feedback ledger (design module 101 §3.5.13). Append-only,
 * best-effort persistence of self-learning feedback + a summary/system-note for
 * re-injecting learned preferences into a later session. Pure via `_deps`.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  _deps,
  appendFeedback,
  readFeedback,
  summarizeFeedback,
  feedbackSystemNote,
  feedbackLedgerPath,
} from "../../src/lib/pdh-feedback-ledger.js";

let tmp;
let clock;
const origHome = _deps.homeDir;
const origNow = _deps.now;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pdh-fb-"));
  clock = 1000;
  _deps.homeDir = () => tmp;
  _deps.now = () => clock++;
});
afterEach(() => {
  _deps.homeDir = origHome;
  _deps.now = origNow;
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe("appendFeedback", () => {
  it("writes a record, creating the home dir, and returns it", () => {
    const rec = appendFeedback({
      sessionId: "s1",
      turnId: "t1",
      kind: "correction",
      comment: "用人民币",
    });
    expect(rec).toMatchObject({
      sessionId: "s1",
      turnId: "t1",
      kind: "correction",
      comment: "用人民币",
    });
    expect(typeof rec.ts).toBe("number");
    expect(fs.existsSync(feedbackLedgerPath(_deps))).toBe(true);
  });

  it("drops a comment for non-correction kinds (thumbs carry no ground truth)", () => {
    const rec = appendFeedback({ kind: "positive", comment: "ignored" });
    expect(rec.kind).toBe("positive");
    expect(rec.comment).toBe(null);
  });

  it("skips an invalid kind and writes nothing", () => {
    expect(appendFeedback({ kind: "meh" })).toBe(null);
    expect(fs.existsSync(feedbackLedgerPath(_deps))).toBe(false);
  });

  it("appends across calls (one JSONL line each)", () => {
    appendFeedback({ kind: "positive" });
    appendFeedback({ kind: "negative" });
    const lines = fs
      .readFileSync(feedbackLedgerPath(_deps), "utf-8")
      .trim()
      .split("\n");
    expect(lines).toHaveLength(2);
  });
});

describe("readFeedback", () => {
  it("returns [] when no ledger exists", () => {
    expect(readFeedback(_deps)).toEqual([]);
  });

  it("reads valid entries and skips malformed/invalid lines", () => {
    const file = feedbackLedgerPath(_deps);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      [
        JSON.stringify({ kind: "positive", ts: 1 }),
        "not json",
        JSON.stringify({ kind: "bogus", ts: 2 }),
        JSON.stringify({ kind: "correction", comment: "x", ts: 3 }),
        "",
      ].join("\n"),
      "utf-8",
    );
    const got = readFeedback(_deps);
    expect(got.map((e) => e.kind)).toEqual(["positive", "correction"]);
  });
});

describe("summarizeFeedback + feedbackSystemNote", () => {
  it("counts kinds, surfaces newest corrections first, and nets sentiment", () => {
    const entries = [
      { kind: "positive" },
      { kind: "positive" },
      { kind: "negative" },
      { kind: "correction", comment: "c1" },
      { kind: "correction", comment: "c2" },
    ];
    const s = summarizeFeedback(entries, { maxCorrections: 1 });
    expect(s).toMatchObject({
      total: 5,
      positive: 2,
      negative: 1,
      sentiment: 1,
    });
    expect(s.corrections).toEqual(["c2"]); // newest first, capped
  });

  it("system note is empty with no feedback, else carries corrections + sentiment", () => {
    expect(feedbackSystemNote(summarizeFeedback([]))).toBe("");
    const note = feedbackSystemNote(
      summarizeFeedback([
        { kind: "correction", comment: "用简体中文" },
        { kind: "negative" },
      ]),
    );
    expect(note).toContain("用简体中文");
    expect(note).toContain("不满");
  });
});

describe("round-trip", () => {
  it("append → read → summarize reflects all writes", () => {
    appendFeedback({ kind: "positive" });
    appendFeedback({ kind: "correction", comment: "金额用元" });
    const s = summarizeFeedback(readFeedback(_deps));
    expect(s.total).toBe(2);
    expect(s.corrections).toEqual(["金额用元"]);
  });
});
