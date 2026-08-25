/**
 * Interactive questions (CC_INTERACTIVE_QUESTIONS / interactiveQuestions; chat-
 * panel ask_user_question round-trip). When opted in, the model's
 * ask_user_question becomes a question_request / {"type":"answer"} round-trip on
 * the duplex pipes instead of degrading to user_not_reachable:
 *   - the blocked tool resolves with the user's answer
 *   - cancel (null answer), timeout, and stdin-close reject with USER_TIMEOUT
 *     (the agent-core handler maps that to user_timeout → the model proceeds)
 *   - askUser is injected ONLY when the flag/env is on
 * The pump handles answers immediately, mid-turn, like approvals.
 */
import { describe, it, expect } from "vitest";
import {
  runAgentHeadlessStream,
  parseInputEvent,
} from "../../src/runtime/headless-stream.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const questionBinding = (sequence = 1) => ({
  backgroundAgentId: null,
  sessionId: "test-question-session",
  turnId: null,
  toolUseId: null,
  sequence,
});

describe("parseInputEvent — answers", () => {
  it("parses answers and rejects malformed ones", () => {
    expect(
      parseInputEvent('{"type":"answer","id":"q-1","answer":"Blue"}'),
    ).toEqual({ answer: { id: "q-1", value: "Blue" } });
    expect(
      parseInputEvent('{"type":"answer","id":"q-2","answer":["a","b"]}'),
    ).toEqual({ answer: { id: "q-2", value: ["a", "b"] } });
    expect(parseInputEvent('{"type":"answer","id":"q-3"}')).toEqual({
      answer: { id: "q-3", value: null }, // absent answer → cancel
    });
    expect(parseInputEvent('{"type":"answer"}')).toBe(null); // no id
  });
});

