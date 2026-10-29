import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ContextMemoryKernel } from "@chainlesschain/context-memory-kernel";
import { runAgentHeadless } from "../helpers/test-model-egress.js";
import { runAgentHeadlessStream } from "../../src/runtime/headless-stream.js";
import { PromptCompressor } from "../../src/harness/prompt-compressor.js";
import { createCliContextMemoryRuntime } from "../../src/lib/context-memory-kernel/runtime.js";
import { CliCanonicalMemoryService } from "../../src/lib/context-memory-kernel/memory-service.js";
import {
  readVerifiedEvents,
  readVerifiedMessages,
} from "../../src/harness/jsonl-session-store.js";

const parent = fs.realpathSync.native(os.tmpdir());
const oldContent = "RECOVERY_TOPIC policy OLD_MEMORY_44003";
const newContent = "RECOVERY_TOPIC policy NEW_MEMORY_44003";
const resumedContent = "RECOVERY_TOPIC policy RESUMED_MEMORY_44003";
let root, cwd;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(parent, "cc-compact-structured-"));
  cwd = path.join(root, "workspace");
  fs.mkdirSync(cwd);
  fs.mkdirSync(path.join(cwd, ".chainlesschain"));
  fs.writeFileSync(path.join(cwd, ".chainlesschain/config.json"), "{}");
  fs.writeFileSync(
    path.join(cwd, "evidence.txt"),
    "Durable local task evidence.",
  );
  vi.stubEnv("CHAINLESSCHAIN_HOME", path.join(root, "state"));
  vi.stubEnv("CHAINLESSCHAIN_SECURITY_ANCHOR_HOME", path.join(root, "anchors"));
  vi.stubEnv("CHAINLESSCHAIN_CONTEXT_MEMORY_CLI_STAGE", "canonical_default");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  if (
    path.dirname(root) !== parent ||
    !path.basename(root).startsWith("cc-compact-structured-")
  )
    throw new Error("Unsafe structured Memory fixture cleanup");
  fs.rmSync(root, { recursive: true, force: true });
});

