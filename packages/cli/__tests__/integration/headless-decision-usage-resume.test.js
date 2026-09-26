import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runAgentHeadless } from "../helpers/test-model-egress.js";
import { openDecisionProviderAuthority } from "../../src/lib/decision-layer/provider-authority.js";
import { runMeteredDirectModelCall } from "../../src/lib/direct-model-usage.js";
import { _registerTestScopedSessionAntiRollbackDirectory } from "../../src/lib/session-anti-rollback-anchor.js";
import {
  appendEvent,
  findLatestEvent,
  sessionPath,
  startSession,
} from "../../src/harness/jsonl-session-store.js";

const digest = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

let home;
let previousHome;
let previousAnchorHome;

beforeEach(() => {
  previousHome = process.env.CHAINLESSCHAIN_HOME;
  previousAnchorHome = process.env.CHAINLESSCHAIN_SECURITY_ANCHOR_HOME;
  home = fs.mkdtempSync(path.join(os.tmpdir(), "cc-decision-resume-"));
  process.env.CHAINLESSCHAIN_HOME = home;
  process.env.CHAINLESSCHAIN_SECURITY_ANCHOR_HOME = `${home}-anchors`;
  _registerTestScopedSessionAntiRollbackDirectory({
    homeDir: home,
    anchorBase: `${home}-anchors`,
  });
});

afterEach(() => {
  if (previousHome === undefined) delete process.env.CHAINLESSCHAIN_HOME;
  else process.env.CHAINLESSCHAIN_HOME = previousHome;
  if (previousAnchorHome === undefined)
    delete process.env.CHAINLESSCHAIN_SECURITY_ANCHOR_HOME;
  else process.env.CHAINLESSCHAIN_SECURITY_ANCHOR_HOME = previousAnchorHome;
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(`${home}-anchors`, { recursive: true, force: true });
});

function makeRun(decide, sessionId, resume = false) {
  const decisions = [];
  const deps = {
    bootstrap: async () => ({ db: null }),
    getApprovalGate: async () => null,
    resolveAgentMcp: async () => null,
    writeOut: () => {},
    writeErr: () => {},
    decisionProvider: openDecisionProviderAuthority({
      provider: "typesafe",
      model: "jev-test",
      decide,
    }),
    agentLoop: async function* (_messages, options) {
      decisions.push(
        await options.skillDecisionRuntime.suggest({
          query: "repair tests",
          candidates: [
            {
              id: "repair-tests",
              displayName: "Repair tests",
              description: "Repair failing tests",
              digest: digest("repair-tests"),
            },
          ],
          turnId: "turn-1",
        }),
      );
      yield { type: "response-complete", content: "done" };
      yield { type: "run-ended", reason: "complete" };
    },
  };
  const options = {
    prompt: "repair tests",
    sessionId,
    ...(resume ? { resume: sessionId } : { persistSession: true }),
    decisionMode: "suggest",
    hermeticExecution: true,
  };
  return { options, deps, decisions };
}

const validAnswer = {
  provider: "typesafe",
  model: "jev-test",
  answers: {
    needs_skill: { type: "noul", noul: 0.95 },
    best_skill: {
      type: "choice",
      choice: "c1",
      confidence: 0.9,
      probabilities: { c1: 0.96, none: 0.04 },
    },
    fits_c1: { type: "noul", noul: 0.94 },
  },
  usage: { input_tokens: 12, output_tokens: 4 },
};

describe("headless decision usage recovery with real JSONL", () => {
  it("does not confuse an unrelated model usage event with decision usage", async () => {
    const sessionId = "decision-usage-unrelated";
    startSession(sessionId);
    await runMeteredDirectModelCall({
      sessionId,
      persist: (type, data) => appendEvent(sessionId, type, data),
      provider: "main-model",
      model: "main-model-test",
      operationId: "agent:main",
      call: async () => ({}),
    });
    expect(findLatestEvent(sessionId, "model_usage_unknown")).not.toBeNull();

    const decide = vi.fn().mockResolvedValue(validAnswer);
    const resumed = makeRun(decide, sessionId, true);
    expect(await runAgentHeadless(resumed.options, resumed.deps)).toMatchObject(
      { exitCode: 0, isError: false },
    );
    expect(resumed.decisions[0]).toMatchObject({ status: "suggestion" });
    expect(decide).toHaveBeenCalledOnce();
  });

  it("blocks resumed decision calls after unknown usage in a verified transcript", async () => {
    const sessionId = "decision-usage-resume";
    const decide = vi
      .fn()
      .mockResolvedValueOnce({ ...validAnswer, usage: undefined })
      .mockResolvedValue(validAnswer);
    const first = makeRun(decide, sessionId);
    expect(await runAgentHeadless(first.options, first.deps)).toMatchObject({
      exitCode: 0,
      isError: false,
    });
    expect(first.decisions[0]).toMatchObject({
      status: "unavailable",
      reasonCode: "provider-usage-unknown",
    });
    expect(
      findLatestEvent(sessionId, "model_usage_unknown", (event) =>
        event.data?.operationId?.startsWith("decision:"),
      ),
    ).not.toBeNull();

    const resumed = makeRun(decide, sessionId, true);
    expect(await runAgentHeadless(resumed.options, resumed.deps)).toMatchObject(
      {
        exitCode: 0,
        isError: false,
      },
    );
    expect(resumed.decisions[0]).toMatchObject({
      status: "unavailable",
      reasonCode: "provider-usage-unknown-blocked",
      selectedDigest: null,
    });
    expect(decide).toHaveBeenCalledOnce();
  });

  it("does not use a tampered transcript to authorize another decision", async () => {
    const sessionId = "decision-usage-tampered";
    const decide = vi.fn().mockResolvedValue({
      ...validAnswer,
      usage: undefined,
    });
    const first = makeRun(decide, sessionId);
    expect(await runAgentHeadless(first.options, first.deps)).toMatchObject({
      exitCode: 0,
      isError: false,
    });
    const file = sessionPath(sessionId);
    const transcript = fs.readFileSync(file, "utf8");
    expect(transcript).toContain("model_usage_unknown");
    fs.writeFileSync(
      file,
      transcript.replace("model_usage_unknown", "model_usage_settled"),
    );

    const resumed = makeRun(decide, sessionId, true);
    const result = await runAgentHeadless(resumed.options, resumed.deps);
    expect(result).toMatchObject({ exitCode: 1, isError: true });
    expect(resumed.decisions).toHaveLength(0);
    expect(decide).toHaveBeenCalledOnce();
  });
});