describe("interactive questions round-trip", () => {
  // The fake loop simulates the model calling ask_user_question: it invokes the
  // injected interaction.askUser (what agent-core's handler does) and reports
  // the answer — or, on rejection, that it proceeded without one.
  const askingLoop = async function* (messages, opts) {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (/ASK/.test(lastUser.content)) {
      try {
        const answer = await opts.interaction.askUser({
          question: "Pick a color",
          options: [{ label: "Blue" }, { label: "Red" }],
          multiSelect: false,
        });
        yield {
          type: "response-complete",
          content: "picked " + JSON.stringify(answer),
        };
      } catch (e) {
        yield {
          type: "response-complete",
          content: "proceeded (" + (e.code || "err") + ")",
        };
      }
    } else {
      yield { type: "response-complete", content: "plain reply" };
    }
    yield { type: "run-ended", reason: "complete" };
  };

  function harness({
    inputGen,
    agentLoop = askingLoop,
    options = {},
    extraDeps = {},
    onEvent,
  }) {
    const lines = [];
    let eventBuffer = "";
    const deps = {
      bootstrap: async () => ({ db: null }),
      getApprovalGate: async () => null,
      writeOut: (s) => {
        lines.push(s);
        if (!onEvent) return;
        eventBuffer += s;
        for (;;) {
          const newline = eventBuffer.indexOf("\n");
          if (newline < 0) break;
          const line = eventBuffer.slice(0, newline);
          eventBuffer = eventBuffer.slice(newline + 1);
          if (!line) continue;
          try {
            onEvent(JSON.parse(line));
          } catch {
            // Observation must never change the behavior of the output seam.
          }
        }
      },
      writeErr: () => {},
      agentLoop,
      input: inputGen(),
      ...extraDeps,
    };
    return {
      run: () =>
        runAgentHeadlessStream(
          {
            expandFileRefs: false,
            interactiveQuestions: true,
            sessionId: "test-question-session",
            ephemeral: true,
            ...options,
          },
          deps,
        ),
      events: () =>
        lines
          .join("")
          .trimEnd()
          .split("\n")
          .map((l) => JSON.parse(l)),
    };
  }

  it("registers MCP elicitation after resolving the MCP client", async () => {
    let elicitationHandler = null;
    const h = harness({
      inputGen: async function* () {
        yield JSON.stringify({ type: "user", text: "trigger MCP" }) + "\n";
        await sleep(80);
        yield JSON.stringify({
          type: "answer",
          id: "q-1",
          answer: "approved",
          binding: questionBinding(),
        }) + "\n";
      },
      agentLoop: async function* () {
        const response = await elicitationHandler({
          server: "example",
          requestId: "req-1",
          message: "Provide a value",
          requestedSchema: { type: "object" },
        });
        yield { type: "response-complete", content: JSON.stringify(response) };
        yield { type: "run-ended", reason: "complete" };
      },
      extraDeps: {
        resolveAgentMcp: async () => ({
          mcpClient: {
            setElicitationHandler(handler) {
              elicitationHandler = handler;
            },
          },
          tools: [],
        }),
      },
    });

    await h.run();

    expect(elicitationHandler).toBeTypeOf("function");
    expect(
      h.events().find((event) => event.type === "question_request"),
    ).toMatchObject({
      question: "Provide a value",
      metadata: {
        kind: "mcp_elicitation",
        server: "example",
        requestId: "req-1",
        requestedSchema: { type: "object" },
      },
    });
    expect(
      JSON.parse(h.events().find((event) => event.type === "result").result),
    ).toEqual({ action: "accept", content: { value: "approved" } });
  });

  it("routes URL-mode elicitation with explicit host metadata and no content", async () => {
    let elicitationHandler = null;
    const h = harness({
      inputGen: async function* () {
        yield JSON.stringify({ type: "user", text: "trigger URL MCP" }) + "\n";
        await sleep(80);
        yield JSON.stringify({
          type: "answer",
          id: "q-1",
          answer: {},
          binding: questionBinding(),
        }) + "\n";
      },
      agentLoop: async function* () {
        const response = await elicitationHandler({
          server: "payments",
          requestId: "req-url-1",
          mode: "url",
          message: "Authorize the payment provider",
          elicitationId: "elicit-1",
          url: "https://accounts.example.test/authorize",
          urlHost: "accounts.example.test",
        });
        yield { type: "response-complete", content: JSON.stringify(response) };
        yield { type: "run-ended", reason: "complete" };
      },
      extraDeps: {
        resolveAgentMcp: async () => ({
          mcpClient: {
            setElicitationHandler(handler) {
              elicitationHandler = handler;
            },
          },
          tools: [],
        }),
      },
    });

    await h.run();

    expect(
      h.events().find((event) => event.type === "question_request"),
    ).toMatchObject({
      question: expect.stringContaining("accounts.example.test"),
      metadata: {
        kind: "mcp_elicitation",
        server: "payments",
        requestId: "req-url-1",
        mode: "url",
        elicitationId: "elicit-1",
        url: "https://accounts.example.test/authorize",
        urlHost: "accounts.example.test",
      },
    });
    expect(
      JSON.parse(h.events().find((event) => event.type === "result").result),
    ).toEqual({ action: "accept" });
  });

  it("forwards deferred and completed URL elicitation lifecycle events", async () => {
    const listeners = new Map();
    const h = harness({
      inputGen: async function* () {
        yield JSON.stringify({ type: "user", text: "trigger lifecycle" }) +
          "\n";
      },
      agentLoop: async function* () {
        listeners.get("elicitation-deferred")({
          server: "payments",
          requestId: "req-url-2",
          mode: "url",
          message: "Authorize",
          elicitationId: "elicit-2",
          url: "https://accounts.example.test/authorize",
          urlHost: "accounts.example.test",
          reason: "no_interactive_host",
          wireAction: "decline",
        });
        listeners.get("elicitation-complete")({
          server: "payments",
          elicitationId: "elicit-2",
        });
        yield { type: "response-complete", content: "done" };
        yield { type: "run-ended", reason: "complete" };
      },
      extraDeps: {
        resolveAgentMcp: async () => ({
          mcpClient: {
            on(event, handler) {
              listeners.set(event, handler);
            },
            setElicitationHandler() {},
          },
          tools: [],
        }),
      },
    });

    await h.run();

    expect(
      h.events().find((event) => event.type === "elicitation_deferred"),
    ).toMatchObject({
      server: "payments",
      request_id: "req-url-2",
      mode: "url",
      elicitation_id: "elicit-2",
      url_host: "accounts.example.test",
      reason: "no_interactive_host",
      wire_action: "decline",
    });
    expect(
      h.events().find((event) => event.type === "elicitation_complete"),
    ).toMatchObject({
      server: "payments",
      elicitation_id: "elicit-2",
    });
  });

  it("answer: the blocked tool gets the value; request + resolution emitted", async () => {
    const h = harness({
      inputGen: async function* () {
        yield JSON.stringify({ type: "user", text: "ASK me a color" }) + "\n";
        await sleep(80);
        yield JSON.stringify({
          type: "answer",
          id: "q-1",
          answer: "Blue",
          binding: questionBinding(),
        }) + "\n";
      },
    });
    await h.run();
    expect(h.events().find((e) => e.type === "question_request")).toMatchObject(
      {
        id: "q-1",
        question: "Pick a color",
        options: [{ label: "Blue" }, { label: "Red" }],
        multiSelect: false,
      },
    );
    expect(
      h.events().find((e) => e.type === "question_resolved"),
    ).toMatchObject({ id: "q-1", via: "user-answer" });
    expect(h.events().find((e) => e.type === "result").result).toBe(
      'picked "Blue"',
    );
  });

  it("multi-select answer arrays pass through", async () => {
    const h = harness({
      inputGen: async function* () {
        yield JSON.stringify({ type: "user", text: "ASK" }) + "\n";
        await sleep(80);
        yield JSON.stringify({
          type: "answer",
          id: "q-1",
          answer: ["Blue", "Red"],
          binding: questionBinding(),
        }) + "\n";
      },
    });
    await h.run();
    expect(h.events().find((e) => e.type === "result").result).toBe(
      'picked ["Blue","Red"]',
    );
  });

  it("rejects a cross-turn answer and keeps waiting for the bound response", async () => {
    const h = harness({
      inputGen: async function* () {
        yield JSON.stringify({ type: "user", text: "ASK" }) + "\n";
        await sleep(80);
        yield JSON.stringify({
          type: "answer",
          id: "q-1",
          answer: "Red",
          binding: { ...questionBinding(), turnId: "wrong-turn" },
        }) + "\n";
        await sleep(20);
        yield JSON.stringify({
          type: "answer",
          id: "q-1",
          answer: "Blue",
          binding: questionBinding(),
        }) + "\n";
      },
    });
    await h.run();
    expect(
      h.events().find((event) => event.type === "question_response_rejected"),
    ).toMatchObject({
      id: "q-1",
      reason: "binding_mismatch",
      session_id: "test-question-session",
    });
    expect(h.events().find((event) => event.type === "result").result).toBe(
      'picked "Blue"',
    );
  });

  it("cancel (null answer) → USER_TIMEOUT, model proceeds", async () => {
    const h = harness({
      inputGen: async function* () {
        yield JSON.stringify({ type: "user", text: "ASK" }) + "\n";
        await sleep(80);
        yield JSON.stringify({
          type: "answer",
          id: "q-1",
          answer: null,
          binding: questionBinding(),
        }) + "\n";
      },
    });
    await h.run();
    expect(
      h.events().find((e) => e.type === "question_resolved"),
    ).toMatchObject({ id: "q-1", via: "cancelled" });
    expect(h.events().find((e) => e.type === "result").result).toBe(
      "proceeded (USER_TIMEOUT)",
    );
  });

  it("timeout → USER_TIMEOUT, model proceeds", async () => {
    process.env.CC_QUESTION_TIMEOUT_MS = "60";
    let releaseStdin;
    const holdStdinOpen = new Promise((resolve) => {
      releaseStdin = resolve;
    });
    let observedResolution = null;
    let watchdogExpired = null;
    let watchdog;
    const armWatchdog = (phase, delayMs) => {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        watchdogExpired = phase;
        releaseStdin();
      }, delayMs);
    };
    armWatchdog("question_request", 45_000);
    try {
      const h = harness({
        onEvent: (event) => {
          if (event.type === "question_request") {
            armWatchdog("question timeout", 3000);
          }
          if (event.type === "question_resolved") {
            clearTimeout(watchdog);
            observedResolution = event;
            releaseStdin();
          }
        },
        inputGen: async function* () {
          yield JSON.stringify({ type: "user", text: "ASK" }) + "\n";
          await holdStdinOpen;
        },
      });
      await h.run();
      expect(
        watchdogExpired,
        `watchdog expired while waiting for ${watchdogExpired}`,
      ).toBe(null);
      expect(observedResolution).toMatchObject({ via: "timeout" });
      expect(
        h.events().find((e) => e.type === "question_resolved"),
      ).toMatchObject({ via: "timeout" });
      expect(h.events().find((e) => e.type === "result").result).toBe(
        "proceeded (USER_TIMEOUT)",
      );
    } finally {
      clearTimeout(watchdog);
      delete process.env.CC_QUESTION_TIMEOUT_MS;
    }
  }, 90_000);

  it("stdin close while pending → USER_TIMEOUT (no hang)", async () => {
    const h = harness({
      inputGen: async function* () {
        yield JSON.stringify({ type: "user", text: "ASK" }) + "\n";
        await sleep(80); // generator ends → stdin closes with the question pending
      },
    });
    const outcome = await h.run();
    expect(
      h.events().find((e) => e.type === "question_resolved"),
    ).toMatchObject({ via: "stdin-closed" });
    expect(outcome.exitCode).toBe(0);
  });

  it("flag off → no interaction.askUser is injected (graceful degrade stays)", async () => {
    let sawInteraction = "unset";
    const h = harness({
      options: { interactiveQuestions: false },
      agentLoop: async function* (messages, opts) {
        sawInteraction = opts.interaction == null ? "none" : "present";
        yield { type: "response-complete", content: "ok" };
        yield { type: "run-ended", reason: "complete" };
      },
      inputGen: async function* () {
        yield JSON.stringify({ type: "user", text: "hi" }) + "\n";
      },
    });
    await h.run();
    expect(sawInteraction).toBe("none");
  });
});