describe("structured Memory around real compaction and resume", () => {
  for (const entry of ["headless", "stream"]) {
    it.each(["supersede", "delete"])(
      `${entry} recalls current authority after %s and resumes without persisting recalled text`,
      async (change) => {
        const sessionId = `structured-recovery-${entry}-${change}`;
        const runtime = createCliContextMemoryRuntime({
          sessionId,
          purgePorts: [],
        });
        const service = new CliCanonicalMemoryService({ runtime });
        const seed = (
          memoryId,
          content,
          scope = "user",
          scopeId = "local-user",
          allowedSinks = ["provider.ollama"],
        ) =>
          service.addScoped(content, {
            memoryId,
            scope,
            scopeId,
            allowedSinks,
            importance: 0.95,
          });
        await seed("memory-original", oldContent);
        await seed(
          "memory-other-agent",
          "RECOVERY_TOPIC FORBIDDEN_SCOPE_44003",
          "agent",
          "other-agent",
        );
        await seed(
          "memory-other-sink",
          "RECOVERY_TOPIC FORBIDDEN_SINK_44003",
          "user",
          "local-user",
          ["provider.anthropic"],
        );
        const initialRevision = await runtime.memoryPort.getRevision();
        let changedRevision;
        const requests = [],
          plans = [];
        const planContext = ContextMemoryKernel.prototype.planContext;
        vi.spyOn(
          ContextMemoryKernel.prototype,
          "planContext",
        ).mockImplementation(async function (request) {
          const result = await planContext.call(this, request);
          if (request.policyVersion === "cli-provider-v1") plans.push(result);
          return result;
        });
        vi.spyOn(
          PromptCompressor.prototype,
          "shouldAutoCompact",
        ).mockImplementation((messages) =>
          messages.some((message) => message.role === "tool"),
        );
        const call = async (resume, chatFn) => {
          const options = {
            cwd,
            sessionId,
            provider: "ollama",
            model: "qwen2.5:7b",
            projectMemory: false,
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
          const prompt =
            "Continue local work using RECOVERY_TOPIC policy and read evidence";
          return entry === "stream"
            ? runAgentHeadlessStream(options, {
                ...deps,
                input: (async function* () {
                  yield JSON.stringify({ type: "user", content: prompt }) +
                    "\n";
                })(),
              })
            : runAgentHeadless(
                { ...options, prompt, outputFormat: "json" },
                deps,
              );
        };
        const result = await call(false, async (messages) => {
          requests.push(structuredClone(messages));
          if (requests.length === 1) {
            if (change === "supersede") {
              await seed("memory-successor", newContent);
              await runtime.kernel.decideMemory({
                memoryId: "memory-original",
                type: "supersede",
                successorMemoryId: "memory-successor",
                expectedRevision: 1,
                authority: "test-user",
              });
            } else
              expect((await service.delete("memory-original")).status).toBe(
                "purged",
              );
            changedRevision = await runtime.memoryPort.getRevision();
            return {
              message: {
                role: "assistant",
                content: "Read current evidence",
                tool_calls: [1, 2].map((number) => ({
                  id: `read-${number}`,
                  type: "function",
                  function: {
                    name: "read_file",
                    arguments: JSON.stringify({ path: "evidence.txt" }),
                  },
                })),
              },
              usage: { input_tokens: 10, output_tokens: 10 },
            };
          }
          return {
            message: { role: "assistant", content: "Work complete" },
            usage: { input_tokens: 10, output_tokens: 10 },
          };
        });
        expect(result.exitCode, JSON.stringify(result)).toBe(0);
        expect(requests).toHaveLength(2);
        expect(JSON.stringify(requests[0])).toContain(oldContent);
        expect(JSON.stringify(requests[1])).not.toContain(oldContent);
        if (change === "supersede")
          expect(JSON.stringify(requests[1])).toContain(newContent);
        expect(plans.map((plan) => plan.memoryRevision)).toEqual([
          initialRevision,
          changedRevision,
        ]);
        for (const request of requests) {
          const text = JSON.stringify(request);
          expect(text).not.toContain("FORBIDDEN_SCOPE_44003");
          expect(text).not.toContain("FORBIDDEN_SINK_44003");
        }
        const durable = readVerifiedMessages(sessionId);
        expect(
          readVerifiedEvents(sessionId).some(
            (event) => event.type === "compact",
          ),
        ).toBe(true);
        expect(
          durable.filter((message) => message.role === "tool"),
        ).toHaveLength(2);
        expect(JSON.stringify(durable)).not.toContain("MEMORY_44003");
        if (change === "supersede")
          expect((await service.delete("memory-successor")).status).toBe(
            "purged",
          );
        await seed("memory-resumed", resumedContent);
        const resumedRevision = await runtime.memoryPort.getRevision();
        const resumedRequests = [];
        const resumed = await call(true, async (messages) => {
          resumedRequests.push(structuredClone(messages));
          return {
            message: { role: "assistant", content: "Resumed" },
            usage: { input_tokens: 1, output_tokens: 1 },
          };
        });
        expect(resumed.exitCode, JSON.stringify(resumed)).toBe(0);
        expect(resumedRequests).toHaveLength(1);
        const text = JSON.stringify(resumedRequests[0]);
        expect(text).toContain(resumedContent);
        for (const excluded of [
          oldContent,
          newContent,
          "FORBIDDEN_SCOPE_44003",
          "FORBIDDEN_SINK_44003",
        ])
          expect(text).not.toContain(excluded);
        expect(plans.at(-1).memoryRevision).toBe(resumedRevision);
        expect(
          resumedRequests[0].filter((message) => message.role === "tool"),
        ).toHaveLength(2);
        expect(JSON.stringify(readVerifiedMessages(sessionId))).not.toContain(
          "MEMORY_44003",
        );
      },
    );
  }
});
