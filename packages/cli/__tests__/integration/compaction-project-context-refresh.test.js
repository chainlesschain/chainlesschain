import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { agentLoop, runAgentHeadless } from "../helpers/test-model-egress.js";
import { runAgentHeadlessStream } from "../../src/runtime/headless-stream.js";
import { PromptCompressor } from "../../src/harness/prompt-compressor.js";
import {
  readVerifiedEvents,
  readVerifiedMessages,
} from "../../src/harness/jsonl-session-store.js";

let cwd;
let temporaryRoot;
beforeEach(() => {
  temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cc-compact-project-"));
  cwd = path.join(temporaryRoot, "workspace");
  fs.mkdirSync(cwd);
  fs.mkdirSync(path.join(cwd, ".chainlesschain"));
  fs.writeFileSync(path.join(cwd, ".chainlesschain/config.json"), "{}");
  fs.writeFileSync(path.join(cwd, "cc.md"), "# Project\n@memory.md\n");
  fs.writeFileSync(path.join(cwd, "memory.md"), "PROJECT_MEMORY_OLD_82731");
  fs.writeFileSync(
    path.join(cwd, ".chainlesschain/rules.md"),
    "PROJECT_RULE_OLD_82731",
  );
  vi.stubEnv("CHAINLESSCHAIN_HOME", path.join(temporaryRoot, "state"));
  vi.stubEnv(
    "CHAINLESSCHAIN_SECURITY_ANCHOR_HOME",
    path.join(temporaryRoot, "anchors"),
  );
  // Exercise the production default-on project-memory mode. This does not
  // alter the explicit test-only model transport installed by test setup.
  vi.stubEnv("VITEST", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
});

describe("project context around live compaction", () => {
  it.each([false, "lean", "environment-off"])(
    "preserves the host project-memory mode %s",
    async (mode) => {
      fs.writeFileSync(path.join(cwd, "cc.local.md"), "LOCAL_DETAIL_82731");
      if (mode === "environment-off") vi.stubEnv("CC_PROJECT_MEMORY", "0");
      let system;
      const result = await runAgentHeadless(
        {
          cwd,
          prompt: "Inspect current context",
          ephemeral: true,
          projectMemory: mode === "environment-off" ? true : mode,
          outputFormat: "json",
          useRegisteredMcp: false,
        },
        {
          bootstrap: async () => ({ db: null }),
          getApprovalGate: async () => null,
          resolveAgentMcp: async () => null,
          writeOut: () => {},
          writeErr: () => {},
          chatFn: async (messages) => {
            system = messages[0].content;
            return {
              message: { role: "assistant", content: "done" },
              usage: { input_tokens: 1, output_tokens: 1 },
            };
          },
        },
      );
      expect(result.exitCode, JSON.stringify(result)).toBe(0);
      expect(system).not.toContain("LOCAL_DETAIL_82731");
      if (mode === "lean") expect(system).toContain("PROJECT_MEMORY_OLD_82731");
      else expect(system).not.toContain("PROJECT_MEMORY_OLD_82731");
      // The legacy environment kill switch suppresses the instruction block;
      // explicit off/lean also suppress the separate .chainlesschain/rules.md.
      if (mode !== "environment-off")
        expect(system).not.toContain("PROJECT_RULE_OLD_82731");
    },
  );

  it.each(["success", "failure", "during-summary", "deleted", "hook"])(
    "headless uses current rules and imported memory after %s",
    async (scenario) => {
      let original;
      let providerMessages;
      const update = () => {
        if (scenario === "deleted") {
          fs.unlinkSync(path.join(cwd, "memory.md"));
          fs.unlinkSync(path.join(cwd, ".chainlesschain/rules.md"));
          return;
        }
        fs.writeFileSync(
          path.join(cwd, "memory.md"),
          "PROJECT_MEMORY_NEW_82731",
        );
        fs.writeFileSync(
          path.join(cwd, ".chainlesschain/rules.md"),
          "PROJECT_RULE_NEW_82731",
        );
      };
      fs.writeFileSync(
        path.join(cwd, "update-project.cjs"),
        "const fs = require('node:fs'); fs.writeFileSync('memory.md', 'PROJECT_MEMORY_NEW_82731'); fs.writeFileSync('.chainlesschain/rules.md', 'PROJECT_RULE_NEW_82731');",
      );
      const compress = vi.fn(async (messages) => {
        if (scenario === "during-summary") update();
        if (scenario === "failure")
          throw new Error("fixture compaction unavailable");
        return {
          messages: [messages[0], ...messages.slice(-3)],
          stats: { strategy: "fixture-extractive", saved: 50 },
        };
      });
      const result = await runAgentHeadless(
        {
          cwd,
          prompt: "Continue using current project instructions",
          ephemeral: true,
          projectMemory: true,
          useRegisteredMcp: false,
          outputFormat: "json",
          ...(scenario === "hook"
            ? {
                settingsHooks: {
                  PreCompact: [
                    {
                      matcher: null,
                      hooks: [
                        {
                          type: "command",
                          command: `"${process.execPath.replaceAll("\\", "/")}" update-project.cjs`,
                        },
                      ],
                    },
                  ],
                },
              }
            : {}),
        },
        {
          bootstrap: async () => ({ db: null }),
          getApprovalGate: async () => null,
          resolveAgentMcp: async () => null,
          writeOut: () => {},
          writeErr: () => {},
          agentLoop: async function* (messages, options) {
            original = messages[0].content;
            messages.splice(
              1,
              0,
              { role: "user", content: "Prior work" },
              { role: "assistant", content: "Prior result" },
              { role: "user", content: "More work" },
              { role: "assistant", content: "More result" },
            );
            if (!["during-summary", "hook"].includes(scenario)) update();
            yield* agentLoop(messages, {
              ...options,
              autoMicroCompact: false,
              _autoCompactor: { shouldAutoCompact: () => true, compress },
              chatFn: async (request) => {
                providerMessages = structuredClone(request);
                return {
                  message: { role: "assistant", content: "done" },
                  usage: { input_tokens: 1, output_tokens: 1 },
                };
              },
            });
          },
        },
      );
      expect(original).toContain("PROJECT_RULE_OLD_82731");
      expect(original).toContain("PROJECT_MEMORY_OLD_82731");
      expect(compress).toHaveBeenCalledOnce();
      expect(result.exitCode, JSON.stringify(result)).toBe(0);
      const system = providerMessages
        .filter((message) => message.role === "system")
        .map((message) => message.content)
        .join("\n");
      if (scenario !== "deleted") {
        expect(system).toContain("PROJECT_RULE_NEW_82731");
        expect(system).toContain("PROJECT_MEMORY_NEW_82731");
      }
      expect(system).not.toContain("PROJECT_RULE_OLD_82731");
      expect(system).not.toContain("PROJECT_MEMORY_OLD_82731");
      if (scenario === "failure") {
        expect(
          providerMessages.some((message) => message.content === "Prior work"),
        ).toBe(true);
        expect(
          providerMessages.some((message) => message.content === "More result"),
        ).toBe(true);
      }
    },
  );

  it.each(["headless", "stream"])(
    "%s preserves fresh context through real canonical checkpoints and resume",
    async (entry) => {
      vi.stubEnv(
        "CHAINLESSCHAIN_CONTEXT_MEMORY_CLI_STAGE",
        "canonical_default",
      );
      fs.writeFileSync(path.join(cwd, "evidence.txt"), "Local task evidence.");
      vi.spyOn(
        PromptCompressor.prototype,
        "shouldAutoCompact",
      ).mockImplementation((messages) =>
        messages.some((message) => message.role === "tool"),
      );
      const sessionId = "project-refresh-checkpoint";
      const requests = [];
      const call = async (resume, chatFn) => {
        const options = {
          cwd,
          sessionId,
          provider: "ollama",
          model: "qwen2.5:7b",
          projectMemory: true,
          useRegisteredMcp: false,
          expandFileRefs: false,
          ...(resume ? { resume: sessionId } : { persistSession: true }),
        };
        const deps = {
          bootstrap: async () => ({ db: null }),
          getApprovalGate: async () => null,
          resolveAgentMcp: async () => null,
          writeOut: () => {},
          writeErr: () => {},
          chatFn,
        };
        return entry === "stream"
          ? runAgentHeadlessStream(options, {
              ...deps,
              input: (async function* () {
                yield JSON.stringify({
                  type: "user",
                  content: "Continue local work",
                }) + "\n";
              })(),
            })
          : runAgentHeadless(
              {
                ...options,
                prompt: "Continue local work",
                outputFormat: "json",
              },
              deps,
            );
      };
      const result = await call(false, async (messages) => {
        requests.push(structuredClone(messages));
        if (requests.length === 1) {
          fs.writeFileSync(
            path.join(cwd, "memory.md"),
            "PROJECT_MEMORY_NEW_82731",
          );
          fs.writeFileSync(
            path.join(cwd, ".chainlesschain/rules.md"),
            "PROJECT_RULE_NEW_82731",
          );
        }
        return {
          message:
            requests.length === 1
              ? {
                  role: "assistant",
                  content: "Reading evidence",
                  tool_calls: [1, 2].map((number) => ({
                    id: `read-${number}`,
                    type: "function",
                    function: {
                      name: "read_file",
                      arguments: JSON.stringify({ path: "evidence.txt" }),
                    },
                  })),
                }
              : { role: "assistant", content: "Local work complete" },
          usage: { input_tokens: 10, output_tokens: 10 },
        };
      });
      expect(result.exitCode, JSON.stringify(result)).toBe(0);
      expect(requests).toHaveLength(2);
      expect(requests[0][0].content).toContain("PROJECT_MEMORY_OLD_82731");
      expect(requests[1][0].content).toContain("PROJECT_MEMORY_NEW_82731");
      expect(requests[1][0].content).toContain("PROJECT_RULE_NEW_82731");
      expect(
        readVerifiedEvents(sessionId).some((event) => event.type === "compact"),
      ).toBe(true);
      const durable = readVerifiedMessages(sessionId);
      expect(durable.filter((message) => message.role === "tool")).toHaveLength(
        2,
      );
      expect(JSON.stringify(durable)).not.toContain("PROJECT_MEMORY_");
      expect(JSON.stringify(durable)).not.toContain("PROJECT_RULE_");
      fs.writeFileSync(
        path.join(cwd, "memory.md"),
        "PROJECT_MEMORY_RESUMED_82731",
      );
      const resumedRequests = [];
      const resumed = await call(true, async (messages) => {
        resumedRequests.push(structuredClone(messages));
        return {
          message: { role: "assistant", content: "Resumed" },
          usage: { input_tokens: 1, output_tokens: 1 },
        };
      });
      expect(resumed.exitCode).toBe(0);
      expect(resumedRequests).toHaveLength(1);
      expect(resumedRequests[0][0].content).toContain(
        "PROJECT_MEMORY_RESUMED_82731",
      );
      expect(resumedRequests[0][0].content).not.toContain(
        "PROJECT_MEMORY_NEW_82731",
      );
      expect(
        resumedRequests[0].filter((message) => message.role === "tool"),
      ).toHaveLength(2);
    },
  );
});
